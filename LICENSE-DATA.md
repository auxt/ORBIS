# Data licence

The source code in this repository is released under the MIT licence (see `LICENSE`).

These data files are derived from share-alike sources (through POLIS) and are shared under the
**Creative Commons Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0)**,
<https://creativecommons.org/licenses/by-sa/4.0/>:

- `src/data/polis_snapshot.json`: POLIS Layer 1 scores (computed from V-Dem v16, CC BY-SA 4.0, with
  World Bank, IMF, UCDP/PRIO, Powell and Thyne, and CHES data), Layer 2 country cards and a pool of
  Layer 3 Monte Carlo paths computed from the POLIS country state vectors (assembled from parliaments,
  election commissions, poll aggregators, news reports and Wikipedia poll tables, CC BY-SA 4.0).
- `docs/index.html`, which embeds that file.

`src/data/tempest_snapshot.json` holds TEMPEST's calibrated starting state: values derived from BIS,
IMF (WEO, IMTS, FSI, IIP) and FRED series, used under their providers' terms. Raw downloads are not
redistributed; `pipeline/export_tempest.py` retrieves them from each provider.

`src/data/hexworld.json` is derived from Natural Earth (public domain) via world-atlas. Oil production
shares are from the Energy Institute Statistical Review of World Energy 2025 (2024 data).
