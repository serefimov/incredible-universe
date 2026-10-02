// SPDX-License-Identifier: GPL-3.0-or-later
// Accepted #6 clock contract experiment. Game integration belongs to #7.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGame, startGame } from '../../src/state.js';
import { advanceFrame } from '../../src/physics.js';

export const CLOCK_CONTRACT = Object.freeze({
  version: 'potential-kinematic-v1', lightSpeed: 1000, yearsPerUnit: 100,
});

// Plummer potential: its negative gradient is the acceleration used by #3.
// All gravitational source bodies contribute; the probe ship is not a source.
export function potentialAt(point, bodies, model) {
  if (![point.x, point.y, model.gravity, model.softening].every(Number.isFinite) ||
      model.gravity < 0 || model.softening <= 0) throw new RangeError('Некорректное поле');
  let potential = 0;
  for (const body of bodies) {
    if (![body.x, body.y, body.m].every(Number.isFinite) || body.m < 0) {
      throw new RangeError('Некорректный источник поля');
    }
    const distance = Math.hypot(point.x - body.x, point.y - body.y, model.softening);
    if (!Number.isFinite(distance)) throw new RangeError('Переполнение расстояния');
    potential -= model.gravity * body.m / distance;
  }
  if (!Number.isFinite(potential)) throw new RangeError('Переполнение потенциала');
  return potential;
}

// Explicit GAME clock law, not a Schwarzschild/Einstein solution.
// exp(phi/c²) matches 1 + phi/c² in a weak stationary field.
export function clockRate(vx, vy, potential = 0, clock = CLOCK_CONTRACT) {
  if (![vx, vy, potential, clock.lightSpeed, clock.yearsPerUnit].every(Number.isFinite) ||
      clock.lightSpeed <= 0 || clock.yearsPerUnit <= 0 || potential > 0) {
    throw new RangeError('Некорректные параметры часов');
  }
  const beta = Math.hypot(vx, vy) / clock.lightSpeed;
  if (beta >= 1) throw new RangeError('Скорость наблюдателя должна быть меньше c');
  const depth = -potential / clock.lightSpeed / clock.lightSpeed;
  const rate = Math.exp(-depth) * Math.sqrt((1 - beta) * (1 + beta));
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('Часы вышли за численный диапазон');
  return rate;
}

export function clockIncrement(vx, vy, duration, clock = CLOCK_CONTRACT,
  { shipPotential = 0, earthPotential = 0, earthVx = 0, earthVy = 0 } = {}) {
  if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Некорректный интервал');
  const shipRate = clockRate(vx, vy, shipPotential, clock);
  const earthRate = clockRate(earthVx, earthVy, earthPotential, clock);
  const coordinateYears = clock.yearsPerUnit * duration;
  const earth = coordinateYears * earthRate;
  const ship = coordinateYears * shipRate;
  if (![coordinateYears, earth, ship].every(Number.isFinite) ||
      (duration > 0 && (earth <= 0 || ship <= 0))) throw new RangeError('Переполнение или потеря точности часов');
  return { earth, ship };
}

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
  let shipYears = 0, earthYears = 0, previousY = 0, returns = 0;
  let shipCorrection = 0, earthCorrection = 0;
  let minShipPotential = 0, maxShipPotential = -Infinity;
  let minSpeed = Infinity, maxSpeed = 0, minRadius = Infinity;
  const maxTicks = Math.ceil(12 / step);
  for (let tick = 0; tick < maxTicks; tick++) {
    const s = game.simulation;
    const previousTime = s.time;
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
    const earthPotential = potentialAt(scenario.earthClock, midpointBodies, scenario.physics);
    const increment = clockIncrement(s.ship.vx, s.ship.vy, s.time - previousTime, CLOCK_CONTRACT,
      { shipPotential, earthPotential, earthVx: scenario.earthClock.vx, earthVy: scenario.earthClock.vy });
    // Compensated sums; display rounding never feeds back into the clocks.
    const shipDelta = increment.ship - shipCorrection, nextShipYears = shipYears + shipDelta;
    shipCorrection = (nextShipYears - shipYears) - shipDelta; shipYears = nextShipYears;
    const earthDelta = increment.earth - earthCorrection, nextEarthYears = earthYears + earthDelta;
    earthCorrection = (nextEarthYears - earthYears) - earthDelta; earthYears = nextEarthYears;
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
