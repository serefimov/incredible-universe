// SPDX-License-Identifier: GPL-3.0-or-later
// Proposal for #6 only. Not imported by the game; adoption requires owner choice.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, startGame } from '../../src/state.js';
import { advanceFrame } from '../../src/physics.js';

export const CLOCK_PROPOSAL = Object.freeze({
  version: 'kinematic-clock-proposal-v1', lightSpeed: 1000, yearsPerUnit: 100,
});

// Velocity is measured in the fixed world/Earth frame, not relative to the camera.
// Euler's updated velocity is constant over its straight position segment.
export function clockIncrement(vx, vy, duration, clock = CLOCK_PROPOSAL) {
  if (![vx, vy, duration, clock.lightSpeed, clock.yearsPerUnit].every(Number.isFinite) ||
      duration < 0 || clock.lightSpeed <= 0 || clock.yearsPerUnit <= 0) {
    throw new RangeError('Некорректные параметры часов');
  }
  const beta = Math.hypot(vx, vy) / clock.lightSpeed;
  if (beta >= 1) throw new RangeError('Скорость корабля должна быть меньше c');
  const earth = clock.yearsPerUnit * duration;
  const ship = earth * Math.sqrt((1 - beta) * (1 + beta));
  if (!Number.isFinite(earth) || !Number.isFinite(ship)) throw new RangeError('Переполнение часов');
  return { earth, ship };
}

export function witnessScenario(step = 0.0025, playbackScale = 0.1) {
  const radius = 90, mass = 12250, gravity = 7200, softening = 16;
  const speed = Math.sqrt(gravity * mass * radius ** 2 / (radius ** 2 + softening ** 2) ** 1.5);
  return {
    id: 'two-clock-proposal-witness',
    physics: { version: 'fixed-euler-swept-v1', gravity, softening, maxStep: step,
      timeScale: playbackScale, maxFrame: 0.05 },
    camera: { x: 0, y: 0, zoom: 1 }, tray: {},
    bodies: [{ id: 'centre', x: 0, y: 0, vx: 0, vy: 0, m: mass, r: 30, fixed: true }],
    ship: { id: 'ship', x: radius, y: 0, vx: 0, vy: speed, m: 0.001, r: 5, fixed: false },
  };
}

export function runWitness({ step = 0.0025, playbackScale = 0.1 } = {}) {
  const scenario = witnessScenario(step, playbackScale);
  const game = createGame(scenario); startGame(game);
  let shipYears = 0, previousY = 0, returns = 0;
  let minSpeed = Infinity, maxSpeed = 0, minRadius = Infinity;
  const maxTicks = Math.ceil(5 / step);
  for (let tick = 0; tick < maxTicks; tick++) {
    const s = game.simulation;
    const previousTime = s.time;
    // Feed one physical tick per frame through the real frame scheduler.
    // Different playback scales therefore use different real frame durations.
    advanceFrame(s, scenario.physics, step / playbackScale);
    if (s.steps !== tick + 1) throw new Error('Эксперимент требует ровно один шаг за кадр');
    if (s.status !== 'running') throw new Error(`Контрольный полёт остановился: ${s.status}`);
    const speed = Math.hypot(s.ship.vx, s.ship.vy);
    const increment = clockIncrement(s.ship.vx, s.ship.vy, s.time - previousTime);
    shipYears += increment.ship;
    minSpeed = Math.min(minSpeed, speed); maxSpeed = Math.max(maxSpeed, speed);
    minRadius = Math.min(minRadius, Math.hypot(s.ship.x, s.ship.y));
    const earthYears = s.time * CLOCK_PROPOSAL.yearsPerUnit;
    if (previousY < 0 && s.ship.y >= 0 && s.ship.x > 0) {
      returns++;
      if (earthYears >= 300) {
        const distanceToStart = Math.hypot(s.ship.x - 90, s.ship.y);
        return { proposal: CLOCK_PROPOSAL, step, playbackScale, steps: s.steps,
          initialSpeed: scenario.ship.vy, returns, earthYears, shipYears,
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
    status: 'proposal-not-adopted',
    constantSpeedExamples: [0, 0.6, 0.8, Math.sqrt(8 / 9), 0.95, 0.98].map(beta => ({
      beta, ...clockIncrement(beta * CLOCK_PROPOSAL.lightSpeed, 0, 3) })),
    orbit: runWitness(), halfStep: runWitness({ step: 0.00125 }),
    fasterPlayback: runWitness({ playbackScale: 2.5 }),
  }, null, 2));
}
