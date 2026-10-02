// SPDX-License-Identifier: GPL-3.0-or-later
export function acceleration(object, bodies, model) {
  let ax = 0, ay = 0;
  for (const body of bodies) {
    if (body === object) continue;
    const dx = body.x - object.x, dy = body.y - object.y;
    const denominator = Math.pow(dx * dx + dy * dy + model.softening * model.softening, 1.5);
    ax += model.gravity * body.m * dx / denominator;
    ay += model.gravity * body.m * dy / denominator;
  }
  return { ax, ay };
}

function finiteObject(object) {
  return ['x', 'y', 'vx', 'vy', 'm', 'r'].every(key => Number.isFinite(object[key])) &&
    object.m >= 0 && object.r >= 0;
}

function validModel(model) {
  return ['gravity', 'softening', 'maxStep', 'timeScale', 'maxFrame']
    .every(key => Number.isFinite(model[key])) && model.gravity >= 0 &&
    model.softening > 0 && model.maxStep > 0 && model.timeScale > 0 && model.maxFrame > 0;
}

function fail(simulation, reason) {
  simulation.status = 'error';
  simulation.error = reason;
  simulation.accumulator = 0;
}

// Relative straight-line motion during one velocity-first Euler step.
// Tangency alone is not a collision, matching Spike's strict radius rule.
export function collisionFraction(ship, nextShip, body, nextBody) {
  let x = ship.x - body.x, y = ship.y - body.y;
  let dx = (nextShip.x - nextBody.x) - x, dy = (nextShip.y - nextBody.y) - y;
  let radius = ship.r + body.r;
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(dx), Math.abs(dy), radius);
  if (!Number.isFinite(scale)) throw new Error('Переполнение геометрии столкновения');
  if (scale === 0) return null;
  x /= scale; y /= scale; dx /= scale; dy /= scale; radius /= scale;
  const c = x * x + y * y - radius * radius;
  if (c < 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = x * dx + y * dy;
  const closest = Math.max(0, Math.min(1, -b / a));
  if (Math.hypot(x + closest * dx, y + closest * dy) >= radius) return null;
  const discriminant = b * b - a * c;
  const root = Math.sqrt(Math.max(0, discriminant));
  // Stable entry root for an initially separated, approaching pair.
  const entry = c === 0 ? 0 : c / (-b + root);
  return Math.max(0, Math.min(1, entry));
}

export function stepSimulation(simulation, model, dt = model.maxStep) {
  if (simulation.status !== 'running') return;
  if (!validModel(model) || dt !== model.maxStep || !Number.isSafeInteger(simulation.steps) ||
      !Number.isFinite(simulation.time) || !Number.isFinite(simulation.accumulator)) {
    fail(simulation, 'Некорректные параметры шага'); return;
  }
  const objects = [...simulation.bodies, simulation.ship];
  if (!objects.every(finiteObject)) { fail(simulation, 'Некорректное состояние тел'); return; }
  // Commit only a finite, fully calculated step. Errors preserve the last valid state.
  const next = objects.map(object => ({ ...object }));
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].fixed) continue;
    const a = acceleration(objects[i], simulation.bodies, model);
    next[i].vx += a.ax * dt;
    next[i].vy += a.ay * dt;
    next[i].x += next[i].vx * dt;
    next[i].y += next[i].vy * dt;
  }
  if (!next.every(finiteObject) || !Number.isSafeInteger(simulation.steps + 1)) {
    fail(simulation, 'Численное переполнение'); return;
  }
  let fraction = 1, collisionId = null;
  try {
    for (let i = 0; i < simulation.bodies.length; i++) {
      const hit = collisionFraction(simulation.ship, next.at(-1), objects[i], next[i]);
      // Equal event times use scenario/placement order as a stable tie breaker.
      if (hit !== null && (collisionId === null || hit < fraction)) {
        fraction = hit; collisionId = objects[i].id;
      }
    }
  } catch (error) { fail(simulation, error.message); return; }
  const time = (simulation.steps + fraction) * dt;
  if (!Number.isFinite(time)) { fail(simulation, 'Переполнение времени'); return; }
  const committed = next.map((object, i) => ({ ...object,
    x: fraction === 1 ? object.x : objects[i].x * (1 - fraction) + object.x * fraction,
    y: fraction === 1 ? object.y : objects[i].y * (1 - fraction) + object.y * fraction,
  }));
  if (!committed.every(finiteObject)) { fail(simulation, 'Переполнение позиции контакта'); return; }
  for (let i = 0; i < objects.length; i++) {
    if (!objects[i].fixed) Object.assign(objects[i], committed[i]);
  }
  simulation.steps++;
  simulation.time = time;
  if (collisionId !== null) {
    simulation.status = 'collision';
    simulation.collisionId = collisionId;
    simulation.collisionFraction = fraction;
    simulation.accumulator = 0;
  }
  const { ship, trail } = simulation;
  if (!trail.length || simulation.time - trail.at(-1).t > 0.12 || collisionId !== null) {
    trail.push({ x: ship.x, y: ship.y, t: simulation.time });
    if (trail.length > 1200) trail.shift();
  }
}

export function discardFrameTime(simulation) {
  simulation.accumulator = 0;
}

export function advanceFrame(simulation, model, realSeconds) {
  if (simulation.status !== 'running') return;
  if (!validModel(model) || !Number.isFinite(realSeconds) ||
      !Number.isFinite(simulation.accumulator)) {
    fail(simulation, 'Некорректное время кадра'); return;
  }
  simulation.accumulator += Math.min(Math.max(0, realSeconds), model.maxFrame) * model.timeScale;
  // Only complete fixed steps; roundoff at a step boundary must not lose a tick.
  const ticks = Math.floor(simulation.accumulator / model.maxStep + 1e-10);
  for (let i = 0; i < ticks && simulation.status === 'running'; i++) {
    simulation.accumulator = Math.max(0, simulation.accumulator - model.maxStep);
    stepSimulation(simulation, model);
  }
}
