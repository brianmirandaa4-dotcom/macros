"""Turn this run's pulls + the published state into the exact work/ inputs the model code reads. No model numbers here.

Functions are called by run.py (and refit.py); each returns a small dict for the run log.
  schedule()        week to model, this week's games, which have kicked off, every kickoff of the season
  completeness()    is every finished game of earlier weeks already in nflverse pbp?
  params_to_work()  copy the live parameters (state/params) into work/
  espn_lines()      DraftKings lines via ESPN -> state/lines/espn_dk_<season>_wkNN.parquet (closing line = last pre-kick pull)
                    and work/espn_dk_prop_lines_<season>.parquet (all weeks)
  an_props()        Action Network 4-market prices -> state/lines/an_props_<season>_wkNN.parquet, work/an_props_wkNN.parquet
                    (stale-price guard: only rows pulled within STALE_MIN minutes are handed to the model), and the
                    ESPN fallback when Action Network is blocked
  injuries()        ESPN injury feed + game-day inactives layered on the official report (nflverse) -> work/injuries.parquet
  weather()         NWS forecast temp / wind into work/games.parquet for not-started open-air games
"""
import os, re, json, glob, shutil, unicodedata
import numpy as np, pandas as pd
from common import (RAW, WORK, SEASON, NY, UTC, STATE_REL, SEED, now_utc, iso, parse_ts, read_json, write_json, log, kick_utc_from_et, AN_TO_NFLVERSE)

PARAM_FILES = ['backtest_props.parquet', 'calibrated_2026.json', 'backtest_priced.json', 'backtest_summary.json', 'backtest_games_summary.json',
               'leakage_check.json', 'live_validation.json']
STALE_MIN = int(os.environ.get('TAIL_STALE_MIN', 90))
SEVERITY = {None: 0, 'Questionable': 1, 'Doubtful': 2, 'Out': 3}
ESPN_STATUS = {'Out': 'Out', 'Injured Reserve': 'Out', 'Suspension': 'Out', 'Inactive': 'Out', 'Physically Unable to Perform': 'Out', 'Doubtful': 'Doubtful',
               'Questionable': 'Questionable', 'Day-To-Day': 'Questionable'}
CORE_TYPE = {'pass_yds': 'core_bet_type_9_passing_yards', 'rush_yds': 'core_bet_type_12_rushing_yards', 'receptions': 'core_bet_type_15_receptions',
             'rec_yds': 'core_bet_type_16_receiving_yards'}
MARKET = {v: k for k, v in CORE_TYPE.items()}


def state_dir(stage_data): return os.path.join(stage_data, STATE_REL)


def schedule(now=None):
    now = now or now_utc()
    g = pd.read_csv(f'{RAW}/games.csv', low_memory=False)
    g = g[(g.season == SEASON) & (g.game_type == 'REG')].copy()
    g['kick'] = [kick_utc_from_et(d, t) for d, t in zip(g.gameday, g.gametime)]
    fut = g[g.kick > now]
    week = int(fut.week.min()) if len(fut) else int(g.week.max())
    wk = g[g.week == week].sort_values('kick')
    games = [dict(game_id=r.game_id, kick_utc=iso(r.kick), home=r.home_team, away=r.away_team, stadium_id=r.stadium_id, roof=None if pd.isna(r.roof) else r.roof,
                  started=bool(r.kick <= now), weekday=r.kick.astimezone(NY).strftime('%a')) for r in wk.itertuples()]
    return dict(week=week, games=games, kickoffs=sorted(iso(k) for k in g.kick if k > now - pd.Timedelta(days=1)),
                season_done=len(fut) == 0)


def completeness(week, now=None):
    """Every game of weeks < week that kicked off more than 6 hours ago must be in the play-by-play."""
    now = now or now_utc()
    g = pd.read_csv(f'{RAW}/games.csv', low_memory=False); g = g[(g.season == SEASON) & (g.game_type == 'REG') & (g.week < week)]
    g = g[[kick_utc_from_et(d, t) < now - pd.Timedelta(hours=6) for d, t in zip(g.gameday, g.gametime)]]
    have = set(pd.read_parquet(f'{RAW}/pbp_{SEASON}.parquet', columns=['game_id']).game_id.unique())
    miss = sorted(set(g.game_id) - have)
    return dict(ok=not miss, missing=miss)


