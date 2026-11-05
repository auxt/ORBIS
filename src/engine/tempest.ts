// TEMPEST in TypeScript: a line-by-line port of tempest/blocks.py and the engine in tempest/core.py.
// Arrays are flat Float64Array: country variables (M paths x N economies, index p * N + k),
// global variables (M). Equations follow docs/CONCEPTS.md of TEMPEST; comments name the Python block.
//
// ORBIS additions are additive terms only (`adds`): political and scenario impulses enter the same
// equations TEMPEST already has. With every add at zero the model is TEMPEST.

import { expit, ndtr, ndtri } from './special';
import type { Assumptions, TempestSnapshot } from './types';
import { tTable, type Rng } from './rng';

export type Arr = Float64Array;
export type State = Record<string, Arr>;

export const GLOBAL_VARS = new Set(['G', 'og', 'oil', 'SG']);
export const COUNTRY_SHOCKS = ['z', 's', 'x', 'g', 'rs', 'pi', 'i', 'c', 'h', 'pb', 'ca'];
const STATE_VARS = [
  'S', 'S_next', 'dur', 'G', 'og', 'SG', 'oil', 'z', 'dz', 's', 'rstar', 'gstar', 'xF', 'x', 'lnYstar', 'lnY', 'pi',
  'i_shadow', 'i', 'r', 'b_bar', 'c', 'b', 'dh', 'h', 'dsr', 'dsr_ss', 'pd', 'gn', 'gL', 'kappa', 'recap', 'pb_s', 'pb',
  'fi', 'sov', 'ig', 'd', 'default', 'ca', 'n', 'nl_gov', 'nl_priv', 'p01', 'p10'
];

// ---------------------------------------------------------------- parameters

export class Params {
  c: Record<string, Arr> = {}; // per-economy values (N)
  g: Record<string, number> = {}; // global scalars
  m: Record<string, Arr> = {}; // per-path multipliers (M) for parameters with uncertainty
  constructor(public N: number, public M: number) {}

  clone(): Params {
    const q = new Params(this.N, this.M);
    for (const k in this.c) q.c[k] = this.c[k].slice();
    q.g = { ...this.g };
    q.m = this.m; // shared, read-only
    return q;
  }

  /** Path multiplier array for a parameter (ones when it has no uncertainty). */
  mult(name: string): Arr {
    return this.m[name] ?? (this.m['__ones'] ??= new Float64Array(this.M).fill(1));
  }

  set(name: string, value: number | number[]) {
    if (name in this.g) this.g[name] = Array.isArray(value) ? value[0] : value;
    else if (Array.isArray(value)) this.c[name] = Float64Array.from(value);
    else (this.c[name] ??= new Float64Array(this.N)).fill(value);
  }
}

export function buildParams(snap: TempestSnapshot, A: Assumptions, M: number, rng: Rng): Params {
  const N = snap.countries.length;
  const P = new Params(N, M);
  for (const [k, v] of Object.entries(snap.params)) {
    if (Array.isArray(v)) P.c[k] = Float64Array.from(v);
    else P.g[k] = v;
  }
  // per-path parameter uncertainty: lognormal multiplier exp(sd z - sd^2 / 2), common across economies
  for (const [k, sd] of Object.entries(snap.param_uncertainty)) {
    const m = new Float64Array(M);
    for (let p = 0; p < M; p++) m[p] = A.paramUncertainty ? Math.exp(sd * rng.normal() - 0.5 * sd * sd) : 1;
    P.m[k] = m;
  }
  // assumptions
  if (!A.regimes) P.c.alpha0.fill(-60); // the stress regime is never entered
  if (!A.hysteresis) P.c.zeta.fill(0);
  if (A.contagion !== 1) {
    for (let k = 0; k < N; k++) {
      P.c.alpha6[k] *= A.contagion;
      P.c.xi[k] *= A.contagion;
    }
  }
  const ruleK = { look_through: 0.2, standard: 1.0, hawkish: 3.0 }[A.policyRule];
  if (ruleK !== 1) {
    const tur = snap.countries.indexOf('TUR');
    for (let k = 0; k < N; k++) if (k !== tur) P.c.c2[k] = 1 + (P.c.c2[k] - 1) * ruleK; // Turkiye keeps its rule
  }
  // oil sensitivity: TEMPEST default (config), or calibrated so a 10% oil rise held a year costs 0.15% of world GDP
  if (A.oilSensitivity === 'imf') P.c.a9.fill(snap.a9_imf);
  return P;
}

