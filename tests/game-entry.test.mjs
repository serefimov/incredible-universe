import assert from 'node:assert/strict';
import test from 'node:test';
import { levelFromSearch } from '../src/game-entry.js';

test('свободная сцена остаётся основной; примеры миссий выбираются явным параметром', () => {
  assert.equal(levelFromSearch(''),null);
  assert.equal(levelFromSearch('?mission=missing'),null);
  for (const id of ['example-survival','example-region','example-proper-time','example-speed-time','example-earth-return']) {
    const level=levelFromSearch('?mission='+id);
    assert.ok(level,id);assert.equal(level.purpose,'contract-example');assert.ok(Object.isFrozen(level.mission));
  }
});

test('готовый первый уровень кампании выбирается отдельно от примеров контракта', () => {
  const level = levelFromSearch('?mission=training-1');
  assert.equal(level.purpose, 'campaign');
  assert.equal(level.title, 'Первое вмешательство');
  assert.equal(level.universe.tray.planet.count, 1);
  assert.ok(Object.isFrozen(level.universe));
});
