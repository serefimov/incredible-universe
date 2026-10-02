import assert from 'node:assert/strict';
import test from 'node:test';
import { clockIncrement, CLOCK_PROPOSAL, runWitness } from '../tools/experiments/two-clocks.mjs';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected} within ${tolerance}`);

test('предложение часов: покой, 0.6c, 0.8c, порог 300/100 и 0.95c', () => {
  for (const [beta, expected] of [[0, 300], [0.6, 240], [0.8, 180],
    [Math.sqrt(8 / 9), 100], [0.95, 93.67496997597597]]) {
    const value = clockIncrement(beta * CLOCK_PROPOSAL.lightSpeed, 0, 3);
    assert.equal(value.earth, 300); near(value.ship, expected);
  }
  assert.deepEqual(clockIncrement(600, 0, 0.25), clockIncrement(0, -600, 0.25));
  assert.deepEqual(clockIncrement(0, 0, 0), { earth: 0, ship: 0 });
});

test('c и сверхсветовая скорость отклоняются без скрытого ограничения', () => {
  for (const speed of [1000, 1001, Infinity, NaN]) assert.throws(() => clockIncrement(speed, 0, 1), RangeError);
  for (const dt of [-1, Infinity, NaN]) assert.throws(() => clockIncrement(1, 0, dt), RangeError);
  assert.throws(() => clockIncrement(1, 0, 1, { lightSpeed: 0, yearsPerUnit: 100 }), RangeError);
  assert.throws(() => clockIncrement(1, 0, 1, { lightSpeed: 1000, yearsPerUnit: -1 }), RangeError);
});

test('собственное время положительно и не превышает земное в допустимом движении', () => {
  for (const beta of [0, 0.2, 0.8, 0.98, 1 - Number.EPSILON]) {
    const dt = clockIncrement(beta * 1000, 0, 0.0025);
    assert.ok(dt.ship > 0 && dt.ship <= dt.earth);
  }
});

test('контрольный орбитальный полёт возвращается после 300 лет раньше 100 лет корабля', () => {
  const result = runWitness();
  assert.equal(result.temporalPass, true);
  assert.equal(result.fixtureReturnPass, true);
  assert.equal(result.returns, 6);
  near(result.earthYears, 350.75);
  near(result.shipYears, 88.1281056746, 1e-8);
  assert.ok(result.maxSpeed < 980 && result.collisionClearance > 53);
  const refined = runWitness({ step: 0.00125 });
  assert.equal(refined.temporalPass, true);
  assert.equal(refined.fixtureReturnPass, true);
  // Sensitivity check on this fixture, not a universal error bound.
  assert.ok(Math.abs(result.earthYears - refined.earthYears) < 1);
  assert.ok(Math.abs(result.shipYears - refined.shipYears) < 1);
});

test('ускорение воспроизведения не меняет контрольную физику или часы', () => {
  const slow = runWitness({ playbackScale: 0.1 }), fast = runWitness({ playbackScale: 2.5 });
  delete slow.playbackScale; delete fast.playbackScale;
  assert.deepEqual(slow, fast);
});
