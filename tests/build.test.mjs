import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGame, bundleHTML } from '../tools/build-game.mjs';
import test from 'node:test';
import vm from 'node:vm';

test('собирает реальную игру в один HTML без внешних модулей и стилей', async () => {
  const first = await buildGame(process.cwd());
  const second = await buildGame(process.cwd());
  assert.deepEqual(first, second, 'Same sources build identical bytes');
  const html = first.toString();
  assert.ok(html.includes('The Incredible Universe'));
  assert.ok(!/<script[^>]+src=/.test(html));
  assert.ok(!/<link[^>]+stylesheet/.test(html));
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(source);
  assert.ok(readFileSync('index.html', 'utf8').includes('type="module"'));
});

test('упаковка старого самостоятельного HTML сохраняет его байт в байт', async () => {
  const old = readFileSync('prototypes/spike_0_3.html');
  assert.strictEqual(await bundleHTML(old, undefined, () => { throw new Error('No build needed'); }), old);
});

test('сборка из содержимого тега не подменяет модули рабочей копией', async () => {
  const html = Buffer.from('<!doctype html><link rel="stylesheet" href="./src/styles.css"><script type="module" src="./src/main.js"></script>');
  const files = {
    'src/main.js': 'import { value } from "./data.js"; console.log(value);',
    'src/data.js': 'export const value = "tag-source";',
    'src/styles.css': 'body { color: red; }',
  };
  const bundled = await bundleHTML(html, { script: 'src/main.js', style: 'src/styles.css' }, path => Buffer.from(files[path]));
  assert.match(bundled.toString(), /tag-source/);
  assert.match(bundled.toString(), /color: red/);
  await assert.rejects(bundleHTML(html, { script: '../src/main.js', style: 'src/styles.css' }, () => {}), /Некорректные пути/);
});


test('JSON миссий встраивается из того же дерева источников, что и скрипт', async () => {
  const html = Buffer.from('<!doctype html><link rel="stylesheet" href="./src/styles.css"><script type="module" src="./src/main.js"></script>');
  const files = { 'src/main.js': 'import levels from "../levels/examples.json" with {type:"json"}; console.log(levels[0].id);',
    'levels/examples.json': '[{"id":"immutable-tag-mission"}]', 'src/styles.css': '' };
  const bundled = await bundleHTML(html, {script:'src/main.js',style:'src/styles.css'}, path => Buffer.from(files[path]));
  assert.match(bundled.toString(), /immutable-tag-mission/);
  assert.ok(!bundled.toString().includes('with {type:'));
});
