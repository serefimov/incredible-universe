// SPDX-License-Identifier: GPL-3.0-or-later
export function worldToScreen(camera, viewport, x, y) {
  return { x: (x - camera.x) * camera.zoom + viewport.width / 2,
    y: (y - camera.y) * camera.zoom + viewport.height / 2 };
}

export function screenToWorld(camera, viewport, x, y) {
  return { x: (x - viewport.width / 2) / camera.zoom + camera.x,
    y: (y - viewport.height / 2) / camera.zoom + camera.y };
}

export function zoomAt(camera, viewport, screen, zoom) {
  const before = screenToWorld(camera, viewport, screen.x, screen.y);
  camera.zoom = Math.max(0.22, Math.min(2.8, zoom));
  camera.x = before.x - (screen.x - viewport.width / 2) / camera.zoom;
  camera.y = before.y - (screen.y - viewport.height / 2) / camera.zoom;
}

export function followShip(camera, ship) {
  if (!camera.follow) return;
  camera.x += (ship.x - camera.x) * 0.16;
  camera.y += (ship.y - camera.y) * 0.16;
}
