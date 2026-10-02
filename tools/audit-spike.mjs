// SPDX-License-Identifier: GPL-3.0-or-later
// Audit the actual historical script in memory; never rewrite the HTML.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const path = new URL('../prototypes/spike_0_3.html', import.meta.url);
const bytes = readFileSync(path);
const expectedHash = '5e5359420a7e938b07ff3e55caa014edb90ffc94df868211ac023721c3b80547';
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
const source = bytes.toString('utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const exposed = source.replace(/\}\)\(\);\s*$/, `
globalThis.audit = {
  step, frame, accel, validWorld, restoreSetup, worldToScreen,
  snapshot: () => JSON.parse(JSON.stringify({
    running, simT, ship, bodies, setupPlaced, trail, cam, follow,
    drag, pan, pinch, pointerCount: pointers.size, W, H, dpr
  })),
  setShip: values => Object.assign(ship, values)
};
})();`);
assert.notEqual(exposed, source, 'Instrumentation must be inserted in memory');

function harness() {
  const context = new Proxy({}, {
    get: (target, key) => target[key] ?? (() => {}),
    set: (target, key, value) => { target[key] = value; return true; }
  });
  const stageRect = { left: 0, top: 48, width: 390, height: 694, right: 390, bottom: 742 };
  const trayRect = { left: 0, top: 742, width: 390, height: 102, right: 390, bottom: 844 };
  function element(id, type) {
    const handlers = new Map();
    const classes = new Set();
    return {
      id, dataset: type ? { type } : {}, style: {}, disabled: false, textContent: '',
      classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
      hasClass: name => classes.has(name),
      addEventListener: (name, callback) => handlers.set(name, callback),
      setPointerCapture: () => {},
      getBoundingClientRect: () => id === 'tray' ? trayRect : stageRect,
      getContext: () => context,
      dispatch: (name, e) => handlers.get(name)?.({ preventDefault() {}, ...e })
    };
  }
  const nodes = Object.fromEntries(['c', 'stage', 'tray', 'play', 'reset', 'follow', 'status', 'hint']
    .map(id => [id, element(id)]));
  const cards = ['planet', 'giant', 'star'].map(type => element('card', type));
  let now = 0;
  const sandbox = {
    document: { getElementById: id => nodes[id], querySelectorAll: () => cards },
    devicePixelRatio: 3, performance: { now: () => now }, requestAnimationFrame() {}
  };
  vm.runInNewContext(exposed, sandbox, { filename: 'spike_0_3.html', timeout: 1000 });
  const api = sandbox.audit;
  function worldEvent(x, y, pointerType = 'mouse', pointerId = 1) {
    const screen = api.worldToScreen(x, y);
    return { clientX: screen.x, clientY: screen.y + stageRect.top, pointerType, pointerId };
  }
  return {
    api, nodes, cards,
    state: () => JSON.parse(JSON.stringify(api.snapshot())),
    click: id => { if (id === 'reset') now = 0; nodes[id].onclick(); },
    frames: (count, milliseconds) => {
      for (let i = 0; i < count; i++) { now += milliseconds; api.frame(now); }
    },
    pointer: (name, x, y, pointerId = 1) => nodes.c.dispatch(name,
      { clientX: x, clientY: y + stageRect.top, pointerId, pointerType: 'touch' }),
    place: (type, x, y, pointerType = 'mouse') => {
      const card = cards.find(card => card.dataset.type === type);
      card.dispatch('pointerdown', { clientX: 40, clientY: 790, pointerId: 1, pointerType });
      const e = worldEvent(x, y, pointerType);
      card.dispatch('pointermove', e);
      card.dispatch('pointerup', e);
    },
    move: (from, to, pointerType = 'mouse', cancel = false) => {
      nodes.c.dispatch('pointerdown', worldEvent(...from, pointerType));
      nodes.c.dispatch('pointermove', worldEvent(...to, pointerType));
      nodes.c.dispatch(cancel ? 'pointercancel' : 'pointerup', worldEvent(...to, pointerType));
    },
    remove: (from, pointerType) => {
      nodes.c.dispatch('pointerdown', worldEvent(...from, pointerType));
      const e = { clientX: 40, clientY: 790, pointerId: 1, pointerType };
      nodes.c.dispatch('pointermove', e);
      nodes.c.dispatch('pointerup', e);
    }
  };
}

let count = 0;
function check(name, fn) { fn(); count++; console.log(`OK ${name}`); }
function assertPlacement(h, x, y) {
  const placed = h.state().setupPlaced;
  assert.equal(placed.length, 1);
  assert.equal(placed[0].type, 'planet');
  assert.ok(Math.abs(placed[0].x - x) < 1e-10);
  assert.ok(Math.abs(placed[0].y - y) < 1e-10);
}
const physics = h => {
  const { simT, ship, bodies, trail, running } = h.state();
  return { simT, ship, bodies, trail, running };
};

check('Initial parameters and moving/fixed bodies', () => {
  const h = harness();
  const s = h.state();
  assert.equal(s.simT, 0);
  assert.equal(s.ship.x, -700);
  assert.equal(s.ship.vx, 58);
  assert.equal(s.ship.r, 5);
  assert.deepEqual(s.bodies.map(b => b.fixed), [true, false, false, true]);
  assert.equal(s.dpr, 2);
  assert.equal(h.api.accel(s.ship).ax > 0, true);
});

for (const pointerType of ['mouse', 'touch']) {
  check(`Full cycle with synthetic ${pointerType} pointer events`, () => {
    const h = harness();
    const initial = h.state().ship;
    h.place('planet', -350, -140, pointerType);
    assert.equal(h.state().setupPlaced.length, 1);
    assert.equal(h.cards[0].hasClass('used'), true);
    h.place('planet', -310, -120, pointerType);
    assert.equal(h.state().setupPlaced.length, 1, 'One body per type');
    h.click('play');
    h.frames(60, 1000 / 60);
    assert.notEqual(h.state().ship.x, initial.x);
    assert.ok(h.state().trail.length > 0);
    const camera = h.state().cam;
    h.click('reset');
    assert.deepEqual(h.state().ship, initial);
    assertPlacement(h, -350, -140);
    assert.deepEqual(h.state().cam, camera, 'Reset preserves the camera');
    assert.equal(h.state().follow, false);
    assert.equal(h.state().simT, 0);
    assert.equal(h.state().trail.length, 0);
    // Recenter the existing restore function only in the harness so body hit coordinates are visible.
    h.api.restoreSetup(true);
    h.move([-350, -140], [-310, -120], pointerType);
    assertPlacement(h, -310, -120);
    h.click('play');
    h.frames(60, 1000 / 60);
    const first = physics(h);
    h.click('reset');
    h.click('play');
    h.frames(60, 1000 / 60);
    assert.deepEqual(physics(h), first, 'Repeat the same frame sequence');
    h.click('reset');
    h.api.restoreSetup(true);
    h.remove([-310, -120], pointerType);
    assert.equal(h.state().setupPlaced.length, 0);
    assert.equal(h.cards[0].hasClass('used'), false);
    h.click('play');
    assert.equal(h.state().bodies.some(b => b.user), false);
  });
}

check('Placement boundaries and invalid relocation rollback', () => {
  const h = harness();
  assert.equal(h.api.validWorld(-700, 130, 'planet'), false);
  assert.equal(h.api.validWorld(-610, 130, 'planet'), true, '90 is allowed');
  assert.equal(h.api.validWorld(55, 0, 'planet'), false);
  assert.equal(h.api.validWorld(56, 0, 'planet'), true, 'r1+r2+12 is allowed');
  assert.equal(h.api.validWorld(1e9, -1e9, 'planet'), true, 'No world boundary');
  h.place('planet', -350, -140);
  h.move([-350, -140], [0, 0]);
  assertPlacement(h, -350, -140);
});

check('Running input is disabled', () => {
  const h = harness();
  h.place('planet', -350, -140);
  h.click('play');
  const before = h.state();
  h.place('star', -300, -200, 'touch');
  h.move([-350, -140], [-310, -120], 'touch');
  h.nodes.c.dispatch('wheel', { clientX: 100, clientY: 200, deltaY: -100 });
  assert.deepEqual(h.state().setupPlaced, before.setupPlaced);
  assert.deepEqual(h.state().cam, before.cam);
});

check('Pan, pinch anchor and wheel zoom limits', () => {
  const h = harness();
  h.pointer('pointerdown', 350, 600);
  h.pointer('pointermove', 380, 630);
  assert.ok(Math.abs(h.state().cam.x - (-250 - 30 / .72)) < 1e-10);
  h.pointer('pointerup', 380, 630);
  h.pointer('pointerdown', 100, 300, 1);
  h.pointer('pointerdown', 200, 300, 2);
  h.pointer('pointermove', 200, 300, 2);
  h.pointer('pointermove', 300, 300, 2);
  assert.equal(h.state().cam.zoom, 1.44);
  h.pointer('pointerup', 100, 300, 1);
  h.pointer('pointerup', 300, 300, 2);
  h.nodes.c.dispatch('wheel', { clientX: 100, clientY: 200, deltaY: -10000 });
  assert.equal(h.state().cam.zoom, 2.8);
  h.nodes.c.dispatch('wheel', { clientX: 100, clientY: 200, deltaY: 10000 });
  assert.equal(h.state().cam.zoom, .22);
});

check('Collision boundary, frozen result and Reset', () => {
  const h = harness();
  h.click('play');
  h.api.setShip({ x: 35, y: 0, vx: 0, vy: 0 });
  h.api.step(0);
  assert.equal(h.state().running, true, 'Tangency is not a collision');
  h.api.setShip({ x: 34.999 });
  h.api.step(0);
  assert.equal(h.state().running, false);
  assert.equal(h.nodes.status.textContent, '💥 столкновение');
  assert.equal(h.nodes.play.disabled, true, 'Play remains disabled after collision');
  assert.equal(h.nodes.hint.style.display, 'none');
  h.frames(10, 16);
  assert.equal(h.nodes.status.textContent, '💥 столкновение');
  h.click('reset');
  assert.equal(h.nodes.play.disabled, false);
  assert.equal(h.state().ship.x, -700);
});

check('High-speed crossing misses collision (known limitation)', () => {
  const h = harness();
  h.click('play');
  h.api.setShip({ x: -100, y: 0, vx: 80000, vy: 0 });
  h.api.step(.0025);
  assert.ok(h.state().ship.x > 35);
  assert.equal(h.state().running, true);
});

check('Single-step velocity-first integration and ship has no back reaction', () => {
  const h = harness();
  const before = h.state();
  const a = h.api.accel(before.ship);
  h.api.step(.0025);
  const after = h.state();
  assert.equal(after.ship.vx, before.ship.vx + a.ax * .0025);
  assert.equal(after.ship.x, before.ship.x + after.ship.vx * .0025);
  const other = harness();
  other.api.setShip({ x: 1e6, y: 1e6, m: 1e9 });
  other.api.step(.0025);
  assert.deepEqual(other.state().bodies, after.bodies);
});

check('Exact coincident position has finite softened acceleration', () => {
  const h = harness();
  const a = h.api.accel({ x: 0, y: 0 });
  assert.ok(Number.isFinite(a.ax) && Number.isFinite(a.ay));
});

check('Frame schedule changes trajectory (known limitation)', () => {
  const a = harness(), b = harness();
  a.click('play'); b.click('play');
  a.frames(30, 1000 / 60); b.frames(60, 1000 / 120);
  const sa = a.state(), sb = b.state();
  assert.ok(Math.abs(sa.simT - sb.simT) < 1e-10);
  assert.notDeepEqual(sa.ship, sb.ship);
  console.log(`  at t≈${sa.simT.toFixed(6)}: 60/120 Hz position difference = ${Math.hypot(sa.ship.x - sb.ship.x, sa.ship.y - sb.ship.y).toPrecision(8)}`);
});

check('Long frame is capped rather than caught up', () => {
  const h = harness();
  h.click('play'); h.frames(1, 1000);
  assert.ok(Math.abs(h.state().simT - .125) < 1e-12);
});

check('Unmodified initial scene naturally collides', () => {
  const h = harness();
  h.click('play'); h.frames(120, 1000 / 60);
  const s = h.state();
  assert.equal(s.running, false);
  const hit = s.bodies.find(b => Math.hypot(s.ship.x - b.x, s.ship.y - b.y) < s.ship.r + b.r);
  assert.ok(hit);
  console.log(`  collision with ${hit.label} at t≈${s.simT.toFixed(8)}`);
});

check('Existing drag pointercancel commits placement (known limitation)', () => {
  const h = harness();
  h.place('planet', -350, -140, 'touch');
  h.move([-350, -140], [-310, -120], 'touch', true);
  assertPlacement(h, -310, -120);
});

check('New drag pointercancel leaves drag active (known limitation)', () => {
  const h = harness();
  const e = { clientX: 40, clientY: 790, pointerId: 1, pointerType: 'touch' };
  h.cards[0].dispatch('pointerdown', e);
  h.cards[0].dispatch('pointercancel', e);
  assert.equal(h.state().drag.kind, 'new');
  h.click('reset');
  assert.equal(h.state().drag.kind, 'new', 'Reset does not clear drag');
});

check('Canvas hover pointermove inserts inactive pointers (known limitation)', () => {
  const h = harness();
  h.nodes.c.dispatch('pointermove', { clientX: 100, clientY: 200, pointerId: 10, pointerType: 'mouse' });
  assert.equal(h.state().pointerCount, 1);
});

check('Initial ship is outside a 390×844 portrait viewport', () => {
  const h = harness();
  const s = h.state();
  assert.ok(h.api.worldToScreen(s.ship.x, s.ship.y).x < 0);
  h.click('follow');
  assert.equal(h.api.worldToScreen(s.ship.x, s.ship.y).x, 195);
});

check('Editing is already allowed after collision without Reset (current behavior)', () => {
  const h = harness();
  h.click('play');
  h.api.setShip({ x: 0, y: 0 });
  h.api.step(0);
  h.place('planet', -350, -140, 'touch');
  assert.equal(h.state().setupPlaced.length, 1);
  assert.equal(h.state().simT, 0);
  assert.equal(h.state().ship.x, -700);
});

console.log(`\n${count} audit probes passed. HTML SHA-256 unchanged: ${expectedHash}`);
console.log('Synthetic DOM/pointer checks do not certify a physical smartphone.');
