"""whomadethisline · build the app's data folder.

What it does (nothing here re-models anything; it only reshapes and grades what the model already published):
  1. Converts each published slate (schema wmtl.slate.v1) into wmtl.slate.v2 (adds player keys, tiers, betting windows).
  2. Builds one player file per sport (wmtl.players.v1): every game in the history files, plus every time the model graded him.
  3. Grades a past slate against the real box scores when they exist: each prop on the side the model showed, and every game line.
  4. Writes data/index.json, the list the app reads first.

Usage:
  python3 -I tools/build_data.py <src_dir> <raw_dir> <out_data_dir>
src_dir holds the published slate JSON (nfl_slate-data.json, nfl_results-data.json, nba_slate-data.json, cfb7_/cfb8_slate-data.json)
raw_dir holds the history files: nflverse stats_player_week_{2025,2026}.csv, nfldata games.csv,
        sportsdataverse ESPN NBA player_box_{2026,2027}.parquet, cfbfastR play_by_play_2026.parquet
"""
import json, sys, os, re, math, unicodedata
from datetime import datetime, timezone, timedelta
import pandas as pd, numpy as np

SRC, RAW, OUT = sys.argv[1:4]
ET = timezone(timedelta(hours=-5))  # standard time after Nov 1, 2026
def et(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ET if ts >= '2026-11-01T06' else timezone(timedelta(hours=-4)))
def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[\.'’`]", '', s); s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', s); return re.sub(r'[^a-z0-9]+', ' ', s).strip()
def fnum(x, d=2):
    try:
        x = float(x); return None if not math.isfinite(x) else round(x, d)
    except Exception: return None
def am2p(o): o = float(o); return 100 / (o + 100) if o > 0 else -o / (-o + 100)
def dec(o): o = float(o); return 1 + o / 100 if o > 0 else 1 + 100 / (-o)
TIER = {'recommended': 'bet', 'watch': 'live', 'lean': 'lean', 'check_news': 'check', 'pass': 'pass'}
os.makedirs(OUT, exist_ok=True)

# ------------------------------------------------------------------ history: NFL
nw = pd.concat([pd.read_csv(f'{RAW}/nfl_week_{y}.csv', low_memory=False) for y in (2025, 2026)])
nw = nw[nw.season_type == 'REG'].copy()
ng = pd.read_csv(f'{RAW}/nfl_games.csv'); ng = ng[ng.season.isin([2025, 2026])]
gd = {(r.season, r.week, t): (r.gameday, r.home_team == t, r.home_score if r.home_team == t else r.away_score, r.away_score if r.home_team == t else r.home_score) for r in ng.itertuples() for t in (r.home_team, r.away_team)}
def nfl_row(r):
    g = gd.get((r.season, r.week, r.team), (None, None, None, None))
    v = lambda c: fnum(getattr(r, c), 0) or 0
    st = dict(cmp=v('completions'), att=v('attempts'), pass_yds=v('passing_yards'), pass_td=v('passing_tds'), int=v('passing_interceptions'),
              car=v('carries'), rush_yds=v('rushing_yards'), rush_td=v('rushing_tds'), tgt=v('targets'), rec=v('receptions'), rec_yds=v('receiving_yards'), rec_td=v('receiving_tds'),
              fgm=v('fg_made'), fga=v('fg_att'), xpm=v('pat_made'), tkl=v('def_tackles_solo') + v('def_tackle_assists'))
    st['atd'] = st['rush_td'] + st['rec_td']; st['kick_pts'] = 3 * st['fgm'] + st['xpm']
    res = None if g[2] is None or pd.isna(g[2]) else ('W' if g[2] > g[3] else 'L' if g[2] < g[3] else 'T') + f' {int(g[2])}–{int(g[3])}'
    return dict(d=g[0], s=int(r.season), wk=int(r.week), tm=r.team, opp=r.opponent_team, ha='vs' if g[1] else '@', res=res, st=st)
NFL_H = {}
for r in nw.sort_values(['season', 'week']).itertuples():
    NFL_H.setdefault(r.player_id, dict(name=r.player_display_name, pos=r.position, team=r.team, games=[]))['games'].append(nfl_row(r))
    NFL_H[r.player_id]['team'] = r.team; NFL_H[r.player_id]['pos'] = r.position
