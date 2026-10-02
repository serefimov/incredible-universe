// SPDX-License-Identifier: GPL-3.0-or-later
function freezeTree(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezeTree(child);
  }
  return Object.freeze(value);
}

// Verified Spike #0.3 parameters. The level is data, not live simulation state.
export const SPIKE_SCENARIO = freezeTree({
  id: 'spike-0.3',
  physics: { gravity: 7200, softening: 16, maxStep: 0.0025, timeScale: 2.5, maxFrame: 0.05 },
  camera: { x: -250, y: 40, zoom: 0.72 },
  bodies: [
    { id: 'sun', type: 'fixedStar', x: 0, y: 0, vx: 0, vy: 0, m: 3000, r: 30, fixed: true, label: 'Солнце' },
    { id: 'p1', type: 'fixedPlanet', x: 360, y: -210, vx: 0, vy: 34, m: 520, r: 16, fixed: false, label: 'Аурелия' },
    { id: 'p2', type: 'fixedPlanet', x: -520, y: 310, vx: 19, vy: -10, m: 700, r: 18, fixed: false, label: 'Борея' },
    { id: 'star2', type: 'fixedStar', x: 980, y: 180, vx: 0, vy: 0, m: 2200, r: 25, fixed: true, label: 'Дальняя звезда' },
  ],
  ship: { id: 'ship', x: -700, y: 130, vx: 58, vy: -5, m: 0.001, r: 5, fixed: false },
  tray: {
    planet: { m: 420, r: 14, drawR: 13, label: 'Планета' },
    giant: { m: 1450, r: 20, drawR: 18, label: 'Гигант' },
    star: { m: 4000, r: 27, drawR: 22, label: 'Звезда' },
  },
});
