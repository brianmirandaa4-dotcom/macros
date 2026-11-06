"""Download nflverse release files into model/nfl/raw with the local names the model code reads.

    python3 model/auto/fetch_nflverse.py [--first 2018] [--season 2026]

Source: github.com/nflverse/nflverse-data releases only (pbp, snap_counts, injuries, weekly_rosters, schedules).
Past seasons are downloaded once (the workflow keeps them in actions/cache); the current season and games.csv every run.
Every file is schema-checked before it replaces the cached copy; a file that fails (missing columns, fewer rows than the
copy it would replace, unreadable) is rejected and the last good copy stays. Writes raw/nflverse_manifest.json:
  {"files": {name: {"sha", "rows", "max_week", "source", "status"}}, "changed": [...], "failed": [...], "complete": bool}
"""
import argparse, os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW, SEASON, http_download, sha, log, write_json, read_json

BASE = 'https://github.com/nflverse/nflverse-data/releases/download'
NEED = {
    'pbp': ['game_id', 'season', 'week', 'season_type', 'posteam', 'defteam', 'home_team', 'away_team', 'play_type', 'yards_gained', 'yardline_100', 'down',
            'qb_dropback', 'qb_scramble', 'sack', 'pass_attempt', 'rush_attempt', 'complete_pass', 'air_yards', 'epa', 'xpass', 'pass_oe', 'wp',
            'passer_player_id', 'receiver_player_id', 'rusher_player_id', 'two_point_attempt', 'touchdown', 'pass_touchdown', 'rush_touchdown', 'td_player_id',
            'game_seconds_remaining', 'qtr', 'score_differential', 'posteam_score', 'defteam_score', 'play_id', 'total_home_score', 'total_away_score'],
    'snaps': ['game_id', 'pfr_player_id', 'offense_pct', 'offense_snaps', 'team', 'game_type', 'week'],
    'inj': ['season', 'week', 'team', 'gsis_id', 'position', 'full_name', 'report_status', 'practice_status', 'game_type'],
    'roster': ['season', 'team', 'position', 'depth_chart_position', 'jersey_number', 'status', 'full_name', 'birth_date', 'height', 'weight', 'college', 'gsis_id',
               'espn_id', 'pfr_id', 'years_exp', 'week', 'game_type', 'status_description_abbr', 'rookie_year', 'draft_club', 'draft_number'],
    'games': ['game_id', 'season', 'game_type', 'week', 'gameday', 'weekday', 'gametime', 'away_team', 'away_score', 'home_team', 'home_score', 'roof', 'temp', 'wind',
              'spread_line', 'total_line', 'away_moneyline', 'home_moneyline', 'away_spread_odds', 'home_spread_odds', 'over_odds', 'under_odds', 'home_rest',
              'away_rest', 'home_qb_id', 'away_qb_id', 'home_qb_name', 'away_qb_name', 'div_game', 'stadium_id', 'stadium'],
}


def plan(first, season):
    out = []
    for y in range(first, season + 1):
        out += [(f'pbp_{y}.parquet', f'{BASE}/pbp/play_by_play_{y}.parquet', 'pbp', y),
                (f'snaps_{y}.parquet', f'{BASE}/snap_counts/snap_counts_{y}.parquet', 'snaps', y),
                (f'inj_{y}.parquet', f'{BASE}/injuries/injuries_{y}.parquet', 'inj', y),
                (f'roster_{y}.parquet', f'{BASE}/weekly_rosters/roster_weekly_{y}.parquet', 'roster', y)]
    out.append(('games.csv', f'{BASE}/schedules/games.csv', 'games', season))
    return out


def check(path, kind, year):
    """Schema check; returns (rows, max_week). Raises ValueError on any problem."""
    import pandas as pd
    if kind == 'games':
        d = pd.read_csv(path, low_memory=False)
    else:
        import pyarrow.parquet as pq
        cols = pq.read_schema(path).names
        miss = [c for c in NEED[kind] if c not in cols]
        if miss: raise ValueError(f'missing columns {miss[:6]}')
        d = pd.read_parquet(path, columns=[c for c in ('season', 'week') if c in cols])
    if kind == 'games':
        miss = [c for c in NEED['games'] if c not in d.columns]
        if miss: raise ValueError(f'missing columns {miss[:6]}')
        if not (d.season == year).any(): raise ValueError(f'no {year} games in schedule')
    if len(d) == 0: raise ValueError('empty file')
    wk = int(d.week.max()) if 'week' in d and d.week.notna().any() else None
    return len(d), wk


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--first', type=int, default=2018); ap.add_argument('--season', type=int, default=SEASON)
    a = ap.parse_args(); os.makedirs(RAW, exist_ok=True)
    old = (read_json(os.path.join(RAW, 'nflverse_manifest.json'), {}) or {}).get('files', {})
    man, changed, failed = {}, [], []
    for name, url, kind, y in plan(a.first, a.season):
        dest = os.path.join(RAW, name); current = (y == a.season) or kind == 'games'
        if os.path.exists(dest) and not current:
            man[name] = old.get(name) or dict(sha=sha(dest), source=url, status='cached'); man[name]['status'] = 'cached'; continue
        tmp = dest + '.new'
        try:
            http_download(url, tmp)
            rows, wk = check(tmp, kind, y)
            prev = old.get(name)
            if os.path.exists(dest) and prev and prev.get('rows') and rows < prev['rows'] * 0.98:
                raise ValueError(f'{rows} rows < {prev["rows"]} in the copy it would replace (shrunk release, rejected)')
            h = sha(tmp)
            if not (prev and prev.get('sha') == h and os.path.exists(dest)): changed.append(name)
            os.replace(tmp, dest); man[name] = dict(sha=h, rows=rows, max_week=wk, source=url, status='updated' if name in changed else 'same')
        except Exception as e:                                       # noqa: BLE001 - any failure keeps the last good copy
            if os.path.exists(tmp): os.remove(tmp)
            failed.append(f'{name}: {e}')
            man[name] = dict(old.get(name) or {}, status='kept last good' if os.path.exists(dest) else 'MISSING', error=str(e)[:200])
            log('nflverse FAILED', name, e)
    complete = all(os.path.exists(os.path.join(RAW, n)) for n, *_ in plan(a.first, a.season))
    write_json(os.path.join(RAW, 'nflverse_manifest.json'), dict(files=man, changed=changed, failed=failed, complete=complete))
    log(f'nflverse: {len(changed)} changed, {len(failed)} failed, complete={complete}', changed[:8])
    sys.exit(0 if complete else 2)


if __name__ == '__main__':
    main()
