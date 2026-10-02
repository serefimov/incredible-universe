import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, startGame, resetGame } from '../src/state.js';
import { advanceFrame, stepSimulation } from '../src/physics.js';
import { CLOCK_CONTRACT, clockIncrement, potentialAt } from '../src/clocks.js';
import { witnessScenario } from '../tools/experiments/two-clocks.mjs';

const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const object = (id, x, vx = 0, m = 0, r = 0) => ({ id, x, y: 0, vx, vy: 0, m, r, fixed: false });
function fixture({ ship = object('ship', 0), bodies = [], earthClock = { x: 1000, y: 0, vx: 0, vy: 0 }, gravity = 0 } = {}) {
  const scenario = { id: 'clock-fixture', physics: { gravity, softening: 16,
    maxStep: 0.0025, timeScale: 2.5, maxFrame: 0.05 }, camera: { x: 0, y: 0, zoom: 1 },
    tray: {}, bodies, ship, earthClock };
  const game = createGame(scenario); startGame(game); return game;
}
const immutableStep = s => structuredClone({ ship: s.ship, bodies: s.bodies,
  earthObserver: s.earthObserver, time: s.time, steps: s.steps, trail: s.trail,
  earthYears: s.earthYears, shipYears: s.shipYears, earthCorrection: s.earthCorrection,
  shipCorrection: s.shipCorrection });

test('игровые часы проходят аналитические примеры и монотонны на каждом шаге', () => {
  for (const [speed, years] of [[0, 300], [600, 240], [800, 180], [950, 93.674969975976]]) {
    const game = fixture({ ship: object('ship', 0, speed) });
    for (let tick = 0; tick < 1200; tick++) {
      const before = [game.simulation.earthYears, game.simulation.shipYears];
      stepSimulation(game.simulation, game.scenario.physics);
      assert.equal(game.simulation.status, 'running');
      assert.ok(game.simulation.earthYears > before[0]);
      assert.ok(game.simulation.shipYears > before[1]);
    }
    near(game.simulation.earthYears, 300); near(game.simulation.shipYears, years);
    assert.equal(game.simulation.clockVersion, CLOCK_CONTRACT.version);
    assert.equal(Object.isFrozen(CLOCK_CONTRACT), true);
  }
});

test('гравитационное замедление входит в настоящую симуляцию при неподвижном корабле', () => {
  // At the softened centre acceleration is zero; potential is finite and negative.
  const centre = { ...object('centre', 0, 0, 400000 * 16 / 7200), fixed: true };
  const game = fixture({ gravity: 7200, bodies: [centre] });
  for (let tick = 0; tick < 1200; tick++) stepSimulation(game.simulation, game.scenario.physics);
  assert.equal(game.simulation.status, 'running');
  near(game.simulation.ship.x, 0);
  near(game.simulation.shipYears, 300 * Math.exp(-0.4));
  const earthDepth = 7200 * centre.m / Math.hypot(1000, 16) / 1e6;
  near(game.simulation.earthYears, 300 * Math.exp(-earthDepth));
  assert.ok(game.simulation.shipYears < game.simulation.earthYears);
});

test('земной наблюдатель движется по заданной мировой скорости и имеет свои часы', () => {
  const game = fixture({ earthClock: { x: 1000, y: 0, vx: 600, vy: 0 } });
  for (let tick = 0; tick < 1000; tick++) stepSimulation(game.simulation, game.scenario.physics);
  near(game.simulation.earthObserver.x, 2500);
  near(game.simulation.earthYears, 200); near(game.simulation.shipYears, 250);
  resetGame(game);
  assert.deepEqual(game.simulation.earthObserver, game.scenario.earthClock);
  assert.equal(game.simulation.earthYears, 0); assert.equal(game.simulation.shipYears, 0);
});

test('поле движущихся тел и корабля оценивается в середине пройденного шага', () => {
  const game = fixture({ ship: object('ship', 0, 0, 0, 1),
    bodies: [object('moving', 100, 100, 50000, 1)], gravity: 7200 });
  const before = structuredClone(game.simulation);
  stepSimulation(game.simulation, game.scenario.physics);
  const s = game.simulation;
  assert.equal(s.status, 'running');
  const midpointBodies = [{ ...s.bodies[0], x: (before.bodies[0].x + s.bodies[0].x) / 2 }];
  const midShip = { x: (before.ship.x + s.ship.x) / 2, y: 0 };
  const expected = clockIncrement(s.ship.vx, s.ship.vy, 0.0025, CLOCK_CONTRACT, {
    shipPotential: potentialAt(midShip, midpointBodies, game.scenario.physics),
    earthPotential: potentialAt(s.earthObserver, midpointBodies, game.scenario.physics),
  });
  near(s.shipYears, expected.ship); near(s.earthYears, expected.earth);
  const stale = clockIncrement(s.ship.vx, s.ship.vy, 0.0025, CLOCK_CONTRACT,
    { shipPotential: potentialAt(before.ship, before.bodies, game.scenario.physics) });
  assert.ok(Math.abs(s.shipYears - stale.ship) > 1e-6);
});

