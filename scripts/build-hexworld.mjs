// Builds src/data/hexworld.json: the world as a field of small hexes (EarthSim style).
// Each hex centre is projected back to longitude/latitude (Equal Earth) and given the country that
// contains it. Small states that no hex centre hits get the nearest free hex, so every country POLIS
// scores is clickable. Run once (npm run hexworld); the output is committed.
//
// Geometry: Natural Earth via world-atlas (public domain). Country codes: ISO 3166-1.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoEqualEarth, geoContains, geoBounds, geoCentroid, geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';

const root = new URL('..', import.meta.url);
const at = (p) => new URL(p, root).pathname;
const topo = JSON.parse(readFileSync(at('node_modules/world-atlas/countries-50m.json'), 'utf8'));
const polis = JSON.parse(readFileSync(at('src/data/polis_snapshot.json'), 'utf8'));
const tempest = JSON.parse(readFileSync(at('src/data/tempest_snapshot.json'), 'utf8'));

const BY_NAME = { Kosovo: 'XKX', 'N. Cyprus': 'CYP', Somaliland: 'SOM', 'Siachen Glacier': 'IND', 'Indian Ocean Ter.': null, 'Ashmore and Cartier Is.': null };
const feats = feature(topo, topo.objects.countries).features
  .map((f) => {
    const name = f.properties.name;
    let iso = f.id ? countries.numericToAlpha3(String(f.id).padStart(3, '0')) : undefined;
    if (name in BY_NAME) iso = BY_NAME[name] ?? undefined;
    return { f, iso, name, bounds: geoBounds(f) };
  })
  .filter((d) => d.iso && d.iso !== 'ATA');

const W = 1000, H = 470;
const proj = geoEqualEarth().rotate([-10, 0]).fitExtent([[0, 0], [W, H]], { type: 'FeatureCollection', features: feats.map((d) => d.f) });

const R = 3.3; // hex radius in projected px (pointy-top)
const hw = Math.sqrt(3) * R, vh = 1.5 * R;
const cols = Math.ceil(W / hw) + 1, rows = Math.ceil(H / vh) + 1;
const center = (c, r) => [(c + 0.5 * (r & 1)) * hw, r * vh];

const inBox = (b, [lon, lat]) => {
  const [[x0, y0], [x1, y1]] = b;
  if (lat < y0 - 0.01 || lat > y1 + 0.01) return false;
  return x0 <= x1 ? lon >= x0 - 0.01 && lon <= x1 + 0.01 : lon >= x0 - 0.01 || lon <= x1 + 0.01; // antimeridian
};

const grid = new Map(); // "c,r" -> iso
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) {
    const ll = proj.invert(center(c, r));
    if (!ll || !isFinite(ll[0])) continue;
    // check that the inversion round-trips (outside the projection's outline it does not)
    const back = proj(ll);
    if (!back || Math.hypot(back[0] - center(c, r)[0], back[1] - center(c, r)[1]) > 0.5) continue;
    const hit = feats.find((d) => inBox(d.bounds, ll) && geoContains(d.f, ll));
    if (hit) grid.set(`${c},${r}`, hit.iso);
  }

// make sure every scored or modelled country has at least one hex
const want = new Set([...polis.stability.map((s) => s.iso3), ...tempest.countries]);
const have = new Set(grid.values());
const nearestFree = (x, y) => {
  let best = null, bd = Infinity;
  const r0 = Math.round(y / vh);
  for (let r = r0 - 3; r <= r0 + 3; r++)
    for (let c = Math.floor(x / hw) - 3; c <= Math.floor(x / hw) + 3; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const [cx, cy] = center(c, r);
      const d = Math.hypot(cx - x, cy - y) + (grid.has(`${c},${r}`) ? 1e6 : 0);
      if (d < bd) { bd = d; best = `${c},${r}`; }
    }
  return best;
};
const missing = [];
for (const iso of want) {
  if (have.has(iso)) continue;
  const parts = feats.filter((d) => d.iso === iso);
  if (!parts.length) { missing.push(iso); continue; }
  const big = parts.sort((a, b) => geoArea(b.f) - geoArea(a.f))[0];
  const p = proj(geoCentroid(big.f));
  const key = p && nearestFree(p[0], p[1]);
  if (key) grid.set(key, iso);
  else missing.push(iso);
}

const isos = [...new Set(grid.values())].sort();
const hexes = [...grid.entries()].map(([k, iso]) => { const [c, r] = k.split(',').map(Number); return [c, r, isos.indexOf(iso)]; });
// label anchor: hex nearest the mean of each country's hexes
const anchor = {};
for (const iso of isos) {
  const hs = hexes.filter((h) => isos[h[2]] === iso).map((h) => center(h[0], h[1]));
  const mx = hs.reduce((a, b) => a + b[0], 0) / hs.length, my = hs.reduce((a, b) => a + b[1], 0) / hs.length;
  const best = hs.reduce((a, b) => (Math.hypot(b[0] - mx, b[1] - my) < Math.hypot(a[0] - mx, a[1] - my) ? b : a));
  anchor[iso] = [+best[0].toFixed(1), +best[1].toFixed(1), hs.length];
}
const names = {};
for (const iso of isos) names[iso] = countries.getName(iso, 'en', { select: 'alias' }) ?? countries.getName(iso, 'en') ?? (iso === 'XKX' ? 'Kosovo' : iso);
writeFileSync(at('src/data/hexworld.json'), JSON.stringify({ W, H, R: +R.toFixed(3), cols, rows, isos, hexes, anchor, names }));
console.log(`${hexes.length} hexes, ${isos.length} countries; no geometry for: ${missing.join(', ') || 'none'}`);
