"""Overlay Board: every player prop on the board for a week, grouped game -> player -> prop, with every book's price.
Copies prices from the Action Network pull; attaches the model's numbers only where the trained model produced them
(slate file props with matching player + market). Computes nothing new.
Run: python3 src/board.py <allprops.json> <slate-sun.json> <slate-thu.json> <out.json>"""
import json, sys, re, unicodedata, datetime as dt
from zoneinfo import ZoneInfo
import pandas as pd
SRC, SUN, THU, OUT = sys.argv[1:5]
d = json.load(open(SRC)); NY = ZoneInfo('America/New_York')
BOOK = {68: 'DK', 69: 'FD', 75: 'MGM', 71: 'BR', 49: 'CZR', 30: 'Open'}
ALIAS = {'JAC': 'JAX', 'LAR': 'LA'}
def norm(s): return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()).replace(' jr', '').replace(' iii', '').replace(' ii', '').strip()
NAMES = {'passing_yards': 'Passing yards', 'pass_completions': 'Completions', 'passing_attempts': 'Pass attempts', 'passing_tds': 'Passing TDs', 'interceptions': 'Interceptions',
         'longest_completion': 'Longest completion', 'rushing_yards': 'Rushing yards', 'rushing_attempts': 'Carries', 'longest_rush': 'Longest rush', 'receptions': 'Receptions',
         'receiving_yards': 'Receiving yards', 'longest_reception': 'Longest reception', 'anytime_touchdown_scorer': 'Anytime TD', 'first_touchdown_scorer': 'First TD',
         'last_touchdown_scorer': 'Last TD', 'to_score_2_or_more_touchdowns': '2+ TDs', 'to_score_3_or_more_touchdowns': '3+ TDs', 'rushing_receiving_yards': 'Rush + rec yards',
         'passing_rushing_yards': 'Pass + rush yards', 'sacks': 'Sacks', 'tackles_assists': 'Tackles + assists', 'kicking_points': 'Kicking points', 'field_goals_made': 'Field goals made',
         'extra_points_made': 'Extra points made', 'receiving_tds': 'Receiving TDs', 'rushing_tds': 'Rushing TDs'}
CAT = {'Passing': ['passing', 'pass_', 'completion', 'interceptions'], 'Rushing': ['rushing', 'rush', 'carries'], 'Receiving': ['recept', 'receiving'], 'Touchdowns': ['touchdown'],
       'Defense': ['sacks', 'tackles'], 'Kicking': ['kicking', 'field_goals', 'extra_points']}
ORDER = ['Passing yards', 'Completions', 'Pass attempts', 'Passing TDs', 'Interceptions', 'Longest completion', 'Pass + rush yards', 'Rushing yards', 'Carries', 'Longest rush',
         'Rush + rec yards', 'Receptions', 'Receiving yards', 'Longest reception', 'Anytime TD', 'First TD', 'Last TD', '2+ TDs', '3+ TDs', 'Tackles + assists', 'Sacks', 'Kicking points',
         'Field goals made', 'Extra points made']
MODEL_MK = {'Passing yards': 'pass_yds', 'Rushing yards': 'rush_yds', 'Receiving yards': 'rec_yds', 'Receptions': 'receptions'}
def label(t):
    k = re.sub(r'^core_bet_type_\d+_', '', t)
    m = re.match(r'^\d+_player_([a-z_]+?)_milestones_(\d+)_or_more$', k)
    if m: return NAMES.get(m.group(1).replace('touchdowns', 'tds'), m.group(1).replace('_', ' ').capitalize()).replace('Passing tds', 'Passing TDs') + ' ladder', int(m.group(2)), m.group(1)
    return NAMES.get(k, k.replace('_', ' ').capitalize()), None, k
def cat(k):
    for c, keys in CAT.items():
        if any(x in k for x in keys): return c
    return 'Other'
