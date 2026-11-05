// Main views: World, Economies, Politics, Contagion, Method, and the country drawer.
import { useMemo, useState, type ReactNode } from 'react';
import { ECON, ECON_IDX, HEX, POLIS, POLIS8, STAB, TEMPEST, brentOf, nameOf, vixOf } from '../data';
import type { RunResult, StateKey } from '../engine/types';
import { num, pct, signed, usd } from '../format';
import { Bars, Dumbbell, FanChart, GradientLegend, Heatmap, STATUS, divColor, niceMax, seqColor, useInterval, type FanSeries, type Theme } from './charts';
import { HexMap } from './HexMap';
import { Segmented } from './ScenarioPanel';

export const C = { base: 'var(--base)', scen: 'var(--scen)', nofb: 'var(--nofb)' };
const N = ECON.length;
const qi = (t: number, k: number, j: number) => (t * N + k) * 5 + j;

export const cq = (r: RunResult, s: 'A' | 'B', v: string, t: number, k: number, j = 2) => r.q[s][v][qi(t, k, j)];
export const ce = (r: RunResult, v: string, t: number, k: number, j = 2) => r.eff[v][qi(t, k, j)];
const wq = (r: RunResult, s: StateKey, v: string, t: number, j = 2) => r.world[s][v][t * 5 + j];

// ---------------------------------------------------------------- map metrics

interface Metric {
  id: string;
  label: string;
  group: 'Economy' | 'Politics';
  timed: boolean;
  kind: 'seq' | 'div' | 'divHigh' | 'status';
  value: (r: RunResult, iso: string, t: number) => number | null;
  fmt: (v: number) => string;
  note?: string;
}
const k_ = (iso: string) => ECON_IDX.get(iso);
const em = (r: RunResult, v: string, t: number, k: number) => r.effMean[v][t * N + k];
export const METRICS: Metric[] = [
  { id: 'gdp', label: 'GDP vs baseline', group: 'Economy', timed: true, kind: 'div', fmt: (v) => `${signed(v, 2)}%`,
    value: (r, iso, t) => (k_(iso) === undefined ? null : em(r, 'L', t, k_(iso)!)), note: 'Average difference in the level of GDP, scenario minus baseline, path by path on the same random numbers.' },
  { id: 'gdp_med', label: 'GDP vs baseline, median path', group: 'Economy', timed: true, kind: 'div', fmt: (v) => `${signed(v, 2)}%`,
    value: (r, iso, t) => (k_(iso) === undefined ? null : ce(r, 'L', t, k_(iso)!)), note: 'Median of the path-by-path GDP level difference. Political scenarios that change only some paths can leave the median at zero; the average shows them.' },
  { id: 'gdp_tail', label: 'GDP vs baseline, worst 5%', group: 'Economy', timed: true, kind: 'div', fmt: (v) => `${signed(v, 1)}%`,
    value: (r, iso, t) => (k_(iso) === undefined ? null : ce(r, 'L', t, k_(iso)!, 0)), note: 'The 5th percentile of the GDP level difference: how bad the bad paths get.' },
  { id: 'crisis', label: 'Crisis within 5 years', group: 'Economy', timed: false, kind: 'seq', fmt: (v) => pct(v),
    value: (r, iso) => (k_(iso) === undefined ? null : r.probs.B.stress5[k_(iso)!]), note: 'Share of paths in which the economy enters TEMPEST’s stress regime within 20 quarters.' },
  { id: 'crisis_d', label: 'Crisis risk vs baseline', group: 'Economy', timed: false, kind: 'divHigh', fmt: (v) => `${signed(100 * v, 0)} pts`,
    value: (r, iso) => (k_(iso) === undefined ? null : r.probs.B.stress5[k_(iso)!] - r.probs.A.stress5[k_(iso)!]) },
  { id: 'stress_t', label: 'In crisis this quarter', group: 'Economy', timed: true, kind: 'seq', fmt: (v) => pct(v),
    value: (r, iso, t) => (k_(iso) === undefined ? null : r.meanS.B[t * N + k_(iso)!]) },
  { id: 'infl', label: 'Inflation vs baseline', group: 'Economy', timed: true, kind: 'divHigh', fmt: (v) => `${signed(v, 2)} pp`,
    value: (r, iso, t) => (k_(iso) === undefined ? null : em(r, 'pi', t, k_(iso)!)), note: 'Average difference in annualised quarterly inflation.' },
  { id: 'sov', label: 'Sovereign premium vs baseline', group: 'Economy', timed: true, kind: 'divHigh', fmt: (v) => `${signed(v, 0)} bp`,
    value: (r, iso, t) => (k_(iso) === undefined ? null : 100 * em(r, 'sov', t, k_(iso)!)), note: 'Average difference in the sovereign risk premium.' },
  { id: 'debt', label: 'Public debt vs baseline', group: 'Economy', timed: true, kind: 'divHigh', fmt: (v) => `${signed(v, 1)} pp of GDP`,
    value: (r, iso, t) => (k_(iso) === undefined ? null : em(r, 'd', t, k_(iso)!)), note: 'Average difference in government debt.' },
  { id: 'band', label: 'Instability band', group: 'Politics', timed: false, kind: 'status', fmt: (v) => ['Stable', 'Watch', 'Fragile', 'Unstable'][v] ?? '–',
    value: (_r, iso) => { const s = STAB.get(iso); return s ? ['Stable', 'Watch', 'Fragile', 'Unstable'].indexOf(s.band) : null; },
    note: 'POLIS Layer 1: 12-month risk of a coup, new armed conflict or democratic breakdown, in bands at multiples of the base rate.' },
  { id: 'p_acute', label: 'Coup, conflict or breakdown (12 months)', group: 'Politics', timed: false, kind: 'seq', fmt: (v) => pct(v, 1),
    value: (_r, iso) => STAB.get(iso)?.p_acute ?? null },
  { id: 'turnover', label: 'Incumbent camp loses power', group: 'Politics', timed: false, kind: 'seq', fmt: (v) => pct(v),
    value: (r, iso) => r.pol.B[iso]?.camp_lost ?? null, note: 'POLIS Layer 3 for the eight countries with researched state vectors, in this scenario.' }
];