test('столкновение начисляет только долю шага обоим часам и земному наблюдателю', () => {
  const game = fixture({ ship: object('ship', -1, 800, 0, 0.1),
    bodies: [{ ...object('target', 0, 0, 0, 0.1), fixed: true }],
    earthClock: { x: 20, y: 0, vx: 300, vy: 0 } });
  stepSimulation(game.simulation, game.scenario.physics);
  const s = game.simulation;
  assert.equal(s.status, 'collision'); near(s.collisionFraction, 0.4);
  near(s.shipYears, 0.06); near(s.earthYears, 0.1 * Math.sqrt(0.91));
  near(s.earthObserver.x, 20.3);
  const stopped = immutableStep(s);
  advanceFrame(s, game.scenario.physics, 1);
  assert.deepEqual(immutableStep(s), stopped);
});

test('контакт в начале шага не начисляет время и не меняет компенсации', () => {
  const game = fixture({ ship: object('ship', 0, 10, 0, 1),
    bodies: [{ ...object('target', 0, 0, 0, 1), fixed: true }] });
  Object.assign(game.simulation, { earthYears: 0.3, shipYears: 0.2,
    earthCorrection: 1e-17, shipCorrection: -1e-17 });
  stepSimulation(game.simulation, game.scenario.physics);
  assert.equal(game.simulation.status, 'collision');
  assert.equal(game.simulation.time, 0);
  assert.equal(game.simulation.earthYears, 0.3); assert.equal(game.simulation.shipYears, 0.2);
  assert.equal(game.simulation.earthCorrection, 1e-17); assert.equal(game.simulation.shipCorrection, -1e-17);
});

test('недопустимая скорость, underflow и наблюдатель откатывают весь расчёт шага', () => {
  const games = [
    fixture({ gravity: 7200, ship: object('ship', -100, 999, 0, 1),
      bodies: [{ ...object('star', 0, 0, 4000, 27), fixed: true }] }),
    fixture({ gravity: 7200, bodies: [
      { ...object('left', -16, 0, 1e9), fixed: true },
      { ...object('right', 16, 0, 1e9), fixed: true }] }),
    fixture({ earthClock: { x: 1000, y: 0, vx: 1000, vy: 0 } }),
  ];
  for (const game of games) {
    const before = immutableStep(game.simulation);
    stepSimulation(game.simulation, game.scenario.physics);
    assert.equal(game.simulation.status, 'error');
    assert.equal(game.simulation.collisionId, null);
    assert.deepEqual(immutableStep(game.simulation), before);
    assert.equal(startGame(game), false);
    resetGame(game); assert.equal(game.simulation.earthYears, 0); assert.equal(game.simulation.shipYears, 0);
  }
});

test('недопустимые счётчики и версия часов не коммитят позиции или время', () => {
  for (const field of [{ earthYears: NaN }, { shipCorrection: Infinity }, { clockVersion: 'unknown' },
    { earthYears: Number.MAX_VALUE }]) {
    const game = fixture({ ship: object('ship', 0, 100) }); Object.assign(game.simulation, field);
    const before = immutableStep(game.simulation);
    stepSimulation(game.simulation, game.scenario.physics);
    assert.equal(game.simulation.status, 'error');
    assert.deepEqual(immutableStep(game.simulation), before);
  }
});

function runToStep(game, schedule, ticks) {
  startGame(game);
  for (let frame = 0; game.simulation.steps < ticks; frame++) {
    assert.ok(frame < 100000);
    const physics = game.scenario.physics;
    const remaining = ((ticks - game.simulation.steps) * physics.maxStep - game.simulation.accumulator) / physics.timeScale;
    advanceFrame(game.simulation, physics, Math.min(schedule[frame % schedule.length], Math.max(0, remaining)));
    assert.equal(game.simulation.status, 'running');
  }
  return immutableStep(game.simulation);
}

test('300/100 в игровом состоянии совпадает при кадрах, камерах, темпе и Reset', () => {
  const schedules = [[1 / 30], [1 / 60], [1 / 120], [0.008, 0.017, 0.033, 0.012], [0.3, 0.01]];
  let expected;
  for (const pace of [0.1, 2.5]) for (const schedule of schedules) {
    const game = createGame(witnessScenario(0.0025, pace));
    Object.assign(game.camera, { x: 1e6, y: -1e6, zoom: 2.8 });
    const result = runToStep(game, schedule, 3275);
    assert.ok(result.earthYears > 300 && result.shipYears < 100);
    near(result.earthYears, 311.9701559784945); near(result.shipYears, 78.64699803094082);
    expected ??= result; assert.deepEqual(result, expected);
    resetGame(game);
    assert.equal(game.simulation.earthYears, 0); assert.equal(game.simulation.shipYears, 0);
    assert.equal(game.simulation.earthCorrection, 0); assert.equal(game.simulation.shipCorrection, 0);
    assert.deepEqual(runToStep(game, schedule, 3275), expected);
  }
});
