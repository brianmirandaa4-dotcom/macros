#!/usr/bin/env python3
"""Static NFL player library for the Overlay app.

Reads local nflverse-derived files only and writes:
  /home/claude/wmtl/data/nflp/index.json
  /home/claude/wmtl/data/nflp/teams.json
  /home/claude/wmtl/data/nflp/p/<pid>.json

Deterministic: data/nflp is deleted and rebuilt on every run; output depends only on
the inputs (plus the "updated" timestamp in index.json).
"""
import json
import math
import shutil
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

SEASON = 2026
LAST10_SEASONS = (SEASON, SEASON - 1)  # "last10" spans 2026 then 2025
TODAY = date(2026, 11, 5)
NFL = Path("/home/claude/nfl")
OUT = Path("/home/claude/wmtl/data/nflp")

KEEP_STATUS = {"ACT", "RES", "INA", "DEV"}
STATUS_RANK = {"ACT": 0, "INA": 1, "RES": 2, "DEV": 3}
POS_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K", "P", "LS"]
POS_RANK = {p: i for i, p in enumerate(POS_ORDER)}

TEAM_NAMES = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs", "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers",
    "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks", "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}

# output key -> player_games column
STAT_COLS = {
    "tgt": "targets", "rec": "receptions", "rec_yds": "rec_yds", "rec_td": "rec_td",
    "car": "carries", "rush_yds": "rush_yds", "rush_td": "rush_td",
    "att": "pass_att", "cmp": "completions", "pass_yds": "pass_yds",
    "pass_td": "pass_td", "sacks": "sacks",
}
STAT_KEYS = list(STAT_COLS)

# keys always kept (even when zero) per position
POS_KEEP = {
    "QB": ["att", "cmp", "pass_yds", "pass_td", "sacks", "car", "rush_yds", "rush_td"],
    "RB": ["car", "rush_yds", "rush_td", "tgt", "rec", "rec_yds", "rec_td"],
    "WR": ["tgt", "rec", "rec_yds", "rec_td"],
    "TE": ["tgt", "rec", "rec_yds", "rec_td"],
}
# split keys per position (others: whatever is nonzero)
SPLIT_KEYS = {
    "QB": ["att", "cmp", "pass_yds", "pass_td", "car", "rush_yds"],
    "RB": ["car", "rush_yds", "rush_td", "tgt", "rec", "rec_yds"],
    "WR": ["tgt", "rec", "rec_yds", "rec_td"],
    "TE": ["tgt", "rec", "rec_yds", "rec_td"],
}

RES_LABEL = {
    "R01": "Injured reserve", "R48": "Injured reserve (designated to return)",
    "R04": "Physically unable to perform", "R05": "Non-football injury",
    "R27": "Non-football injury", "R40": "Non-football illness",
}


# ---------- helpers ----------
def clean(v):
    """NaN/None -> None; numpy scalars -> python; whole floats -> int."""
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def num(v):
    v = clean(v)
    return 0 if v is None else v


def status_label(status, abbr):
    abbr = abbr or ""
    if status == "ACT":
        return "Active"
    if status == "INA":
        return "Inactive"
    if status == "DEV":
        if abbr == "P02":
            return "Practice squad (injured)"
        if abbr == "P03":
            return "Practice squad (international)"
        return "Practice squad"
    if status == "RES":
        return RES_LABEL.get(abbr, "Reserve")
    return {"CUT": "Released", "RET": "Retired", "EXE": "Exempt", "TRD": "Traded",
            "TRC": "Traded", "TRT": "Traded"}.get(status, status)


def height_ft(h):
    if h is None:
        return None
    h = int(round(h))
    return f"{h // 12}'{h % 12}\""


def age_years(bd):
    if not bd:
        return None
    try:
        d = pd.Timestamp(bd).date()
    except (ValueError, TypeError):
        return None
    return round((TODAY - d).days / 365.25, 1)


def stat_dict(src, pos, keep_extra=()):
    """Build an ordered stat dict, dropping zero keys not relevant to the position."""
    keep = set(POS_KEEP.get(pos, [])) | set(keep_extra)
    out = {}
    for k in STAT_KEYS:
        v = num(src.get(k))
        if v != 0 or k in keep:
            out[k] = v
    return out


