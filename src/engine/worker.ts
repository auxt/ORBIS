// Web worker: holds the data snapshots and runs ORBIS off the main thread.
import { Pool } from './politics';
import { runModel } from './run';
import type { PolisSnapshot, RunSettings, TempestSnapshot } from './types';

let tempest: TempestSnapshot | null = null;
let polis: PolisSnapshot | null = null;
let pool: Pool | null = null;

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    tempest = msg.tempest;
    polis = msg.polis;
    pool = new Pool(polis!, tempest!.countries);
    (self as unknown as Worker).postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'run') {
    if (!tempest || !polis || !pool) return;
    const settings: RunSettings = msg.settings;
    try {
      let last = 0;
      const res = runModel(tempest, polis, pool, settings, (t, H) => {
        const now = performance.now();
        if (now - last > 80 || t === H) {
          last = now;
          (self as unknown as Worker).postMessage({ type: 'progress', id: msg.id, t, H });
        }
      });
      (self as unknown as Worker).postMessage({ type: 'result', id: msg.id, res });
    } catch (e) {
      (self as unknown as Worker).postMessage({ type: 'error', id: msg.id, error: String((e as Error)?.stack ?? e) });
    }
  }
};
