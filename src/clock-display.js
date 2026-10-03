// SPDX-License-Identifier: GPL-3.0-or-later

// Ship time is always shown. A second clock belongs to an actual body in a mission.
// Inertial observers used by numerical fixtures are not a planet in the UI.
export function earthClockBody(game) {
  if (!game.level || !game.simulation.earthBinding) return null;
  return game.simulation.bodies.find(body => body.id === game.simulation.earthBinding.bodyId) ?? null;
}
