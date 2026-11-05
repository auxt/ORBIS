// The POLIS side of ORBIS: political worlds drawn from POLIS's own Monte Carlo, chosen to fit each
// simulated economy, and mapped into TEMPEST's equations.
//
// 1. Turnover (POLIS Layer 3, 8 countries). POLIS simulated 10,000 joint political worlds, each driven
//    by a world-economy factor and an anti-incumbent swing. ORBIS keeps a pool of those worlds. Just
//    before a country's decisive event (France: end of 2027Q1; US: end of 2028Q3) each ORBIS path picks
//    that country's world by nearest neighbour on (economy so far, swing): the economy key is the path's
//    own world output gap since 2026Q4, standardised on the baseline, so the baseline reproduces POLIS's
//    marginals while a scenario that damages the economy draws more anti-incumbent worlds. The swing is
//    shared by all countries on a path, which keeps POLIS's cross-country correlation.
// 2. Impact (POLIS Layer 4). Each chosen world carries a policy-shift vector (fiscal stance, populism,
//    illiberalism), an uncertainty score, irregular exits and policy events. ORBIS maps them with
//    POLIS's coefficients and vulnerability multipliers into TEMPEST: sovereign premium, exchange rate,
//    a confidence drag on demand, inflation, and the structural primary balance (so the growth effect
//    of fiscal loosening comes from TEMPEST's own fiscal block, not twice).
// 3. Acute instability (POLIS Layer 1, 179 countries). Quarterly hazards from the 12-month coup /
//    conflict / breakdown probabilities. In ORBIS economies without a POLIS state vector an event is an
//    irregular-exit shock; in oil producers it removes supply and lifts TEMPEST's oil price gap.

import type { Assumptions, OutcomeCond, PolisSnapshot, StabilityRow } from './types';

/** Share of world oil production, % (Energy Institute Statistical Review 2025, 2024 data, tonnes). */
export const OIL_PRODUCERS: [string, number][] = [
  ['USA', 18.9], ['RUS', 11.6], ['SAU', 11.2], ['CAN', 6.4], ['IRN', 5.2], ['IRQ', 4.7], ['CHN', 4.7], ['BRA', 4.0],
  ['ARE', 4.0], ['KWT', 2.9], ['MEX', 2.1], ['KAZ', 1.9], ['NOR', 1.9], ['NGA', 1.7], ['QAT', 1.7], ['ARG', 1.3],
  ['DZA', 1.3], ['AGO', 1.3], ['LBY', 1.2], ['VEN', 1.1], ['OMN', 1.1], ['COL', 0.9], ['EGY', 0.7], ['GUY', 0.7],
  ['GBR', 0.7], ['IDN', 0.7], ['AZE', 0.6], ['MYS', 0.5]
];

// POLIS Layer 4 coefficients (polis/macro.py): bp of spread, % FX, pp growth (2 years), pp inflation per unit
export const L4 = {
  A: { fiscal: 15, pop_dm: 30, pop_em: 45, illib_dm: 40, illib_em: 60, unc: 8, irregular: 150 },
  B: { fiscal: -1, pop: -2, illib: -5, unc: -0.4 },
  G: { pop: -1.4, unc: -0.05, irregular: -2.0 },
  I: { illib_em: 1.5, illib_dm: 0.4 },
  FISCAL_PB: 1.0, // ORBIS PLACEHOLDER: pp of GDP of structural primary balance per unit of fiscal-stance shift
  IRREGULAR_U: 3.0 // POLIS uncertainty score of an irregular exit
};
export const ECON_SCALE = 2.0; // ORBIS PLACEHOLDER: pp of world output gap per sigma of POLIS's economy factor
const K_NEAREST = 6;

export const monthToQuarter = (m: number) => (m < 0 ? -1 : Math.floor((m + 1) / 3) + 1);

const ramp = (t: number, tau: number) => (tau < 0 || t < tau ? 0 : Math.min(1, (t - tau + 1) / 2));
const fade = (t: number, tau: number, hl: number) => (tau < 0 || t < tau ? 0 : ramp(t, tau) * Math.pow(0.5, Math.max(0, t - tau - 1) / hl));

