import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createGame, createGameFromLevel, resetGame, startGame } from '../src/state.js';
import { advanceFrame } from '../src/physics.js';
import { worldToScreen } from '../src/camera.js';
import { createInput } from '../src/input.js';

function harness(pointerType = 'touch', game = createGame()) {
  const viewport = { width: 1000, height: 694 };
  const stageRect = { left: 0, top: 48, right: 1000, bottom: 742 };
  const trayRect = { left: 0, top: 742, right: 1000, bottom: 844 };
  function element(rect, type) {
    const handlers = new Map(), captures = new Set();
    return { dataset: { type }, getBoundingClientRect: () => rect,
      addEventListener(name, handler) { handlers.set(name, handler); },
      setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
      releasePointerCapture(id) { captures.delete(id); },
      dispatch(name, values) { handlers.get(name)?.({ pointerType, pointerId: 1, preventDefault() {}, ...values }); },
    };
  }
  const canvas = element(stageRect), tray = element(trayRect);
  const cards = ['planet', 'giant', 'star'].map(type => element(trayRect, type));
  let updates = 0;
  const input = createInput(game, { canvas, tray, cards, getViewport: () => viewport }, () => updates++);
  const worldEvent = (x, y) => {
    const s = worldToScreen(game.camera, viewport, x, y);
    return { clientX: s.x, clientY: s.y + stageRect.top };
  };
  function place(type, x, y) {
    const card = cards.find(card => card.dataset.type === type);
    card.dispatch('pointerdown', { clientX: 40, clientY: 790 });
    card.dispatch('pointermove', worldEvent(x, y));
    card.dispatch('pointerup', worldEvent(x, y));
  }
  function move(from, to) {
    canvas.dispatch('pointerdown', worldEvent(...from));
    canvas.dispatch('pointermove', worldEvent(...to));
    canvas.dispatch('pointerup', worldEvent(...to));
  }
  return { game, input, canvas, cards, place, move, worldEvent, updates: () => updates };
}

for (const pointerType of ['mouse', 'touch']) {
  test(`отпускание тела вне карты и области возврата отменяет перенос (${pointerType})`, () => {
    const h = harness(pointerType); h.place('planet', -350, -140);
    const before = structuredClone({ configuration:h.game.configuration, simulation:h.game.simulation });
    h.canvas.dispatch('pointerdown', h.worldEvent(-350, -140));
    h.canvas.dispatch('pointerup', {clientX:50, clientY:900});
    assert.deepEqual({configuration:h.game.configuration, simulation:h.game.simulation},before);
    h.cards[2].dispatch('pointerdown', {clientX:40,clientY:790});
    h.cards[2].dispatch('pointerup', {clientX:50,clientY:900});
    assert.deepEqual({configuration:h.game.configuration, simulation:h.game.simulation},before);
  });
  test(`полный цикл ввода: размещение, Reset, перенос, удаление, повтор (${pointerType})`, () => {
    const h = harness(pointerType);
    h.place('planet', -350, -140);
    assert.equal(h.game.configuration.placed.length, 1);
    h.place('planet', -310, -120);
    assert.equal(h.game.configuration.placed.length, 1);
    const initial = structuredClone(h.game.configuration);
    startGame(h.game);
    for (let i = 0; i < 10; i++) advanceFrame(h.game.simulation, h.game.scenario.physics, 1 / 60);
    h.place('star', -300, -200);
    assert.deepEqual(h.game.configuration, initial, 'Blocked during flight');
    h.input.cancel(); resetGame(h.game);
    assert.deepEqual(h.game.configuration, initial);
    h.move([-350, -140], [-310, -120]);
    assert.ok(Math.abs(h.game.configuration.placed[0].x + 310) < 1e-10);
    h.move([-310, -120], [0, 0]);
    assert.ok(Math.abs(h.game.configuration.placed[0].x + 310) < 1e-10);
    h.canvas.dispatch('pointerdown', h.worldEvent(-310, -120));
    h.canvas.dispatch('pointermove', { clientX: 40, clientY: 790 });
    h.canvas.dispatch('pointerup', { clientX: 40, clientY: 790 });
    assert.equal(h.game.configuration.placed.length, 0);
    assert.equal(h.game.simulation.bodies.some(body => body.user), false);
    assert.equal(startGame(h.game), true);
    assert.ok(h.updates() >= 4);
  });
}

test('предпросмотр и отмена переноса не меняют начальную конфигурацию и полёт', () => {
  const h = harness();
  h.place('planet', -350, -140);
  const before = structuredClone({ configuration: h.game.configuration, simulation: h.game.simulation });
  h.canvas.dispatch('pointerdown', h.worldEvent(-350, -140));
  h.canvas.dispatch('pointermove', h.worldEvent(-310, -120));
  assert.ok(Math.abs(h.input.state.drag.x + 310) < 1e-10);
  assert.deepEqual({ configuration: h.game.configuration, simulation: h.game.simulation }, before);
  h.canvas.dispatch('pointercancel', { clientX: 40, clientY: 790 });
  assert.deepEqual({ configuration: h.game.configuration, simulation: h.game.simulation }, before);
  assert.equal(h.input.state.drag, null);
  const star = h.cards[2];
  star.dispatch('pointerdown', { clientX: 40, clientY: 790 });
  star.dispatch('pointercancel', { clientX: 40, clientY: 790 });
  assert.equal(h.input.state.drag, null);
  assert.equal(h.game.configuration.placed.length, 1);
});

