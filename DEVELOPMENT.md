# ORBIS: developer notes

## Data flow

```
TEMPEST (Python) ──► pipeline/export_tempest.py ──► src/data/tempest_snapshot.json ─┐
POLIS (Python)   ──► pipeline/export_polis.py   ──► src/data/polis_snapshot.json   ─┼─► Web Worker: src/engine/run.ts ──► views
Natural Earth    ──► scripts/build-hexworld.mjs ──► src/data/hexworld.json         ─┘
```

The browser never fetches anything: snapshots are bundled into the single-file build.

## Common changes

**Add a scenario preset.** Add an entry to `PRESETS` in `src/scenarios.ts`. A shock is
`{ var, countries, start, size, duration, fade }`, or an explicit `path` from `start`.

**Add a shock type.**
1. Add the variable to `ShockVar` in `src/engine/types.ts` and to `SHOCKS` in `src/scenarios.ts`.
2. Route it in `runModel` (`src/engine/run.ts`). Variables TEMPEST overrides after a block go in `NATIVE`. Deviation targets go in `devVars`, plus an add term in the matching block of `src/engine/tempest.ts`.

**Add an economy.**
1. Add it to `pipeline/orbis_overlay.yaml`: `countries`, `groups`, any union, a systemic weight, and placeholders in `country_params`. Add an ISO2 code if TEMPEST's adapters lack one.
2. Re-run `pipeline/export_tempest.py`, then `pipeline/export_polis.py` (its vulnerability table follows the snapshot).
3. If POLIS has no state vector for it, the economy gets Layer 1 acute-instability shocks automatically. Add its market flags to `EXTRA_MACRO` in `export_polis.py`.

**Change a TEMPEST equation.** Change it in TEMPEST first (Python is the reference). Mirror it in `src/engine/tempest.ts`, re-export the reference (`export_tempest.py` writes `reference/tempest_reference.json`), and run `npm run parity`.

**Change the coupling.** Edit `src/engine/politics.ts`:
- Coefficients are in `L4`.
- Placeholders are `ECON_SCALE` and `L4.FISCAL_PB`.
- Each country's selection quarter comes from `select_quarter` in `export_polis.py`.

Keep *How it works* (`src/ui/MethodView.tsx`) in step.

## Engine notes

- Arrays are flat `Float64Array`s, M paths × N economies (index `p * N + k`); global variables are length M.
- States A, B, C advance in lockstep and share shocks, starting noise, parameter draws and political uniforms. Separate RNG streams keep politics from perturbing the economic shocks.
- Student-t shocks come from a precomputed 2^20-entry table per degrees of freedom: one 32-bit step per draw.
- Quantiles use a histogram pass plus an exact in-bin sort (O(n)), for every variable, economy and quarter.
- About 7 s for 2,000 paths × 3 states × 40 quarters on one cloud core. Next step: shard paths across workers.

## Checks before a release

```bash
npm run build            # type-check and single-file build
npm run parity           # 10,000 paths, all checks within tolerance
npm run site             # docs/ for GitHub Pages
```
