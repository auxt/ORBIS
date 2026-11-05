// Seeded random numbers for the browser engine.
// xoshiro128** (32-bit state, fast, good statistical quality), seeded through splitmix32.
// Separate streams for shocks, starting-state noise and politics keep scenarios on common random
// numbers: switching politics on or off never changes the economic shocks a path receives.

function splitmix32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | null = null;

  constructor(seed: number, stream = 0) {
    const sm = splitmix32((seed * 2654435761) ^ (stream * 40503 + 0x5bd1e995));
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  next32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform on (0, 1) with 32-bit resolution (ample for Monte Carlo; never exactly 0 or 1). */
  uniform(): number {
    return (this.next32() + 0.5) / 4294967296;
  }

  /** Standard normal (Marsaglia polar method). */
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u: number, v: number, q: number;
    do {
      u = 2 * this.uniform() - 1;
      v = 2 * this.uniform() - 1;
      q = u * u + v * v;
    } while (q >= 1 || q === 0);
    const f = Math.sqrt((-2 * Math.log(q)) / q);
    this.spare = v * f;
    return u * f;
  }

  /** One draw from a precomputed variate table (see tTable). */
  fromTable(tb: Float64Array): number {
    return tb[this.next32() >>> 12];
  }

  /** Gamma(shape, 1), Marsaglia-Tsang. */
  gamma(shape: number): number {
    if (shape < 1) return this.gamma(shape + 1) * Math.pow(this.uniform(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.uniform();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Student-t with nu degrees of freedom, scaled to unit variance (as TEMPEST's unit_t).
   *  Bailey's polar method: one pair of uniforms per draw, no gamma variate needed. */
  unitT(nu: number): number {
    if (!isFinite(nu)) return this.normal();
    let u: number, v: number, w: number;
    do {
      u = 2 * this.uniform() - 1;
      v = 2 * this.uniform() - 1;
      w = u * u + v * v;
    } while (w >= 1 || w === 0);
    const t = u * Math.sqrt((nu * (Math.pow(w, -2 / nu) - 1)) / w);
    return t * Math.sqrt((nu - 2) / nu);
  }
}

/** Precomputed unit-variance Student-t (or normal) variates, 2^20 per degrees of freedom.
 *  Drawing an index costs one 32-bit step instead of a power and a rejection loop; the table is built
 *  once from a fixed seed and is a fine discretisation of the distribution (tails to about +-30 sd). */
const TABLES = new Map<number, Float64Array>();
export function tTable(nu: number): Float64Array {
  let tb = TABLES.get(nu);
  if (!tb) {
    const r = new Rng(918273, Math.round(isFinite(nu) ? nu * 10 : 999));
    tb = new Float64Array(1 << 20);
    for (let i = 0; i < tb.length; i++) tb[i] = r.unitT(nu);
    TABLES.set(nu, tb);
  }
  return tb;
}

function rotl(x: number, k: number) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