function decode(s: string, kind: 'i8' | 'i16'): Int8Array | Int16Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return kind === 'i8' ? new Int8Array(u.buffer) : new Int16Array(u.buffer);
}

export interface PoolCountry {
  iso: string;
  k: number; // index among ORBIS economies (-1 if not one)
  labels: string[];
  tSelect: number; // TEMPEST quarter after which this country's political world is chosen
  f: Record<string, Int8Array | Int16Array>;
}

export class Pool {
  n: number;
  econ: Record<number, Float32Array>; // economy key by selection quarter
  swing: Float32Array;
  countries: PoolCountry[];

  constructor(polis: PolisSnapshot, orbis: string[]) {
    const P = polis.pool;
    this.n = P.n;
    this.econ = {};
    for (const [t, v] of Object.entries(P.econ_keys)) this.econ[+t] = Float32Array.from(decode(v, 'i16'), (x) => x / 1000);
    this.swing = Float32Array.from(decode(P.swing, 'i16'), (v) => v / 1000);
    this.countries = Object.entries(P.countries).map(([iso, c]) => {
      const f: PoolCountry['f'] = {};
      for (const [k, v] of Object.entries(c)) if (typeof v === 'string') f[k] = decode(v, k === 'ev_spread' ? 'i16' : 'i8');
      return { iso, k: orbis.indexOf(iso), labels: c.labels as string[], tSelect: (c.t_select as unknown as number) ?? 4, f };
    });
  }

  /** Pool indices consistent with the forced outcomes that concern this country. */
  eligible(conds: OutcomeCond[]): Int32Array {
    const ok: number[] = [];
    const hits = conds.map((c) => {
      const pc = this.countries.find((x) => x.iso === c.iso);
      return pc ? new Set(pc.labels.map((l, i) => (c.match && l.includes(c.match) ? i : -1)).filter((i) => i >= 0)) : new Set<number>();
    });
    for (let r = 0; r < this.n; r++) {
      let pass = true;
      for (let ci = 0; ci < conds.length; ci++) {
        const c = conds[ci];
        const pc = this.countries.find((x) => x.iso === c.iso);
        if (!pc) continue;
        const lost = (pc.f.flags[r] & 1) === 1;
        if (c.kind === 'camp_lost' && !lost) pass = false;
        if (c.kind === 'camp_held' && lost) pass = false;
        if (c.kind === 'match' && !hits[ci].has(pc.f.outcome[r])) pass = false;
        if (!pass) break;
      }
      if (pass) ok.push(r);
    }
    return Int32Array.from(ok.length ? ok : [...Array(this.n).keys()]);
  }

  nearest(econ: Float32Array, elig: Int32Array, z: number, s: number, u: number): number {
    const best = new Float64Array(K_NEAREST).fill(Infinity);
    const idx = new Int32Array(K_NEAREST).fill(elig[0]);
    for (let j = 0; j < elig.length; j++) {
      const r = elig[j];
      const dz = econ[r] - z, ds = this.swing[r] - s;
      const d = dz * dz + ds * ds;
      if (d < best[K_NEAREST - 1]) {
        let q = K_NEAREST - 1;
        while (q > 0 && best[q - 1] > d) {
          best[q] = best[q - 1];
          idx[q] = idx[q - 1];
          q--;
        }
        best[q] = d;
        idx[q] = r;
      }
    }
    const kk = Math.min(K_NEAREST, elig.length);
    return idx[Math.min(kk - 1, Math.floor(u * kk))];
  }
}

/** Political deviations for one state in one quarter, in TEMPEST units (levels, not increments). */
export interface PolDev {
  x: Float64Array; // output gap, pp
  pi: Float64Array; // inflation, pp
  z: Float64Array; // exchange-rate gap, % (up = depreciation)
  sov: Float64Array; // sovereign premium, pp
  pb: Float64Array; // structural primary balance, pp of GDP
  og: Float64Array; // oil price gap, log points (global, M)
}

