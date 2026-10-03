// SPDX-License-Identifier: GPL-3.0-or-later
import examples from '../levels/mission-examples.json' with { type: 'json' };
import campaign from '../levels/campaign.json' with { type: 'json' };
import { loadLevel } from './levels.js';

// Authored campaign levels and contract examples are embedded in standalone HTML.
export function levelFromSearch(search) {
  const id = new URLSearchParams(search).get('mission');
  if (!id) return null;
  const example = [...campaign, ...examples].find(level => level.id === id);
  if (!example) return null;
  return loadLevel(example);
}