NFL_BYNAME = {}
for pid, h in NFL_H.items(): NFL_BYNAME.setdefault((norm(h['name']), h['team']), pid); NFL_BYNAME.setdefault((norm(h['name']), None), pid)

# ------------------------------------------------------------------ history: NBA (ESPN box scores)
nb = pd.concat([pd.read_parquet(f'{RAW}/nba_{y}.parquet') for y in (2026, 2027)])
ESPN2 = {'GS': 'GSW', 'NY': 'NYK', 'SA': 'SAS', 'NO': 'NOP', 'UTAH': 'UTA', 'WSH': 'WAS'}
nb['tm'] = nb.team_abbreviation.map(lambda x: ESPN2.get(x, x)); nb['opp'] = nb.opponent_team_abbreviation.map(lambda x: ESPN2.get(x, x))
nb['d'] = nb.game_date.astype(str)
NBA_COL = {}
NBA_H = {}
for r in nb.sort_values('game_date_time').itertuples():
    k = norm(r.athlete_display_name)
    h = NBA_H.setdefault(k, dict(name=r.athlete_display_name, pos=r.athlete_position_abbreviation, team=r.tm, games=[]))
    NBA_COL[r.tm] = r.team_color
    if r.did_not_play or not (r.minutes and r.minutes > 0):
        h['games'].append(dict(d=r.d, tm=r.tm, opp=r.opp, ha='vs' if r.home_away == 'home' else '@', res=None, dnp=True, why=r.reason if isinstance(r.reason, str) else None, st=None, post=int(r.season_type) == 3)); continue
    v = lambda c: fnum(getattr(r, c), 0) or 0
    st = dict(min=v('minutes'), pts=v('points'), reb=v('rebounds'), ast=v('assists'), tpm=v('three_point_field_goals_made'), stl=v('steals'), blk=v('blocks'), tov=v('turnovers'),
              fgm=v('field_goals_made'), fga=v('field_goals_attempted'))
    st.update(pra=st['pts'] + st['reb'] + st['ast'], pr=st['pts'] + st['reb'], pa=st['pts'] + st['ast'], ra=st['reb'] + st['ast'])
    res = ('W' if r.team_winner else 'L') + f' {int(r.team_score)}–{int(r.opponent_team_score)}'
    h['games'].append(dict(d=r.d, tm=r.tm, opp=r.opp, ha='vs' if r.home_away == 'home' else '@', res=res, st=st, start=bool(r.starter), post=int(r.season_type) == 3))
    h['team'] = r.tm; h['pos'] = r.athlete_position_abbreviation

# ------------------------------------------------------------------ history: CFB (box scores built from 2026 play-by-play)
cols = ['game_id', 'week', 'start_date', 'pos_team', 'def_pos_team', 'home', 'away', 'rush', 'rush_player', 'rush_yds', 'completion', 'pass_attempt', 'reception_player', 'reception_yds',
        'completion_player', 'completion_yds', 'touchdown_player', 'rush_td', 'pass_td', 'play_type', 'pos_team_score', 'def_pos_team_score', 'team_score', 'opponent_score']
cp = pd.read_parquet(f'{RAW}/cfb_pbp_2026.parquet', columns=cols)
fin = {}
for gid, g in cp.groupby('game_id'):
    last = g.iloc[-1]; h, a = last.home, last.away
    sc = {}
    for r in g[['pos_team', 'def_pos_team', 'pos_team_score', 'def_pos_team_score']].itertuples(index=False):
        sc[r.pos_team] = max(sc.get(r.pos_team, 0), r.pos_team_score or 0); sc[r.def_pos_team] = max(sc.get(r.def_pos_team, 0), r.def_pos_team_score or 0)
    fin[gid] = dict(home=h, away=a, hs=int(sc.get(h, 0)), as_=int(sc.get(a, 0)), wk=int(last.week), d=str(last.start_date)[:10])
