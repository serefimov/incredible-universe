// SPDX-License-Identifier: GPL-3.0-or-later
// Explain the free scene's reference clock and modest accumulated difference.
import { createGame, startGame } from '../../src/state.js';
import { stepSimulation } from '../../src/physics.js';
import { clockRate, potentialAt } from '../../src/clocks.js';
const game = createGame(), s = game.simulation, model = game.scenario.physics;
const initial = { observer: { ...s.earthObserver }, speed: Math.hypot(s.ship.vx, s.ship.vy),
  referenceRate: clockRate(0, 0, potentialAt(s.earthObserver, s.bodies, model)),
  shipRate: clockRate(s.ship.vx, s.ship.vy, potentialAt(s.ship, s.bodies, model)) };
startGame(game);
let maxSpeed = 0;
for (let i = 0; i < 20000 && s.status === 'running'; i++) {
  stepSimulation(s, model); maxSpeed = Math.max(maxSpeed, Math.hypot(s.ship.vx,s.ship.vy));
}
console.log(JSON.stringify({ initial, result: { status:s.status, collisionId:s.collisionId,
  referenceYears:s.earthYears, shipYears:s.shipYears, referenceToShip:s.earthYears/s.shipYears,maxSpeed } },null,2));
