import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containsPlacement } from '../src/placement-geometry.js';
import { loadLevel } from '../src/levels.js';
import { createGameFromLevel, placeBody, moveBody, removeBody, resetGame } from '../src/state.js';
const campaign = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url)));
const polygon = {kind:'polygon',vertices:[{x:0,y:0},{x:60,y:0},{x:60,y:20},{x:20,y:20},{x:20,y:60},{x:0,y:60}]};

test('concave polygon includes edges and vertices, excludes its notch, in either winding', () => {
  for (const vertices of [polygon.vertices, [...polygon.vertices].reverse()]) {
    const r={...polygon,vertices};
    for(const p of [[0,0],[60,20],[20,40],[10,50],[50,10]]) assert.equal(containsPlacement(r,...p),true);
    for(const p of [[40,40],[-1,0],[60,21],[20.001,30]]) assert.equal(containsPlacement(r,...p),false);
  }
});

test('level loader rejects crossed, folded, degenerate and malformed polygons', () => {
  for(const vertices of [[],[{x:0,y:0},{x:1,y:1}],
    [{x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0}],
    [{x:0,y:0},{x:1,y:0},{x:2,y:0}],
    [{x:0,y:0},{x:2,y:0},{x:2,y:0},{x:0,y:2}],
    [{x:0,y:0},{x:2,y:0},{x:Infinity,y:2}]]) {
    const l=structuredClone(campaign[0]);l.placement.regions=[{kind:'polygon',vertices}];
    assert.throws(()=>loadLevel(l),/placement/);
  }
  const l=structuredClone(campaign[0]);l.placement.regions=[polygon];assert.doesNotThrow(()=>loadLevel(l));
  l.placement.regions=[{kind:'all'},{kind:'circle',x:0,y:0,radius:1}];assert.throws(()=>loadLevel(l),/единственной/);
});

test('unbounded placement retains safety, edit, move, removal and Reset rules at distant coordinates', () => {
  const g=createGameFromLevel(campaign[5],{tutorial:false});
  assert.deepEqual(g.level.placement.regions,[{kind:'all'}]);
  assert.equal(placeBody(g,'planet',g.scenario.ship.x,g.scenario.ship.y),false);
  assert.equal(placeBody(g,'planet',NaN,0),false);
  assert.equal(placeBody(g,'planet',1e6,-1e6),true);
  resetGame(g);assert.equal(g.configuration.placed[0].x,1e6);
  assert.equal(moveBody(g,'planet',-1e6,1e6),true);
  assert.equal(removeBody(g,'planet'),true);assert.equal(g.simulation.bodies.some(b=>b.user),false);
});

test('polygon authoring feeds the same membership test used by real placement and movement', () => {
  const l=structuredClone(campaign[0]);l.placement.regions=[{kind:'polygon',vertices:[{x:-140,y:-140},{x:-80,y:-140},{x:-80,y:-100},{x:-140,y:-100}]}];
  const g=createGameFromLevel(l,{tutorial:false});
  assert.equal(placeBody(g,'planet',-140,-140),true);
  assert.equal(moveBody(g,'planet',-110,-99),false);
  assert.equal(moveBody(g,'planet',-80,-100),true);
});