CF = {}
def cadd(gid, name, team, k, v):
    if not isinstance(name, str) or not name.strip() or name.strip().upper() == 'TEAM': return
    rec = CF.setdefault((norm(name), team), dict(name=name.strip(), team=team, g={}))
    gg = rec['g'].setdefault(gid, dict(pass_yds=0, cmp=0, att=0, rush_yds=0, car=0, rec=0, rec_yds=0, rush_td=0, rec_td=0, pass_td=0)); gg[k] += v
R = cp[cp.rush == 1]
for r in R[['game_id', 'rush_player', 'pos_team', 'rush_yds', 'rush_td']].itertuples(index=False):
    cadd(r.game_id, r.rush_player, r.pos_team, 'rush_yds', r.rush_yds or 0); cadd(r.game_id, r.rush_player, r.pos_team, 'car', 1)
    if r.rush_td == 1: cadd(r.game_id, r.rush_player, r.pos_team, 'rush_td', 1)
C = cp[cp.completion == 1]
for r in C[['game_id', 'reception_player', 'completion_player', 'pos_team', 'reception_yds', 'completion_yds', 'pass_td']].itertuples(index=False):
    cadd(r.game_id, r.reception_player, r.pos_team, 'rec', 1); cadd(r.game_id, r.reception_player, r.pos_team, 'rec_yds', r.reception_yds or 0)
    cadd(r.game_id, r.completion_player, r.pos_team, 'pass_yds', r.completion_yds or 0); cadd(r.game_id, r.completion_player, r.pos_team, 'cmp', 1)
    if r.pass_td == 1: cadd(r.game_id, r.reception_player, r.pos_team, 'rec_td', 1); cadd(r.game_id, r.completion_player, r.pos_team, 'pass_td', 1)
CFB_H = {}
for (k, team), rec in CF.items():
    games = []
    for gid, st in sorted(rec['g'].items(), key=lambda x: fin[x[0]]['d']):
        f = fin[gid]; home = f['home'] == team; opp = f['away'] if home else f['home']
        mine, theirs = (f['hs'], f['as_']) if home else (f['as_'], f['hs'])
        st = {a: int(b) for a, b in st.items()}; st['atd'] = st['rush_td'] + st['rec_td']
        games.append(dict(d=f['d'], wk=f['wk'], tm=team, opp=opp, ha='vs' if home else '@', res=('W' if mine > theirs else 'L' if mine < theirs else 'T') + f' {mine}–{theirs}', st=st, gid=str(gid)))
    CFB_H[(k, team)] = dict(name=rec['name'], team=team, pos=None, games=games)

# ------------------------------------------------------------------ slates v1 -> v2
def window(sport, g):
    if sport != 'NFL': return g['slate']
    t = et(g['kick_utc']); wd = t.strftime('%a')
    if wd == 'Thu': return 'TNF'
    if wd == 'Mon': return 'MNF'
    if wd == 'Sun' and t.hour >= 19: return 'SNF'
    if wd == 'Sat': return 'Sat'
    return '1 PM' if t.hour < 15 else '4 PM'
def pid_of(sport, p, gmap):
    parts = p['id'].split('-'); g = gmap[p['gid']]
    if sport == 'NFL':
        gs = '-'.join(parts[1:-1]) if len(parts) >= 4 else None
        if gs in NFL_H: return 'nfl:' + gs
        k = NFL_BYNAME.get((norm(p['player']), p['team'])) or NFL_BYNAME.get((norm(p['player']), None))
        return 'nfl:' + k if k else 'nfl:x:' + norm(p['player'])
    if sport == 'NBA': return 'nba:' + norm(p['player'])
    team_full = next((t['model_name'] for t in (g['away'], g['home']) if t['abbr'] == p['team'] or t['model_name'] == p['team']), p['team'])
    return 'cfb:' + norm(p['player']) + ':' + norm(team_full)

STAT = {'rec_yds': 'rec_yds', 'receptions': 'rec', 'rec': 'rec', 'rush_yds': 'rush_yds', 'qb_rush': 'rush_yds', 'pass_yds': 'pass_yds', 'atd': 'atd', 'qb_atd': 'atd', 'kicker': 'kick_pts', 'kick': 'kick_pts',
        'pts': 'pts', 'reb': 'reb', 'ast': 'ast', 'tpm': 'tpm', 'pra': 'pra', 'pr': 'pr', 'pa': 'pa', 'ra': 'ra', 'stl': 'stl', 'blk': 'blk', 'tov': 'tov'}

