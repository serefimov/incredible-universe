import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleHTML, validSourcePath } from './build-game.mjs';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const tagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo });

function metadata(read, expectedVersion) {
  const version = read('VERSION').toString().trim();
  if (!versionPattern.test(version) || (expectedVersion && version !== expectedVersion)) {
    throw new Error(`VERSION ${version} не соответствует версии ${expectedVersion ?? 'X.Y.Z'}`);
  }
  const changelog = read('CHANGELOG.md').toString();
  if (!changelog.split(/\r?\n/).some(line => line === `## ${version}`)) {
    throw new Error(`В CHANGELOG.md нет раздела ## ${version}`);
  }
  const { entrypoint, bundle } = JSON.parse(read('release.json'));
  if (!validSourcePath(entrypoint) || !entrypoint.endsWith('.html')) {
    throw new Error('release.json должен указывать относительный путь к HTML');
  }
  const html = read(entrypoint);
  if (!/<!doctype html/i.test(html.toString())) throw new Error('Точка входа не является HTML');
  if (bundle && (!validSourcePath(bundle.script) || !bundle.script.endsWith('.js') ||
      !validSourcePath(bundle.style) || !bundle.style.endsWith('.css'))) {
    throw new Error('Некорректный bundle в release.json');
  }
  return { version, entrypoint, bundle, html, changelog, license: read('LICENSE') };
}

export function checkWorkingTree(repo) {
  return metadata(path => readFileSync(resolve(repo, path)));
}

function compareVersions(a, b) {
  const left = a.version.split('.').map(BigInt);
  const right = b.version.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

export async function buildPages(repo, output, { requiredTag, mainRef } = {}) {
  if (requiredTag && !tagPattern.test(requiredTag)) {
    throw new Error('Тег выпуска должен иметь формат vX.Y.Z без суффиксов');
  }
  const tags = git(repo, 'tag', '--list', 'v*').toString().trim().split('\n')
    .filter(tag => tagPattern.test(tag));
  if (!tags.length || (requiredTag && !tags.includes(requiredTag))) {
    throw new Error('Нет тегов выпуска или отсутствует тег запуска');
  }
  // Сначала проверяем все версии: ошибочный тег не должен дать частичный сайт.
  const releases = [];
  for (const tag of tags) {
    if (mainRef) git(repo, 'merge-base', '--is-ancestor', tag, mainRef);
    const read = path => {
      const treeEntry = git(repo, 'ls-tree', tag, '--', path).toString();
      if (!treeEntry.startsWith('100644 blob ') && !treeEntry.startsWith('100755 blob ')) {
        throw new Error(`${tag}:${path} отсутствует или не является обычным файлом`);
      }
      return git(repo, 'show', `${tag}:${path}`);
    };
    const release = metadata(read, tag.slice(1));
    release.html = await bundleHTML(release.html, release.bundle, read);
    releases.push({ tag, ...release, commit: git(repo, 'rev-parse', `${tag}^{commit}`).toString().trim() });
  }
  releases.sort(compareVersions);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const release of releases) {
    const folder = resolve(output, release.version);
    await mkdir(folder);
    await writeFile(resolve(folder, 'index.html'), release.html);
    await writeFile(resolve(folder, 'LICENSE'), release.license);
    await writeFile(resolve(folder, 'CHANGELOG.md'), release.changelog);
    await writeFile(resolve(folder, 'VERSION'), `${release.version}\n`);
    await writeFile(resolve(folder, 'release.json'), JSON.stringify({
      version: release.version, tag: release.tag, commit: release.commit,
      source: `https://github.com/serefimov/incredible-universe/tree/${release.tag}`,
      entrypoint: release.entrypoint,
    }, null, 2) + '\n');
  }
  const latest = releases.at(-1).version;
  await writeFile(resolve(output, '.nojekyll'), '');
  await writeFile(resolve(output, 'index.html'), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=./${latest}/"><title>The Incredible Universe</title></head>
<body><a href="./${latest}/">Играть — версия ${latest}</a> · <a href="./versions.html">Все версии</a></body></html>\n`);
  await writeFile(resolve(output, 'versions.html'), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Версии — The Incredible Universe</title></head><body><h1>The Incredible Universe</h1>
<ul>${releases.toReversed().map(release => `<li><a href="./${release.version}/">${release.version}</a> · <a href="./${release.version}/CHANGELOG.md">Изменения</a></li>`).join('\n')}</ul>
</body></html>\n`);
  return { versions: releases.map(release => release.version), latest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--check') {
      console.log(`Проверена версия ${checkWorkingTree(process.cwd()).version}`);
    } else if (process.argv.length === 2) {
      console.log(await buildPages(process.cwd(), resolve('dist/pages'), {
        requiredTag: process.env.PAGES_RELEASE_TAG,
        mainRef: process.env.PAGES_MAIN_REF,
      }));
    } else {
      throw new Error('Использование: node tools/build-pages.mjs [--check]');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
