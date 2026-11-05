import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EngineWorker from './engine/worker?worker&inline';
import { ECON, POLIS, TEMPEST, nameOf } from './data';
import { Pool } from './engine/politics';
import { quarterLabels, runModel } from './engine/run';
import type { Assumptions, RunResult, RunSettings, Scenario } from './engine/types';
import { DEFAULT_ASSUMPTIONS, PRESETS, clonePreset } from './scenarios';
import type { Theme } from './ui/charts';
import { MethodView } from './ui/MethodView';
import { ScenarioPanel } from './ui/ScenarioPanel';
import { ContagionView, CountryDrawer, EconomiesView, PoliticsView, WorldView } from './ui/views';

type Tab = 'world' | 'economies' | 'politics' | 'contagion' | 'method';
const TABS: [Tab, string][] = [['world', 'World'], ['economies', 'Economies'], ['politics', 'Politics'], ['contagion', 'Contagion'], ['method', 'How it works']];
const SEED = TEMPEST.sim.seed;
const START = 'oil_scorched';

interface Saved { p: string; s: Scenario; a: Assumptions; n: number; h: number }

function readSaved(): Saved | null {
  try {
    const m = location.hash.match(/^#s=([\w-]+)/);
    if (m) {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      return JSON.parse(json);
    }
  } catch { /* ignore a malformed link */ }
  try {
    const v = localStorage.getItem('orbis:last');
    if (v) return JSON.parse(v);
  } catch { /* storage unavailable */ }
  return null;
}
const encode = (s: Saved) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function useTheme(): [Theme, 'system' | Theme, () => void] {
  const [pref, setPref] = useState<'system' | Theme>(() => {
    try { return (localStorage.getItem('orbis:theme') as 'system' | Theme) || 'system'; } catch { return 'system'; }
  });
  const [sys, setSys] = useState<Theme>(() => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setSys(mq.matches ? 'dark' : 'light');
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (pref === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = pref;
    try { localStorage.setItem('orbis:theme', pref); } catch { /* ignore */ }
  }, [pref]);
  const cycle = () => setPref((p) => (p === 'system' ? (sys === 'dark' ? 'light' : 'dark') : p === 'dark' ? 'light' : 'system'));
  return [pref === 'system' ? sys : pref, pref, cycle];
}

export function App() {
  const saved = useMemo(readSaved, []);
  const [theme, themePref, cycleTheme] = useTheme();
  const [presetId, setPresetId] = useState(saved?.p ?? START);
  const [scenario, setScenario] = useState<Scenario>(() => saved?.s ?? clonePreset(PRESETS.find((p) => p.id === START)!));
  const [assumptions, setAssumptions] = useState<Assumptions>(() => ({ ...DEFAULT_ASSUMPTIONS, ...(saved?.a ?? {}) }));
  const [paths, setPaths] = useState(saved?.n ?? 2000);
  const [horizon, setHorizon] = useState(saved?.h ?? 40);
  const [tab, setTab] = useState<Tab>('world');
  const [result, setResult] = useState<RunResult | null>(null);
  const [ranKey, setRanKey] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState('');
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  const ready = useRef(false);
  const pending = useRef<RunSettings | null>(null);

  const settings: RunSettings = useMemo(() => ({ paths, horizon, seed: SEED, assumptions, scenario, decompose: true }), [paths, horizon, assumptions, scenario]);
  const key = JSON.stringify(settings);
  const labels = useMemo(() => quarterLabels(TEMPEST.meta.start_quarter, horizon), [horizon]);

  // Fallback when workers are unavailable (a page opened from file:// cannot start an inline worker):
  // run on the main thread after the progress state has painted.
  const mainThread = useRef(false);
  const pool = useRef<Pool | null>(null);
  const runHere = useCallback((s: RunSettings) => {
    const id = ++runId.current;
    setProgress(0.02);
    setError('');
    setRanKey(JSON.stringify(s));
    setTimeout(() => {
      if (id !== runId.current) return;
      try {
        pool.current ??= new Pool(POLIS, TEMPEST.countries);
        setResult(runModel(TEMPEST, POLIS, pool.current, s));
      } catch (e) { setError(String((e as Error)?.message ?? e)); }
      setProgress(null);
    }, 60);
  }, []);

  const start = useCallback((s: RunSettings) => {
    if (mainThread.current) { runHere(s); return; }
    if (!worker.current || !ready.current) { pending.current = s; return; }
    const id = ++runId.current;
    setProgress(0);
    setError('');
    worker.current.postMessage({ type: 'run', id, settings: s });
    setRanKey(JSON.stringify(s));
  }, [runHere]);

  useEffect(() => {
    const fallback = () => {
      if (mainThread.current || ready.current) return;
      mainThread.current = true;
      worker.current?.terminate();
      worker.current = null;
      runHere(pending.current ?? settings);
      pending.current = null;
    };
    let w: Worker;
    try { w = new EngineWorker(); } catch { fallback(); return; }
    worker.current = w;
    w.onerror = () => fallback();
    const timer = setTimeout(fallback, 4000);
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'ready') {
        clearTimeout(timer);
        ready.current = true;
        if (pending.current) { const s = pending.current; pending.current = null; start(s); }
      } else if (m.id !== runId.current) return;
      else if (m.type === 'progress') setProgress(m.t / m.H);
      else if (m.type === 'result') { setResult(m.res); setProgress(null); }
      else if (m.type === 'error') { setError(m.error); setProgress(null); }
    };
    w.postMessage({ type: 'init', tempest: TEMPEST, polis: POLIS });
    start(settings);
    return () => { clearTimeout(timer); w.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem('orbis:last', JSON.stringify({ p: presetId, s: scenario, a: assumptions, n: paths, h: horizon })); } catch { /* ignore */ }
  }, [presetId, scenario, assumptions, paths, horizon]);

  const choosePreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const sc = clonePreset(p);
    setPresetId(id);
    setScenario(sc);
    start({ ...settings, scenario: sc });
  };
  const editScenario = (s: Scenario) => { setScenario({ ...s, name: 'Custom scenario' }); setPresetId('custom'); };
  const running = progress !== null;
  const stale = !!result && key !== ranKey && !running;

  const share = async () => {
    const url = `${location.origin}${location.pathname}#s=${encode({ p: presetId, s: scenario, a: assumptions, n: paths, h: horizon })}`;
    try { await navigator.clipboard.writeText(url); setShareMsg('Link copied'); } catch { setShareMsg('Copy failed'); }
    setTimeout(() => setShareMsg(''), 2000);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scenName = presetId === 'custom' ? 'Custom scenario' : PRESETS.find((p) => p.id === presetId)?.name ?? scenario.name;
  const view = result && (
    tab === 'world' ? <WorldView r={result} theme={theme} onCountry={setSelected} selected={selected} /> :
    tab === 'economies' ? <EconomiesView r={result} theme={theme} onCountry={setSelected} selected={selected} /> :
    tab === 'politics' ? <PoliticsView r={result} theme={theme} onCountry={setSelected} selected={selected} /> :
    tab === 'contagion' ? <ContagionView r={result} theme={theme} onCountry={setSelected} selected={selected} /> : null
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true"><HexLogo /></span>
          <span className="brand-name">ORBIS</span>
          <span className="brand-sub">World scenario lab · TEMPEST × POLIS</span>
        </div>
        <div className="top-actions">
          <span className="vintage" title="Data vintage of the starting state">Data {TEMPEST.meta.exported.slice(0, 10)} · {ECON.length} economies · {POLIS.stability.length} countries</span>
          <button className="btn ghost" onClick={share}>{shareMsg || 'Copy link'}</button>
          <button className="icon-btn" onClick={cycleTheme} aria-label={`Theme: ${themePref}. Change theme`} title={`Theme: ${themePref}`}><ThemeIcon mode={themePref} /></button>
        </div>
      </header>

      <div className="layout">
        <div className={`rail-wrap ${railOpen ? 'open' : ''}`}>
          <button className="rail-toggle" onClick={() => setRailOpen((v) => !v)} aria-expanded={railOpen}>
            <span><span className="eyebrow">Scenario</span> {scenName}</span><span className="caret">{railOpen ? '−' : '+'}</span>
          </button>
          <ScenarioPanel presetId={presetId} scenario={scenario} assumptions={assumptions} labels={labels} paths={paths} horizon={horizon}
            onPreset={choosePreset} onScenario={editScenario} onAssumptions={setAssumptions} onPaths={setPaths} onHorizon={setHorizon} />
          <div className="run-bar">
            <button className="btn primary run" onClick={() => start(settings)} disabled={running}>
              {running ? `Simulating… ${Math.round(100 * (progress ?? 0))}%` : 'Run scenario'}
            </button>
            <span className="run-meta">{paths.toLocaleString('en-GB')} paths · {horizon / 4} years{result ? ` · last run ${result.seconds.toFixed(1)} s` : ''}</span>
            {running && <span className="progress" style={{ ['--p' as string]: `${100 * (progress ?? 0)}%` }} />}
          </div>
        </div>

        <main className="main">
          <div className="main-head">
            <div>
              <h1>{scenName}</h1>
              <p className="lede">{presetId === 'custom' ? `${scenario.shocks.length} shock${scenario.shocks.length === 1 ? '' : 's'} against the baseline.` : PRESETS.find((p) => p.id === presetId)?.description}</p>
            </div>
            {stale && <button className="stale" onClick={() => start(settings)}>Settings changed · <b>Run to update</b></button>}
          </div>
          <nav className="tabs" aria-label="Views">
            {TABS.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id} onClick={() => setTab(id)}>{l}</button>)}
          </nav>
          {error && <div className="error"><b>The simulation stopped.</b> {error.split('\n')[0]}</div>}
          {tab === 'method' ? <MethodView /> : result ? <div className={running ? 'dim-while-running' : ''}>{view}</div> : <Loading p={progress ?? 0} paths={paths} />}
        </main>
      </div>

      {selected && result && (ECON.includes(selected) || POLIS.stability.some((s) => s.iso3 === selected)) && (
        <>
          <div className="scrim" onClick={() => setSelected(null)} />
          <CountryDrawer iso={selected} r={result} onClose={() => setSelected(null)} key={selected} />
        </>
      )}
      <footer className="foot">
        Research prototype: model outputs under stated assumptions, not forecasts or advice. <a href="https://github.com/auxt/TEMPEST" target="_blank" rel="noreferrer">TEMPEST</a> · <a href="https://github.com/auxt/POLIS" target="_blank" rel="noreferrer">POLIS</a> · {nameOf('SVK')} added as a 17th economy.
      </footer>
    </div>
  );
}

