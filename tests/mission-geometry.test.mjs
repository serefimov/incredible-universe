import assert from 'node:assert/strict';
import test from 'node:test';
import { targetInterval, inRange } from '../src/mission-geometry.js';

const point = (x, y = 0) => ({ x, y });

test('цель: полный быстрый проход между концами шага и движущийся центр', () => {
  assert.deepEqual(targetInterval(point(-10), point(10), point(0), point(0), 2), [0.4, 0.6]);
  assert.deepEqual(targetInterval(point(-10), point(10), point(-4), point(4), 3), [0.25, 0.75]);
  assert.equal(targetInterval(point(-10, 4), point(10, 4), point(0), point(0), 2), null);
});

test('цель: граница, касание, нахождение внутри и неподвижное относительное положение', () => {
  assert.deepEqual(targetInterval(point(-10, 2), point(10, 2), point(0), point(0), 2), [0.5, 0.5]);
  assert.deepEqual(targetInterval(point(2), point(2), point(0), point(0), 2), [0, 1]);
  assert.deepEqual(targetInterval(point(1), point(1), point(0), point(0), 2), [0, 1]);
  assert.equal(targetInterval(point(2.0001), point(2.0001), point(0), point(0), 2), null);
});

test('границы времени 300/100 и скорости включены без округления интерфейса', () => {
  for (const [value, range, expected] of [[299.999999, {min:300}, false], [300, {min:300}, true],
    [300.000001, {min:300}, true], [99.999999, {max:100}, true], [100, {max:100}, true],
    [100.000001, {max:100}, false], [5,{min:5,max:10},true], [10,{min:5,max:10},true],
    [4.99999,{min:5,max:10},false], [10.00001,{min:5,max:10},false]]) {
    assert.equal(inRange(value,range),expected);
  }
});
