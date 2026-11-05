// The world as small hexes (EarthSim style). One SVG path per country, so recolouring is cheap.
// Zoom: region chips, +/- buttons, trackpad pinch (ctrl + wheel) and drag to pan.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HEX, nameOf } from '../data';

type VB = [number, number, number, number];
const FULL: VB = [0, 0, HEX.W, HEX.H];

const REGIONS: Record<string, string[]> = {
  World: [],
  Europe: ['PRT', 'IRL', 'NOR', 'FIN', 'GRC', 'CYP', 'ESP', 'UKR'],
  'Middle East': ['EGY', 'TUR', 'IRN', 'SAU', 'YEM', 'OMN', 'IRQ', 'LBY'],
  Asia: ['IND', 'JPN', 'IDN', 'CHN', 'KOR', 'PHL', 'PAK', 'MNG'],
  Americas: ['USA', 'CAN', 'MEX', 'BRA', 'ARG', 'CHL', 'COL'],
  Africa: ['MAR', 'ZAF', 'NGA', 'ETH', 'SEN', 'SOM', 'MDG', 'EGY']
};

function regionBox(name: string): VB {
  const list = REGIONS[name];
  if (!list?.length) return FULL;
  const pts = list.map((c) => HEX.anchor[c]).filter(Boolean);
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  const m = 28;
  x0 -= m; x1 += m; y0 -= m; y1 += m;
  const ar = HEX.W / HEX.H;
  let w = x1 - x0, h = y1 - y0;
  if (w / h < ar) { const nw = h * ar; x0 -= (nw - w) / 2; w = nw; } else { const nh = w / ar; y0 -= (nh - h) / 2; h = nh; }
  return [x0, y0, w, h];
}

const hw = Math.sqrt(3) * HEX.R, vh = 1.5 * HEX.R;
function hexPath(cx: number, cy: number, r: number) {
  const dx = (r * Math.sqrt(3)) / 2;
  return `M${cx.toFixed(2)},${(cy - r).toFixed(2)}l${dx.toFixed(2)},${(r / 2).toFixed(2)}v${r.toFixed(2)}l${(-dx).toFixed(2)},${(r / 2).toFixed(2)}l${(-dx).toFixed(2)},${(-r / 2).toFixed(2)}v${(-r).toFixed(2)}z`;
}
const COUNTRY_PATHS: Record<string, string> = (() => {
  const out: Record<string, string[]> = {};
  for (const [c, r, i] of HEX.hexes) {
    const iso = HEX.isos[i];
    (out[iso] ??= []).push(hexPath((c + 0.5 * (r & 1)) * hw, r * vh, HEX.R * 0.9));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('')]));
})();

interface Props {
  color: (iso: string) => string | null; // null = not covered by the metric
  neutral: string;
  tooltip: (iso: string) => ReactNode;
  onSelect?: (iso: string) => void;
  selected?: string | null;
  labels?: string[];
  legend?: ReactNode;
  overlay?: ReactNode;
}

