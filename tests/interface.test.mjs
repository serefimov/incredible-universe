import assert from 'node:assert/strict';
import test from 'node:test';
import { createInterface } from '../src/interface.js';
import { createGame } from '../src/state.js';

function harness(reduced = false) {
  const nodes = new Map(), timers = new Map(); let next = 0, cancellations = 0;
  const element = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { hidden: true, attrs: {}, handlers: {},
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
  h.click('info');assert.equal(h.element('mission-panel').hidden,false);
  h.click('tray-toggle');assert.equal(h.element('mission-panel').hidden,true);
  assert.equal(h.element('tray').hidden,false);
  h.click('tray-toggle');assert.equal(h.element('tray').hidden,true);
  h.input.state.drag={kind:'existing'};h.ui.paint();
  assert.equal(h.element('tray-label').textContent,'Вернуть');
  assert.ok(h.element('tray-toggle').classList.contains('drop-ready'));
  assert.deepEqual(h.game,before);assert.equal(h.cancellations(),3);
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