def avg(rows, keys):
    n = len(rows)
    if n == 0:
        return None
    out = {"g": n}
    for k in keys:
        out[k] = round(sum(num(r.get(k)) for r in rows) / n, 1)
    return out


def game_entry(g, gmap, pos):
    """One game-log entry (wk/date/opp/ha/res/snap + position-relevant stats)."""
    gi = gmap.get(g.game_id, {})
    home = g.team == g.home_team
    opp = g.away_team if home else g.home_team
    hs, as_ = clean(gi.get("home_score")), clean(gi.get("away_score"))
    res = None
    if hs is not None and as_ is not None:
        us, them = (hs, as_) if home else (as_, hs)
        res = f"{'W' if us > them else 'L' if us < them else 'T'} {us}-{them}"
    snap = clean(g.offense_pct)
    stats = {k: num(g[k]) for k in STAT_KEYS}
    e = {"wk": int(g.week), "date": clean(g.gameday) or clean(gi.get("gameday")),
         "opp": opp, "ha": "vs" if home else "@", "res": res,
         "snap": None if snap is None else int(round(snap * 100))}
    e.update(stat_dict(stats, pos))
    return e, stats


def wjson(path, obj, compact=True):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        else:
            json.dump(obj, f, ensure_ascii=False)


# ---------- load ----------
def load():
    ro = pd.read_parquet(NFL / "raw/roster_2026.parquet")
    ro = ro[ro.gsis_id.notna()].copy()
    pg = pd.read_parquet(NFL / "work/player_games.parquet")
    pg = pg[pg.pid.notna()].copy()
    games = pd.read_parquet(NFL / "work/games.parquet")
    inj = pd.read_parquet(NFL / "work/injuries.parquet")
    return ro, pg, games, inj