// ---------------------------------------------------------------- initial state

export function initialState(snap: TempestSnapshot, P: Params, M: number, rng: Rng): { X: State; lnYhist: Arr } {
  const N = snap.countries.length;
  const X: State = {};
  const sd = snap.sim.initial_state_sd;
  const x0 = snap.x0;
  for (const v of STATE_VARS) X[v] = new Float64Array(GLOBAL_VARS.has(v) ? M : M * N);
  const tile = (name: string, src: number[]) => {
    const a = X[name];
    for (let p = 0; p < M; p++) for (let k = 0; k < N; k++) a[p * N + k] = src[k];
  };
  for (const [name, val] of Object.entries(x0)) {
    if (name === 'lnY_hist') continue;
    if (typeof val === 'number') {
      if (!X[name]) X[name] = new Float64Array(M);
      X[name].fill(val);
    } else tile(name, val as number[]);
  }
  // nowcast uncertainty in the starting point (x, c, h)
  for (const v of ['x', 'c', 'h']) {
    const s = sd[v] ?? 0;
    if (!s) continue;
    const a = X[v];
    for (let i = 0; i < M * N; i++) a[i] += s * rng.normal();
  }
  const h2 = P.c.h2, Mq = P.c.Mq;
  for (let p = 0; p < M; p++)
    for (let k = 0; k < N; k++) {
      const i = p * N + k;
      X.b[i] = X.b_bar[i] + X.c[i];
      X.pb_s[i] = X.pb[i] - h2[k] * X.x[i];
      X.lnY[i] = X.lnYstar[i] + X.x[i] / 100;
      X.dsr[i] = dsr(X.i[i], X.s[i], X.b[i], Mq[k]);
    }
  const hist = x0.lnY_hist as number[][]; // (4, N): the four quarters before t = 0
  const lnYhist = new Float64Array(4 * M * N);
  for (let j = 0; j < 4; j++) for (let p = 0; p < M; p++) for (let k = 0; k < N; k++) lnYhist[(j * M + p) * N + k] = hist[j][k];
  return { X, lnYhist };
}

export function cloneState(X: State): State {
  const Y: State = {};
  for (const k in X) Y[k] = X[k].slice();
  return Y;
}

export function dsr(i: number, s: number, b: number, Mq: number): number {
  const j = Math.max((i + s) / 400, 1e-5);
  return ((100 * j) / (1 - Math.pow(1 + j, -Mq))) * 4 * b / 100;
}

// ---------------------------------------------------------------- one quarter

export interface Override {
  var: string;
  path: number[]; // length H, NaN = free (quarter 1..H)
  cols: number[] | null;
  mode: 'set' | 'add';
}

/** Additive ORBIS terms for one quarter (all optional, zero when absent). */
export interface Adds {
  x?: Arr; // output gap (M*N)
  pi?: Arr;
  z?: Arr;
  s?: Arr;
  h?: Arr;
  og?: Arr; // global (M)
  sov?: Arr; // sovereign premium level (M*N)
  pbAnchor?: Arr; // structural primary balance anchor level (M*N)
}

export interface Shocks {
  eps: Record<string, Arr>; // country shocks (M*N), global G / oil (M)
  U: Arr; // regime uniforms (M*N)
}

export class Stepper {
  N: number;
  M: number;
  Wtr: Arr;
  Wfin: Arr;
  wppp: Arr;
  wsys: Arr;
  us: number;
  unions: { idx: number[]; w: number[] }[];
  bounds: Record<string, [number, number]>;
  guardHits: Record<string, number> = {};
  allCols: number[];
  ndtriPD: Arr;
  private tmp: Arr;
  private tmp2: Arr;
  private zeros: Arr;

