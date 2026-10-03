import { earthClockBody } from '../src/clock-display.js';
import { missionDisplay } from '../src/mission-display.js';
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
    if (!nodes.has(id)) nodes.set(id, { handlers: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener(name, fn) { this.handlers[name] = fn; } });
    return nodes.get(id);
  };
  const handlers = {};
  const document = { hidden: false, getElementById: element, querySelectorAll: () => [],
    addEventListener: (name, fn) => { handlers[name] = fn; } };
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, { document, performance: { now: () => now },
    createGame: () => (game = createGame()), createInterface: () => ({ update() {}, reset() {}, closeTray() {}, closeInfo() {}, dismiss() {}, paint() {} }), earthClockBody, missionDisplay, levelFromSearch: () => null, resetGame, startGame, advanceFrame, discardFrameTime,
    followShip, createInput: () => ({ cancel() {}, state: {} }),
    createRenderer: () => ({ resize() {}, draw() {}, viewport: {} }),
    ResizeObserver: class { observe() {} }, requestAnimationFrame: fn => { callback = fn; } });
  const frame = milliseconds => { now += milliseconds; callback(now); };
  element('follow').handlers.click();
  element('follow').handlers.click();
  assert.equal(game.camera.follow, false, 'centering before launch never starts following');
  assert.equal(game.camera.x, game.simulation.ship.x);
  element('play').handlers.click(); frame(10);
  element('follow').handlers.click(); element('follow').handlers.click();
  assert.equal(game.camera.follow, true, 'centering during flight never disables following');
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
  assert.equal(element('play').disabled, false);
  assert.equal(element('play-label').textContent, 'Сброс');
  element('play').handlers.click();
  assert.equal(element('play').disabled, false);
  assert.equal(element('earth-time').textContent, '0.00');
  assert.equal(element('ship-time').textContent, '0.00');
  element('play').handlers.click(); frame(10);
  assert.equal(game.simulation.steps, 10);
});

test('уход в фон, Reset и Play отменяют реальные жесты до подтверждения позиции', async () => {
  const { createInput } = await import('../src/input.js');
  const { worldToScreen } = await import('../src/camera.js');
  let game, input, callback, resizeCallback, now = 0;
  const nodes = new Map(), handlers = {};
  const element = id => {
    if (!nodes.has(id)) {
      const rect = !['tray', 'tray-toggle'].includes(id) ? { left: 0, top: 48, right: 1000, bottom: 742 } : { left: 0, top: 742, right: 1000, bottom: 844 };
      const captures = new Set();
      nodes.set(id, { dataset: {}, handlers: {}, classList: { toggle() {} }, setAttribute() {},
        getBoundingClientRect: () => rect, addEventListener(name, fn) { this.handlers[name] = fn; },
        setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) });
    }
    return nodes.get(id);
  };
  const cards = ['planet', 'giant', 'star'].map(type => { const card = element(type); card.dataset.type = type; return card; });
  const document = { hidden: false, getElementById: element, querySelectorAll: () => cards,
    addEventListener: (name, fn) => { handlers[name] = fn; } };
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
  const viewport = { width: 1000, height: 694 };
  vm.runInNewContext(source, { document, performance: { now: () => now },
    createGame: () => (game = createGame()), createInterface: () => ({ update() {}, reset() {}, closeTray() {}, closeInfo() {}, dismiss() {}, paint() {} }), earthClockBody, missionDisplay, levelFromSearch: () => null, resetGame, startGame, advanceFrame, discardFrameTime, followShip,
    createInput: (...args) => (input = createInput(...args)),
    createRenderer: () => ({ viewport, resize() {}, draw() {} }),
    ResizeObserver: class { constructor(fn) { resizeCallback = fn; } observe() {} },
    requestAnimationFrame: fn => { callback = fn; } });
  const send = (node, name, values = {}) => node.handlers[name]?.({ pointerType: 'touch', pointerId: 1, preventDefault() {}, ...values });
  const at = (x, y) => { const s = worldToScreen(game.camera, viewport, x, y); return { clientX: s.x, clientY: s.y + 48 }; };
  const newDrag = () => { send(cards[0], 'pointerdown', { clientX: 40, clientY: 790 }); send(cards[0], 'pointermove', at(-350, -140)); };
  newDrag(); assert.ok(input.state.drag);
  resizeCallback();
  assert.equal(input.state.drag, null); assert.equal(cards[0].hasPointerCapture(1), false);
  send(cards[0], 'pointerup', at(-350, -140));
  assert.equal(game.configuration.placed.length, 0);
  newDrag();
  document.hidden = true; handlers.visibilitychange();
  assert.equal(input.state.drag, null); assert.equal(cards[0].hasPointerCapture(1), false);
  document.hidden = false; handlers.visibilitychange(); send(cards[0], 'pointerup', at(-350, -140));
  assert.equal(game.configuration.placed.length, 0);
  newDrag(); send(cards[0], 'pointerup', at(-350, -140));
  const before = structuredClone(game.configuration);
  send(element('c'), 'pointerdown', at(-350, -140)); send(element('c'), 'pointermove', at(-310, -120));
  document.hidden = true; handlers.visibilitychange(); document.hidden = false; handlers.visibilitychange();
  send(element('c'), 'pointerup', at(-310, -120));
  assert.deepEqual(game.configuration, before);
  for (const button of ['follow', 'play']) {
    send(element('c'), 'pointerdown', at(-350, -140)); send(element('c'), 'pointermove', at(-310, -120));
    element(button).handlers.click();
    assert.equal(input.state.drag, null); assert.equal(input.state.pointers.size, 0);
    assert.equal(element('c').hasPointerCapture(1), false);
    send(element('c'), 'pointerup', at(-310, -120)); assert.deepEqual(game.configuration, before);
  }
  assert.equal(element('play-label').textContent, 'Сброс');
  element('play').handlers.click();
  assert.equal(game.simulation.status, 'ready');
  assert.equal(game.simulation.shipYears, 0);
  assert.deepEqual(game.configuration, before);
  assert.equal(element('play-label').textContent, 'Пуск');
  element('play').handlers.click();
  now = 10; callback(now);
  assert.equal(game.simulation.status, 'running');
  assert.equal(game.configuration.placed[0].x, -350);
});
