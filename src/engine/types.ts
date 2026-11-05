// Shared types: data snapshots (from the Python pipeline), run settings, scenarios and results.

export interface TempestSnapshot {
  meta: { model: string; start_quarter: string; horizon: number; exported: string; brent_last_quarter_avg: number; vix_last_month: number };
  countries: string[];
  names: Record<string, string>;
  group: Record<string, string>;
  blocks: string[];
  bounds: Record<string, [number, number]>;
  sim: { seed: number; nu_country: number; nu_global: number; loadings: Record<string, number>; initial_state_sd: Record<string, number> };
  param_uncertainty: Record<string, number>;
  params: Record<string, number | number[]>;
  x0: Record<string, number | number[] | number[][]>;
  links: { W_tr: number[][]; W_fin: number[][]; w_ppp: number[]; w_sys: number[]; unions: Record<string, { idx: number[]; w: number[] }> };
  a9_imf: number;
  init_table: Array<Record<string, number | string>>;
  provenance: Record<string, unknown>;
}

export interface StabilityRow {
  iso3: string;
  name: string;
  p_acute: number;
  band: 'Stable' | 'Watch' | 'Fragile' | 'Unstable';
  risk_vs_base: number;
  p_coup: number;
  p_onset: number;
  p_breakdown: number;
  p_erosion: number;
  psi: number;
  drivers: string;
  families: Record<string, number>;
}

export interface PolisCard {
  name: string;
  system: string;
  as_of: string;
  executive: { name: string; party: string; born?: number; since?: string };
  government: string[] | null;
  approval: number | null;
  gsi: number;
  calendar: { date: string; type: string }[];
  macro_label: string;
  fx_label: string | null;
  p_hog_change_24m: number;
  p_early_election: number;
  p_hog_change_by_month: Record<string, number>;
  first_change_type: Record<string, number>;
  outcomes: Record<string, { p: number; spread_bp_mean: number; fx_pct_mean: number | null }>;
  macro: Record<string, { mean: number; p5: number; p50: number; p95: number }>;
  policy_events: { name: string; month: number; p: number }[];
  sources: string[];
}

export interface PolisSnapshot {
  meta: { model: string; paths_run: number; pool: number; seed: number; start_month: string; horizon_months: number; base_rate_acute: number; band_rule: Record<string, string>; acute_auc: number };
  stability: StabilityRow[];
  countries: Record<string, PolisCard>;
  pool: { n: number; econ_keys: Record<string, string>; swing: string; countries: Record<string, Record<string, string | string[] | number>> };
  vuln: Record<string, { v: number; vfx: number | null; em: boolean }>;
}

// ---------------------------------------------------------------- scenarios

/** A forced POLIS outcome: the incumbent camp loses or holds, or the outcome label contains `match`. */
export interface OutcomeCond {
  iso: string;
  kind: 'camp_lost' | 'camp_held' | 'match';
  match?: string;
}

/** Variables a shock card can move. */
export type ShockVar =
  | 'G' // global financial stress (VIX-equivalent), set
  | 'og' // oil price gap, log points (direct effect)
  | 'i' // policy rate, pp above the rule (TEMPEST override)
  | 's' // private borrowing spread, pp
  | 'x' // demand: output gap, pp
  | 'pi' // inflation, pp
  | 'pb' // fiscal stance: structural primary balance, pp of GDP (negative = loosening)
  | 'sov' // sovereign premium, pp
  | 'h' // house prices, % gap
  | 'S' // force the stress regime
  | 'pol_outcome' // force a POLIS political outcome
  | 'swing' // anti-incumbent wave (sigma)
  | 'instab'; // POLIS Layer 1 instability hazard multiplier

export interface Shock {
  id: string;
  var: ShockVar;
  countries: string[] | 'all'; // ISO3 codes (for instab: any POLIS country; 'all' = every country)
  start: number; // first quarter (1 = first simulated quarter)
  path?: number[]; // explicit path from `start`; overrides size/duration/shape
  size: number;
  duration: number; // quarters at full size
  fade: number; // quarters to fade out linearly after `duration`
  // pol_outcome: condition on a POLIS outcome
  outcome?: OutcomeCond;
  scale?: number; // multiplier on an explicit path (preset shocks)
  label?: string;
  raw?: boolean; // path values are TEMPEST 'add' overrides (as in tempest/scenarios.py), not deviation targets
}

export interface Scenario {
  name: string;
  description?: string;
  shocks: Shock[];
  params?: Record<string, number>; // TEMPEST parameter changes applied in the scenario only
}

export interface Assumptions {
  // economy (TEMPEST)
  regimes: boolean;
  fatTails: boolean;
  hysteresis: boolean;
  paramUncertainty: boolean;
  contagion: number; // multiplier on alpha6 (partners' stress) and xi (spread spillovers)
  policyRule: 'look_through' | 'standard' | 'hawkish';
  oilSensitivity: 'default' | 'imf';
  // politics (POLIS coupling)
  politics: boolean;
  econToPolitics: number; // strength of economy -> politics feedback (1 = POLIS calibration)
  politicalImpact: number; // multiplier on POLIS Layer 4 market and real effects
  instability: number; // multiplier on POLIS Layer 1 hazards
  oilChannel: boolean; // geopolitical oil-supply channel
  oilLoss: number; // share of a producer's output lost in an acute event
  oilPriceImpact: number; // log points of oil price per 1% of world supply lost
}

export interface RunSettings {
  paths: number;
  horizon: number; // quarters
  seed: number;
  assumptions: Assumptions;
  scenario: Scenario;
  decompose: boolean; // run the third state (scenario without political feedback)
}

// ---------------------------------------------------------------- results

export const QS = [0.05, 0.16, 0.5, 0.84, 0.95];
export type StateKey = 'A' | 'B' | 'C';

/** Quantiles stored as Float32Array of length (H+1) * N * 5, index ((t * N) + k) * 5 + q. */
export interface CountryQ {
  [v: string]: Float32Array;
}

export interface PolStats {
  camp_lost: number;
  changed: number;
  early: number;
  outcomes: number[]; // share of paths per label index
}

export interface RunResult {
  M: number;
  H: number;
  N: number;
  seconds: number;
  labels: string[];
  countries: string[];
  q: Record<'A' | 'B', CountryQ>; // country variable fans
  eff: CountryQ; // B - A, path-wise (common random numbers)
  effC: CountryQ; // C - A (scenario without political feedback)
  effMean: Record<string, Float32Array>; // mean of B - A across paths, (H+1) * N
  worldEffMean: Float32Array; // mean world GDP level effect, (H+1)
  meanS: Record<StateKey, Float32Array>; // (H+1) * N share of paths in stress
  world: Record<StateKey, Record<string, Float32Array>>; // (H+1) * 5 quantiles; 'stress' is (H+1) mean
  worldEff: Float32Array; // world GDP level effect B - A, (H+1) * 5
  worldEffC: Float32Array; // C - A
  probs: Record<StateKey, Record<string, Float32Array>>; // per-country event probabilities (N)
  worldProbs: Record<StateKey, Record<string, number>>;
  pol: Record<StateKey, Record<string, PolStats>>;
  acute: Record<StateKey, Float32Array>; // share of paths with a Layer 1 acute event per ORBIS economy
  oilEvents: Record<StateKey, number>; // mean number of producer disruptions per path
  guard: Record<string, number>;
  decomposed: boolean;
  worldEffPi: Float32Array; // world inflation effect B - A, (H+1) * 5
  polMean: Record<string, Record<string, Float32Array>>; // mean political deviations per state, (H+1) * N
}
