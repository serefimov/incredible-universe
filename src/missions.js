// SPDX-License-Identifier: GPL-3.0-or-later
import { CLOCK_CONTRACT } from './clocks.js';
import { resolveTarget } from './levels.js';
import { targetInterval, inRange } from './mission-geometry.js';

// Clock roots use the same shortened-segment quadrature as collision clocks.
// Return the first representable fraction satisfying a closed lower bound.
function firstAtLeast(read, value, end) {
  if (read(0) >= value) return 0;
  if (read(end) < value) return null;
  let lo = 0, hi = end;
  for (let i = 0; i < 64; i++) {
    const mid = lo / 2 + hi / 2;
    if (mid === lo || mid === hi) break;
    if (read(mid) >= value) hi = mid; else lo = mid;
  }
  return hi;
}
function lastAtMost(read, value, end) {
  if (read(0) > value) return null;
  if (read(0) === value) return 0;
  if (read(end) <= value) return end;
  let lo = 0, hi = end;
  for (let i = 0; i < 64; i++) {
    const mid = lo / 2 + hi / 2;
    if (mid === lo || mid === hi) break;
    if (read(mid) <= value) lo = mid; else hi = mid;
  }
  return lo;
}

// Prove monotonicity of f*rate(midpoint(f)), before using bisection.
// A source's depth derivative is bounded by K*|dr/df|*max r/(r²+soft²)^1.5.
// If the conservative bound fails, preserve the last valid state as a numerical
// error rather than inventing an order for potentially nonmonotone clock roots.
export function verifyClockSegment(simulation, next, model) {
  const oldObserver = simulation.earthObserver;
  let newObserver;
  if (simulation.earthBinding) {
    const i = simulation.bodies.findIndex(b => b.id === simulation.earthBinding.bodyId);
    if (i < 0) throw new RangeError('Земной наблюдатель потерял привязку');
    const offset = simulation.earthBinding.offset;
    newObserver = { x: next[i].x + offset.x, y: next[i].y + offset.y };
  } else newObserver = { x: oldObserver.x + oldObserver.vx * model.maxStep,
    y: oldObserver.y + oldObserver.vy * model.maxStep };
  for (const [observer, nextObserver] of [[simulation.ship, next.at(-1)], [oldObserver, newObserver]]) {
    let bound = 0;
    for (let i = 0; i < simulation.bodies.length; i++) {
      const body = simulation.bodies[i], n = next[i];
      const x = observer.x - body.x, y = observer.y - body.y;
      const dx = ((nextObserver.x - observer.x) - (n.x - body.x)) / 2;
      const dy = ((nextObserver.y - observer.y) - (n.y - body.y)) / 2;
      const length = Math.hypot(dx, dy);
      if (length === 0 || model.gravity === 0 || body.m === 0) continue;
      const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / length ** 2));
      const closest = Math.hypot(x + t * dx, y + t * dy);
      const radius = Math.max(closest, model.softening / Math.SQRT2);
      const gradient = radius / Math.hypot(radius, model.softening) ** 3;
      bound += model.gravity * body.m / CLOCK_CONTRACT.lightSpeed ** 2 * length * gradient;
    }
    if (!Number.isFinite(bound) || bound >= 1) {
      throw new RangeError('Не удалось однозначно локализовать события часов; уменьшите шаг сценария');
    }
  }
}

export function missionEvent(simulation, next, model, end, clocksAt) {
  const mission = simulation.mission;
  if (!mission) return null;
  const coordinateAt = f => (simulation.steps + f) * model.maxStep * CLOCK_CONTRACT.yearsPerUnit;
  const read = key => f => f === 0 ? simulation[key] : clocksAt(f)[key];
  const clock = key => key === 'coordinate' ? coordinateAt : read(key === 'earth' ? 'earthYears' : 'shipYears');
  const horizon = firstAtLeast(coordinateAt, mission.maxCoordinateYears, end);
  let upper = horizon ?? end, reason = 'horizon';
  const limits = mission.limits ?? {};
  for (const key of ['earthYears', 'shipYears']) {
    if (limits[key]?.max === undefined) continue;
    const last = lastAtMost(read(key), limits[key].max, upper);
    if (last === null) return { fraction: 0, outcome: 'lose', reason: key === 'shipYears' ? 'ship-deadline' : 'earth-deadline' };
    if (last < upper) { upper = last; reason = key === 'shipYears' ? 'ship-deadline' : 'earth-deadline'; }
    // An exactly reached deadline at the step endpoint must finish this step,
    // after allowing success at the same closed boundary.
    else if (reason === 'horizon' && read(key)(upper) === limits[key].max && (horizon === null || upper < horizon)) {
      reason = key === 'shipYears' ? 'ship-deadline' : 'earth-deadline';
    }
  }
  let win = null;
  if (mission.type === 'survival') {
    win = firstAtLeast(clock(mission.survive.clock), mission.survive.years, upper);
  } else {
    const nextSimulation = { ...simulation, bodies: next.slice(0, -1), ship: next.at(-1) };
    const target = resolveTarget(mission.target, simulation), nextTarget = resolveTarget(mission.target, nextSimulation);
    const speed = Math.hypot(next.at(-1).vx - nextTarget.vx, next.at(-1).vy - nextTarget.vy);
    const interval = targetInterval(simulation.ship, next.at(-1), target, nextTarget, target.radius);
    if (interval && inRange(speed, limits.relativeSpeed)) {
      let lower = interval[0], last = Math.min(interval[1], upper);
      for (const key of ['earthYears', 'shipYears']) {
        if (limits[key]?.min === undefined) continue;
        const first = firstAtLeast(read(key), limits[key].min, last);
        if (first === null) { lower = Infinity; break; }
        lower = Math.max(lower, first);
      }
      if (lower <= last && ['earthYears', 'shipYears'].every(key => inRange(read(key)(lower), limits[key]))) win = lower;
    }
  }
  if (win !== null) return { fraction: win, outcome: 'win', reason: mission.type === 'survival' ? 'survived' : 'arrived' };
  if (horizon !== null || reason !== 'horizon' || upper < end) return { fraction: upper, outcome: 'lose', reason };
  return null;
}

export const RESULT_REASONS = Object.freeze({
  survived: 'Условие выживания выполнено', arrived: 'Все условия прибытия выполнены',
  'speed-limit': 'Достигнут предел скорости игровой модели (c=1000)',
  collision: 'Столкновение', horizon: 'Истёк предел попытки',
  'ship-deadline': 'Истёк срок по часам корабля', 'earth-deadline': 'Истёк срок по земным часам',
});

export function makeResult(event, simulation) {
  return Object.freeze({ outcome: event.outcome, reason: event.reason,
    message: event.reason === 'speed-limit'
      ? `${event.speedLimitObserver === 'earth' ? 'Земля достигла' : 'Корабль достиг'} предела скорости игровой модели (c=1000). Измените расстановку после Сброса`
      : RESULT_REASONS[event.reason], time: simulation.time,
    ...(event.reason === 'speed-limit' ? {speedLimitObserver:event.speedLimitObserver} : {}),
    earthYears: simulation.earthYears, shipYears: simulation.shipYears,
    ...(simulation.collisionId ? { collisionId: simulation.collisionId } : {}) });
}
