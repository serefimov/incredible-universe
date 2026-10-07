// SPDX-License-Identifier: GPL-3.0-or-later
import { cp, mkdir, readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPages, checkWorkingTree } from './build-pages.mjs';
import { buildGame } from './build-game.mjs';

const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const page = (title, content, prefix = '..') => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
<meta name="description" content="Головоломка о гравитации, космосе и времени. Расставляйте небесные тела и найдите путь для корабля.">
<meta property="og:title" content="${escape(title)}"><meta property="og:type" content="website">
<meta property="og:image" content="https://serefimov.github.io/incredible-universe/assets/brand/source.jpg">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#05070d">
<link rel="icon" type="image/svg+xml" href="${prefix}/assets/brand/icon.svg"><link rel="apple-touch-icon" href="${prefix}/assets/brand/apple-touch-icon.png">
<style>body{font:16px system-ui;max-width:850px;margin:24px auto;padding:0 16px;line-height:1.5;background:#05070d;color:#dfeaff}li{margin:12px 0}a{overflow-wrap:anywhere;color:#81e1de}.brand{display:block;width:min(100%,360px);height:auto;margin:auto}h1{font-size:24px}</style></head><body><a href="${prefix}/"><img class="brand" src="${prefix}/assets/brand/emblem.svg" width="750" height="665" alt="The Incredible Universe"></a><h1>${escape(title)}</h1>${content}</body></html>\n`;
const directories = async path => existsSync(path) ? (await readdir(path, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name) : [];

const compareVersions = (a, b) => {
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
};
const retentionPath = archive => resolve(archive, '_retention.json');

// A release run establishes a permanent cutoff. Rerunning it must not move
// the cutoff forward and delete newer dev builds. Legacy records predate this policy.
function keepDev(record, retention) {
  if (!retention) return true;
  if (!record.baseRelease) return compareVersions(record.version.split('-')[0], retention.version) > 0;
  return record.baseRelease === retention.version &&
    (retention.runId === '0' || BigInt(record.runId) > BigInt(retention.runId));
}

export async function preparePublication(repo, output, { branch, requiredTag, mainRef, runId = '0' } = {}) {
  const temp = await mkdtemp(resolve(tmpdir(), 'universe-releases-'));
  try {
    await mkdir(output, { recursive: true });
    const releases = await buildPages(repo, temp, { requiredTag, mainRef });
    for (const version of releases.versions) {
      await cp(resolve(temp, version), resolve(output, 'release', version), { recursive: true });
    }
    await writeFile(retentionPath(output), JSON.stringify({ version: releases.latest,
      runId: requiredTag === `v${releases.latest}` ? String(runId) : '0' }) + '\n');
    if (branch) {
      const { version } = checkWorkingTree(repo);
      const commit = git(repo, 'rev-parse', 'HEAD');
      const name = `${version.includes('-') ? version : `${version}-pre`}-${commit.slice(0, 12)}`;
      const folder = resolve(output, 'dev', name);
      await mkdir(folder, { recursive: true });
      await writeFile(resolve(folder, 'index.html'), await buildGame(repo));
      for (const path of ['VERSION', 'LICENSE', 'CHANGELOG.md']) await cp(resolve(repo, path), resolve(folder, path));
      await writeFile(resolve(folder, 'release.json'), JSON.stringify({
        version, commit, branch, baseRelease: releases.latest, runId: String(runId), builtAt: new Date().toISOString(), name,
        source: `https://github.com/serefimov/incredible-universe/tree/${commit}`,
      }, null, 2) + '\n');
      const refs = resolve(output, '_refs'); await mkdir(refs, { recursive: true });
      await writeFile(resolve(refs, `${Buffer.from(branch).toString('base64url')}.json`), JSON.stringify({ branch, name, runId: String(runId) }) + '\n');
    }
    return releases;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

// Immutable build folders; only branch pointers may advance. Used before each optimistic push.
export async function mergeArchive(payload, archive) {
  await mkdir(archive, { recursive: true });
  let retention = existsSync(retentionPath(archive)) ? await json(retentionPath(archive)) : null;
  if (existsSync(retentionPath(payload))) {
    const incoming = await json(retentionPath(payload));
    if (!retention || compareVersions(incoming.version, retention.version) > 0 ||
        (incoming.version === retention.version && retention.runId === '0' && incoming.runId !== '0')) {
      retention = incoming; await writeFile(retentionPath(archive), JSON.stringify(retention) + '\n');
    }
  }
  await mkdir(resolve(archive, '_refs'), { recursive: true });
  for (const name of await directories(resolve(archive, 'dev'))) {
    const folder = resolve(archive, 'dev', name);
    if (!keepDev(await json(resolve(folder, 'release.json')), retention)) await rm(folder, { recursive: true, force: true });
  }
  for (const file of await readdir(resolve(archive, '_refs'))) {
    const path = resolve(archive, '_refs', file), ref = await json(path);
    if (!existsSync(resolve(archive, 'dev', ref.name))) await rm(path);
  }
  for (const channel of ['dev', 'release']) {
    for (const name of await directories(resolve(payload, channel))) {
      if (!/^[0-9A-Za-z.-]+$/.test(name)) throw new Error('Некорректный адрес сборки');
      const from = resolve(payload, channel, name), to = resolve(archive, channel, name);
      if (channel === 'dev' && !keepDev(await json(resolve(from, 'release.json')), retention)) continue;
      if (existsSync(to)) {
        const old = await json(resolve(to, 'release.json')), incoming = await json(resolve(from, 'release.json'));
        if (old.commit !== incoming.commit || old.version !== incoming.version) throw new Error(`Конфликт архива ${channel}/${name}`);
        for (const path of ['index.html', 'VERSION', 'LICENSE', 'CHANGELOG.md']) {
          if (!(await readFile(resolve(from, path))).equals(await readFile(resolve(to, path)))) throw new Error(`Изменение опубликованной сборки ${channel}/${name}/${path}`);
        }
      } else await cp(from, to, { recursive: true });
    }
  }
  await mkdir(resolve(archive, '_refs'), { recursive: true });
  for (const file of existsSync(resolve(payload, '_refs')) ? await readdir(resolve(payload, '_refs')) : []) {
    if (!/^[A-Za-z0-9_-]+\.json$/.test(file)) throw new Error('Некорректная ссылка ветки');
    const from = resolve(payload, '_refs', file), to = resolve(archive, '_refs', file);
    const incoming = await json(from);
    if (!existsSync(resolve(archive, 'dev', incoming.name)) ||
        !keepDev(await json(resolve(payload, 'dev', incoming.name, 'release.json')), retention)) continue;
    if (!existsSync(to) || BigInt(incoming.runId) > BigInt((await json(to)).runId)) await cp(from, to);
  }


}

export async function renderSite(archive, output) {
  await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
  await cp(fileURLToPath(new URL('../assets/brand/', import.meta.url)), resolve(output, 'assets/brand'), { recursive: true });
  const dev = await directories(resolve(archive, 'dev'));
  const releases = (await directories(resolve(archive, 'release'))).sort((a, b) => {
    const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? 1 : -1;
    return 0;
  });
  for (const channel of ['dev', 'release']) {
    await mkdir(resolve(output, channel), { recursive: true });
    for (const name of channel === 'dev' ? dev : releases) await cp(resolve(archive, channel, name), resolve(output, channel, name), { recursive: true });
  }
  const refs = existsSync(resolve(archive, '_refs')) ? await readdir(resolve(archive, '_refs')) : [];
  let branches = '';
  for (const file of refs.sort()) {
    const ref = await json(resolve(archive, '_refs', file));
    if (!dev.includes(ref.name)) throw new Error('Ссылка ветки не найдена в архиве');
    branches += `<li><a href="./${ref.name}/">${escape(ref.branch)}</a> — ${escape(ref.name)}</li>`;
  }
  const entries = await Promise.all(dev.map(async name => ({ name, ...await json(resolve(archive, 'dev', name, 'release.json')) })));
  entries.sort((a, b) => b.builtAt.localeCompare(a.builtAt));
  await writeFile(resolve(output, 'dev/index.html'), page('Dev — The Incredible Universe', `<p><a href="../">Главная</a></p><h2>Последние сборки веток</h2><ul>${branches}</ul><h2>Все сборки</h2><ul>${entries.map(e => `<li><a href="./${e.name}/">${escape(e.name)}</a> — ${escape(e.branch)} — ${escape(e.builtAt)} · <a href="${escape(e.source)}">коммит ${escape(e.commit.slice(0, 12))}</a></li>`).join('')}</ul>`));
  await writeFile(resolve(output, 'release/index.html'), page('Release — The Incredible Universe', `<p><a href="../">Главная</a></p><ul>${releases.map(version => `<li><a href="./${version}/">${version}</a></li>`).join('')}</ul>`));
  await writeFile(resolve(output, 'index.html'), page('The Incredible Universe', '<p>Головоломка о гравитации, космосе и времени. Расставляйте небесные тела и найдите путь для корабля.</p><p><a href="./dev/">Dev — тестировать изменения из веток</a></p><p><a href="./release/">Release — стабильные выпуски</a></p>', '.'));
  await writeFile(resolve(output, '.nojekyll'), '');
  await writeFile(resolve(output, 'versions.html'), page('Версии', '<a href="./release/">Стабильные выпуски</a> · <a href="./dev/">Dev-сборки</a>', '.'));
  for (const version of releases) {
    await mkdir(resolve(output, version), { recursive: true });
    await writeFile(resolve(output, version, 'index.html'), page(version, `<meta http-equiv="refresh" content="0; url=../release/${version}/"><a href="../release/${version}/">Открыть ${version}</a>`));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'prepare') await preparePublication(process.cwd(), resolve('dist/payload'), {
    branch: process.env.PAGES_BRANCH, requiredTag: process.env.PAGES_RELEASE_TAG,
    mainRef: process.env.PAGES_MAIN_REF, runId: process.env.GITHUB_RUN_ID,
  });
  else if (process.argv[2] === 'render' && process.argv.length === 5) await renderSite(resolve(process.argv[3]), resolve(process.argv[4]));
  else throw new Error('Использование: pages-archive.mjs prepare | render ARCHIVE OUTPUT');
}
