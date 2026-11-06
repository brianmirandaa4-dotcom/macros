"""Merge, diff and publish. Copies model numbers; computes none (counts and labels only).

  frozen(prev, now)           games of a published slate that have kicked off (their props never change again)
  merge(new, prev, frozen)    refreshed games from the new export + frozen games verbatim from the published file;
                              recounts meta (games, props, funnel, labels), re-matches capper picks to the new props
  inputs_snapshot / diff_inputs   players ruled out / cleared, line moves above threshold, weather, public %
  diff_outputs(prev, new)     props added, removed, flipped (side), re-tiered
  semantic_changed(a, b)      file contents differ once volatile timestamps are ignored
  apply(stage, data)          copy changed files into wmtl/data (and delete player files that no longer exist)
  bump_sw(wmtl)               the service-worker cache version (wmtl-vN-...) +1, sw.js only
"""
import os, re, json, shutil, hashlib, datetime as dt, unicodedata
from common import NY, UTC, parse_ts, read_json, write_json, log, iso, now_utc

VOLATILE = {'generated_et', 'prices_et', 'injuries_et', 'built_utc', 'updated', 'pulled', 'ts', 'prices_utc'}
LINE_MOVE = {'receptions': .5, 'rec_yds': 1.5, 'rush_yds': 1.5, 'pass_yds': 2.5}
PRICE_MOVE = 15                     # American odds points at the same line
GAME_MOVE = {'spread': .5, 'total': .5}
WEATHER_MOVE = dict(temp_f=3.0, wind_mph=3.0)
VALIDATED = ('receptions', 'rec_yds')


# ------------------------------------------------------------------ freezing and merging
def frozen(prev, now):
    if not prev: return set()
    return {g['id'] for g in prev.get('games', []) if parse_ts(g['kick_utc']) <= now}


def _labels(games, week, part):
    ks = sorted(parse_ts(g['kick_utc']).astimezone(NY) for g in games)
    if len(games) == 1: dl = ks[0].strftime('%a %b %-d') + ' · ' + games[0]['away']['abbr'] + ' @ ' + games[0]['home']['abbr']
    elif ks[0].date() == ks[-1].date(): dl = ks[0].strftime('%a %b %-d')
    else: dl = ks[0].strftime('%a %b %-d') + ' – ' + ks[-1].strftime('%a %b %-d')
    if part == 'thu' and all(k.strftime('%a') == 'Thu' for k in ks): lb = f'Week {week} · Thursday'
    else: lb = f'Week {week} · ' + (ks[0].strftime('%a') if ks[0].strftime('%a') == ks[-1].strftime('%a') else ks[0].strftime('%a') + '–' + ks[-1].strftime('%a'))
    return dl, lb, min(g['kick_utc'] for g in games)[:10]


def funnel(props, validated):
    """The export_overlay.py funnel, recounted over the merged props (same six definitions)."""
    return [dict(step='Props with a DraftKings line', n=len(props)), dict(step='Model can predict (not out-of-distribution, passes invariants)', n=sum(not p['no_prediction'] for p in props)),
            dict(step='Market where the model beat the line out of sample (receptions, receiving yards)', n=sum(not p['no_prediction'] and p['market'] in validated for p in props)),
            dict(step='Priced at a sportsbook (Action Network, every book it carries)', n=sum(isinstance(p['odds'], (int, float)) for p in props)),
            dict(step='Edge of 3+ points over break-even at the best price', n=sum((p.get('edge_pts') or -99) >= 3 for p in props)),
            dict(step='Interval (bootstrap by game) clears break-even, validated market, no flags = Bet', n=sum(p['tier'] == 'bet' for p in props))]


def merge(new, prev, fz, part):
    if not fz or not prev: out = new
    else:
        out = json.loads(json.dumps(new))
        keep_g = [g for g in prev['games'] if g['id'] in fz]; keep_p = [p for p in prev['props'] if p['gid'] in fz]
        out['games'] = sorted(keep_g + [g for g in new['games'] if g['id'] not in fz], key=lambda g: g['kick_utc'])
        out['props'] = keep_p + [p for p in new['props'] if p['gid'] not in fz]
        pl_old = [x for x in (prev.get('parlays') or {}).get('items', []) if x.get('gid') in fz]
        out['parlays'] = dict(new.get('parlays') or {}, items=pl_old + [x for x in (new.get('parlays') or {}).get('items', []) if x.get('gid') not in fz])
        m = out['meta']; m['n_games'] = len(out['games']); m['n_props'] = len(out['props'])
        m['funnel'] = funnel(out['props'], VALIDATED)
        m['windows'] = sorted({g['window'] for g in out['games']}, key=lambda w: ['TNF', '1 PM', '4 PM', 'SNF', 'MNF'].index(w) if w in ('TNF', '1 PM', '4 PM', 'SNF', 'MNF') else 9)
        m['frozen_games'] = sorted(fz)
    m = out['meta']; m['date_label'], m['label'], m['date'] = _labels(out['games'], m['week'], part)
    if prev and (prev.get('results') or {}).get('status') not in (None, 'pending'): out['results'] = prev['results']
    if prev and prev.get('cappers'): out['cappers'] = rematch_cappers(prev['cappers'], out)
    return out