export function metricRange(m: Metric, r: RunResult, H: number): number {
  if (m.kind === 'status') return 3;
  let mx = 0;
  const isos = m.group === 'Economy' ? ECON : HEX.isos;
  const ts = m.timed ? Array.from({ length: H }, (_, i) => i + 1) : [0];
  for (const iso of isos) for (const t of ts) { const v = m.value(r, iso, t); if (v !== null && Number.isFinite(v)) mx = Math.max(mx, Math.abs(v)); }
  return m.kind === 'seq' ? niceMax(mx) : niceMax(mx);
}

// ---------------------------------------------------------------- World view

interface ViewProps {
  r: RunResult;
  theme: Theme;
  onCountry: (iso: string) => void;
  selected: string | null;
}

export function WorldView({ r, theme, onCountry, selected }: ViewProps) {
  const [metricId, setMetricId] = useState('gdp');
  const [t, setT] = useState(8);
  const [playing, setPlaying] = useState(false);
  const m = METRICS.find((x) => x.id === metricId)!;
  const max = useMemo(() => metricRange(m, r, r.H), [m, r]);
  const tt = Math.min(t, r.H);
  useInterval(() => setT((v) => (v >= r.H ? 1 : v + 1)), playing ? 450 : null);

  const color = (iso: string) => {
    const v = m.value(r, iso, tt);
    if (v === null || !Number.isFinite(v)) return null;
    if (m.kind === 'status') return STATUS[(['Stable', 'Watch', 'Fragile', 'Unstable'] as const)[v]];
    if (m.kind === 'seq') return seqColor(theme, v / max);
    return divColor(theme, v, max, m.kind === 'divHigh');
  };
  const legend = m.kind === 'status' ? (
    <div className="slegend">{(['Stable', 'Watch', 'Fragile', 'Unstable'] as const).map((b) => <span key={b}><i style={{ background: STATUS[b] }} />{b}</span>)}</div>
  ) : (
    <GradientLegend theme={theme} kind={m.kind as 'seq' | 'div' | 'divHigh'} max={max} fmt={m.fmt} />
  );

  // headline numbers
  const t2 = Math.min(8, r.H);
  const peakPi = maxOver(r.H, (s) => r.worldEffPi[s * 5 + 2]);
  const brentPeakB = maxOver(r.H, (s) => brentOf(wq(r, 'B', 'og', s)));
  const brentPeakA = maxOver(r.H, (s) => brentOf(wq(r, 'A', 'og', s)));
  const w = TEMPEST.links.w_ppp;
  const crisisA = ECON.reduce((a, _, k) => a + w[k] * r.probs.A.stress5[k], 0);
  const crisisB = ECON.reduce((a, _, k) => a + w[k] * r.probs.B.stress5[k], 0);
  const series2 = (v: string, tf: (x: number) => number = (x) => x): FanSeries[] => [
    { name: 'Baseline', color: C.base, get: (s, j) => tf(wq(r, 'A', v, s, j)) },
    { name: 'Scenario', color: C.scen, get: (s, j) => tf(wq(r, 'B', v, s, j)) }
  ];
  const effSeries: FanSeries[] = [{ name: 'Scenario', color: C.scen, get: (s, j) => r.worldEff[s * 5 + j] }];
  if (r.decomposed) effSeries.push({ name: 'Without political feedback', color: C.nofb, get: (s, j) => r.worldEffC[s * 5 + j], bands: false });

  return (
    <div className="view">
      <div className="kpis">
        <Kpi label={`World GDP vs baseline, ${r.labels[t2]}`} value={`${signed(r.worldEffMean[t2], 2)}%`} sub={`Average · median ${signed(r.worldEff[t2 * 5 + 2], 2)}% · worst 5% ${signed(r.worldEff[t2 * 5], 2)}%`} hero />
        <Kpi label="World recession within 5 years" value={pct(r.worldProbs.B.rec5, 1)} sub={`Baseline ${pct(r.worldProbs.A.rec5, 1)}`} delta={r.worldProbs.B.rec5 - r.worldProbs.A.rec5} />
        <Kpi label="World inflation vs baseline, peak" value={`${signed(peakPi.v, 2)} pp`} sub={`in ${r.labels[peakPi.t]}`} />
        <Kpi label="Brent, peak (median)" value={usd(brentPeakB.v)} sub={`Baseline peak ${usd(brentPeakA.v)}`} />
        <Kpi label="Crisis within 5 years, GDP-weighted economy" value={pct(crisisB, 1)} sub={`Baseline ${pct(crisisA, 1)}`} delta={crisisB - crisisA} />
      </div>

      <section className="panel map-panel">
        <div className="panel-head">
          <div>
            <h2>{m.label}{m.timed ? <span className="h-sub"> · {r.labels[tt]}</span> : null}</h2>
            {m.note && <p className="panel-note">{m.note}</p>}
          </div>
          <select className="select" value={metricId} onChange={(e) => setMetricId(e.target.value)} aria-label="Map metric">
            {(['Economy', 'Politics'] as const).map((g) => (
              <optgroup key={g} label={g}>{METRICS.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>
            ))}
          </select>
        </div>
        <HexMap color={color} neutral={theme === 'dark' ? '#2e3537' : '#d9dedc'} selected={selected} onSelect={onCountry}
          labels={m.group === 'Economy' ? ECON : []}
          legend={legend}
          tooltip={(iso) => {
            const v = m.value(r, iso, tt);
            const s = STAB.get(iso);
            return (
              <>
                <div className="tip-row"><span>{m.label}</span><span className="num">{v === null ? 'not modelled' : m.fmt(v)}</span></div>
                {k_(iso) !== undefined && m.id !== 'gdp' && <div className="tip-row"><span>GDP vs baseline</span><span className="num">{signed(em(r, 'L', tt, k_(iso)!), 2)}%</span></div>}
                {s && <div className="tip-row"><span>Instability</span><span className="num">{s.band} · {pct(s.p_acute, 1)}</span></div>}
                {(k_(iso) !== undefined || s) && <div className="tip-hint">Click for details</div>}
              </>
            );
          }} />
        {m.timed && (
          <div className="scrub">
            <button className="icon-btn" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Pause' : 'Play through time'}>{playing ? '❚❚' : '▶'}</button>
            <input type="range" min={1} max={r.H} value={tt} onChange={(e) => { setPlaying(false); setT(+e.target.value); }} aria-label="Quarter" />
            <span className="num scrub-label">{r.labels[tt]}</span>
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="panel"><FanChart labels={r.labels} series={series2('g')} title="World GDP growth" unit="% y/y, PPP-weighted, 17 economies" marker={tt} /></section>
        <section className="panel"><FanChart labels={r.labels} series={effSeries} title="World GDP vs baseline" unit="% of GDP level" marker={tt}
          note={r.decomposed ? 'The orange line freezes politics at the baseline’s political worlds: the gap to blue is the economy-to-politics feedback.' : undefined} /></section>
        <section className="panel"><FanChart labels={r.labels} series={series2('pi')} title="World inflation" unit="% annualised" marker={tt} /></section>
        <section className="panel"><FanChart labels={r.labels} series={series2('og', brentOf)} title="Brent" unit="$ per barrel" fmt={(v) => `$${v.toFixed(0)}`} zero={false} marker={tt} /></section>
        <section className="panel"><FanChart labels={r.labels} series={series2('G', vixOf)} title="Global financial stress" unit="VIX-equivalent" fmt={(v) => v.toFixed(0)} zero={false} marker={tt} /></section>
        <section className="panel"><FanChart labels={r.labels} title="Share of world GDP in crisis regime" unit="mean across paths" marker={tt} fmt={(v) => `${(100 * v).toFixed(0)}%`}
          series={[{ name: 'Baseline', color: C.base, get: (s) => r.world.A.stress[s], bands: false }, { name: 'Scenario', color: C.scen, get: (s) => r.world.B.stress[s], bands: false }]} /></section>
      </div>
    </div>
  );
}

function maxOver(H: number, f: (t: number) => number) {
  let best = { v: -Infinity, t: 0 };
  for (let t = 1; t <= H; t++) { const v = f(t); if (v > best.v) best = { v, t }; }
  return best;
}

function Kpi({ label, value, sub, delta, hero }: { label: string; value: string; sub?: string; delta?: number; hero?: boolean }) {
  return (
    <div className={`kpi ${hero ? 'hero' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}{delta !== undefined && Math.abs(delta) >= 0.0005 ? <b className={delta > 0 ? 'worse' : 'better'}> {delta > 0 ? '▲' : '▼'} {Math.abs(100 * delta).toFixed(1)} pts</b> : null}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- Economies

type SortKey = 'name' | 'gdp' | 'tail' | 'rec' | 'crisis' | 'debt' | 'recap' | 'mal' | 'turn';
export function countryRows(r: RunResult) {
  const t2 = Math.min(8, r.H);
  return ECON.map((iso, k) => ({
    iso, name: nameOf(iso),
    gdp: r.effMean.L[t2 * N + k], tail: ce(r, 'L', t2, k, 0),
    g4A: cq(r, 'A', 'g', 4, k), g4B: cq(r, 'B', 'g', 4, k),
    recA: r.probs.A.rec2[k], rec: r.probs.B.rec2[k],
    crisisA: r.probs.A.stress5[k], crisis: r.probs.B.stress5[k],
    debt: cq(r, 'B', 'd', r.H, k), debtA: cq(r, 'A', 'd', r.H, k),
    recap: r.probs.B.recap[k], mal: r.probs.B.mal[k], dflt: r.probs.B.default[k],
    turnA: r.pol.A[iso]?.camp_lost, turn: r.pol.B[iso]?.camp_lost,
    band: STAB.get(iso)?.band
  }));
}

export function EconomiesView({ r, onCountry }: ViewProps) {
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: 'gdp', d: 1 });
  const rows = useMemo(() => countryRows(r), [r]);
  const sorted = [...rows].sort((a, b) => {
    const va = (a as Record<string, unknown>)[sort.k], vb = (b as Record<string, unknown>)[sort.k];
    if (typeof va === 'string') return sort.d * (va as string).localeCompare(vb as string);
    return sort.d * (((va as number) ?? -1) - ((vb as number) ?? -1));
  });
  const H = (k: SortKey, label: string, title?: string) => (
    <th scope="col" title={title}>
      <button className={`th-btn ${sort.k === k ? 'on' : ''}`} onClick={() => setSort((s) => ({ k, d: s.k === k ? (-s.d as 1 | -1) : k === 'name' ? 1 : -1 }))}>
        {label}{sort.k === k ? (sort.d > 0 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
  return (
    <div className="view">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Economies</h2>
            <p className="panel-note">Scenario against baseline on the same random paths. Probabilities show baseline → scenario. Click a row for the full picture.</p>
          </div>
          <CsvButtons rows={rows} r={r} />
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {H('name', 'Economy')}
                {H('gdp', 'GDP vs base, 2y', 'Average GDP level difference after 8 quarters')}
                {H('tail', 'Worst 5%', '5th percentile of the GDP level difference after 8 quarters')}
                {H('rec', 'Recession, 2y', 'Probability of a year-on-year contraction within 8 quarters')}
                {H('crisis', 'Crisis, 5y', 'Probability of entering the stress regime within 20 quarters')}
                {H('debt', `Debt ${r.labels[r.H].slice(0, 4)}`, 'Median public debt at the horizon, % of GDP')}
                {H('recap', 'Bank recap', 'Probability that banks need public recapitalisation')}
                {H('mal', 'Market access', 'Probability that the sovereign premium exceeds 4.5 pp')}
                {H('turn', 'Camp loses', 'POLIS: incumbent camp loses power by Nov 2028')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((x) => (
                <tr key={x.iso} onClick={() => onCountry(x.iso)} className="clickable" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onCountry(x.iso); }}>
                  <th scope="row"><span className="iso">{x.iso}</span> {x.name}{x.band && <span className={`band band-${x.band}`}>{x.band}</span>}</th>
                  <td className={`num ${x.gdp < -0.05 ? 'neg' : ''}`}>{signed(x.gdp, 2)}%</td>
                  <td className="num dim">{signed(x.tail, 2)}%</td>
                  <td><span className="cell-db"><Dumbbell a={x.recA} b={x.rec} /><span className="num">{pct(x.recA)} → {pct(x.rec)}</span></span></td>
                  <td><span className="cell-db"><Dumbbell a={x.crisisA} b={x.crisis} /><span className="num">{pct(x.crisisA)} → {pct(x.crisis)}</span></span></td>
                  <td className="num">{num(x.debt, 0)}<span className="dim"> ({signed(x.debt - x.debtA, 1)})</span></td>
                  <td className="num">{pct(x.recap)}</td>
                  <td className="num">{pct(x.mal)}</td>
                  <td className="num">{x.turn === undefined ? <span className="dim">–</span> : `${pct(x.turnA!)} → ${pct(x.turn)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function toCsv(rows: ReturnType<typeof countryRows>, r: RunResult) {
  const head = ['iso3', 'economy', 'gdp_vs_base_2y_mean_pct', 'gdp_vs_base_2y_p05_pct', 'growth_4q_base', 'growth_4q_scen', 'p_recession_2y_base', 'p_recession_2y_scen',
    'p_crisis_5y_base', 'p_crisis_5y_scen', `debt_${r.labels[r.H]}_base`, `debt_${r.labels[r.H]}_scen`, 'p_bank_recap', 'p_market_access_loss', 'p_restructuring', 'p_camp_loses_base', 'p_camp_loses_scen', 'instability_band'];
  const lines = rows.map((x) => [x.iso, x.name, x.gdp, x.tail, x.g4A, x.g4B, x.recA, x.rec, x.crisisA, x.crisis, x.debtA, x.debt, x.recap, x.mal, x.dflt, x.turnA ?? '', x.turn ?? '', x.band ?? '']
    .map((v) => (typeof v === 'number' ? v.toFixed(4) : `"${v}"`)).join(','));
  return [head.join(','), ...lines].join('\n');
}

function CsvButtons({ rows, r }: { rows: ReturnType<typeof countryRows>; r: RunResult }) {
  const [msg, setMsg] = useState('');
  const csv = () => toCsv(rows, r);
  return (
    <div className="btn-row">
      <a className="btn ghost" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv())}`} download="orbis-economies.csv">Download CSV</a>
      <button className="btn ghost" onClick={async () => {
        try { await navigator.clipboard.writeText(csv()); setMsg('Copied'); } catch { setMsg('Copy failed'); }
        setTimeout(() => setMsg(''), 1800);
      }}>{msg || 'Copy CSV'}</button>
    </div>
  );
}

// ---------------------------------------------------------------- Politics

export function PoliticsView({ r, theme, onCountry, selected }: ViewProps) {
  const top = [...POLIS.stability].sort((a, b) => b.p_acute - a.p_acute).slice(0, 18);
  const has = Object.keys(r.pol.B).length > 0;
  return (
    <div className="view">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Who holds power by November 2028</h2>
            <p className="panel-note">POLIS Layer 3. Each simulated economy draws a political world from POLIS’s own Monte Carlo: worse economies draw more anti-incumbent worlds. Grey: baseline, blue: scenario.</p>
          </div>
        </div>
        {!has ? <p className="empty">The political layer is switched off in Assumptions.</p> : (
          <div className="pol-grid">
            {POLIS8.map((iso) => {
              const card = POLIS.countries[iso];
              const a = r.pol.A[iso], b = r.pol.B[iso];
              const labels = POLIS.pool.countries[iso].labels as string[];
              const items = labels.map((l, i) => ({ label: l, a: a.outcomes[i], b: b.outcomes[i] })).filter((x) => x.a > 0.01 || x.b > 0.01).sort((x, y) => y.b - x.b).slice(0, 3);
              const k = ECON_IDX.get(iso)!;
              const t8 = Math.min(8, r.H);
              return (
                <button key={iso} className={`card pol-card ${selected === iso ? 'on' : ''}`} onClick={() => onCountry(iso)}>
                  <span className="pol-top"><b>{card.name}</b><span className="dim">{card.executive.name}</span></span>
                  <span className="pol-metric">
                    <span>Incumbent camp loses</span>
                    <span className="cell-db"><Dumbbell a={a.camp_lost} b={b.camp_lost} /><span className="num">{pct(a.camp_lost)} → {pct(b.camp_lost)}</span></span>
                  </span>
                  <Bars items={items.map((x) => ({ ...x, label: x.label.replace('President-elect: ', '').replace('President: ', '') }))} fmt={(v) => pct(v)} />
                  <span className="pol-foot dim">Political premium on {card.macro_label}: <span className="num">{signed(100 * r.polMean.B.sov[t8 * N + k], 0)} bp</span> in {r.labels[t8]}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <div className="grid2 wide-left">
        <section className="panel map-panel">
          <div className="panel-head"><div><h2>Acute instability, next 12 months</h2><p className="panel-note">POLIS Layer 1: coup, new armed conflict or democratic breakdown. 179 countries; out-of-sample ROC-AUC {POLIS.meta.acute_auc}.</p></div></div>
          <HexMap neutral={theme === 'dark' ? '#2e3537' : '#d9dedc'} selected={selected} onSelect={onCountry}
            color={(iso) => { const s = STAB.get(iso); return s ? STATUS[s.band] : null; }}
            legend={<div className="slegend">{(['Stable', 'Watch', 'Fragile', 'Unstable'] as const).map((b) => <span key={b}><i style={{ background: STATUS[b] }} />{b}</span>)}</div>}
            tooltip={(iso) => { const s = STAB.get(iso); return s ? (<><div className="tip-row"><span>{s.band}</span><span className="num">{pct(s.p_acute, 1)}</span></div><div className="tip-small">{s.drivers}</div></>) : <div className="tip-small">Not scored</div>; }} />
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2>Highest risk</h2><p className="panel-note">12-month probability and main drivers.</p></div></div>
          <ol className="risk-list">
            {top.map((s) => (
              <li key={s.iso3}>
                <button className="risk-item" onClick={() => onCountry(s.iso3)}>
                  <span className="risk-name"><i style={{ background: STATUS[s.band] }} aria-hidden="true" />{s.name}</span>
                  <span className="num">{pct(s.p_acute, 1)}</span>
                  <span className="risk-drv dim">{s.drivers.split(';')[0]}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Contagion

export function ContagionView({ r, theme, onCountry }: ViewProps) {
  const [mode, setMode] = useState<'level' | 'diff'>('level');
  const order = [...ECON].sort((a, b) => r.probs.B.stress5[ECON_IDX.get(b)!] - r.probs.B.stress5[ECON_IDX.get(a)!]);
  const val = (i: number, t: number) => {
    const k = ECON_IDX.get(order[i])!;
    return mode === 'level' ? r.meanS.B[t * N + k] : r.meanS.B[t * N + k] - r.meanS.A[t * N + k];
  };
  let mx = 0;
  for (let i = 0; i < order.length; i++) for (let t = 1; t <= r.H; t++) mx = Math.max(mx, Math.abs(val(i, t)));
  mx = niceMax(mx);
  return (
    <div className="view">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>How crises spread</h2>
            <p className="panel-note">Share of paths in TEMPEST’s stress regime, by economy and quarter. Crises enter through credit, house prices, bank capital, sovereign stress, global stress and partners’ stress (trade- and finance-weighted).</p>
          </div>
          <Segmented id="heat-mode" label="Show" value={mode} options={[['level', 'Scenario'], ['diff', 'Scenario minus baseline']]} set={(v) => setMode(v as 'level' | 'diff')} />
        </div>
        <Heatmap rows={order.map((c) => ({ key: c, label: nameOf(c) }))} cols={r.labels} value={val} onRow={onCountry}
          color={(v) => (mode === 'level' ? seqColor(theme, v / mx) : divColor(theme, v, mx, true))}
          fmt={(v) => (mode === 'level' ? pct(v, 1) : `${signed(100 * v, 1)} pts`)} />
        <GradientLegend theme={theme} kind={mode === 'level' ? 'seq' : 'divHigh'} max={mx} fmt={(v) => (mode === 'level' ? pct(v) : `${signed(100 * v, 0)}`)} />
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Financial linkages</h2><p className="panel-note">Each economy’s largest financial partners (TEMPEST’s blend of trade weights and hub weights). Node colour: crisis within 5 years in the scenario.</p></div></div>
        <Network r={r} theme={theme} onCountry={onCountry} />
      </section>
    </div>
  );
}

function Network({ r, theme, onCountry }: { r: RunResult; theme: Theme; onCountry: (iso: string) => void }) {
  const W = TEMPEST.links.W_fin;
  const size = 420, cx = size / 2, cy = size / 2, R = size / 2 - 46;
  const pos = ECON.map((_, k) => { const a = -Math.PI / 2 + (2 * Math.PI * k) / N; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  const edges: [number, number, number][] = [];
  for (let k = 0; k < N; k++) {
    const row = W[k].map((w, j) => [w, j] as [number, number]).filter(([, j]) => j !== k).sort((a, b) => b[0] - a[0]).slice(0, 2);
    for (const [w, j] of row) edges.push([k, j, w]);
  }
  const mx = niceMax(Math.max(...ECON.map((_, k) => r.probs.B.stress5[k])));
  return (
    <div className="network">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Network of financial linkages between the 17 economies">
        {edges.map(([a, b, w], i) => (
          <line key={i} x1={pos[a][0]} y1={pos[a][1]} x2={pos[b][0]} y2={pos[b][1]} className="edge" style={{ strokeWidth: 0.5 + 6 * w }} />
        ))}
        {ECON.map((iso, k) => (
          <g key={iso} className="node clickable" onClick={() => onCountry(iso)}>
            <circle cx={pos[k][0]} cy={pos[k][1]} r={8 + 30 * Math.sqrt(TEMPEST.links.w_ppp[k])} style={{ fill: seqColor(theme, r.probs.B.stress5[k] / mx) }} />
            <text x={pos[k][0]} y={pos[k][1] + 3.5} textAnchor="middle" className="node-label">{iso}</text>
            <title>{`${nameOf(iso)}: crisis within 5 years ${pct(r.probs.B.stress5[k])}`}</title>
          </g>
        ))}
      </svg>
      <GradientLegend theme={theme} kind="seq" max={mx} fmt={(v) => pct(v)} />
    </div>
  );
}

// ---------------------------------------------------------------- Country drawer

export function CountryDrawer({ iso, r, onClose }: { iso: string; r: RunResult; onClose: () => void }) {
  const k = ECON_IDX.get(iso);
  const s = STAB.get(iso);
  const card = POLIS.countries[iso];
  const two = (v: string, tf: (x: number) => number = (x) => x): FanSeries[] => [
    { name: 'Baseline', color: C.base, get: (t, j) => tf(cq(r, 'A', v, t, k!, j)) },
    { name: 'Scenario', color: C.scen, get: (t, j) => tf(cq(r, 'B', v, t, k!, j)) }
  ];
  const t8 = Math.min(8, r.H);
  return (
    <div className="drawer" role="dialog" aria-label={`${nameOf(iso)} details`}>
      <div className="drawer-head">
        <div>
          <span className="eyebrow">{k !== undefined ? `ORBIS economy · ${TEMPEST.group[iso] === 'EM' ? 'emerging market' : 'advanced economy'}` : 'POLIS coverage only'}</span>
          <h2>{nameOf(iso)}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="drawer-body">
        {k !== undefined && (
          <>
            <div className="mini-kpis">
              <div><span>GDP vs baseline, 2y</span><b className="num">{signed(r.effMean.L[t8 * N + k], 2)}%</b><small>average · worst 5%: {signed(ce(r, 'L', t8, k, 0), 2)}%</small></div>
              <div><span>Crisis within 5 years</span><b className="num">{pct(r.probs.B.stress5[k])}</b><small>baseline {pct(r.probs.A.stress5[k])}</small></div>
              <div><span>Recession within 2 years</span><b className="num">{pct(r.probs.B.rec2[k])}</b><small>baseline {pct(r.probs.A.rec2[k])}</small></div>
              <div><span>Debt restructuring</span><b className="num">{pct(r.probs.B.default[k], 1)}</b><small>baseline {pct(r.probs.A.default[k], 1)}</small></div>
            </div>
            <div className="small-multiples">
              <div className="sm-legend legend"><span className="legend-item"><i style={{ background: C.base }} />Baseline</span><span className="legend-item"><i style={{ background: C.scen }} />Scenario</span><span className="dim">median, 68% and 90% bands</span></div>
              <FanChart labels={r.labels} series={two('g')} title="GDP growth" unit="% y/y" height={150} legend={false} />
              <FanChart labels={r.labels} series={two('pi')} title="Inflation" unit="%" height={150} legend={false} />
              <FanChart labels={r.labels} series={two('i')} title="Policy rate" unit="%" height={150} legend={false} zero={false} />
              <FanChart labels={r.labels} series={two('d')} title="Public debt" unit="% of GDP" height={150} legend={false} zero={false} fmt={(v) => v.toFixed(0)} />
              <FanChart labels={r.labels} series={two('sov', (x) => 100 * x)} title="Sovereign premium" unit="bp" height={150} legend={false} fmt={(v) => v.toFixed(0)} />
              <FanChart labels={r.labels} series={two('kappa')} title="Bank capital (CET1)" unit="% of risk-weighted assets" height={150} legend={false} zero={false} />
              <FanChart labels={r.labels} series={two('s')} title="Private borrowing spread" unit="pp" height={150} legend={false} zero={false} />
              <FanChart labels={r.labels} series={two('z')} title="Real exchange rate gap" unit="%, up = depreciation" height={150} legend={false} />
              <FanChart labels={r.labels} title="In crisis regime" unit="share of paths" height={150} legend={false} fmt={(v) => `${Math.round(100 * v)}%`}
                series={[{ name: 'Baseline', color: C.base, get: (t) => r.meanS.A[t * N + k], bands: false }, { name: 'Scenario', color: C.scen, get: (t) => r.meanS.B[t * N + k], bands: false }]} />
            </div>
            <StartingPoint iso={iso} />
          </>
        )}
        {card && r.pol.B[iso] && (
          <section className="drawer-sec">
            <h3>Politics (POLIS)</h3>
            <dl className="facts">
              <div><dt>Head of government</dt><dd>{card.executive.name} ({card.executive.party})</dd></div>
              {card.approval !== null && <div><dt>Approval</dt><dd className="num">{num(card.approval, 0)}%</dd></div>}
              <div><dt>Government Security Index</dt><dd className="num">{card.gsi} / 100</dd></div>
              <div><dt>Next events</dt><dd>{card.calendar.filter((c) => c.date >= '2026-11').slice(0, 3).map((c) => `${c.date} ${c.type.replace(/_/g, ' ')}`).join(' · ') || '–'}</dd></div>
            </dl>
            <div className="pol-metric">
              <span>Incumbent camp loses by Nov 2028</span>
              <span className="cell-db"><Dumbbell a={r.pol.A[iso].camp_lost} b={r.pol.B[iso].camp_lost} /><span className="num">{pct(r.pol.A[iso].camp_lost)} → {pct(r.pol.B[iso].camp_lost)}</span></span>
            </div>
            <Bars items={(POLIS.pool.countries[iso].labels as string[]).map((l, i) => ({ label: l, a: r.pol.A[iso].outcomes[i], b: r.pol.B[iso].outcomes[i] })).filter((x) => x.a > 0.005 || x.b > 0.005).sort((a, b) => b.b - a.b).slice(0, 5)} fmt={(v) => pct(v)} />
            {k !== undefined && (
              <p className="drawer-note">Mean political add-ons in {r.labels[t8]}, scenario: sovereign premium <b className="num">{signed(100 * r.polMean.B.sov[t8 * N + k], 0)} bp</b>, output <b className="num">{signed(r.polMean.B.x[t8 * N + k], 2)} pp</b>, primary balance <b className="num">{signed(r.polMean.B.pb[t8 * N + k], 2)} pp</b> of GDP.</p>
            )}
          </section>
        )}
        {s && (
          <section className="drawer-sec">
            <h3>Acute instability (POLIS Layer 1)</h3>
            <div className="stab-row">
              <span className={`band band-${s.band}`}>{s.band}</span>
              <span className="num">{pct(s.p_acute, 1)} in 12 months</span>
              <span className="dim">coup {pct(s.p_coup, 1)} · conflict {pct(s.p_onset, 1)} · breakdown {pct(s.p_breakdown, 1)}</span>
            </div>
            <p className="drawer-note">Main drivers: {s.drivers}</p>
            <Drivers fam={s.families} />
          </section>
        )}
        {!s && k === undefined && <p className="empty">No data for this country.</p>}
      </div>
    </div>
  );
}

function Drivers({ fam }: { fam: Record<string, number> }) {
  const entries = Object.entries(fam).sort((a, b) => b[1] - a[1]);
  const mx = Math.max(0.01, ...entries.map(([, v]) => Math.abs(v)));
  return (
    <div className="drivers">
      {entries.map(([f, v]) => (
        <div key={f} className="drv-row">
          <span>{f}</span>
          <span className="drv-track"><span className={`drv-bar ${v >= 0 ? 'up' : 'down'}`} style={{ width: `${(50 * Math.abs(v)) / mx}%`, [v >= 0 ? 'left' : 'right']: '50%' } as React.CSSProperties} /></span>
          <span className="num">{signed(v, 2)}</span>
        </div>
      ))}
      <small className="dim">Contribution to the log-odds of acute instability (SHAP), by driver family. Right raises risk.</small>
    </div>
  );
}

function StartingPoint({ iso }: { iso: string }) {
  const row = TEMPEST.init_table.find((x) => x.iso3 === iso)!;
  const f = (k: string, d = 1, unit = '') => `${num(row[k] as number, d)}${unit}`;
  return (
    <section className="drawer-sec">
      <h3>Starting point, {TEMPEST.meta.start_quarter}</h3>
      <dl className="facts cols">
        <div><dt>Output gap</dt><dd className="num">{f('output_gap', 1, '%')}</dd></div>
        <div><dt>Inflation</dt><dd className="num">{f('inflation', 1, '%')}</dd></div>
        <div><dt>Policy rate</dt><dd className="num">{f('policy_rate', 2, '%')}</dd></div>
        <div><dt>Public debt</dt><dd className="num">{f('gov_debt', 0, '% of GDP')}</dd></div>
        <div><dt>Private credit</dt><dd className="num">{f('credit_gdp', 0, '% of GDP')}</dd></div>
        <div><dt>Credit gap</dt><dd className="num">{f('credit_gap', 1, ' pp')}</dd></div>
        <div><dt>House prices vs trend</dt><dd className="num">{f('house_gap', 1, '%')}</dd></div>
        <div><dt>Bank CET1</dt><dd className="num">{f('bank_cet1', 1, '%')}</dd></div>
        <div><dt>Current account</dt><dd className="num">{f('current_account', 1, '% of GDP')}</dd></div>
        <div><dt>Net foreign assets</dt><dd className="num">{f('nfa', 0, '% of GDP')}</dd></div>
      </dl>
      <small className="dim">BIS, IMF (WEO, FSI, IIP) and FRED, data vintage {TEMPEST.meta.exported.slice(0, 10)}.</small>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
