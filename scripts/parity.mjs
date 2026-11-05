// Parity check: the TypeScript engine against TEMPEST (Python) on the same snapshot.
// The two use different random-number generators, so they agree in distribution, not path by path:
// each statistic is compared with a tolerance of a few Monte Carlo standard errors.
//
//   npm run parity            (10,000 paths; reference/tempest_reference.json from pipeline/export_tempest.py)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const at = (p) => new URL(p, root).pathname;
mkdirSync(at('node_modules/.cache'), { recursive: true });
await build({ entryPoints: [at('src/engine/run.ts')], bundle: true, format: 'esm', platform: 'node', outfile: at('node_modules/.cache/engine.mjs'), logLevel: 'error' });
const { runModel } = await import(at('node_modules/.cache/engine.mjs'));
const { Pool } = await import(at('node_modules/.cache/engine.mjs')).catch(() => ({}));
const politicsMod = await build({ entryPoints: [at('src/engine/politics.ts')], bundle: true, format: 'esm', platform: 'node', outfile: at('node_modules/.cache/politics.mjs'), logLevel: 'error' }).then(() => import(at('node_modules/.cache/politics.mjs')));

const snap = JSON.parse(readFileSync(at('src/data/tempest_snapshot.json'), 'utf8'));
const polis = JSON.parse(readFileSync(at('src/data/polis_snapshot.json'), 'utf8'));
const ref = JSON.parse(readFileSync(at('reference/tempest_reference.json'), 'utf8'));
const pool = new (Pool ?? politicsMod.Pool)(polis, snap.countries);
const M = +(process.argv[2] ?? ref.paths), H = ref.horizon;

const tempestOnly = {
  regimes: true, fatTails: true, hysteresis: true, paramUncertainty: true, contagion: 1, policyRule: 'standard',
  oilSensitivity: 'default', politics: false, econToPolitics: 1, politicalImpact: 1, instability: 1, oilChannel: false,
  oilLoss: 0.25, oilPriceImpact: 8
};
const us = snap.countries.indexOf('USA');
const nan = (n) => Array(n).fill(NaN);
const LIB = {
  baseline: [],
  global_risk_off: [{ id: 'g', var: 'G', countries: 'all', start: 1, path: [3.5, 3.0, 2.2, 1.5], size: 0, duration: 0, fade: 0 }],
  oil_supply_shock: [{ id: 'o', var: 'og', countries: 'all', start: 1, path: [40, 10], size: 0, duration: 0, fade: 0, raw: true }],
  us_higher_for_longer: [{ id: 'i', var: 'i', countries: ['USA'], start: 1, path: Array(8).fill(1.5), size: 0, duration: 0, fade: 0 }]
};

const rows = [];
let fails = 0;
const check = (name, ts, py, tol) => {
  const ok = Math.abs(ts - py) <= tol;
  if (!ok) fails++;
  rows.push({ check: name, ts: +ts.toFixed(3), python: +py.toFixed(3), tol: +tol.toFixed(3), ok });
};
const w = ppp => ppp; // eslint
const QI = { q05: 0, q16: 1, q50: 2, q84: 3, q95: 4 };
let base = null;
for (const [name, shocks] of Object.entries(LIB)) {
  const t0 = Date.now();
  const r = runModel(snap, polis, pool, { paths: M, horizon: H, seed: 20261104, assumptions: tempestOnly, scenario: { name, shocks }, decompose: false });
  const secs = (Date.now() - t0) / 1000;
  const R = ref.scenarios[name];
  const wg = r.world.B.g;
  for (const t of [4, 8, 20, 40]) {
    const [p05, p50, p95] = R.world_growth_q05_q50_q95[t];
    check(`${name}: world growth median t=${t}`, wg[t * 5 + 2], p50, 0.06);
    check(`${name}: world growth 5% t=${t}`, wg[t * 5 + 0], p05, 0.12);
    check(`${name}: world growth 95% t=${t}`, wg[t * 5 + 4], p95, 0.12);
  }
  for (const t of [1, 2, 4]) check(`${name}: G median t=${t}`, r.world.B.G[t * 5 + 2], R.G_median[t], 0.05);
  for (const t of [8, 20, 40]) check(`${name}: stress share mean t=${t}`, r.world.B.stress[t], R.stress_share_mean[t], 0.012);
  if (R.world_level_effect_q05_q50_q95) {
    for (const t of [4, 8, 20]) {
      const [p05, p50] = R.world_level_effect_q05_q50_q95[t];
      check(`${name}: world level effect median t=${t}`, r.worldEff[t * 5 + 2], p50, Math.max(0.05, 0.08 * Math.abs(p50)));
      check(`${name}: world level effect 5% t=${t}`, r.worldEff[t * 5 + 0], p05, Math.max(0.12, 0.12 * Math.abs(p05)));
    }
  }
  for (const row of R.country_summary) {
    const k = snap.countries.indexOf(row.country);
    const P = r.probs.B;
    check(`${name}: ${row.country} P(stress 5y)`, P.stress5[k], row.p_stress_5y, 0.025);
    check(`${name}: ${row.country} P(recession 2y)`, P.rec2[k], row.p_recession_2y, 0.03);
    check(`${name}: ${row.country} debt median 10y`, r.q.B.d[(H * snap.countries.length + k) * 5 + 2], row.debt_median_10y, Math.max(1.5, 0.02 * row.debt_median_10y));
    check(`${name}: ${row.country} growth median 4q`, r.q.B.g[(4 * snap.countries.length + k) * 5 + 2], row.growth_median_4q, 0.12);
  }
  console.log(`${name.padEnd(22)} ${secs.toFixed(1)}s  world growth y1 median ${wg[4 * 5 + 2].toFixed(2)} (python ${R.world_growth_q05_q50_q95[4][1].toFixed(2)})`);
}
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} checks within tolerance`);
if (bad.length) console.table(bad.slice(0, 40));
mkdirSync(at('reference'), { recursive: true });
writeFileSync(at('reference/parity_report.json'), JSON.stringify({ paths: M, passed: rows.length - bad.length, total: rows.length, rows }, null, 1));
process.exit(bad.length > rows.length * 0.05 ? 1 : 0);
