import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitleScreen } from '../src/title-screen.js';

test('титр блокирует игру до явного входа и переводит фокус на Пуск', () => {
  const nodes = Object.fromEntries(['title-screen', 'title-start', 'wrap', 'play'].map(id =>
    [id, { hidden: false, focused: false, focus() { this.focused = true; },
      addEventListener(event, action) { this[event] = action; } }]));
  createTitleScreen(id => nodes[id]);
  assert.equal(nodes.wrap.inert, true);
  assert.equal(nodes['title-start'].focused, true);
  nodes['title-start'].click();
  assert.equal(nodes['title-screen'].hidden, true);
  assert.equal(nodes.wrap.inert, false);
  assert.equal(nodes.play.focused, true);
});