def hist_for(sport, key):
    if sport == 'NFL':
        return NFL_H.get(key[4:]) if not key.startswith('nfl:x:') else None
    if sport == 'NBA': return NBA_H.get(key[4:])
    _, n, t = key.split(':', 2)
    for (k, team), h in CFB_H.items():
        if k == n and norm(team) == t: return h
    return None

def game_on(sport, h, g, meta):
    """The player's game for this slate's matchup, or None."""
    if not h: return None
    if sport == 'NFL':
        wk = meta.get('week'); teams = {g['away']['model_name'], g['home']['model_name']}
        return next((x for x in h['games'] if x['s'] == 2026 and x['wk'] == wk and x['tm'] in teams), None)
    if sport == 'NBA':
        d = et(g['kick_utc']).strftime('%Y-%m-%d'); teams = {g['away']['abbr'], g['home']['abbr']}
        return next((x for x in h['games'] if x['d'] == d and x['tm'] in teams), None)
    wk = meta.get('week'); teams = {norm(g['away']['model_name']), norm(g['home']['model_name'])}
    return next((x for x in h['games'] if x['wk'] == wk and norm(x['tm']) in teams), None)

def final_for(sport, g, meta):
    if sport == 'NFL':
        r = ng[(ng.season == 2026) & (ng.week == meta['week']) & (ng.home_team == g['home']['model_name']) & (ng.away_team == g['away']['model_name'])]
        if len(r) and pd.notna(r.iloc[0].home_score): return dict(away=int(r.iloc[0].away_score), home=int(r.iloc[0].home_score))
        return None
    if sport == 'NBA':
        d = et(g['kick_utc']).strftime('%Y-%m-%d')
        r = nb[(nb.d == d) & (nb.tm == g['home']['abbr']) & (nb.opp == g['away']['abbr'])]
        if len(r): return dict(away=int(r.iloc[0].opponent_team_score), home=int(r.iloc[0].team_score))
        return None
    for gid, f in fin.items():
        if f['wk'] == meta['week'] and norm(f['home']) == norm(g['home']['model_name']) and norm(f['away']) == norm(g['away']['model_name']):
            return dict(away=f['as_'], home=f['hs'])
    return None

def grade_side(side, line, actual, market):
    if actual is None: return None
    if market in ('atd', 'qb_atd'): return 'won' if actual >= 1 else 'lost'
    if line is None: return None
    if actual == line: return 'push'
    return 'won' if (actual > line) == (side == 'over') else 'lost'

def grade_lines(g, fsc):
    if not fsc: return None
    L = g.get('lines') or {}; out = {}; a, h = fsc['away'], fsc['home']; margin_home = h - a
    s = L.get('spread')
    if s and s.get('line') is not None:
        side_home = s['side'] == g['home']['abbr']; m = margin_home if side_home else -margin_home; v = m + s['line']
        out['spread'] = 'push' if v == 0 else 'won' if v > 0 else 'lost'
    t = L.get('total')
    if t and t.get('line') is not None:
        tot = a + h; out['total'] = 'push' if tot == t['line'] else 'won' if (tot > t['line']) == (str(t['side']).lower() == 'over') else 'lost'
    ml = L.get('moneyline')
    if ml:
        side_home = ml['side'] == g['home']['abbr']; out['moneyline'] = 'push' if a == h else 'won' if (h > a) == side_home else 'lost'
    return out

APPEAR = {}  # pkey -> list of model appearances
def bins(cal, edges=(0, .3, .4, .45, .5, .55, .6, .65, .7, .8, 1.01)):
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        xs = [c for c in cal if a <= c[0] < b]
        if xs: out.append(dict(lo=a, hi=min(b, 1), n=len(xs), pred=round(sum(c[0] for c in xs) / len(xs), 4), hit=round(sum(c[1] for c in xs) / len(xs), 4)))
    return out

