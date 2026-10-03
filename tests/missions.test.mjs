import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameFromLevel, startGame, resetGame, placeBody } from '../src/state.js';
import { stepSimulation, advanceFrame } from '../src/physics.js';

function level(mission, options = {}) {
  return { schemaVersion: 1, id: 'test-mission', title: 'Проверка миссии', description: 'Контракт #9', purpose: 'contract-example',
    universe: { id: 'test-world', physics: { version: 'fixed-euler-swept-v1', gravity: 0, softening: 16,
      maxStep: 1, timeScale: 1, maxFrame: 1 }, camera: { x: 0, y: 0, zoom: 1 },
      bodies: [], ship: { id: 'ship', x: -10, y: 0, vx: 20, vy: 0, m: 0.001, r: 0.1, fixed: false },
      earthClock: { kind: 'inertial', x: 100, y: 100, vx: 0, vy: 0 },
      tray: { planet: { m: 0, r: 0.1, drawR: 1, label: 'Планета', count: 1 } }, ...options },
    placement: { regions: [{ kind: 'rect', xMin: -1000, xMax: 1000, yMin: -1000, yMax: 1000 }], shipClearance: 1, bodyGap: 1 }, mission };
}
const arrival = (limits = {}, target = { centre: { kind: 'fixed', x: 0, y: 0 }, radius: 1 }) =>
  ({ type: 'arrival', maxCoordinateYears: 300, target, limits });
function game(mission = arrival(), options) { const g = createGameFromLevel(level(mission, options)); startGame(g); return g; }
const tick = g => stepSimulation(g.simulation, g.scenario.physics);
const near = (a, b, eps = 1e-10) => assert.ok(Math.abs(a-b)<eps, `${a} != ${b}`);

test('быстрый проход полностью между концами шага завершается на входе, а не в конечной позиции', () => {
  const g = game(); tick(g);
  assert.equal(g.simulation.status, 'win'); near(g.simulation.ship.x, -1); near(g.simulation.time, 0.45);
  near(g.simulation.earthYears, 45); near(g.simulation.shipYears, 45*Math.sqrt(1-0.02**2));
  assert.equal(g.simulation.result.reason, 'arrived'); assert.equal(g.simulation.trail.at(-1).t, g.simulation.time);
});

test('ранний или слишком быстрый проход не побеждает и не проигрывает немедленно', () => {
  for (const limits of [{earthYears:{min:100}}, {relativeSpeed:{max:10}}]) {
    const g=game(arrival(limits)); tick(g); assert.equal(g.simulation.status,'running');
    tick(g); tick(g); assert.equal(g.simulation.status,'lose'); assert.equal(g.simulation.result.reason,'horizon');
  }
});

test('время может стать допустимым уже внутри области: победа на пересечении всех условий', () => {
  const g=game(arrival({earthYears:{min:50},shipYears:{max:60},relativeSpeed:{min:20,max:20}}));
  tick(g); assert.equal(g.simulation.status,'win'); near(g.simulation.time,0.5); near(g.simulation.ship.x,0);
});

test('выживание использует выбранные часы и заканчивается внутри шага', () => {
  for (const clock of ['coordinate','earth','ship']) {
    const g=game({type:'survival',maxCoordinateYears:300,survive:{clock,years:40}});
    tick(g); assert.equal(g.simulation.status,'win');
    near(clock==='ship' ? g.simulation.shipYears : g.simulation.time*100,40);
    assert.equal(g.simulation.result.reason,'survived');
  }
});

test('движущаяся цель и относительная скорость используют мир, не скорость корабля отдельно', () => {
  const earth={id:'earth',type:'planet',label:'Земля',x:0,y:0,vx:10,vy:0,m:0,r:0.1,fixed:false};
  const target={centre:{kind:'body',bodyId:'earth'},radius:1};
  const g=game(arrival({relativeSpeed:{min:10,max:10}},target),{bodies:[earth]}); tick(g);
  assert.equal(g.simulation.status,'win'); near(g.simulation.time,0.9);
  near(g.simulation.bodies[0].x,9); near(g.simulation.ship.x,8);
});