export function HexMap({ color, neutral, tooltip, onSelect, selected, labels = [], legend, overlay }: Props) {
  const [vb, setVb] = useState<VB>(FULL);
  const [region, setRegion] = useState('World');
  const [hover, setHover] = useState<{ iso: string; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const anim = useRef<number>(0);
  const drag = useRef<{ x: number; y: number; vb: VB; moved: boolean } | null>(null);

  const animateTo = (target: VB) => {
    cancelAnimationFrame(anim.current);
    const start = performance.now(), from = vb;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tick = (now: number) => {
      const f = reduce ? 1 : Math.min(1, (now - start) / 380);
      const e = 1 - Math.pow(1 - f, 3);
      setVb(from.map((v, i) => v + (target[i] - v) * e) as VB);
      if (f < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  };
  const zoomBy = (k: number, cx?: number, cy?: number) => {
    const [x, y, w, h] = vb;
    const nw = Math.min(HEX.W, Math.max(HEX.W / 8, w * k)), nh = (nw * HEX.H) / HEX.W;
    const px = cx ?? x + w / 2, py = cy ?? y + h / 2;
    const fx = (px - x) / w, fy = (py - y) / h;
    return clamp([px - fx * nw, py - fy * nh, nw, nh]);
  };
  const clamp = ([x, y, w, h]: VB): VB => [Math.max(-w * 0.2, Math.min(HEX.W - w * 0.8, x)), Math.max(-h * 0.2, Math.min(HEX.H - h * 0.8, y)), w, h];
  const toUser = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    return [vb[0] + ((clientX - r.left) / r.width) * vb[2], vb[1] + ((clientY - r.top) / r.height) * vb[3]];
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scrolling scrolls the page; pinch / ctrl+wheel zooms
      e.preventDefault();
      const [ux, uy] = toUser(e.clientX, e.clientY);
      setVb(zoomBy(Math.exp(e.deltaY * 0.01), ux, uy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const paths = useMemo(() => Object.entries(COUNTRY_PATHS), []);
  const zoomed = vb[2] < HEX.W * 0.7;
  const scale = HEX.W / vb[2];

  return (
    <div className="hexmap" ref={wrap}>
      <div className="map-tools">
        <div className="chips" role="group" aria-label="Map region">
          {Object.keys(REGIONS).map((r) => (
            <button key={r} className={`chip ${region === r ? 'on' : ''}`} onClick={() => { setRegion(r); animateTo(regionBox(r)); }}>{r}</button>
          ))}
        </div>
        <div className="zoom-btns">
          <button className="icon-btn" aria-label="Zoom in" onClick={() => animateTo(zoomBy(0.7))}>+</button>
          <button className="icon-btn" aria-label="Zoom out" onClick={() => animateTo(zoomBy(1 / 0.7))}>−</button>
        </div>
      </div>
      <svg ref={svg} viewBox={vb.join(' ')} className="hexmap-svg" role="img" aria-label="World map of countries as hexes"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d && (e.buttons & 1)) {
            const r = svg.current!.getBoundingClientRect();
            const dx = ((e.clientX - d.x) / r.width) * d.vb[2], dy = ((e.clientY - d.y) / r.height) * d.vb[3];
            if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
            if (d.moved) setVb(clamp([d.vb[0] - dx, d.vb[1] - dy, d.vb[2], d.vb[3]]));
          }
        }}
        onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}>
        <defs>
          <pattern id="sea" width={hw} height={2 * vh} patternUnits="userSpaceOnUse">
            <path d={hexPath(0, 0, HEX.R * 0.9) + hexPath(hw, 0, HEX.R * 0.9) + hexPath(hw / 2, vh, HEX.R * 0.9) + hexPath(0, 2 * vh, HEX.R * 0.9) + hexPath(hw, 2 * vh, HEX.R * 0.9)} className="sea-hex" />
          </pattern>
        </defs>
        <rect x={-HEX.W} y={-HEX.H} width={HEX.W * 3} height={HEX.H * 3} fill="url(#sea)" />
        {paths.map(([iso, d]) => (
          <path key={iso} d={d} style={{ fill: color(iso) ?? neutral }} className="country"
            onPointerEnter={(e) => setHover({ iso, x: e.clientX, y: e.clientY })}
            onPointerMove={(e) => setHover({ iso, x: e.clientX, y: e.clientY })}
            onPointerLeave={() => setHover((h) => (h?.iso === iso ? null : h))}
            onClick={() => { if (!drag.current?.moved) onSelect?.(iso); }} />
        ))}
        {selected && COUNTRY_PATHS[selected] && <path d={COUNTRY_PATHS[selected]} className="country-selected" style={{ strokeWidth: 1.6 / scale }} />}
        {hover && COUNTRY_PATHS[hover.iso] && <path d={COUNTRY_PATHS[hover.iso]} className="country-hover" style={{ strokeWidth: 1.2 / scale }} />}
        {labels.map((iso) => {
          const a = HEX.anchor[iso];
          if (!a || (!zoomed && a[2] < 14)) return null;
          return <text key={iso} x={a[0]} y={a[1] + 3 / scale} className="map-label" style={{ fontSize: 9 / Math.sqrt(scale), strokeWidth: 2.4 / Math.sqrt(scale) }} textAnchor="middle">{iso}</text>;
        })}
      </svg>
      {hover && wrap.current && (() => {
        const r = wrap.current.getBoundingClientRect();
        const x = hover.x - r.left, y = hover.y - r.top;
        return (
          <div className="tip map-tip" style={{ left: Math.min(x + 14, r.width - 230), top: Math.max(4, y - 10) }}>
            <b>{nameOf(hover.iso)}</b>
            {tooltip(hover.iso)}
          </div>
        );
      })()}
      {legend && <div className="map-legend">{legend}</div>}
      {overlay}
    </div>
  );
}
