import assert from 'node:assert/strict';
import test from 'node:test';
import { SPIKE_SCENARIO } from '../src/scenario.js';
import { createGame, placeBody, moveBody, removeBody, resetGame, startGame } from '../src/state.js';
import { advanceFrame, stepSimulation } from '../src/physics.js';
import { worldToScreen, screenToWorld, zoomAt, followShip } from '../src/camera.js';
import { createRenderer } from '../src/render.js';
import { referenceSpike } from './reference-spike.mjs';

const clone = value => structuredClone(value);
const physicalState = game => ({ ship: clone(game.simulation.ship), bodies: clone(game.simulation.bodies),
  trail: clone(game.simulation.trail), time: game.simulation.time });

test('сценарий совпадает со Spike и не разделяет изменяемые объекты с полётом', () => {
  const game = createGame(), spike = referenceSpike().snapshot();
  assert.deepEqual(game.simulation.ship, spike.ship);
  assert.deepEqual(game.simulation.bodies, spike.bodies);
  assert.equal(Object.isFrozen(game.scenario.ship), true);
  assert.throws(() => { game.scenario.ship.x = 0; }, TypeError);
  game.simulation.ship.x = 20;
  game.simulation.bodies[0].x = 10;
  assert.equal(SPIKE_SCENARIO.ship.x, -700);
  assert.equal(SPIKE_SCENARIO.bodies[0].x, 0);
  assert.equal(createGame().simulation.ship.x, -700);
});

test('Play запускает готовые условия; Reset сохраняет расстановку и восстанавливает полёт', () => {
  const game = createGame();
  const original = physicalState(game);
  advanceFrame(game.simulation, game.scenario.physics, 0.02);
  assert.deepEqual(physicalState(game), original, 'Before Play nothing moves');
  assert.equal(placeBody(game, 'planet', -350, -140), true);
  assert.equal(placeBody(game, 'planet', -300, -200), false);
  const configuration = clone(game.configuration);
  const initial = physicalState(game);
  assert.equal(startGame(game), true);
  for (let i = 0; i < 20; i++) advanceFrame(game.simulation, game.scenario.physics, 1 / 60);
  assert.notDeepEqual(physicalState(game), initial);
  assert.deepEqual(game.configuration, configuration);
  assert.equal(moveBody(game, 'planet', -310, -120), false, 'No edits during flight');
  const camera = { x: 50, y: -80, zoom: 1.5, follow: true };
  Object.assign(game.camera, camera);
  resetGame(game);
  assert.deepEqual(physicalState(game), initial);
  assert.deepEqual(game.configuration, configuration);
  assert.deepEqual(game.camera, { ...camera, follow: false });
  assert.equal(moveBody(game, 'planet', 0, 0), false);
  assert.deepEqual(game.configuration, configuration, 'Invalid move preserves placement');
  assert.equal(moveBody(game, 'planet', -310, -120), true);
  assert.equal(game.configuration.placed[0].x, -310);
  assert.equal(removeBody(game, 'planet'), true);
  assert.equal(game.configuration.placed.length, 0);
  assert.deepEqual(physicalState(game), original);
});

for (const placements of [[], [{ type: 'planet', x: -350, y: -140 }]]) {
  test(`физика совпадает со Spike до первого контакта на фиксированных шагах (${placements.length} добавленных тел)`, () => {
    const game = createGame(), reference = referenceSpike(placements);
    for (const p of placements) placeBody(game, p.type, p.x, p.y);
    startGame(game); reference.start();
    for (let i = 0; i < 800 && game.simulation.status === 'running'; i++) {
      const dt = game.scenario.physics.maxStep;
      reference.step(dt);
      stepSimulation(game.simulation, game.scenario.physics, dt);
      const expected = reference.snapshot();
      if (game.simulation.status === 'collision') {
        assert.equal(expected.running, false);
        assert.ok(game.simulation.time <= expected.simT + 1e-12);
        assert.ok(expected.simT - game.simulation.time <= dt + 1e-12);
        const body = game.simulation.bodies.find(b => b.id === game.simulation.collisionId);
        assert.ok(Math.abs(Math.hypot(game.simulation.ship.x - body.x,
          game.simulation.ship.y - body.y) - game.simulation.ship.r - body.r) < 1e-10);
        break;
      }
      assert.deepEqual(game.simulation.ship, expected.ship);
      assert.deepEqual(game.simulation.bodies, expected.bodies);
      assert.ok(Math.abs(game.simulation.time - expected.simT) < 1e-12);
      assert.equal(game.simulation.status === 'running', expected.running);
    }
  });
}

test('камера и отрисовка не изменяют расстановку или физическое состояние', () => {
  const game = createGame();
  placeBody(game, 'giant', -350, -140);
  const before = clone({ configuration: game.configuration, simulation: game.simulation, scenario: game.scenario });
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; } });
  const renderer = createRenderer({ getContext: () => ctx }, {
    getBoundingClientRect: () => ({ width: 390, height: 694 }),
  });
  renderer.resize();
  for (const zoom of [0.22, 0.72, 2.8]) {
    zoomAt(game.camera, renderer.viewport, { x: 100, y: 200 }, zoom);
    game.camera.follow = true;
    followShip(game.camera, game.simulation.ship);
    renderer.draw(game, { drag: { kind: 'existing', type: 'giant', id: 'user_giant', x: 20, y: 40 } });
    const screen = worldToScreen(game.camera, renderer.viewport, 100, -50);
    const world = screenToWorld(game.camera, renderer.viewport, screen.x, screen.y);
    assert.ok(Math.abs(world.x - 100) < 1e-10 && Math.abs(world.y + 50) < 1e-10);
  }
  assert.deepEqual({ configuration: game.configuration, simulation: game.simulation, scenario: game.scenario }, before);
});


test('предпросмотр нового и установленного тела показывает допустимость цветом и знаком', () => {
  const game = createGame(); placeBody(game, 'giant', -350, -140);
  const before = clone({ simulation: game.simulation, configuration: game.configuration });
  const text = [];
  const ctx = new Proxy({ fillText(value) { text.push({ value, colour: this.fillStyle }); } }, {
    get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const renderer = createRenderer({ getContext: () => ctx }, { getBoundingClientRect: () => ({ width: 390, height: 694 }) });
  renderer.resize();
  for (const kind of ['new', 'existing']) {
    for (const [x, y, sign] of [[-350, -250, '✓'], [0, 0, '×']]) {
      text.length = 0;
      renderer.draw(game, { drag: { kind, type: kind === 'new' ? 'planet' : 'giant',
        ...(kind === 'existing' ? { id: 'user_giant' } : {}), x, y } });
      const mark = text.find(t => t.value === sign);
      assert.ok(mark, `${kind} ${sign}`);
      assert.equal(mark.colour, sign === '✓' ? '#d7deff' : '#ff899b');
    }
  }
  assert.deepEqual({ simulation: game.simulation, configuration: game.configuration }, before);
});
