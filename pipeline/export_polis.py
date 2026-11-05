"""
ORBIS pipeline, step 2: export POLIS for the browser.

    python pipeline/export_polis.py --polis ../POLIS [--paths 10000] [--pool 4000]

Writes src/data/polis_snapshot.json with
  stability   Layer 1 scores for every country POLIS covers (bands, event-type split, drivers)
  countries   Layer 2 cards for the countries with a researched state vector
  pool        a pool of Layer 3 Monte Carlo paths, one coherent political world per path:
              for each country the policy-shift vector (fiscal, populism, illiberalism), uncertainty U,
              timing of the first transition and of the last change of government, irregular exits,
              policy-event add-ons, outcome label and whether the incumbent camp lost; plus the path's
              world-economy factor and anti-incumbent swing, which ORBIS uses to pick analogs
  vuln        Layer 4 vulnerability multipliers for every ORBIS economy
  reference   POLIS's own summary of this run (to check the export against outputs/mc_summary.csv)

POLIS is imported unchanged; only its IMF lookup for vulnerability is pointed at the TEMPEST snapshot's
IMF WEO values, so both models use one data vintage.
"""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import sys
import time
from collections import Counter

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
H_MONTHS = 25

# Layer 4 market flags for ORBIS economies without a POLIS state vector (POLIS conventions)
EXTRA_MACRO = {
    "ITA": {"euro": True}, "ESP": {"euro": True},
    "CAN": {"fx": "CAD"}, "KOR": {"fx": "KRW"}, "AUS": {"fx": "AUD"},
    "CHN": {"fx": "CNY", "em": True, "home_bias": True}, "IND": {"fx": "INR", "em": True, "home_bias": True},
    "MEX": {"fx": "MXN", "em": True}, "ZAF": {"fx": "ZAR", "em": True},
}
# Developed-market floating currencies get POLIS's GBP-like FX vulnerability of 1.0
DM_FX = {"CAD", "KRW", "AUD"}


def coarse(label: str) -> str:
    """Group POLIS outcome labels for display: the leading party for parliamentary outcomes
    ("PS-led: PS+Slovensko+SaS" -> "PS-led"), the president and bloc for France."""
    if label.startswith("President ") and ";" in label:
        return label.split(";")[0]
    if "-led:" in label:
        return label.split(":")[0]
    return label


