import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createGame, createGameFromLevel, resetGame, startGame } from '../src/state.js';
import { earthClockBody } from '../src/clock-display.js';
import { createRenderer } from '../src/render.js';
import { stepSimulation } from '../src/physics.js';
const examples = JSON.parse(readFileSync(new URL('../levels/mission-examples.json',import.meta.url),'utf8'));

test('в свободной сцене и четырёх миссиях без Земли вторые часы не показываются', () => {
  assert.equal(earthClockBody(createGame()),null);
  for (const input of examples.slice(0,4)) assert.equal(earthClockBody(createGameFromLevel(input)),null);
});

test('часы Земли принадлежат телу миссии и сохраняют привязку после полёта и Reset', () => {
  const game=createGameFromLevel(examples[4]);
  assert.equal(earthClockBody(game).label,'Земля');
  assert.equal(earthClockBody(game).id,game.level.mission.target.centre.bodyId);
  startGame(game);stepSimulation(game.simulation,game.scenario.physics);
  assert.equal(earthClockBody(game),game.simulation.bodies.find(b=>b.id==='p1'));
  resetGame(game);assert.equal(earthClockBody(game).label,'Земля');
});

test('отрисовка свободной сцены не создаёт точку с часами; в миссии обозначает часы Земли', () => {
  const text=[];
  const ctx=new Proxy({fillText(value){text.push(value);}}, {get:(t,k)=>t[k]??(()=>{}),set:(t,k,v)=>{t[k]=v;return true;}});
  const renderer=createRenderer({getContext:()=>ctx},{getBoundingClientRect:()=>({width:1000,height:694})});renderer.resize();
  const free=createGame();Object.assign(free.camera,{x:-700,y:130});renderer.draw(free,{drag:null});
  assert.equal(text.some(t=>t.includes('часы')||t.includes('Часы')),false);
  text.length=0;
  const mission=createGameFromLevel(examples[4]);renderer.draw(mission,{drag:null});
  assert.ok(text.includes('Часы Земли'));
});
