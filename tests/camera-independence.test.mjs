import { earthClockBody } from '../src/clock-display.js';
import { missionDisplay } from '../src/mission-display.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createGame, resetGame, startGame, placeBody } from '../src/state.js';
import { advanceFrame, discardFrameTime } from '../src/physics.js';
import { followShip } from '../src/camera.js';
import { createInput } from '../src/input.js';
import { createRenderer } from '../src/render.js';

function dom() {
  let arcs = 0;
  const context = new Proxy({ arc() { arcs++; } }, {
    get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const rect = { left: 0, top: 48, width: 390, height: 694, right: 390, bottom: 742 };
  const trayRect = { left: 0, top: 742, width: 390, height: 102, right: 390, bottom: 844 };
  function element(id, type) {
    const captures = new Set();
    return { style: {}, dataset: { type }, handlers: {}, classList: { toggle() {} },
      setAttribute() {}, getContext: () => context,
      getBoundingClientRect: () => id === 'tray' || id === 'tray-toggle' || id === 'card' ? trayRect : rect,
      addEventListener(name, fn) { this.handlers[name] = fn; },
      setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
      releasePointerCapture(id) { captures.delete(id); },
      dispatch(name, values) { this.handlers[name]?.({ pointerId: 1, pointerType: 'touch',
        preventDefault() {}, ...values }); },
    };
  }
  const nodes = Object.fromEntries(['c', 'stage', 'tray', 'play', 'reset', 'follow', 'status', 'hint', 'earth-time', 'ship-time', 'mission', 'result', 'earth-clock-label', 'earth-clock', 'mission-panel', 'mission-heading', 'mission-body', 'conditions', 'mission-feedback', 'follow-label', 'tray-toggle']
    .map(id => [id, element(id)]));
  const cards = ['planet', 'giant', 'star'].map(type => element('card', type));
  const document = { hidden: false, getElementById: id => nodes[id], querySelectorAll: () => cards,
    addEventListener() {} };
  return { nodes, document, arcs: () => arcs };
}

function pan(h) {
  const canvas = h.nodes.c;
  canvas.dispatch('pointerdown', { clientX: 40, clientY: 100 });
  canvas.dispatch('pointermove', { clientX: 140, clientY: 180 });
  canvas.dispatch('pointerup', { clientX: 140, clientY: 180 });
}
function zoom(h) {
  h.nodes.c.dispatch('wheel', { clientX: 80, clientY: 140, deltaY: -600 });
  h.nodes.c.dispatch('pointerdown', { clientX: 40, clientY: 100, pointerId: 1 });
  h.nodes.c.dispatch('pointerdown', { clientX: 140, clientY: 100, pointerId: 2 });
  h.nodes.c.dispatch('pointermove', { clientX: 180, clientY: 100, pointerId: 2 });
  h.nodes.c.dispatch('pointermove', { clientX: 220, clientY: 100, pointerId: 2 });
  h.nodes.c.dispatch('pointerup', { clientX: 40, clientY: 100, pointerId: 1 });
  h.nodes.c.dispatch('pointerup', { clientX: 220, clientY: 100, pointerId: 2 });
}
const clone = value => structuredClone(value);

function legacy() {
  const h = dom();
  const html = readFileSync(new URL('../prototypes/spike_0_3.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\}\)\(\);\s*$/, `
    globalThis.probe = { frame, restoreSetup,
      camera: () => JSON.stringify(cam),
      physics: () => JSON.stringify({ship, bodies, simT, trail, running, setupPlaced}) };
  })();`);
  const sandbox = { document: h.document, performance: { now: () => 0 },
    requestAnimationFrame() {}, devicePixelRatio: 1 };
  vm.runInNewContext(source, sandbox);
  return { ...h, ...sandbox.probe, physics: () => JSON.parse(sandbox.probe.physics()),
    camera: () => JSON.parse(sandbox.probe.camera()) };
}

test('0.1.0: настоящие pan/zoom не меняют тела и результат при одинаковых кадрах', () => {
  const a = legacy(), b = legacy();
  const camera = b.camera(); pan(b); zoom(b);
  assert.notDeepEqual(b.camera(), camera);
  assert.deepEqual(b.physics(), a.physics());
  a.nodes.play.onclick(); b.nodes.play.onclick();
  for (let frame = 1; frame <= 100; frame++) {
    if (frame % 7 === 0) b.nodes.follow.onclick();
    a.frame(frame * 1000 / 60); b.frame(frame * 1000 / 60);
    assert.deepEqual(b.physics(), a.physics());
  }
});

test('0.1.0: расписание кадров меняет траекторию без изменения тел или камеры', () => {
  const a = legacy(), b = legacy();
  assert.deepEqual(a.camera(), b.camera());
  assert.deepEqual(a.physics(), b.physics());
  a.nodes.play.onclick(); b.nodes.play.onclick();
  for (let i = 1; i <= 30; i++) a.frame(i * 1000 / 60);
  for (let i = 1; i <= 60; i++) b.frame(i * 1000 / 120);
  const left = a.physics(), right = b.physics();
  assert.ok(Math.abs(left.simT - right.simT) < 1e-12);
  const difference = Math.hypot(left.ship.x - right.ship.x, left.ship.y - right.ship.y);
  assert.ok(difference > 0.003 && difference < 0.0031);
  console.log(`Spike 0.1.0, t≈1.25: 60/120 Hz ship difference=${difference}`);
});

function current(placements) {
  const h = dom(); let game, now = 0, callback;
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, { document: h.document, performance: { now: () => now },
    createInterface: () => ({ update() {}, reset() {}, closeTray() {}, closeInfo() {}, dismiss() {}, paint() {} }), earthClockBody, missionDisplay, levelFromSearch: () => null, createGame: () => {
      game = createGame();
      for (const p of placements) assert.equal(placeBody(game, ...p), true);
      return game;
    }, resetGame, startGame, advanceFrame, discardFrameTime, followShip, createInput, createRenderer,
    ResizeObserver: class { observe() {} }, requestAnimationFrame: fn => { callback = fn; } });
  return { ...h, game, frame: milliseconds => { now += milliseconds; callback(now); } };
}

for (const placements of [[], [['planet', -350, -140]]]) {
  test(`#3: реальный цикл с pan, pinch, wheel и follow совпадает до столкновения (${placements.length} тел)`, () => {
    const schedules = [[1000 / 30], [1000 / 60], [1000 / 120], [8, 17, 33, 12]];
    let expected;
    for (const moved of [false, true]) for (const schedule of schedules) {
      const h = current(placements);
      const initial = clone({ simulation: h.game.simulation, configuration: h.game.configuration });
      if (moved) {
        const camera = clone(h.game.camera);
        pan(h); zoom(h);
        assert.notDeepEqual(h.game.camera, camera);
        assert.deepEqual({ simulation: h.game.simulation, configuration: h.game.configuration }, initial);
      }
      h.nodes.play.handlers.click();
      for (let frame = 0; h.game.simulation.status === 'running'; frame++) {
        assert.ok(frame < 1000);
        if (moved && frame % 7 === 0) h.nodes.follow.handlers.click();
        h.frame(schedule[frame % schedule.length]);
      }
      assert.equal(h.game.simulation.status, 'collision');
      const result = clone(h.game.simulation);
      expected ??= result;
      assert.deepEqual(result, expected);
      h.nodes.reset.handlers.click();
      assert.deepEqual(h.game.configuration, initial.configuration);
      assert.deepEqual(h.game.simulation, initial.simulation);
    }
  });
}

test('камера меняет объём Canvas-отрисовки из-за отсечения невидимых тел', () => {
  const h = dom(), game = createGame();
  const renderer = createRenderer(h.nodes.c, h.nodes.stage); renderer.resize();
  const before = clone(game.simulation);
  Object.assign(game.camera, { x: 0, y: 0, zoom: 0.22 });
  let start = h.arcs(); renderer.draw(game, {}); const visible = h.arcs() - start;
  Object.assign(game.camera, { x: 1e6, y: 1e6, zoom: 2.8 });
  start = h.arcs(); renderer.draw(game, {}); const outside = h.arcs() - start;
  assert.ok(visible > outside);
  assert.deepEqual(game.simulation, before);
});