def main():
    ro, pg, games, inj = load()

    # latest roster row per player (ties broken deterministically)
    ro = ro.sort_values(["gsis_id", "week", "team", "status"], kind="mergesort")
    latest = ro.groupby("gsis_id", sort=False).tail(1).set_index("gsis_id")
    team_last_wk = ro.groupby("team").week.max()
    on_current = latest.week.values == latest.team.map(team_last_wk).values
    roster_ids = set(latest.index[on_current & latest.status.isin(KEEP_STATUS).values])

    pg26 = pg[pg.season == SEASON]
    game_ids = set(pg26.pid.unique())
    all_ids = sorted(roster_ids | game_ids)

    # games / results lookup
    gmap = games.set_index("game_id")[["home_score", "away_score", "home_team", "away_team",
                                       "gameday"]].to_dict("index")

    # injuries: latest 2026 entry per player
    inj26 = inj[(inj.season == SEASON) & inj.pid.notna()].copy()
    inj26["_o"] = range(len(inj26))
    inj26 = inj26.sort_values(["pid", "week", "_o"], kind="mergesort").groupby("pid").tail(1)
    inj_map = inj26.set_index("pid")[["week", "report_status", "practice_status"]].to_dict("index")

    # per-game stat rows, renamed
    pg = pg.sort_values(["pid", "season", "week", "game_id"], kind="mergesort")
    for k, c in STAT_COLS.items():
        pg[k] = pg[c].fillna(0)
    pg_by = {pid: df for pid, df in pg[pg.pid.isin(all_ids)].groupby("pid", sort=False)}

    # most recent player_games info (fallback for players without a roster row)
    pg_last = pg.groupby("pid").tail(1).set_index("pid")

    # usage for depth ordering: sum of 2026 offense_pct
    usage = pg26.groupby("pid").offense_pct.sum().to_dict()

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "p").mkdir(parents=True)

    players = []
    for pid in all_ids:
        if pid in latest.index:
            r = latest.loc[pid]
            name = clean(r.full_name)
            team = clean(r.team)
            pos = clean(r.position)
            depth = clean(r.depth_chart_position)
            jersey = clean(r.jersey_number)
            status = clean(r.status)
            abbr = clean(r.status_description_abbr)
            h = clean(r.height)
            wt = clean(r.weight)
            bd = clean(r.birth_date)
            college = clean(r.college)
            exp = clean(r.years_exp)
            rookie = clean(r.rookie_year)
            dclub, dpick = clean(r.draft_club), clean(r.draft_number)
        else:
            r = pg_last.loc[pid]
            name, team, pos = clean(r["name"]), clean(r.team), clean(r.pos)
            depth = pos
            jersey = status = abbr = h = wt = college = exp = None
            bd = clean(r.birth_date)
            rookie = clean(r.rookie_year)
            dclub = dpick = None
        bd = str(bd)[:10] if bd else None

        df = pg_by.get(pid)
        log, last10, career, season_tot, splits = [], [], [], None, None
        if df is not None:
            # career (newest first)
            for season, sdf in sorted(df.groupby("season"), key=lambda x: -x[0]):
                teams_s = list(dict.fromkeys(sdf.team.tolist()))
                sums = {k: num(sdf[k].sum()) for k in STAT_KEYS}
                row = {"season": int(season), "team": "/".join(teams_s), "g": int(len(sdf))}
                row.update(stat_dict(sums, pos))
                career.append(row)

            d26 = df[df.season == SEASON]
            raw_rows = []
            for _, g in d26.iterrows():
                e, stats = game_entry(g, gmap, pos)
                raw_rows.append(stats)
                log.append(e)
            log.reverse()  # newest first

            # last 10 regular-season games across LAST10_SEASONS, newest first
            dl = df[df.season.isin(LAST10_SEASONS)].tail(10)
            for _, g in dl.iloc[::-1].iterrows():
                e, _ = game_entry(g, gmap, pos)
                last10.append({"season": int(g.season), **e})

            if raw_rows:
                tot = {k: num(sum(r_[k] for r_ in raw_rows)) for k in STAT_KEYS}
                season_tot = {"g": len(raw_rows)}
                season_tot.update(stat_dict(tot, pos))
                if pos in SPLIT_KEYS:
                    skeys = SPLIT_KEYS[pos]
                else:
                    skeys = [k for k in STAT_KEYS if tot[k] != 0]
                splits = {"l3": avg(raw_rows[-3:], skeys), "l5": avg(raw_rows[-5:], skeys),
                          "season": avg(raw_rows, skeys)}

        ij = inj_map.get(pid)
        injury = None
        if ij is not None:
            injury = {"week": clean(ij["week"]), "status": clean(ij["report_status"]),
                      "practice": clean(ij["practice_status"])}

        rec = {
            "pid": pid, "name": name, "team": team, "pos": pos, "depth": depth,
            "jersey": jersey, "status": status, "status_label": status_label(status, abbr) if status else None,
            "height": h, "height_ft": height_ft(h), "weight": wt, "age": age_years(bd),
            "birth_date": bd, "college": college, "exp": exp, "rookie_year": rookie,
            "draft": {"club": dclub, "pick": dpick} if dclub else None,
            "injury": injury,
            "season": {str(SEASON): season_tot} if season_tot else {},
            "career": career, "log": log, "last10": last10, "splits": splits,
        }
        wjson(OUT / "p" / f"{pid}.json", rec)

        players.append({
            "pid": pid, "name": name, "team": team, "pos": pos, "jersey": jersey,
            "status": status, "depth": depth or "",
            "in_team": pid in roster_ids,
            "k": (team or "ZZZ", POS_RANK.get(pos, 99), STATUS_RANK.get(status, 9),
                  -round(usage.get(pid, 0.0), 4), -(exp or 0), depth or "", name or "", pid),
        })

    players.sort(key=lambda p: p["k"])
    index = {
        "season": SEASON,
        "updated": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "players": [[p["pid"], p["name"], p["team"], p["pos"], p["jersey"], p["status"]]
                    for p in players],
    }
    wjson(OUT / "index.json", index)

    teams = {}
    for t in sorted(TEAM_NAMES):
        teams[t] = {"name": TEAM_NAMES[t],
                    "roster": [p["pid"] for p in players if p["team"] == t and p["in_team"]]}
    wjson(OUT / "teams.json", teams)

    files = list((OUT / "p").glob("*.json"))
    total = sum(f.stat().st_size for f in OUT.rglob("*.json"))
    print(f"players in index: {len(index['players'])} "
          f"(roster {len(roster_ids)}, with 2026 games {len(game_ids)}, "
          f"games-only {len(game_ids - roster_ids)})")
    print(f"player files: {len(files)}  total size: {total/1e6:.2f} MB")


if __name__ == "__main__":
    main()
