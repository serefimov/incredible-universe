// SPDX-License-Identifier: GPL-3.0-or-later
// A distant, static backdrop. Cached at viewport resolution; independent of physics.
export function createSky(canvas) {
  const layer = canvas.ownerDocument?.createElement('canvas');
  const ctx = layer?.getContext('2d');
  function resize(width, height, dpr) {
    if (!ctx || width <= 0 || height <= 0) return;
    layer.width = Math.round(width * dpr);
    layer.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#030711'; ctx.fillRect(0, 0, width, height);
    let seed = 0x51c05a;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    function cloud(x, y, rx, ry, angle, colour, opacity) {
      ctx.save(); ctx.translate(x * width, y * height); ctx.rotate(angle);
      ctx.scale(rx * width, ry * height);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, `rgba(${colour},${opacity})`);
      glow.addColorStop(0.45, `rgba(${colour},${opacity * 0.45})`);
      glow.addColorStop(1, `rgba(${colour},0)`);
      ctx.fillStyle = glow; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
    }
    // Unequal, overlapping clouds with dark gaps, rather than tiled noise.
    cloud(0.12, 0.28, 0.7, 0.33, -0.45, '21,65,112', 0.45);
    cloud(0.73, 0.65, 0.56, 0.28, -0.65, '68,35,92', 0.38);
    cloud(0.42, 0.48, 0.46, 0.13, -0.7, '26,77,101', 0.3);
    cloud(0.93, 0.16, 0.4, 0.25, 0.4, '42,54,98', 0.17);
    for (let i = 0; i < 24; i++) {
      const x = random(), y = 0.82 - x * 0.57 + (random() - 0.5) * 0.25;
      cloud(x, y, 0.12 + random() * 0.18, 0.04 + random() * 0.07,
        -0.55, i % 2 ? '44,47,86' : '19,62,88', 0.04 + random() * 0.055);
    }
    cloud(0.43, 0.56, 0.5, 0.1, -0.6, '0,2,8', 0.65);
    const count = Math.min(450, Math.round(width * height / 2400));
    const stars = [], grid = new Map(), gap = 12;
    for (let tries = 0; stars.length < count && tries < count * 30; tries++) {
      const x = random() * width, y = random() * height;
      const gx = Math.floor(x / gap), gy = Math.floor(y / gap);
      let crowded = false;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const star of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if ((star.x - x) ** 2 + (star.y - y) ** 2 < gap ** 2) crowded = true;
        }
      }
      if (crowded) continue;
      const star = { x, y }, key = `${gx},${gy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(star); stars.push(star);
      const brightness = random(), radius = 0.35 + random() * 0.65;
      if (brightness > 0.965) {
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 4);
        halo.addColorStop(0, '#b9d8ff66'); halo.addColorStop(1, '#b9d8ff00');
        ctx.fillStyle = halo; ctx.fillRect(x - 4, y - 4, 8, 8);
      }
      ctx.globalAlpha = 0.18 + brightness * 0.6;
      ctx.fillStyle = random() > 0.85 ? '#f3d6ae' : '#c2d8f4';
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  return { resize, draw(context, width, height) {
    if (ctx && layer.width && layer.height) context.drawImage(layer, 0, 0, width, height);
  } };
}
