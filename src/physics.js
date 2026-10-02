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

// Spike's velocity-first integrator and endpoint-only collision rule.
// Frame-independent stepping and swept collisions belong to issue #3.
export function stepSimulation(simulation, model, dt) {
  const movers = [...simulation.bodies.filter(body => !body.fixed), simulation.ship];
  for (const object of movers) {
    const a = acceleration(object, simulation.bodies, model);
    object.vx += a.ax * dt;
    object.vy += a.ay * dt;
  }
  for (const object of movers) {
    object.x += object.vx * dt;
    object.y += object.vy * dt;
  }
  simulation.time += dt;
  const { ship, trail } = simulation;
  if (!trail.length || simulation.time - trail.at(-1).t > 0.12) {
    trail.push({ x: ship.x, y: ship.y, t: simulation.time });
    if (trail.length > 1200) trail.shift();
  }
  for (const body of simulation.bodies) {
    if (Math.hypot(ship.x - body.x, ship.y - body.y) < body.r + ship.r) {
      simulation.status = 'collision';
      simulation.collisionId = body.id;
      break;
    }
  }
}

export function advanceFrame(simulation, model, realSeconds) {
  if (simulation.status !== 'running') return;
  let remaining = Math.min(Math.max(0, realSeconds), model.maxFrame) * model.timeScale;
  while (remaining > 0) {
    const dt = Math.min(model.maxStep, remaining);
    stepSimulation(simulation, model, dt);
    remaining -= dt;
    if (simulation.status !== 'running') break;
  }
}
