// SPDX-License-Identifier: GPL-3.0-or-later

// Panels and notification timers never write physics or initial conditions.
export function createInterface(game, element, input, {
  later = setTimeout, cancelLater = clearTimeout,
  reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
} = {}) {
  const panel = element('mission-panel'), tray = element('tray');
  const info = element('info'), toggle = element('tray-toggle'), overlay = element('outcome-overlay');
  const sheet = element('tray-sheet');
  let seen = null, timer, fadeTimer;
  let gesture = null, ignoreClick = false;
  const expand = (button, opened) => button.setAttribute('aria-expanded', String(opened));
  function trayOpen(opened) {
    tray.hidden = !opened; expand(toggle, opened); sheet.style.transform = '';
  }
  function cancelGesture() {
    if (!gesture) return;
    const old = gesture; gesture = null;
    trayOpen(old.opened);
    if (toggle.hasPointerCapture?.(old.id)) toggle.releasePointerCapture(old.id);
  }
  function closeInfo() { panel.hidden = true; expand(info, false); }
  function closeTray() { cancelGesture(); trayOpen(false); }
  trayOpen(true);
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
  toggle.addEventListener('click', event => {
    if (ignoreClick && event.detail !== 0) { ignoreClick = false; return; }
    input.cancel();
    const opened = tray.hidden;
    closeInfo(); trayOpen(opened);
  });
  toggle.addEventListener('pointerdown', event => {
    event.preventDefault(); input.cancel(); ignoreClick = false;
    if (gesture) { cancelGesture(); return; }
    closeInfo();
    const opened = !tray.hidden;
    trayOpen(true);
    const height = tray.getBoundingClientRect().height;
    gesture = {id:event.pointerId, y:event.clientY, opened, height, delta:0};
    sheet.style.transform = `translateY(${opened ? 0 : height}px)`;
    toggle.setPointerCapture?.(event.pointerId);
  });
  toggle.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.delta = event.clientY - gesture.y;
    const offset = Math.max(0,Math.min(gesture.height,(gesture.opened ? 0 : gesture.height) + gesture.delta));
    sheet.style.transform = `translateY(${offset}px)`;
  });
  toggle.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const old = gesture;
    old.delta = event.clientY - old.y;
    cancelGesture();
    if (Math.abs(old.delta) >= 12) {
      ignoreClick = true;
      trayOpen(old.delta < 0);
    }
  });
  for (const name of ['pointercancel','lostpointercapture']) toggle.addEventListener(name, () => {
    if (gesture) { ignoreClick = true; cancelGesture(); }
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
  function reset() { dismiss(); seen = null; cancelGesture(); trayOpen(true); element('mission-body').scrollTop = 0; }
  function paint() {
    element('trayText').hidden = input.state.drag?.kind !== 'new';
    const returning = input.state.drag?.kind === 'existing';
    toggle.classList.toggle('drop-ready', returning);
    element('tray-label').textContent = returning ? 'Вернуть тело' : 'Ящик тел';
  }
  return { update, reset, closeTray, closeInfo, dismiss, paint, cancelGesture };
}
