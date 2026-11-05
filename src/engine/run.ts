// ORBIS run: TEMPEST economies + POLIS politics, three states in lockstep on common random numbers.
//   A  baseline        (politics as configured, no scenario shocks)
//   B  scenario        (scenario shocks; politics respond to the scenario's economy)
//   C  scenario, politics frozen at the baseline's political worlds (still with any forced outcomes),
//      so B - C is the political feedback and C - A the direct effect of the scenario.
// Every state uses the same shocks, starting noise, parameter draws and political uniforms, so
// differences between states are scenario effects, not Monte Carlo noise.

import { Rng } from './rng';
import { Politics, PoliticsState, Pool, OIL_PRODUCERS, type StateSpec } from './politics';
import { Stepper, buildParams, cloneState, drawShocks, initialState, type Adds, type Arr, type Override, type State } from './tempest';
import type { OutcomeCond, PolStats, PolisSnapshot, RunResult, RunSettings, Shock, StateKey, TempestSnapshot } from './types';
import { QS } from './types';

export const FAN_VARS = ['g', 'x', 'pi', 'i', 's', 'sov', 'd', 'kappa', 'z', 'ca', 'h', 'pb'];
export const EFF_VARS = ['L', 'g', 'pi', 'i', 'sov', 'd', 'z', 'kappa', 's'];
export const EFFC_VARS = ['L', 'd', 'sov'];
const NATIVE = new Set(['G', 'i', 'S']); // shocks applied as TEMPEST overrides (set / add after the block)

export function quarterLabels(start: string, H: number): string[] {
  let y = +start.slice(0, 4), q = +start.slice(-1);
  const out: string[] = [];
  for (let t = 0; t <= H; t++) {
    out.push(`${y}Q${q}`);
    if (++q === 5) { y++; q = 1; }
  }
  return out;
}

/** Shock profile by quarter (index t = 0..H; NaN where the shock is off). */
export function shockPath(sh: Shock, H: number): Float64Array {
  const out = new Float64Array(H + 1).fill(NaN);
  if (sh.path) {
    const m = sh.scale ?? 1;
    sh.path.forEach((v, j) => { if (sh.start + j <= H) out[sh.start + j] = v * m; });
    return out;
  }
  const end = sh.start + sh.duration - 1;
  for (let t = sh.start; t <= H; t++) {
    if (t <= end) out[t] = sh.size;
    else if (t <= end + sh.fade) out[t] = sh.size * (1 - (t - end) / (sh.fade + 1));
  }
  return out;
}