def params_to_work(stage_data):
    src = os.path.join(state_dir(stage_data), 'params')
    if not os.path.exists(os.path.join(src, 'params_meta.json')):
        os.makedirs(src, exist_ok=True)
        for f in PARAM_FILES + ['params_meta.json']: shutil.copy2(os.path.join(SEED, f), os.path.join(src, f))
        log('state: seeded live parameters from model/seed')
    os.makedirs(WORK, exist_ok=True)
    for f in PARAM_FILES: shutil.copy2(os.path.join(src, f), os.path.join(WORK, f))
    return read_json(os.path.join(src, 'params_meta.json'), {})


def _seed_week_files(sd, name, seed_file, prefix):
    """First run: split the seed season file into one state file per week."""
    d = os.path.join(sd, 'lines'); os.makedirs(d, exist_ok=True)
    if glob.glob(os.path.join(d, f'{prefix}_{SEASON}_wk*.parquet')): return
    s = pd.read_parquet(os.path.join(SEED, seed_file))
    if prefix == 'an_props' and 'pulled' not in s: s['pulled'] = '2026-11-06T01:00Z'
    for w, x in s.groupby('week'): x.reset_index(drop=True).to_parquet(os.path.join(d, f'{prefix}_{SEASON}_wk{int(w):02d}.parquet'))
    log(f'state: seeded {prefix} week files from model/seed/{seed_file}')


def _upsert(path, new, key, replace_keys):
    """Rows of `new` replace the rows of the state file whose `key` is in replace_keys (games pulled this run, not started)."""
    old = pd.read_parquet(path) if os.path.exists(path) else new.iloc[0:0]
    keep = old[~old[key].astype(str).isin({str(k) for k in replace_keys})]
    out = pd.concat([keep, new[new[key].astype(str).isin({str(k) for k in replace_keys})]], ignore_index=True)
    out.to_parquet(path); return out


def espn_lines(stage_data, week, espn_dir, sched):
    sd = state_dir(stage_data); _seed_week_files(sd, 'espn', 'espn_dk_prop_lines_2026.parquet', 'espn_dk')
    path = os.path.join(sd, 'lines', f'espn_dk_{SEASON}_wk{week:02d}.parquet'); info = dict(source='espn', status='no pull')
    dk = read_json(os.path.join(espn_dir, 'dk_lines.json')); sb = read_json(os.path.join(espn_dir, 'scoreboard.json'))
    if dk and sb:
        kick = {e['eid']: e['kick_utc'] for e in sb['events']}; pre = {e['eid'] for e in sb['events'] if e['state'] == 'pre' and parse_ts(e['kick_utc']) > now_utc()}
        rows = [r for r in dk['rows'] if r[0] in pre]
        new = pd.DataFrame([dict(eid=str(r[0]), espn_id=str(r[1]), market=r[2], line_close=float(r[3]), line_open=None if r[4] is None else float(r[4]),
                                 updated=(parse_ts(r[5]).strftime('%Y-%m-%dT%H:%MZ') if r[5] else dk['ts'][:16] + 'Z'), season=SEASON, week=week,
                                 date=parse_ts(kick[r[0]]).strftime('%Y-%m-%dT%H:%MZ')) for r in rows])
        if len(new):
            for c in ('eid', 'espn_id', 'market', 'updated', 'date'): new[c] = new[c].astype('string')
            new = new.drop_duplicates(['eid', 'espn_id', 'market'], keep='last')
            _upsert(path, new, 'eid', set(dk.get('events') or new.eid.unique()) & pre)
            info = dict(source='espn', status=f'ok {len(new)} lines', events=len(set(new.eid)))
    allw = [pd.read_parquet(f) for f in sorted(glob.glob(os.path.join(sd, 'lines', f'espn_dk_{SEASON}_wk*.parquet')))]
    L = pd.concat(allw, ignore_index=True); L.to_parquet(f'{WORK}/espn_dk_prop_lines_{SEASON}.parquet')
    info['week_rows'] = int((L.week == week).sum()); return info


def nm(x): return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', str(x)).encode('ascii', 'ignore').decode().lower()).replace(' jr', '').replace(' iii', '').replace(' ii', '').strip()


def parse_props(d):
    """Action Network 4-market pull -> the an_props parquet layout (verified byte-for-byte against work/an_props_2026.parquet)."""
    X = pd.DataFrame(d['rows'], columns=d['cols'])
    X = X[X.alt == 0] if 'alt' in X else X
    tm = d.get('teams') or {}
    X['team'] = X.team_id.map(lambda t: None if pd.isna(t) else AN_TO_NFLVERSE.get(tm.get(str(int(t))), tm.get(str(int(t)))))
    X['market'] = X.type.map(MARKET)
    X['odds'] = pd.to_numeric(X.odds, errors='coerce').fillna(0)              # pick'em books (PrizePicks) post a line with odds 0/null
    for c in ('team_id', 'tix', 'money', 'value'): X[c] = X[c].astype(float)
    for c in ('week', 'an_gid', 'book_id', 'player_id', 'odds', 'alt'): X[c] = X[c].astype('int64')
    for c in ('type', 'start', 'player', 'pos', 'side', 'team', 'market'): X[c] = X[c].astype('string')
    return X.reset_index(drop=True)