export class PoliticsState {
  analog: Int32Array[]; // per pool country: chosen political world per path (-1 until chosen)
  acuteTau: Int16Array; // first Layer 1 event quarter per path x economy (-1 none)
  oilTau: Int16Array; // first disruption quarter per path x producer (-1 none)
  dev: PolDev;

  constructor(public M: number, public N: number, J: number, nPol: number) {
    this.analog = Array.from({ length: nPol }, () => new Int32Array(M).fill(-1));
    this.acuteTau = new Int16Array(M * N).fill(-1);
    this.oilTau = new Int16Array(M * J).fill(-1);
    this.dev = { x: new Float64Array(M * N), pi: new Float64Array(M * N), z: new Float64Array(M * N), sov: new Float64Array(M * N), pb: new Float64Array(M * N), og: new Float64Array(M) };
  }
}

export interface StateSpec {
  instab: Float64Array; // hazard multiplier per ORBIS economy
  instabOil: Float64Array; // hazard multiplier per oil producer
  swingShift: number; // anti-incumbent wave, sigma
  elig: Int32Array[]; // eligible pool members per pool country (forced outcomes)
  feedback: boolean; // economy -> politics feedback active
}

export class Politics {
  J = OIL_PRODUCERS.length;
  hazAcute: Float64Array; // quarterly Layer 1 hazard per ORBIS economy (0 for POLIS-8: Layer 3 covers them)
  hazOil: Float64Array;
  vuln: { v: number; vfx: number | null; em: boolean }[];
  polisIdx: Int8Array; // ORBIS economy -> pool country index (-1)
  xi: Float64Array; // per-path swing noise
  uSel: Float64Array; // per-path uniform for neighbour choice

  constructor(public pool: Pool, polis: PolisSnapshot, public countries: string[], public A: Assumptions, public M: number, rng: { normal(): number; uniform(): number }) {
    const stab = new Map<string, StabilityRow>(polis.stability.map((r) => [r.iso3, r]));
    const q = (p: number) => 1 - Math.pow(1 - Math.min(0.99, p), 0.25);
    this.polisIdx = Int8Array.from(countries, (c) => pool.countries.findIndex((x) => x.iso === c));
    this.hazAcute = Float64Array.from(countries, (c, k) => (this.polisIdx[k] >= 0 ? 0 : q(stab.get(c)?.p_acute ?? 0)));
    this.hazOil = Float64Array.from(OIL_PRODUCERS, ([c]) => q(stab.get(c)?.p_acute ?? 0));
    this.vuln = countries.map((c) => polis.vuln[c] ?? { v: 1, vfx: 1, em: false });
    this.xi = new Float64Array(M);
    this.uSel = new Float64Array(M);
    for (let p = 0; p < M; p++) {
      this.xi[p] = rng.normal();
      this.uSel[p] = rng.uniform();
    }
  }

  /** Draw Layer 1 events for quarter t (uniforms shared across states for common random numbers). */
  events(t: number, st: PoliticsState, spec: StateSpec, uAcute: Float64Array, uOil: Float64Array) {
    const { M } = this, N = this.countries.length, J = this.J;
    const base = this.A.instability;
    for (let p = 0; p < M; p++) {
      for (let k = 0; k < N; k++) {
        const i = p * N + k;
        if (st.acuteTau[i] < 0 && this.hazAcute[k] > 0 && uAcute[i] < this.hazAcute[k] * base * spec.instab[k]) st.acuteTau[i] = t;
      }
      if (this.A.oilChannel)
        for (let j = 0; j < J; j++) {
          const i = p * J + j;
          if (st.oilTau[i] < 0 && uOil[i] < this.hazOil[j] * base * spec.instabOil[j]) st.oilTau[i] = t;
        }
    }
  }

