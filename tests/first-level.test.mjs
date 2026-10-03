import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createGameFromLevel, placeBody, moveBody, removeBody, resetGame, startGame } from '../src/state.js';
import { advanceFrame } from '../src/physics.js';
import { loadTrainingPlan } from '../src/levels.js';
import { earthClockBody } from '../src/clock-display.js';

const data = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url)));
const level = data.find(level => level.id === 'training-1');
function flight(game, schedule = [0.01]) {
  assert.equal(startGame(game), true);
  let clearance = Infinity;
  for (let frame = 0; game.simulation.status === 'running'; frame++) {
    assert.ok(frame < 4000, 'finite level attempt');
    advanceFrame(game.simulation, game.scenario.physics, schedule[frame % schedule.length]);
    for (const body of game.simulation.bodies) clearance = Math.min(clearance,
      Math.hypot(game.simulation.ship.x - body.x, game.simulation.ship.y - body.y) - game.simulation.ship.r - body.r);
  }
  return clearance;
}
function solved(x = -110, y = -120) {
  const game = createGameFromLevel(level, { tutorial: false });
  assert.equal(placeBody(game, 'planet', x, y), true);
  return game;
}

test('Первое вмешательство: без планеты реальное столкновение, с одной планетой реальная победа', () => {
  const baseline = createGameFromLevel(level); flight(baseline);
  assert.equal(baseline.simulation.status, 'lose');
  assert.equal(baseline.simulation.result.reason, 'collision');
  assert.equal(baseline.simulation.collisionId, 'helios');
  assert.ok(Math.abs(baseline.simulation.time - 3.05325427874563) < 1e-10);
  const game = solved(); flight(game);
  assert.equal(game.configuration.placed.length, 1);
  assert.equal(game.simulation.status, 'win');
  assert.equal(game.simulation.result.reason, 'survived');
  assert.ok(Math.abs(game.simulation.shipYears - 500) < 1e-8);
  assert.equal(earthClockBody(game), null);
});

test('соседние размещения: 234 положения на сетке 5 мир. ед. над и под курсом выигрывают', () => {
  let minimum = Infinity, count = 0;
  for (const sign of [-1, 1]) for (let x = -140; x <= -80; x += 5) for (let y = 100; y <= 140; y += 5) {
    const game = solved(x, sign * y);
    minimum = Math.min(minimum, flight(game)); count++;
    assert.equal(game.simulation.status, 'win', `${x},${sign*y}`);
  }
  assert.equal(count, 234);
  assert.ok(minimum > 11, `sampled surface clearance ${minimum}`);
});

test('решение и контрольное столкновение не зависят от кадров; Reset, перенос и удаление воспроизводят цикл', () => {
  for (const placement of [false, true]) {
    let expected;
    for (const schedule of [[1/30], [1/60], [1/120], [0.008,0.017,0.033,0.012]]) {
      const game = placement ? solved() : createGameFromLevel(level);
      flight(game, schedule);
      expected ??= structuredClone(game.simulation);
      assert.deepEqual(game.simulation, expected);
    }
  }
  const game = solved(), initial = structuredClone(game.configuration); flight(game);
  resetGame(game); assert.deepEqual(game.configuration, initial); assert.equal(game.simulation.shipYears, 0);
  assert.equal(placeBody(game, 'planet', -80, -100), false, 'exactly one available planet');
  assert.equal(moveBody(game, 'planet', 0, 0), false, 'outside placement regions');
  assert.equal(moveBody(game, 'planet', -105, -120), true); flight(game); assert.equal(game.simulation.status, 'win');
  resetGame(game); assert.equal(removeBody(game, 'planet'), true); flight(game); assert.equal(game.simulation.result.reason, 'collision');
  resetGame(game); assert.equal(placeBody(game, 'planet', -110, -120), true); flight(game); assert.equal(game.simulation.status, 'win');
});

test('план ссылается на готовые данные и содержит оба этапа обучения', () => {
  const examples = JSON.parse(readFileSync(new URL('../levels/mission-examples.json', import.meta.url)));
  const input = JSON.parse(readFileSync(new URL('../levels/training-plan.json', import.meta.url)));
  const plan = loadTrainingPlan(input, examples, data);
  assert.equal(plan.levels[0].campaignLevel, 'training-1');
  const [observe, intervene] = level.tutorial.steps;
  assert.equal(observe.until, 'collision'); assert.equal(observe.availableCounts.planet, 0);
  assert.equal(intervene.until, 'success'); assert.equal(intervene.availableCounts.planet, 1);
  assert.equal(level.tutorial.showFutureTrajectory, false);
  input.levels[0].campaignLevel = 'missing';
  assert.throws(() => loadTrainingPlan(input, examples, data), /campaignLevel/);
});
