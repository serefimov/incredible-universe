// SPDX-License-Identifier: GPL-3.0-or-later
import data from '../levels/campaign.json' with { type: 'json' };
import { loadLevel } from './levels.js';

export const campaignLevels = Object.freeze(data.map(loadLevel));
const SAVE_KEY = 'incredible-universe.campaign.v1';

// Progress is local to this browser. Storage failures never interrupt a flight.
export function createCampaignProgress(storage) {
  const valid = new Set(campaignLevels.map(level => level.id));
  let backend, completed = new Set();
  try {
    backend = storage ?? globalThis.localStorage;
    const saved = JSON.parse(backend?.getItem(SAVE_KEY) ?? '[]');
    if (Array.isArray(saved)) completed = new Set(saved.filter(id => valid.has(id)));
  } catch { /* Private mode or a broken save starts with in-memory progress. */ }
  function markWin(game) {
    const id = game.level?.id;
    if (game.level?.purpose !== 'campaign' || !valid.has(id) || completed.has(id) ||
        game.simulation.status !== 'win' || game.simulation.result?.outcome !== 'win') return;
    completed.add(id);
    try { backend?.setItem(SAVE_KEY, JSON.stringify([...completed])); } catch { /* Keep session progress. */ }
  }
  return { markWin, has: id => completed.has(id), get count() { return completed.size; },
    get complete() { return completed.size === campaignLevels.length; } };
}

export function nextCampaignLevel(id) {
  const index = campaignLevels.findIndex(level => level.id === id);
  return index >= 0 ? campaignLevels[index + 1] ?? null : null;
}

export function createCampaignInterface(game, element, { onOpen = () => {}, progress = createCampaignProgress() } = {}) {
  const panel = element('campaign-panel'), toggle = element('levels'), list = element('campaign-list');
  const links = campaignLevels.map((level, index) => {
    const link = document.createElement('a');
    link.href = `?mission=${level.id}`;
    if (game.level?.id === level.id) link.setAttribute('aria-current', 'page');
    list.append(link);
    return {link, level, index};
  });
  function close() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  function open() { onOpen(); panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
  toggle.addEventListener('click', () => panel.hidden ? open() : close());
  element('campaign-close').addEventListener('click', close);
  element('campaign-return').addEventListener('click', open);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  let stamp;
  function update() {
    progress.markWin(game);
    const won = game.level?.purpose === 'campaign' && game.simulation.status === 'win';
    const currentStamp = `${progress.count}:${won}`;
    if (stamp === currentStamp) return won && progress.complete;
    stamp = currentStamp;
    for (const {link,level,index} of links) link.textContent = `${progress.has(level.id) ? '✓ ' : ''}${index+1}. ${level.title}`;
    element('campaign-progress').textContent = `Пройдено ${progress.count} из ${campaignLevels.length}`;
    element('campaign-actions').hidden = !won;
    const next = nextCampaignLevel(game.level?.id);
    const nextLink = element('campaign-next');
    nextLink.hidden = !next;
    if (next) { nextLink.href = `?mission=${next.id}`; nextLink.textContent = `Далее: ${next.title}`; }
    element('campaign-finished').hidden = !won || !progress.complete;
    return won && progress.complete;
  }
  return {update, close};
}