def select_quarter(cfg) -> int:
    """TEMPEST quarter after which ORBIS picks this country's political world: just before its first
    decisive scheduled event inside the POLIS horizon (elections, leadership contests); 4 if none."""
    months = []
    for c in cfg.get("calendar", []):
        months.append(c["date"])
    pres = cfg.get("presidential", {})
    for key in ("r1", "date"):
        if key in pres:
            months.append(pres[key])
    ms = [(int(d[:4]) - 2026) * 12 + int(d[5:7]) - 11 for d in months]
    ms = [m for m in ms if 0 <= m < H_MONTHS]
    if not ms:
        return 4
    q = (min(ms) + 1) // 3 + 1
    return int(min(9, max(2, q - 1)))


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def q8(x, scale, lo=-127, hi=127):
    return np.clip(np.round(np.asarray(x, float) * scale), lo, hi).astype(np.int8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--polis", default=str(ROOT.parent / "POLIS"))
    ap.add_argument("--paths", type=int, default=10000)
    ap.add_argument("--pool", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()

    pdir = pathlib.Path(a.polis).resolve()
    sys.path.insert(0, str(pdir))
    from polis import experiments as ex
    from polis import macro, montecarlo as mc
    from polis.standing import gsi

    snap = json.loads((ROOT / "src" / "data" / "tempest_snapshot.json").read_text())
    tab = {r["iso3"]: r for r in snap["init_table"]}
    weo = pd.DataFrame([{"iso3": c, "year": 2026, "debt_gdp": r["gov_debt"], "current_account": r["current_account"]}
                        for c, r in tab.items()])
    macro._imf.cache_clear()
    macro._imf = lambda: weo                     # one data vintage for both models

    stab = pd.read_csv(pdir / "outputs" / "stability_latest.csv")
    rep = json.loads((pdir / "outputs" / "stability_report.json").read_text())
    stab_map = {r.iso3: {"p_coup": r.p_coup, "p_acute": r.p_acute} for r in stab.itertuples()}

    # ---- Layer 3, exactly as polis.montecarlo.run (same seed and stream order) ----
    t0 = time.time()
    n = a.paths
    rng = np.random.default_rng(a.seed)
    shocks = mc.Shocks.draw(rng, n)
    cfgs, paths, summaries = {}, {}, {}
    for f in sorted(mc.CFG_DIR.glob("*.json")):
        cfg = json.loads(f.read_text())
        iso = cfg["iso3"]
        fn = mc.SCRIPTS.get(iso, mc.run_parliamentary)
        paths[iso] = fn(cfg, np.random.default_rng(rng.integers(1e9)), shocks, n, stab_map.get(iso, {}))
        summaries[iso] = mc.summarize(cfg, paths[iso], np.random.default_rng(rng.integers(1e9)))
        cfgs[iso] = cfg
        print(f"{iso}: p_hog_change_24m {summaries[iso]['p_hog_change_24m']}  ({time.time() - t0:.0f}s)")

    # ---- per-path export (first `pool` paths; paths are i.i.d.) ----
    P = min(a.pool, n)
    econ = shocks.econ[:P]
    # economy keys: mean of POLIS's world-economy factor from Nov 2026 to the end of TEMPEST quarter t
    # (quarter t ends in POLIS month 3t - 2), standardised; ORBIS matches its own world output gap to them
    econ_keys = {}
    for t in range(2, 10):
        k = econ[:, : 3 * t - 1].mean(axis=1)
        econ_keys[str(t)] = b64(np.round((k - k.mean()) / k.std() * 1000).astype(np.int16))
    pool = {"n": P, "econ_keys": econ_keys,
            "swing": b64(np.round(shocks.swing[:P] * 1000).astype(np.int16)), "countries": {}}
    cards = {}
    for iso, cfg in cfgs.items():
        v, vfx = macro.vulnerability(cfg)
        prof0 = mc.initial_profile(cfg)
        labels = Counter(coarse(mc.outcome_label(cfg, st)) for st in paths[iso])
        top = [lab for lab, _ in labels.most_common(7)]
        cols = {k: np.zeros(P, dtype=np.int8) for k in
                ("outcome", "m_first", "m_change", "m_irreg", "dfis", "dpop", "dill", "U", "ev_m",
                 "ev_fx", "ev_growth", "ev_infl", "flags")}
        ev_spread = np.zeros(P, dtype=np.int16)
        for p, st in enumerate(paths[iso][:P]):
            prof1 = mc.final_profile(cfg, st)
            lab = coarse(mc.outcome_label(cfg, st))
            cols["outcome"][p] = top.index(lab) if lab in top else len(top)
            tr = st.transitions
            cols["m_first"][p] = min((m for m, _, _ in tr), default=-1)
            cols["m_change"][p] = max((m for m, _, ch in tr if ch), default=-1)
            cols["m_irreg"][p] = min((m for m, k, _ in tr if k == "irregular_exit"), default=-1)
            cols["dfis"][p], cols["dpop"][p], cols["dill"][p] = (
                q8(prof1["fiscal"] - prof0["fiscal"], 100), q8(prof1["pop"] - prof0["pop"], 100),
                q8(prof1["illib"] - prof0["illib"], 100))
            cols["U"][p] = q8(st.U, 20, 0, 127)
            if st.events:
                cols["ev_m"][p] = min(ev["month"] for ev in st.events)
                ev_spread[p] = int(round(sum(ev.get("spread_bp", 0) * (v if ev.get("scale_by_v") else 1.0)
                                             for ev in st.events)))
                cols["ev_fx"][p] = q8(sum(ev.get("fx_pct", 0) for ev in st.events), 10)
                cols["ev_growth"][p] = q8(sum(ev.get("growth_pp", 0) for ev in st.events), 100)
                cols["ev_infl"][p] = q8(sum(ev.get("inflation_pp", 0) for ev in st.events), 100)
            else:
                cols["ev_m"][p] = -1
            lost = ex.camp_lost(iso, cfg, st)
            changed = any(ch for _, _, ch in tr)
            cols["flags"][p] = int(lost) | (int(changed) << 1) | (int(st.early_election) << 2)
        enc = {k: b64(v_) for k, v_ in cols.items()}
        enc["ev_spread"] = b64(ev_spread)
        enc["labels"] = top + ["Other"]
        enc["t_select"] = select_quarter(cfg)
        pool["countries"][iso] = enc

        s = summaries[iso]
        cal = [{"date": c["date"], "type": c["type"]} for c in cfg.get("calendar", [])]
        pres = cfg.get("presidential", {})
        for key in ("r1", "r2", "date", "early_date"):
            if key in pres:
                cal.append({"date": pres[key], "type": f"presidential_{key}"})
        cards[iso] = {
            "name": cfg["name"], "system": cfg["system"], "as_of": cfg["as_of"],
            "executive": cfg["executive"], "government": cfg.get("government", {}).get("parties"),
            "approval": cfg.get("approval"), "gsi": gsi(cfg)["gsi"], "calendar": sorted(cal, key=lambda c: c["date"]),
            "macro_label": cfg["macro"]["label"], "fx_label": cfg["macro"].get("fx"),
            "p_hog_change_24m": s["p_hog_change_24m"], "p_early_election": s["p_early_election"],
            "p_hog_change_by_month": s["p_hog_change_by_month"], "first_change_type": s["first_change_type"],
            "outcomes": s["outcomes"], "macro": s["macro"],
            "policy_events": [{k: e[k] for k in ("name", "month", "p") if k in e} for e in cfg.get("policy_events", [])],
            "sources": cfg.get("sources", [])[:6],
        }

    # ---- Layer 4 vulnerability for every ORBIS economy ----
    vuln = {}
    for iso in snap["countries"]:
        cfg = cfgs.get(iso, {"iso3": iso, "macro": EXTRA_MACRO.get(iso, {})})
        v, vfx = macro.vulnerability(cfg)
        if cfg["macro"].get("fx") in DM_FX:
            vfx = 1.0
        vuln[iso] = {"v": round(float(v), 4), "vfx": None if vfx is None else round(float(vfx), 4),
                     "em": bool(cfg["macro"].get("em"))}

    # ---- Layer 1 ----
    fam = [c for c in stab.columns if c.startswith("drv_")]
    stability = []
    for d in stab.to_dict(orient="records"):
        stability.append({"iso3": d["iso3"], "name": d["country_name"], "p_acute": round(d["p_acute"], 4),
                          "band": d["band"], "risk_vs_base": d["risk_vs_base"], "p_coup": round(d["p_coup"], 4),
                          "p_onset": round(d["p_onset"], 4), "p_breakdown": round(d["p_breakdown"], 4),
                          "p_erosion": round(d["p_erosion"], 4), "psi": d["psi"], "drivers": d["main_drivers"],
                          "families": {c[4:]: round(float(d[c]), 3) for c in fam}})
    out = {
        "meta": {"model": "POLIS v0.1", "paths_run": n, "pool": P, "seed": a.seed, "start_month": "2026-11",
                 "horizon_months": H_MONTHS, "base_rate_acute": rep["base_rate_acute"], "band_rule": rep["band_rule"],
                 "acute_auc": rep["acute"]["stack"]["roc_auc"]},
        "stability": stability, "countries": cards, "pool": pool, "vuln": vuln,
        "reference": {iso: {"p_hog_change_24m": s["p_hog_change_24m"], "p_early_election": s["p_early_election"],
                            "spread_mean_bp": s["macro"]["spread_bp"]["mean"]} for iso, s in summaries.items()},
    }
    (ROOT / "src" / "data" / "polis_snapshot.json").write_text(json.dumps(out, separators=(",", ":"), default=float))
    pub = pd.read_csv(pdir / "outputs" / "mc_summary.csv").set_index("iso3")
    print("\ncheck vs published outputs/mc_summary.csv")
    for iso, s in summaries.items():
        print(f"  {iso}: p_change {s['p_hog_change_24m']:.3f} (published {pub.loc[iso, 'p_hog_change_24m']:.3f})  "
              f"spread {s['macro']['spread_bp']['mean']:7.2f} (published {pub.loc[iso, 'spread_mean_bp']:7.2f})")
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
