# ORBIS: design and execution plan

ORBIS joins two models into one world:

- **TEMPEST**: 17 linked economies (16 + Slovakia), quarterly, crisis regimes, contagion, banks, sovereigns.
- **POLIS**: political instability for 179 countries, government turnover for 8, and what turnover does to markets.

It runs as a static web app from GitHub Pages, offline-capable, in the same way as Bedrock Math.

## 1. Architecture: Python is the lab, the browser is the instrument

| Layer | Where | What it does |
| --- | --- | --- |
| Reference models | `auxt/TEMPEST`, `auxt/POLIS` (Python, unchanged) | Estimation, data, papers. The source of truth. |
| Pipeline | `pipeline/*.py` (GitHub Actions, weekly) | Imports both models, fetches public data, calibrates, exports versioned JSON snapshots. |
| Engine | `src/engine/*.ts` (Web Worker) | A line-by-line TypeScript port of TEMPEST plus the coupling; runs thousands of paths in seconds. |
| Proof | `npm run parity` (CI) | Compares the TypeScript engine with Python TEMPEST on the same snapshot; the refresh will not deploy if it fails. |
| App | `src/ui`, `docs/` | React, single-file build, service worker, installable on iPad. |

**Why this layout:**

- **Not Pyodide.** It would mean a 30–40 MB download and a slow start. SciPy and XGBoost are fragile on iPad Safari.
- **Not a server.** GitHub Pages is static, free and has no operations burden.
- **A port plus a parity test.** This keeps the Python papers authoritative and makes the browser fast. As of 5 Nov 2026, 362 of 362 statistics match at 10,000 paths. A TypeScript run of the oil-crisis scenario reproduces the Python run to the second decimal: 82.3% vs 82.1% world-recession probability, −2.79% vs −2.80% world GDP.

## 2. How the models are coupled

| Direction | Mechanism | Why |
| --- | --- | --- |
| Economy → politics | **Analog resampling.** POLIS already simulates 10,000 joint political worlds driven by a world-economy factor and an anti-incumbent swing. Just before each country's decisive event, each ORBIS path picks that country's world: one of the 6 nearest neighbours on (path's world output gap so far, standardised; shared swing). | The baseline reproduces POLIS's probabilities exactly, and scenarios move them for the right reason. Each model's calibration stays intact. The step is cheap and easy to inspect. |
| Politics → economy | **Policy-shift vector into TEMPEST equations.** Changes in fiscal stance, populism and illiberalism, plus uncertainty, irregular exits and policy events, are priced with POLIS Layer 4 coefficients × vulnerability. They enter TEMPEST as a sovereign premium, an FX gap, a confidence drag on the output gap, inflation and the structural primary-balance anchor. | Fiscal loosening runs through TEMPEST's own fiscal block, so its growth effect is not counted twice. With politics off the model *is* TEMPEST. |
| Instability → world | **Layer 1 hazards.** These are quarterly versions of the 12-month coup, conflict and breakdown probabilities. In 9 ORBIS economies without a state vector, an event is an irregular-exit shock. In 28 oil producers, it removes supply (Energy Institute shares) and lifts the oil price gap. | This brings the 179-country layer into the world economy through the channel that matters most. |
| Measurement | **Three states on common random numbers:** A baseline, B scenario, C scenario with politics frozen at baseline worlds. | B − A is the impact and B − C is the political feedback, with no Monte Carlo noise in the difference. |

Placeholders that ORBIS adds (all adjustable in the app, all listed in *How it works*):

- 2 pp of world output gap per σ of POLIS's economy factor
- 1 pp of GDP of primary balance per unit of fiscal-stance shift
- Fade half-lives
- A 25% producer supply loss
- +8% oil price per 1% of world supply lost
- Slovakia's debt tolerance

## 3. Recommendations: how best to execute

1. **Ship v0.1 now, as its own repo** (`auxt/ORBIS`, MIT, with POLIS-derived data under CC BY-SA 4.0). Turn on Pages from `main` / `docs`. Keep TEMPEST and POLIS as they are; ORBIS depends on them, not the reverse.
2. **Automate the data, not the judgement.** The weekly Action refreshes BIS, IMF and FRED and re-runs POLIS Layer 3. POLIS state vectors (polls, coalitions, calendars) stay a reviewed, human step: research them with Claude, open a PR in POLIS, and the next ORBIS refresh picks them up. Put the data vintage on screen (it is) and stamp it in every exported CSV.
3. **Make parity a gate.** Every engine change and every data refresh runs `npm run parity`. Add golden-scenario tests for the political layer next: baseline turnover = POLIS published ± MC error.
4. **Speed next, before more features.** About 7 s for 2,000 paths × 3 states on one cloud core. Shard paths across `navigator.hardwareConcurrency` workers (paths are independent; only quantiles and the analog standardisation need a merge step) for 4–8×. Then add a progressive first pass (500 paths in under a second, refined behind it).
5. **Deepen the coupling in this order:**
   - (a) Port POLIS Layer 3 itself to TypeScript, so approval drifts with *each country's* TEMPEST output gap and inflation, not the world's.
   - (b) Re-estimate Layer 4 by local projections on historical political events.
   - (c) Feed TEMPEST's sovereign stress back into POLIS's collapse hazard.
6. **Grow coverage together.** TEMPEST's roadmap (~42 economies incl. CEE and the Gulf) and POLIS's next step (EU-27 state vectors) should land as one release. Then Poland, Czechia, Hungary, Saudi Arabia and the UAE have both an economy and a politics.
7. **Scenario UX:**
   - Side-by-side scenario comparison.
   - A saved scenario library (JSON import/export alongside today's share links).
   - *Explain this number*: re-run with each channel switched off and show the waterfall.
   - An optional **"draft a scenario from a narrative"** assistant (Claude API key or Ollama, as in Bedrock Math's tutor) that turns "Strait of Hormuz closes for a quarter and the Fed holds" into shock cards the user then edits.
8. **Plug into EarthSim / Skynet.** The hex world uses the same visual grammar. Publish ORBIS outputs as the `earthsim.nation.state` feed POLIS's `module.yaml` already anticipates, and draw country results onto EarthSim's hexes.
9. **Write it up.** A short ORBIS working paper: coupling design, parity evidence, three illustrative scenarios (oil crisis, populist Europe, US crisis). Archive releases with a DOI (Zenodo) so the papers can cite exact versions.

## 4. Roadmap

| Phase | Scope | Size |
| --- | --- | --- |
| 0 (done) | v0.1: engine port + parity, analog coupling, Layer 1 oil channel, dashboard, PWA, weekly refresh workflow | – |
| 1 | Publish repo and Pages; multi-worker speed-up; scenario compare; saved scenarios; channel waterfall | 1–2 weeks |
| 2 | POLIS Layer 3 in TypeScript with country-level economy → approval; Layer 4 local projections; CEE + Gulf economies; EU-27 politics | 4–6 weeks |
| 3 | TEMPEST estimation (particle filter) and backtests; scenario assistant; EarthSim / Skynet integration; ORBIS paper | ongoing |

## 5. Known limits (v0.1)

- Political worlds respond to the world economy, not yet to each country's own economy. Events before a country's selection quarter take effect from the quarter after it.
- POLIS's horizon ends in November 2028. TEMPEST runs to 2036, and later political change is not modelled.
- Layer 1 hazards are held constant over the horizon.
- Results illustrate mechanisms under stated assumptions; they are not forecasts, ratings or advice.
