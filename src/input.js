// SPDX-License-Identifier: GPL-3.0-or-later
import { screenToWorld, worldToScreen } from './camera.js';
import { placeBody, moveBody, removeBody, availableCount, canEditConfiguration } from './state.js';

export function createInput(game, { canvas, tray, cards, getViewport, isOverTray }, changed) {
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
    if (isOverTray) return isOverTray(event);
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
  function move(event) {
    if (running() || !input.pointers.has(event.pointerId)) return;
    const p = point(event);
    input.pointers.set(event.pointerId, p);
    if (input.pinch) {
      const [a, b] = [...input.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const pinch = input.pinch;
      if (pinch.distance === 0) { beginPinch(); return; }
      game.camera.zoom = Math.max(0.22, Math.min(2.8,
        pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
      const viewport = getViewport();
      game.camera.x = pinch.world.x - (mid.x - viewport.width / 2) / game.camera.zoom;
      game.camera.y = pinch.world.y - (mid.y - viewport.height / 2) / game.camera.zoom;
    } else if (input.drag?.pointerId === event.pointerId) {
      const position = world(event), offset = input.drag.offset ?? { x: 0, y: 0 };
      Object.assign(input.drag, { x: position.x + offset.x, y: position.y + offset.y });
    } else if (input.pan?.pointerId === event.pointerId) {
      game.camera.x -= (p.x - input.pan.last.x) / game.camera.zoom;
      game.camera.y -= (p.y - input.pan.last.y) / game.camera.zoom;
      input.pan.last = p;
    }
  }
  function up(event) {
    if (!input.pointers.has(event.pointerId)) return;
    const drag = input.drag;
    if (drag?.pointerId === event.pointerId) {
      const position = world(event), offset = drag.offset ?? { x: 0, y: 0 };
      cancel();
      const rect = canvas.getBoundingClientRect();
      const onMap = event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (drag.kind === 'new') {
        if (onMap && !overTray(event)) placeBody(game, drag.type, position.x, position.y);
      } else if (overTray(event)) removeBody(game, drag.type, drag.id);
      else if (onMap) moveBody(game, drag.type, position.x + offset.x, position.y + offset.y, drag.id);
      changed();
      return;
    }
    input.pointers.delete(event.pointerId);
    input.pinch = null;
    const remaining = [...input.pointers.entries()][0];
    // The remaining finger pans from its current position; it never resumes a body drag.
    input.pan = remaining ? { pointerId: remaining[0], last: remaining[1] } : null;
    release(event.pointerId);
  }
  function listen(element) {
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', event => {
      if (input.pointers.has(event.pointerId)) cancel();
    });
    element.addEventListener('lostpointercapture', event => {
      if (input.pointers.has(event.pointerId)) cancel();
    });
  }
  for (const card of cards) {
    card.addEventListener('pointerdown', event => {
      const type = card.dataset.type;
      if (!canEditConfiguration(game) || input.pointers.size || availableCount(game, type) === 0) return;
      event.preventDefault();
      input.pointers.set(event.pointerId, point(event));
      input.drag = { kind: 'new', type, ...world(event), pointerId: event.pointerId };
      capture(card, event.pointerId);
    });
    listen(card);
  }
  canvas.addEventListener('pointerdown', event => {
    if (running() || input.pointers.size >= 2 || input.pointers.has(event.pointerId)) return;
    event.preventDefault();
    capture(canvas, event.pointerId);
    const p = point(event);
    input.pointers.set(event.pointerId, p);
    if (input.pointers.size === 2) { beginPinch(); return; }
    let hit = null, distance = 32;
    for (const body of game.simulation.bodies.filter(body => canEditConfiguration(game) && body.user)) {
      const screen = worldToScreen(game.camera, getViewport(), body.x, body.y);
      const candidate = Math.hypot(p.x - screen.x, p.y - screen.y);
      if (candidate < distance) { hit = body; distance = candidate; }
    }
    if (hit) {
      const position = world(event);
      input.drag = { kind: 'existing', type: hit.type, id: hit.id,
        x: hit.x, y: hit.y, offset: { x: hit.x - position.x, y: hit.y - position.y },
        pointerId: event.pointerId };
    } else input.pan = { pointerId: event.pointerId, last: p };
  });
  listen(canvas);
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