def an_props(stage_data, week, an_dir, espn_dir, sched, now=None):
    now = now or now_utc(); sd = state_dir(stage_data); _seed_week_files(sd, 'an', 'an_props_2026.parquet', 'an_props')
    path = os.path.join(sd, 'lines', f'an_props_{SEASON}_wk{week:02d}.parquet')
    st = read_json(os.path.join(an_dir, 'an_status.json'), {}) or {}
    files = sorted(glob.glob(os.path.join(an_dir, f'an_nfl_wk{week:02d}_props_*.json')))
    info = dict(an_status=st.get('props', 'not pulled'))
    started = {g['game_id'] for g in sched['games'] if g['started']}
    if files and str(st.get('props', '')).startswith('ok'):
        d = read_json(files[-1]); X = parse_props(d); X['pulled'] = pd.Series([d['pulled'][:16] + 'Z'] * len(X), dtype='string')
        X = X[pd.to_datetime(X.start, utc=True) > pd.Timestamp(now)]                       # never price a game that has kicked off
        _upsert(path, X, 'an_gid', set(X.an_gid.unique()))
        info.update(source='action_network', rows=len(X))
    W = pd.read_parquet(path) if os.path.exists(path) else None
    fresh = None
    if W is not None and len(W):
        age = (pd.Timestamp(now) - pd.to_datetime(W.pulled, utc=True)).dt.total_seconds() / 60
        fresh = W[(age <= STALE_MIN) & (pd.to_datetime(W.start, utc=True) > pd.Timestamp(now))]
        if len(fresh) and info.get('source') != 'action_network':
            info.update(source='action_network_earlier_pull', oldest_min=round(float(age[fresh.index].max()), 1))
        if len(fresh) < len(W[pd.to_datetime(W.start, utc=True) > pd.Timestamp(now)]):
            info['stale_dropped'] = int(len(W[pd.to_datetime(W.start, utc=True) > pd.Timestamp(now)]) - len(fresh))
    if (fresh is None or not len(fresh)) and info.get('source') != 'action_network':
        fb = espn_fallback(week, espn_dir)
        if fb is not None and len(fb): fresh = fb; info.update(source='espn_draftkings_fallback', rows=len(fb))
        else: info.setdefault('source', 'none')
    (fresh if fresh is not None else pd.DataFrame(columns=['market', 'player', 'team', 'book_id', 'side', 'value', 'odds'])).reset_index(drop=True).to_parquet(f'{WORK}/an_props_wk{week:02d}.parquet')
    # season file for the priced backtest (refit): every captured week
    allw = sorted(glob.glob(os.path.join(sd, 'lines', f'an_props_{SEASON}_wk*.parquet')))
    pd.concat([pd.read_parquet(f) for f in allw], ignore_index=True).to_parquet(f'{WORK}/an_props_{SEASON}.parquet')
    info['priced_rows'] = 0 if fresh is None else int(len(fresh)); return info


def espn_fallback(week, espn_dir):
    """DraftKings prices from ESPN propBets in the Action Network layout (book 68), only where both sides are priced."""
    dk = read_json(os.path.join(espn_dir, 'dk_lines.json')); sb = read_json(os.path.join(espn_dir, 'scoreboard.json'))
    if not dk or not sb: return None
    R = pd.read_parquet(f'{RAW}/roster_{SEASON}.parquet', columns=['gsis_id', 'espn_id', 'full_name', 'team', 'position', 'week'])
    R = R[R.espn_id.notna()].sort_values('week').groupby('espn_id').last(); R.index = R.index.astype(str).str.replace(r'\.0$', '', regex=True)
    start = {e['eid']: e['kick_utc'] for e in sb['events'] if e['state'] == 'pre'}
    rows = []
    for eid, aid, mk, line, _, _, ov, un in dk['rows']:
        if mk not in CORE_TYPE or ov is None or un is None or eid not in start or str(aid) not in R.index: continue
        p = R.loc[str(aid)]
        for side, odds in (('over', ov), ('under', un)):
            rows.append(dict(week=week, type=CORE_TYPE[mk], an_gid=0, start=start[eid], book_id=68, player_id=0, player=p.full_name, pos=p.position, team_id=np.nan,
                             side=side, value=float(line), odds=int(odds), alt=0, tix=0.0, money=0.0, team=p.team, market=mk, pulled=dk['ts'][:16] + 'Z'))
    return pd.DataFrame(rows) if rows else None


