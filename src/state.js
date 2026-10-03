// SPDX-License-Identifier: GPL-3.0-or-later
import { SPIKE_SCENARIO } from './scenario.js';
import { CLOCK_CONTRACT } from './clocks.js';
import { loadLevel, initialEarthObserver } from './levels.js';

export function createSimulation(scenario, configuration) {
  return {
    status: 'ready', time: 0, steps: 0, accumulator: 0, trail: [],
    collisionId: null, collisionFraction: null, error: null, result: null,
    clockVersion: CLOCK_CONTRACT.version, earthYears: 0, shipYears: 0,
    earthCorrection: 0, shipCorrection: 0,
    earthObserver: scenario.earthClock?.kind === 'body' ? initialEarthObserver(scenario) :
      { ...(scenario.earthClock ?? { x: scenario.ship.x, y: scenario.ship.y, vx: 0, vy: 0 }) },
    ...(scenario.earthClock?.kind === 'body' ? { earthBinding: { bodyId: scenario.earthClock.bodyId,
      offset: { ...(scenario.earthClock.offset ?? { x: 0, y: 0 }) } } } : {}),
    ship: { ...scenario.ship },
    bodies: [
      ...scenario.bodies.map(body => ({ ...body })),
      ...configuration.placed.map(placement => ({
        id: placement.id ?? `user_${placement.type}`, type: placement.type,
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

export function createGameFromLevel(input) {
  const level = loadLevel(input);
  return { ...createGame(level.universe), level };
}

export function canEditConfiguration(game) {
  return game.simulation.status === 'ready';
}

export function availableCount(game, type) {
  const spec = game.scenario.tray[type];
  if (!spec) return 0;
  return Math.max(0, (spec.count ?? 1) - game.configuration.placed.filter(p => p.type === type).length);
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
  if (!canEditConfiguration(game) || !spec || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const { ship, bodies } = game.simulation;
  const policy = game.level?.placement;
  if (policy && !policy.regions.some(region => region.kind === 'circle'
    ? Math.hypot(x - region.x, y - region.y) <= region.radius
    : x >= region.xMin && x <= region.xMax && y >= region.yMin && y <= region.yMax)) return false;
  if (Math.hypot(x - ship.x, y - ship.y) < (policy?.shipClearance ?? 90)) return false;
  return bodies.every(body => body.id === ignoreId ||
    Math.hypot(x - body.x, y - body.y) >= spec.r + body.r + (policy?.bodyGap ?? 12));
}

export function placeBody(game, type, x, y) {
  if (!canEditConfiguration(game) || availableCount(game, type) === 0 ||
      !validPlacement(game, type, x, y)) return false;
  const placement = { type, x, y };
  if (game.level || (game.scenario.tray[type].count ?? 1) > 1) {
    let index = 1;
    const candidate = () => `user_${type}${index === 1 ? '' : `_${index}`}`;
    while (game.configuration.placed.some(p => p.id === candidate())) index++;
    placement.id = candidate();
  }
  game.configuration.placed.push(placement);
  resetGame(game);
  return true;
}

export function moveBody(game, type, x, y, id = null) {
  const placement = game.configuration.placed.find(p => p.type === type && (id === null || (p.id ?? `user_${p.type}`) === id));
  if (!canEditConfiguration(game) || !placement) return false;
  if (!validPlacement(game, type, x, y, placement.id ?? `user_${type}`)) return false;
  placement.x = x;
  placement.y = y;
  resetGame(game);
  return true;
}

export function removeBody(game, type, id = null) {
  const index = game.configuration.placed.findIndex(p => p.type === type && (id === null || (p.id ?? `user_${p.type}`) === id));
  if (!canEditConfiguration(game) || index === -1) return false;
  game.configuration.placed.splice(index, 1);
  resetGame(game);
  return true;
}

