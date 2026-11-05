// Number formatting: consistent signs, units and precision across the app.
const MINUS = '−';
export const num = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace('-', MINUS) : '–');
export const signed = (v: number, d = 1) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(d) : '–');
export const pct = (p: number, d = 0) => (Number.isFinite(p) ? `${(100 * p).toFixed(d)}%` : '–');
export const pp = (v: number, d = 1) => `${signed(v, d)} pp`;
export const bp = (v: number) => `${signed(v * 100, 0)} bp`;
export const usd = (v: number) => `$${v.toFixed(0)}`;
export const dpct = (a: number, b: number) => `${pct(a)} → ${pct(b)}`;