test('hover не создаёт указатель; pinch и колесо меняют только камеру', () => {
  const h = harness();
  h.canvas.dispatch('pointermove', { clientX: 300, clientY: 300 });
  assert.equal(h.input.state.pointers.size, 0);
  const before = structuredClone(h.game.simulation);
  h.canvas.dispatch('pointerdown', { clientX: 100, clientY: 300, pointerId: 1 });
  h.canvas.dispatch('pointerdown', { clientX: 200, clientY: 300, pointerId: 2 });
  h.canvas.dispatch('pointermove', { clientX: 300, clientY: 300, pointerId: 2 });
  assert.equal(h.game.camera.zoom, 1.44);
  h.input.cancel();
  h.canvas.dispatch('wheel', { clientX: 100, clientY: 300, deltaY: -10000 });
  assert.equal(h.game.camera.zoom, 2.8);
  assert.deepEqual(h.game.simulation, before);
  assert.equal(h.input.state.pointers.size, 0);
});


for (const pointerType of ['mouse', 'touch']) {
  test(`два экземпляра одного типа: перенос второго, удаление первого и повтор (${pointerType})`, () => {
    const example = JSON.parse(readFileSync(new URL('../levels/mission-examples.json', import.meta.url), 'utf8'))[0];
    const h = harness(pointerType, createGameFromLevel(example));
    h.place('planet', -350, -140); h.place('planet', -300, -250);
    assert.equal(h.game.configuration.placed.length, 2);
    const first = h.game.configuration.placed[0].id, second = h.game.configuration.placed[1].id;
    h.place('planet', -200, -300); assert.equal(h.game.configuration.placed.length, 2);
    h.move([-300, -250], [-270, -250]);
    assert.ok(Math.abs(h.game.configuration.placed.find(p => p.id === second).x + 270) < 1e-10);
    assert.equal(h.game.configuration.placed.find(p => p.id === first).x, -350);
    h.canvas.dispatch('pointerdown', h.worldEvent(-350, -140));
    h.canvas.dispatch('pointerup', { clientX: 40, clientY: 790 });
    assert.deepEqual(h.game.configuration.placed.map(p => p.id), [second]);
    h.place('planet', -350, -140); assert.equal(h.game.configuration.placed.length, 2);
    const before = structuredClone(h.game.configuration);
    startGame(h.game); advanceFrame(h.game.simulation, h.game.scenario.physics, 0.01);
    resetGame(h.game); assert.deepEqual(h.game.configuration, before);
    assert.equal(startGame(h.game), true);
  });
}

for (const pointerType of ['mouse', 'touch']) {
  test(`потеря захвата не подтверждает перенос и удаление (${pointerType})`, () => {
    const h = harness(pointerType); h.place('planet', -350, -140);
    const before = structuredClone({ simulation: h.game.simulation, configuration: h.game.configuration });
    h.canvas.dispatch('pointerdown', h.worldEvent(-350, -140));
    h.canvas.dispatch('pointermove', { clientX: 40, clientY: 790 });
    h.canvas.dispatch('lostpointercapture', { pointerId: 1 });
    h.canvas.dispatch('pointerup', { clientX: 40, clientY: 790 });
    assert.equal(h.input.state.drag, null); assert.equal(h.input.state.pointers.size, 0);
    assert.deepEqual({ simulation: h.game.simulation, configuration: h.game.configuration }, before);
    const card = h.cards[2];
    card.dispatch('pointerdown', { clientX: 40, clientY: 790 });
    card.dispatch('pointermove', h.worldEvent(-300, -200));
    card.dispatch('lostpointercapture', { pointerId: 1 });
    card.dispatch('pointerup', h.worldEvent(-300, -200));
    assert.deepEqual({ simulation: h.game.simulation, configuration: h.game.configuration }, before);
  });
  test(`после завершения ящик и тела не редактируются до Reset (${pointerType})`, () => {
    const h = harness(pointerType); h.place('planet', -350, -140);
    for (const status of ['collision', 'error', 'win', 'lose']) {
      h.game.simulation.status = status;
      const before = structuredClone({ simulation: h.game.simulation, configuration: h.game.configuration });
      h.place('star', -300, -200);
      h.canvas.dispatch('pointerdown', h.worldEvent(-350, -140));
      assert.equal(h.input.state.drag, null);
      h.canvas.dispatch('pointerup', { clientX: 40, clientY: 790 });
      assert.deepEqual({ simulation: h.game.simulation, configuration: h.game.configuration }, before);
      h.input.cancel(); resetGame(h.game);
      h.move([-350, -140], [-310, -120]); h.move([-310, -120], [-350, -140]);
      assert.ok(Math.abs(h.game.configuration.placed[0].x + 350) < 1e-10);
    }
  });
}

