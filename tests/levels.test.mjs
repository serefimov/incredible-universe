import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadLevel, loadTrainingPlan, describeMission, resolveTarget, arrivalSpeed, missionClock } from '../src/levels.js';
import { createGameFromLevel, placeBody, moveBody, removeBody, resetGame, startGame } from '../src/state.js';
import { stepSimulation, advanceFrame } from '../src/physics.js';
import { clockIncrement, potentialAt } from '../src/clocks.js';
const examples = JSON.parse(readFileSync(new URL('../levels/mission-examples.json', import.meta.url), 'utf8'));
const example = (index = 0) => structuredClone(examples[index]);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const physical = game => structuredClone({ ship: game.simulation.ship, bodies: game.simulation.bodies,
  observer: game.simulation.earthObserver, binding: game.simulation.earthBinding,
  time: game.simulation.time, earth: game.simulation.earthYears, shipYears: game.simulation.shipYears,
  steps: game.simulation.steps, trail: game.simulation.trail });

test('пять видов миссий загружаются из JSON и дают задание из фактических данных', () => {
  assert.equal(examples.length, 5);
  for (const input of examples) {
    const level = loadLevel(JSON.stringify(input));
    assert.ok(Object.isFrozen(level.universe.bodies[0]));
    assert.ok(Object.isFrozen(level.mission));
    const task = describeMission(level);
    assert.ok(task.includes(level.title));
    assert.ok(task.includes(String(level.mission.maxCoordinateYears)));
    if (level.mission.target) assert.ok(task.includes(String(level.mission.target.radius)));
  }
  const custom = example(3);
  custom.mission.limits = { relativeSpeed: { min: 12, max: 67 }, earthYears: { max: 123 } };
  const task = describeMission(loadLevel(custom));
  assert.match(task, /не менее 12, не более 67/); assert.match(task, /Земное время.*123/);
});

test('неверные интервалы, цель, горизонт, версия и начальная физика отклоняются', () => {
  const cases = [
    level => { level.mission.limits.shipYears = { min: 20, max: 10 }; },
    level => { level.mission.limits.shipYears = {}; },
    level => { level.mission.limits.relativeSpeed.max = Infinity; },
    level => { level.mission.target.centre.bodyId = 'absent'; },
    level => { level.mission.target.radius = -1; },
    level => { delete level.mission.maxCoordinateYears; },
    level => { level.mission.maxCoordinateYears = Infinity; },
    level => { level.mission.maxCoordinateYears = 0; },
    level => { level.mission.limits.earthYears = { min: 501 }; },
    level => { level.schemaVersion = 2; },
    level => { level.mission.typo = 10; },
    level => { level.universe.bodies[1].id = level.universe.bodies[0].id; },
    level => { level.universe.bodies[0].m = NaN; },
    level => { level.universe.bodies[0].vx = 1; },
    level => { level.universe.ship.vx = 1000; },
    level => { level.universe.ship.vx = level.universe.ship.vy = 0; },
    level => { level.universe.physics.softening = 0; },
    level => { level.universe.tray.planet.count = 1.5; },
    level => { level.placement.regions[0].xMax = level.placement.regions[0].xMin; },
    level => { level.universe.earthClock.vx = 1000; },
  ];
  for (const edit of cases) { const level = example(3); edit(level); assert.throws(() => loadLevel(level), TypeError); }
  const final = example(4); final.universe.earthClock.bodyId = 'p2';
  assert.throws(() => loadLevel(final), /Земля/);
  const survival = example(); survival.mission.survive.years = 501;
  assert.throws(() => loadLevel(survival), /горизонтом/);
});

