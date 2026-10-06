import assert from 'node:assert/strict';
import test from 'node:test';
import { createInterface } from '../src/interface.js';
import { createGame } from '../src/state.js';

function harness(reduced = false) {
  const nodes = new Map(), timers = new Map(); let next = 0, cancellations = 0;
  const element = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { hidden: true, style: {}, attrs: {}, handlers: {}, getBoundingClientRect:()=>({height:140}),
        setAttribute(key,value) { this.attrs[key] = value; },
        addEventListener(key,fn) { this.handlers[key] = fn; },
        classList: { add: key => classes.add(key), remove: key => classes.delete(key),
          toggle: (key,on) => on ? classes.add(key) : classes.delete(key), contains: key => classes.has(key) } });
    }
    return nodes.get(id);
  };
  const game = createGame(), input = {state:{drag:null},cancel() { cancellations++; }};
  const ui = createInterface(game,element,input,{ reducedMotion:()=>reduced,
    later:(fn,delay)=>{ timers.set(++next,{fn,delay}); return next; }, cancelLater:id=>timers.delete(id) });
  const fire = delay => { for(const [id,t] of timers) if(t.delay === delay) { timers.delete(id);t.fn();break; } };
  const click = id => element(id).handlers.click({stopPropagation(){}});
  return { game, input, ui, element, timers, fire, click, cancellations:()=>cancellations };
}

test('i и ящик открываются без записи в физику; закрытый ящик оставляет возврат доступным', () => {
  const h=harness(),before=structuredClone(h.game);
  assert.equal(h.element('tray').hidden,false,'drawer starts open');
  h.click('info');assert.equal(h.element('mission-panel').hidden,false);
  h.click('tray-toggle');assert.equal(h.element('mission-panel').hidden,true);
  assert.equal(h.element('tray').hidden,false);
  h.click('tray-toggle');assert.equal(h.element('tray').hidden,true);
  h.input.state.drag={kind:'existing'};h.ui.paint();
  assert.equal(h.element('tray-label').textContent,'Вернуть тело');
  assert.ok(h.element('tray-toggle').classList.contains('drop-ready'));
  assert.deepEqual(h.game,before);assert.equal(h.cancellations(),3);
});

test('подсказка ящика видна только при переносе нового тела и исчезает после отмены или pinch', () => {
  const h=harness(),before=structuredClone(h.game);
  h.ui.paint();assert.equal(h.element('trayText').hidden,true);
  h.input.state.drag={kind:'new'};h.ui.paint();assert.equal(h.element('trayText').hidden,false);
  assert.ok(h.element('mission-brief').classList.contains('interacting'));
  h.input.state.drag=null;h.ui.paint();assert.equal(h.element('trayText').hidden,true);
  assert.equal(h.element('mission-brief').classList.contains('interacting'),false);
  h.input.state.pinch={};h.ui.paint();assert.ok(h.element('mission-brief').classList.contains('interacting'));
  h.input.state.pinch=null;
  h.input.state.drag={kind:'existing'};h.ui.paint();assert.equal(h.element('trayText').hidden,true);
  assert.deepEqual(h.game,before);
});

test('ручка вытягивает ящик вверх, сворачивает вниз и откатывает отменённый жест', () => {
  const h=harness(),handle=h.element('tray-toggle');
  const send=(name,y)=>handle.handlers[name]({pointerId:1,clientY:y,preventDefault(){}});
  const before=structuredClone(h.game);
  send('pointerdown',500);send('pointermove',580);send('pointerup',580);
  assert.equal(h.element('tray').hidden,true);
  handle.handlers.click({detail:1});assert.equal(h.element('tray').hidden,true,'synthetic click cannot undo swipe');
  send('pointerdown',580);send('pointermove',500);send('pointerup',500);
  assert.equal(h.element('tray').hidden,false);
  send('pointerdown',500);send('pointermove',580);send('pointercancel',580);
  assert.equal(h.element('tray').hidden,false);assert.equal(h.element('tray-sheet').style.transform,'');
  h.ui.closeTray();h.ui.reset();assert.equal(h.element('tray').hidden,false,'Reset restores open drawer');
  assert.deepEqual(h.game,before);
});

for(const outcome of ['win','lose']) test(`полноэкранный ${outcome}: один показ, исчезновение и повтор после Reset`, () => {
  const h=harness();
  const result=Object.freeze({outcome,message:'Причина'});
  h.game.simulation.result=result;h.game.simulation.status=outcome;
  h.ui.update({terminal:true});const before=structuredClone(h.game);
  assert.equal(h.element('outcome-overlay').hidden,false);
  assert.equal(h.timers.size,1);
  h.ui.update({terminal:true});assert.equal(h.timers.size,1);
  h.fire(2000);assert.ok(h.element('outcome-overlay').classList.contains('dissolving'));
  h.fire(1000);assert.equal(h.element('outcome-overlay').hidden,true);
  h.ui.update({terminal:true});assert.equal(h.element('outcome-overlay').hidden,true);
  assert.deepEqual(h.game,before);
  h.ui.reset();h.game.simulation.result=null;h.ui.update({terminal:false});
  h.game.simulation.result=result;h.ui.update({terminal:true});
  assert.equal(h.element('outcome-overlay').hidden,false);
  h.click('outcome-overlay');assert.equal(h.timers.size,0);
});

test('уменьшение анимаций и Reset отменяют таймеры; ошибка не запускает Win/Lose', () => {
  const h=harness(true);
  h.game.simulation.result={outcome:'win',message:'Готово'};h.ui.update({terminal:true});
  h.fire(2000);assert.equal(h.element('outcome-overlay').hidden,true);assert.equal(h.timers.size,0);
  h.ui.reset();h.game.simulation.result=null;h.game.simulation.status='error';h.ui.update({terminal:true});
  assert.equal(h.element('outcome-overlay').hidden,true);assert.equal(h.timers.size,0);
  h.game.simulation.result={outcome:'lose',message:'Готово'};h.ui.update({terminal:true});
  h.ui.reset();assert.equal(h.timers.size,0);assert.equal(h.element('outcome-overlay').hidden,true);
});


test('напоминание Сброса остаётся видимым при обзоре карты после поражения', () => {
  const h=harness();h.game.simulation.status='lose';h.input.state.pan={};
  h.ui.paint();assert.equal(h.element('mission-brief').classList.contains('interacting'),false);
  h.game.simulation.status='ready';h.ui.paint();
  assert.equal(h.element('mission-brief').classList.contains('interacting'),true);
});