  constructor(public snap: TempestSnapshot, public P: Params, M: number) {
    const N = (this.N = snap.countries.length);
    this.M = M;
    this.Wtr = Float64Array.from(snap.links.W_tr.flat());
    this.Wfin = Float64Array.from(snap.links.W_fin.flat());
    this.wppp = Float64Array.from(snap.links.w_ppp);
    this.wsys = Float64Array.from(snap.links.w_sys);
    this.us = snap.countries.indexOf('USA');
    this.allCols = [...Array(N).keys()];
    this.unions = Object.values(snap.links.unions);
    this.bounds = snap.bounds;
    this.ndtriPD = Float64Array.from(P.c.PD_bar, (v) => ndtri(v));
    this.tmp = new Float64Array(M * N);
    this.tmp2 = new Float64Array(M * N);
    this.zeros = new Float64Array(M * N);
  }

  /** out[p, k] = sum_j W[k, j] X[p, j] (GVAR-style foreign variable). */
  foreign(X: Arr, W: Arr, out: Arr) {
    const N = this.N, M = this.M;
    for (let p = 0; p < M; p++) {
      const o = p * N;
      for (let k = 0; k < N; k++) {
        let acc = 0;
        const r = k * N;
        for (let j = 0; j < N; j++) acc += W[r + j] * X[o + j];
        out[o + k] = acc;
      }
    }
  }

