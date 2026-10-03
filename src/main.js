// SPDX-License-Identifier: GPL-3.0-or-later
import { createGame, createGameFromLevel, resetGame, startGame } from './state.js';
import { advanceFrame, discardFrameTime } from './physics.js';
import { followShip } from './camera.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { levelFromSearch } from './game-entry.js';
import { describeMission } from './levels.js';

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
if (game.level) missionText.textContent = describeMission(game.level);
const earthLabel = element('earth-clock-label');
const observerBody = game.scenario.earthClock?.kind === 'body'
  ? game.scenario.bodies.find(body => body.id === game.scenario.earthClock.bodyId) : null;
earthLabel.textContent = observerBody ? `${observerBody.label}:` : 'Опорные часы:';
earthLabel.title = observerBody ? `Часы привязаны к телу «${observerBody.label}»`
  : 'Неподвижный наблюдатель в точке старта; это часы, а не планета Земля.';
const renderer = createRenderer(canvas, stage);
function updateUI() {
  const simulation = game.simulation;
  play.disabled = simulation.status !== 'ready';
  hint.hidden = simulation.status !== 'ready';
  follow.textContent = game.camera.follow ? '🎯 Слежение' : '🎯 Корабль';
  resultText.hidden = !simulation.result;
  if (simulation.result) resultText.textContent = `${simulation.result.outcome === 'win' ? '✓ Победа' : '× Поражение'}: ${simulation.result.message}`;
  status.textContent = simulation.status === 'win' ? '✓ Победа' :
    simulation.status === 'lose' ? '× Поражение' :
    simulation.status === 'error' ? '⚠ ошибка симуляции — нажмите Reset' :
    simulation.status === 'collision' ? '💥 столкновение — нажмите Reset' :
    simulation.status === 'ready' ? 'готово' :
      `v=${Math.hypot(simulation.ship.vx, simulation.ship.vy).toFixed(0)}`;
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

