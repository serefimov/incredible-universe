import assert from 'node:assert/strict';
import test from 'node:test';
import { SPIKE_SCENARIO } from '../src/scenario.js';
import { createGame, startGame, resetGame, placeBody, moveBody, removeBody } from '../src/state.js';
import { stepSimulation } from '../src/physics.js';

function longFlightScenario() {
  const scenario = structuredClone(SPIKE_SCENARIO);
  scenario.physics.gravity = 1;
  scenario.ship = { ...scenario.ship, x: 10000, y: 10000, vx: 10, vy: 0 };
  scenario.earthClock = { x: 10000, y: 10000, vx: 0, vy: 0 };
  scenario.bodies = [
    { id: 'centre', type: 'fixedStar', label: 'Центр', x: 0, y: 0, vx: 0, vy: 0, m: 100000, r: 10, fixed: true },
    { id: 'orbiter', type: 'fixedPlanet', label: 'Орбита', x: 300, y: 0, vx: 0, vy: 10, m: 100, r: 5, fixed: false },
  ];
  return scenario;
}
const snapshot = game => structuredClone({ simulation: game.simulation, configuration: game.configuration, camera: game.camera });

test('после длительного полёта Reset возвращает стартовые позиции и скорости, очищает все данные попытки', () => {
  const scenario = longFlightScenario(), game = createGame(scenario);
  assert.equal(placeBody(game, 'planet', 1000, 0), true);
  assert.equal(placeBody(game, 'giant', 1500, 500), true);
  const initial = snapshot(game), initialBodies = structuredClone(game.simulation.bodies);
  const configuration = game.configuration;
  startGame(game);
  for (let i = 0; i < 8000; i++) stepSimulation(game.simulation, scenario.physics);
  assert.equal(game.simulation.status, 'running');
  assert.equal(game.simulation.time, 20);
  assert.notEqual(game.simulation.bodies.find(b => b.id === 'user_planet').x, 1000);
  assert.notEqual(game.simulation.bodies.find(b => b.id === 'user_planet').vx, 0);
  assert.ok(game.simulation.earthYears > 1900 && game.simulation.shipYears > 1900);
  assert.ok(game.simulation.trail.length > 100);
  Object.assign(game.simulation, { status: 'collision', collisionId: 'centre', collisionFraction: 0.5,
    accumulator: 0.001, error: 'test-error', result: { outcome: 'lose', reason: 'collision' } });
  Object.assign(game.camera, { x: 500, y: 700, zoom: 1.5, follow: true });
  const oldSimulation = game.simulation;
  resetGame(game);
  assert.equal(game.configuration, configuration);
  assert.deepEqual(game.configuration, initial.configuration);
  assert.deepEqual(game.simulation.bodies, initialBodies);
  assert.deepEqual(game.simulation.ship, initial.simulation.ship);
  assert.deepEqual(game.simulation.earthObserver, initial.simulation.earthObserver);
  for (const key of ['time', 'steps', 'accumulator', 'earthYears', 'shipYears', 'earthCorrection', 'shipCorrection']) assert.equal(game.simulation[key], 0, key);
  for (const key of ['collisionId', 'collisionFraction', 'error', 'result']) assert.equal(game.simulation[key], null, key);
  assert.deepEqual(game.simulation.trail, []); assert.equal(game.simulation.status, 'ready');
  assert.deepEqual(game.camera, { x: 500, y: 700, zoom: 1.5, follow: false });
  oldSimulation.ship.x = -999; oldSimulation.bodies[2].x = -999;
  assert.equal(game.simulation.bodies.find(b => b.id === 'user_planet').x, 1000);
  assert.equal(game.simulation.ship.x, 10000);
});

for (const status of ['running', 'collision', 'error', 'win', 'lose']) {
  test(`редактирование заблокировано в ${status}; Reset снова открывает расстановку`, () => {
    const game = createGame(); placeBody(game, 'planet', -350, -140);
    game.simulation.status = status;
    // Win/Lose are future #9 contract fixtures, not a mission evaluator.
    game.simulation.result = { outcome: status, values: { earth: 42, ship: 12 } };
    const before = snapshot(game);
    assert.equal(placeBody(game, 'giant', -500, -100), false);
    assert.equal(moveBody(game, 'planet', -310, -120), false);
    assert.equal(removeBody(game, 'planet'), false);
    assert.deepEqual(snapshot(game), before);
    resetGame(game);
    assert.equal(game.simulation.result, null);
    assert.equal(moveBody(game, 'planet', -310, -120), true);
    assert.equal(startGame(game), true);
  });
}

test('некорректная правка не сбрасывает состояние, камеру и расстановку', () => {
  const game = createGame(); placeBody(game, 'planet', -350, -140);
  game.camera.follow = true;
  const before = snapshot(game), simulation = game.simulation;
  for (const [x, y] of [[0, 0], [NaN, 20], [10, Infinity]]) {
    assert.equal(moveBody(game, 'planet', x, y), false);
    assert.equal(placeBody(game, 'giant', x, y), false);
    assert.deepEqual(snapshot(game), before);
    assert.equal(game.simulation, simulation);
  }
});

test('правка применяется в следующем полёте, удалённое тело больше не влияет на него', () => {
  const fly = game => { startGame(game); for (let i = 0; i < 100; i++) stepSimulation(game.simulation, game.scenario.physics); return structuredClone(game.simulation); };
  const edited = createGame(), fresh = createGame();
  placeBody(edited, 'planet', -350, -140); moveBody(edited, 'planet', -310, -120);
  placeBody(fresh, 'planet', -310, -120);
  assert.deepEqual(fly(edited), fly(fresh));
  resetGame(edited); removeBody(edited, 'planet');
  assert.deepEqual(fly(edited), fly(createGame()));
});

test('повторяемый цикл завершение → Reset → правка → Play очищает результаты и часы', () => {
  const game = createGame(); placeBody(game, 'planet', -350, -140);
  for (let cycle = 0; cycle < 6; cycle++) {
    startGame(game);
    for (let i = 0; i < 30; i++) stepSimulation(game.simulation, game.scenario.physics);
    assert.ok(game.simulation.shipYears > 0);
    game.simulation.status = cycle % 2 ? 'win' : 'lose';
    game.simulation.result = { outcome: game.simulation.status, reason: 'fixture' };
    resetGame(game);
    assert.equal(game.simulation.result, null); assert.equal(game.simulation.earthYears, 0);
    const x = cycle % 2 ? -350 : -310;
    assert.equal(moveBody(game, 'planet', x, -140), true);
    assert.equal(game.simulation.bodies.find(b => b.id === 'user_planet').x, x);
  }
  assert.equal(startGame(game), true);
});

test('сценарий с двумя телами одного типа сохраняет разные ID и редактирует выбранное', () => {
  const scenario = longFlightScenario(); scenario.tray.planet.count = 2;
  const game = createGame(scenario);
  placeBody(game, 'planet', 1000, 0); placeBody(game, 'planet', 1500, 500);
  const [first, second] = game.configuration.placed;
  assert.notEqual(first.id, second.id);
  assert.deepEqual(game.simulation.bodies.filter(b => b.user).map(b => b.id), [first.id, second.id]);
  assert.equal(moveBody(game, 'planet', 1700, 500, second.id), true);
  assert.equal(game.configuration.placed[0].x, 1000);
  assert.equal(game.configuration.placed[1].x, 1700);
  resetGame(game); removeBody(game, 'planet', second.id);
  assert.deepEqual(game.configuration.placed.map(p => p.id), [first.id]);
});
