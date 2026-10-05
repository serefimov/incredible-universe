// SPDX-License-Identifier: GPL-3.0-or-later
// Reproduce authored solutions through the production engine, without the UI.
import { readFileSync } from 'node:fs';
import { createGameFromLevel, placeBody, startGame } from '../src/state.js';
import { stepSimulation } from '../src/physics.js';
import { arrivalSpeed, resolveTarget } from '../src/levels.js';
export const campaign = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url)));
export const solutions = JSON.parse(readFileSync(new URL('../levels/campaign-solutions.json', import.meta.url)));
export function campaignFlight(level, placements) {
  const game = createGameFromLevel(level, { tutorial: false });
  for (const body of placements) if (!placeBody(game, body.type, body.x, body.y)) throw new Error(`${level.id}: invalid placement`);
  if (!startGame(game)) throw new Error(`${level.id}: invalid start`);
  let clearance = Infinity, maxSpeed = 0, unmetEntries = 0;
  for (let tick = 0; game.simulation.status === 'running'; tick++) {
    if (tick > 20000) throw new Error(`${level.id}: nonfinite attempt`);
    stepSimulation(game.simulation, game.scenario.physics);
    const s = game.simulation;
    maxSpeed = Math.max(maxSpeed, Math.hypot(s.ship.vx,s.ship.vy));
    for (const b of s.bodies) clearance = Math.min(clearance, Math.hypot(s.ship.x-b.x,s.ship.y-b.y)-s.ship.r-b.r);
    if (s.mission.target && s.status === 'running') {
      const target = resolveTarget(s.mission.target,s);
      if (Math.hypot(s.ship.x-target.x,s.ship.y-target.y) <= target.radius) unmetEntries++;
    }
  }
  const s = game.simulation;
  return { game, measurement: { levelId: level.id, status:s.status, reason:s.result?.reason,
    shipYears:s.shipYears, earthYears:s.earthYears, relativeSpeed:s.mission.target ? arrivalSpeed(s.mission.target,s) : null,
    clearance, maxSpeed, unmetEntries } };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  for (const level of campaign) {
    const solution = solutions.find(s => s.levelId === level.id);
    console.log(JSON.stringify(campaignFlight(level, solution.placements).measurement));
  }
}
