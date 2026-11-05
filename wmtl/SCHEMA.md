# whomadethisline data schema

The app renders only what is in `/data`. It never invents a pick, a line, a stat or an injury. Any field that is missing shows **Not available**.

## Files

| Path | Schema | What it is |
|---|---|---|
| `data/index.json` | `wmtl.index.v1` | The list of every slate, read first. It also holds the per-slate result summaries that the Results screen uses. |
| `data/{sport}/{date-or-week}.json` | `wmtl.slate.v2` | One slate: games, props, live plans, parlays and results. |
| `data/players/{sport}.json` | `wmtl.players.v1` | Every player on any slate, with his game log and every look the model gave him. |
| `data/nfl/results-2026.json` | `wmtl.results.v2` | The NFL season track record as published (weeks 1–7). |

Adding a slate means adding one JSON file and one row in `index.json`, which `tools/add_slate.py` does for you. No UI code changes.

## `wmtl.slate.v2`

v2 is v1 (what `code/web/export_wmtl.py` already writes) plus a few fields. **The app also accepts v1 directly**, through Import, and upgrades it in memory.

```
{
  "schema": "wmtl.slate.v2", "id": "nfl-2026-wk08", "sport": "NFL",
  "meta": {
    "label": "Week 8", "date": "2026-11-01", "date_label": "Sun Nov 1 – Mon Nov 2", "week": 8,
    "model_version": "v2.3", "generated_et": "...", "prices_et": "...", "injuries_et": "...",
    "books": [...], "opener_book": "...", "sims_per_game": 10000, "factors_per_prop": 25,
    "calibration": {"K": 1.156, "W_Y": 0.05, "W_TD": 0.4},
    "windows": ["1 PM", "4 PM", "SNF", "MNF"],          // v2: betting windows in time order
    "rules": [...], "staking": "...", "ranking": "...",
    "funnel": [{"step": "Priced props", "n": 44, "note": "..."}, ...],   // the reason when no bet passes
    "factors": {"<prop>": {"label", "n", "first_season", "oos_rho" | "r2_oos",
                            "rows": [{"id", "family": "A..E", "name", "how", "plain", "share", "dir"}]}},
    "cards":   {"<prop>": {"ids": [25], "names": [25], "how": [25], "w": [25 tuned weights], "p77", "p27", "n", "first"}},
    "histogram_note": "...", "track": [...]
  },
  "games": [{
    "id", "sport", "kick_utc", "kick_et", "slate", "window",        // v2: window (NFL: 1 PM / 4 PM / SNF / MNF / TNF)
    "away": {"abbr", "name", "model_name"}, "home": {...},
    "sim": {"n": 10000, "away", "home", "home_win", "margin_hist": [...], "margin_hist_range": [-35, 35]},
    "market": {"spread_home", "total", "home_win_novig", "open_spread_home", "open_total"},
    "model": {"margin_home", "total"},
    "lines": {"spread" | "total" | "moneyline": {"side", "line", "odds", "book", "p", "edge_pts", "rank"}},
    "counts": {...}, "funnel": {...}
  }],
  "props": [{
    "id", "gid", "pkey",                                            // v2: pkey links to data/players
    "player", "team", "opp", "market", "market_label",
    "side": "over" | "under" | "yes", "line", "odds", "book",       // best price for the model side
    "best": {"book", "line", "over", "under"}, "offers": [{"book", "line", "over", "under"}],
    "opener": {"line", "over", "under"} | null,
    "classification": "recommended" | "watch" | "lean" | "check_news" | "pass",
    "tier": "bet" | "live" | "lean" | "check" | "pass",              // v2
    "window",                                                       // v2
    "projection", "range80": [lo, hi], "p", "p_raw", "break_even", "edge_pts", "ev_per_unit", "units",
    "score25", "pctile", "families": {"A".."E"},
    "helping": [{"id", "name", "how", "v"}], "hurting": [...],      // top factors up / down
    "q25": [[id, x, contribution] x 25], "q25_key",                 // every question for this player
    "availability": {"p_play", "report"}, "lights": {"card", "card_kind", "proj", "edge", "play", "gap", "gap_pct"},
    "hist": {"lo", "step", "counts": [...], "n": 10000, "clipped_at"},   // raw replay distribution
    "live": null | {"plan": "BUY LOW" | "SELL HIGH", "q1_trigger", "ht_trigger", "open", "number", "cashed",
                    "cps": [{"cp": "End of Q1" | "Halftime", "trig": "≤36",
                             "rows": [{"scen": "Down 7+", "freq", "n", "lad": [[line, p_cash, u@-105, u@-115, u@-125, u@-140, (p_other)]]}]}]}
  }],
  "parlays": {"status": "ok" | "not_exported", "note",
              "items": [{"legs": [{"player", "sel", "side", "line", "main_line", "book", "odds"}], "odds", "p_joint", "break_even", "edge_pts"}]},
  "results": {"status": "graded" | "pending", "source", "graded_utc",
              "props": {"<prop id>": {"actual", "result": "won" | "lost" | "push" | "void"}},
              "games": {"<game id>": {"final": {"away", "home"}, "lines": {"spread", "total", "moneyline"}}},
              "summary": {"priced", "graded", "bets", "by_tier", "by_market", "lines", "calibration": [[p, 0|1]]}}
}
```

### Rules the app enforces from this data

- **Card screen:** only `tier == "bet"` props, which passed both keys in the model. With none, it shows "No bets pass the model today" and names the funnel step where the count hit zero. `lean` props appear only in the gray "Information only · not recommended" block, with no pill or color.
- **Props screen:** each prop type's `meta.factors` / `meta.cards` page comes before its board. "Strong" means `lights.card_kind == "strong"`, or 25D above +1.5. For anytime TD and kickers it means the 77th percentile or higher.
- **Live calculator:** reads `live.cps[].rows[].lad` only. It interpolates the chance between ladder lines. It takes the stake from the ladder rung and price bucket at or worse than the live number. It says Not available outside the trigger, outside the ladder, or below 300 replays.
- **Parlays:** shows `parlays.items` only. Any leg that is a bet365 under alted above `main_line` is dropped. The app never builds a parlay itself.
- **bet365:** logging an under at bet365 above the main line shows a warning.

## `wmtl.players.v1`

```
{"schema": "wmtl.players.v1", "sport": "NBA", "source": "...", "stats": [["pts", "Pts"], ...], "market_stat": {"pts": "pts", ...},
 "players": {"<pkey>": {"name", "team", "pos", "color", "history": "found" | "not_found",
   "games": [{"d": "2026-11-02", "s", "wk", "tm", "opp", "ha": "vs" | "@", "res": "W 117–112", "dnp", "post", "st": {"pts": 43, ...}}],
   "model": [{"slate", "label", "market", "market_label", "side", "line", "odds", "proj", "score25", "tier", "p", "actual", "result"}]}}}
```

## Local storage

The key is `wmtl.v1`. It holds bets, settings (unit size, starting bankroll, 3D room on or off) and UI memory. It exports and imports as JSON from Settings or My bets. Imported slates live in IndexedDB (`wmtl` / `slates`) because a slate can be larger than localStorage allows.
