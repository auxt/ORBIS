// Scenario library, shock catalogue and default assumptions.
import type { Assumptions, Scenario, Shock, ShockVar } from './engine/types';

let n = 0;
export const uid = () => `s${Date.now().toString(36)}${(n++).toString(36)}`;

const S = (v: ShockVar, o: Partial<Shock>): Shock => ({
  id: uid(), var: v, countries: 'all', start: 1, size: 0, duration: 4, fade: 4, ...o
});

export interface Preset extends Scenario {
  id: string;
  group: 'Reference' | 'Markets' | 'Energy' | 'Real economy' | 'Politics';
  source?: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'baseline', name: 'Baseline', group: 'Reference',
    description: 'No shocks. TEMPEST economies from the November 2026 data vintage, with POLIS politics as researched on 3–4 November 2026.',
    shocks: []
  },
  {
    id: 'risk_off', name: 'Global risk-off', group: 'Markets', source: 'TEMPEST scenario library',
    description: 'A 2008-style jump in global financial stress (VIX about 48 at the peak), fading over a year.',
    shocks: [S('G', { path: [3.5, 3.0, 2.2, 1.5], label: 'Global stress, VIX-equivalent' })]
  },
  {
    id: 'us_hfl', name: 'US higher for longer', group: 'Markets', source: 'TEMPEST scenario library',
    description: 'The Federal Reserve holds its policy rate 150 bp above its rule for two years.',
    shocks: [S('i', { countries: ['USA'], size: 1.5, duration: 8, fade: 0 })]
  },
  {
    id: 'euro_sov', name: 'Euro sovereign stress', group: 'Markets',
    description: 'French and Italian sovereign premia jump 200 bp and Spain’s 80 bp for 18 months; bank funding spreads follow.',
    shocks: [
      S('sov', { countries: ['FRA', 'ITA'], size: 2.0, start: 2, duration: 6, fade: 4 }),
      S('sov', { countries: ['ESP'], size: 0.8, start: 2, duration: 6, fade: 4 }),
      S('s', { countries: ['FRA', 'ITA', 'ESP'], size: 0.6, start: 2, duration: 6, fade: 4 })
    ]
  },
  {
    id: 'us_crisis', name: 'US crisis episode', group: 'Markets', source: 'TEMPEST paper, experiment E1',
    description: 'The United States is forced into the stress regime for eight quarters; the rest of the world responds endogenously.',
    shocks: [S('S', { countries: ['USA'], size: 1, start: 1, duration: 8, fade: 0 })]
  },
  {
    id: 'oil_spike', name: 'Oil supply shock', group: 'Energy', source: 'TEMPEST scenario library',
    description: 'The oil price gap jumps 40% on impact and 10% more the next quarter, then decays endogenously.',
    shocks: [S('og', { path: [40, 10], raw: true, label: 'Oil price, raw TEMPEST override' })]
  },
  {
    id: 'oil_closure', name: 'Oil crisis 2027: renewed closure', group: 'Energy', source: 'TEMPEST oil-crisis paper',
    description: 'Brent about 45% above baseline in 2027Q1, back to normal by 2028.',
    shocks: [S('og', { start: 2, path: [37, 28, 18, 9], label: 'Oil price above baseline' })]
  },
  {
    id: 'oil_scorched', name: 'Oil crisis 2027: scorched earth', group: 'Energy', source: 'TEMPEST oil-crisis paper',
    description: 'Brent 80–85% above baseline through mid-2027 with slow repair, plus a risk-off shock (VIX about 40).',
    shocks: [
      S('og', { start: 2, path: [60, 62, 50, 40, 30, 20, 12, 6], label: 'Oil price above baseline' }),
      S('G', { start: 2, path: [2.5, 2.0, 1.2, 0.6], label: 'Global stress, VIX-equivalent' })
    ]
  },
  {
    id: 'gulf', name: 'Gulf instability', group: 'Energy',
    description: 'POLIS instability hazards in Gulf producers rise fivefold for the whole horizon; supply losses lift oil through the geopolitical channel.',
    shocks: [S('instab', { countries: ['SAU', 'IRN', 'IRQ', 'ARE', 'KWT', 'QAT', 'OMN'], size: 5, duration: 40, fade: 0 })]
  },
  {
    id: 'china_bust', name: 'China property and credit bust', group: 'Real economy',
    description: 'House prices 15% below baseline and China in the stress regime for six quarters from 2027Q1.',
    shocks: [
      S('h', { countries: ['CHN'], size: -15, start: 2, duration: 6, fade: 6 }),
      S('S', { countries: ['CHN'], size: 1, start: 2, duration: 6, fade: 0 })
    ]
  },
  {
    id: 'stagflation', name: 'Global stagflation', group: 'Real economy',
    description: 'Oil 30% above baseline for a year, inflation 1.5 pp higher everywhere and demand 1 pp weaker.',
    shocks: [
      S('og', { start: 1, size: 30, duration: 4, fade: 4 }),
      S('pi', { size: 1.5, duration: 4, fade: 4 }),
      S('x', { size: -1, duration: 4, fade: 4 })
    ]
  },
  {
    id: 'fiscal_push', name: 'Coordinated fiscal stimulus', group: 'Real economy',
    description: 'Every economy loosens its structural primary balance by 1.5% of GDP for two years.',
    shocks: [S('pb', { size: -1.5, duration: 8, fade: 4 })]
  },
  {
    id: 'anti_inc', name: 'Anti-incumbent wave', group: 'Politics',
    description: 'The anti-incumbent swing POLIS shares across countries is 1.5 standard deviations stronger.',
    shocks: [S('swing', { size: 1.5 })]
  },
  {
    id: 'fra_rn', name: 'France: RN presidency', group: 'Politics', source: 'POLIS, France script',
    description: 'Only political worlds in which the Rassemblement National wins the 2027 presidential election.',
    shocks: [S('pol_outcome', { outcome: { iso: 'FRA', kind: 'match', match: '(RN)' } })]
  },
  {
    id: 'svk_change', name: 'Slovakia: opposition takes power', group: 'Politics', source: 'POLIS, Slovakia',
    description: 'Only political worlds in which a PS-led coalition governs after the 2027 election.',
    shocks: [S('pol_outcome', { outcome: { iso: 'SVK', kind: 'match', match: 'PS-led' } })]
  },
  {
    id: 'us_dem', name: 'US: Democrat elected 2028', group: 'Politics', source: 'POLIS, United States',
    description: 'Only political worlds with a Democratic president-elect in November 2028.',
    shocks: [S('pol_outcome', { outcome: { iso: 'USA', kind: 'match', match: 'Democrat' } })]
  },
  {
    id: 'populist_shock', name: 'Populist shock in Europe', group: 'Politics',
    description: 'RN wins in France, the incumbent camps lose in Germany and the United Kingdom, and the anti-incumbent wave strengthens.',
    shocks: [
      S('pol_outcome', { outcome: { iso: 'FRA', kind: 'match', match: '(RN)' } }),
      S('pol_outcome', { outcome: { iso: 'GBR', kind: 'camp_lost' } }),
      S('swing', { size: 1.0 })
    ]
  }
];

