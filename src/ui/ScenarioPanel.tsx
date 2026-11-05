// Left rail: scenario library, editable shock cards and model assumptions.
import { useState } from 'react';
import { ECON, POLIS, POLIS8, nameOf, VIX } from '../data';
import { OIL_PRODUCERS } from '../engine/politics';
import type { Assumptions, Scenario, Shock, ShockVar } from '../engine/types';
import { num } from '../format';
import { PRESETS, SHOCKS, newShock } from '../scenarios';

const QLABEL = (t: number, labels: string[]) => labels[t] ?? `t${t}`;

interface Props {
  presetId: string;
  scenario: Scenario;
  assumptions: Assumptions;
  labels: string[];
  paths: number;
  horizon: number;
  onPreset: (id: string) => void;
  onScenario: (s: Scenario) => void;
  onAssumptions: (a: Assumptions) => void;
  onPaths: (n: number) => void;
  onHorizon: (h: number) => void;
}

export function ScenarioPanel(p: Props) {
  const [adding, setAdding] = useState(false);
  const [openA, setOpenA] = useState(false);
  const groups = [...new Set(PRESETS.map((x) => x.group))];
  const preset = PRESETS.find((x) => x.id === p.presetId);
  const setShock = (id: string, patch: Partial<Shock>) =>
    p.onScenario({ ...p.scenario, name: p.scenario.name, shocks: p.scenario.shocks.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const remove = (id: string) => p.onScenario({ ...p.scenario, shocks: p.scenario.shocks.filter((s) => s.id !== id) });
  const add = (v: ShockVar) => { p.onScenario({ ...p.scenario, shocks: [...p.scenario.shocks, newShock(v)] }); setAdding(false); };
  const A = p.assumptions;
  const setA = (patch: Partial<Assumptions>) => p.onAssumptions({ ...A, ...patch });

  return (
    <aside className="rail">
      <section className="rail-sec">
        <label className="eyebrow" htmlFor="preset">Scenario</label>
        <select id="preset" className="select" value={p.presetId} onChange={(e) => p.onPreset(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {PRESETS.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </optgroup>
          ))}
          {p.presetId === 'custom' && <option value="custom">Custom scenario</option>}
        </select>
        <p className="rail-desc">{p.presetId === 'custom' ? 'Your own mix of shocks.' : preset?.description}</p>
        {preset?.source && p.presetId !== 'custom' && <p className="rail-source">Source: {preset.source}</p>}
      </section>

      <section className="rail-sec">
        <div className="rail-head">
          <span className="eyebrow">Shocks</span>
          <button className="text-btn" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>{adding ? 'Close' : '+ Add shock'}</button>
        </div>
        {adding && (
          <div className="add-grid">
            {(Object.keys(SHOCKS) as ShockVar[]).map((v) => (
              <button key={v} className="add-item" onClick={() => add(v)} title={SHOCKS[v].help}>
                <span>{SHOCKS[v].label}</span>
                <small>{SHOCKS[v].help}</small>
              </button>
            ))}
          </div>
        )}
        {p.scenario.shocks.length === 0 && !adding && <p className="rail-empty">No shocks: this is the baseline. Add one to build a scenario.</p>}
        <div className="cards">
          {p.scenario.shocks.map((s) => (
            <ShockCard key={s.id} s={s} labels={p.labels} horizon={p.horizon} onChange={(patch) => setShock(s.id, patch)} onRemove={() => remove(s.id)} />
          ))}
        </div>
      </section>

      <section className="rail-sec">
        <button className="rail-head toggle" onClick={() => setOpenA((v) => !v)} aria-expanded={openA}>
          <span className="eyebrow">Assumptions</span>
          <span className="caret">{openA ? '−' : '+'}</span>
        </button>
        {!openA && <p className="rail-desc">{summary(A)}</p>}
        {openA && (
          <div className="assume">
            <h4>Economy (TEMPEST)</h4>
            <Toggle id="a-reg" label="Crisis regimes" hint="Economies can switch into a stress regime" on={A.regimes} set={(v) => setA({ regimes: v })} />
            <Toggle id="a-fat" label="Fat-tailed shocks" hint="Student-t instead of normal" on={A.fatTails} set={(v) => setA({ fatTails: v })} />
            <Toggle id="a-hys" label="Scarring" hint="Crises lower trend growth" on={A.hysteresis} set={(v) => setA({ hysteresis: v })} />
            <Toggle id="a-par" label="Parameter uncertainty" hint="Key coefficients drawn per path" on={A.paramUncertainty} set={(v) => setA({ paramUncertainty: v })} />
            <Slider id="a-con" label="Contagion strength" value={A.contagion} min={0} max={3} step={0.25} fmt={(v) => `×${num(v, 2)}`} set={(v) => setA({ contagion: v })} />
            <Segmented id="a-rule" label="Central banks" value={A.policyRule} options={[['look_through', 'Look through'], ['standard', 'Standard'], ['hawkish', 'Hawkish']]} set={(v) => setA({ policyRule: v as Assumptions['policyRule'] })} />
            <Segmented id="a-oil" label="Oil sensitivity" value={A.oilSensitivity} options={[['default', 'TEMPEST default'], ['imf', 'IMF-consistent']]} set={(v) => setA({ oilSensitivity: v as Assumptions['oilSensitivity'] })} />
            <h4>Politics (POLIS)</h4>
            <Toggle id="a-pol" label="Political layer" hint="Off = TEMPEST alone" on={A.politics} set={(v) => setA({ politics: v })} />
            <Slider id="a-e2p" label="Economy → politics" value={A.econToPolitics} min={0} max={3} step={0.25} fmt={(v) => `×${num(v, 2)}`} set={(v) => setA({ econToPolitics: v })} disabled={!A.politics} />
            <Slider id="a-imp" label="Political market impact" value={A.politicalImpact} min={0} max={3} step={0.25} fmt={(v) => `×${num(v, 2)}`} set={(v) => setA({ politicalImpact: v })} disabled={!A.politics} />
            <Slider id="a-ins" label="Instability hazards" value={A.instability} min={0} max={5} step={0.25} fmt={(v) => `×${num(v, 2)}`} set={(v) => setA({ instability: v })} disabled={!A.politics} />
            <Toggle id="a-oilc" label="Geopolitical oil channel" hint="Unrest in producers removes supply" on={A.oilChannel} set={(v) => setA({ oilChannel: v })} disabled={!A.politics} />
            <Slider id="a-loss" label="Output lost in a producer crisis" value={A.oilLoss} min={0.05} max={0.8} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} set={(v) => setA({ oilLoss: v })} disabled={!A.politics || !A.oilChannel} />
            <Slider id="a-opi" label="Oil price per 1% of supply lost" value={A.oilPriceImpact} min={2} max={20} step={1} fmt={(v) => `+${v}%`} set={(v) => setA({ oilPriceImpact: v })} disabled={!A.politics || !A.oilChannel} />
            <h4>Simulation</h4>
            <Segmented id="a-paths" label="Paths" value={String(p.paths)} options={[['1000', '1,000'], ['2000', '2,000'], ['5000', '5,000'], ['10000', '10,000']]} set={(v) => p.onPaths(+v)} />
            <Segmented id="a-hor" label="Horizon" value={String(p.horizon)} options={[['20', '5 years'], ['40', '10 years']]} set={(v) => p.onHorizon(+v)} />
          </div>
        )}
      </section>
    </aside>
  );
}

function summary(A: Assumptions) {
  const bits = [
    A.regimes ? 'crisis regimes' : 'no regimes',
    A.fatTails ? 'fat tails' : 'normal shocks',
    A.policyRule === 'standard' ? 'standard central banks' : A.policyRule === 'hawkish' ? 'hawkish central banks' : 'central banks look through',
    A.oilSensitivity === 'imf' ? 'IMF-consistent oil sensitivity' : 'default oil sensitivity',
    A.politics ? 'politics on' : 'politics off'
  ];
  return bits.join(' · ');
}

function ShockCard({ s, labels, horizon, onChange, onRemove }: { s: Shock; labels: string[]; horizon: number; onChange: (p: Partial<Shock>) => void; onRemove: () => void }) {
  const m = SHOCKS[s.var];
  const isPath = !!s.path;
  const timed = !['swing', 'instab', 'pol_outcome'].includes(s.var);
  const val = s.var === 'G' && !isPath ? s.size : s.size;
  return (
    <div className="card shock">
      <div className="shock-head">
        <span className="shock-title">{s.label ?? m.label}</span>
        <button className="icon-btn small" aria-label={`Remove ${m.label}`} onClick={onRemove}>×</button>
      </div>
      {s.var === 'pol_outcome' ? (
        <OutcomePicker s={s} onChange={onChange} />
      ) : isPath ? (
        <>
          <PathSpark path={s.path!.map((v) => v * (s.scale ?? 1))} isG={s.var === 'G'} />
          <Slider id={`${s.id}-scale`} label="Scale" value={s.scale ?? 1} min={0} max={2} step={0.1} fmt={(v) => `×${num(v, 1)}`} set={(v) => onChange({ scale: v })} />
          <p className="shock-meta">From {QLABEL(s.start, labels)} · {s.path!.length} quarters, then free</p>
        </>
      ) : s.var === 'S' ? null : (
        <Slider id={`${s.id}-size`} label={m.unit} value={val} min={m.min} max={m.max} step={m.step}
          fmt={(v) => (s.var === 'G' ? `VIX ${v.toFixed(0)}` : s.var === 'instab' ? `×${num(v, 1)}` : s.var === 'swing' ? `${v > 0 ? '+' : ''}${num(v, 2)} σ` : `${v > 0 ? '+' : ''}${num(v, m.step < 1 ? (m.step < 0.25 ? 1 : 2) : 0)}`)}
          set={(v) => onChange({ size: v })} />
      )}
      {timed && !isPath && (
        <div className="timing">
          <label>
            <span>Starts</span>
            <select className="select small" value={s.start} onChange={(e) => onChange({ start: +e.target.value })}>
              {labels.slice(1, horizon + 1).map((l, i) => <option key={l} value={i + 1}>{l}</option>)}
            </select>
          </label>
          <label>
            <span>Lasts</span>
            <select className="select small" value={s.duration} onChange={(e) => onChange({ duration: +e.target.value })}>
              {[1, 2, 3, 4, 6, 8, 12, 16, 20, 40].map((d) => <option key={d} value={d}>{d} q</option>)}
            </select>
          </label>
          {s.var !== 'S' && (
            <label>
              <span>Fades</span>
              <select className="select small" value={s.fade} onChange={(e) => onChange({ fade: +e.target.value })}>
                {[0, 2, 4, 6, 8].map((d) => <option key={d} value={d}>{d ? `${d} q` : 'at once'}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {m.scope !== 'world' && s.var !== 'pol_outcome' && (
        <CountryChips value={s.countries} any={m.scope === 'any'} onChange={(c) => onChange({ countries: c })} />
      )}
    </div>
  );
}

function PathSpark({ path, isG }: { path: number[]; isG: boolean }) {
  const vals = isG ? path.map((g) => VIX.mean + VIX.sd * g) : path;
  const max = Math.max(...vals.map(Math.abs), 1);
  const w = 200, h = 30;
  const bw = w / vals.length;
  return (
    <div className="path-spark">
      <svg width={w} height={h} aria-hidden="true">
        {vals.map((v, i) => <rect key={i} x={i * bw + 1} y={h - (Math.abs(v) / max) * (h - 2)} width={bw - 2} height={(Math.abs(v) / max) * (h - 2)} rx={2} className="spark-bar" />)}
      </svg>
      <span className="num">{isG ? `VIX ${vals.map((v) => v.toFixed(0)).join(' · ')}` : vals.map((v) => num(v, 0)).join(' · ')}</span>
    </div>
  );
}

function OutcomePicker({ s, onChange }: { s: Shock; onChange: (p: Partial<Shock>) => void }) {
  const o = s.outcome ?? { iso: 'FRA', kind: 'camp_lost' as const };
  const labels = (POLIS.pool.countries[o.iso]?.labels as string[]) ?? [];
  const value = o.kind === 'match' ? `m:${o.match}` : o.kind;
  return (
    <div className="outcome">
      <select className="select small" value={o.iso} aria-label="Country" onChange={(e) => onChange({ outcome: { iso: e.target.value, kind: 'camp_lost' } })}>
        {POLIS8.map((c) => <option key={c} value={c}>{nameOf(c)}</option>)}
      </select>
      <select className="select small" value={value} aria-label="Outcome" onChange={(e) => {
        const v = e.target.value;
        onChange({ outcome: v.startsWith('m:') ? { iso: o.iso, kind: 'match', match: v.slice(2) } : { iso: o.iso, kind: v as 'camp_lost' | 'camp_held' } });
      }}>
        <option value="camp_lost">Incumbent camp loses power</option>
        <option value="camp_held">Incumbent camp holds on</option>
        {o.kind === 'match' && !labels.includes(o.match ?? '') && <option value={value}>Outcome contains “{o.match}”</option>}
        {labels.filter((l) => l !== 'Other').map((l) => <option key={l} value={`m:${l}`}>{l}</option>)}
      </select>
    </div>
  );
}

function CountryChips({ value, any, onChange }: { value: string[] | 'all'; any: boolean; onChange: (v: string[] | 'all') => void }) {
  const list = any ? [...new Set([...ECON, ...OIL_PRODUCERS.map(([c]) => c)])] : ECON;
  const sel = value === 'all' ? new Set(list) : new Set(value);
  const toggle = (c: string) => {
    const next = new Set(sel);
    if (next.has(c)) next.delete(c); else next.add(c);
    onChange(next.size === list.length ? 'all' : [...next]);
  };
  return (
    <div className="cchips">
      <button className={`cchip all ${value === 'all' ? 'on' : ''}`} onClick={() => onChange(value === 'all' ? [] : 'all')}>All</button>
      {list.map((c) => (
        <button key={c} className={`cchip ${sel.has(c) && value !== 'all' ? 'on' : ''}`} onClick={() => toggle(c)} title={nameOf(c)} aria-pressed={sel.has(c)}>{c}</button>
      ))}
    </div>
  );
}

export function Toggle({ id, label, hint, on, set, disabled }: { id: string; label: string; hint?: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`} htmlFor={id}>
      <span><span className="toggle-label">{label}</span>{hint && <small>{hint}</small>}</span>
      <input id={id} type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />
    </label>
  );
}

export function Slider({ id, label, value, min, max, step, fmt, set, disabled }: { id: string; label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; set: (v: number) => void; disabled?: boolean }) {
  return (
    <label className={`slider ${disabled ? 'disabled' : ''}`} htmlFor={id}>
      <span className="slider-top"><span>{label}</span><span className="num">{fmt(value)}</span></span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => set(+e.target.value)} />
    </label>
  );
}

export function Segmented({ id, label, value, options, set }: { id: string; label: string; value: string; options: [string, string][]; set: (v: string) => void }) {
  return (
    <div className="seg-wrap" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="seg-label">{label}</span>
      <div className="seg">
        {options.map(([v, l]) => <button key={v} className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => set(v)}>{l}</button>)}
      </div>
    </div>
  );
}
