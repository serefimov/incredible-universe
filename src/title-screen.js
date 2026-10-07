// SPDX-License-Identifier: GPL-3.0-or-later
// The title opens the current scene; it never starts or resets a simulation.
export function createTitleScreen(element) {
  const screen = element('title-screen');
  const start = element('title-start');
  const wrap = element('wrap');
  wrap.inert = true;
  start.focus();
  start.addEventListener('click', () => {
    screen.hidden = true;
    wrap.inert = false;
    element('play').focus();
  });
}
