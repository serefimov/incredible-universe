// SPDX-License-Identifier: GPL-3.0-or-later
import { CLOCK_CONTRACT, clockRate, potentialAt } from './clocks.js';

const fail = (path, reason) => { throw new TypeError(`${path}: ${reason}`); };
const object = (value, path) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'ожидается объект'); };
const keys = (value, names, path) => {
  object(value, path);
  for (const key of Object.keys(value)) if (!names.includes(key)) fail(`${path}.${key}`, 'неизвестное поле');
};
const number = (value, path, min = -Infinity, positive = false) => {
  if (!Number.isFinite(value) || value < min || (positive && value <= min)) fail(path, 'недопустимое конечное число');
};
const text = (value, path) => { if (typeof value !== 'string' || !value.trim()) fail(path, 'ожидается непустой текст'); };
const id = (value, path) => { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) fail(path, 'ожидается идентификатор'); };
const freeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
};
const point = (value, path) => { number(value.x, `${path}.x`); number(value.y, `${path}.y`); };
function interval(value, path) {
  keys(value, ['min', 'max'], path);
  if (value.min === undefined && value.max === undefined) fail(path, 'пустой интервал');
  if (value.min !== undefined) number(value.min, `${path}.min`, 0);
  if (value.max !== undefined) number(value.max, `${path}.max`, 0);
  if (value.min !== undefined && value.max !== undefined && value.min > value.max) fail(path, 'min больше max');
}
function body(value, path, ship = false) {
  keys(value, ['id', 'type', 'x', 'y', 'vx', 'vy', 'm', 'r', 'fixed', 'label'], path);
  id(value.id, `${path}.id`); point(value, path);
  for (const key of ['vx', 'vy']) number(value[key], `${path}.${key}`);
  for (const key of ['m', 'r']) number(value[key], `${path}.${key}`, 0);
  if (typeof value.fixed !== 'boolean' || (ship && value.fixed) ||
      (value.fixed && (value.vx !== 0 || value.vy !== 0))) fail(path, 'некорректное fixed');
  if (!ship) { text(value.label, `${path}.label`); text(value.type, `${path}.type`); }
}
function centre(value, path, bodies) {
  if (value?.kind === 'fixed') { keys(value, ['kind', 'x', 'y'], path); point(value, path); }
  else if (value?.kind === 'body') {
    keys(value, ['kind', 'bodyId', 'offset'], path);
    if (!bodies.some(body => body.id === value.bodyId)) fail(`${path}.bodyId`, 'нет исходного тела');
    if (value.offset !== undefined) { keys(value.offset, ['x', 'y'], `${path}.offset`); point(value.offset, `${path}.offset`); }
  } else fail(path, 'центр должен быть fixed или body');
}

