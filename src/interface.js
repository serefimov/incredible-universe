// SPDX-License-Identifier: GPL-3.0-or-later

// Panels and notification timers never write physics or initial conditions.
export function createInterface(game, element, input, {
  later = setTimeout, cancelLater = clearTimeout,
  reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
} = {}) {
  const panel = element('mission-panel'), tray = element('tray');
  const info = element('info'), toggle = element('tray-toggle'), overlay = element('outcome-overlay');
  let seen = null, timer, fadeTimer;
  const expand = (button, opened) => button.setAttribute('aria-expanded', String(opened));
  function closeInfo() { panel.hidden = true; expand(info, false); }
  function closeTray() { tray.hidden = true; expand(toggle, false); }
  function dismiss() {
    cancelLater(timer); cancelLater(fadeTimer);
    const focused = globalThis.document?.activeElement === overlay;
    overlay.hidden = true; overlay.classList.remove('dissolving');
    if (focused) info.focus?.({preventScroll:true});
  }
  function showOutcome(result) {
    dismiss();
    element('outcome-title').textContent = result.outcome === 'win' ? 'Победа' : 'Поражение';
    element('outcome-reason').textContent = result.message;
    overlay.setAttribute('aria-label', `${result.outcome === 'win' ? 'Победа' : 'Поражение'}. ${result.message}. Закрыть сообщение`);
    overlay.classList.toggle('won', result.outcome === 'win');
    overlay.hidden = false;
    overlay.focus?.({preventScroll:true});
    timer = later(() => {
      if (reducedMotion()) dismiss();
      else {
        overlay.classList.add('dissolving');
        fadeTimer = later(dismiss, 1000);
      }
    }, 2000);
  }
  info.addEventListener('click', () => {
    input.cancel();
    const opened = panel.hidden;
    closeTray(); panel.hidden = !opened; expand(info, opened);
  });
  element('info-close').addEventListener('click', () => { input.cancel(); closeInfo(); info.focus?.(); });
  toggle.addEventListener('click', () => {
    input.cancel();
    const opened = tray.hidden;
    closeInfo(); tray.hidden = !opened; expand(toggle, opened);
  });
  overlay.addEventListener('click', event => { event.stopPropagation(); dismiss(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
  function update(display) {
    if (game.simulation.result && game.simulation.result !== seen) {
      seen = game.simulation.result;
      closeInfo(); closeTray(); showOutcome(seen);
    }
    if (!game.simulation.result) seen = null;
    if (display.terminal) info.classList.add('has-result');
    else info.classList.remove('has-result');
    element('units-note').hidden = !game.level;
  }
  function reset() { dismiss(); seen = null; element('mission-body').scrollTop = 0; }
  function paint() {
    const returning = input.state.drag?.kind === 'existing';
    toggle.classList.toggle('drop-ready', returning);
    element('tray-label').textContent = returning ? 'Вернуть' : 'Тела';
  }
  return { update, reset, closeTray, closeInfo, dismiss, paint };
}
