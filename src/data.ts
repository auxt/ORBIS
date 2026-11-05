// Data snapshots bundled with the app (written by the Python pipeline and scripts/build-hexworld.mjs).
import tempestJson from './data/tempest_snapshot.json';
import polisJson from './data/polis_snapshot.json';
import hexJson from './data/hexworld.json';
import type { PolisSnapshot, StabilityRow, TempestSnapshot } from './engine/types';

export const TEMPEST = tempestJson as unknown as TempestSnapshot;
export const POLIS = polisJson as unknown as PolisSnapshot;
export interface HexWorld {
  W: number;
  H: number;
  R: number;
  cols: number;
  rows: number;
  isos: string[];
  hexes: [number, number, number][];
  anchor: Record<string, [number, number, number]>;
  names: Record<string, string>;
}
export const HEX = hexJson as unknown as HexWorld;

export const ECON = TEMPEST.countries; // the 17 ORBIS economies
export const ECON_IDX = new Map(ECON.map((c, k) => [c, k]));
export const STAB = new Map<string, StabilityRow>(POLIS.stability.map((r) => [r.iso3, r]));
export const POLIS8 = Object.keys(POLIS.countries);

const NAME_FIX: Record<string, string> = { USA: 'United States', GBR: 'United Kingdom', KOR: 'South Korea', TUR: 'Türkiye', RUS: 'Russia', IRN: 'Iran', SYR: 'Syria', VEN: 'Venezuela', BOL: 'Bolivia', TZA: 'Tanzania', COD: 'DR Congo', COG: 'Congo', LAO: 'Laos', VNM: 'Vietnam', PRK: 'North Korea', MDA: 'Moldova', CZE: 'Czechia', XKX: 'Kosovo', PSE: 'Palestine', TWN: 'Taiwan' };
export function nameOf(iso: string): string {
  return NAME_FIX[iso] ?? TEMPEST.names[iso] ?? STAB.get(iso)?.name ?? HEX.names[iso] ?? iso;
}

/** Brent trend level implied by the starting oil gap (Brent = trend * exp(og / 100)). */
export const BRENT_TREND = TEMPEST.meta.brent_last_quarter_avg / Math.exp((TEMPEST.x0.og as number) / 100);
export const VIX = { mean: TEMPEST.params.vix_mean as number, sd: TEMPEST.params.vix_sd as number };
export const vixOf = (G: number) => VIX.mean + VIX.sd * G;
export const brentOf = (og: number) => BRENT_TREND * Math.exp(og / 100);
