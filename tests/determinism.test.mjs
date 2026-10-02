import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, startGame, resetGame, placeBody, moveBody, removeBody } from '../src/state.js';
import { advanceFrame, stepSimulation, collisionFraction, discardFrameTime } from '../src/physics.js';

const physical = s => ({ error: s.error, earthYears: s.earthYears, shipYears: s.shipYears, earthObserver: s.earthObserver,
  earthCorrection: s.earthCorrection, shipCorrection: s.shipCorrection, ship: s.ship, bodies: s.bodies, time: s.time, steps: s.steps,
  trail: s.trail, status: s.status, collisionId: s.collisionId, collisionFraction: s.collisionFraction });
const snapshot = game => structuredClone(physical(game.simulation));
const schedules = [[1 / 30], [1 / 60], [1 / 120], [0.008, 0.017, 0.033, 0.012], [0.5, 0.001, 0.007]];
function run(game, schedule, ticks = null) {
  startGame(game);
  let frame = 0;
  while (game.simulation.status === 'running' && (ticks === null || game.simulation.steps < ticks)) {
    let seconds = schedule[frame++ % schedule.length];
    if (ticks !== null) seconds = Math.min(seconds,
      Math.max(0, ((ticks - game.simulation.steps) * game.scenario.physics.maxStep -
        game.simulation.accumulator) / game.scenario.physics.timeScale));
    advanceFrame(game.simulation, game.scenario.physics, seconds);
    assert.ok(frame < 10000, 'run must terminate');
  }
  return snapshot(game);
}

for (const placements of [[], [['planet', -350, -140]], [['star', -450, -100], ['giant', 200, 200]]]) {
  for (const ticks of [500, null]) {
    test(`одинаковое состояние при всех расписаниях: ${placements.length} тел, ${ticks ?? 'столкновение'}`, () => {
      const results = schedules.map(schedule => {
        const game = createGame();
        for (const p of placements) assert.equal(placeBody(game, ...p), true);
        return run(game, schedule, ticks);
      });
      for (const result of results) assert.deepEqual(result, results[0]);
      if (ticks === null) {
        assert.equal(results[0].status, placements.length === 2 ? 'error' : 'collision');
        if (placements.length === 2) assert.match(results[0].error, /меньше c/);
      }
    });
  }
}

test('Reset, новая игра и камера не меняют повтор; правка и удаление меняют старт', () => {
  const game = createGame();
  placeBody(game, 'planet', -350, -140);
  const expected = run(game, schedules[0]);
  for (const schedule of schedules) {
    Object.assign(game.camera, { x: 1e8, y: -50, zoom: 2.8 });
    resetGame(game);
    assert.equal(game.simulation.accumulator, 0);
    assert.equal(game.simulation.steps, 0);
    assert.deepEqual(run(game, schedule), expected);
  }
  const reopened = createGame();
  placeBody(reopened, 'planet', -350, -140);
  assert.deepEqual(run(reopened, schedules[2]), expected);
  resetGame(game);
  assert.equal(moveBody(game, 'planet', -300, -200), true);
  assert.notDeepEqual(run(game, schedules[1]), expected);
  resetGame(game);
  assert.equal(removeBody(game, 'planet'), true);
  assert.deepEqual(run(game, schedules[1]), run(createGame(), schedules[1]));
});

test('неполный шаг сохраняется, длинный кадр ограничен, фон не догоняется', () => {
  const game = createGame(), { simulation: s, scenario: { physics: model } } = game;
  startGame(game);
  advanceFrame(s, model, 0.0004);
  assert.equal(s.steps, 0);
  advanceFrame(s, model, 0.0006);
  assert.equal(s.steps, 1);
  advanceFrame(s, model, 10);
  assert.equal(s.steps, 51);
  advanceFrame(s, model, 0.0005);
  discardFrameTime(s);
  const before = snapshot(game);
  // Browser skips hidden frames and clears the clock at visibility changes.
  discardFrameTime(s);
  assert.deepEqual(snapshot(game), before);
  advanceFrame(s, model, 0.0005);
  assert.equal(s.steps, 51);
  advanceFrame(s, model, 0.0005);
  assert.equal(s.steps, 52);
});

