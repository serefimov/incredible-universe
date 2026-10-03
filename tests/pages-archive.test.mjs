import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { preparePublication, mergeArchive, renderSite } from '../tools/pages-archive.mjs';
import { checkWorkingTree } from '../tools/build-pages.mjs';
import { storeArchive } from '../tools/store-pages-archive.mjs';

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'universe-archive-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = resolve(root, 'repo'); await mkdir(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
  git('init', '--initial-branch=main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(resolve(repo, 'VERSION'), '0.2.0\n');
  await writeFile(resolve(repo, 'CHANGELOG.md'), '## 0.2.0\n');
  await writeFile(resolve(repo, 'LICENSE'), 'fixture license');
  await writeFile(resolve(repo, 'release.json'), '{"entrypoint":"game.html"}');
  await writeFile(resolve(repo, 'game.html'), '<!doctype html><p>release</p>');
  git('add', '.'); git('commit', '-m', 'release'); git('tag', 'v0.2.0');
  async function dev(text = 'dev', version = '0.3.0-alpha.1') {
    await writeFile(resolve(repo, 'VERSION'), `${version}\n`);
    await writeFile(resolve(repo, 'CHANGELOG.md'), '## Не выпущено\n');
    await writeFile(resolve(repo, 'game.html'), `<!doctype html><p>${text}</p>`);
    git('add', '.'); git('commit', '-m', text);
  }
  return { root, repo, git, dev, archive: resolve(root, 'archive'), site: resolve(root, 'site') };
}

