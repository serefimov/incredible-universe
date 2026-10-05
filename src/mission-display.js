// SPDX-License-Identifier: GPL-3.0-or-later
import { resolveTarget, arrivalSpeed, missionClock } from './levels.js';
import { inRange } from './mission-geometry.js';
import { earthClockBody } from './clock-display.js';
import { tutorialHint, lessonText } from './tutorial.js';

const number = value => Number.isFinite(value) ? `≈${value.toFixed(2)}` : 'нет допустимого значения';
const range = limit => [limit.min === undefined ? '' : `≥ ${limit.min}`,
  limit.max === undefined ? '' : `≤ ${limit.max}`].filter(Boolean).join(' и ');
const clockNames = { ship: 'Часы корабля', earth: 'Часы Земли', coordinate: 'Время модели' };
const briefClocks = { ship: 'по часам корабля', earth: 'по часам Земли', coordinate: 'времени модели' };

function missionBrief(mission) {
  if (!mission) return '';
  if (mission.type === 'survival') {
    return `Выжить ${mission.survive.years} лет ${briefClocks[mission.survive.clock]} без столкновения.`;
  }
  const parts = [`Цель: круг (радиус ${mission.target.radius} мир. ед.), без столкновения`];
  if (mission.limits.relativeSpeed) parts.push(`скорость относительно цели ${range(mission.limits.relativeSpeed)}`);
  for (const [key, clock] of [['shipYears', 'ship'], ['earthYears', 'earth']]) {
    if (mission.limits[key]) parts.push(`${range(mission.limits[key])} лет ${briefClocks[clock]}`);
  }
  return `${parts.join(' · ')}.`;
}

// Read only the committed physical state. Rounding is presentation, never a decision.
export function missionDisplay(game) {
  const s = game.simulation, mission = s.mission;
  const earth = Boolean(earthClockBody(game));
  const rows = [], missing = [], values = [];
  let insideTarget = false;
  const add = (label, value, requirement, met) => {
    rows.push(`${met ? '✓' : '○'} ${label}: ${number(value)}; нужно ${requirement}`);
    if (!met) missing.push(label);
  };
  values.push(`Корабль: ${number(s.shipYears)} лет`);
  if (earth) values.push(`Земля: ${number(s.earthYears)} лет`);
  if (mission?.type === 'survival') {
    const { clock, years } = mission.survive;
    if (clock !== 'earth' || earth) add(clockNames[clock], missionClock(s, clock), `≥ ${years} лет без столкновения`,
      s.result?.reason === 'survived' || missionClock(s, clock) >= years);
    else rows.push(`Условие выживания: ≥ ${years} земных лет. Для показа этих часов нужна Земля.`);
  } else if (mission?.target) {
    const target = resolveTarget(mission.target, s);
    const distance = Math.hypot(s.ship.x - target.x, s.ship.y - target.y);
    const inside = distance <= target.radius;
    insideTarget = inside;
    const arrived = s.result?.reason === 'arrived';
    const centre = mission.target.centre;
    const name = centre.kind === 'body' ? `цели «${s.bodies.find(b => b.id === centre.bodyId).label}»` : 'неподвижной цели';
    add(`До центра ${name}`, distance, `≤ ${target.radius} мир. ед.`, inside || arrived);
    values.push(`До центра цели: ${number(distance)} мир. ед.`);
    if (mission.limits.relativeSpeed) {
      const speed = arrivalSpeed(mission.target, s);
      add('Скорость относительно цели', speed, `${range(mission.limits.relativeSpeed)} мир. ед./ед. времени`,
        inRange(speed, mission.limits.relativeSpeed));
      values.push(`Скорость относительно цели: ${number(speed)} мир. ед./ед. времени`);
    }
    for (const [key, clock] of [['shipYears', 'ship'], ['earthYears', 'earth']]) {
      const limit = mission.limits[key];
      if (!limit) continue;
      if (clock === 'earth' && !earth) {
        rows.push(`Земное условие: ${range(limit)} лет. Для показа этих часов нужна Земля.`);
        continue;
      }
      add(clockNames[clock], s[key], `${range(limit)} лет`, inRange(s[key], limit));
    }
  }
  if (mission) rows.push(`Предел попытки: ${mission.maxCoordinateYears} лет времени модели.`);
  let feedback = s.status === 'ready' ? 'Расставьте тела и нажмите ▶. Все условия должны выполниться одновременно.' : '';
  if (s.status === 'running') feedback = missing.length
    ? `${insideTarget ? 'Корабль в области цели. ' : ''}Полёт продолжается. Пока не выполнено: ${missing.join('; ')}.`
    : 'Полёт продолжается до проверки условий на шаге симуляции.';
  if (s.status === 'win' || s.status === 'lose') feedback = 'Нажмите ↻: часы обнулятся, расстановка сохранится. Затем можно изменить тела.';
  let result = '';
  if (s.result) {
    const body = s.collisionId ? s.bodies.find(b => b.id === s.collisionId) : null;
    result = `${s.result.outcome === 'win' ? '✓ Победа' : '× Поражение'}: ${s.result.message}${body ? ` с телом «${body.label}»` : ''}.\nНа момент завершения:\n${values.join('\n')}`;
  } else if (s.status === 'error' || s.status === 'collision') {
    result = s.status === 'error'
      ? '⚠ Ошибка симуляции. Это не результат миссии. Показано последнее допустимое состояние.'
      : '💥 Столкновение. Полёт остановлен.';
    result += `\n${values.join('\n')}\nНажмите ↻ для новой попытки.`;
  }
  return { tutorial: tutorialHint(game), brief: missionBrief(mission),
    goal: game.level ? [game.level.title, game.level.description, lessonText(game)].filter(Boolean).join('\n') : '',
    conditions: rows.join('\n'), feedback, result, terminal: Boolean(result),
    heading: s.status === 'win' ? '✓ Победа — условия и результат' :
      s.status === 'lose' ? '× Поражение — условия и результат' :
      s.status === 'error' ? '⚠ Ошибка симуляции' :
      s.status === 'collision' ? '💥 Столкновение' : 'Цель и условия' };
}