for (const kind of ['new', 'existing']) {
  test(`второй палец отменяет ${kind} drag; pinch и последующий pan не меняют тела`, () => {
    const h = harness(); h.place('planet', -350, -140);
    const before = structuredClone({ simulation: h.game.simulation, configuration: h.game.configuration });
    const at = h.worldEvent(-350, -140), first = kind === 'new' ? h.cards[2] : h.canvas;
    first.dispatch('pointerdown', kind === 'new' ? { clientX: 40, clientY: 790 } : at);
    first.dispatch('pointermove', { clientX: 150, clientY: 350 });
    h.canvas.dispatch('pointerdown', { clientX: 250, clientY: 350, pointerId: 2 });
    assert.equal(h.input.state.drag, null);
    first.dispatch('pointermove', { clientX: 100, clientY: 350 });
    h.canvas.dispatch('pointermove', { clientX: 300, clientY: 350, pointerId: 2 });
    assert.ok(h.game.camera.zoom > 0.72);
    first.dispatch('pointerup', { clientX: 100, clientY: 350 });
    const camera = structuredClone(h.game.camera);
    h.canvas.dispatch('pointermove', { clientX: 320, clientY: 350, pointerId: 2 });
    assert.ok(Math.abs(h.game.camera.x - (camera.x - 20 / camera.zoom)) < 1e-10);
    h.canvas.dispatch('pointerup', { clientX: 40, clientY: 790, pointerId: 2 });
    assert.deepEqual({ simulation: h.game.simulation, configuration: h.game.configuration }, before);
    assert.equal(h.input.state.pointers.size, 0);
    assert.equal(h.input.state.pan, null);
    assert.equal(h.input.state.pinch, null);
  });
}

test('третий палец не сбрасывает опорные точки pinch и его отмена не мешает двум первым', () => {
  const h = harness();
  h.canvas.dispatch('pointerdown', { clientX: 100, clientY: 350 });
  h.canvas.dispatch('pointerdown', { clientX: 200, clientY: 350, pointerId: 2 });
  h.canvas.dispatch('pointermove', { clientX: 300, clientY: 350, pointerId: 2 });
  const before = structuredClone(h.game.camera);
  h.canvas.dispatch('pointerdown', { clientX: 400, clientY: 350, pointerId: 3 });
  h.canvas.dispatch('pointermove', { clientX: 500, clientY: 350, pointerId: 3 });
  h.canvas.dispatch('pointercancel', { pointerId: 3 });
  assert.equal(h.input.state.pointers.size, 2);
  assert.equal(h.canvas.hasPointerCapture(3), false);
  assert.deepEqual(h.game.camera, before);
  h.canvas.dispatch('pointermove', { clientX: 350, clientY: 350, pointerId: 2 });
  assert.ok(Math.abs(h.game.camera.zoom - 1.8) < 1e-10);
});

test('карточка не запускает перенос во время pan или pinch карты', () => {
  const h = harness();
  h.canvas.dispatch('pointerdown', { clientX: 100, clientY: 350 });
  h.cards[0].dispatch('pointerdown', { clientX: 40, clientY: 790, pointerId: 2 });
  assert.equal(h.input.state.drag, null);
  assert.equal(h.cards[0].hasPointerCapture(2), false);
  h.canvas.dispatch('pointerdown', { clientX: 200, clientY: 350, pointerId: 2 });
  h.cards[0].dispatch('pointerdown', { clientX: 40, clientY: 790, pointerId: 3 });
  assert.equal(h.input.state.drag, null);
  h.input.cancel();
  assert.equal(h.input.state.pointers.size, 0);
});

test('при захвате у края тела его центр не прыгает под палец, а карта не сдвигается', () => {
  const h = harness(); h.place('planet', -350, -140);
  const camera = structuredClone(h.game.camera), at = h.worldEvent(-350, -140);
  h.canvas.dispatch('pointerdown', { ...at, clientX: at.clientX + 25 });
  h.canvas.dispatch('pointermove', { ...at, clientX: at.clientX + 25 });
  assert.ok(Math.abs(h.input.state.drag.x + 350) < 1e-10);
  h.canvas.dispatch('pointerup', { ...at, clientX: at.clientX + 35 });
  assert.ok(Math.abs(h.game.configuration.placed[0].x - (-350 + 10 / camera.zoom)) < 1e-10);
  assert.deepEqual(h.game.camera, camera);
});

test('потеря захвата при pinch освобождает оба указателя; следующий жест работает', () => {
  const h = harness();
  h.canvas.dispatch('pointerdown', { clientX: 100, clientY: 350 });
  h.canvas.dispatch('pointerdown', { clientX: 200, clientY: 350, pointerId: 2 });
  h.canvas.dispatch('lostpointercapture', { pointerId: 1 });
  assert.equal(h.input.state.pointers.size, 0);
  assert.equal(h.input.state.pinch, null);
  assert.equal(h.canvas.hasPointerCapture(2), false);
  h.place('planet', -350, -140);
  assert.equal(h.game.configuration.placed.length, 1);
});
