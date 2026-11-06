#!/usr/bin/env python3
"""Defense-vs-position export for the Overlay app.

Writes /home/claude/wmtl/data/nfl/defense_2026.json:
  {"season", "through_week", "teams": {TEAM: {POS: {stat: {"pg","rank","last4","last4_rank"}}, "g": n}},
   "league": {POS: {stat: per-game average}}}

Per-game averages are what each DEFENSE allowed over its 2026 regular-season games played.
rank 1 = allows the MOST (easiest matchup) ... 32 = allows the least (toughest).
"last4" = average over the last 4 games that defense played (trend).

Sources (local, nflverse-derived):
  QB passing  : opponent offense in the same game -- pass_yds from team_games.team_pass_yds,
                att/cmp/pass_td summed from the opponent's player_games rows.
  QB rushing  : opponent pos == 'QB' rows of player_games (rush_yds).
  RB/WR/TE    : def_pos.parquet (team column = the defense).
Team abbreviations are nflverse style (LA, JAX, WAS, LV, LAC).
"""
import json
from pathlib import Path

import pandas as pd

SEASON = 2026
WORK = Path("/home/claude/nfl/work")
OUT = Path("/home/claude/wmtl/data/nfl/defense_2026.json")

# position -> {output stat: source column in the per-defense-game frame}
SPEC = {
    "QB": {"pass_yds": "qb_pass_yds", "pass_td": "qb_pass_td", "cmp": "qb_cmp",
           "att": "qb_att", "rush_yds": "qb_rush_yds"},
    "RB": {"rush_yds": "rush_yds_RB", "carries": "carries_RB", "rec": "receptions_RB",
           "rec_yds": "rec_yds_RB", "tgt": "targets_RB"},
    "WR": {"rec": "receptions_WR", "rec_yds": "rec_yds_WR", "tgt": "targets_WR"},
    "TE": {"rec": "receptions_TE", "rec_yds": "rec_yds_TE", "tgt": "targets_TE"},
}


def build_frame():
    tg = pd.read_parquet(WORK / "team_games.parquet")
    tg = tg[tg.season == SEASON]
    pg = pd.read_parquet(WORK / "player_games.parquet")
    pg = pg[pg.season == SEASON]
    dp = pd.read_parquet(WORK / "def_pos.parquet")
    dp = dp[dp.season == SEASON]

    # offense passing per team-game (player rows), QB rushing per team-game
    off = pg.groupby(["game_id", "team"])[["pass_att", "completions", "pass_td"]].sum()
    qbr = pg[pg.pos == "QB"].groupby(["game_id", "team"]).rush_yds.sum().rename("qb_rush_yds")
    off = tg.set_index(["game_id", "team"])[["team_pass_yds", "week", "gameday"]] \
        .join(off).join(qbr).fillna({"qb_rush_yds": 0}).reset_index()
    off = off.rename(columns={"team": "offense", "team_pass_yds": "qb_pass_yds",
                              "pass_att": "qb_att", "completions": "qb_cmp", "pass_td": "qb_pass_td"})

    # defense = the other team in the same game
    pair = tg[["game_id", "team"]].merge(tg[["game_id", "team"]], on="game_id", suffixes=("", "_opp"))
    pair = pair[pair.team != pair.team_opp]
    d = pair.merge(off, left_on=["game_id", "team_opp"], right_on=["game_id", "offense"])
    pos_cols = sorted({c for s in SPEC.values() for c in s.values() if not c.startswith("qb_")})
    d = d.merge(dp[["game_id", "team"] + pos_cols], on=["game_id", "team"], how="left")
    assert d[pos_cols].notna().all().all(), "def_pos missing rows for some defense-games"
    assert len(d) == len(tg)
    return d.sort_values(["team", "week", "gameday"], kind="mergesort")


def main():
    d = build_frame()
    cols = [c for s in SPEC.values() for c in s.values()]
    season_pg = d.groupby("team")[cols].mean()
    last4_pg = d.groupby("team", group_keys=False).tail(4).groupby("team")[cols].mean()
    games = d.groupby("team").size()
    rk = season_pg.rank(ascending=False, method="min").astype(int)
    rk4 = last4_pg.rank(ascending=False, method="min").astype(int)
    league = d[cols].mean()  # per defense-game average

    r1 = lambda x: round(float(x), 1)
    teams = {}
    for t in sorted(season_pg.index):
        e = {"g": int(games[t])}
        for pos, stats in SPEC.items():
            e[pos] = {s: {"pg": r1(season_pg.at[t, c]), "rank": int(rk.at[t, c]),
                          "last4": r1(last4_pg.at[t, c]), "last4_rank": int(rk4.at[t, c])}
                      for s, c in stats.items()}
        teams[t] = e

    out = {
        "season": SEASON,
        "through_week": int(d.week.max()),
        "rank_note": "rank 1 = allows the most (easiest matchup), 32 = allows the least (toughest)",
        "teams": teams,
        "league": {pos: {s: r1(league[c]) for s, c in stats.items()} for pos, stats in SPEC.items()},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT} ({OUT.stat().st_size/1e3:.1f} KB), {len(teams)} teams, "
          f"through week {out['through_week']}")


if __name__ == "__main__":
    main()
