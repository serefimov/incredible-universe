// SPDX-License-Identifier: GPL-3.0-or-later
import { worldToScreen } from './camera.js';
import { validPlacement } from './state.js';
import { resolveTarget } from './levels.js';
import { earthClockBody } from './clock-display.js';

export function createRenderer(canvas, stage) {
  const ctx = canvas.getContext('2d');
  const viewport = { width: 0, height: 0 };
  function resize() {
    const rect = stage.getBoundingClientRect();
    viewport.width = rect.width;
    viewport.height = rect.height;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function circle(x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function draw(game, input) {
    const { simulation, camera, scenario } = game;
    const { width: W, height: H } = viewport;
    const screen = (x, y) => worldToScreen(camera, viewport, x, y);
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < 110; i++) {
      ctx.globalAlpha = 0.22 + (i % 5) * 0.1;
      circle((i * 137.3) % W, (i * 73.7) % H, (i % 3) * 0.35 + 0.3, '#aeb9d3');
    }
    ctx.globalAlpha = 1;
    if (game.level && simulation.status === 'ready') {
      ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = '#7badd599'; ctx.fillStyle = '#7badd512'; ctx.lineWidth = 1;
      for (const region of game.level.placement.regions) {
        if (region.kind === 'circle') {
          const rs = screen(region.x, region.y);
          circle(rs.x, rs.y, region.radius * camera.zoom, '#7badd512', '#7badd599');
        } else {
          const rs = screen(region.xMin, region.yMin);
          const width = (region.xMax - region.xMin) * camera.zoom, height = (region.yMax - region.yMin) * camera.zoom;
          ctx.fillRect(rs.x, rs.y, width, height); ctx.strokeRect(rs.x, rs.y, width, height);
        }
      }
      ctx.restore();
    }
    if (simulation.mission?.target) {
      const target = resolveTarget(simulation.mission.target, simulation), ts = screen(target.x, target.y);
      ctx.setLineDash([5, 5]);
      circle(ts.x, ts.y, target.radius * camera.zoom, '#70e1de0c', '#70e1de');
      ctx.setLineDash([]); ctx.fillStyle = '#70e1de'; ctx.font = '11px system-ui';
      ctx.fillText('Область цели', Math.max(5, Math.min(ts.x + 8, W - 100)), ts.y - target.radius * camera.zoom - 5);
    }
    if (simulation.trail.length > 1) {
      ctx.beginPath();
      let s = screen(simulation.trail[0].x, simulation.trail[0].y);
      ctx.moveTo(s.x, s.y);
      for (const p of simulation.trail) { s = screen(p.x, p.y); ctx.lineTo(s.x, s.y); }
      ctx.strokeStyle = '#6d7899aa'; ctx.lineWidth = 1.3; ctx.stroke();
    }
    for (const actual of simulation.bodies) {
      const body = input.drag?.kind === 'existing' && input.drag.id === actual.id
        ? { ...actual, x: input.drag.x, y: input.drag.y } : actual;
      const s = screen(body.x, body.y);
      if (s.x < -80 || s.x > W + 80 || s.y < -80 || s.y > H + 80) continue;
      const r = Math.max(5, body.r * Math.sqrt(camera.zoom));
      if (body.type === 'fixedStar' || body.type === 'star') {
        circle(s.x, s.y, r + 7, '#ffb52a22');
        circle(s.x, s.y, r, body.type === 'star' ? '#fff1a8' : '#ffd45a');
      } else if (body.type === 'giant') circle(s.x, s.y, r, '#c19a72', '#f0d0aa');
      else if (body.type === 'planet') circle(s.x, s.y, r, '#7c8fd1', '#c7d1ff');
      else circle(s.x, s.y, r, '#69a6a1', '#aee1dc');
      ctx.fillStyle = '#aeb9d3'; ctx.font = '10px system-ui';
      const labelWidth = ctx.measureText(body.label)?.width ?? body.label.length * 6;
      ctx.fillText(body.label, Math.max(5, Math.min(s.x + r + 5, W - labelWidth - 5)), s.y - r - 2);
      if (simulation.status === 'ready' && body.user) {
        ctx.fillStyle = '#7f8da9'; ctx.fillText('v = 0', s.x + r + 5, s.y + 10);
      }
    }
    if (input.drag) {
      const drag = input.drag, s = screen(drag.x, drag.y);
      const ok = validPlacement(game, drag.type, drag.x, drag.y, drag.id ?? null);
      circle(s.x, s.y, scenario.tray[drag.type].drawR + 5,
        ok ? '#7c8fd199' : '#a64c5d99', ok ? '#d7deff' : '#ff899b');
      ctx.fillStyle = ok ? '#d7deff' : '#ff899b'; ctx.font = '12px system-ui';
      ctx.fillText(ok ? '✓' : '×', s.x + scenario.tray[drag.type].drawR + 9, s.y - 10);
    }
    const clockBody = earthClockBody(game);
    const observer = simulation.earthObserver, os = screen(observer.x, observer.y);
    if (clockBody && os.x >= -20 && os.x <= W + 20 && os.y >= -20 && os.y <= H + 20) {
      circle(os.x, os.y, 6, '#101c31', '#70e1de');
      ctx.strokeStyle = '#70e1de'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(os.x, os.y - 4); ctx.lineTo(os.x, os.y); ctx.lineTo(os.x + 3, os.y); ctx.stroke();
      ctx.fillStyle = '#70e1de'; ctx.font = '10px system-ui';
      ctx.fillText('Часы Земли', Math.min(os.x + 10, W - 105), os.y + 23);
    }
    const ship = simulation.ship, ss = screen(ship.x, ship.y);
    ctx.save(); ctx.translate(ss.x, ss.y); ctx.rotate(Math.atan2(ship.vy, ship.vx));
    ctx.fillStyle = '#eef4ff'; ctx.beginPath(); ctx.moveTo(12, 0);
    ctx.lineTo(-7, -5); ctx.lineTo(-4, 0); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    if (simulation.status !== 'running' && !simulation.trail.length) {
      const speed = Math.hypot(ship.vx, ship.vy), ux = ship.vx / speed, uy = ship.vy / speed;
      ctx.setLineDash([5, 6]); ctx.strokeStyle = '#d8e1ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ss.x + ux * 15, ss.y + uy * 15);
      ctx.lineTo(ss.x + ux * 65, ss.y + uy * 65); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  return { viewport, resize, draw };
}