def injuries(week, espn_dir, sched):
    """Official report (nflverse, already in work/injuries.parquet) + ESPN, more severe status wins, for teams in not-started games."""
    I = pd.read_parquet(f'{WORK}/injuries.parquet')
    teams = {t for g in sched['games'] if not g['started'] for t in (g['home'], g['away'])}
    R = pd.read_parquet(f'{RAW}/roster_{SEASON}.parquet', columns=['gsis_id', 'espn_id', 'full_name', 'team', 'position', 'week'])
    R = R[R.espn_id.notna() & R.gsis_id.notna()].sort_values('week').groupby('espn_id').last(); R.index = R.index.astype(str).str.replace(r'\.0$', '', regex=True)
    esp = {}
    overlay = os.environ.get('TAIL_INJURY_OVERLAY', '1') != '0'          # 0 = official report only (reproduces the manual v4.1 runs)
    inj = read_json(os.path.join(espn_dir, 'injuries.json')) if overlay else None
    for r in ((inj or {}).get('nfl') or {}).get('rows', []):
        s = ESPN_STATUS.get(r[4])
        if r[0] and s: esp[str(r[0])] = (s, f'ESPN injuries: {r[4]}')
    summ = read_json(os.path.join(espn_dir, 'summaries.json')) if overlay else None
    for g in ((summ or {}).get('games') or {}).values():
        for aid, name, team, status in g.get('statuses', []):
            s = ESPN_STATUS.get(status)
            if aid and s and SEVERITY[s] >= SEVERITY.get((esp.get(str(aid)) or (None,))[0], 0): esp[str(aid)] = (s, f'ESPN game page: {status}')
    cur = I[(I.season == SEASON) & (I.week == week)]
    off = {r.pid: (None if pd.isna(r.report_status) else r.report_status) for r in cur.itertuples()}
    changes, add = [], []
    for aid, (s, why) in esp.items():
        if aid not in R.index: continue
        p = R.loc[aid]
        if p.team not in teams: continue
        o = off.get(p.gsis_id)
        if SEVERITY[s] > SEVERITY.get(o, 0):
            add.append(dict(season=SEASON, week=week, team=p.team, pid=p.gsis_id, position=p.position, full_name=p.full_name, report_status=s, practice_status=None))
            changes.append(dict(pid=p.gsis_id, name=p.full_name, team=p.team, official=o, model_status=s, why=why))
    if add:
        A = pd.DataFrame(add)
        I = pd.concat([I[~((I.season == SEASON) & (I.week == week) & I.pid.isin(set(A.pid)))], A[list(I.columns)]], ignore_index=True)
        I.to_parquet(f'{WORK}/injuries.parquet')
    final = {r.pid: r.report_status for r in I[(I.season == SEASON) & (I.week == week)].itertuples() if r.team in teams and isinstance(r.report_status, str)}
    names = dict(zip(R.gsis_id, R.full_name))
    return dict(espn_rows=len(esp), raised=changes, status={pid: [s, names.get(pid)] for pid, s in final.items()})


def weather(week, nws_file, sched):
    if os.environ.get('TAIL_WEATHER', '1') == '0': return dict(status='disabled (TAIL_WEATHER=0)')
    w = (read_json(nws_file, {}) or {}).get('games', {})
    G = pd.read_parquet(f'{WORK}/games.parquet'); used = {}
    for g in sched['games']:
        f = w.get(g['game_id'])
        if g['started'] or not f or f.get('status') != 'ok': continue
        m = (G.game_id == g['game_id']) & G.roof.isin(['outdoors', 'open'])
        if not m.any(): continue
        if G.loc[m, 'temp'].isna().all() and f.get('temp_f') is not None: G.loc[m, 'temp'] = f['temp_f']
        if G.loc[m, 'wind'].isna().all() and f.get('wind_mph') is not None: G.loc[m, 'wind'] = f['wind_mph']
        used[g['game_id']] = dict(temp_f=f.get('temp_f'), wind_mph=f.get('wind_mph'), short=f.get('short'), pop=f.get('pop'))
    if used: G.to_parquet(f'{WORK}/games.parquet')
    return dict(status=f'{len(used)} games use the NWS forecast', games=used, other={k: v.get('status') for k, v in w.items() if k not in used})
