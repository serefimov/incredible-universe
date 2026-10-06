import assert from 'node:assert/strict';
import test from 'node:test';
import {campaign} from '../tools/check-campaign.mjs';
import {createGameFromLevel, placeBody, startGame, resetGame} from '../src/state.js';
import {stepSimulation, advanceFrame} from '../src/physics.js';
import {clockRate} from '../src/clocks.js';

const final=campaign.find(level=>level.id==='earth-return');
for (const observer of ['ship','earth']) test(`предел скорости ${observer}: Lose до записи недопустимого шага`, () => {
  const level=structuredClone(final);
  if(observer==='ship') Object.assign(level.universe.ship,{vx:-999.999999,vy:0});
  else Object.assign(level.universe.bodies.find(b=>b.id==='earth'),{vx:999.999999,vy:0});
  const g=createGameFromLevel(level);startGame(g);
  const before=structuredClone(g.simulation);
  stepSimulation(g.simulation,g.scenario.physics);
  assert.equal(g.simulation.status,'lose');assert.equal(g.simulation.error,null);
  assert.equal(g.simulation.result.reason,'speed-limit');
  assert.equal(g.simulation.result.speedLimitObserver,observer);
  assert.match(g.simulation.result.message,/предела скорости.*Сброса/);
  for(const key of ['ship','bodies','earthObserver','earthYears','shipYears','steps','time'])
    assert.deepEqual(g.simulation[key],before[key],key);
  assert.ok(clockRate(g.simulation.ship.vx,g.simulation.ship.vy)>0);
});

test('проблемная расстановка финала: обычное поражение, повтор и камера не меняют исход', () => {
  let expected;
  for(const schedule of [[1/30],[1/120],[.008,.033,.017]]) {
    const g=createGameFromLevel(final);assert.ok(placeBody(g,'planet',-4000,1000));
    const configuration=structuredClone(g.configuration);
    for(let attempt=0;attempt<2;attempt++) {
      startGame(g);
      for(let i=0;g.simulation.status==='running';i++) {
        assert.ok(i<10000);g.camera.x+=10;g.camera.zoom=i%2 ? .05 : 1;
        advanceFrame(g.simulation,g.scenario.physics,schedule[i%schedule.length]);
      }
      assert.equal(g.simulation.status,'lose');assert.equal(g.simulation.result.reason,'speed-limit');
      assert.equal(g.simulation.error,null);assert.equal(g.simulation.collisionId,null);
      assert.ok(g.simulation.shipYears<300);assert.ok(g.simulation.time>10);
      expected??=structuredClone(g.simulation);assert.deepEqual(g.simulation,expected);
      resetGame(g);assert.deepEqual(g.configuration,configuration);
      assert.equal(g.simulation.shipYears,0);assert.equal(g.simulation.earthYears,0);
    }
  }
});

test('недопустимая исходная скорость остаётся ошибкой, существующее столкновение имеет приоритет', () => {
  const invalid=createGameFromLevel(final);invalid.simulation.ship.vx=1000;invalid.simulation.ship.vy=0;
  startGame(invalid);stepSimulation(invalid.simulation,invalid.scenario.physics);
  assert.equal(invalid.simulation.status,'error');assert.equal(invalid.simulation.result,null);
  const contact=createGameFromLevel(final);
  contact.simulation.ship.vx=-999.999999;contact.simulation.ship.vy=0;
  const earth=contact.simulation.bodies.find(b=>b.id==='earth');
  earth.x=contact.simulation.ship.x;earth.y=contact.simulation.ship.y;
  startGame(contact);stepSimulation(contact.simulation,contact.scenario.physics);
  assert.equal(contact.simulation.status,'lose');assert.equal(contact.simulation.result.reason,'collision');
  assert.equal(contact.simulation.collisionId,'earth');assert.equal(contact.simulation.time,0);
});