function Loading({ p, paths }: { p: number; paths: number }) {
  return (
    <div className="loading">
      <HexLogo spin />
      <p>Simulating {paths.toLocaleString('en-GB')} worlds: baseline, scenario, and scenario without political feedback…</p>
      <span className="progress static" style={{ ['--p' as string]: `${100 * p}%` }} />
    </div>
  );
}

function HexLogo({ spin }: { spin?: boolean }) {
  // the app icon: seven hexes, one per role (baseline, scenarios, politics, crisis)
  const r = 5, dx = (r * Math.sqrt(3)) / 2;
  const hex = (cx: number, cy: number) => `M${cx},${cy - r}l${dx},${r / 2}v${r}l${-dx},${r / 2}l${-dx},${-r / 2}v${-r}z`;
  const s = 2 * dx + 0.9, v = 1.5 * r + 0.8;
  const cells: [number, number, string][] = [[0, 0, 'a'], [-s, 0, 'b'], [s, 0, 'w'], [-s / 2, -v, 'e'], [s / 2, -v, 'b'], [-s / 2, v, 'a'], [s / 2, v, 'c']];
  return (
    <svg viewBox="-16 -14 32 28" width={spin ? 60 : 28} height={spin ? 52 : 24} className={spin ? 'logo-spin' : ''} aria-hidden="true">
      {cells.map(([x, y, k], i) => <path key={i} d={hex(x, y)} className={`lg lg-${k}`} />)}
    </svg>
  );
}

function ThemeIcon({ mode }: { mode: 'system' | Theme }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="theme-icon">
      <circle cx="8" cy="8" r="6" className="ti-ring" />
      {mode === 'system' && <path d="M8 2a6 6 0 0 1 0 12z" className="ti-fill" />}
      {mode === 'dark' && <path d="M10.5 3.2a5 5 0 1 0 2.3 6.9A4.2 4.2 0 0 1 10.5 3.2z" className="ti-fill" />}
      {mode === 'light' && <circle cx="8" cy="8" r="2.6" className="ti-fill" />}
    </svg>
  );
}
