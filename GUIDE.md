# ORBIS guide: the models, how they work together, how to use them, and their limits

ORBIS is a world socio-economic scenario lab. It runs two independent models as one simulated world:

- **TEMPEST** (*Tail Events in a Multi-country Probabilistic Economy with Stress Transitions*) models
  economies and financial crises.
- **POLIS** (*Probabilistic Outlook for Leadership, Instability and Succession*) models political
  instability, changes of government and what markets make of them.

In every Monte Carlo path, the economy shapes the politics and the politics feed back into the
economy. Each path is run three times on identical random numbers, so ORBIS can tell you what a
scenario does, and how much of that comes from politics reacting to it.

This guide explains each model as ORBIS uses it, the coupling between them, how to read and use the
app, and what the results can and cannot tell you. The short version of the architecture is in
[`DESIGN.md`](DESIGN.md); the developer notes are in [`DEVELOPMENT.md`](DEVELOPMENT.md).

**Contents**

1. [At a glance](#1-at-a-glance)
2. [TEMPEST: the economies](#2-tempest-the-economies)
3. [POLIS: the politics](#3-polis-the-politics)
4. [How ORBIS joins them](#4-how-orbis-joins-them)
5. [Scenarios, shocks and assumptions](#5-scenarios-shocks-and-assumptions)
6. [Reading the results](#6-reading-the-results)
7. [How to use ORBIS: worked examples](#7-how-to-use-orbis-worked-examples)
8. [Data, calibration and validation](#8-data-calibration-and-validation)
9. [Limitations](#9-limitations)
10. [Glossary](#10-glossary)

---

## 1. At a glance

| | TEMPEST | POLIS | ORBIS coupling |
| --- | --- | --- | --- |
| Question | How do economies grow, inflate, lend, borrow and fall into crises, and how do crises spread? | How likely is acute instability, who holds power next, and how do markets price it? | How do economic shocks change political outcomes, and how do political outcomes change economies? |
| Coverage | 17 economies: USA, DEU, FRA, ITA, ESP, GBR, JPN, CAN, KOR, AUS, CHN, IND, BRA, MEX, TUR, ZAF, plus SVK added by ORBIS | 179 countries for instability; 8 for government turnover (BRA, DEU, FRA, GBR, JPN, SVK, TUR, USA) | All 17 economies receive political shocks; 28 oil producers feed the oil price |
| Time step and horizon | Quarterly, 2026Q4 to 2036Q3 (40 quarters) | Monthly, Nov 2026 to Nov 2028 (25 months) | Quarterly; political worlds are chosen 2027Q1–2028Q3 |
| Uncertainty | Fat-tailed correlated shocks, regime draws, parameter draws, starting-point noise | Poll errors, hazards, coalition draws, shared economic factor and anti-incumbent swing | Nearest-neighbour choice among 4,000 POLIS worlds; Layer 1 event draws |
| Native language | Python (reference), ported to TypeScript for the browser | Python; its results are exported to the browser | TypeScript (`src/engine/politics.ts`, `run.ts`) |

Every number in ORBIS is a distribution over simulated paths. By default the app simulates 2,000
paths (1,000 to 10,000 are available) for each of three runs. The three runs are labelled A, B and C
throughout this guide:

| Run | What it contains |
| --- | --- |
| **A, the baseline** | No scenario shocks; politics as configured. |
| **B, the scenario** | The scenario shocks; politics respond to the scenario's economy. |
| **C, the scenario with politics frozen** | Same as B, but each path keeps the political world it had in A, apart from any outcome the scenario forces. |

All three runs share the same random numbers. **B − A** is therefore the scenario's impact, free of
Monte Carlo noise in the difference, and **B − C** is the part the economy-to-politics feedback adds.

---

## 2. TEMPEST: the economies

TEMPEST is a nonlinear, semi-structural, stock-flow-consistent model with endogenous crisis regimes.
ORBIS runs a line-by-line TypeScript port of TEMPEST v0.1.0 (`src/engine/tempest.ts`). Its 14
blocks run in order every quarter; each block reads variables already computed this quarter or last
quarter and writes new ones.

### 2.1 What each economy contains

| Block | What it does | Key variables |
| --- | --- | --- |
| Regime carry | Each economy is in a **normal** or a **stress** regime this quarter, drawn at the end of the last one. | `S` |
| Global factors | **Global financial stress** `G` follows a fat-tailed AR(1) process (persistence 0.80). It is fed by US credit spreads and by stress in systemic economies, and its volatility rises when more than 25% of world GDP is in stress. The **oil price gap** `og` mean-reverts (persistence 0.85) and rises with world demand. | `G` (VIX-equivalent: VIX ≈ 19.5 + 8·G), `og` (log points from trend) |
| Oil inflation | The oil price change is the change in the gap. | `oil` |
| Exchange rate | The real effective exchange-rate gap follows an interest-parity rule with risk-off sensitivity (safe havens appreciate when `G` rises) and jumps in stress. | `z` (up = depreciation) |
| Credit spread | A financial accelerator: the private borrowing spread widens with global stress, thin bank capital, the stress regime and partners' spreads, and saturates at a cap. | `s` |
| Real economy | An IS curve for the output gap. It depends on the real rate against its neutral level, spreads, partners' demand (trade-weighted), the fiscal impulse, the exchange rate, excess credit, global stress, the oil price (signed by each economy's net oil position) and the regime. Trend growth falls by up to 2 pp a year while in stress (**hysteresis**), so crises leave permanent losses. | `x`, `gstar`, `lnY` |
| Inflation | An anchored, **convex** Phillips curve: overheating raises inflation more than slack lowers it. Exchange-rate and oil pass-through are included. | `pi` (annualised quarterly rate) |
| Monetary policy | An inertial Taylor rule on a shadow rate, with an effective lower bound. The euro-area members (DEU, FRA, ITA, ESP, SVK) share one rate. | `i`, `i_shadow` |
| Real rate | The policy rate less expected inflation. Below the lower bound, unconventional policy delivers half the blocked easing. | `r` |
| Credit and housing | The credit-to-GDP gap and the real house-price gap, with momentum, mean reversion and a slowly adapting credit trend (like the BIS trend). | `c`, `b`, `h` |
| Banks | The debt-service ratio (BIS annuity formula) feeds a probit default rate, then credit losses, then CET1 capital. Below 8% CET1 (7.5% in emerging markets) the state **recapitalises** the banks and the cost goes onto public debt. | `dsr`, `pd`, `kappa`, `recap` |
| Fiscal and sovereign | A primary-balance rule with **fiscal fatigue** at high debt and a convex sovereign premium. Above a 4.5 pp premium, a market-access programme forces consolidation. At the 8 pp cap, economies that can default **restructure** their debt (30% haircut). Debt accumulates from interest, growth, the primary balance and bank recapitalisation. | `pb`, `sov`, `d`, `default` |
| External | Current account, net foreign assets and the sector-balance identity (private + government lending = current account). | `ca`, `n` |
| Regime switch | **Entry** odds into stress are logistic in the credit gap, excess debt service, house-price overvaluation, thin bank capital, global stress, **partners' stress** (contagion) and sovereign distress. **Exit** odds rise with bank capital and with time spent in stress. A sovereign default always means stress. | `p01`, `p10`, `S_next` |

In the stress regime the economy behaves differently: output is more persistent, spreads hit harder,
shocks are larger and trend growth is lower.

### 2.2 Shocks and uncertainty

Each quarter draws 11 country shocks and 2 global shocks (financial stress and oil). Country shocks
are Student-t (5 degrees of freedom) with a common factor, so one bad draw moves many economies at
once; the global shocks have 4 degrees of freedom. On top of that, ten key coefficients are drawn
per path (for example the interest-rate sensitivity of demand, the Phillips-curve slope and the
contagion weight), and the starting output gap, credit gap and house-price gap carry nowcast noise.

### 2.3 Linkages

- **Partners' demand and real rates** use trade weights (IMF bilateral trade, 2023–2025).
- **Spread spill-overs and contagion** use financial weights: half trade weights, half "hub" weights
  for systemic financial centres.
- **World aggregates** use PPP weights over the 17 economies. China 29.8%, the US 21.8%, India 12.8%,
  Japan 4.9% and Germany 4.4% carry most of the weight; Slovakia carries 0.2%.

### 2.4 Starting point

The model starts from **2026Q3** using public data fetched on **5 November 2026**:

- **BIS:** policy rates, credit and credit gaps, debt-service ratios, real house prices.
- **IMF:** World Economic Outlook, bilateral trade, financial soundness indicators, international investment positions.
- **FRED:** VIX and Brent.

Each economy's starting values are shown in its detail panel. Brent averaged about $122 in 2026Q3,
which TEMPEST reads as an oil price 37% above its trend (trend ≈ $85).

---

## 3. POLIS: the politics

POLIS has four layers. ORBIS uses all four; Layer 3 is the one the coupling is built on.

### 3.1 Layer 1: acute instability (179 countries)

POLIS gives the 12-month probability of a **coup, a new armed conflict, or a democratic breakdown**.

- **Method:** a penalised logit in the tradition of the US Political Instability Task Force is
  stacked with gradient-boosted trees, then calibrated on rolling out-of-sample predictions. The
  out-of-sample ROC-AUC for 2014–2023 is 0.76.
- **Bands:** countries are banded relative to the 4.9% base rate:
  - **Stable:** below 2.5%
  - **Watch:** 2.5–7.4%
  - **Fragile:** 7.4–14.8%
  - **Unstable:** above 14.8%
- **Drivers:** risk is attributed to six driver families: economic stress, legitimacy and
  governance, elite fragmentation, demographic pressure, security and contagion, and near-term
  triggers.
- **Data:** V-Dem (to 2025), World Bank, IMF 2026 nowcasts, UCDP/PRIO, Powell–Thyne coups and CHES.

### 3.2 Layer 2: political standing (8 countries)

Each of the 8 countries has a researched **state vector**, as of 3–4 November 2026. It holds:

- the head of government, the governing parties and the seats in parliament
- polls and the last election result
- the electoral system
- party profiles: left–right, populism, fiscal stance from −1 to +1, illiberalism from 0 to 1
- coalition exclusions, the calendar, hazards and possible policy events

A descriptive Government Security Index (0–100) summarises it. ORBIS shows all of this in the
country panel.

### 3.3 Layer 3: turnover Monte Carlo (8 countries, 25 months)

Every month of every path, POLIS simulates:

- approval drifting with a shared **world-economy factor**
- competing hazards: cabinet collapse, leader replacement, mortality and irregular exit
- scheduled elections, with poll errors that grow with time to election day
- seat allocation under each country's real rules (D'Hondt, Sainte-Laguë, Hagenbach-Bischoff, or a seat–vote curve)
- coalition formation by conditional logit (majority, minimal size, ideological range, largest party, incumbency, pacts, vetoes)
- dedicated scripts for France (two-round presidential, possible dissolution), the United States, Türkiye and Brazil

Two common factors make the 8 countries move together: the **economy factor** (an AR(1) with
persistence 0.8) and an **anti-incumbent swing**. A bad world economy or a strong swing hurts
incumbents everywhere at once.

### 3.4 Layer 4: macro-financial impact

POLIS turns each simulated outcome into a **policy-shift vector**: the change in the government's
fiscal stance, populism and illiberalism relative to today. It adds an **uncertainty** score
(elections, collapses, minority governments), any irregular exit, and any policy events (for
example an EU rule-of-law procedure). These are priced in basis points of spread, % of FX, growth
and inflation, scaled by a **vulnerability multiplier**. The multiplier rises with debt and is
lower for reserve-currency issuers, home-biased debt markets and euro members (ECB backstop). It is
higher for emerging markets with current-account deficits. Each country is priced on its own
instrument (Bund yield, OAT–Bund spread, gilt yield, JGB yield, US term premium, CDS).

---

## 4. How ORBIS joins them

The coupling is built so that each model keeps its own calibration. With the political layer
switched off, ORBIS **is** TEMPEST. In the baseline, ORBIS reproduces POLIS's probabilities.

### 4.1 Economy → politics: choosing a political world for each path

POLIS's own 10,000-path run is re-run and stored as a pool of **4,000 political worlds**. Each world
records, for every one of the 8 countries:

- the outcome
- when the first transition and the last change of government happen
- the policy-shift vector and the uncertainty score
- any irregular exit and any policy events
- whether the incumbent camp lost

It also records the world's economy factor and its swing.

Just before each country's first decisive scheduled event, every ORBIS path picks that country's
world:

| Country | World chosen after | Why then |
| --- | --- | --- |
| France | 2027Q1 | Presidential election, April 2027 |
| Japan, Slovakia | 2027Q2 | LDP leadership and Slovak election, September 2027 |
| Brazil, Germany, United Kingdom | 2027Q3 | No scheduled national election in the POLIS horizon: changes come from hazards |
| Türkiye | 2028Q1 | Presidential election, May 2028 |
| United States | 2028Q3 | Presidential election, November 2028 |

The choice works like this:

1. **Economy key.** ORBIS takes the path's average **world output gap** from 2026Q4 up to the
   selection quarter and standardises it against the baseline run. In the baseline, the key therefore
   has the same distribution as POLIS's economy factor over the same months.
2. **Scenario shift.** In the scenario run, the key moves by
   `(scenario output gap − baseline output gap) × strength / 2 pp`. The default strength is 1, so a
   world economy 2 pp weaker than in the baseline counts as one standard deviation of POLIS's
   economy factor. The "Economy → politics" slider sets the strength.
3. **Swing.** Each path has one anti-incumbent swing, shared by all 8 countries, which keeps POLIS's
   cross-country correlation. The "Anti-incumbent wave" shock shifts it.
4. **Nearest neighbours.** ORBIS finds the 6 pool worlds closest to (economy key, swing) and picks
   one of them with the path's own uniform draw. Forced outcomes (see §5) restrict the pool before
   the search.

The result: in the baseline, turnover probabilities match POLIS. In a scenario that damages the world
economy, paths land on worlds with worse economies, where incumbents lose more often.

### 4.2 Politics → economy: the policy-shift vector inside TEMPEST

From its selection quarter onward, each country's chosen world adds terms to TEMPEST's own equations.
`V` and `V_fx` are the POLIS vulnerability multipliers; `Δfiscal`, `Δpop` and `Δillib` are the
policy-shift vector; `U` is the uncertainty score.

| TEMPEST variable | Political term (POLIS Layer 4 coefficients) |
| --- | --- |
| Sovereign premium | `V·(15·Δfiscal + 30·Δpop + 40·Δillib)` bp (45 and 60 for emerging markets), `+ 8·V·U` bp, `+ 150·V` bp after an irregular exit, + policy events |
| Exchange rate | `V_fx·(−1·Δfiscal − 2·Δpop − 5·Δillib − 0.4·U)` %, applied as a depreciation; not used for euro members |
| Output gap | `−1.4·Δpop − 0.05·U` pp, `−2` pp after an irregular exit, + policy events (a confidence channel) |
| Inflation | `0.4·Δillib` pp (`1.5` in emerging markets) + policy events |
| Structural primary balance | `−1.0·Δfiscal` pp of GDP. The growth effect of fiscal loosening then comes from TEMPEST's own fiscal impulse, so it is not counted twice. |

**Timing.** Policy shifts phase in over two quarters from the change of government and then stay.
Uncertainty, irregular exits and policy events phase in the same way and then fade, with a half-life
of 6 quarters (8 for the output effect of an irregular exit).

**Persistence.** The terms are entered as **deviation targets**: ORBIS converts each target into the
impulse that, absent feedback, moves the variable by that amount, using the equation's own
persistence. TEMPEST then responds endogenously. A higher premium raises debt costs and crisis odds;
a weaker currency raises inflation and the policy rate; a loosening raises demand and debt.

### 4.3 Instability everywhere else: POLIS Layer 1

- **Irregular exits in 9 more economies.** ITA, ESP, CAN, KOR, AUS, CHN, IND, MEX and ZAF have no
  POLIS state vector. Each quarter they face a hazard equal to the quarterly version of their 12-month
  acute-instability probability. An event acts like an irregular exit:
  - +150 bp and +24 bp of uncertainty premium, both scaled by `V`
  - −2.15 pp on the output gap
  - FX pressure where the currency floats

  The effects fade as in §4.2.
- **The geopolitical oil channel.** 28 oil producers carry their Layer 1 hazard and their share of
  world output (Energy Institute Statistical Review 2025, 2024 data). The largest are the US 18.9%,
  Russia 11.6%, Saudi Arabia 11.2%, Canada 6.4%, Iran 5.2% and Iraq 4.7%. An acute event removes 25%
  of that producer's output (adjustable). Each 1% of world supply lost raises the oil price gap by 8%
  (adjustable; a short-run price elasticity of about 0.125). The loss fades with a half-life of 3
  quarters. Every economy then feels it through TEMPEST's oil channels: demand (signed by net oil
  position), inflation pass-through and the current account.

### 4.4 What the coupling adds, in numbers (vintage of 5 Nov 2026, 2,000–4,000 paths)

- With politics on, the baseline five-year probability of a world recession rises from **6.2%**
  (TEMPEST alone) to about **8%**.
- In the "Oil crisis 2027: scorched earth" scenario:
  - World GDP is about **2.8%** below baseline after two years.
  - The US incumbent camp's chance of losing the November 2028 election rises from about **60% to 67%**.
  - Türkiye, whose election falls in 2028 after the world economy has rebounded, barely moves.
  - World GDP barely moves through this political channel, because the US policy shift is small
    relative to the oil shock.
- Forcing an RN presidency in France changes only the paths where RN would not have won (about one
  path in six). The **average** French premium rises; the **median** path does not change. This is
  why ORBIS reports both (§6).

---

## 5. Scenarios, shocks and assumptions

### 5.1 Presets

| Group | Presets | Source |
| --- | --- | --- |
| Reference | Baseline | – |
| Markets | Global risk-off (VIX about 48), US higher for longer (+150 bp for 2 years), Euro sovereign stress (FRA/ITA +200 bp, ESP +80 bp), US crisis episode (8 quarters of forced stress) | TEMPEST library and paper; ORBIS |
| Energy | Oil supply shock (+40%, +10%), Oil crisis 2027: renewed closure, Oil crisis 2027: scorched earth (with risk-off), Gulf instability (hazards ×5 in seven Gulf producers) | TEMPEST library and oil-crisis paper; ORBIS |
| Real economy | China property and credit bust, Global stagflation, Coordinated fiscal stimulus | ORBIS |
| Politics | Anti-incumbent wave (+1.5σ), France: RN presidency, Slovakia: opposition takes power, US: Democrat elected 2028, Populist shock in Europe | POLIS; ORBIS |

### 5.2 Shock cards

Every preset is a list of editable shock cards, and you can add your own with **+ Add shock**. Cards
have a size, a start quarter, a duration, a linear fade, and the economies they apply to. Preset
cards with an explicit path have a **Scale** slider instead.

| Card | Unit | How it enters the model |
| --- | --- | --- |
| Global risk-off | VIX level | Sets global stress `G` to that VIX reading, fading towards the VIX mean; free afterwards (a TEMPEST override) |
| Oil price | % vs baseline | Deviation target on the oil price gap (the "Oil supply shock" preset uses TEMPEST's raw overrides instead) |
| Policy rate above rule | pp | Added to the policy rate after the Taylor rule; the shadow rate is untouched (a TEMPEST override) |
| Credit spread | pp | Deviation target on the private borrowing spread |
| Demand | pp of output | Deviation target on the output gap |
| Inflation | pp | Deviation target on inflation |
| Fiscal stance | % of GDP | Deviation target on the structural primary balance; negative = loosening |
| Sovereign premium | pp | Added to the sovereign premium |
| House prices | % vs baseline | Deviation target on the house-price gap |
| Crisis regime | forced | Holds economies in the stress regime for the duration (a TEMPEST override) |
| Political outcome | – | Keeps only political worlds where a country's incumbent camp loses or holds, or where the outcome matches a label (for example "PS-led" or "(RN)") |
| Anti-incumbent wave | σ | Shifts the swing shared by all 8 POLIS countries |
| Instability hazard | × | Multiplies Layer 1 hazards for the chosen countries (the 9 economies without a state vector, and oil producers) |

A **deviation target** is the move the variable would make if nothing else reacted. In practice the
rest of the model responds, so the realised move differs. For example, a demand shock triggers
monetary easing that offsets part of it.

### 5.3 Assumptions

Assumptions apply to **all three runs**, baseline included. Changing one changes the baseline too.

| Assumption | Default | What it does |
| --- | --- | --- |
| Crisis regimes | on | Off: no economy ever enters stress |
| Fat-tailed shocks | on | Off: normal instead of Student-t shocks |
| Scarring | on | Off: stress no longer lowers trend growth |
| Parameter uncertainty | on | Off: one parameter set for all paths |
| Contagion strength | ×1 | Scales partners'-stress entry odds and spread spill-overs |
| Central banks | Standard | Look through (×0.2) or hawkish (×3) response to excess inflation; Türkiye keeps its own rule |
| Oil sensitivity | IMF-consistent | A 10% oil rise held for a year costs 0.15% of world GDP; TEMPEST's default is weaker |
| Political layer | on | Off: TEMPEST alone |
| Economy → politics | ×1 | Strength of the feedback in §4.1 |
| Political market impact | ×1 | Scales every political term in §4.2 and §4.3 |
| Instability hazards | ×1 | Scales all Layer 1 hazards |
| Geopolitical oil channel | on | Producer supply losses (§4.3) |
| Output lost in a producer crisis | 25% | Share of a producer's output lost |
| Oil price per 1% of supply lost | +8% | Price impact of a supply loss |
| Paths, horizon | 2,000, 10 years | More paths: smaller Monte Carlo error, slower run |

---

## 6. Reading the results

### 6.1 Distributions, medians and averages

- **Fan charts** show the median (line) with the 68% (16th–84th percentile) and 90% (5th–95th)
  bands. Grey is the baseline; blue is the scenario.
- **"vs baseline"** values are computed **path by path**: scenario minus baseline on the same random
  numbers. ORBIS reports the **average** difference (map, table, headline) and, where shown, the
  **median** and the **worst 5%**. The average captures shocks that change only some paths, such as
  forced political outcomes; the median shows the typical path.
- **Probabilities** are shares of paths, written baseline → scenario. Each probability has Monte
  Carlo error, roughly `√(p(1−p)/paths)`:
  - at 2,000 paths: about ±0.7 points for p = 10% and ±1.1 points for p = 50%
  - at 10,000 paths: about half that
  - differences between runs are much more precise than this, because they share random numbers

### 6.2 Definitions

| Measure | Definition |
| --- | --- |
| GDP vs baseline | Difference in the level of real GDP (log points × 100) |
| World | PPP-weighted aggregate of the 17 economies (about two thirds of world output at PPP) |
| Recession within 2 years | Year-on-year GDP growth below zero in any of the first 8 quarters |
| World recession within 5 years | World year-on-year growth below zero in any of the first 20 quarters |
| Crisis within 5 years | In TEMPEST's stress regime in any of the first 20 quarters |
| Crisis, GDP-weighted economy | The PPP-weighted average of the 17 crisis probabilities |
| Bank recap | The state recapitalises banks at least once over the horizon |
| Market access | The sovereign premium exceeds 4.5 pp at least once |
| Debt restructuring | The premium reaches its 8 pp cap in an economy that can default (own-currency reserve issuers cannot) |
| Inflation | Annualised quarterly rate, so oil shocks show as sharp one-quarter spikes |
| Brent | Trend price × exp(oil gap / 100) |
| Global financial stress | VIX-equivalent: 19.5 + 8 × G |
| Incumbent camp loses | POLIS's definition by November 2028 (successor parties of the same camp count as holding) |

### 6.3 The views

- **World.** Five headline numbers, then the hex map of any metric. Use the quarter slider and play
  button to animate it, the region chips or a pinch to zoom, and click any country to open its panel.
  Below the map are fan charts for world growth, world GDP vs baseline (with and without political
  feedback), inflation, Brent, global stress and the share of world GDP in crisis.
- **Economies.** A sortable table with GDP effects and tails, recession, crisis, debt, bank and
  market-access risk, and turnover. Copy it or download it as CSV.
- **Politics.** For each of the 8 countries, the chance its incumbent camp loses (baseline → scenario),
  the top outcomes, and the mean political add-on to its own market instrument. Also the Layer 1
  instability map and the highest-risk list with drivers.
- **Contagion.** A heatmap of the share of paths in stress, by economy and quarter (scenario, or
  scenario minus baseline), and the network of financial linkages.
- **Country panel.** Fan charts for nine variables, the starting point, POLIS's political card, the
  mean political add-ons to premium, output and the budget, and the instability drivers.
- **How it works.** The coupling diagram, the placeholders, the data vintage and the parity results.

---

## 7. How to use ORBIS: worked examples

**Stress-test a market shock.**

1. Choose *Global risk-off* and read the headline numbers.
2. In *Economies*, sort by "Worst 5%".
3. Open Italy and Türkiye and compare their sovereign premia and crisis paths.
4. In *Contagion*, switch to "Scenario minus baseline" to see which economies are pulled in, and when.

**Price a political outcome.**

1. Choose *France: RN presidency* and set the map to *Sovereign premium vs baseline*.
2. Scrub to 2028.
3. The country panel shows the mean political add-on on the OAT–Bund spread.

Compare with *Populist shock in Europe* to see several outcomes at once.

**Separate economics from politics.**

1. Run *Oil crisis 2027: scorched earth* and open *World GDP vs baseline*. The orange line
   ("without political feedback") is run C; the gap to blue is the feedback.
2. In *Politics*, check how far the US and Türkiye move.
3. Raise *Economy → politics* to ×2 and rerun to test how sensitive that is.

**Compare policy regimes.**

1. Run a scenario with *Central banks: Standard*.
2. Copy the link, switch to *Hawkish* and rerun.

Assumptions change the baseline too, so compare scenario-minus-baseline effects, not levels.

**Build your own scenario.**

1. Start from *Baseline*.
2. Add, for example, a 2-quarter *Oil price* +30% from 2027Q2, a *Policy rate above rule* of +1 pp
   for the euro area, and an *Anti-incumbent wave* of +1σ.
3. Run, then **Copy link** to share the exact scenario and assumptions.

**Find out what drives tail risk.** Rerun the baseline with *Crisis regimes* off, then with *Fat-tailed
shocks* off. TEMPEST's central finding shows up directly: the median barely moves while the tails
shrink.

**From Python.** To start from a different data vintage, add an economy, or change TEMPEST or POLIS
themselves, run the pipeline (`pipeline/export_tempest.py`, `pipeline/export_polis.py`), then
`npm run parity` and `npm run site`. The weekly GitHub Action does the same automatically.

---

## 8. Data, calibration and validation

- **Data vintage.** The economies start from BIS, IMF and FRED data fetched on 5 November 2026
  (2026Q3 state). The politics use POLIS state vectors researched on 3–4 November 2026 and Layer 1
  data to 2025 with IMF 2026 nowcasts. The vintage is shown in the app header.
- **Calibration.** TEMPEST's behavioural parameters are calibrated priors, not estimates.
  - Several items are calibrated so that the starting point is a sensible baseline: debt-service
    maturities, the fiscal anchor (WEO medium term) and trend growth (WEO five-year-ahead).
  - The IMF-consistent oil sensitivity (`a9` = 0.039) is calibrated in the pipeline.
  - POLIS's hazards and Layer 4 coefficients are priors from the literature.
- **Parity of the port.** The TypeScript engine is checked against Python TEMPEST on the same snapshot
  and four library scenarios. The checks cover:
  - world growth quantiles
  - global stress
  - crisis shares
  - world GDP effects
  - each economy's recession and crisis probabilities, median growth and debt

  On 5 November 2026, **362 of 362** checks were within Monte Carlo tolerance at 10,000 paths. The
  two engines use different random-number generators, so they agree in distribution, not path by path.
- **Reproduction of POLIS.** The pipeline's fresh 10,000-path POLIS run reproduces the published
  turnover probabilities of 4 November 2026 exactly. The baseline turnover probabilities in ORBIS
  match them within sampling error.
- **Reproducibility.** Given a snapshot, a seed and the settings, a run is deterministic. The
  **Copy link** URL encodes the settings.

---

## 9. Limitations

Read every result as "what these models imply under these assumptions", not as a forecast.

### 9.1 TEMPEST

- **Calibrated, not estimated.** Parameters are judgement-based priors; there is no particle filter
  or Bayesian estimation yet. Levels are less reliable than mechanisms and relative rankings.
- **Expectations are backward-looking.** Announcements, forward guidance and credibility effects
  work only through the rules as written.
- **Missing channels.** There is no separate dollar-funding channel and no interbank network.
  Financial linkages blend trade weights with judgemental hub weights.
- **Starting-point shortcuts.**
  - Emerging-market output gaps start at zero.
  - Slovakia's credit gap and debt-service ratio use defaults, because the BIS does not publish them.
  - Exchange rates are real effective rates.
  - Euro members share one policy rate.
  - Bank capital is CET1 or Tier 1 depending on what the IMF reports.
- **Data quirks pass through.** The data checks flag implausible jumps but do not change them. In this
  vintage, Korea's 2026 current account jumps from 6.5% to 18.8% of GDP in the WEO.
- **Guard rails.** Numerical bounds clip a small share of extreme paths; the share is recorded in
  each run.
- **Coverage.** 17 economies, about two thirds of world output at PPP (66.7% in this vintage). There
  is no explicit rest of the world, so "world" means these 17.

### 9.2 POLIS

- **Horizon.** Turnover is simulated only to November 2028. After that, policy shifts persist but no
  new political change is modelled, while TEMPEST runs to 2036.
- **Researched state vectors go stale quickly.** Polls, coalitions and calendars are as of 3–4
  November 2026, and refreshing them is a manual step.
- **Priors.** Hazards, scripted probabilities (for example in France and Türkiye), party scores marked
  as estimates, and all Layer 4 coefficients are priors.
- **Annual Layer 1 data.** Layer 1 uses data to 2025 with IMF nowcasts, so it does not see events of
  2026. ORBIS holds its hazards constant for ten years.
- **Coverage.** Turnover covers 8 countries; the other 9 economies receive only acute-instability
  shocks, not ordinary changes of government.

### 9.3 The coupling (ORBIS's own assumptions)

- **World economy, not national economies.** Political worlds respond to the *world* output gap,
  matched to POLIS's world-economy factor. A recession confined to one country does not by itself
  raise that country's turnover risk.
- **One choice per country.** Each country's political world is chosen once, just before its first
  decisive event. Changes POLIS places before that quarter (for example an early cabinet collapse in
  Germany or the United Kingdom) take effect from the quarter after it. Economic news after the
  choice does not change the political outcome.
- **Nearest-neighbour smoothing.** Choosing among the 6 nearest of 4,000 worlds smooths the response.
  Scenarios beyond about ±3.5 standard deviations of the economy factor are capped at the edge of
  the pool.
- **Correlation is approximate.** Countries share the swing but are matched separately, so the joint
  pattern across countries is close to POLIS's but not identical. Forcing one country's outcome does
  not by itself shift the others; add an *Anti-incumbent wave* for that.
- **Placeholders.** The coupling constants are placeholders:
  - 2 pp of world output gap per σ of the economy factor
  - 1 pp of GDP of primary balance per unit of fiscal stance
  - the timing profiles (§4.2)
  - the 25% producer loss
  - +8% oil per 1% of supply lost

  All can be adjusted in *Assumptions* or in `src/engine/politics.ts`.
- **Instruments are mapped onto one premium.** POLIS prices each country on its own instrument (Bund
  yield, term premium, CDS). ORBIS applies all of them to TEMPEST's sovereign premium.
- **Possible double counting in oil.** TEMPEST's own oil shocks were calibrated on history that
  already contains geopolitical disruptions, so the explicit oil channel may add some oil volatility
  twice. Switch it off to see TEMPEST's oil risk alone.
- **The instability hazard card skips POLIS's 8 countries.** It has no effect on them, because their
  irregular exits come from POLIS Layer 3.

### 9.4 Numerical and practical

- **Monte Carlo error.** At 2,000 paths, tail statistics (5th percentile, rare events) are noisy. Use
  5,000–10,000 paths for figures you quote.
- **Run time.** About 7 seconds for 2,000 paths × 3 runs on a single cloud core, faster on recent
  laptops and tablets. 10,000 paths take proportionally longer.
- **Offline mode.** Opened as a local file, the app runs the simulation on the page itself, which
  freezes the page while it runs. Served over http(s), it runs in the background.
- **Not advice.** Probabilities of crises, defaults, elections or changes of government are model
  outputs under stated assumptions. They are not assessments of any government, party, candidate,
  institution or person, express no preference among them, and are not investment, financial, legal
  or policy advice.

---

## 10. Glossary

| Term | Meaning |
| --- | --- |
| Output gap | GDP relative to its trend, % |
| Stress regime | TEMPEST's crisis state: higher persistence, larger shocks, lower trend growth |
| Contagion | Partners' stress raising an economy's odds of entering stress (finance-weighted) |
| Sovereign premium | Government borrowing cost above the safe rate, pp |
| CET1 | Bank common-equity capital as % of risk-weighted assets |
| Hysteresis (scarring) | Permanent output loss from time spent in stress |
| Political world | One path of POLIS's Monte Carlo: who governs each of the 8 countries to November 2028, and how |
| Policy-shift vector | Change in fiscal stance, populism and illiberalism of the government vs today |
| Vulnerability (V) | POLIS multiplier that scales political market impact by debt, reserve status, euro membership and external position |
| Common random numbers | Using the same random draws in all runs, so differences between runs are effects, not noise |
| Deviation target | The move a shock would cause if nothing else in the model reacted |

---

*ORBIS v0.1, 5 November 2026. Built on [TEMPEST](https://github.com/auxt/TEMPEST) and
[POLIS](https://github.com/auxt/POLIS) by Robert Auxt, with substantial assistance from Claude (Anthropic).*
