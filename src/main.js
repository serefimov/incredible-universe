// SPDX-License-Identifier: GPL-3.0-or-later
import { createGame, createGameFromLevel, resetGame, startGame } from './state.js';
import { advanceFrame, discardFrameTime } from './physics.js';
import { followShip } from './camera.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { levelFromSearch } from './game-entry.js';
import { earthClockBody } from './clock-display.js';
import { missionDisplay } from './mission-display.js';

const element = id => document.getElementById(id);
const canvas = element('c'), stage = element('stage');
const play = element('play'), reset = element('reset'), follow = element('follow');
const status = element('status'), hint = element('hint');
const earthTime = element('earth-time'), shipTime = element('ship-time');
const cards = [...document.querySelectorAll('.card')];
const selectedLevel = levelFromSearch(globalThis.location?.search ?? '');
const game = selectedLevel ? createGameFromLevel(selectedLevel) : createGame();
const missionText = element('mission'), resultText = element('result');
missionText.hidden = !game.level;
const missionPanel = element('mission-panel');
let wasTerminal = false;
const earthLabel = element('earth-clock-label');
const earthClock = element('earth-clock');
const observerBody = earthClockBody(game);
earthClock.hidden = !observerBody;
earthLabel.textContent = 'Земля:';
if (observerBody) earthLabel.title = `Часы на теле «${observerBody.label}»`;
const renderer = createRenderer(canvas, stage);
function updateUI() {
  const simulation = game.simulation;
  play.disabled = simulation.status !== 'ready';
  hint.hidden = simulation.status !== 'ready';
  follow.textContent = game.camera.follow ? '🎯 Слежение' : '🎯 Корабль';
  const display = missionDisplay(game);
  missionPanel.hidden = !game.level && !display.terminal;
  element('mission-heading').textContent = display.heading;
  missionText.textContent = display.goal;
  element('conditions').textContent = display.conditions;
  element('mission-feedback').textContent = display.feedback;
  resultText.hidden = !display.result;
  resultText.textContent = display.result;
  if (display.terminal && !wasTerminal) {
    missionPanel.open = true;
    element('mission-body').scrollTop = resultText.offsetTop;
  }
  wasTerminal = display.terminal;
  status.textContent = simulation.status === 'win' ? '✓ Победа' :
    simulation.status === 'lose' ? '× Поражение' :
    simulation.status === 'error' ? '⚠ ошибка симуляции — нажмите Reset' :
    simulation.status === 'collision' ? '💥 столкновение — нажмите Reset' :
    simulation.status === 'ready' ? 'Расстановка' : 'Полёт';
  earthTime.textContent = simulation.earthYears.toFixed(2);
  shipTime.textContent = simulation.shipYears.toFixed(2);
  for (const card of cards) {
    const spec = game.scenario.tray[card.dataset.type];
    const used = !spec || game.configuration.placed.filter(p => p.type === card.dataset.type).length >= (spec.count ?? 1);
    card.hidden = !spec;
    card.classList.toggle('used', used);
    card.setAttribute('aria-disabled', String(used || simulation.status !== 'ready'));
  }
}
const input = createInput(game, { canvas, tray: element('tray'), cards,
  getViewport: () => renderer.viewport }, updateUI);
let last = 0;
play.addEventListener('click', () => {
  input.cancel();
  if (startGame(game)) last = performance.now();
  updateUI();
});
reset.addEventListener('click', () => {
  input.cancel(); resetGame(game); updateUI();
  element('mission-body').scrollTop = 0;
});
follow.addEventListener('click', () => {
  game.camera.follow = !game.camera.follow;
  if (game.camera.follow) {
    game.camera.x = game.simulation.ship.x;
    game.camera.y = game.simulation.ship.y;
  }
  updateUI();
});
document.addEventListener('visibilitychange', () => {
  input.cancel();
  last = performance.now();
  discardFrameTime(game.simulation);
});
function frame(now) {
  if (game.simulation.status === 'running' && !document.hidden) {
    advanceFrame(game.simulation, game.scenario.physics, (now - last) / 1000);
    last = now;
    followShip(game.camera, game.simulation.ship);
    updateUI();
  }
  renderer.draw(game, input.state);
  requestAnimationFrame(frame);
}
renderer.resize();
new ResizeObserver(() => { input.cancel(); renderer.resize(); }).observe(stage);
updateUI();
requestAnimationFrame(frame);
