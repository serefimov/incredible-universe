// SPDX-License-Identifier: GPL-3.0-or-later
import examples from '../levels/mission-examples.json' with { type: 'json' };
import { loadLevel } from './levels.js';

// Optional contract examples for checking #9 in the published standalone HTML.
// They are explicitly labelled examples, not a balanced training campaign.
export function levelFromSearch(search) {
  const id = new URLSearchParams(search).get('mission');
  if (!id) return null;
  const example = examples.find(level => level.id === id);
  if (!example) return null;
  return loadLevel(example);
}
