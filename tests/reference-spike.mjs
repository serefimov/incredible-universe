import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the historical script itself. Instrumentation exists only in the VM.
export function referenceSpike(placements = []) {
  const html = readFileSync(new URL('../prototypes/spike_0_3.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\}\)\(\);\s*$/, `
    globalThis.reference = {
      step, frame,
      place: values => { setupPlaced = values; restoreSetup(false); },
      start: () => play.onclick(),
      snapshot: () => JSON.stringify({ simT, ship, bodies, trail, running })
    };
  })();`);
  const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, classList: { toggle() {} },
      addEventListener() {}, getContext: () => context,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) });
    return nodes.get(id);
  };
  const sandbox = { document: { getElementById: node, querySelectorAll: () => [] },
    devicePixelRatio: 1, requestAnimationFrame() {}, performance: { now: () => 0 } };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  sandbox.reference.place(placements.map(p => ({ ...p })));
  return { ...sandbox.reference, snapshot: () => JSON.parse(sandbox.reference.snapshot()) };
}