def convert(sport, src, sid, label):
    d = json.load(open(src)); assert d['schema'] == 'wmtl.slate.v1'
    meta = d['meta']; gmap = {g['id']: g for g in d['games']}
    order = []
    for g in sorted(d['games'], key=lambda g: g['kick_utc']):
        g['window'] = window(sport, g)
        if g['window'] not in order: order.append(g['window'])
    graded = 0; gradable = 0; res_props = {}
    for p in d['props']:
        g = gmap[p['gid']]; p['pkey'] = pid_of(sport, p, gmap); p['tier'] = TIER.get(p['classification'], 'pass'); p['window'] = g['window']
        h = hist_for(sport, p['pkey']); x = game_on(sport, h, g, meta)
        if p.get('odds') is not None: gradable += 1
        stat = STAT.get(p['market'])
        if x is not None and stat:
            if x.get('dnp') or x.get('st') is None: res_props[p['id']] = dict(actual=None, result='void', note='did not play')
            else:
                act = x['st'].get(stat); r = grade_side(p['side'], p.get('line'), act, p['market']) if p.get('odds') is not None else None
                res_props[p['id']] = dict(actual=act, result=r); graded += (r is not None)
        rr = res_props.get(p['id'], {})
        APPEAR.setdefault(p['pkey'], []).append(dict(slate=sid, sport=sport, date=meta.get('date'), label=label, market=p['market'], market_label=p['market_label'], side=p['side'], line=p.get('line'),
            odds=p.get('odds'), proj=p.get('projection'), score25=p.get('score25'), tier=p['tier'], p=p.get('p'), actual=rr.get('actual'), result=rr.get('result'), id=p['id']))
    res_games = {}
    for g in d['games']:
        fsc = final_for(sport, g, meta)
        if fsc: res_games[g['id']] = dict(final=fsc, lines=grade_lines(g, fsc))
    # summary
    def tally(rows, stake=lambda p: 1.0):
        w = l = pu = 0; pl = 0.0; risk = 0.0
        for p in rows:
            r = res_props.get(p['id'], {}).get('result')
            if r == 'won': w += 1; pl += stake(p) * (dec(p['odds']) - 1); risk += stake(p)
            elif r == 'lost': l += 1; pl -= stake(p); risk += stake(p)
            elif r == 'push': pu += 1
        return dict(w=w, l=l, p=pu, units=round(pl, 2), risked=round(risk, 2), roi=round(pl / risk, 4) if risk else None)
    priced = [p for p in d['props'] if p.get('odds') is not None]
    by_tier = {t: tally([p for p in priced if p['tier'] == t]) for t in ('bet', 'live', 'lean', 'check', 'pass')}
    by_mk = {}
    for mk in sorted(set(p['market'] for p in priced)):
        by_mk[mk] = dict(label=next(p['market_label'] for p in priced if p['market'] == mk), **tally([p for p in priced if p['market'] == mk]))
    calib = []
    for p in priced:
        r = res_props.get(p['id'], {}).get('result')
        if r in ('won', 'lost') and p.get('p') is not None: calib.append([round(p['p'], 3), 1 if r == 'won' else 0])
    lines = {'won': 0, 'lost': 0, 'push': 0}
    for v in res_games.values():
        for k, r in (v['lines'] or {}).items(): lines[r] += 1
    status = 'graded' if (graded or res_games) else 'pending'
    d['results'] = dict(status=status, source={'NFL': 'nflverse weekly player stats + nfldata final scores', 'NBA': 'ESPN box scores (sportsdataverse)', 'CFB': 'cfbfastR play-by-play (box scores rebuilt from plays)'}[sport],
        graded_utc=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), props=res_props, games=res_games,
        summary=dict(priced=len(priced), graded=sum(1 for p in priced if res_props.get(p['id'], {}).get('result') in ('won', 'lost', 'push')),
                     bets=by_tier['bet'], by_tier=by_tier, by_market=by_mk, lines=lines, calibration=calib),
        note='Every priced prop is graded on the side the model showed. Leans and passes are graded for the record only; they were never recommended.')
    if not d.get('parlays'): d['parlays'] = dict(status='not_exported', items=[], note='This model run did not export parlay combinations, so none are shown. The app never builds parlays on its own.')
    d['schema'] = 'wmtl.slate.v2'; d['id'] = sid; d['sport'] = sport
    meta['windows'] = order; meta['label'] = label
    os.makedirs(f'{OUT}/{sport.lower()}', exist_ok=True)
    path = f'{sport.lower()}/{sid.split("-", 1)[1]}.json'
    json.dump(d, open(f'{OUT}/{path}', 'w'), separators=(',', ':'), ensure_ascii=False)
    ks = sorted(g['kick_utc'] for g in d['games'])
    return dict(id=sid, sport=sport, path='data/' + path, label=label, date=meta.get('date'), date_label=meta.get('date_label'), week=meta.get('week'),
                start_utc=ks[0], end_utc=ks[-1], n_games=len(d['games']), n_props=len(d['props']), priced=len(priced),
                bets=sum(1 for p in d['props'] if p['tier'] == 'bet'), watch=sum(1 for p in d['props'] if p['tier'] == 'live'), leans=sum(1 for p in d['props'] if p['tier'] == 'lean'),
                model_version=meta.get('model_version'), generated_et=meta.get('generated_et'), prices_et=meta.get('prices_et'),
                results=dict(status=status, graded=d['results']['summary']['graded'], bets=by_tier['bet'], by_tier=by_tier, by_market=by_mk, lines=lines, calib_bins=bins(calib)))