// Versioned JSON data, cloned before freezing; authoring data never becomes live state.
export function loadLevel(input) {
  const level = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  keys(level, ['schemaVersion', 'id', 'title', 'description', 'purpose', 'universe', 'placement', 'mission', 'tutorial'], 'level');
  if (level.schemaVersion !== 1) fail('level.schemaVersion', 'неизвестная версия формата');
  id(level.id, 'level.id'); text(level.title, 'level.title'); text(level.description, 'level.description');
  if (!['campaign', 'contract-example'].includes(level.purpose)) fail('level.purpose', 'ожидается campaign или contract-example');
  const u = level.universe;
  keys(u, ['id', 'physics', 'camera', 'bodies', 'ship', 'tray', 'earthClock'], 'universe');
  id(u.id, 'universe.id');
  keys(u.physics, ['version', 'gravity', 'softening', 'maxStep', 'timeScale', 'maxFrame'], 'physics');
  if (u.physics.version !== 'fixed-euler-swept-v1') fail('physics.version', 'неизвестная модель');
  number(u.physics.gravity, 'physics.gravity', 0);
  for (const key of ['softening', 'maxStep', 'timeScale', 'maxFrame']) number(u.physics[key], `physics.${key}`, 0, true);
  keys(u.camera, ['x', 'y', 'zoom'], 'camera'); point(u.camera, 'camera'); number(u.camera.zoom, 'camera.zoom', 0, true);
  if (!Array.isArray(u.bodies)) fail('universe.bodies', 'ожидается массив');
  u.bodies.forEach((b, i) => body(b, `bodies[${i}]`)); body(u.ship, 'ship', true);
  const ids = [u.ship.id, ...u.bodies.map(b => b.id)];
  if (new Set(ids).size !== ids.length) fail('bodies.id', 'повторяющиеся идентификаторы');
  if (Math.hypot(u.ship.vx, u.ship.vy) === 0) fail('ship', 'нужна ненулевая стартовая скорость');
  keys(u.tray, ['planet', 'giant', 'star'], 'tray');
  for (const [type, spec] of Object.entries(u.tray)) {
    keys(spec, ['m', 'r', 'drawR', 'label', 'count'], `tray.${type}`);
    for (const key of ['m', 'r']) number(spec[key], `tray.${type}.${key}`, 0);
    number(spec.drawR, `tray.${type}.drawR`, 0, true); text(spec.label, `tray.${type}.label`);
    if (!Number.isSafeInteger(spec.count) || spec.count < 0) fail(`tray.${type}.count`, 'нужно целое количество >= 0');
  }
  const clock = u.earthClock;
  if (clock?.kind === 'inertial') {
    keys(clock, ['kind', 'x', 'y', 'vx', 'vy'], 'earthClock'); point(clock, 'earthClock');
    number(clock.vx, 'earthClock.vx'); number(clock.vy, 'earthClock.vy');
  } else centre(clock, 'earthClock', u.bodies);
  if (clock.kind === 'fixed') fail('earthClock', 'используйте inertial с явной скоростью');
  const observer = initialEarthObserver(u);
  try {
    clockRate(u.ship.vx, u.ship.vy, potentialAt(u.ship, u.bodies, u.physics));
    clockRate(observer.vx, observer.vy, potentialAt(observer, u.bodies, u.physics));
  } catch (error) { fail('clock', error.message); }
  const placement = level.placement;
  keys(placement, ['regions', 'shipClearance', 'bodyGap'], 'placement');
  number(placement.shipClearance, 'placement.shipClearance', 0); number(placement.bodyGap, 'placement.bodyGap', 0);
  if (!Array.isArray(placement.regions) || !placement.regions.length) fail('placement.regions', 'нужна разрешённая область');
  for (const [i, region] of placement.regions.entries()) {
    const path = `placement.regions[${i}]`;
    if (region.kind === 'circle') { keys(region, ['kind', 'x', 'y', 'radius'], path); point(region, path); number(region.radius, `${path}.radius`, 0, true); }
    else if (region.kind === 'rect') {
      keys(region, ['kind', 'xMin', 'xMax', 'yMin', 'yMax'], path);
      for (const key of ['xMin', 'xMax', 'yMin', 'yMax']) number(region[key], `${path}.${key}`);
      if (region.xMin >= region.xMax || region.yMin >= region.yMax) fail(path, 'пустая или перевёрнутая область');
    } else fail(path, 'неизвестная форма');
  }
  const mission = level.mission;
  keys(mission, ['type', 'maxCoordinateYears', 'survive', 'target', 'limits'], 'mission');
  number(mission.maxCoordinateYears, 'mission.maxCoordinateYears', 0, true);
  if (mission.type === 'survival') {
    keys(mission.survive, ['clock', 'years'], 'mission.survive');
    if (!['coordinate', 'earth', 'ship'].includes(mission.survive.clock)) fail('mission.survive.clock', 'неизвестные часы');
    number(mission.survive.years, 'mission.survive.years', 0, true);
    if (mission.survive.years > mission.maxCoordinateYears) fail('mission.survive', 'цель за горизонтом (собственные часы не быстрее координатных)');
    if (mission.target !== undefined || mission.limits !== undefined) fail('mission', 'лишние условия выживания');
  } else if (['arrival', 'earth-return'].includes(mission.type)) {
    if (mission.survive !== undefined) fail('mission.survive', 'лишнее условие');
    keys(mission.target, ['centre', 'radius'], 'mission.target');
    centre(mission.target.centre, 'mission.target.centre', u.bodies);
    number(mission.target.radius, 'mission.target.radius', 0, true);
    keys(mission.limits, ['earthYears', 'shipYears', 'relativeSpeed'], 'mission.limits');
    for (const [key, value] of Object.entries(mission.limits)) interval(value, `mission.limits.${key}`);
    for (const key of ['earthYears', 'shipYears']) {
      if ((mission.limits[key]?.min ?? 0) > mission.maxCoordinateYears) fail(`mission.limits.${key}`, 'нижняя граница за горизонтом');
    }
    if (mission.type === 'earth-return') {
      if (clock.kind !== 'body' || mission.target.centre.kind !== 'body' ||
          mission.target.centre.bodyId !== clock.bodyId) fail('mission.target', 'Земля должна быть целью и земным наблюдателем');
      if (mission.limits.earthYears?.min === undefined || mission.limits.shipYears?.max === undefined ||
          mission.limits.relativeSpeed?.max === undefined) fail('mission.limits', 'возврат требует обоих времён и скорости');
    }
  } else fail('mission.type', 'неизвестная миссия');
  if (level.tutorial !== undefined) {
    keys(level.tutorial, ['showFutureTrajectory', 'showMotionVector', 'steps'], 'tutorial');
    if (level.tutorial.showFutureTrajectory !== false || level.tutorial.showMotionVector !== true) fail('tutorial', 'обучение показывает только короткий вектор движения');
    if (!Array.isArray(level.tutorial.steps)) fail('tutorial.steps', 'ожидается массив');
    const stepIds = new Set();
    for (const step of level.tutorial.steps) {
      keys(step, ['id', 'text', 'until', 'availableCounts'], 'tutorial.step');
      id(step.id, 'tutorial.step.id'); text(step.text, 'tutorial.step.text');
      if (stepIds.has(step.id)) fail('tutorial.steps', 'повторяющийся шаг'); stepIds.add(step.id);
      if (!['collision', 'success'].includes(step.until)) fail('tutorial.step.until', 'неизвестный переход');
      keys(step.availableCounts, Object.keys(u.tray), 'tutorial.step.availableCounts');
      for (const [type, count] of Object.entries(step.availableCounts)) {
        if (!Number.isSafeInteger(count) || count < 0 || count > u.tray[type].count) fail('tutorial.step.availableCounts', 'количество вне ящика');
      }
    }
  }
  return freeze(level);
}

