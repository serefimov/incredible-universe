import assert from 'node:assert/strict';
import test from 'node:test';
import { clockIncrement, clockRate, potentialAt, CLOCK_CONTRACT, runWitness } from '../tools/experiments/two-clocks.mjs';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected} within ${tolerance}`);

test('контракт часов: покой, 0.6c, 0.8c, порог 300/100 и 0.95c', () => {
  for (const [beta, expected] of [[0, 300], [0.6, 240], [0.8, 180],
    [Math.sqrt(8 / 9), 100], [0.95, 93.67496997597597]]) {
    const value = clockIncrement(beta * CLOCK_CONTRACT.lightSpeed, 0, 3);
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

test('в нулевом поле время корабля положительно и не превышает время неподвижной Земли', () => {
  for (const beta of [0, 0.2, 0.8, 0.98, 1 - Number.EPSILON]) {
    const dt = clockIncrement(beta * 1000, 0, 0.0025);
    assert.ok(dt.ship > 0 && dt.ship <= dt.earth);
  }
});

test('контрольный орбитальный полёт возвращается после 300 лет раньше 100 лет корабля', () => {
  const result = runWitness();
  assert.equal(result.temporalPass, true);
  assert.equal(result.fixtureReturnPass, true);
  assert.equal(result.returns, 14);
  near(result.earthYears, 311.9701559784945);
  near(result.shipYears, 78.64699803094082, 1e-8);
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


test('гравитация замедляет неподвижные часы относительно удалённых земных часов', () => {
  const value = clockIncrement(0, 0, 3, CLOCK_CONTRACT,
    { shipPotential: -1200000, earthPotential: 0 });
  near(value.earth, 300);
  near(value.ship, 300 * Math.exp(-1.2));
  assert.ok(value.ship < 100, 'gravity alone changes the clock ratio');
});

test('одинаковое поле замедляет оба счётчика одинаково; скорость действует дополнительно', () => {
  const rest = clockIncrement(0, 0, 3, CLOCK_CONTRACT,
    { shipPotential: -400000, earthPotential: -400000 });
  assert.equal(rest.ship, rest.earth);
  near(rest.earth, 300 * Math.exp(-0.4));
  const moving = clockIncrement(600, 0, 3, CLOCK_CONTRACT,
    { shipPotential: -400000, earthPotential: -400000 });
  near(moving.ship / moving.earth, 0.8);
});

test('более слабое поле может дать кораблю больше лет, чем Земле', () => {
  const value = clockIncrement(0, 0, 3, CLOCK_CONTRACT,
    { shipPotential: -100000, earthPotential: -400000 });
  assert.ok(value.ship > value.earth);
  near(value.ship / value.earth, Math.exp(0.3));
});

test('замедление от поля и скорости перемножается для обоих наблюдателей', () => {
  const value = clockIncrement(600, 0, 3, CLOCK_CONTRACT,
    { shipPotential: -400000, earthPotential: -100000, earthVx: 800 });
  near(value.ship, 300 * Math.exp(-0.4) * 0.8);
  near(value.earth, 300 * Math.exp(-0.1) * 0.6);
});

test('потенциал всех тел даёт прежнее ускорение при дифференцировании', async () => {
  const { acceleration } = await import('../src/physics.js');
  const model = { gravity: 7200, softening: 16 };
  const bodies = [{ x: 5, y: -10, m: 3000 }, { x: -70, y: 80, m: 500 }];
  const point = { x: 30, y: 20 }, h = 0.0001;
  const numericX = -(potentialAt({ x: point.x + h, y: point.y }, bodies, model) -
    potentialAt({ x: point.x - h, y: point.y }, bodies, model)) / (2 * h);
  const numericY = -(potentialAt({ x: point.x, y: point.y + h }, bodies, model) -
    potentialAt({ x: point.x, y: point.y - h }, bodies, model)) / (2 * h);
  const actual = acceleration(point, bodies, model);
  near(numericX, actual.ax, 1e-6); near(numericY, actual.ay, 1e-6);
  near(potentialAt({ x: 5, y: -10 }, [bodies[0]], model), -7200 * 3000 / 16);
  near(potentialAt(point, [], model), 0);
});

test('поле берётся из мировых координат и текущих тел, камера в расчёте не участвует', () => {
  const model = { gravity: 7200, softening: 16 };
  const bodies = [{ x: 0, y: 0, m: 3000 }];
  const point = { x: 100, y: 0 };
  const initial = potentialAt(point, bodies, model);
  assert.equal(potentialAt({ ...point, camera: { x: 1e8, zoom: 2.8 } }, bodies, model), initial);
  assert.ok(potentialAt(point, [{ ...bodies[0], x: 90 }], model) < initial);
  assert.equal(potentialAt(point, [], model), 0);
});

test('ошибочное поле и исчезающее из-за underflow время отклоняются без обрезки', () => {
  for (const phi of [NaN, Infinity, -Infinity, 1, -1e12]) {
    assert.throws(() => clockRate(0, 0, phi), RangeError);
  }
  assert.throws(() => clockIncrement(0, 0, 1, CLOCK_CONTRACT, { earthVx: 1000 }), RangeError);
  assert.throws(() => potentialAt({ x: 0, y: 0 }, [{ x: 0, y: 0, m: -1 }],
    { gravity: 7200, softening: 16 }), RangeError);
});