slates = [
    convert('NFL', f'{SRC}/nfl_slate-data.json', 'nfl-2026-wk08', 'Week 8'),
    convert('NBA', f'{SRC}/nba_slate-data.json', 'nba-2026-11-02', 'Mon Nov 2'),
    convert('CFB', f'{SRC}/cfb8_slate-data.json', 'cfb-2026-wk08', 'Week 8 Saturday'),
    convert('CFB', f'{SRC}/cfb7_slate-data.json', 'cfb-2026-wk07', 'Week 7 Saturday'),
]

# ------------------------------------------------------------------ NFL season results (weeks 1-7 as published) -> results file; add every graded row to player history
R1 = json.load(open(f'{SRC}/nfl_results-data.json'))
for w in R1['detail']:
    for kind in ('bets', 'leans'):
        for r in w.get(kind) or []:
            k = NFL_BYNAME.get((norm(r['player']), r['team'])) or NFL_BYNAME.get((norm(r['player']), None))
            key = 'nfl:' + k if k else 'nfl:x:' + norm(r['player'])
            m = re.match(r'(Over|Under|Yes)\s*([\d.]+)?', r.get('sel') or '')
            APPEAR.setdefault(key, []).append(dict(slate=f'nfl-2026-wk{w["week"]:02d}', sport='NFL', date=None, label=f'Week {w["week"]}' + (' (replay)' if w.get('kind') == 'replay' else ''),
                market=r.get('mk'), market_label=r.get('market'), side=(m.group(1).lower() if m else None), line=fnum(m.group(2), 1) if m and m.group(2) else None, odds=r.get('odds'),
                proj=None, score25=r.get('score25'), tier='bet' if kind == 'bets' else 'lean', p=r.get('p'), actual=r.get('actual'), result=r.get('result'), id=None))
R1['schema'] = 'wmtl.results.v2'; R1['sport'] = 'NFL'
json.dump(R1, open(f'{OUT}/nfl/results-2026.json', 'w'), separators=(',', ':'))

# ------------------------------------------------------------------ player files
TEAMC = json.load(open(f'{SRC}/teamc.json'))
def mkprof(sport, key, h, fallback_name, team):
    games = h['games'] if h else []
    ap = sorted(APPEAR.get(key, []), key=lambda a: (a['date'] or '', a['slate']), reverse=True)
    col = None
    if sport == 'NFL': col = (TEAMC['NFL'].get(h['team'] if h else team) or [None])[0]
    elif sport == 'NBA': col = (TEAMC['NBA'].get(h['team'] if h else team) or [None])[0] or NBA_COL.get(team)
    g2 = [{k: v for k, v in g.items() if v is not None and k not in ('gid',)} for g in games]
    return dict(name=h['name'] if h else fallback_name, team=(h['team'] if h else team), pos=(h or {}).get('pos'), color=col, games=g2, model=ap,
                history='found' if h else 'not_found')
