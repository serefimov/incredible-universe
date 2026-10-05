import assert from 'node:assert/strict';
import test from 'node:test';
import { campaign, solutions, campaignFlight } from '../tools/check-campaign.mjs';
import { createCampaignProgress, nextCampaignLevel } from '../src/campaign.js';
import { createSimulation, createGameFromLevel, placeBody, resetGame, startGame } from '../src/state.js';
import { advanceFrame, stepSimulation } from '../src/physics.js';
import { earthClockBody } from '../src/clock-display.js';

for (const level of campaign) test(`${level.id}: solution, failure, placement tolerance and Reset`, () => {
  const ref = solutions.find(s => s.levelId === level.id);
  assert.ok(ref, 'authored reference exists');
  const {game,measurement} = campaignFlight(level,ref.placements);
  assert.equal(measurement.status,'win');
  if (level.id === 'training-2') assert.ok(measurement.headingCosine < -0.94, 'arrival travels opposite the starting direction');
  assert.ok(measurement.clearance > 0);
  assert.ok(measurement.maxSpeed < 1000);
  assert.equal(Boolean(earthClockBody(game)),level.id === 'earth-return');
  const failure = campaignFlight(level,ref.failurePlacements).measurement;
  assert.equal(failure.status,'lose');
  assert.equal(failure.reason,ref.failureReason);
  const {halfSpan,step} = ref.tolerance;
  for(let dx=-halfSpan;dx<=halfSpan;dx+=step) for(let dy=-halfSpan;dy<=halfSpan;dy+=step) {
    const placement=ref.placements.map(p => ({...p,x:p.x+dx,y:p.y+dy}));
    assert.equal(campaignFlight(level,placement).measurement.status,'win',`${dx},${dy}`);
  }
  const placement = structuredClone(game.configuration);
  resetGame(game);
  assert.deepEqual(game.configuration,placement);
  assert.equal(game.simulation.shipYears,0);
  assert.equal(game.simulation.earthYears,0);
  if (level.id === 'earth-return') {
    assert.ok(measurement.earthYears >= 500 && measurement.shipYears <= 300);
    assert.ok(measurement.earthYears-measurement.shipYears >= 200);
    assert.ok(measurement.earthYears/measurement.shipYears >= 5/3);
    const earth=game.simulation.bodies.find(b=>b.id==='earth');
    assert.equal(earth.fixed,false);
    assert.equal(game.scenario.earthClock.bodyId,'earth');
    assert.ok(level.mission.target.radius / earth.r < 18, 'compact arrival relative to Earth size');
  }
});

test('all seven flights are independent of frame schedule and camera', () => {
  assert.equal(campaign.length,7);
  for(const level of campaign) {
    const ref=solutions.find(s=>s.levelId===level.id);
    let expected;
    for(const schedule of [[1/30],[1/60],[1/120],[.008,.033,.017,.012]]) {
      const game=createGameFromLevel(level,{tutorial:false});
      for(const p of ref.placements) assert.equal(placeBody(game,p.type,p.x,p.y),true);
      startGame(game);
      for(let frame=0;game.simulation.status==='running';frame++) {
        assert.ok(frame<15000);
        game.camera.x+=7;game.camera.y-=3;game.camera.zoom=frame%2 ? .1 : 2;
        advanceFrame(game.simulation,game.scenario.physics,schedule[frame%schedule.length]);
      }
      expected ??= structuredClone(game.simulation);
      assert.deepEqual(game.simulation,expected,level.id);
    }
  }
});

test('progress requires actual wins, restores valid IDs, and survives storage failure', () => {
  let saved=JSON.stringify(['unknown',campaign[0].id,campaign[0].id]);
  const backend={getItem:()=>saved,setItem:(_,v)=>{saved=v;}};
  const progress=createCampaignProgress(backend);
  assert.equal(progress.count,1);assert.equal(progress.complete,false);
  for(const level of campaign) {
    const game=createGameFromLevel(level,{tutorial:false});
    progress.markWin(game);assert.equal(progress.has(level.id),level.id===campaign[0].id);
    const ref=solutions.find(s=>s.levelId===level.id);
    progress.markWin(campaignFlight(level,ref.placements).game);
  }
  assert.equal(progress.complete,true);
  assert.equal(createCampaignProgress(backend).count,7);
  const broken=createCampaignProgress({getItem(){throw Error();},setItem(){throw Error();}});
  broken.markWin(campaignFlight(campaign[1],solutions[1].placements).game);
  assert.equal(broken.count,1);
  assert.equal(nextCampaignLevel(campaign[0].id).id,campaign[1].id);
  assert.equal(nextCampaignLevel(campaign.at(-1).id),null);
  assert.equal(nextCampaignLevel('example-survival'),null);
});


test('new companion bodies change the flight and invalidate the previous reference placements', () => {
  for (const [index, oldPlacement] of [[3,{type:'planet',x:110,y:120}], [5,{type:'planet',x:-100,y:-120}]]) {
    const level=campaign[index];
    assert.equal(campaignFlight(level,[oldPlacement]).measurement.status,'lose');
    const without=structuredClone(level);without.universe.bodies.pop();
    const games=[level,without].map(l=>{
      const g=createGameFromLevel(l,{tutorial:false});
      const p=solutions[index].placements[0];assert.equal(placeBody(g,p.type,p.x,p.y),true);g.simulation=createSimulation(g.scenario,g.configuration);startGame(g);
      for(let tick=0;tick<1000;tick++) stepSimulation(g.simulation,g.scenario.physics);
      return g;
    });
    const [a,b]=games.map(g=>g.simulation.ship);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>5, 'existing planet materially deflects the ship');
  }
});

test('Earth return: added planet visibly stretches the orbit instead of only changing the result', () => {
  const level=campaign.at(-1), ref=solutions.at(-1).placements[0];
  const games=[false,true].map(placed=>{
    const g=createGameFromLevel(level,{tutorial:false});
    if(placed) assert.equal(placeBody(g,ref.type,ref.x,ref.y),true);
    assert.equal(startGame(g),true);return g;
  });
  const radii=games.map(()=>({min:Infinity,max:0}));let maximumSeparation=0;
  for(let tick=0;tick<5200;tick++) {
    for(let i=0;i<2;i++) {
      const g=games[i];stepSimulation(g.simulation,g.scenario.physics);
      assert.equal(g.simulation.status,'running');
      const r=Math.hypot(g.simulation.ship.x,g.simulation.ship.y);
      radii[i].min=Math.min(radii[i].min,r);radii[i].max=Math.max(radii[i].max,r);
    }
    const [a,b]=games.map(g=>g.simulation.ship);
    maximumSeparation=Math.max(maximumSeparation,Math.hypot(a.x-b.x,a.y-b.y));
  }
  assert.ok(radii[0].max-radii[0].min < 5, 'baseline remains nearly circular');
  assert.ok(radii[1].max-radii[1].min > 450, 'planet creates a clearly elongated orbit');
  assert.ok(maximumSeparation > 550, 'deflection is visible even in the overview');
});