test('столкновение при равном событии имеет приоритет; успех раньше столкновения останавливает полёт', () => {
  const body={id:'earth',type:'planet',label:'Земля',x:0,y:0,vx:0,vy:0,m:0,r:0.1,fixed:true};
  const tied=game(arrival({}, {centre:{kind:'body',bodyId:'earth'},radius:0.2}),{bodies:[body]}); tick(tied);
  assert.equal(tied.simulation.status,'lose'); assert.equal(tied.simulation.result.reason,'collision');
  assert.equal(tied.simulation.collisionId,'earth'); near(tied.simulation.ship.x,-0.2);
  const earlier=game(arrival(),{bodies:[body]}); tick(earlier);
  assert.equal(earlier.simulation.status,'win'); assert.equal(earlier.simulation.collisionId,null);
});

test('столкновение на сроке выживания также побеждает успех', () => {
  const body={id:'earth',type:'planet',label:'Земля',x:0,y:0,vx:0,vy:0,m:0,r:0.1,fixed:true};
  const g=game({type:'survival',maxCoordinateYears:300,survive:{clock:'coordinate',years:49}},{bodies:[body]});
  tick(g); assert.equal(g.simulation.status,'lose'); assert.equal(g.simulation.result.reason,'collision');
});

test('успех на координатном горизонте разрешён, но после него запрещён', () => {
  for (const [horizon,status] of [[45,'win'],[44.999,'lose']]) {
    const mission=arrival(); mission.maxCoordinateYears=horizon;
    const g=game(mission); tick(g); assert.equal(g.simulation.status,status);
    near(g.simulation.time,horizon/100);
  }
});

test('собственный срок проверяется на включённой границе и локализуется внутри шага', () => {
  const atEntry=45*Math.sqrt(1-0.02**2);
  const yes=game(arrival({shipYears:{max:atEntry}})); tick(yes); assert.equal(yes.simulation.status,'win');
  const no=game(arrival({shipYears:{max:atEntry-0.001}})); tick(no); assert.equal(no.simulation.status,'lose');
  assert.equal(no.simulation.result.reason,'ship-deadline'); assert.ok(no.simulation.shipYears<=atEntry-0.001);
  near(no.simulation.shipYears,atEntry-0.001);
});

test('часы 300/100 сравниваются совместно без округления, Земля привязана к целевому телу', () => {
  const earth={id:'earth',type:'planet',label:'Земля',x:500,y:0,vx:0,vy:0,m:0,r:0.1,fixed:true};
  const mission={type:'earth-return',maxCoordinateYears:1000,target:{centre:{kind:'body',bodyId:'earth'},radius:1000},
    limits:{earthYears:{min:300},shipYears:{max:100},relativeSpeed:{max:950}}};
  for (const [earthYears,shipYears,status] of [[300,100,'win'],[300.001,100.001,'lose'],[299.9,99.99,'lose'],[299.9,99.9,'win']]) {
    const g=game(mission,{bodies:[earth],earthClock:{kind:'body',bodyId:'earth',offset:{x:0.1,y:0}},
      ship:{id:'ship',x:0,y:0,vx:950,vy:0,m:0.001,r:0.1,fixed:false}});
    Object.assign(g.simulation,{earthYears,shipYears});tick(g);assert.equal(g.simulation.status,status);
    if(status==='win'){assert.ok(g.simulation.earthYears>=300);assert.ok(g.simulation.shipYears<=100);}
  }
});

test('равенство границе круга и касание цели включены; значения по обе стороны различаются', () => {
  for (const [y,status] of [[1,'win'],[1-1e-6,'win'],[1+1e-6,'running']]) {
    const g=game(arrival(),{ship:{id:'ship',x:-10,y,vx:20,vy:0,m:0.001,r:0.1,fixed:false}});
    tick(g);assert.equal(g.simulation.status,status);
  }
});

test('результат фиксируется один раз; Reset очищает его и повторный полёт совпадает', () => {
  const g=game();tick(g);const first=structuredClone(g.simulation),result=g.simulation.result;
  tick(g);advanceFrame(g.simulation,g.scenario.physics,100);assert.equal(g.simulation.result,result);assert.deepEqual(g.simulation,first);
  assert.ok(Object.isFrozen(result));assert.equal(startGame(g),false);
  resetGame(g);assert.equal(g.simulation.result,null);assert.equal(placeBody(g,'planet',100,100),true);
  resetGame(g);startGame(g);tick(g);assert.equal(g.simulation.status,'win');
});

test('неопределённая физическая ошибка не превращается в Lose и не фиксирует результат', () => {
  const g=game();g.simulation.ship.vx=1000;const before=structuredClone(g.simulation.ship);tick(g);
  assert.equal(g.simulation.status,'error');assert.equal(g.simulation.result,null);assert.deepEqual(g.simulation.ship,before);
});