for sport in ('NFL', 'NBA', 'CFB'):
    P = {}
    for s in [x for x in slates if x['sport'] == sport]:
        d = json.load(open(f'{OUT}/{s["path"][5:]}'))
        for p in d['props']:
            if p['pkey'] in P: continue
            P[p['pkey']] = mkprof(sport, p['pkey'], hist_for(sport, p['pkey']), p['player'], p['team'])
    if sport == 'NFL':
        for key in APPEAR:
            if key.startswith('nfl:') and key not in P: P[key] = mkprof('NFL', key, hist_for('NFL', key), APPEAR[key][0].get('label'), None)
    stats = {'NFL': [['pass_yds', 'Pass yds'], ['pass_td', 'Pass TD'], ['cmp', 'Cmp'], ['att', 'Att'], ['int', 'INT'], ['car', 'Car'], ['rush_yds', 'Rush yds'], ['rush_td', 'Rush TD'], ['tgt', 'Tgt'], ['rec', 'Rec'], ['rec_yds', 'Rec yds'], ['rec_td', 'Rec TD'], ['fgm', 'FGM'], ['xpm', 'XPM'], ['kick_pts', 'Kick pts'], ['tkl', 'Tkl']],
             'NBA': [['min', 'Min'], ['pts', 'Pts'], ['reb', 'Reb'], ['ast', 'Ast'], ['tpm', '3PM'], ['stl', 'Stl'], ['blk', 'Blk'], ['tov', 'TO'], ['pra', 'PRA']],
             'CFB': [['pass_yds', 'Pass yds'], ['pass_td', 'Pass TD'], ['cmp', 'Cmp'], ['car', 'Car'], ['rush_yds', 'Rush yds'], ['rush_td', 'Rush TD'], ['rec', 'Rec'], ['rec_yds', 'Rec yds'], ['rec_td', 'Rec TD']]}[sport]
    src = {'NFL': 'nflverse weekly stats, 2025–26 regular season', 'NBA': 'ESPN box scores via sportsdataverse, 2025–26 season and playoffs plus 2026–27 to date', 'CFB': 'Box scores rebuilt from cfbfastR 2026 play-by-play. Plays without a player tag are missing, so a few totals can run low.'}[sport]
    out = dict(schema='wmtl.players.v1', sport=sport, source=src, built_utc=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), stats=stats, market_stat=STAT, players=P)
    os.makedirs(f'{OUT}/players', exist_ok=True)
    json.dump(out, open(f'{OUT}/players/{sport.lower()}.json', 'w'), separators=(',', ':'), ensure_ascii=False)
    print(sport, 'players', len(P), 'with history', sum(1 for v in P.values() if v['history'] == 'found'))

# ------------------------------------------------------------------ upcoming NFL games (schedule only, no picks)
up = ng[(ng.season == 2026) & ng.home_score.isna()].sort_values(['week', 'gameday'])
nxt = None
if len(up):
    wk = int(up.iloc[0].week); u = up[up.week == wk]
    nxt = dict(sport='NFL', label=f'Week {wk}', first=datetime.fromisoformat(f'{u.sort_values(["gameday","gametime"]).iloc[0].gameday}T{u.sort_values(["gameday","gametime"]).iloc[0].gametime}').replace(tzinfo=ET).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:00Z'), games=int(len(u)),
               note='On the schedule. The model has not been run for this week yet, so there are no picks.')
index = dict(schema='wmtl.index.v1', built_utc=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), brand='whomadethisline', slates=slates,
             players={s: f'data/players/{s.lower()}.json' for s in ('NFL', 'NBA', 'CFB')}, results={'NFL': 'data/nfl/results-2026.json'},
             sports=dict(NFL=dict(status='live'), CFB=dict(status='live'), NBA=dict(status='live'),
                         MLB=dict(status='offseason', note='One board exists (NLCS Game 3, Oct 14) as a PDF only. It was never exported as data, so it is not in the app. The season is over.'),
                         NHL=dict(status='not_built', note='No NHL model exists yet. Nothing here is a pick.')),
             upcoming=[nxt] if nxt else [])
json.dump(index, open(f'{OUT}/index.json', 'w'), indent=1, ensure_ascii=False)
for s in slates: print(s['id'], s['n_props'], 'priced', s['priced'], 'bets', s['bets'], 'results', s['results'])
