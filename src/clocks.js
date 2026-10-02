// SPDX-License-Identifier: GPL-3.0-or-later
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

// Kahan accumulation. Refuse a lost positive tick instead of silently freezing a clock.
function sumYears(value, correction, increment) {
  if (![value, correction, increment].every(Number.isFinite) || value < 0 || increment < 0) {
    throw new RangeError('Некорректное состояние счётчика времени');
  }
  if (increment === 0) return { value, correction };
  const delta = increment - correction;
  const next = value + delta;
  const nextCorrection = (next - value) - delta;
  if (!Number.isFinite(next) || !Number.isFinite(nextCorrection) || next < value ||
      (increment > 0 && next === value)) throw new RangeError('Потеря точности счётчика времени');
  return { value: next, correction: nextCorrection };
}

const midpoint = (a, b) => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });

// Calculate before the physics transaction commits any positions or times.
export function calculateClocks(simulation, committed, model, duration) {
  if (simulation.clockVersion !== CLOCK_CONTRACT.version) throw new RangeError('Неизвестная модель часов');
  const observer = simulation.earthObserver;
  if (!observer || !['x', 'y', 'vx', 'vy'].every(key => Number.isFinite(observer[key]))) {
    throw new RangeError('Некорректный земной наблюдатель');
  }
  const earthObserver = { ...observer,
    x: observer.x + observer.vx * duration, y: observer.y + observer.vy * duration };
  if (![earthObserver.x, earthObserver.y].every(Number.isFinite)) {
    throw new RangeError('Переполнение позиции земного наблюдателя');
  }
  const bodies = simulation.bodies.map((body, i) => ({ ...body, ...midpoint(body, committed[i]) }));
  const ship = committed.at(-1);
  const increments = clockIncrement(ship.vx, ship.vy, duration, CLOCK_CONTRACT, {
    shipPotential: potentialAt(midpoint(simulation.ship, ship), bodies, model),
    earthPotential: potentialAt(midpoint(observer, earthObserver), bodies, model),
    earthVx: observer.vx, earthVy: observer.vy,
  });
  const earth = sumYears(simulation.earthYears, simulation.earthCorrection, increments.earth);
  const onBoard = sumYears(simulation.shipYears, simulation.shipCorrection, increments.ship);
  return { earthYears: earth.value, shipYears: onBoard.value,
    earthCorrection: earth.correction, shipCorrection: onBoard.correction, earthObserver };
}