export interface ShockMeta {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  def: number;
  scope: 'world' | 'economies' | 'polis' | 'any';
  help: string;
}

export const SHOCKS: Record<ShockVar, ShockMeta> = {
  G: { label: 'Global risk-off', unit: 'VIX', min: 20, max: 80, step: 1, def: 45, scope: 'world', help: 'Sets global financial stress to the level of this VIX reading, then lets it fade.' },
  og: { label: 'Oil price', unit: '% vs baseline', min: -50, max: 120, step: 5, def: 40, scope: 'world', help: 'Moves the oil price gap (log points). The world economy responds and feeds back.' },
  i: { label: 'Policy rate above rule', unit: 'pp', min: -3, max: 5, step: 0.25, def: 1.5, scope: 'economies', help: 'Central banks hold rates above (or below) what their rule implies.' },
  s: { label: 'Credit spread', unit: 'pp', min: -1, max: 5, step: 0.1, def: 1.5, scope: 'economies', help: 'Private borrowing spreads widen: the financial accelerator.' },
  x: { label: 'Demand', unit: 'pp of output', min: -8, max: 4, step: 0.25, def: -2, scope: 'economies', help: 'A direct shock to the output gap (confidence, trade, investment).' },
  pi: { label: 'Inflation', unit: 'pp', min: -3, max: 8, step: 0.25, def: 2, scope: 'economies', help: 'A cost-push shock to inflation.' },
  pb: { label: 'Fiscal stance', unit: '% of GDP', min: -6, max: 6, step: 0.25, def: -1.5, scope: 'economies', help: 'Structural primary balance; negative values loosen policy.' },
  sov: { label: 'Sovereign premium', unit: 'pp', min: 0, max: 8, step: 0.1, def: 2, scope: 'economies', help: 'Raises government borrowing costs; above 4.5 pp, market access is at risk.' },
  h: { label: 'House prices', unit: '% vs baseline', min: -40, max: 20, step: 1, def: -15, scope: 'economies', help: 'Real house prices fall or rise relative to the baseline.' },
  S: { label: 'Crisis regime', unit: 'forced', min: 1, max: 1, step: 1, def: 1, scope: 'economies', help: 'Holds economies in TEMPEST’s stress regime; exits follow the usual odds afterwards.' },
  pol_outcome: { label: 'Political outcome', unit: '', min: 0, max: 0, step: 1, def: 0, scope: 'polis', help: 'Keeps only POLIS political worlds with this outcome.' },
  swing: { label: 'Anti-incumbent wave', unit: 'σ', min: -2, max: 3, step: 0.25, def: 1.5, scope: 'world', help: 'Shifts the anti-incumbent swing shared across countries.' },
  instab: { label: 'Instability hazard', unit: '×', min: 0, max: 10, step: 0.5, def: 3, scope: 'any', help: 'Multiplies POLIS Layer 1 coup, conflict and breakdown hazards.' }
};

export function newShock(v: ShockVar): Shock {
  const m = SHOCKS[v];
  const base: Shock = { id: uid(), var: v, countries: m.scope === 'world' ? 'all' : ['USA'], start: 1, size: m.def, duration: 4, fade: 4 };
  if (v === 'S') return { ...base, duration: 6, fade: 0 };
  if (v === 'swing') return { ...base, duration: 40, fade: 0 };
  if (v === 'instab') return { ...base, countries: ['SAU', 'IRN', 'IRQ'], duration: 40, fade: 0 };
  if (v === 'pol_outcome') return { ...base, countries: 'all', outcome: { iso: 'FRA', kind: 'camp_lost' } };
  return base;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  regimes: true,
  fatTails: true,
  hysteresis: true,
  paramUncertainty: true,
  contagion: 1,
  policyRule: 'standard',
  oilSensitivity: 'imf',
  politics: true,
  econToPolitics: 1,
  politicalImpact: 1,
  instability: 1,
  oilChannel: true,
  oilLoss: 0.25,
  oilPriceImpact: 8
};

export const clonePreset = (p: Scenario): Scenario => ({ ...p, shocks: p.shocks.map((s) => ({ ...s, id: uid() })) });
