// SPDX-License-Identifier: GPL-3.0-or-later
import { screenToWorld, worldToScreen } from './camera.js';
import { placeBody, moveBody, removeBody, availableCount } from './state.js';

export function createInput(game, { canvas, tray, cards, getViewport }, changed) {
  // Gesture previews are UI state. They never write simulation positions.
  const input = { drag: null, pan: null, pinch: null, pointers: new Map() };
  const captures = new Map();
  const running = () => game.simulation.status === 'running';
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const world = event => {
    const p = point(event);
    return screenToWorld(game.camera, getViewport(), p.x, p.y);
  };
  const overTray = event => {
    const r = tray.getBoundingClientRect();
    return event.clientX >= r.left && event.clientX <= r.right &&
      event.clientY >= r.top && event.clientY <= r.bottom;
  };
  function capture(element, id) {
    element.setPointerCapture?.(id);
    captures.set(id, element);
  }
  function release(id) {
    const element = captures.get(id);
    if (element?.hasPointerCapture?.(id)) element.releasePointerCapture(id);
    captures.delete(id);
  }
  function cancel() {
    input.drag = input.pan = input.pinch = null;
    input.pointers.clear();
    for (const id of captures.keys()) release(id);
  }
  function beginPinch() {
    const [a, b] = [...input.pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    input.drag = input.pan = null;
    input.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y),
      zoom: game.camera.zoom,
      world: screenToWorld(game.camera, getViewport(), mid.x, mid.y) };
  }
  for (const card of cards) {
    card.addEventListener('pointerdown', event => {
      const type = card.dataset.type;
      if (running() || input.drag || availableCount(game, type) === 0) return;
      event.preventDefault();
      input.drag = { kind: 'new', type, ...world(event), pointerId: event.pointerId };
      capture(card, event.pointerId);
    });
    card.addEventListener('pointermove', event => {
      if (input.drag?.kind === 'new' && input.drag.pointerId === event.pointerId) {
        Object.assign(input.drag, world(event));
      }
    });
    card.addEventListener('pointerup', event => {
      if (input.drag?.kind !== 'new' || input.drag.pointerId !== event.pointerId) return;
      const drag = input.drag;
      const position = world(event);
      cancel();
      if (!overTray(event)) placeBody(game, drag.type, position.x, position.y);
      changed();
    });
    card.addEventListener('pointercancel', cancel);
    card.addEventListener('lostpointercapture', event => {
      if (input.drag?.pointerId === event.pointerId) cancel();
    });
  }
  canvas.addEventListener('pointerdown', event => {
    if (running() || input.drag?.kind === 'new') return;
    event.preventDefault();
    capture(canvas, event.pointerId);
    const p = point(event);
    input.pointers.set(event.pointerId, p);
    if (input.pointers.size >= 2) { beginPinch(); return; }
    let hit = null, distance = 32;
    for (const body of game.simulation.bodies.filter(body => body.user)) {
      const screen = worldToScreen(game.camera, getViewport(), body.x, body.y);
      const candidate = Math.hypot(p.x - screen.x, p.y - screen.y);
      if (candidate < distance) { hit = body; distance = candidate; }
    }
    if (hit) {
      input.drag = { kind: 'existing', type: hit.type, id: hit.id,
        x: hit.x, y: hit.y, pointerId: event.pointerId };
    } else input.pan = { pointerId: event.pointerId, last: p };
  });
  canvas.addEventListener('pointermove', event => {
    if (running() || !input.pointers.has(event.pointerId)) return;
    const p = point(event);
    input.pointers.set(event.pointerId, p);
    if (input.pointers.size >= 2) {
      const [a, b] = [...input.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const pinch = input.pinch;
      if (!pinch || pinch.distance === 0) { beginPinch(); return; }
      game.camera.zoom = Math.max(0.22, Math.min(2.8,
        pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
      const viewport = getViewport();
      game.camera.x = pinch.world.x - (mid.x - viewport.width / 2) / game.camera.zoom;
      game.camera.y = pinch.world.y - (mid.y - viewport.height / 2) / game.camera.zoom;
    } else if (input.drag?.pointerId === event.pointerId) {
      Object.assign(input.drag, world(event));
    } else if (input.pan?.pointerId === event.pointerId) {
      game.camera.x -= (p.x - input.pan.last.x) / game.camera.zoom;
      game.camera.y -= (p.y - input.pan.last.y) / game.camera.zoom;
      input.pan.last = p;
    }
  });
  canvas.addEventListener('pointerup', event => {
    if (running()) return;
    const drag = input.drag;
    if (drag?.kind === 'existing' && drag.pointerId === event.pointerId) {
      const position = world(event);
      cancel();
      if (overTray(event)) removeBody(game, drag.type, drag.id);
      else moveBody(game, drag.type, position.x, position.y, drag.id);
      changed();
    }
    input.pointers.delete(event.pointerId);
    if (input.pan?.pointerId === event.pointerId) input.pan = null;
    if (input.pointers.size < 2) input.pinch = null;
    release(event.pointerId);
  });
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', event => {
    if (input.pointers.has(event.pointerId)) cancel();
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (running()) return;
    const p = point(event), viewport = getViewport();
    const before = screenToWorld(game.camera, viewport, p.x, p.y);
    game.camera.zoom = Math.max(0.22, Math.min(2.8, game.camera.zoom * Math.exp(-event.deltaY * 0.001)));
    game.camera.x = before.x - (p.x - viewport.width / 2) / game.camera.zoom;
    game.camera.y = before.y - (p.y - viewport.height / 2) / game.camera.zoom;
  }, { passive: false });
  return { state: input, cancel };
}

