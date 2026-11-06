"""Build an offline replay of one run from stored pulls, in the exact layouts the fetchers write (for run.py --offline).

    python3 -I make_fixtures.py --raw-src /home/claude/nfl/raw --espn-src /home/claude/raw/espn --lines /home/claude/nfl/work/espn_dk_prop_lines_2026.parquet \
        --out <nfl_home>/raw --week 9 --now 2026-11-06T01:05:00Z [--pulled 2026-11-06T01:00:55Z]

* nflverse files: symlinked from --raw-src (read only)
* Action Network: the stored week-N pulls (4-market props, all props, game odds) rewritten as the fetcher's files
* ESPN: the stored injury feed; a scoreboard rebuilt from the schedule (event ids from the stored DraftKings lines) with
  pre/in states as of --now; DraftKings lines from the stored lines file (no prices, as the stored pull had none)
"""
import argparse, glob, json, os, sys
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import kick_utc_from_et, parse_ts, iso, write_json

ap = argparse.ArgumentParser()
for k in ('raw-src', 'espn-src', 'lines', 'out', 'now'): ap.add_argument('--' + k, required=True)
ap.add_argument('--week', type=int, required=True); ap.add_argument('--pulled')
a = ap.parse_args(); now = parse_ts(a.now); W = a.week
os.makedirs(a.out, exist_ok=True)
for f in os.listdir(a.raw_src):
    p = os.path.join(a.raw_src, f)
    if os.path.isfile(p) and not os.path.exists(os.path.join(a.out, f)): os.symlink(p, os.path.join(a.out, f))
an, es = os.path.join(a.out, 'an'), os.path.join(a.out, 'espn')
for d in (an, es): os.makedirs(d, exist_ok=True); [os.remove(x) for x in glob.glob(f'{d}/*.json')]
# ---- Action Network
P = json.load(open(glob.glob(f'{a.raw_src}/an/an_nfl_props_wk01-09_*.json')[0]))
pulled = a.pulled or P['pulled']; ts = parse_ts(pulled).strftime('%Y-%m-%dT%H%MZ')
rows = [r for r in P['rows'] if r[0] == W]
write_json(f'{an}/an_nfl_wk{W:02d}_props_{ts}.json', dict(pulled=pulled, source='fixture: ' + P['source'], cols=P['cols'], rows=rows, teams=P['teams'], log=[]), compact=True)
A = json.load(open(glob.glob(f'{a.raw_src}/an/an_nfl_wk{W:02d}_allprops_*.json')[0])); A['pulled'] = pulled
write_json(f'{an}/an_nfl_wk{W:02d}_allprops_{ts}.json', A, compact=True)
O = json.load(open(glob.glob(f'{a.raw_src}/an/an_nfl_wk{W:02d}_odds_*.json')[0])); O['pulled'] = pulled
write_json(f'{an}/an_nfl_wk{W:02d}_odds_{ts}.json', O, compact=True)
write_json(f'{an}/an_status.json', dict(props=f'ok {len(rows)} rows (fixture)', allprops='ok (fixture)', odds='ok (fixture)', pulled=pulled))
# ---- ESPN
inj = json.load(open(f'{a.espn_src}/injuries.json')); write_json(f'{es}/injuries.json', dict(nfl=inj['nfl']))
G = pd.read_csv(f'{a.raw_src}/games.csv', low_memory=False); G = G[(G.season == 2026) & (G.week == W) & (G.game_type == 'REG')]
L = pd.read_parquet(a.lines); L = L[L.week == W]
R = pd.read_parquet(f'{a.raw_src}/roster_2026.parquet', columns=['espn_id', 'team', 'week']); R = R[R.espn_id.notna()].sort_values('week').groupby('espn_id').team.last()
R.index = R.index.astype(str).str.replace(r'\.0$', '', regex=True)
ev = []
for eid, x in L.groupby('eid'):
    tm = x.espn_id.map(R).value_counts()
    g = G[G.home_team.isin(tm.index[:2]) & G.away_team.isin(tm.index[:2])]
    if len(g) != 1: continue
    g = g.iloc[0]; k = kick_utc_from_et(g.gameday, g.gametime)
    ev.append(dict(eid=str(eid), kick_utc=iso(k), week=W, home=g.home_team, away=g.away_team, state='pre' if k > now else 'in', completed=False, odds=[]))
write_json(f'{es}/scoreboard.json', dict(ts=iso(now), week=W, events=ev))
dk = [[r.eid, r.espn_id, r.market, r.line_close, None if pd.isna(r.line_open) else r.line_open, r.updated, None, None] for r in L.itertuples()]
write_json(f'{es}/dk_lines.json', dict(ts=iso(now), provider=['fixture'], rows=dk, events=sorted({e['eid'] for e in ev if e['state'] == 'pre'})))
write_json(f'{es}/status.json', dict(scoreboard=f'ok {len(ev)} events (fixture)', injuries='ok (fixture)', dk_lines=f'ok {len(dk)} rows (fixture)', summaries='skipped (fixture)'))
print('fixtures:', len(rows), 'AN rows,', len(ev), 'events,', len(dk), 'DK lines; pulled', pulled)
