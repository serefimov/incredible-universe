// SPDX-License-Identifier: GPL-3.0-or-later
// Accepted clock contract witness, executed by the real game simulation.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, startGame } from '../../src/state.js';
import { advanceFrame } from '../../src/physics.js';

import { CLOCK_CONTRACT, clockIncrement, potentialAt } from '../../src/clocks.js';
export { CLOCK_CONTRACT, clockIncrement, clockRate, potentialAt } from '../../src/clocks.js';

export function witnessScenario(step = 0.0025, playbackScale = 0.1) {
  const radius = 90, mass = 12250, gravity = 7200, softening = 16;
  const speed = Math.sqrt(gravity * mass * radius ** 2 / (radius ** 2 + softening ** 2) ** 1.5);
  return {
    id: 'two-clock-contract-witness',
    physics: { version: 'fixed-euler-swept-v1', gravity, softening, maxStep: step,
      timeScale: playbackScale, maxFrame: 0.05 },
    camera: { x: 0, y: 0, zoom: 1 }, tray: {},
    earthClock: { x: radius, y: 0, vx: 0, vy: 0 },
    bodies: [{ id: 'centre', x: 0, y: 0, vx: 0, vy: 0, m: mass, r: 30, fixed: true }],
    ship: { id: 'ship', x: radius, y: 0, vx: 0, vy: speed, m: 0.001, r: 5, fixed: false },
  };
}

export function runWitness({ step = 0.0025, playbackScale = 0.1 } = {}) {
  const scenario = witnessScenario(step, playbackScale);
  const game = createGame(scenario); startGame(game);
  let previousY = 0, returns = 0;
  let minShipPotential = 0, maxShipPotential = -Infinity;
  let minSpeed = Infinity, maxSpeed = 0, minRadius = Infinity;
  const maxTicks = Math.ceil(12 / step);
  for (let tick = 0; tick < maxTicks; tick++) {
    const s = game.simulation;
    const previousShip = { ...s.ship };
    const previousBodies = s.bodies.map(body => ({ ...body }));
    // Feed one physical tick per frame through the real frame scheduler.
    // Different playback scales therefore use different real frame durations.
    advanceFrame(s, scenario.physics, step / playbackScale);
    if (s.steps !== tick + 1) throw new Error('Эксперимент требует ровно один шаг за кадр');
    if (s.status !== 'running') throw new Error(`Контрольный полёт остановился: ${s.status}`);
    const speed = Math.hypot(s.ship.vx, s.ship.vy);
    const midpoint = { x: (previousShip.x + s.ship.x) / 2, y: (previousShip.y + s.ship.y) / 2 };
    const midpointBodies = s.bodies.map((body, i) => ({ ...body,
      x: (previousBodies[i].x + body.x) / 2, y: (previousBodies[i].y + body.y) / 2 }));
    const shipPotential = potentialAt(midpoint, midpointBodies, scenario.physics);
    const { earthYears, shipYears } = s;
    minShipPotential = Math.min(minShipPotential, shipPotential);
    maxShipPotential = Math.max(maxShipPotential, shipPotential);
    minSpeed = Math.min(minSpeed, speed); maxSpeed = Math.max(maxSpeed, speed);
    minRadius = Math.min(minRadius, Math.hypot(s.ship.x, s.ship.y));

    if (previousY < 0 && s.ship.y >= 0 && s.ship.x > 0) {
      returns++;
      if (earthYears >= 300) {
        const distanceToStart = Math.hypot(s.ship.x - 90, s.ship.y);
        return { contract: CLOCK_CONTRACT, step, playbackScale, steps: s.steps,
          initialSpeed: scenario.ship.vy, returns, earthYears, shipYears,
          coordinateYears: s.time * CLOCK_CONTRACT.yearsPerUnit,
          earthPotential: potentialAt(scenario.earthClock, s.bodies, scenario.physics),
          minShipPotential, maxShipPotential,
          position: { x: s.ship.x, y: s.ship.y }, distanceToStart, arrivalSpeed: speed,
          minSpeed, maxSpeed, minRadius, collisionClearance: minRadius - 35,
          temporalPass: earthYears >= 300 && shipYears <= 100,
          // Marker and speed range are experiment fixtures, not approved mission rules.
          fixtureReturnPass: distanceToStart <= 3 && speed >= 950 && speed <= 985 };
      }
    }
    previousY = s.ship.y;
  }
  throw new Error('Контрольный полёт не вернулся за выбранный горизонт');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({
    status: 'accepted-contract-experiment',
    constantSpeedExamples: [0, 0.6, 0.8, Math.sqrt(8 / 9), 0.95, 0.98].map(beta => ({
      beta, ...clockIncrement(beta * CLOCK_CONTRACT.lightSpeed, 0, 3) })),
    gravityExamples: [
      { name: 'same-field-rest', shipPotential: -400000, earthPotential: -400000, speed: 0 },
      { name: 'gravity-only', shipPotential: -1200000, earthPotential: 0, speed: 0 },
      { name: 'gravity-and-speed', shipPotential: -400000, earthPotential: -100000, speed: 600 },
    ].map(fields => ({ ...fields, ...clockIncrement(fields.speed, 0, 3, CLOCK_CONTRACT, fields) })),
    orbit: runWitness(), halfStep: runWitness({ step: 0.00125 }),
    fasterPlayback: runWitness({ playbackScale: 2.5 }),
  }, null, 2));
}
