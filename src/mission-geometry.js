// SPDX-License-Identifier: GPL-3.0-or-later

// Closed interval in which a linearly moving ship centre is inside a moving circle.
// Both endpoints use world coordinates; the camera never participates.
export function targetInterval(ship, nextShip, target, nextTarget, radius) {
  let x = ship.x - target.x, y = ship.y - target.y;
  let dx = (nextShip.x - nextTarget.x) - x, dy = (nextShip.y - nextTarget.y) - y;
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(dx), Math.abs(dy), radius);
  if (!Number.isFinite(scale) || !Number.isFinite(radius) || radius <= 0) {
    throw new RangeError('Некорректная геометрия цели');
  }
  x /= scale; y /= scale; dx /= scale; dy /= scale; radius /= scale;
  const a = dx * dx + dy * dy, b = x * dx + y * dy;
  const c = x * x + y * y - radius * radius;
  if (a === 0) return c <= 0 ? [0, 1] : null;
  const closest = -b / a;
  // Distance at the closest point avoids subtracting almost equal discriminant terms.
  const squaredDistance = (x + closest * dx) ** 2 + (y + closest * dy) ** 2;
  if (squaredDistance > radius * radius) return null;
  const root = Math.sqrt(Math.max(0, (radius * radius - squaredDistance) * a));
  const q = -b - (b >= 0 ? root : -root);
  const roots = q === 0 ? [closest, closest] : [q / a, c / q].sort((u, v) => u - v);
  const enter = Math.max(0, roots[0]), exit = Math.min(1, roots[1]);
  return enter <= exit ? [enter, exit] : null;
}

export function inRange(value, range) {
  return Number.isFinite(value) && (!range ||
    (value >= (range.min ?? -Infinity) && value <= (range.max ?? Infinity)));
}