def _norm(s): return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()).strip()


def rematch_cappers(block, d):
    """tools/add_cappers.py matching, re-run against the refreshed props so the comparison never shows stale model numbers.
    The capper picks themselves are unchanged (pulled earlier from Action Network); only the model side / chance are re-copied."""
    b = json.loads(json.dumps(block)); MK = {'Recs': 'receptions', 'Rec Yds': 'rec_yds', 'Rush Yds': 'rush_yds', 'Pass Yds': 'pass_yds'}
    teams = {t for g in d['games'] for t in (g['away']['abbr'], g['home']['abbr'])}
    for k in b.get('picks', []):
        m = re.match(r'^([A-Z])\.\s*([A-Za-z\'\-\. ]+?)\s+([ou])(\d+(?:\.\d+)?)\s+(.+)$', k.get('play') or '')
        match = None
        if m and m.group(5) in MK:
            ini, last, market, line = m.group(1).lower(), _norm(m.group(2)), MK[m.group(5)], float(m.group(4))
            for p in d['props']:
                pn = _norm(p['player']).split()
                if p['market'] == market and p['line'] == line and pn and pn[0][0] == ini and last in ' '.join(pn[1:]) and p['team'] in teams: match = p; break
        if match and match.get('side') and match.get('p_raw') is not None:
            ps = match['p_raw'] if match['side'] == k['side'] else round(1 - match['p_raw'], 3)
            k['model'] = dict(prop=match['id'], model_side=match['side'], agree=match['side'] == k['side'], p_capper_side=ps, projection=match['projection'], tier=match['tier'])
        else: k['model'] = None
    b['note'] = (b.get('note') or '') + ' Model comparison re-matched to the current model run.'
    return b


# ------------------------------------------------------------------ diffs
def inputs_snapshot(inj, lines_df, odds_rows, weather, nflverse):
    lines = {}
    if lines_df is not None and len(lines_df):
        for r in lines_df.itertuples():
            k = f'{r.player}|{r.team}|{r.market}|{r.book_id}'
            e = lines.setdefault(k, [None, None, None]); e[0] = float(r.value)
            if r.side == 'over': e[1] = int(r.odds)
            elif r.side == 'under': e[2] = int(r.odds)
    games = {}
    for r in odds_rows or []:
        gid, start, away, home, bid, period, typ, side, team, value, odds, alt, tix, money = r
        if bid != 15 or alt: continue                                            # consensus line + public % only
        g = games.setdefault(f'{away}@{home}', {})
        if typ == 'spread' and side == 'home': g['spread_home'] = value; g['spread_home_tix'] = tix; g['spread_home_money'] = money
        if typ == 'total' and side == 'over': g['total'] = value; g['over_tix'] = tix; g['over_money'] = money
        if typ == 'moneyline' and side == 'home': g['ml_home'] = odds; g['ml_home_tix'] = tix
    return dict(injuries=(inj or {}).get('status', {}), lines=lines, games=games, weather=(weather or {}).get('games', {}), nflverse=nflverse)


