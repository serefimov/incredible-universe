import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createGame, resetGame, startGame } from '../src/state.js';
import { advanceFrame, discardFrameTime } from '../src/physics.js';
import { followShip } from '../src/camera.js';

test('реальный кадровый цикл пропускает фон, очищает часы и показывает численную ошибку', () => {
  let game, now = 0, callback;
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } });
    return nodes.get(id);
  };
  const handlers = {};
  const document = { hidden: false, getElementById: element, querySelectorAll: () => [],
    addEventListener: (name, fn) => { handlers[name] = fn; } };
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, { document, performance: { now: () => now },
    createGame: () => (game = createGame()), resetGame, startGame, advanceFrame, discardFrameTime,
    followShip, createInput: () => ({ cancel() {}, state: {} }),
    createRenderer: () => ({ resize() {}, draw() {}, viewport: {} }),
    ResizeObserver: class { observe() {} }, requestAnimationFrame: fn => { callback = fn; } });
  const frame = milliseconds => { now += milliseconds; callback(now); };
  element('play').handlers.click(); frame(10);
  assert.equal(game.simulation.steps, 10);
  assert.equal(element('earth-time').textContent, game.simulation.earthYears.toFixed(2));
  assert.equal(element('ship-time').textContent, game.simulation.shipYears.toFixed(2));
  assert.ok(game.simulation.earthYears > game.simulation.shipYears);
  const hiddenClocks = [game.simulation.earthYears, game.simulation.shipYears];
  document.hidden = true; handlers.visibilitychange();
  frame(60000);
  assert.equal(game.simulation.steps, 10);
  assert.deepEqual([game.simulation.earthYears, game.simulation.shipYears], hiddenClocks);
  document.hidden = false; handlers.visibilitychange(); frame(10);
  assert.equal(game.simulation.steps, 20, 'no background catch-up');
  game.simulation.ship.vx = NaN; frame(10);
  assert.equal(game.simulation.status, 'error');
  assert.match(element('status').textContent, /ошибка симуляции/);
  assert.equal(element('play').disabled, true);
  element('reset').handlers.click();
  assert.equal(element('play').disabled, false);
  assert.equal(element('earth-time').textContent, '0.00');
  assert.equal(element('ship-time').textContent, '0.00');
  element('play').handlers.click(); frame(10);
  assert.equal(game.simulation.steps, 10);
});
