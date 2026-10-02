// SPDX-License-Identifier: GPL-3.0-or-later
import { createGame, resetGame, startGame } from './state.js';
import { advanceFrame, discardFrameTime } from './physics.js';
import { followShip } from './camera.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';

const element = id => document.getElementById(id);
const canvas = element('c'), stage = element('stage');
const play = element('play'), reset = element('reset'), follow = element('follow');
const status = element('status'), hint = element('hint');
const cards = [...document.querySelectorAll('.card')];
const game = createGame();
const renderer = createRenderer(canvas, stage);
function updateUI() {
  const simulation = game.simulation;
  play.disabled = simulation.status !== 'ready';
  hint.hidden = simulation.status !== 'ready';
  follow.textContent = game.camera.follow ? '🎯 Слежение' : '🎯 Корабль';
  status.textContent = simulation.status === 'error' ? '⚠ ошибка симуляции — нажмите Reset' :
    simulation.status === 'collision' ? '💥 столкновение' :
    simulation.status === 'ready' ? 't = 0' :
      `t = ${simulation.time.toFixed(1)}  v=${Math.hypot(simulation.ship.vx, simulation.ship.vy).toFixed(0)}`;
  for (const card of cards) {
    const used = game.configuration.placed.some(p => p.type === card.dataset.type);
    card.classList.toggle('used', used);
    card.setAttribute('aria-disabled', String(used || simulation.status === 'running'));
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
new ResizeObserver(() => renderer.resize()).observe(stage);
updateUI();
requestAnimationFrame(frame);

