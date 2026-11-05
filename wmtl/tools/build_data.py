"""whomadethisline · build the app's data folder.

What it does (nothing here re-models anything; it only reshapes and grades what the model already published):
  1. Converts each published slate (schema wmtl.slate.v1) into wmtl.slate.v2 (adds player keys, tiers, betting windows).
  2. Builds one player file per sport (wmtl.players.v1): every game in the history files, plus every time the model graded him.
  3. Grades a past slate against the real box scores when they exist: each prop on the side the model showed, and every game line.
  4. Writes data/index.json, the list the app reads first.

Usage:
  python3 -I tools/build_data.py <src_dir> <raw_dir> <out_data_dir>
src_dir holds the published slate JSON (nfl_slate-data.json, nfl_results-data.json, nba_slate-data.json, cfb7_/cfb8_slate-data.json)
raw_dir/espn holds ESPN box scores (nfl.json, nba.json, cfb.json, upcoming.json), pulled from ESPN's site API
        (scoreboard + game summary) by tools/espn_pull.js run in a browser on espn.com. ESPN is the only stats source.
"""
import json, sys, os, re, math, unicodedata
from datetime import datetime, timezone, timedelta
import pandas as pd, numpy as np

SRC, RAW, OUT = sys.argv[1:4]
ET = timezone(timedelta(hours=-5))  # standard time after Nov 1, 2026
from zoneinfo import ZoneInfo
def et(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(ZoneInfo('America/New_York'))
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

# ------------------------------------------------------------------ history: ESPN box scores, every sport (the only stats source)
# raw_dir/espn/{nfl,nba,cfb}.json come from ESPN's own site API (scoreboard + game summary), pulled through the browser.
ESPN_AB = {'NFL': {'LAR': 'LA', 'WSH': 'WAS'}, 'NBA': {'GS': 'GSW', 'NY': 'NYK', 'SA': 'SAS', 'NO': 'NOP', 'UTAH': 'UTA', 'WSH': 'WAS'}, 'CFB': {}}
def pair(v): return v if isinstance(v, list) and len(v) == 2 else [0, 0]
def n0(v): return v if isinstance(v, (int, float)) else 0
from zoneinfo import ZoneInfo
NY = ZoneInfo('America/New_York')
KICK = json.load(open(f'{RAW}/espn/kick_times.json'))  # ESPN event id -> start time (UTC); dates below are Eastern
def et_date(eid, fallback):
    t = KICK.get(eid)
    return datetime.fromisoformat(t.replace('Z', '+00:00')).astimezone(NY).strftime('%Y-%m-%d') if t else fallback
def espn_load(sport):
    E = json.load(open(f'{RAW}/espn/{sport.lower()}.json')); K = E['keep']; ab = ESPN_AB[sport]
    G = E['games']; P = E['players']; H = {}; FIN = {}
    for r in E['rows']:
        gi, pi, tm, op, home, tsc, osc, dnp, starter, vals, tloc, oloc = r
        eid, date, wk, stype = G[gi]; date = et_date(eid, date); aid, name, pos = P[pi]; v = dict(zip(K, vals))
        tm = ab.get(tm, tm); op = ab.get(op, op); season = int(date[:4]) if sport == 'NBA' else (int(date[:4]) if date[5:7] > '02' else int(date[:4]) - 1)
        key = (home, eid); FIN.setdefault(eid, {})['home' if home else 'away'] = dict(ab=tm, loc=tloc, sc=tsc); FIN[eid].update(d=date, wk=wk, st=stype)
        if sport == 'NBA':
            mins = v.get('all:MIN'); played = isinstance(mins, (int, float)) and mins > 0 and not dnp
            st = None
            if played:
                fg = pair(v.get('all:FG')); tp = pair(v.get('all:3PT'))
                st = dict(min=mins, pts=n0(v.get('all:PTS')), reb=n0(v.get('all:REB')), ast=n0(v.get('all:AST')), tpm=tp[0], stl=n0(v.get('all:STL')), blk=n0(v.get('all:BLK')), tov=n0(v.get('all:TO')), fgm=fg[0], fga=fg[1])
                st.update(pra=st['pts'] + st['reb'] + st['ast'], pr=st['pts'] + st['reb'], pa=st['pts'] + st['ast'], ra=st['reb'] + st['ast'])
        else:
            ca = pair(v.get('passing:C/ATT')); fg = pair(v.get('kicking:FG')); xp = pair(v.get('kicking:XP'))
            st = dict(cmp=ca[0], att=ca[1], pass_yds=n0(v.get('passing:YDS')), pass_td=n0(v.get('passing:TD')), int=n0(v.get('passing:INT')),
                      car=n0(v.get('rushing:CAR')), rush_yds=n0(v.get('rushing:YDS')), rush_td=n0(v.get('rushing:TD')),
                      rec=n0(v.get('receiving:REC')), rec_yds=n0(v.get('receiving:YDS')), rec_td=n0(v.get('receiving:TD')), tgt=n0(v.get('receiving:TGTS')),
                      fgm=fg[0], fga=fg[1], xpm=xp[0], kick_pts=n0(v.get('kicking:PTS')) or 3 * fg[0] + xp[0], tkl=n0(v.get('defensive:TOT')))
            st['atd'] = st['rush_td'] + st['rec_td']
        res = ('W' if tsc > osc else 'L' if tsc < osc else 'T') + f' {tsc}–{osc}' if isinstance(tsc, (int, float)) else None
        g = dict(d=date, s=season, wk=wk, tm=tm, tloc=tloc, opp=op, ha='vs' if home else '@', res=res, st=st, dnp=None if st else True, start=bool(starter), post=stype == 3, eid=eid)
        h = H.setdefault(aid, dict(id=aid, name=name, pos=pos or None, games=[]))
        h['games'].append(g)
    for h in H.values():
        h['games'].sort(key=lambda g: g['d']); last = [g for g in h['games'] if g['st']] or h['games']; h['team'] = last[-1]['tm']; h['tloc'] = last[-1]['tloc']
    BY = {}
    for aid, h in H.items(): BY.setdefault(norm(h['name']), []).append(h)
    return H, BY, FIN
SPORTS_ON = ('NFL',)   # NFL only for now; add 'NBA', 'CFB' back here (and their slates below) to bring a sport back
ESPN = {sp: espn_load(sp) for sp in SPORTS_ON}
# ------------------------------------------------------------------ slates v1 -> v2
def window(sport, g):
    if sport != 'NFL': return g['slate']
    t = et(g['kick_utc']); wd = t.strftime('%a')
    if wd == 'Thu': return 'TNF'
    if wd == 'Mon': return 'MNF'
    if wd == 'Sun' and t.hour >= 19: return 'SNF'
    if wd == 'Sat': return 'Sat'
    return '1 PM' if t.hour < 15 else '4 PM'
def team_of(sport, p, g):
    if sport == 'CFB': return next((t['model_name'] for t in (g['away'], g['home']) if t['abbr'] == p['team'] or t['model_name'] == p['team']), p['team'])
    return p['team']
def pid_of(sport, p, gmap):
    g = gmap[p['gid']]
    if sport == 'CFB': return 'cfb:' + norm(p['player']) + ':' + norm(team_of(sport, p, g))
    return sport.lower() + ':' + norm(p['player'])
NAMEOF = {}
PTEAM = {}  # pkey -> team seen on a slate, to pick the right ESPN athlete when two share a name
STAT = {'rec_yds': 'rec_yds', 'receptions': 'rec', 'rec': 'rec', 'rush_yds': 'rush_yds', 'qb_rush': 'rush_yds', 'pass_yds': 'pass_yds', 'atd': 'atd', 'qb_atd': 'atd', 'kicker': 'kick_pts', 'kick': 'kick_pts',
        'pts': 'pts', 'reb': 'reb', 'ast': 'ast', 'tpm': 'tpm', 'pra': 'pra', 'pr': 'pr', 'pa': 'pa', 'ra': 'ra', 'stl': 'stl', 'blk': 'blk', 'tov': 'tov'}

def hist_for(sport, key):
    H, BY, FIN = ESPN[sport]
    if sport == 'CFB':
        _, n, t = key.split(':', 2); c = BY.get(n, [])
        hit = [h for h in c if any(norm(g['tloc'] or '') == t or norm(g['tm']) == t for g in h['games'])]
        return max(hit, key=lambda h: len(h['games'])) if hit else None
    n = key.split(':', 1)[1]; c = BY.get(n, [])
    if not c: return None
    tm = PTEAM.get(key)
    hit = [h for h in c if tm and any(g['tm'] == tm for g in h['games'])] or c
    return max(hit, key=lambda h: len(h['games']))
def game_on(sport, h, g, meta):
    """The player's ESPN box-score line for this slate's game, or None."""
    if not h: return None
    if sport == 'CFB':
        teams = {norm(g['away']['model_name']), norm(g['home']['model_name'])}
        return next((x for x in h['games'] if x['wk'] == meta.get('week') and x['s'] == 2026 and (norm(x['tloc'] or '') in teams)), None)
    d0 = et(g['kick_utc']).strftime('%Y-%m-%d'); teams = {g['away']['model_name'], g['home']['model_name'], g['away']['abbr'], g['home']['abbr']}
    if sport == 'NFL': return next((x for x in h['games'] if x['s'] == 2026 and x['wk'] == meta.get('week') and x['tm'] in teams), None)
    return next((x for x in h['games'] if x['d'] == d0 and x['tm'] in teams), None)
def final_for(sport, g, meta):
    H, BY, FIN = ESPN[sport]; ab = ESPN_AB[sport]
    for eid, f in FIN.items():
        if 'home' not in f or 'away' not in f: continue
        if sport == 'CFB':
            ok = f['wk'] == meta.get('week') and f['d'][:4] == '2026' and norm(f['home']['loc'] or '') == norm(g['home']['model_name']) and norm(f['away']['loc'] or '') == norm(g['away']['model_name'])
        elif sport == 'NFL':
            ok = f['wk'] == meta.get('week') and f['d'] >= '2026-03' and f['home']['ab'] in (g['home']['model_name'], g['home']['abbr']) and f['away']['ab'] in (g['away']['model_name'], g['away']['abbr'])
        else:
            ok = f['d'] == et(g['kick_utc']).strftime('%Y-%m-%d') and f['home']['ab'] == g['home']['abbr'] and f['away']['ab'] == g['away']['abbr']
        if ok: return dict(away=f['away']['sc'], home=f['home']['sc'])
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
        g = gmap[p['gid']]; p['pkey'] = pid_of(sport, p, gmap); PTEAM.setdefault(p['pkey'], p['team']); p['tier'] = TIER.get(p['classification'], 'pass'); p['window'] = g['window']
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
    d['results'] = dict(status=status, source='ESPN box scores and final scores (espn.com)',
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
]

# ------------------------------------------------------------------ NFL season results (weeks 1-7 as published) -> results file; add every graded row to player history
R1 = json.load(open(f'{SRC}/nfl_results-data.json'))
for w in R1['detail']:
    for kind in ('bets', 'leans'):
        for r in w.get(kind) or []:
            key = 'nfl:' + norm(r['player']); PTEAM.setdefault(key, r['team']); NAMEOF.setdefault(key, r['player'])
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
    elif sport == 'NBA': col = (TEAMC['NBA'].get(h['team'] if h else team) or [None])[0]
    g2 = [{k: v for k, v in g.items() if v is not None and k not in ('gid',)} for g in games]
    return dict(eid=(h or {}).get('id'), name=h['name'] if h else fallback_name, team=(h['team'] if h else team), pos=(h or {}).get('pos'), color=col, games=g2, model=ap,
                history='found' if h else 'not_found')
for sport in SPORTS_ON:
    P = {}
    import glob
    paths = [f'{OUT}/{x["path"][5:]}' for x in slates if x['sport'] == sport]
    paths += [p for p in sorted(glob.glob(f'{OUT}/{sport.lower()}/*.json')) if p not in paths and not p.endswith('results-2026.json')]   # model runs added by add_slate.py
    for path in paths:
        d = json.load(open(path))
        for p in d['props']:
            if p['pkey'] in P: continue
            P[p['pkey']] = mkprof(sport, p['pkey'], hist_for(sport, p['pkey']), p['player'], p['team'])
    if sport == 'NFL':
        for key in APPEAR:
            if key.startswith('nfl:') and key not in P: P[key] = mkprof('NFL', key, hist_for('NFL', key), NAMEOF.get(key, key[4:].title()), PTEAM.get(key))
    stats = {'NFL': [['pass_yds', 'Pass yds'], ['pass_td', 'Pass TD'], ['cmp', 'Cmp'], ['att', 'Att'], ['int', 'INT'], ['car', 'Car'], ['rush_yds', 'Rush yds'], ['rush_td', 'Rush TD'], ['tgt', 'Tgt'], ['rec', 'Rec'], ['rec_yds', 'Rec yds'], ['rec_td', 'Rec TD'], ['fgm', 'FGM'], ['xpm', 'XPM'], ['kick_pts', 'Kick pts'], ['tkl', 'Tkl']],
             'NBA': [['min', 'Min'], ['pts', 'Pts'], ['reb', 'Reb'], ['ast', 'Ast'], ['tpm', '3PM'], ['stl', 'Stl'], ['blk', 'Blk'], ['tov', 'TO'], ['pra', 'PRA']],
             'CFB': [['pass_yds', 'Pass yds'], ['pass_td', 'Pass TD'], ['cmp', 'Cmp'], ['car', 'Car'], ['rush_yds', 'Rush yds'], ['rush_td', 'Rush TD'], ['rec', 'Rec'], ['rec_yds', 'Rec yds'], ['rec_td', 'Rec TD']]}[sport]
    src = {'NFL': 'ESPN box scores (espn.com game summaries), 2025 and 2026 regular season', 'NBA': 'ESPN box scores (espn.com game summaries), 2025–26 season and playoffs plus 2026–27 to date', 'CFB': 'ESPN box scores (espn.com game summaries), 2026 FBS games'}[sport]
    out = dict(schema='wmtl.players.v1', sport=sport, source=src, built_utc=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), stats=stats, market_stat=STAT, players=P)
    os.makedirs(f'{OUT}/players', exist_ok=True)
    json.dump(out, open(f'{OUT}/players/{sport.lower()}.json', 'w'), separators=(',', ':'), ensure_ascii=False)
    print(sport, 'players', len(P), 'with history', sum(1 for v in P.values() if v['history'] == 'found'))

# ------------------------------------------------------------------ upcoming NFL games (schedule only, no picks)
nxt = None
UP = f'{RAW}/espn/upcoming.json'   # ESPN scoreboard for the next week, pulled with the box scores
if os.path.exists(UP):
    u = json.load(open(UP)); nxt = dict(sport=u['sport'], label=u['label'], first=u['first'], games=u['games'], note='Thursday (JAX @ BAL) is modeled. Sunday and Monday games have not been run yet, so they have no picks.')
index = dict(schema='wmtl.index.v1', built_utc=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), brand='whomadethisline', slates=slates,
             players={s: f'data/players/{s.lower()}.json' for s in SPORTS_ON}, results={'NFL': 'data/nfl/results-2026.json'},
             sports=dict(NFL=dict(status='live')),
             upcoming=[nxt] if nxt else [])
json.dump(index, open(f'{OUT}/index.json', 'w'), indent=1, ensure_ascii=False)
for s in slates: print(s['id'], s['n_props'], 'priced', s['priced'], 'bets', s['bets'], 'results', s['results'])