  private post(cur: State, name: string, t: number, ov: Override[] | undefined) {
    const a = cur[name];
    const N = this.N, M = this.M;
    const isG = GLOBAL_VARS.has(name);
    if (ov)
      for (const o of ov) {
        const val = o.path[t - 1];
        if (val === undefined || Number.isNaN(val)) continue;
        if (isG) {
          for (let p = 0; p < M; p++) a[p] = o.mode === 'set' ? val : a[p] + val;
        } else {
          const cols = o.cols ?? this.allCols;
          for (let p = 0; p < M; p++)
            for (const k of cols) {
              const i = p * N + k;
              a[i] = o.mode === 'set' ? val : a[i] + val;
            }
        }
      }
    const b = this.bounds[name];
    if (b) {
      let hits = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] < b[0]) {
          a[i] = b[0];
          hits++;
        } else if (a[i] > b[1]) {
          a[i] = b[1];
          hits++;
        }
      }
      if (hits) this.guardHits[name] = (this.guardHits[name] ?? 0) + hits;
    }
  }

  /** Advance one state by one quarter: writes every variable of `cur` from `prev`. */
  step(t: number, prev: State, cur: State, sh: Shocks, ov: Record<string, Override[]>, add: Adds) {
    const { N, M, P } = this;
    const c = P.c, g = P.g;
    const e = sh.eps;
    const post = (names: string[]) => names.forEach((n) => this.post(cur, n, t, ov[n]));
    const Z = this.zeros;
    const addX = add.x ?? Z, addPi = add.pi ?? Z, addZ = add.z ?? Z, addS = add.s ?? Z, addH = add.h ?? Z;
    const addSov = add.sov ?? Z, addPb = add.pbAnchor ?? Z, addOg = add.og ?? Z;
    // hoisted state arrays (property lookups are kept out of the hot loops)
    const S = cur.S;
    const Gc = cur.G, ogc = cur.og;
    const xP = prev.x, sP = prev.s, rP = prev.r, rstarP = prev.rstar, zP = prev.z, kappaP = prev.kappa, fiP = prev.fi, cP = prev.c;
    const piP = prev.pi, dP = prev.d, pbsP = prev.pb_s, igP = prev.ig, sovP = prev.sov, nP = prev.n, bP = prev.b;

    // RegimeCarry: S_t is the regime drawn at the end of t-1
    S.set(prev.S_next);
    post(['S']);

    // GlobalFactors: global financial stress G and the oil price gap og
    {
      const Sp = prev.S, Gp = prev.G, ogp = prev.og, SGc = cur.SG, eG = e.G, eo = e.oil, wsys = this.wsys, wppp = this.wppp;
      const sbarUS = this.us >= 0 ? c.s_bar[this.us] : 0;
      const { Sigma_bar, sigma_G, mult_G, rho_G, gamma_US, gamma_S, G_floor, sigma_oil, mult_oil, rho_og, o1 } = g;
      for (let p = 0; p < M; p++) {
        const o = p * N;
        let sys = 0, wS = 0, xW = 0;
        for (let k = 0; k < N; k++) {
          sys += Sp[o + k] * wsys[k];
          wS += Sp[o + k] * wppp[k];
          xW += xP[o + k] * wppp[k];
        }
        const SG = wS > Sigma_bar ? 1 : 0;
        const sUS = this.us >= 0 ? sP[o + this.us] - sbarUS : 0;
        const sigG = sigma_G * (1 + (mult_G - 1) * SG);
        const G = rho_G * Gp[p] + gamma_US * sUS + gamma_S * sys + sigG * eG[p];
        Gc[p] = Math.max(G, G_floor);
        const sigo = sigma_oil * (1 + (mult_oil - 1) * SG);
        ogc[p] = rho_og * ogp[p] + o1 * xW + sigo * eo[p] + addOg[p];
        SGc[p] = SG;
      }
      post(['G', 'og', 'SG']);
    }
    // OilInflation
    {
      const oil = cur.oil, ogp = prev.og;
      for (let p = 0; p < M; p++) oil[p] = ogc[p] - ogp[p];
      post(['oil']);
    }
    const oilc = cur.oil;

    // ExchangeRate: real effective exchange-rate gap z (up = depreciation)
    {
      const rgap = this.tmp, rgapF = this.tmp2;
      for (let i = 0; i < M * N; i++) rgap[i] = rP[i] - rstarP[i];
      this.foreign(rgap, this.Wtr, rgapF);
      const { k1, k2, k3, betaG_z, k4, sigma_z, mult_sigma_z } = c;
      const z_ = cur.z, dz_ = cur.dz, ez = e.z;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const s = S[i];
          const z = k1[k] * zP[i] - k2[k] * (rgap[i] - rgapF[i]) + k3[k] * betaG_z[k] * Gc[p] + k4[k] * s +
            sigma_z[k] * (1 + (mult_sigma_z[k] - 1) * s) * ez[i] + addZ[i];
          z_[i] = z;
          dz_[i] = z - zP[i];
        }
      post(['z', 'dz']);
    }
    const dzc = cur.dz;

    // CreditSpread: financial accelerator
    {
      const gap = this.tmp, spill = this.tmp2;
      const { s_bar, d1, d2, d3, betaG_s, d4, kappa_T, d5, xi, sigma_s, mult_sigma_s, s_cap, s_floor } = c;
      for (let p = 0; p < M; p++) for (let k = 0; k < N; k++) gap[p * N + k] = sP[p * N + k] - s_bar[k];
      this.foreign(gap, this.Wfin, spill);
      const d3m = P.mult('d3'), s_ = cur.s, es = e.s;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const s = S[i];
          const v = s_bar[k] + d1[k] * gap[i] - d2[k] * xP[i] + d3[k] * d3m[p] * betaG_s[k] * Gc[p] +
            d4[k] * Math.max(0, kappa_T[k] - kappaP[i]) + d5[k] * s + xi[k] * spill[i] +
            sigma_s[k] * (1 + (mult_sigma_s[k] - 1) * s) * es[i] + addS[i];
          let hat = v - s_bar[k];
          if (hat > 0) hat = s_cap[k] * Math.tanh(hat / s_cap[k]);
          s_[i] = Math.max(s_bar[k] + hat, s_floor[k]);
        }
      post(['s']);
    }
    const sc = cur.s;

    // RealEconomy: IS curve, potential growth with hysteresis, neutral rate
    {
      const xF = cur.xF;
      this.foreign(xP, this.Wtr, xF);
      const a2m = P.mult('a2'), a3m = P.mult('a3'), zm = P.mult('zeta');
      const { r_bar, rho_r, sigma_r, g_bar, rho_g, zeta, sigma_g, a1, d_a1, a2, a3, d_a3, s_bar, a4, a5, a6, a7, c_thr, a8, betaG_s, a9, chi_oil, psi_x, sigma_x, mult_sigma_x } = c;
      const rstarC = cur.rstar, gstarC = cur.gstar, gstarP = prev.gstar, x_ = cur.x, lnYs = cur.lnYstar, lnYsP = prev.lnYstar, lnY = cur.lnY;
      const ers = e.rs, eg = e.g, ex = e.x;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const s = S[i];
          const rstar = r_bar[k] + rho_r[k] * (rstarP[i] - r_bar[k]) + sigma_r[k] * ers[i];
          const gstar = g_bar[k] + rho_g[k] * (gstarP[i] - g_bar[k]) - (1 - rho_g[k]) * zeta[k] * zm[p] * s + sigma_g[k] * eg[i];
          const a1v = a1[k] + s * d_a1[k];
          const a3v = a3[k] * a3m[p] + s * d_a3[k];
          const x = a1v * xP[i] - a2[k] * a2m[p] * (rP[i] - rstar) - a3v * (sc[i] - s_bar[k]) + a4[k] * xF[i] +
            a5[k] * fiP[i] + a6[k] * zP[i] - a7[k] * Math.max(0, cP[i] - c_thr[k]) - a8[k] * betaG_s[k] * Gc[p] +
            a9[k] * chi_oil[k] * ogc[p] - psi_x[k] * s + sigma_x[k] * (1 + (mult_sigma_x[k] - 1) * s) * ex[i] + addX[i];
          rstarC[i] = rstar;
          gstarC[i] = gstar;
          x_[i] = x;
          const ly = lnYsP[i] + gstar / 400;
          lnYs[i] = ly;
          lnY[i] = ly + x / 100;
        }
      post(['rstar', 'gstar', 'xF', 'x', 'lnYstar', 'lnY']);
    }
    const xc = cur.x, rstarC = cur.rstar, gstarC = cur.gstar;

    // Inflation: convex, anchored Phillips curve with FX and oil pass-through
    {
      const b2m = P.mult('b2');
      const { theta, b1, piT, b2, b3, b4, omega_oil, sigma_pi, mult_sigma_pi } = c;
      const pi_ = cur.pi, epi = e.pi;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const s = S[i];
          const th = theta[k];
          const xl = Math.min(12, Math.max(-12, xP[i]));
          const phi = Math.expm1(th * xl) / th;
          pi_[i] = b1[k] * piP[i] + (1 - b1[k]) * piT[k] + b2[k] * b2m[p] * phi + b3[k] * dzc[i] +
            b4[k] * omega_oil[k] * oilc[p] + sigma_pi[k] * (1 + (mult_sigma_pi[k] - 1) * s) * epi[i] + addPi[i];
        }
      post(['pi']);
    }
    const pic = cur.pi;

    // MonetaryPolicy: inertial Taylor rule on the shadow rate, lower bound, currency unions
    {
      const target = this.tmp;
      const { piT, c1, c2, c3, sigma_i, i_elb, shadow_floor } = c;
      const ish = cur.i_shadow, ishP = prev.i_shadow, i_ = cur.i, ei = e.i;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          target[i] = rstarC[i] + piT[k] + c2[k] * (pic[i] - piT[k]) + c3[k] * xc[i];
          ish[i] = c1[k] * ishP[i] + (1 - c1[k]) * target[i] + sigma_i[k] * ei[i];
        }
      for (const u of this.unions) {
        const k0 = u.idx[0];
        for (let p = 0; p < M; p++) {
          const o = p * N;
          let tu = 0;
          for (let j = 0; j < u.idx.length; j++) tu += target[o + u.idx[j]] * u.w[j];
          const iu = c1[k0] * ishP[o + k0] + (1 - c1[k0]) * tu + sigma_i[k0] * ei[o + k0];
          for (const k of u.idx) ish[o + k] = iu;
        }
      }
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const v = Math.max(ish[i], i_elb[k] - shadow_floor[k]);
          ish[i] = v;
          i_[i] = Math.max(i_elb[k], v);
        }
      post(['i_shadow', 'i']);
    }
    const ic = cur.i;

    // RealRate: r = i + unconventional easing - expected inflation
    {
      const { q_qe, b1, piT } = c;
      const ish = cur.i_shadow, r_ = cur.r;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const qe = q_qe[k] * Math.min(0, ish[i] - ic[i]);
          r_[i] = ic[i] + qe - (b1[k] * pic[i] + (1 - b1[k]) * piT[k]);
        }
      post(['r']);
    }
    const rc = cur.r;

    // CreditHousing: credit-to-GDP gap with an adaptive trend, house-price gap
    {
      const e5m = P.mult('e5');
      const { omega_b, e1, e2, e3, s_bar, e4, e5, sigma_c, f1, f2, f3, f4, f6, sigma_h, mult_sigma_h } = c;
      const bbarP = prev.b_bar, dhP = prev.dh, hP = prev.h;
      const bbar_ = cur.b_bar, c_ = cur.c, b_ = cur.b, dh_ = cur.dh, h_ = cur.h, ec = e.c, eh = e.h;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const s = S[i];
          const bbar = bbarP[i] + omega_b[k] * cP[i];
          let cc = e1[k] * cP[i] + e2[k] * xc[i] - e3[k] * (sc[i] - s_bar[k]) + e4[k] * dhP[i] - e5[k] * e5m[p] * s + sigma_c[k] * ec[i];
          const b = Math.max(bbar + cc, 5);
          cc = b - bbar;
          const cost = rc[i] + sc[i] - rstarC[i] - s_bar[k];
          const dh = f1[k] * dhP[i] - f2[k] * hP[i] + f3[k] * xc[i] - f4[k] * cost - f6[k] * s +
            sigma_h[k] * (1 + (mult_sigma_h[k] - 1) * s) * eh[i] + addH[i];
          bbar_[i] = bbar;
          c_[i] = cc;
          b_[i] = b;
          dh_[i] = dh;
          h_[i] = hP[i] + dh;
        }
      post(['b_bar', 'c', 'b', 'dh', 'h']);
    }
    const bc = cur.b, bbarC = cur.b_bar, dhC = cur.dh;

    // Banks: debt service, probit credit losses, CET1, public recapitalisation floor
    {
      const g1m = P.mult('g1');
      const { Mq, r_bar, piT, s_bar, g1, g2, g3, g4, ell, p_pre, LGD, kappa_T, delta_div, phi_div, kappa_min } = c;
      const nd = this.ndtriPD;
      const afSS = new Float64Array(N); // annuity factor at long-run rates (dsr_ss = afSS * 4 * b_bar / 100)
      for (let k = 0; k < N; k++) {
        const j = Math.max((r_bar[k] + piT[k] + s_bar[k]) / 400, 1e-5);
        afSS[k] = (100 * j) / (1 - Math.pow(1 + j, -Mq[k]));
      }
      const dsr_ = cur.dsr, dss_ = cur.dsr_ss, pd_ = cur.pd, gn_ = cur.gn, gL_ = cur.gL, kap_ = cur.kappa, rec_ = cur.recap;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const s = S[i];
          const ds = dsr(ic[i], sc[i], bc[i], Mq[k]);
          const dss = (afSS[k] * 4 * bbarC[i]) / 100;
          const z = nd[k] + g1[k] * g1m[p] * (ds - dss) - g2[k] * xc[i] - g3[k] * dhC[i] + g4[k] * s;
          const pd = ndtr(z);
          const gn = gstarC[i] + pic[i] + 4 * (xc[i] - xP[i]);
          const gL = Math.min(60, Math.max(-40, gn + (400 * (bc[i] - bP[i])) / bP[i]));
          const gLr = gL - pic[i];
          const kp = kappaP[i];
          const Pi = 100 * ell[k] * (p_pre[k] - (LGD[k] * pd) / 4);
          const div = kp > kappa_T[k] ? delta_div[k] * Math.max(0, Pi) + phi_div[k] * (kp - kappa_T[k]) : 0;
          const kt = kp + Pi - div - (kp * gLr) / 400;
          const recap = Math.max(0, kappa_min[k] - kt);
          dsr_[i] = ds;
          dss_[i] = dss;
          pd_[i] = pd;
          gn_[i] = gn;
          gL_[i] = gL;
          kap_[i] = kt + recap;
          rec_[i] = recap;
        }
      post(['dsr', 'dsr_ss', 'pd', 'gn', 'gL', 'kappa', 'recap']);
    }
    const gnC = cur.gn, recC = cur.recap;

    // Fiscal: reaction with fatigue, market access, convex sovereign premium, debt dynamics, restructuring
    {
      const lam1m = P.mult('lam1');
      const { pb_bar_lr, pb_bar, rho_fa, h1, d_T, d_fat, h1_hi, rho_pb, sigma_pb, sov_crit, can_default, pb_cap, pb_prog, h2, dpb_max,
        lam0, lam1, d_star, sov_max, lam2, lam3, betaG_s, lam4, n_bar, m_mat, tau, m_rwa, sfa, haircut } = c;
      const pbs_ = cur.pb_s, pb_ = cur.pb, fi_ = cur.fi, sov_ = cur.sov, ig_ = cur.ig, d_ = cur.d, def_ = cur.default, epb = e.pb;
      const rf = new Float64Array(N);
      for (let k = 0; k < N; k++) rf[k] = Math.pow(rho_fa[k], t);
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const s = S[i];
          const dp = dP[i], x = xc[i];
          const pbInt = pb_bar_lr[k] + (pb_bar[k] - pb_bar_lr[k]) * rf[k];
          const anchor = pbInt + h1[k] * Math.min(dp - d_T[k], d_fat[k] - d_T[k]) + h1_hi[k] * Math.max(0, dp - d_fat[k]) + addPb[i];
          let pbs = rho_pb[k] * pbsP[i] + (1 - rho_pb[k]) * anchor + sigma_pb[k] * epb[i];
          if (sovP[i] > sov_crit[k] && can_default[k] > 0) {
            const req = Math.min(pb_cap[k], Math.max(pb_prog[k], ((igP[i] - gnC[i]) / 100) * dp + 0.5));
            const target = Math.min(req - h2[k] * x, pbsP[i] + dpb_max[k]);
            pbs = Math.max(pbs, target);
          }
          const pb = pbs + h2[k] * x;
          const raw = lam0[k] * Math.exp(Math.min((lam1[k] * lam1m[p] * (dp - d_star[k])) / 100, 50));
          const sov = Math.min(sov_max[k], raw) + lam2[k] * s + lam3[k] * betaG_s[k] * Gc[p] +
            (lam4[k] * Math.max(0, -nP[i] - n_bar[k])) / 100 + addSov[i];
          const ig = (1 - 1 / m_mat[k]) * igP[i] + (1 / m_mat[k]) * (ic[i] + tau[k] + sov);
          let d = (dp * (1 + ig / 400)) / (1 + gnC[i] / 400) - pb / 4 + m_rwa[k] * recC[i] + sfa[k];
          const dflt = raw >= sov_max[k] && can_default[k] > 0;
          if (dflt) d *= 1 - haircut[k];
          pbs_[i] = pbs;
          pb_[i] = pb;
          fi_[i] = -(pbs - pbsP[i]);
          sov_[i] = sov;
          ig_[i] = ig;
          d_[i] = d;
          def_[i] = dflt ? 1 : 0;
        }
      post(['pb_s', 'pb', 'fi', 'sov', 'ig', 'd', 'default']);
    }

    // External: current account, net foreign assets, sector-balance closure
    {
      const { rho_ca, ca_bar, m1, m2, m3, m4, chi_oil, sigma_ca, nu_fx } = c;
      const ca_ = cur.ca, n_ = cur.n, nlg_ = cur.nl_gov, nlp_ = cur.nl_priv, caP = prev.ca, xF = cur.xF, pbC = cur.pb, igC = cur.ig, eca = e.ca;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const ca = rho_ca[k] * caP[i] + (1 - rho_ca[k]) * ca_bar[k] + m1[k] * zP[i] - m2[k] * xc[i] +
            m3[k] * xF[i] + m4[k] * chi_oil[k] * oilc[p] + sigma_ca[k] * eca[i];
          ca_[i] = ca;
          n_[i] = nP[i] / (1 + gnC[i] / 400) + ca / 4 + nu_fx[k] * dzc[i];
          const nlg = pbC[i] - (igC[i] * dP[i]) / 100;
          nlg_[i] = nlg;
          nlp_[i] = ca - nlg;
        }
      post(['ca', 'n', 'nl_gov', 'nl_priv']);
    }

    // RegimeSwitch: endogenous transition probabilities and the regime draw for next quarter
    {
      const partners = this.tmp;
      this.foreign(S, this.Wfin, partners);
      const a5m = P.mult('alpha5'), a6m = P.mult('alpha6');
      const { alpha0, alpha1, alpha2, dsr_bar, alpha3, alpha4, kappa_T, alpha5, alpha6, alpha7, sov_crit, beta0, beta1, kappa_min, beta2, beta3 } = c;
      const cc = cur.c, ds = cur.dsr, hc = cur.h, kc = cur.kappa, sovc = cur.sov, defc = cur.default, durP = prev.dur;
      const p01_ = cur.p01, p10_ = cur.p10, Sn_ = cur.S_next, dur_ = cur.dur, U = sh.U;
      for (let p = 0; p < M; p++)
        for (let k = 0; k < N; k++) {
          const i = p * N + k;
          const u01 = alpha0[k] + alpha1[k] * cc[i] + alpha2[k] * (ds[i] - dsr_bar[k]) + alpha3[k] * hc[i] +
            alpha4[k] * Math.max(0, kappa_T[k] - kc[i]) + alpha5[k] * a5m[p] * Gc[p] + alpha6[k] * a6m[p] * partners[i] +
            alpha7[k] * Math.max(0, sovc[i] - sov_crit[k]);
          const p01 = expit(u01);
          const dur = durP[i];
          const p10 = expit(beta0[k] + beta1[k] * (kc[i] - kappa_min[k]) - beta2[k] * Gc[p] + beta3[k] * Math.min(dur, 16));
          let Sn = S[i] === 0 ? (U[i] < p01 ? 1 : 0) : U[i] >= p10 ? 1 : 0;
          if (defc[i] === 1) Sn = 1;
          p01_[i] = p01;
          p10_[i] = p10;
          Sn_[i] = Sn;
          dur_[i] = (dur + 1) * Sn;
        }
      post(['p01', 'p10', 'S_next', 'dur']);
    }
  }
}