test('dev из двух коммитов одной версии сохраняется вместе с релизами и старыми ссылками', async t => {
  const f = await fixture(t); await f.dev('first');
  const one = resolve(f.root, 'one');
  await preparePublication(f.repo, one, { branch: '22-dev/pages', mainRef: 'main', runId: '1' });
  await mergeArchive(one, f.archive);
  const firstName = `0.3.0-alpha.1-${f.git('rev-parse', 'HEAD').slice(0, 12)}`;
  const before = await readFile(resolve(f.archive, 'dev', firstName, 'index.html'));
  await f.dev('second');
  const two = resolve(f.root, 'two');
  await preparePublication(f.repo, two, { branch: '22-dev/pages', mainRef: 'main', runId: '2' });
  await mergeArchive(two, f.archive); await renderSite(f.archive, f.site);
  const secondName = `0.3.0-alpha.1-${f.git('rev-parse', 'HEAD').slice(0, 12)}`;
  assert.deepEqual(await readFile(resolve(f.site, 'dev', firstName, 'index.html')), before);
  assert.match(await readFile(resolve(f.site, 'dev', secondName, 'index.html'), 'utf8'), /second/);
  assert.match(await readFile(resolve(f.site, 'release/0.2.0/index.html'), 'utf8'), /release/);
  assert.match(await readFile(resolve(f.site, '0.2.0/index.html'), 'utf8'), /\.\.\/release\/0\.2\.0\//);
  assert.match(await readFile(resolve(f.site, 'dev/index.html'), 'utf8'), /22-dev\/pages/);
  assert.match(await readFile(resolve(f.site, 'index.html'), 'utf8'), /\.\/dev\//);
  // A late older workflow must not replace the branch pointer.
  await mergeArchive(one, f.archive);
  const ref = JSON.parse(await readFile(resolve(f.archive, '_refs', `${Buffer.from('22-dev/pages').toString('base64url')}.json`)));
  assert.equal(ref.name, secondName);
  const releaseOnly = resolve(f.root, 'release-only');
  await preparePublication(f.repo, releaseOnly, { requiredTag: 'v0.2.0', mainRef: 'main' });
  await mergeArchive(releaseOnly, f.archive); await renderSite(f.archive, f.site);
  assert.deepEqual(await readFile(resolve(f.site, 'dev', firstName, 'index.html')), before);
});

test('повторная сборка сохраняет метаданные; изменённый опубликованный адрес отклоняется', async t => {
  const f = await fixture(t); await f.dev();
  const payload = resolve(f.root, 'payload');
  await preparePublication(f.repo, payload, { branch: 'feature<&', runId: '3' });
  await mergeArchive(payload, f.archive);
  const name = `0.3.0-alpha.1-${f.git('rev-parse', 'HEAD').slice(0, 12)}`;
  const before = await readFile(resolve(f.archive, 'dev', name, 'release.json'));
  await preparePublication(f.repo, payload, { branch: 'feature<&', runId: '3' });
  await mergeArchive(payload, f.archive);
  assert.deepEqual(await readFile(resolve(f.archive, 'dev', name, 'release.json')), before);
  await renderSite(f.archive, f.site);
  assert.match(await readFile(resolve(f.site, 'dev/index.html'), 'utf8'), /feature&lt;&amp;/);
  await writeFile(resolve(payload, 'dev', name, 'index.html'), 'changed');
  await assert.rejects(mergeArchive(payload, f.archive), /Изменение опубликованной/);
});

test('prerelease проверяется отдельно от стабильного тега; push релизного коммита остаётся dev', async t => {
  const f = await fixture(t);
  const stable = resolve(f.root, 'stable');
  await preparePublication(f.repo, stable, { branch: 'main' });
  const name = `0.2.0-pre-${f.git('rev-parse', 'HEAD').slice(0, 12)}`;
  assert.match(await readFile(resolve(stable, 'dev', name, 'index.html'), 'utf8'), /release/);
  await f.dev(); assert.equal(checkWorkingTree(f.repo).version, '0.3.0-alpha.1');
  f.git('tag', 'v0.3.0');
  await assert.rejects(preparePublication(f.repo, resolve(f.root, 'bad'), { requiredTag: 'v0.3.0' }), /не соответствует/);
  for (const version of ['0.3.0-alpha.01', '0.3.0-unknown', '00.3.0-pre', '../alpha']) {
    await writeFile(resolve(f.repo, 'VERSION'), version);
    assert.throws(() => checkWorkingTree(f.repo), /VERSION/);
  }
});

test('архивная ветка создаётся и обновляется повторно без потери сборок и исходников', async t => {
  const f = await fixture(t);
  const remote = resolve(f.root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' }); f.git('remote', 'add', 'origin', remote);
  await f.dev('first'); const firstSha = f.git('rev-parse', 'HEAD');
  const payload = resolve(f.root, 'payload');
  await preparePublication(f.repo, payload, { branch: 'main', runId: '1' });
  await storeArchive(f.repo, payload);
  const archived = f.git('ls-remote', '--heads', 'origin', 'pages-archive'); assert.ok(archived);
  await storeArchive(f.repo, payload);
  assert.equal(f.git('ls-remote', '--heads', 'origin', 'pages-archive'), archived);
  await f.dev('second');
  const second = resolve(f.root, 'second');
  await preparePublication(f.repo, second, { branch: 'main', runId: '2' });
  await storeArchive(f.repo, second);
  f.git('fetch', 'origin', 'pages-archive');
  assert.match(f.git('show', `FETCH_HEAD:dev/0.3.0-alpha.1-${firstSha.slice(0, 12)}/index.html`), /first/);
  assert.match(await readFile(resolve(f.repo, 'game.html'), 'utf8'), /second/);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('параллельные писатели архива сохраняют обе сборки после повторного чтения', async t => {
  const f = await fixture(t);
  const remote = resolve(f.root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  f.git('remote', 'add', 'origin', remote);
  const initial = resolve(f.root, 'initial');
  await preparePublication(f.repo, initial, { branch: 'main', runId: '1' }); await storeArchive(f.repo, initial);
  const other = resolve(f.root, 'other');
  execFileSync('git', ['clone', '--no-local', f.repo, other], { stdio: 'pipe' });
  const git = (...args) => execFileSync('git', args, { cwd: other, stdio: 'pipe' }).toString().trim();
  git('remote', 'set-url', 'origin', remote); git('config', 'user.name', 'Other'); git('config', 'user.email', 'other@example.invalid');
  await f.dev('left');
  await writeFile(resolve(other, 'VERSION'), '0.3.0-alpha.1\n');
  await writeFile(resolve(other, 'CHANGELOG.md'), '## Не выпущено\n');
  await writeFile(resolve(other, 'game.html'), '<!doctype html><p>right</p>');
  git('add', '.'); git('commit', '-m', 'right');
  const left = resolve(f.root, 'left'), right = resolve(f.root, 'right');
  await preparePublication(f.repo, left, { branch: 'left', runId: '2' });
  await preparePublication(other, right, { branch: 'right', runId: '3' });
  await Promise.all([storeArchive(f.repo, left), storeArchive(other, right)]);
  f.git('fetch', 'origin', 'pages-archive');
  assert.match(f.git('show', `FETCH_HEAD:dev/0.3.0-alpha.1-${f.git('rev-parse', 'HEAD').slice(0, 12)}/index.html`), /left/);
  assert.match(f.git('show', `FETCH_HEAD:dev/0.3.0-alpha.1-${git('rev-parse', 'HEAD').slice(0, 12)}/index.html`), /right/);
});

test('новый release удаляет предыдущий цикл dev; поздний старый job не возвращает его', async t => {
  const f = await fixture(t); await f.dev('before-release');
  const old = resolve(f.root, 'old');
  await preparePublication(f.repo, old, { branch: 'main', runId: '10' });
  await mergeArchive(old, f.archive);
  const oldName = `0.3.0-alpha.1-${f.git('rev-parse', 'HEAD').slice(0, 12)}`;
  await writeFile(resolve(f.repo, 'VERSION'), '0.3.0\n');
  await writeFile(resolve(f.repo, 'CHANGELOG.md'), '## 0.3.0\n');
  f.git('add', '.'); f.git('commit', '-m', 'release 0.3'); f.git('tag', 'v0.3.0');
  const release = resolve(f.root, 'release');
  await preparePublication(f.repo, release, { requiredTag: 'v0.3.0', runId: '20' });
  await mergeArchive(release, f.archive); await renderSite(f.archive, f.site);
  await assert.rejects(readFile(resolve(f.archive, 'dev', oldName, 'index.html')), { code: 'ENOENT' });
  assert.ok(!(await readFile(resolve(f.site, 'dev/index.html'), 'utf8')).includes(oldName));
  assert.match(await readFile(resolve(f.site, 'release/0.3.0/index.html'), 'utf8'), /before-release/);
  assert.match(await readFile(resolve(f.site, 'release/0.2.0/index.html'), 'utf8'), /release/);
  // Payload prepared before the release must not resurrect its expired files/pointers.
  await mergeArchive(old, f.archive);
  await assert.rejects(readFile(resolve(f.archive, 'dev', oldName, 'index.html')), { code: 'ENOENT' });
  await f.dev('after-release', '0.4.0-alpha.1');
  const current = resolve(f.root, 'current');
  await preparePublication(f.repo, current, { branch: 'main', runId: '21' });
  await mergeArchive(current, f.archive);
  const currentName = `0.4.0-alpha.1-${f.git('rev-parse', 'HEAD').slice(0, 12)}`;
  // Rerunning a pre-release push after the tag also keeps its ORIGINAL run ID.
  const late = resolve(f.root, 'late');
  await preparePublication(f.repo, late, { branch: 'late-old-run', runId: '19' });
  await mergeArchive(late, f.archive);
  // Rerunning the release later must not advance the cutoff or delete current dev.
  const rerun = resolve(f.root, 'rerun');
  await preparePublication(f.repo, rerun, { requiredTag: 'v0.3.0', runId: '40' });
  await mergeArchive(rerun, f.archive); await renderSite(f.archive, f.site);
  assert.match(await readFile(resolve(f.site, 'dev', currentName, 'index.html'), 'utf8'), /after-release/);
  assert.ok(!(await readFile(resolve(f.site, 'dev/index.html'), 'utf8')).includes('late-old-run'));
  assert.equal(JSON.parse(await readFile(resolve(f.archive, '_retention.json'))).runId, '20');
});