def diff_inputs(old, new):
    old = old or {}; out = dict(ruled_out=[], cleared=[], status_changed=[], line_moves=[], price_moves=0, game_line_moves=[], public_pct=[], weather=[])
    oi, ni = old.get('injuries', {}), new.get('injuries', {})
    for pid in sorted(set(oi) | set(ni)):
        a = (oi.get(pid) or [None, None]); b = (ni.get(pid) or [None, None])
        if a[0] == b[0]: continue
        e = dict(pid=pid, name=b[1] or a[1], was=a[0], now=b[0])
        if b[0] in ('Out', 'Doubtful'): out['ruled_out'].append(e)
        elif b[0] is None: out['cleared'].append(e)
        else: out['status_changed'].append(e)
    ol, nl = old.get('lines', {}), new.get('lines', {})
    for k, v in nl.items():
        mk = k.split('|')[2]; o = ol.get(k)
        if o is None: continue
        if o[0] is not None and v[0] is not None and abs(v[0] - o[0]) >= LINE_MOVE.get(mk, 1):
            out['line_moves'].append(dict(key=k, was=o[0], now=v[0]))
        elif o[0] == v[0] and any(x is not None and y is not None and abs(x - y) >= PRICE_MOVE for x, y in zip(o[1:], v[1:])):
            out['price_moves'] += 1
    out['lines_new'] = sum(1 for k in nl if k not in ol); out['lines_gone'] = sum(1 for k in ol if k not in nl)
    for g, v in new.get('games', {}).items():
        o = old.get('games', {}).get(g) or {}
        for f, th in GAME_MOVE.items():
            fk = 'spread_home' if f == 'spread' else 'total'
            if o.get(fk) is not None and v.get(fk) is not None and abs(v[fk] - o[fk]) >= th: out['game_line_moves'].append(dict(game=g, market=f, was=o[fk], now=v[fk]))
        if o.get('spread_home_tix') is not None and v.get('spread_home_tix') is not None and abs(v['spread_home_tix'] - o['spread_home_tix']) >= 10:
            out['public_pct'].append(dict(game=g, spread_home_tickets_was=o['spread_home_tix'], now=v['spread_home_tix']))
    for g, v in new.get('weather', {}).items():
        o = old.get('weather', {}).get(g)
        if o is None: out['weather'].append(dict(game=g, now=v, was=None)); continue
        if any(v.get(f) is not None and o.get(f) is not None and abs(v[f] - o[f]) >= th for f, th in WEATHER_MOVE.items()) or v.get('short') != o.get('short'):
            out['weather'].append(dict(game=g, was=o, now=v))
    out['nflverse_files_changed'] = new.get('nflverse', [])
    out['line_moves'] = out['line_moves'][:60]
    return out


def diff_outputs(prev, new):
    P = {p['id']: p for p in (prev or {}).get('props', [])}; N = {p['id']: p for p in new.get('props', [])}
    flip = [dict(id=i, player=N[i]['player'], market=N[i]['market'], was=P[i]['side'], now=N[i]['side']) for i in N if i in P and P[i].get('side') and N[i].get('side') and P[i]['side'] != N[i]['side']]
    tier = [dict(id=i, player=N[i]['player'], market=N[i]['market'], was=P[i]['tier'], now=N[i]['tier']) for i in N if i in P and P[i].get('tier') != N[i].get('tier')]
    add = [i for i in N if i not in P]; rem = [i for i in P if i not in N]
    return dict(added=len(add), removed=len(rem), flipped=len(flip), retiered=len(tier), added_ids=add[:40], removed_ids=rem[:40], flips=flip[:40], tiers=tier[:40],
                bets=sum(p['tier'] == 'bet' for p in N.values()), leans=sum(p['tier'] == 'lean' for p in N.values()))


# ------------------------------------------------------------------ publishing
def _strip(o):
    if isinstance(o, dict): return {k: _strip(v) for k, v in o.items() if k not in VOLATILE}
    if isinstance(o, list): return [_strip(x) for x in o]
    return o


def semantic_changed(a_path, b_path):
    if not os.path.exists(b_path): return True
    with open(a_path, 'rb') as f: A = f.read()
    with open(b_path, 'rb') as f: B = f.read()
    if A == B: return False
    if not a_path.endswith('.json'): return True
    try: return _strip(json.loads(A)) != _strip(json.loads(B))
    except json.JSONDecodeError: return True


def plan(stage, data, ignore=('nfl/run_log.json', 'nfl/state/inputs_snapshot.json')):
    """Files that differ in content (volatile timestamps ignored). Returns (changed, deleted)."""
    ch, de = [], []
    for root, _, files in os.walk(stage):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), stage)
            if rel in ignore: continue
            if semantic_changed(os.path.join(stage, rel), os.path.join(data, rel)): ch.append(rel)
    pdir = os.path.join(data, 'nflp', 'p')
    if os.path.isdir(pdir) and os.path.isdir(os.path.join(stage, 'nflp', 'p')):
        de = [f'nflp/p/{f}' for f in os.listdir(pdir) if not os.path.exists(os.path.join(stage, 'nflp', 'p', f))]
    return sorted(ch), sorted(de)


def apply(stage, data, files, deleted):
    for rel in files:
        os.makedirs(os.path.dirname(os.path.join(data, rel)), exist_ok=True); shutil.copy2(os.path.join(stage, rel), os.path.join(data, rel))
    for rel in deleted: os.remove(os.path.join(data, rel))


def bump_sw(wmtl):
    p = os.path.join(wmtl, 'sw.js'); s = open(p).read()
    m = re.search(r"wmtl-v(\d+)-", s)
    if not m: raise RuntimeError('sw.js: no wmtl-vN- version string')
    n = int(m.group(1)) + 1; s2 = re.sub(r"wmtl-v\d+-", f'wmtl-v{n}-', s, count=1)
    open(p, 'w').write(s2); return n