test('исходные данные, загруженный уровень и изменяемый полёт не разделяют объекты', () => {
  const input = example(), initial = structuredClone(input);
  const game = createGameFromLevel(input);
  input.universe.ship.x = 9000; input.mission.survive.years = 0;
  assert.deepEqual(game.level, initial);
  assert.throws(() => { game.level.universe.bodies[0].x = 20; }, TypeError);
  assert.throws(() => { game.level.mission.maxCoordinateYears = 0; }, TypeError);
  startGame(game); stepSimulation(game.simulation, game.scenario.physics);
  assert.notEqual(game.simulation.ship.x, initial.universe.ship.x);
  assert.deepEqual(game.level, initial);
  resetGame(game); assert.equal(game.simulation.ship.x, initial.universe.ship.x);
  assert.equal(game.simulation.earthYears, 0);
});

test('области и количество ящика задаются уровнем; два тела одного типа имеют независимые ID', () => {
  const game = createGameFromLevel(example());
  assert.equal(placeBody(game, 'planet', -1100, -140), false);
  assert.equal(placeBody(game, 'planet', -350, -140), true);
  assert.equal(placeBody(game, 'planet', -300, -250), true);
  assert.equal(placeBody(game, 'planet', -200, -300), false);
  const [first, second] = game.configuration.placed;
  assert.notEqual(first.id, second.id);
  assert.equal(moveBody(game, 'planet', -270, -250, second.id), true);
  assert.equal(game.configuration.placed[0].x, -350);
  const configured = structuredClone(game.configuration), before = physical(game);
  startGame(game); advanceFrame(game.simulation, game.scenario.physics, 0.01);
  assert.equal(removeBody(game, 'planet', first.id), false);
  resetGame(game); assert.deepEqual(game.configuration, configured); assert.deepEqual(physical(game), before);
  assert.equal(removeBody(game, 'planet', second.id), true);
  assert.equal(game.configuration.placed[0].id, first.id);
  assert.equal(placeBody(game, 'planet', -270, -250), true);
  assert.equal(game.configuration.placed[1].id, second.id);
  const circle = example(); circle.placement.regions = [{ kind: 'circle', x: -350, y: -140, radius: 10 }];
  circle.universe.tray.star.count = 0;
  const limited = createGameFromLevel(circle);
  assert.equal(placeBody(limited, 'star', -350, -140), false);
  assert.equal(placeBody(limited, 'planet', -330, -140), false);
  assert.equal(placeBody(limited, 'planet', -350, -140), true);
});

test('движущаяся цель читается из симуляции, скорость прибытия относительна цели', () => {
  const game = createGameFromLevel(example(3)), target = game.level.mission.target;
  const initial = resolveTarget(target, game.simulation);
  near(arrivalSpeed(target, game.simulation), Math.hypot(58, -39));
  startGame(game); stepSimulation(game.simulation, game.scenario.physics);
  const centre = resolveTarget(target, game.simulation), body = game.simulation.bodies.find(b => b.id === 'p1');
  assert.equal(centre.y, body.y); assert.notEqual(centre.y, initial.y);
  assert.equal(centre.vy, body.vy);
  assert.deepEqual(resolveTarget({ centre: { kind: 'fixed', x: 2, y: 3 }, radius: 4 }, game.simulation), { x: 2, y: 3, vx: 0, vy: 0, radius: 4 });
});

test('земной наблюдатель следует своему телу с мировым смещением, а часы считают его поле и скорость', () => {
  const game = createGameFromLevel(example(4)), s = game.simulation;
  const before = structuredClone(s);
  startGame(game); stepSimulation(s, game.scenario.physics);
  const body = s.bodies.find(b => b.id === 'p1');
  assert.deepEqual(s.earthObserver, { x: body.x + 16, y: body.y, vx: body.vx, vy: body.vy });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const sources = s.bodies.map((body, i) => ({ ...body, ...mid(before.bodies[i], body) }));
  const expected = clockIncrement(s.ship.vx, s.ship.vy, game.scenario.physics.maxStep, undefined, {
    shipPotential: potentialAt(mid(before.ship, s.ship), sources, game.scenario.physics),
    earthPotential: potentialAt(mid(before.earthObserver, s.earthObserver), sources, game.scenario.physics),
    earthVx: body.vx, earthVy: body.vy,
  });
  near(s.earthYears, expected.earth); near(s.shipYears, expected.ship);
  assert.equal(missionClock(s, 'earth'), s.earthYears); assert.equal(missionClock(s, 'ship'), s.shipYears);
  assert.equal(missionClock(s, 'coordinate'), s.time * 100);
  resetGame(game); assert.deepEqual(game.simulation.earthObserver, before.earthObserver);
});

