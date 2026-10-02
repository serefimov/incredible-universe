// SPDX-License-Identifier: GPL-3.0-or-later
import { SPIKE_SCENARIO } from './scenario.js';

export function createSimulation(scenario, configuration) {
  return {
    status: 'ready', time: 0, steps: 0, accumulator: 0, trail: [],
    collisionId: null, collisionFraction: null, error: null,
    ship: { ...scenario.ship },
    bodies: [
      ...scenario.bodies.map(body => ({ ...body })),
      ...configuration.placed.map(placement => ({
        id: `user_${placement.type}`, type: placement.type,
        x: placement.x, y: placement.y, vx: 0, vy: 0,
        m: scenario.tray[placement.type].m, r: scenario.tray[placement.type].r,
        label: scenario.tray[placement.type].label, fixed: false, user: true,
      })),
    ],
  };
}

export function createGame(scenario = SPIKE_SCENARIO) {
  const configuration = { placed: [] };
  return {
    scenario, configuration,
    simulation: createSimulation(scenario, configuration),
    camera: { ...scenario.camera, follow: false },
  };
}

export function resetGame(game) {
  game.simulation = createSimulation(game.scenario, game.configuration);
  game.camera.follow = false;
}

export function startGame(game) {
  if (game.simulation.status !== 'ready') return false;
  game.simulation.status = 'running';
  game.camera.follow = true;
  return true;
}

export function validPlacement(game, type, x, y, ignoreId = null) {
  const spec = game.scenario.tray[type];
  if (!spec || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const { ship, bodies } = game.simulation;
  if (Math.hypot(x - ship.x, y - ship.y) < 90) return false;
  return bodies.every(body => body.id === ignoreId ||
    Math.hypot(x - body.x, y - body.y) >= spec.r + body.r + 12);
}

export function placeBody(game, type, x, y) {
  if (game.simulation.status === 'running' || game.configuration.placed.some(p => p.type === type) ||
      !validPlacement(game, type, x, y)) return false;
  game.configuration.placed.push({ type, x, y });
  resetGame(game);
  return true;
}

export function moveBody(game, type, x, y) {
  const placement = game.configuration.placed.find(p => p.type === type);
  if (game.simulation.status === 'running' || !placement) return false;
  if (!validPlacement(game, type, x, y, `user_${type}`)) {
    resetGame(game);
    return false;
  }
  placement.x = x;
  placement.y = y;
  resetGame(game);
  return true;
}

export function removeBody(game, type) {
  const index = game.configuration.placed.findIndex(p => p.type === type);
  if (game.simulation.status === 'running' || index === -1) return false;
  game.configuration.placed.splice(index, 1);
  resetGame(game);
  return true;
}