test('порядок событий не зависит от 30/60/120 Гц и камеры', () => {
  const run=hz=>{const g=game();Object.assign(g.camera,{x:123,y:-456,zoom:0.22});for(let i=0;i<hz*3&&g.simulation.status==='running';i++)advanceFrame(g.simulation,g.scenario.physics,1/hz);return structuredClone(g.simulation);};
  assert.deepEqual(run(30),run(60));assert.deepEqual(run(30),run(120));
});

test('срок по земным часам имеет отдельную причину; бесконечного ожидания успеха нет', () => {
  const g=game(arrival({earthYears:{max:40}}));tick(g);
  assert.equal(g.simulation.status,'lose');assert.equal(g.simulation.result.reason,'earth-deadline');near(g.simulation.earthYears,40);
  const survival=game({type:'survival',maxCoordinateYears:40,survive:{clock:'ship',years:40}});
  tick(survival);assert.equal(survival.simulation.status,'lose');assert.equal(survival.simulation.result.reason,'horizon');
});

test('гравитационные сроки сохраняют квадратуру часов укороченного сегмента', () => {
  const g=game({type:'survival',maxCoordinateYears:100,survive:{clock:'earth',years:1}},{
    physics:{version:'fixed-euler-swept-v1',gravity:7200,softening:16,maxStep:0.0025,timeScale:1,maxFrame:1},
    bodies:[{id:'centre',type:'star',label:'Центр',x:0,y:0,vx:0,vy:0,m:3000,r:1,fixed:true}],
    ship:{id:'ship',x:100,y:0,vx:0,vy:20,m:0.001,r:0.1,fixed:false},
    earthClock:{kind:'inertial',x:100,y:0,vx:0,vy:0}});
  for(let i=0;i<100&&g.simulation.status==='running';i++)tick(g);
  assert.equal(g.simulation.status,'win');assert.ok(g.simulation.earthYears>=1);near(g.simulation.earthYears,1);
  assert.ok(g.simulation.time>0.01);assert.ok(g.simulation.shipYears<g.simulation.earthYears);
});

test('неоднозначность локализации часов в чрезмерно сильном поле — ошибка, а не ложный Win/Lose', () => {
  const g=game({type:'survival',maxCoordinateYears:100,survive:{clock:'ship',years:1}},{
    physics:{version:'fixed-euler-swept-v1',gravity:7200,softening:16,maxStep:0.0025,timeScale:1,maxFrame:1},
    bodies:[{id:'left',type:'star',label:'Левая',x:-16,y:0,vx:0,vy:0,m:1000000,r:0,fixed:true},
      {id:'right',type:'star',label:'Правая',x:16,y:0,vx:0,vy:0,m:1000000,r:0,fixed:true}],
    ship:{id:'ship',x:0,y:0,vx:900,vy:0,m:0.001,r:0,fixed:false}});
  const before=structuredClone({ship:g.simulation.ship,time:g.simulation.time,earth:g.simulation.earthYears});tick(g);
  assert.equal(g.simulation.status,'error');assert.equal(g.simulation.result,null);
  assert.match(g.simulation.error,/локализовать/);
  assert.deepEqual({ship:g.simulation.ship,time:g.simulation.time,earth:g.simulation.earthYears},before);
});

test('контрольный орбитальный опыт с 300/100 завершается настоящей миссией без изменения модели часов', async () => {
  const {witnessScenario}=await import('../tools/experiments/two-clocks.mjs');
  const universe=witnessScenario();universe.bodies[0].type='star';universe.bodies[0].label='Центр';
  universe.earthClock.kind='inertial';
  const input=level({type:'arrival',maxCoordinateYears:1000,target:{centre:{kind:'fixed',x:90,y:0},radius:3},
    limits:{earthYears:{min:300},shipYears:{max:100},relativeSpeed:{min:950,max:985}}});
  input.universe=universe;
  const g=createGameFromLevel(input);startGame(g);
  for(let i=0;i<5000&&g.simulation.status==='running';i++)tick(g);
  assert.equal(g.simulation.status,'win');assert.ok(g.simulation.earthYears>=300);assert.ok(g.simulation.shipYears<=100);
  assert.ok(g.simulation.earthYears/g.simulation.shipYears>3.9);
  assert.ok(Math.hypot(g.simulation.ship.x-90,g.simulation.ship.y)<=3+1e-10);
});
