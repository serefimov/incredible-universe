import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createGame, createGameFromLevel, availableCount, validPlacement, placeBody, moveBody, removeBody, resetGame, startGame } from '../src/state.js';
import { advanceFrame } from '../src/physics.js';
import { tutorialHint, lessonText } from '../src/tutorial.js';

const level = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url)))[0];
function finish(game, schedule = [0.01]) {
  assert.equal(startGame(game), true);
  for (let frame = 0; game.simulation.status === 'running'; frame++) {
    assert.ok(frame < 4000);
    advanceFrame(game.simulation, game.scenario.physics, schedule[frame % schedule.length]);
  }
}

test('обучение: без тел → настоящий Lose/collision → явный Reset → одна планета → Win → правка и повтор', () => {
  const game = createGameFromLevel(level);
  assert.equal(availableCount(game, 'planet'), 0);
  assert.equal(validPlacement(game, 'planet', -110, -120), false);
  assert.equal(placeBody(game, 'planet', -110, -120), false);
  resetGame(game); resetGame(game);
  assert.equal(availableCount(game, 'planet'), 0, 'ready Reset cannot skip observation');
  assert.match(tutorialHint(game), /Пуск без планеты/);
  finish(game);
  assert.equal(game.simulation.result.reason, 'collision');
  assert.equal(game.tutorial.stepIndex, 0);
  assert.equal(availableCount(game, 'planet'), 0, 'collision alone never exposes an editable planet');
  assert.match(tutorialHint(game), /Сброс.*планета/);
  resetGame(game);
  assert.equal(game.tutorial.stepIndex, 1);
  assert.equal(availableCount(game, 'planet'), 1);
  assert.equal(placeBody(game, 'planet', -110, -120), true);
  assert.equal(placeBody(game, 'planet', -105, -120), false);
  const placed = structuredClone(game.configuration);
  finish(game);
  assert.equal(game.simulation.status, 'win');
  resetGame(game);
  assert.equal(game.tutorial.completed, true);
  assert.deepEqual(game.configuration, placed);
  assert.equal(game.simulation.shipYears, 0);
  assert.equal(moveBody(game, 'planet', -105, -120), true);
  finish(game); assert.equal(game.simulation.status, 'win');
  resetGame(game); assert.equal(removeBody(game, 'planet'), true);
  assert.equal(availableCount(game, 'planet'), 1, 'completed tutorial never re-locks the tray');
  finish(game); assert.equal(game.simulation.result.reason, 'collision');
  resetGame(game); assert.equal(game.tutorial.stepIndex, 1);
  assert.equal(placeBody(game, 'planet', -110, -120), true);
  finish(game); assert.equal(game.simulation.status, 'win');
  assert.equal(createGameFromLevel(level).tutorial.stepIndex, 0, 'new session starts the teaching sequence');
});

test('прерванный полёт, численная ошибка, timeout и статус collision свободной сцены не открывают планету', () => {
  const interrupted = createGameFromLevel(level);
  startGame(interrupted); advanceFrame(interrupted.simulation, interrupted.scenario.physics, 0.01);
  resetGame(interrupted); assert.equal(availableCount(interrupted, 'planet'), 0);
  const error = createGameFromLevel(level);
  startGame(error); error.simulation.ship.vx = NaN;
  advanceFrame(error.simulation, error.scenario.physics, 0.01);
  assert.equal(error.simulation.status, 'error');
  resetGame(error); assert.equal(availableCount(error, 'planet'), 0);
  for (const [status, result] of [
    ['lose', {outcome:'lose', reason:'timeout'}],
    ['collision', {outcome:'lose', reason:'collision'}],
    ['win', {outcome:'win', reason:'survived'}],
  ]) {
    const game = createGameFromLevel(level);
    game.simulation.status = status; game.simulation.result = result;
    resetGame(game); assert.equal(game.tutorial.stepIndex, 0, status);
  }
});

test('обучение читает результат, подсказки и камера не меняют воспроизводимый полёт', () => {
  let expected;
  for (const schedule of [[1/30], [1/120], [0.008,0.017,0.033,0.012]]) {
    const game = createGameFromLevel(level);
    const before = structuredClone(game);
    tutorialHint(game); lessonText(game);
    assert.deepEqual(game, before);
    finish(game, schedule); resetGame(game);
    placeBody(game, 'planet', -110, -120);
    game.camera.x += 400; game.camera.zoom = 2;
    finish(game, schedule);
    expected ??= structuredClone(game.simulation);
    assert.deepEqual(game.simulation, expected);
  }
  const game = createGameFromLevel(level); startGame(game);
  game.camera.follow = false;
  assert.match(tutorialHint(game), /«К кораблю»/);
  assert.equal(tutorialHint(createGame()), '');
});

test('подготовленные объяснения следуют LEVELS: срок корабля, относительная скорость, продолжение входа, Земля только при её наличии', () => {
  const messages = JSON.parse(readFileSync(new URL('../levels/tutorial-messages.json', import.meta.url)));
  const plan = JSON.parse(readFileSync(new URL('../levels/training-plan.json', import.meta.url)));
  for (const item of plan.levels) assert.ok(messages.levels[item.id].startsWith(item.title));
  for (const id of ['training-4','training-5','training-6']) assert.match(messages.levels[id], /часам корабля/);
  assert.match(messages.levels['training-3'], /относительно.*продолжается/);
  assert.match(messages.levels['training-4'], /Ранний вход.*продолжает/);
  assert.doesNotMatch(lessonText(createGameFromLevel(level)), /часы Земли|В этой миссии есть Земля/);
  const earth = createGameFromLevel(JSON.parse(readFileSync(new URL('../levels/mission-examples.json', import.meta.url))).at(-1));
  // Copy is introduced with an authored campaign identity, not in diagnostic examples.
  earth.level = {...earth.level, id:'training-5'};
  assert.match(lessonText(earth), /В этой миссии есть Земля/);
});
