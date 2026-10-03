// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validSourcePath(path) {
  return typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path) &&
    !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..');
}

// The reader may use the working tree or immutable blobs from a release tag.
export async function bundleHTML(html, bundle, read) {
  if (!bundle) return html;
  if (!validSourcePath(bundle.script) || !bundle.script.endsWith('.js') ||
      !validSourcePath(bundle.style) || !bundle.style.endsWith('.css')) {
    throw new Error('Некорректные пути script/style в release.json');
  }
  const scriptTag = `<script type="module" src="./${bundle.script}"></script>`;
  const styleTag = `<link rel="stylesheet" href="./${bundle.style}">`;
  let source = html.toString();
  if (source.split(scriptTag).length !== 2 || source.split(styleTag).length !== 2) {
    throw new Error('В HTML ожидается ровно одна ссылка на script и style из release.json');
  }
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [bundle.script], bundle: true, write: false,
    format: 'iife', target: 'es2022', charset: 'utf8', legalComments: 'inline',
    plugins: [{
      name: 'repository-sources',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.kind !== 'entry-point' && !args.path.startsWith('.')) {
            throw new Error(`В игре не поддержан внешний импорт: ${args.path}`);
          }
          const path = posix.normalize(args.importer
            ? posix.join(posix.dirname(args.importer), args.path) : args.path);
          if (!validSourcePath(path) || !(/\.(js|json)$/.test(path))) throw new Error(`Некорректный импорт: ${path}`);
          return { path, namespace: 'repository' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'repository' }, args => ({
          contents: read(args.path).toString(), loader: args.path.endsWith('.json') ? 'json' : 'js',
        }));
      },
    }],
  });
  const css = read(bundle.style).toString();
  if (/<\/style/i.test(css)) throw new Error('CSS содержит закрывающий тег style');
  source = source.replace(styleTag, () => `<style>\n${css}\n</style>`);
  source = source.replace(scriptTag, () => `<script>\n${result.outputFiles[0].text}\n</script>`);
  return Buffer.from(source);
}

export async function buildGame(repo) {
  const read = path => readFileSync(resolve(repo, path));
  const { entrypoint, bundle } = JSON.parse(read('release.json'));
  if (!validSourcePath(entrypoint)) throw new Error('Некорректная точка входа');
  return bundleHTML(read(entrypoint), bundle, read);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = await buildGame(process.cwd());
  const destination = resolve('dist/game/index.html');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
  console.log(`Готов standalone HTML: ${destination} (${html.length} байт)`);
}

