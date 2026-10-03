import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createGame, createGameFromLevel, startGame, resetGame } from '../src/state.js';
import { stepSimulation } from '../src/physics.js';
import { missionDisplay } from '../src/mission-display.js';
const examples = JSON.parse(readFileSync(new URL('../levels/mission-examples.json', import.meta.url)));
const campaign = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url)));

test('краткая цель использует условия миссии и различает часы корабля и Земли', () => {
  assert.equal(missionDisplay(createGame()).brief, '');
  assert.equal(missionDisplay(createGameFromLevel(campaign[0])).brief,
    'Выжить 500 лет по часам корабля без столкновения.');
  const level = movingLevel();
  level.mission.limits = {relativeSpeed: {min: 2, max: 10}, shipYears: {max: 100}, earthYears: {min: 300}};
  const brief = missionDisplay(createGameFromLevel(level)).brief;
  assert.match(brief, /радиус 1 мир. ед./);
  assert.match(brief, /скорость относительно цели ≥ 2 и ≤ 10/);
  assert.match(brief, /≤ 100 лет по часам корабля/);
  assert.match(brief, /≥ 300 лет по часам Земли/);
});

function movingLevel() {
  const l = structuredClone(examples.at(-1));
  l.universe.physics = { version:'fixed-euler-swept-v1',gravity:0,softening:16,maxStep:1,timeScale:1,maxFrame:1 };
  l.universe.bodies = [{id:'earth',type:'planet',label:'Земля',x:0,y:0,vx:10,vy:0,m:0,r:0.1,fixed:false}];
  l.universe.ship = {id:'ship',x:-10,y:0,vx:20,vy:0,m:0.001,r:0.1,fixed:false};
  l.universe.earthClock = {kind:'body',bodyId:'earth',offset:{x:0,y:1}};
  l.mission = {type:'arrival',maxCoordinateYears:300,target:{centre:{kind:'body',bodyId:'earth'},radius:1},limits:{relativeSpeed:{max:10}}};
  return l;
}

test('показания движущейся цели и дробного результата читаются из одного физического состояния', () => {
  const game = createGameFromLevel(movingLevel());
  startGame(game); stepSimulation(game.simulation,game.scenario.physics);
  assert.equal(game.simulation.status,'win');
  assert.ok(Math.abs(game.simulation.time-0.9)<1e-12);
  const before = structuredClone(game);
  const display = missionDisplay(game);
  assert.match(display.conditions,/✓ До центра цели «Земля»: ≈1.00/);
  assert.match(display.result,/Скорость относительно цели: ≈10.00/);
  assert.match(display.result,/Земля: ≈90.00/);
  assert.match(display.result,/Корабль: ≈89.98/);
  assert.deepEqual(game,before,'UI cannot mutate physical state');
  stepSimulation(game.simulation,game.scenario.physics);
  assert.deepEqual(missionDisplay(game),display);
  resetGame(game); assert.equal(missionDisplay(game).result,'');
});

test('ранний и быстрый вход показывают невыполненные условия и продолжающуюся попытку', () => {
  const l = movingLevel(); l.mission.limits = {shipYears:{min:100},relativeSpeed:{max:9}};
  l.universe.ship.y=0.5;
  const game=createGameFromLevel(l);startGame(game);
  stepSimulation(game.simulation,game.scenario.physics);
  const display=missionDisplay(game);
  assert.equal(game.simulation.status,'running');
  assert.equal(display.result,'');
  assert.match(display.feedback,/Корабль в области цели.*Полёт продолжается.*Скорость относительно цели.*Часы корабля/);
});

test('округлённое совпадение с пределом не выдаётся за выполненное условие', () => {
  const l=movingLevel(); l.mission.limits={shipYears:{min:100},relativeSpeed:{max:10}};
  const game=createGameFromLevel(l);game.simulation.shipYears=99.99999;
  game.simulation.ship.vx=20.00001;
  const display=missionDisplay(game);
  assert.match(display.conditions,/○ Часы корабля: ≈100.00; нужно ≥ 100/);
  assert.match(display.conditions,/○ Скорость относительно цели: ≈10.00; нужно ≤ 10/);
});

test('Земля не появляется в свободной сцене или инерциальном примере, ошибка не называется поражением', () => {
  for(const game of [createGame(),createGameFromLevel(examples[0])]) {
    game.simulation.status='error';
    const display=missionDisplay(game);
    assert.match(display.result,/Ошибка симуляции.*не результат миссии/);
    assert.match(display.result,/Корабль:/);
    assert.doesNotMatch(display.result,/Земля:/);
  }
});
