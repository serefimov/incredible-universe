// SPDX-License-Identifier: GPL-3.0-or-later
import messages from '../levels/tutorial-messages.json' with { type: 'json' };
import { earthClockBody } from './clock-display.js';

export function tutorialStep(game) {
  return game.tutorial ? game.level.tutorial.steps[game.tutorial.stepIndex] : null;
}

export function trayCount(game, type) {
  const count = game.scenario.tray[type]?.count ?? (game.scenario.tray[type] ? 1 : 0);
  const step = tutorialStep(game);
  return step ? Math.min(count, step.availableCounts[type] ?? 0) : count;
}

export function tutorialConditionMet(game) {
  const step = tutorialStep(game), s = game.simulation;
  return Boolean(step && (step.until === 'collision'
    ? s.status === 'lose' && s.result?.outcome === 'lose' && s.result.reason === 'collision'
    : s.status === 'win' && s.result?.outcome === 'win'));
}

// Only explicit Reset advances a step. Editing a ready configuration cannot
// unlock a body, and physics never reads or writes tutorial progress.
export function resetTutorial(game) {
  if (!game.tutorial) return;
  if (game.tutorial.completed || !tutorialConditionMet(game)) return;
  if (game.tutorial.stepIndex + 1 < game.level.tutorial.steps.length) game.tutorial.stepIndex++;
  else game.tutorial.completed = true;
}

export function tutorialHint(game) {
  const step = tutorialStep(game);
  if (!step) return '';
  const s = game.simulation;
  if (s.status === 'error') return 'Ошибка расчёта. Нажмите Сброс и повторите попытку; обучение не пропущено.';
  if (s.status === 'running') return game.camera.follow
    ? 'Наблюдайте за полётом и часами корабля. Сдвиг карты отключит слежение; «К кораблю» вернёт его.'
    : 'Вы двигаете карту сами. Нажмите «К кораблю», чтобы снова следить за полётом.';
  if (s.status !== 'ready') {
    if (step.until === 'collision' && tutorialConditionMet(game)) return 'Корабль столкнулся со звездой. Нажмите Сброс — появится одна планета.';
    if (s.status === 'win') return 'Получилось! Вы изменили окружение, а не управляли кораблём. Сброс сохранит планету для новой попытки.';
    return 'Попытка завершена. Нажмите Сброс, измените положение планеты и попробуйте снова.';
  }
  if (step.until === 'collision') return `${step.text} Стрелка — направление; сверху — часы корабля.`;
  if (game.configuration.placed.length) return 'Планета на месте — нажмите Пуск. После Сброса её можно переставить или вернуть в ящик за ручку.';
  return `${step.text} Карта: один палец — сдвиг, два — масштаб.`;
}

// Prepared copy for later authored scenes (#13), never a claim that they exist.
export function lessonText(game) {
  const lesson = messages.levels[game.level?.id];
  if (!lesson) return '';
  return [lesson, messages.shipClock, ...(earthClockBody(game) ? [messages.earthClock] : [])].join('\n');
}
