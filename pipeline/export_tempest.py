"""
ORBIS pipeline, step 1: export a calibrated TEMPEST snapshot for the browser engine.

    python pipeline/export_tempest.py --tempest ../TEMPEST            # live public data (cached 7 days)
    python pipeline/export_tempest.py --tempest ../TEMPEST --offline  # cached data only

Writes
  src/data/tempest_snapshot.json   parameters, initial state, linkages, provenance (what the browser runs)
  reference/tempest_reference.json Python reference statistics, used by `npm run parity`

TEMPEST stays the reference implementation: this script imports it unchanged and only applies
the ORBIS overlay (extra economies) from pipeline/orbis_overlay.yaml.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import pathlib
import sys
import time

import numpy as np
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]


def merge_overlay(cfg: dict, ov: dict) -> dict:
    cfg = copy.deepcopy(cfg)
    for c in ov.get("countries", []):
        if c not in cfg["countries"]:
            cfg["countries"].append(c)
    for key in ("groups", "unions"):
        for g, members in ov.get(key, {}).items():
            cfg.setdefault(key, {}).setdefault(g, [])
            cfg[key][g] += [m for m in members if m not in cfg[key][g]]
    cfg["systemic"].update(ov.get("systemic", {}))
    cfg.setdefault("country_params", {}).update(ov.get("country_params", {}))
    return cfg


def to_json(v):
    a = np.asarray(v, dtype=float)
    if a.ndim == 0:
        return float(a)
    return np.round(a, 6).tolist()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tempest", default=str(ROOT.parent / "TEMPEST"), help="path to a TEMPEST checkout")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--paths", type=int, default=10000, help="paths for the reference run")
    ap.add_argument("--cache", default=str(ROOT / "pipeline" / "data_cache"))
    a = ap.parse_args()

    tdir = pathlib.Path(a.tempest).resolve()
    sys.path.insert(0, str(tdir))
    from tempest import analytics as A
    from tempest import data as D
    from tempest.calibrate import build, load_config
    from tempest.core import Override, Scenario
    from tempest.scenarios import LIBRARY

    ov = yaml.safe_load((ROOT / "pipeline" / "orbis_overlay.yaml").read_text())
    D.ISO2.update(ov.get("iso2", {}))
    cfg = merge_overlay(load_config(str(tdir / "config" / "model.yaml")), ov)
    cs = cfg["countries"]
    N = len(cs)

    t0 = time.time()
    data = D.load_public_data(cs, D.Cache(a.cache, offline=a.offline))
    print(f"data: {time.time() - t0:.1f}s, flags: {data.get('_data_flags')}")

    # ---- central calibration: no per-path parameter or nowcast noise (the browser draws its own) ----
    quiet = copy.deepcopy(cfg)
    quiet["parameter_uncertainty"] = {}
    quiet["simulation"]["initial_state_sd"] = {}
    model, P, X0, links, shocks, prov = build(quiet, data, M=1)
    model.validate(list(X0))

    params = {k: to_json(np.asarray(v)[0] if np.ndim(v) == 2 else v) for k, v in P.items()}
    x0 = {}
    for k, v in X0.items():
        v = np.asarray(v, dtype=float)
        if k == "lnY_hist":
            x0[k] = to_json(v[0])            # (4, N)
        elif v.shape[1] == 1:
            x0[k] = float(v[0, 0])           # global variable
        else:
            x0[k] = to_json(v[0])
    lk = {"W_tr": to_json(links.W_tr), "W_fin": to_json(links.W_fin), "w_ppp": to_json(links.w_ppp),
          "w_sys": to_json(links.w_sys),
          "unions": {n: {"idx": [int(i) for i in u["idx"]], "w": to_json(u["w"])} for n, u in links.unions.items()}}

    # ---- full-uncertainty model for the IMF-consistent oil sensitivity and the reference statistics ----
    M = a.paths
    model, P, X0, links, shocks, _ = build(cfg, data, M)
    seed = cfg["simulation"]["seed"]
    H = cfg["simulation"]["horizon"]
    RHO = cfg["global"]["rho_og"]

    def add_path(D_, start, h):
        p = np.full(h, np.nan)
        prev = 0.0
        for k, d in enumerate(D_):
            p[start - 1 + k] = d - RHO * prev
            prev = d
        return p

    def oil_effect(a9, h=8):
        base = model.simulate(P, X0, h, shocks, links, scenario=Scenario("b", [], {"a9": a9}), seed=seed,
                              record=["lnY"])
        shk = model.simulate(P, X0, h, shocks, links, seed=seed, record=["lnY"],
                             scenario=Scenario("o", [Override("og", add_path([100 * np.log(1.1)] * 4, 1, h), mode="add")],
                                               {"a9": a9}))
        lvl = 100 * A.world(shk["lnY"].astype(float) - base["lnY"].astype(float), links.w_ppp)
        return float(np.median(lvl[1:5].mean(axis=0)))

    lo, hi = 0.01, 0.08
    e_lo, e_hi = oil_effect(lo), oil_effect(hi)
    a9_imf = lo + (-0.15 - e_lo) * (hi - lo) / (e_hi - e_lo)
    print(f"a9: default 0.01 -> {e_lo:.3f}% ; IMF-consistent {a9_imf:.4f}")

    # reference statistics (same seed, common random numbers), for the TypeScript parity test
    labels = A.quarter_labels(cfg["simulation"]["start_quarter"], H)
    rec = ["x", "pi", "i", "s", "d", "kappa", "recap", "sov", "lnY", "S", "G", "og", "default", "ca", "z"]
    ref = {"paths": M, "seed": seed, "horizon": H, "scenarios": {}}
    base = None
    for name, make in LIBRARY.items():
        sc = make(H) if name != "us_higher_for_longer" else make(H, links.idx("USA"))
        t1 = time.time()
        sim = model.simulate(P, X0, H, shocks, links, scenario=sc, seed=seed, record=rec)
        secs = time.time() - t1
        g = A.yoy_growth(sim, X0["lnY_hist"])
        gw = A.world(g, links.w_ppp)
        summ = A.country_summary(sim, g, cs)
        q = lambda arr: np.nanquantile(arr, [0.05, 0.5, 0.95], axis=-1).T.round(4).tolist()
        out = {"seconds": round(secs, 2),
               "world_growth_q05_q50_q95": q(gw),
               "world_infl_median": np.median(A.world(sim["pi"].astype(float), links.w_ppp), axis=1).round(4).tolist(),
               "G_median": np.median(sim["G"][:, :, 0], axis=1).round(4).tolist(),
               "stress_share_mean": A.world(sim["S"].astype(float), links.w_ppp).mean(axis=1).round(4).tolist(),
               "country_summary": summ.to_dict(orient="records")}
        if base is None:
            base = sim
        else:
            lvl = 100 * A.world(sim["lnY"].astype(float) - base["lnY"].astype(float), links.w_ppp)
            out["world_level_effect_q05_q50_q95"] = q(lvl)
        ref["scenarios"][name] = out
        print(f"{name:22s} {secs:5.2f}s  world growth y1 median {np.median(gw[4]):.2f}  5% {np.quantile(gw[4], .05):.2f}")
    ref["guard_share"] = {k: float(v) for k, v in model.guard_share.items()}

    names = {"USA": "United States", "DEU": "Germany", "FRA": "France", "ITA": "Italy", "ESP": "Spain",
             "GBR": "United Kingdom", "JPN": "Japan", "CAN": "Canada", "KOR": "South Korea", "AUS": "Australia",
             "CHN": "China", "IND": "India", "BRA": "Brazil", "MEX": "Mexico", "TUR": "Türkiye",
             "ZAF": "South Africa", "SVK": "Slovakia"}
    groups = {c: g for g, m in cfg["groups"].items() for c in m}
    init_table = [{"iso3": c, "output_gap": x0["x"][k], "inflation": x0["pi"][k], "policy_rate": x0["i"][k],
                   "credit_gdp": x0["b"][k], "credit_gap": x0["c"][k], "dsr": x0["dsr"][k], "house_gap": x0["h"][k],
                   "gov_debt": x0["d"][k], "primary_balance": x0["pb"][k], "current_account": x0["ca"][k],
                   "bank_cet1": x0["kappa"][k], "nfa": x0["n"][k], "trend_growth": params["g_bar"][k],
                   "ppp_weight": lk["w_ppp"][k]} for k, c in enumerate(cs)]
    snap = {
        "meta": {"model": "TEMPEST v0.1.0 + ORBIS overlay", "start_quarter": cfg["simulation"]["start_quarter"],
                 "horizon": H, "exported": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"),
                 "brent_last_quarter_avg": data.get("brent_last_quarter_avg"),
                 "vix_last_month": data.get("vix_last_month")},
        "countries": cs, "names": names, "group": groups,
        "blocks": cfg["blocks"], "bounds": cfg["bounds"],
        "sim": {"seed": seed, "nu_country": cfg["simulation"]["nu_country"], "nu_global": cfg["simulation"]["nu_global"],
                "loadings": cfg["simulation"]["loadings"], "initial_state_sd": cfg["simulation"]["initial_state_sd"]},
        "param_uncertainty": cfg["parameter_uncertainty"],
        "params": params, "x0": x0, "links": lk, "a9_imf": round(a9_imf, 5),
        "init_table": init_table,
        "provenance": json.loads(json.dumps(prov, default=str)),
    }
    (ROOT / "src" / "data").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "data" / "tempest_snapshot.json").write_text(json.dumps(snap, separators=(",", ":")))
    (ROOT / "reference").mkdir(exist_ok=True)
    (ROOT / "reference" / "tempest_reference.json").write_text(json.dumps(ref, indent=1, default=float))
    print(f"wrote snapshot ({N} economies) and reference in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
