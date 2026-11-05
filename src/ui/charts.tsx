// Hand-built SVG charts: fan charts (Bank of England style bands), heatmap, dumbbells, colour scales.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { num } from '../format';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(200, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    setW(Math.max(200, Math.floor(ref.current.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
  const raw = (hi - lo) / Math.max(1, n - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((m) => m * mag);
  let i = steps.findIndex((s) => s >= raw);
  if (i < 0) i = steps.length - 1;
  const make = (step: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  };
  let out = make(steps[i]);
  while (out.length < 3 && i > 0) out = make(steps[--i]); // always at least three labelled lines
  return out;
}

export interface FanSeries {
  name: string;
  color: string; // CSS colour or var()
  get: (t: number, j: number) => number; // j = quantile index 0..4 (5, 16, 50, 84, 95)
  bands?: boolean;
}

interface FanProps {
  labels: string[];
  series: FanSeries[];
  title: string;
  unit?: string;
  height?: number;
  fmt?: (v: number) => string;
  zero?: boolean;
  marker?: number;
  from?: number;
  note?: ReactNode;
  legend?: boolean;
}

export function FanChart({ labels, series, title, unit, height = 190, fmt = (v) => num(v, 1), zero = true, marker, from = 0, note, legend = true }: FanProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = labels.length - 1;
  const pad = { l: 40, r: 12, t: 8, b: 22 };
  const w = width, h = height;
  const ts = useMemo(() => Array.from({ length: H - from + 1 }, (_, i) => i + from), [H, from]);
  const [lo, hi] = useMemo(() => {
    let a = Infinity, b = -Infinity;
    for (const s of series)
      for (const t of ts) {
        const j0 = s.bands === false ? 2 : 0, j1 = s.bands === false ? 2 : 4;
        for (let j = j0; j <= j1; j++) {
          const v = s.get(t, j);
          if (Number.isFinite(v)) { a = Math.min(a, v); b = Math.max(b, v); }
        }
      }
    if (zero) { a = Math.min(a, 0); b = Math.max(b, 0); }
    const span = b - a || 1;
    return [a - 0.04 * span, b + 0.04 * span];
  }, [series, ts, zero]);
  const ticks = niceTicks(lo, hi, h > 150 ? 5 : 4);
  const y0 = Math.min(lo, ticks[0]), y1 = Math.max(hi, ticks[ticks.length - 1]);
  const X = (t: number) => pad.l + ((t - from) / Math.max(1, H - from)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  const years = ts.filter((t) => labels[t].endsWith('Q1'));
  const every = w < 360 ? 3 : w < 560 ? 2 : 1;
  const area = (s: FanSeries, a: number, b: number) =>
    ts.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(s.get(t, a)).toFixed(1)}`).join('') +
    ts.slice().reverse().map((t) => `L${X(t).toFixed(1)},${Y(s.get(t, b)).toFixed(1)}`).join('') + 'Z';
  const line = (s: FanSeries) => ts.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(s.get(t, 2)).toFixed(1)}`).join('');
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const x = e.clientX - r.left + pad.l;
    const t = Math.round(from + ((x - pad.l) / (w - pad.l - pad.r)) * (H - from));
    setHover(Math.max(from, Math.min(H, t)));
  };
  return (
    <figure className="chart" ref={ref}>
      <figcaption>
        <span className="chart-title">{title}</span>
        {unit && <span className="chart-unit">{unit}</span>}
        {legend && series.length > 1 && (
          <span className="legend">
            {series.map((s) => (
              <span key={s.name} className="legend-item"><i style={{ background: s.color }} />{s.name}</span>
            ))}
          </span>
        )}
      </figcaption>
      <div className="chart-body">
        <svg width={w} height={h} role="img" aria-label={title}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'axis-zero' : 'grid'} />
              <text x={pad.l - 6} y={Y(v) + 3.5} className="tick" textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          {years.filter((_, i) => i % every === 0).map((t) => (
            <text key={t} x={X(t)} y={h - 6} className="tick" textAnchor="middle">{labels[t].slice(0, 4)}</text>
          ))}
          {marker !== undefined && marker >= from && <line x1={X(marker)} x2={X(marker)} y1={pad.t} y2={h - pad.b} className="marker" />}
          {series.map((s) => s.bands !== false && (
            <g key={s.name}>
              <path d={area(s, 0, 4)} style={{ fill: s.color, opacity: 0.12 }} />
              <path d={area(s, 1, 3)} style={{ fill: s.color, opacity: 0.18 }} />
            </g>
          ))}
          {series.map((s) => <path key={s.name} d={line(s)} style={{ stroke: s.color }} className="median" />)}
          {hover !== null && (
            <g>
              <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={h - pad.b} className="crosshair" />
              {series.map((s) => <circle key={s.name} cx={X(hover)} cy={Y(s.get(hover, 2))} r={4} style={{ fill: s.color }} className="dot" />)}
            </g>
          )}
          <rect x={pad.l} y={pad.t} width={Math.max(0, w - pad.l - pad.r)} height={h - pad.t - pad.b} fill="transparent"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove} />
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: Math.min(Math.max(X(hover) + 10, 0), w - 190), top: 6 }}>
            <b>{labels[hover]}</b>
            {series.map((s) => (
              <div key={s.name} className="tip-row">
                <i style={{ background: s.color }} />
                <span>{s.name}</span>
                <span className="num">{fmt(s.get(hover, 2))}</span>
                {s.bands !== false && <span className="num dim">{fmt(s.get(hover, 0))} to {fmt(s.get(hover, 4))}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {note && <div className="chart-note">{note}</div>}
    </figure>
  );
}

// ---------------------------------------------------------------- colour scales

type RGB = [number, number, number];
const hex2rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb2hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function interp(stops: string[], x: number): string {
  const v = Math.max(0, Math.min(1, x)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(v));
  const a = hex2rgb(stops[i]), b = hex2rgb(stops[i + 1]);
  const f = v - i;
  return rgb2hex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

export const RAMPS = {
  light: {
    seq: ['#eef3fb', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    neg: ['#f0efec', '#f6c9c4', '#ef8f86', '#e34948', '#b52e2e', '#7e1c1c'],
    pos: ['#f0efec', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
    land: '#d9dedc',
    none: '#eceeed'
  },
  dark: {
    seq: ['#202a33', '#1f3a5c', '#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb'],
    neg: ['#323c3f', '#5c2b29', '#8f3533', '#c94342', '#e66767', '#f4a7a3'],
    pos: ['#323c3f', '#1f3a5c', '#1c5cab', '#3987e5', '#6da7ec', '#b7d3f6'],
    land: '#2e3537',
    none: '#252b2d'
  }
};
export const STATUS = { Stable: '#0ca30c', Watch: '#fab219', Fragile: '#ec835a', Unstable: '#d03b3b' } as const;

export type Theme = 'light' | 'dark';
export const seqColor = (theme: Theme, x: number) => interp(RAMPS[theme].seq, x);
/** Diverging: negative values red, positive blue, gray at zero. `bad` flips the poles. */
export const divColor = (theme: Theme, v: number, max: number, badHigh = false) => {
  const x = Math.max(-1, Math.min(1, v / (max || 1)));
  const neg = badHigh ? RAMPS[theme].pos : RAMPS[theme].neg;
  const pos = badHigh ? RAMPS[theme].neg : RAMPS[theme].pos;
  return x < 0 ? interp(neg, -x) : interp(pos, x);
};

export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= v) ?? 10 * mag);
}

export function GradientLegend({ theme, kind, max, fmt, lowLabel, highLabel }: { theme: Theme; kind: 'seq' | 'div' | 'divHigh'; max: number; fmt: (v: number) => string; lowLabel?: string; highLabel?: string }) {
  const stops = Array.from({ length: 11 }, (_, i) => i / 10);
  const bg = kind === 'seq'
    ? `linear-gradient(90deg, ${stops.map((s) => seqColor(theme, s)).join(',')})`
    : `linear-gradient(90deg, ${stops.map((s) => divColor(theme, (s * 2 - 1) * max, max, kind === 'divHigh')).join(',')})`;
  return (
    <div className="glegend">
      <div className="glegend-bar" style={{ background: bg }} />
      <div className="glegend-ticks">
        <span>{lowLabel ?? (kind === 'seq' ? fmt(0) : fmt(-max))}</span>
        {kind !== 'seq' && <span>{fmt(0)}</span>}
        <span>{highLabel ?? fmt(max)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- heatmap

interface HeatProps {
  rows: { key: string; label: string }[];
  cols: string[];
  value: (r: number, c: number) => number;
  color: (v: number) => string;
  fmt: (v: number) => string;
  onRow?: (key: string) => void;
  colFrom?: number;
}
export function Heatmap({ rows, cols, value, color, fmt, onRow, colFrom = 1 }: HeatProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const lw = 112, top = 18;
  const nc = cols.length - colFrom;
  const cw = Math.max(4, (width - lw - 4) / nc);
  const ch = 18;
  const h = top + rows.length * ch + 4;
  return (
    <div className="heat" ref={ref}>
      <svg width={width} height={h} role="img" aria-label="Probability of being in the stress regime, by economy and quarter">
        {cols.map((c, j) => j >= colFrom && c.endsWith('Q1') && (
          <text key={c} x={lw + (j - colFrom) * cw} y={12} className="tick">{c.slice(0, 4)}</text>
        ))}
        {rows.map((r, i) => (
          <g key={r.key} onClick={() => onRow?.(r.key)} className={onRow ? 'clickable' : ''}>
            <text x={lw - 8} y={top + i * ch + 13} className="row-label" textAnchor="end">{r.label}</text>
            {cols.map((_, j) => j >= colFrom && (
              <rect key={j} x={lw + (j - colFrom) * cw} y={top + i * ch} width={Math.max(1, cw - 1)} height={ch - 2} rx={1.5}
                style={{ fill: color(value(i, j)) }}
                onPointerEnter={(e) => setTip({ r: i, c: j, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                onPointerLeave={() => setTip(null)} />
            ))}
          </g>
        ))}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 12, width - 180), top: tip.y + 10 }}>
          <b>{rows[tip.r].label}</b>
          <div className="tip-row"><span>{cols[tip.c]}</span><span className="num">{fmt(value(tip.r, tip.c))}</span></div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- small pieces

/** Baseline -> scenario probability as a dumbbell on a 0-100% track. */
export function Dumbbell({ a, b, max = 1 }: { a: number; b: number; max?: number }) {
  const W = 90;
  const x = (v: number) => 4 + (Math.min(v, max) / max) * (W - 8);
  return (
    <svg width={W} height={14} className="dumbbell" aria-hidden="true">
      <line x1={4} x2={W - 4} y1={7} y2={7} className="track" />
      <line x1={x(a)} x2={x(b)} y1={7} y2={7} className={b >= a ? 'up' : 'down'} />
      <circle cx={x(a)} cy={7} r={4} className="base-dot" />
      <circle cx={x(b)} cy={7} r={4} className="scen-dot" />
    </svg>
  );
}

export function Bars({ items, fmt }: { items: { label: string; a: number; b: number }[]; fmt: (v: number) => string }) {
  const max = Math.max(0.0001, ...items.flatMap((i) => [i.a, i.b]));
  return (
    <div className="bars">
      {items.map((it) => (
        <div key={it.label} className="bars-row">
          <span className="bars-label">{it.label}</span>
          <span className="bars-pair">
            <span className="bar base" style={{ width: `${(100 * it.a) / max}%` }} />
            <span className="bar scen" style={{ width: `${(100 * it.b) / max}%` }} />
          </span>
          <span className="num">{fmt(it.a)} → {fmt(it.b)}</span>
        </div>
      ))}
    </div>
  );
}

export function useInterval(cb: () => void, ms: number | null) {
  const saved = useRef(cb);
  saved.current = cb;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