// Exact quantiles in O(n): a histogram pass locates the bins that hold the needed order statistics,
// then only those few values are sorted. The fan charts need five quantiles of every variable, economy
// and quarter, so this is the hot spot after the model itself.
const NB = 256;
const counts = new Int32Array(NB);
const qPlan = new Map<number, { ranks: number[]; lo: number[]; fr: number[] }>();
let gather = new Float64Array(1024);
function quantilesInto(buf: Float64Array, out: Float32Array, off: number) {
  const n = buf.length;
  let plan = qPlan.get(n);
  if (!plan) {
    const lo = QS.map((q) => Math.floor(q * (n - 1)));
    const fr = QS.map((q, j) => q * (n - 1) - lo[j]);
    const ranks = [...new Set(lo.flatMap((l) => [l, Math.min(n - 1, l + 1)]))].sort((a, b) => a - b);
    plan = { ranks, lo, fr };
    qPlan.set(n, plan);
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { const v = buf[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const vals = new Map<number, number>();
  if (!(mx > mn)) {
    for (const r of plan.ranks) vals.set(r, mn);
  } else {
    const sc = (NB - 1e-9) / (mx - mn);
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[((buf[i] - mn) * sc) | 0]++;
    // bin and in-bin offset of every needed rank
    let cum = 0, ri = 0;
    const need = new Map<number, number[]>(); // bin -> ranks
    const start = new Int32Array(NB);
    for (let b = 0; b < NB && ri < plan.ranks.length; b++) {
      start[b] = cum;
      while (ri < plan.ranks.length && plan.ranks[ri] < cum + counts[b]) {
        (need.get(b) ?? need.set(b, []).get(b)!).push(plan.ranks[ri]);
        ri++;
      }
      cum += counts[b];
    }
    for (const [b, rs] of need) {
      const cnt = counts[b];
      if (gather.length < cnt) gather = new Float64Array(cnt * 2);
      let m = 0;
      for (let i = 0; i < n; i++) if ((((buf[i] - mn) * sc) | 0) === b) gather[m++] = buf[i];
      const g = gather.subarray(0, m).sort();
      for (const r of rs) vals.set(r, g[r - start[b]]);
    }
  }
  for (let j = 0; j < QS.length; j++) {
    const l = plan.lo[j], h = Math.min(n - 1, l + 1);
    const vl = vals.get(l)!, vh = vals.get(h)!;
    out[off + j] = vl + plan.fr[j] * (vh - vl);
  }
}

export function runModel(
  snap: TempestSnapshot,
  polis: PolisSnapshot,
  pool: Pool,
  S: RunSettings,
  onProgress?: (t: number, H: number) => void
): RunResult {
  const t0 = performance.now();
  const A = S.assumptions;
  const M = S.paths, H = S.horizon, N = snap.countries.length;
  const cs = snap.countries;
  const keys: StateKey[] = S.decompose ? ['A', 'B', 'C'] : ['A', 'B'];
  const rInit = new Rng(S.seed, 1), rShock = new Rng(S.seed, 2), rPol = new Rng(S.seed, 3), rEv = new Rng(S.seed, 4);

  // ---- parameters, starting state, steppers ----
  const PA = buildParams(snap, A, M, rInit);
  const PB = PA.clone();
  for (const [k, v] of Object.entries(S.scenario.params ?? {})) PB.set(k, v);
  const { X, lnYhist } = initialState(snap, PA, M, rInit);
  const step: Record<StateKey, Stepper> = { A: new Stepper(snap, PA, M), B: new Stepper(snap, PB, M), C: new Stepper(snap, PB, M) };
  const prev: Record<string, State> = {}, cur: Record<string, State> = {};
  for (const s of keys) { prev[s] = cloneState(X); cur[s] = cloneState(X); }

  // ---- scenario: TEMPEST overrides and deviation targets ----
  const idxOf = (list: string[] | 'all') => (list === 'all' ? null : list.map((c) => cs.indexOf(c)).filter((k) => k >= 0));
  const ovB: Record<string, Override[]> = {};
  const devVars = ['x', 'pi', 'og', 's', 'h', 'pb', 'sov', 'z'];
  const scen: Record<string, Float64Array> = {}; // (H+1) * N deviation targets, og (H+1)
  for (const v of devVars) scen[v] = new Float64Array((H + 1) * (v === 'og' ? 1 : N));
  const instab = new Float64Array(N).fill(1), instabOil = new Float64Array(OIL_PRODUCERS.length).fill(1);
  let swingShift = 0;
  const conds: OutcomeCond[] = [];
  const gm = snap.params.vix_mean as number, gsd = snap.params.vix_sd as number;
  for (const sh of S.scenario.shocks) {
    const path = shockPath(sh, H);
    if (sh.var === 'pol_outcome') { if (sh.outcome) conds.push(sh.outcome); continue; }
    if (sh.var === 'swing') { swingShift += sh.size; continue; }
    if (sh.var === 'instab') {
      const set = sh.countries === 'all' ? null : new Set(sh.countries);
      cs.forEach((c, k) => { if (!set || set.has(c)) instab[k] *= sh.size; });
      OIL_PRODUCERS.forEach(([c], j) => { if (!set || set.has(c)) instabOil[j] *= sh.size; });
      continue;
    }
    const cols = idxOf(sh.countries);
    if (NATIVE.has(sh.var) || sh.raw) {
      const p = Array.from({ length: H }, (_, j) => {
        const v = path[j + 1];
        if (Number.isNaN(v)) return NaN;
        // G cards are sized in VIX points and fade towards the VIX mean
        return sh.var === 'G' && !sh.path ? ((sh.size - gm) * (v / (sh.size || 1))) / gsd : v;
      });
      (ovB[sh.var] ??= []).push({ var: sh.var, path: p, cols, mode: sh.var === 'G' || sh.var === 'S' ? 'set' : 'add' });
      continue;
    }
    const tgt = scen[sh.var];
    for (let t = 1; t <= H; t++) {
      const v = path[t];
      if (Number.isNaN(v)) continue;
      if (sh.var === 'og') tgt[t] += v;
      else for (const k of cols ?? [...Array(N).keys()]) tgt[t * N + k] += v;
    }
  }
  const ov: Record<StateKey, Record<string, Override[]>> = { A: {}, B: ovB, C: ovB };

  // ---- politics ----
  const pol = new Politics(pool, polis, cs, A, M, rPol);
  const ps: Record<string, PoliticsState> = {};
  const all = pool.countries.map(() => pool.eligible([]));
  const forced = pool.countries.map((pc) => pool.eligible(conds.filter((c) => c.iso === pc.iso)));
  const selectAt = new Set(pool.countries.map((pc) => pc.tSelect));
  const ones = new Float64Array(N).fill(1), onesOil = new Float64Array(OIL_PRODUCERS.length).fill(1);
  const spec: Record<StateKey, StateSpec> = {
    A: { instab: ones, instabOil: onesOil, swingShift: 0, elig: all, feedback: false },
    B: { instab, instabOil, swingShift, elig: forced, feedback: true },
    C: { instab, instabOil, swingShift, elig: forced, feedback: false }
  };
  for (const s of keys) ps[s] = new PoliticsState(M, N, pol.J, pool.countries.length);
  const uAcute = new Float64Array(M * N), uOil = new Float64Array(M * pol.J);

  // deviation -> increment bookkeeping per state
  const lag: Record<string, Record<string, Float64Array>> = {};
  for (const s of keys) {
    lag[s] = {};
    for (const v of ['x', 'pi', 'z', 's', 'h', 'h2', 'pb']) lag[s][v] = new Float64Array(M * N);
    lag[s].og = new Float64Array(M);
  }
  const adds: Record<string, Adds> = {};
  for (const s of keys)
    adds[s] = { x: new Float64Array(M * N), pi: new Float64Array(M * N), z: new Float64Array(M * N), s: new Float64Array(M * N), h: new Float64Array(M * N), sov: new Float64Array(M * N), pbAnchor: new Float64Array(M * N), og: new Float64Array(M) };
  const c = PA.c;

  // ---- statistics ----
  const L = (H + 1) * N * 5;
  const q: RunResult['q'] = { A: {}, B: {} };
  for (const s of ['A', 'B'] as const) for (const v of FAN_VARS) q[s][v] = new Float32Array(L);
  const eff: RunResult['eff'] = {}, effC: RunResult['effC'] = {};
  for (const v of EFF_VARS) eff[v] = new Float32Array(L);
  for (const v of EFFC_VARS) effC[v] = new Float32Array(L);
  const effMean: Record<string, Float32Array> = {};
  for (const v of EFF_VARS) effMean[v] = new Float32Array((H + 1) * N);
  const worldEffMean = new Float32Array(H + 1);
  const world: RunResult['world'] = { A: {}, B: {}, C: {} };
  for (const s of keys) for (const v of ['g', 'pi', 'G', 'og', 'x']) world[s][v] = new Float32Array((H + 1) * 5);
  for (const s of keys) world[s].stress = new Float32Array(H + 1);
  const worldEff = new Float32Array((H + 1) * 5), worldEffC = new Float32Array((H + 1) * 5), worldEffPi = new Float32Array((H + 1) * 5);
  const meanS = {} as Record<StateKey, Float32Array>;
  const polMean: Record<string, Record<string, Float32Array>> = {};
  for (const s of keys) {
    meanS[s] = new Float32Array((H + 1) * N);
    polMean[s] = { sov: new Float32Array((H + 1) * N), x: new Float32Array((H + 1) * N), z: new Float32Array((H + 1) * N), pi: new Float32Array((H + 1) * N), pb: new Float32Array((H + 1) * N) };
  }
  const flags: Record<string, Record<string, Uint8Array>> = {};
  const wflags: Record<string, Record<string, Uint8Array>> = {};
  for (const s of keys) {
    flags[s] = {};
    for (const f of ['stress5', 'stress10', 'rec2', 'recap', 'default', 'mal']) flags[s][f] = new Uint8Array(M * N);
    wflags[s] = { rec5: new Uint8Array(M), gstress5: new Uint8Array(M), below1_2: new Uint8Array(M) };
  }
  const ring: Record<string, Float64Array> = {};
  for (const s of keys) ring[s] = lnYhist.slice(); // ring[j] holds lnY_{t-4} for t = j (mod 4)
  const gNow: Record<string, Float64Array> = {};
  for (const s of keys) gNow[s] = new Float64Array(M * N);
  const xbar: Record<string, Float64Array> = {};
  for (const s of keys) xbar[s] = new Float64Array(M);
  const d0 = X.d.slice();

  const buf = new Float64Array(M);
  const wbuf = new Float64Array(M);
  const wppp = Float64Array.from(snap.links.w_ppp);
  const sigmaBar = snap.params.Sigma_bar as number;

  const record = (t: number) => {
    for (const s of keys) {
      const st = cur[s];
      // year-on-year growth from the lnY ring
      const r = ring[s], gg = gNow[s];
      const off = (t % 4) * M * N;
      for (let i = 0; i < M * N; i++) {
        gg[i] = 100 * (st.lnY[i] - r[off + i]);
        r[off + i] = st.lnY[i];
      }
      // world aggregates
      const W = world[s];
      const wq = (fn: (p: number) => number, arr: Float32Array) => {
        for (let p = 0; p < M; p++) wbuf[p] = fn(p);
        quantilesInto(wbuf, arr, t * 5);
      };
      const wsum = (a: Arr, p: number) => { let v = 0; for (let k = 0; k < N; k++) v += a[p * N + k] * wppp[k]; return v; };
      wq((p) => wsum(gg, p), W.g);
      wq((p) => wsum(st.pi, p), W.pi);
      wq((p) => wsum(st.x, p), W.x);
      wq((p) => st.G[p], W.G);
      wq((p) => st.og[p], W.og);
      let sm = 0;
      for (let p = 0; p < M; p++) {
        const share = wsum(st.S, p);
        sm += share;
        const gw = wsum(gg, p);
        if (t >= 1 && t <= 20) {
          if (gw < 0) wflags[s].rec5[p] = 1;
          if (share > sigmaBar) wflags[s].gstress5[p] = 1;
        }
        if (t >= 1 && t <= 8 && gw < 1) wflags[s].below1_2[p] = 1;
        if (t >= 1) xbar[s][p] += wsum(st.x, p); // running sum of the world output gap
      }
      W.stress[t] = sm / M;
      // per-country means and path flags
      const ms = meanS[s];
      const F = flags[s];
      for (let k = 0; k < N; k++) {
        let a = 0;
        for (let p = 0; p < M; p++) a += st.S[p * N + k];
        ms[t * N + k] = a / M;
      }
      if (t >= 1)
        for (let i = 0; i < M * N; i++) {
          if (st.S[i] > 0) { if (t <= 20) F.stress5[i] = 1; F.stress10[i] = 1; }
          if (t <= 8 && gg[i] < 0) F.rec2[i] = 1;
          if (st.recap[i] > 0) F.recap[i] = 1;
          if (st.default[i] > 0) F.default[i] = 1;
          if (st.sov[i] > 4.5) F.mal[i] = 1;
        }
      const pm = polMean[s], dv = ps[s].dev;
      for (let k = 0; k < N; k++) {
        let a = 0, b = 0, z = 0, pi_ = 0, pb = 0;
        for (let p = 0; p < M; p++) { const i = p * N + k; a += dv.sov[i]; b += dv.x[i]; z += dv.z[i]; pi_ += dv.pi[i]; pb += dv.pb[i]; }
        pm.sov[t * N + k] = a / M; pm.x[t * N + k] = b / M; pm.z[t * N + k] = z / M; pm.pi[t * N + k] = pi_ / M; pm.pb[t * N + k] = pb / M;
      }
    }
    // country fans (A, B)
    for (const s of ['A', 'B'] as const) {
      const st = cur[s];
      for (const v of FAN_VARS) {
        const src = v === 'g' ? gNow[s] : st[v];
        const out = q[s][v];
        for (let k = 0; k < N; k++) {
          for (let p = 0; p < M; p++) buf[p] = src[p * N + k];
          quantilesInto(buf, out, (t * N + k) * 5);
        }
      }
    }
    // effects, path-wise
    const diff = (sa: string, sb: string, v: string, out: Float32Array, mean?: Float32Array) => {
      const a = v === 'L' ? cur[sa].lnY : v === 'g' ? gNow[sa] : cur[sa][v];
      const b = v === 'L' ? cur[sb].lnY : v === 'g' ? gNow[sb] : cur[sb][v];
      const scale = v === 'L' ? 100 : 1;
      for (let k = 0; k < N; k++) {
        let acc = 0;
        for (let p = 0; p < M; p++) { const d = scale * (b[p * N + k] - a[p * N + k]); buf[p] = d; acc += d; }
        if (mean) mean[t * N + k] = acc / M;
        quantilesInto(buf, out, (t * N + k) * 5);
      }
    };
    for (const v of EFF_VARS) diff('A', 'B', v, eff[v], effMean[v]);
    const wl = (sb: string, out: Float32Array, v = 'lnY', scale = 100) => {
      for (let p = 0; p < M; p++) {
        let a = 0;
        for (let k = 0; k < N; k++) a += (cur[sb][v][p * N + k] - cur.A[v][p * N + k]) * wppp[k];
        wbuf[p] = scale * a;
      }
      if (out === worldEff) { let m = 0; for (let p = 0; p < M; p++) m += wbuf[p]; worldEffMean[t] = m / M; }
      quantilesInto(wbuf, out, t * 5);
    };
    wl('B', worldEff);
    wl('B', worldEffPi, 'pi', 1);
    if (S.decompose) {
      for (const v of EFFC_VARS) diff('A', 'C', v, effC[v]);
      wl('C', worldEffC);
    }
  };

  // t = 0
  for (const s of keys) cur[s] = prev[s];
  record(0);
  for (const s of keys) cur[s] = cloneState(X);

  const sh = drawShocks(snap, A, M, rShock);
  for (let t = 1; t <= H; t++) {
    drawShocks(snap, A, M, rShock, sh);
    for (let i = 0; i < uAcute.length; i++) uAcute[i] = rEv.uniform();
    for (let i = 0; i < uOil.length; i++) uOil[i] = rEv.uniform();
    for (const s of keys) {
      const st = ps[s];
      if (A.politics) pol.events(t, st, spec[s], uAcute, uOil);
      pol.deviations(t, st);
      const dv = st.dev, lg = lag[s], ad = adds[s];
      const isScen = s !== 'A';
      const { a1, b1, k1, d1, f1, rho_pb } = c;
      const sx = scen.x, spi = scen.pi, sz = scen.z, ss = scen.s, shh = scen.h, spb = scen.pb, ssov = scen.sov;
      const lx = lg.x, lpi = lg.pi, lz = lg.z, ls = lg.s, lh = lg.h, lh2 = lg.h2, lpb = lg.pb, log_ = lg.og;
      const ax = ad.x!, api = ad.pi!, az = ad.z!, as_ = ad.s!, ah = ad.h!, asov = ad.sov!, apb = ad.pbAnchor!, aog = ad.og!;
      const dx = dv.x, dpi = dv.pi, dz = dv.z, dsov = dv.sov, dpb = dv.pb, dog = dv.og;
      const rhoOg = PA.g.rho_og as number;
      for (let p = 0; p < M; p++) {
        for (let k = 0; k < N; k++) {
          const i = p * N + k, j = t * N + k;
          const Dx = dx[i] + (isScen ? sx[j] : 0);
          const Dpi = dpi[i] + (isScen ? spi[j] : 0);
          const Dz = dz[i] + (isScen ? sz[j] : 0);
          const Ds = isScen ? ss[j] : 0;
          const Dh = isScen ? shh[j] : 0;
          const Dpb = dpb[i] + (isScen ? spb[j] : 0);
          ax[i] = Dx - a1[k] * lx[i];
          api[i] = Dpi - b1[k] * lpi[i];
          az[i] = Dz - k1[k] * lz[i];
          as_[i] = Ds - d1[k] * ls[i];
          ah[i] = Dh - lh[i] - f1[k] * (lh[i] - lh2[i]);
          asov[i] = dsov[i] + (isScen ? ssov[j] : 0);
          apb[i] = (Dpb - rho_pb[k] * lpb[i]) / (1 - rho_pb[k]);
          lx[i] = Dx; lpi[i] = Dpi; lz[i] = Dz; ls[i] = Ds; lh2[i] = lh[i]; lh[i] = Dh; lpb[i] = Dpb;
        }
        const Dog = dog[p] + (isScen ? scen.og[t] : 0);
        aog[p] = Dog - rhoOg * log_[p];
        log_[p] = Dog;
      }
      step[s].step(t, prev[s], cur[s], sh, ov[s], ad);
    }
    record(t);
    for (const s of keys) { const tmp = prev[s]; prev[s] = cur[s]; cur[s] = tmp; }
    // political worlds are chosen just before each country's decisive event, from the economy so far
    if (A.politics && selectAt.has(t)) {
      let mu = 0, v2 = 0;
      for (let p = 0; p < M; p++) mu += xbar.A[p] / t;
      mu /= M;
      for (let p = 0; p < M; p++) v2 += (xbar.A[p] / t - mu) ** 2;
      const sd = Math.sqrt(v2 / M) || 1;
      const zA = Float64Array.from(xbar.A, (v) => (v / t - mu) / sd);
      for (const s of keys) {
        const shift = Float64Array.from(xbar[s], (v, p) => (v - xbar.A[p]) / t);
        pol.select(t, ps[s], spec[s], zA, shift);
      }
    }
    onProgress?.(t, H);
  }
  for (const s of keys) cur[s] = prev[s];

  // ---- event probabilities ----
  const probs = {} as RunResult['probs'];
  const worldProbs = {} as RunResult['worldProbs'];
  for (const s of keys) {
    const P: Record<string, Float32Array> = {};
    for (const f of Object.keys(flags[s])) {
      const a = new Float32Array(N);
      for (let k = 0; k < N; k++) { let n = 0; for (let p = 0; p < M; p++) n += flags[s][f][p * N + k]; a[k] = n / M; }
      P[f] = a;
    }
    const up = new Float32Array(N);
    for (let k = 0; k < N; k++) { let n = 0; for (let p = 0; p < M; p++) if (cur[s].d[p * N + k] - d0[p * N + k] > 20) n++; up[k] = n / M; }
    P.debt20 = up;
    probs[s] = P;
    const mean = (a: Uint8Array) => a.reduce((x, y) => x + y, 0) / M;
    worldProbs[s] = { rec5: mean(wflags[s].rec5), gstress5: mean(wflags[s].gstress5), below1_2: mean(wflags[s].below1_2) };
  }

  // ---- political statistics ----
  const polStats = {} as RunResult['pol'];
  const acute = {} as RunResult['acute'];
  const oilEvents = {} as RunResult['oilEvents'];
  for (const s of keys) {
    const st = ps[s];
    const out: Record<string, PolStats> = {};
    if (A.politics)
      for (const pc of pool.countries) {
        const o: PolStats = { camp_lost: 0, changed: 0, early: 0, outcomes: new Array(pc.labels.length).fill(0) };
        const an = st.analog[pool.countries.indexOf(pc)];
        for (let p = 0; p < M; p++) {
          const r = an[p];
          if (r < 0) continue;
          const fl = pc.f.flags[r];
          o.camp_lost += fl & 1; o.changed += (fl >> 1) & 1; o.early += (fl >> 2) & 1;
          o.outcomes[pc.f.outcome[r]] += 1;
        }
        o.camp_lost /= M; o.changed /= M; o.early /= M;
        o.outcomes = o.outcomes.map((v) => v / M);
        out[pc.iso] = o;
      }
    polStats[s] = out;
    const ac = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let n = 0;
      const pi = pol.polisIdx[k];
      for (let p = 0; p < M; p++) {
        if (pi >= 0) { const r = st.analog[pi][p]; if (r >= 0 && pool.countries[pi].f.m_irreg[r] >= 0) n++; }
        else if (st.acuteTau[p * N + k] >= 0) n++;
      }
      ac[k] = n / M;
    }
    acute[s] = ac;
    let ne = 0;
    for (let i = 0; i < st.oilTau.length; i++) if (st.oilTau[i] >= 0) ne++;
    oilEvents[s] = ne / M;
  }

  const guard: Record<string, number> = {};
  for (const [k, v] of Object.entries(step.A.guardHits)) guard[k] = v / (H * M * N);

  const res: RunResult = {
    M, H, N, seconds: (performance.now() - t0) / 1000, labels: quarterLabels(snap.meta.start_quarter, H), countries: cs,
    q, eff, effC, effMean, worldEffMean, meanS, world, worldEff, worldEffC, probs, worldProbs, pol: polStats, acute, oilEvents, guard,
    decomposed: S.decompose, worldEffPi, polMean
  };
  return res;
}