R = pd.DataFrame(d['rows'], columns=d['cols']); R = R[R.alt == 0]
PL = {int(k): v for k, v in d['players'].items()}; GM = {int(k): v for k, v in d['games'].items()}
TEAMID = {}
for g in GM.values(): TEAMID[g[3]] = ALIAS.get(g[1], g[1]); TEAMID[g[4]] = ALIAS.get(g[2], g[2])
# model props from slate files
MP = {}
import os
for f in (SUN, THU):
    if not os.path.exists(f): continue   # [auto] a week may have no Thursday slate
    for p in json.load(open(f))['props']:
        MP[(norm(p['player']), p['team'], p['market'])] = p
games = {}
for (gid, pid), g in R.groupby(['an_gid', 'player_id']):
    if gid not in GM or pid not in PL: continue
    st, aw, hm, awid, hmid = GM[gid]; nm, pos, tid = PL[pid]; team = TEAMID.get(tid)
    G = games.setdefault(gid, dict(gid=int(gid), kick_utc=st, away=ALIAS.get(aw, aw), home=ALIAS.get(hm, hm), players={}))
    P = G['players'].setdefault(pid, dict(name=nm, pos=pos, team=team, pkey='nfl:' + norm(nm), props={}))
    for t, h in g.groupby('type'):
        lab, rung, key = label(t)
        if rung is not None:   # ladder: one row per rung, yes price per book
            L = P['props'].setdefault(lab, dict(market=lab, cat=cat(key), kind='ladder', rungs={}))
            L['rungs'][str(rung)] = {BOOK[b]: int(x.odds.iloc[0]) for b, x in h.groupby('book_id') if b in BOOK}
            continue
        e = dict(market=lab, cat=cat(key), books={})
        for b, x in h.groupby('book_id'):
            if b not in BOOK: continue
            ov = x[x.side == 'over']; un = x[x.side == 'under']; ys = x[x.side.isin(['noside', 'yes'])]
            if len(ys): e['kind'] = 'yes'; e['books'][BOOK[b]] = dict(yes=int(ys.odds.iloc[0]))
            elif len(ov) or len(un):
                e['kind'] = 'ou'; e['books'][BOOK[b]] = dict(line=float((ov if len(ov) else un).value.iloc[0]), over=int(ov.odds.iloc[0]) if len(ov) else None, under=int(un.odds.iloc[0]) if len(un) else None)
        if not e['books']: continue
        mk = MODEL_MK.get(lab); mp = MP.get((norm(nm), team, mk)) if mk else None
        if mp and not mp.get('no_prediction') and mp.get('projection') is not None:
            e['model'] = dict(prop=mp['id'], projection=mp['projection'], side=mp.get('side'), p=mp.get('p') if mp.get('p') is not None else mp.get('p_raw'), line=mp.get('line'), tier=mp.get('tier'),
                              range80=mp.get('range80'))
        elif mp and mp.get('no_prediction'): e['model'] = dict(prop=mp['id'], no_prediction=True, flags=mp.get('ood'))
        P['props'][lab] = e
out = []
for G in sorted(games.values(), key=lambda g: g['kick_utc']):
    t = dt.datetime.fromisoformat(G['kick_utc'].replace('Z', '+00:00')).astimezone(NY); wd = t.strftime('%a')
    G['window'] = {'Thu': 'TNF', 'Mon': 'MNF'}.get(wd) or ('SNF' if t.hour >= 19 else '1 PM' if t.hour < 15 else '4 PM'); G['kick_et'] = t.strftime('%a %-I:%M %p')
    pl = []
    for P in G['players'].values():
        P['props'] = sorted(P['props'].values(), key=lambda e: (ORDER.index(e['market'].replace(' ladder', '')) if e['market'].replace(' ladder', '') in ORDER else 99, 'ladder' in e['market']))
        P['n'] = len(P['props']); pl.append(P)
    G['players'] = sorted(pl, key=lambda P: (P['team'] != G['away'], -P['n'], P['name']))
    out.append(G)
json.dump(dict(schema='wmtl.board.v1', week=d['week'], pulled=d['pulled'], source='Action Network (DraftKings, FanDuel, BetMGM, BetRivers, Caesars, opener)', games=out), open(OUT, 'w'), separators=(',', ':'))
print('games', len(out), 'players', sum(len(g['players']) for g in out), 'props', sum(P['n'] for g in out for P in g['players']),
      'with model', sum(1 for g in out for P in g['players'] for e in P['props'] if 'model' in e))