/** Factor-structured Student-t shocks (tempest/shocks.py FactorStudentT) plus regime uniforms. */
export function drawShocks(snap: TempestSnapshot, A: Assumptions, M: number, rng: Rng, out?: Shocks): Shocks {
  const N = snap.countries.length;
  const tbC = tTable(A.fatTails ? snap.sim.nu_country : Infinity);
  const tbG = tTable(A.fatTails ? snap.sim.nu_global : Infinity);
  const sh: Shocks = out ?? { eps: {}, U: new Float64Array(M * N) };
  for (const k of COUNTRY_SHOCKS) {
    const lam = snap.sim.loadings[k] ?? 0;
    const sq = Math.sqrt(1 - lam * lam);
    const a = (sh.eps[k] ??= new Float64Array(M * N));
    for (let p = 0; p < M; p++) {
      const f = rng.fromTable(tbC);
      for (let j = 0; j < N; j++) a[p * N + j] = lam * f + sq * rng.fromTable(tbC);
    }
  }
  for (const k of ['G', 'oil']) {
    const a = (sh.eps[k] ??= new Float64Array(M));
    for (let p = 0; p < M; p++) a[p] = rng.fromTable(tbG);
  }
  for (let i = 0; i < M * N; i++) sh.U[i] = rng.uniform();
  return sh;
}