const body = (id, x, y, vx = 0, fixed = true) => ({ id, x, y, vx, vy: 0, m: 0, r: 1, fixed });
function crossing(bodies, ship = body('ship', -10, 0, 800, false)) {
  const game = createGame();
  game.simulation.ship = ship;
  game.simulation.bodies = bodies;
  const model = { ...game.scenario.physics, gravity: 0, maxStep: 0.025 };
  startGame(game);
  stepSimulation(game.simulation, model);
  return game.simulation;
}

test('быстрый корабль пересекает неподвижное тело и останавливается в первом контакте', () => {
  const s = crossing([body('target', 0, 0)]);
  assert.equal(s.status, 'collision');
  assert.equal(s.collisionId, 'target');
  assert.ok(Math.abs(s.ship.x + 2) < 1e-12);
  assert.ok(Math.abs(s.time - 0.01) < 1e-15);
  assert.equal(s.trail.at(-1).x, s.ship.x);
});

test('учитывает движение тела, даже если корабль неподвижен', () => {
  const s = crossing([body('moving', -10, 0, 800, false)], body('ship', 0, 0, 0, false));
  assert.equal(s.status, 'collision');
  assert.ok(Math.abs(s.bodies[0].x + 2) < 1e-12);
});

test('первое событие выбирается по времени, равные — по порядку тел', () => {
  const s = crossing([body('later', 5, 0), body('first', 0, 0), body('tie', 0, 0)]);
  assert.equal(s.collisionId, 'first');
  assert.equal(crossing([body('tie', 0, 0), body('first', 0, 0)]).collisionId, 'tie');
});

test('близкий пролёт и касание не считаются столкновением; проникновение считается', () => {
  for (const y of [2, 2.000001]) assert.equal(crossing([body('target', 0, y)]).status, 'running');
  assert.equal(crossing([body('target', 0, 1.999999)]).status, 'collision');
  assert.equal(crossing([body('target', -10, 0)]).collisionFraction, 0);
  assert.equal(crossing([body('target', -8, 0)]).collisionFraction, 0);
  assert.equal(crossing([body('target', -12, 0)]).status, 'running', 'moving away from contact');
  assert.equal(crossing([body('target', 12, 0)]).status, 'running', 'endpoint contact only');
  assert.equal(collisionFraction(body('ship', 0, 0), body('ship', 0, 0),
    body('target', 4, 0), body('target', 4, 0)), null);
});

test('NaN, Infinity, неверный шаг и переполнение дают ошибку, а не поражение', () => {
  for (const seconds of [NaN, Infinity, -Infinity]) {
    const game = createGame(); startGame(game);
    const before = structuredClone(game.simulation.ship);
    advanceFrame(game.simulation, game.scenario.physics, seconds);
    assert.equal(game.simulation.status, 'error');
    assert.equal(game.simulation.collisionId, null);
    assert.deepEqual(game.simulation.ship, before);
    resetGame(game); assert.equal(startGame(game), true);
  }
  const game = createGame(); startGame(game);
  game.simulation.ship.vx = Number.MAX_VALUE;
  const before = structuredClone(game.simulation.ship);
  stepSimulation(game.simulation, { ...game.scenario.physics, maxStep: 10 });
  assert.equal(game.simulation.status, 'error');
  assert.deepEqual(game.simulation.ship, before);
  const invalid = createGame(); startGame(invalid);
  stepSimulation(invalid.simulation, invalid.scenario.physics, 0.001);
  assert.equal(invalid.simulation.status, 'error');
});

test('остановленное столкновение не продвигается; Reset разрешает новый полёт', () => {
  const game = createGame(); run(game, schedules[1]);
  const before = snapshot(game);
  advanceFrame(game.simulation, game.scenario.physics, 1);
  assert.deepEqual(snapshot(game), before);
  assert.equal(startGame(game), false);
  resetGame(game); assert.equal(startGame(game), true);
});