test('ошибка привязанного наблюдателя атомарно сохраняет тело, корабль и оба времени', () => {
  const input = example(4); input.universe.physics.gravity = 0;
  const game = createGameFromLevel(input); startGame(game);
  game.simulation.bodies.find(b => b.id === 'p1').vy = 1000;
  const before = physical(game);
  stepSimulation(game.simulation, game.scenario.physics);
  assert.equal(game.simulation.status, 'error'); assert.deepEqual(physical(game), before);
});

test('полный полёт уровня до столкновения и Reset воспроизводят состояние', () => {
  const input = example(); input.mission.survive.years = 300; input.mission.maxCoordinateYears = 500;
  const game = createGameFromLevel(input);
  const fly = () => {
    startGame(game);
    for (let i = 0; i < 2000 && game.simulation.status === 'running'; i++) stepSimulation(game.simulation, game.scenario.physics);
    assert.equal(game.simulation.status, 'lose'); assert.equal(game.simulation.result.reason, 'collision'); return physical(game);
  };
  const first = fly(); resetGame(game); assert.deepEqual(fly(), first);
});

test('описание первого аварийного запуска и открытия ящика выражается данными', () => {
  const input = example();
  input.tutorial = { showFutureTrajectory: false, showMotionVector: true, steps: [
    { id: 'observe', text: 'Ничего не меняйте и нажмите Play.', until: 'collision', availableCounts: { planet: 0 } },
    { id: 'intervene', text: 'После Reset добавьте планету.', until: 'success', availableCounts: { planet: 1 } },
  ] };
  assert.ok(Object.isFrozen(loadLevel(input).tutorial.steps[0]));
  input.tutorial.steps[1].availableCounts.planet = 3;
  assert.throws(() => loadLevel(input), /количество/);
});

test('привязанные земные часы учитывают только дробь шага до движущегося столкновения', () => {
  const input = example(4); input.universe.physics.gravity = 0;
  input.universe.bodies = [{ id: 'p1', type: 'fixedPlanet', label: 'Земля', x: 0, y: 0, vx: 300, vy: 0, m: 0, r: 0.1, fixed: false }];
  Object.assign(input.universe.ship, { x: -1, y: 0, vx: 800, vy: 0, r: 0.1 });
  const game = createGameFromLevel(input); startGame(game); stepSimulation(game.simulation, game.scenario.physics);
  const s = game.simulation;
  assert.equal(s.status, 'lose'); assert.equal(s.result.reason, 'collision'); near(s.time, 0.0016);
  near(s.earthObserver.x, 16.48); near(s.earthYears, 0.16 * Math.sqrt(0.91)); near(s.shipYears, 0.096);
});


test('все шесть названий обучения и первый аварийный запуск сохранены в плане', () => {
  const input = JSON.parse(readFileSync(new URL('../levels/training-plan.json', import.meta.url), 'utf8'));
  const plan = loadTrainingPlan(input, examples);
  assert.deepEqual(plan.levels.map(level => level.title), ['Первое вмешательство', 'Гравитационный манёвр', 'Мягкое прибытие', 'Наперегонки со временем', 'Окно встречи', 'Без подсказок']);
  assert.deepEqual(plan.levels[0].steps.map(step => step.availableCounts.planet), [0, 1]);
  assert.ok(plan.levels.slice(3).every(level => level.deadlineClock === 'ship'));
  assert.throws(() => createGameFromLevel(plan.levels[0]), TypeError, 'дизайн не выдаётся за играбельную сцену');
  input.levels[1].missionExample = 'missing';
  assert.throws(() => loadTrainingPlan(input, examples), /примера/);
});
