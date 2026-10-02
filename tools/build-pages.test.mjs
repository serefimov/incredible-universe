import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildPages, checkWorkingTree } from './build-pages.mjs';

async function fixture(t) {
  const repo = await mkdtemp(resolve(tmpdir(), 'universe-pages-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'test@example.invalid');
  async function release(version, html = `<!doctype html><p>${version}</p>`, tag = `v${version}`) {
    await writeFile(resolve(repo, 'VERSION'), `${version}\n`);
    await writeFile(resolve(repo, 'CHANGELOG.md'), `# Изменения\n\n## ${version}\n\nСодержимое выпуска.\n`);
    await writeFile(resolve(repo, 'release.json'), '{"entrypoint":"game.html"}\n');
    await writeFile(resolve(repo, 'game.html'), html);
    await writeFile(resolve(repo, 'LICENSE'), 'License fixture\n');
    git('add', '.');
    git('commit', '-m', '#1 подготовил тестовый выпуск');
    git('tag', '-a', tag, '-m', `Version ${version}`);
  }
  return { repo, output: resolve(repo, 'pages'), git, release };
}

test('сохраняет старые HTML из тегов и выбирает последнюю версию по числам', async t => {
  const f = await fixture(t);
  const original = '<!doctype html>\n<p>Первый выпуск</p>';
  await f.release('0.2.0', original);
  await f.release('0.10.0');
  // Повторный запуск от старого тега не должен откатить корень сайта.
  const result = await buildPages(f.repo, f.output, { requiredTag: 'v0.2.0', mainRef: 'main' });
  assert.deepEqual(result, { versions: ['0.2.0', '0.10.0'], latest: '0.10.0' });
  assert.equal(await readFile(resolve(f.output, '0.2.0/index.html'), 'utf8'), original);
  assert.match(await readFile(resolve(f.output, 'index.html'), 'utf8'), /url=\.\/0\.10\.0\//);
  assert.match(await readFile(resolve(f.output, 'versions.html'), 'utf8'), /\.\/0\.2\.0\//);
  assert.equal(await readFile(resolve(f.output, '0.2.0/LICENSE'), 'utf8'), 'License fixture\n');
  assert.match(await readFile(resolve(f.output, '0.2.0/CHANGELOG.md'), 'utf8'), /## 0\.2\.0/);
  const source = JSON.parse(await readFile(resolve(f.output, '0.2.0/release.json'), 'utf8'));
  assert.equal(source.commit, f.git('rev-parse', 'v0.2.0^{commit}').toString().trim());
  assert.equal(source.tag, 'v0.2.0');
  await buildPages(f.repo, f.output, { requiredTag: 'v0.10.0', mainRef: 'main' });
  assert.equal(await readFile(resolve(f.output, '0.2.0/index.html'), 'utf8'), original);
});

test('отклоняет тег с версией, отличной от VERSION, до замены сайта', async t => {
  const f = await fixture(t);
  await f.release('0.1.0');
  await buildPages(f.repo, f.output);
  const before = await readFile(resolve(f.output, 'index.html'));
  f.git('tag', 'v0.2.0');
  await assert.rejects(buildPages(f.repo, f.output), /не соответствует/);
  assert.deepEqual(await readFile(resolve(f.output, 'index.html')), before);
});

test('отклоняет тег из ветки, не вошедшей в main', async t => {
  const f = await fixture(t);
  await f.release('0.1.0');
  f.git('checkout', '-b', '1-init');
  await f.release('0.2.0');
  await assert.rejects(buildPages(f.repo, f.output, { requiredTag: 'v0.2.0', mainRef: 'main' }));
});

test('проверяет changelog и точку входа; не принимает путь за пределами репозитория', async t => {
  const f = await fixture(t);
  await f.release('0.1.0');
  assert.equal(checkWorkingTree(f.repo).version, '0.1.0');
  await writeFile(resolve(f.repo, 'CHANGELOG.md'), '# Без версии\n');
  assert.throws(() => checkWorkingTree(f.repo), /CHANGELOG/);
  await writeFile(resolve(f.repo, 'CHANGELOG.md'), '## 0.1.0\n');
  await writeFile(resolve(f.repo, 'release.json'), '{"entrypoint":"../game.html"}');
  assert.throws(() => checkWorkingTree(f.repo), /относительный путь/);
});

test('не публикует нерелизные теги и отказывает при отсутствии выпуска', async t => {
  const f = await fixture(t);
  await assert.rejects(buildPages(f.repo, f.output), /Нет тегов/);
  await f.release('0.1.0');
  f.git('tag', 'v0.2.0-rc.1');
  f.git('tag', 'v01.0.0');
  const result = await buildPages(f.repo, f.output);
  assert.deepEqual(result.versions, ['0.1.0']);
  await assert.rejects(buildPages(f.repo, f.output, { requiredTag: 'v0.2.0-rc.1' }), /формат/);
  await assert.rejects(buildPages(f.repo, f.output, { requiredTag: 'v9.0.0' }), /Нет тегов/);
});

test('публикует модульную игру из нового тега, сохраняя старый standalone выпуск', async t => {
  const f = await fixture(t);
  const old = '<!doctype html><p>old-release</p>';
  await f.release('0.1.0', old);
  await writeFile(resolve(f.repo, 'VERSION'), '0.2.0\n');
  await writeFile(resolve(f.repo, 'CHANGELOG.md'), '## 0.2.0\n');
  await writeFile(resolve(f.repo, 'release.json'), JSON.stringify({ entrypoint: 'game.html',
    bundle: { script: 'main.js', style: 'style.css' } }));
  await writeFile(resolve(f.repo, 'game.html'), '<!doctype html><link rel="stylesheet" href="./style.css"><script type="module" src="./main.js"></script>');
  await writeFile(resolve(f.repo, 'main.js'), 'import { message } from "./data.js"; console.log(message);');
  await writeFile(resolve(f.repo, 'data.js'), 'export const message = "tag-version-0.2.0";');
  await writeFile(resolve(f.repo, 'style.css'), 'body { color: red; }');
  f.git('add', '.');
  f.git('commit', '-m', '#2 подготовил тестовую модульную игру');
  f.git('tag', '-a', 'v0.2.0', '-m', 'Version 0.2.0');
  // The working copy is deliberately different from the release source.
  await writeFile(resolve(f.repo, 'data.js'), 'export const message = "working-copy";');
  const result = await buildPages(f.repo, f.output, { requiredTag: 'v0.2.0', mainRef: 'main' });
  assert.equal(result.latest, '0.2.0');
  assert.equal(await readFile(resolve(f.output, '0.1.0/index.html'), 'utf8'), old);
  const html = await readFile(resolve(f.output, '0.2.0/index.html'), 'utf8');
  assert.match(html, /tag-version-0.2.0/);
  assert.ok(!html.includes('working-copy'));
  assert.ok(!html.includes('src="./main.js"'));
});