export function initialEarthObserver(universe) {
  const clock = universe.earthClock;
  if (clock.kind !== 'body') return { x: clock.x, y: clock.y, vx: clock.vx, vy: clock.vy };
  const body = universe.bodies.find(body => body.id === clock.bodyId);
  const offset = clock.offset ?? { x: 0, y: 0 };
  return { x: body.x + offset.x, y: body.y + offset.y, vx: body.vx, vy: body.vy };
}

// Geometry and world relative speed are shared readers, not Win/Lose decisions.
export function resolveTarget(target, simulation) {
  const c = target.centre;
  if (c.kind === 'fixed') return { x: c.x, y: c.y, vx: 0, vy: 0, radius: target.radius };
  const body = simulation.bodies.find(body => body.id === c.bodyId);
  if (!body) throw new RangeError('Целевое тело отсутствует в симуляции');
  return { x: body.x + (c.offset?.x ?? 0), y: body.y + (c.offset?.y ?? 0), vx: body.vx, vy: body.vy, radius: target.radius };
}
export function arrivalSpeed(target, simulation) {
  const centre = resolveTarget(target, simulation);
  return Math.hypot(simulation.ship.vx - centre.vx, simulation.ship.vy - centre.vy);
}
export function missionClock(simulation, clock) {
  if (clock === 'earth') return simulation.earthYears;
  if (clock === 'ship') return simulation.shipYears;
  if (clock === 'coordinate') return simulation.time * CLOCK_CONTRACT.yearsPerUnit;
  throw new RangeError('Неизвестные часы миссии');
}

export function describeMission(level) {
  const mission = level.mission;
  const clockNames = { coordinate: 'координатного времени', earth: 'земного времени', ship: 'собственного времени корабля' };
  const lines = [level.title, level.description];
  if (mission.type === 'survival') lines.push(`Избегайте столкновений в течение ${mission.survive.years} лет ${clockNames[mission.survive.clock]}.`);
  else {
    const centre = mission.target.centre;
    const name = centre.kind === 'body' ? level.universe.bodies.find(b => b.id === centre.bodyId).label : `(${centre.x}, ${centre.y})`;
    lines.push(`Достигните области вокруг ${name}, радиус ${mission.target.radius} мировых единиц; положение определяется центром корабля.`);
    for (const [key, limit] of Object.entries(mission.limits)) {
      const name = { earthYears: 'Земное время (лет)', shipYears: 'Собственное время корабля (лет)', relativeSpeed: 'Скорость относительно цели (мировых единиц / единицу времени)' }[key];
      const parts = [];
      if (limit.min !== undefined) parts.push(`не менее ${limit.min}`);
      if (limit.max !== undefined) parts.push(`не более ${limit.max}`);
      lines.push(`${name}: ${parts.join(', ')}.`);
    }
  }
  lines.push(`Предел попытки: ${mission.maxCoordinateYears} координатных лет.`);
  return lines.join('\n');
}

// Author's design plan is deliberately separate from runnable, balanced levels.
export function loadTrainingPlan(input, examples) {
  const plan = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  keys(plan, ['schemaVersion', 'source', 'status', 'levels'], 'training');
  if (plan.schemaVersion !== 1 || plan.status !== 'design') fail('training', 'неизвестный план');
  text(plan.source, 'training.source');
  if (!Array.isArray(plan.levels) || plan.levels.length < 5 || plan.levels.length > 10) fail('training.levels', 'план MVP содержит 5–10 уровней');
  const ids = new Set(), titles = new Set();
  for (const level of plan.levels) {
    keys(level, ['id', 'title', 'description', 'status', 'missionExample', 'introduces', 'showFutureTrajectory', 'showMotionVector', 'steps', 'deadlineClock'], 'training.level');
    id(level.id, 'training.level.id'); text(level.title, 'training.level.title'); text(level.description, 'training.level.description');
    if (ids.has(level.id) || titles.has(level.title)) fail('training.level', 'повторяющийся уровень');
    ids.add(level.id); titles.add(level.title);
    if (level.status !== 'design' || level.showFutureTrajectory !== false || level.showMotionVector !== true) fail('training.level', 'неверный статус или подсказка');
    text(level.introduces, 'training.level.introduces');
    if (level.deadlineClock !== undefined && ![null, 'earth', 'ship'].includes(level.deadlineClock)) fail('training.level.deadlineClock', 'неизвестные часы');
    const example = examples.find(example => example.id === level.missionExample);
    if (!example || example.purpose !== 'contract-example') fail('training.level.missionExample', 'нет примера формата');
    loadLevel({ ...example, tutorial: { showFutureTrajectory: false, showMotionVector: true, steps: level.steps } });
  }
  return freeze(plan);
}