  /** Choose political worlds for the countries whose selection quarter is t. zBase: the baseline's
   *  standardised economy key per path; xShift: this state's world output gap minus the baseline's (pp). */
  select(t: number, st: PoliticsState, spec: StateSpec, zBase: Float64Array, xShift: Float64Array) {
    const k = this.A.econToPolitics;
    this.pool.countries.forEach((pc, ci) => {
      if (pc.tSelect !== t) return;
      const econ = this.pool.econ[t] ?? this.pool.econ[2];
      const an = st.analog[ci];
      for (let p = 0; p < this.M; p++) {
        let z = zBase[p] + (spec.feedback ? (k * xShift[p]) / ECON_SCALE : 0);
        z = Math.max(-3.5, Math.min(3.5, z));
        an[p] = this.pool.nearest(econ, spec.elig[ci], z, this.xi[p] + spec.swingShift, this.uSel[p]);
      }
    });
  }

  /** Political deviations (levels) at quarter t for every path. */
  deviations(t: number, st: PoliticsState) {
    const { M, pool, A } = this, N = this.countries.length;
    const d = st.dev;
    d.x.fill(0); d.pi.fill(0); d.z.fill(0); d.sov.fill(0); d.pb.fill(0); d.og.fill(0);
    if (!A.politics) return;
    const imp = A.politicalImpact;
    for (let k = 0; k < N; k++) {
      const vu = this.vuln[k];
      const pi = this.polisIdx[k];
      const aPop = vu.em ? L4.A.pop_em : L4.A.pop_dm, aIll = vu.em ? L4.A.illib_em : L4.A.illib_dm;
      const iIll = vu.em ? L4.I.illib_em : L4.I.illib_dm;
      for (let p = 0; p < M; p++) {
        const i = p * N + k;
        let sovBp = 0, fx = 0, gr = 0, inf = 0, pb = 0;
        if (pi >= 0) {
          const r = st.analog[pi][p];
          if (r < 0) continue;
          const f = pool.countries[pi].f;
          const df = f.dfis[r] / 100, dp = f.dpop[r] / 100, di = f.dill[r] / 100, U = f.U[r] / 20;
          const Pc = ramp(t, monthToQuarter(f.m_change[r]));
          const Tf = fade(t, monthToQuarter(f.m_first[r]), 6);
          const tauI = monthToQuarter(f.m_irreg[r]);
          const Ti = fade(t, tauI, 6), Ti8 = fade(t, tauI, 8);
          const Te = fade(t, monthToQuarter(f.ev_m[r]), 6);
          sovBp = vu.v * ((L4.A.fiscal * df + aPop * dp + aIll * di) * Pc + L4.A.unc * U * Tf + L4.A.irregular * Ti) + f.ev_spread[r] * Te;
          if (vu.vfx !== null) fx = vu.vfx * ((L4.B.fiscal * df + L4.B.pop * dp + L4.B.illib * di) * Pc + L4.B.unc * U * Tf) + (f.ev_fx[r] / 10) * Te;
          gr = L4.G.pop * dp * Pc + L4.G.unc * U * Tf + L4.G.irregular * Ti8 + (f.ev_growth[r] / 100) * Te;
          inf = iIll * di * Pc + (f.ev_infl[r] / 100) * Te;
          pb = -L4.FISCAL_PB * df * Pc;
        } else {
          const tau = st.acuteTau[i];
          if (tau < 0) continue;
          const U = L4.IRREGULAR_U;
          const T6 = fade(t, tau, 6), T8 = fade(t, tau, 8);
          sovBp = vu.v * (L4.A.irregular + L4.A.unc * U) * T6;
          if (vu.vfx !== null) fx = vu.vfx * L4.B.unc * U * T6;
          gr = (L4.G.irregular + L4.G.unc * U) * T8;
        }
        d.sov[i] = (imp * sovBp) / 100;
        d.z[i] = -imp * fx;
        d.x[i] = imp * gr;
        d.pi[i] = imp * inf;
        d.pb[i] = imp * pb;
      }
    }
    if (A.oilChannel) {
      const J = this.J;
      for (let p = 0; p < M; p++) {
        let og = 0;
        for (let j = 0; j < J; j++) {
          const tau = st.oilTau[p * J + j];
          if (tau >= 0) og += OIL_PRODUCERS[j][1] * A.oilLoss * A.oilPriceImpact * fade(t, tau, 3);
        }
        d.og[p] = og;
      }
    }
  }
}
