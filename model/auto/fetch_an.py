"""Action Network pulls, server side (the same JSON requests the actionnetwork.com pages make).

    python3 model/auto/fetch_an.py --week 9 --out model/nfl/raw/an

Writes, each only when its pull passed the schema check (so a block or a schema change never overwrites good data):
  an_nfl_wk09_props_<ts>.json     4 model markets, cols = week,type,an_gid,start,book_id,player_id,player,pos,team_id,side,value,odds,alt,tix,money
                                  (identical layout to the stored an_nfl_props_wk01-09 pull; parse_props() turns it into the parquet)
  an_nfl_wk09_allprops_<ts>.json  every player market for the board (src/board.py input layout)
  an_nfl_wk09_odds_<ts>.json      game lines + public betting % (informational: line movement and public % for the run log)
  an_status.json                  {"props": "ok ..."|"blocked ..."|"error ...", "allprops": ..., "odds": ..., "props_books": {code: rows}, "allprops_books": ...}
Books: every id in src/books.py (consensus 15, opener 30, sportsbooks, exchanges, pick'em apps). Pick'em rows may carry odds 0/null.
Live (in-game) prices are dropped: the model only prices pregame.
"""
import argparse, os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concurrent.futures import ThreadPoolExecutor
import urllib.error
from common import SchemaError, need, http_json, write_json, now_utc, log, BROWSER_UA, AN_TO_NFLVERSE, MODEL
sys.path.insert(0, os.path.join(MODEL, 'nfl', 'src'))
import books as BK                                  # model/nfl/src/books.py: the book registry (ids, names, codes, kinds)

API = 'https://api.actionnetwork.com/web/v2/scoreboard/nfl'
BOOKS = BK.REQUEST_IDS                            # consensus, opener + every book Action Network carries (src/books.py; Caesars 123 and fallback 49)
HDR = {'User-Agent': BROWSER_UA, 'Origin': 'https://www.actionnetwork.com', 'Referer': 'https://www.actionnetwork.com/nfl/props'}
CORE = ['core_bet_type_9_passing_yards', 'core_bet_type_12_rushing_yards', 'core_bet_type_15_receptions', 'core_bet_type_16_receiving_yards']
MARKET = {'core_bet_type_9_passing_yards': 'pass_yds', 'core_bet_type_12_rushing_yards': 'rush_yds', 'core_bet_type_15_receptions': 'receptions',
          'core_bet_type_16_receiving_yards': 'rec_yds'}
# the 96 types of the stored week-9 board pull (raw/an/an_nfl_wk09_allprops_*.json log; same set)
ALL = ['17_receiving_tds', '13_rushing_tds', '9_passing_yards', '68_to_score_3_or_more_touchdowns', '67_to_score_2_or_more_touchdowns', '63_last_touchdown_scorer',
       '62_anytime_touchdown_scorer', '56_first_touchdown_scorer', '58_longest_rush', '65_interceptions', '30_passing_attempts', '11_passing_tds', '60_longest_completion',
       '10_pass_completions', '12_rushing_yards', '18_rushing_attempts'] + \
      [f'534_{a}_player_passing_attempts_milestones_{b}_or_more' for a, b in ((1061, 30), (1065, 50), (1119, 34), (1141, 42), (1120, 38), (1142, 46))] + \
      [f'524_{1033 + n}_player_passing_touchdowns_milestones_{n}_or_more' for n in (1, 4, 3, 2)] + ['15_receptions', '59_longest_reception', '16_receiving_yards'] + \
      [f'525_{a}_player_passing_yards_milestones_{b}_or_more' for a, b in ((1045, 175), (1046, 150), (1006, 200), (1009, 275), (1013, 400), (1008, 250), (1007, 225), (1012, 350), (1010, 300), (1011, 325))] + \
      [f'533_{a}_player_rushing_attempts_milestones_{b}_or_more' for a, b in ((1081, 8), (1152, 28), (1151, 24), (1108, 30), (1116, 16))] + \
      [f'528_{a}_player_rushing_yards_milestones_{b}_or_more' for a, b in ((1016, 50), (1014, 25), (1017, 60), (1015, 40), (1020, 90), (1021, 100), (1018, 70), (1019, 80), (1022, 110))] + \
      [f'527_{a}_player_rushing_touchdowns_milestones_{b}_or_more' for a, b in ((1048, 2), (1049, 3), (1047, 1), (1050, 4), (1088, 5))] + \
      [f'532_{a}_player_receptions_milestones_{b}_or_more' for a, b in ((1038, 2), (1039, 3), (1043, 7), (1042, 6), (1041, 5), (1040, 4), (1057, 10), (1056, 9), (1044, 8))] + \
      [f'530_{a}_player_receiving_yards_milestones_{b}_or_more' for a, b in ((1025, 50), (1023, 25), (1027, 70), (1024, 40), (1026, 60), (1033, 150), (1031, 110), (1028, 80), (1032, 125), (1075, 75), (1030, 100), (1029, 90))] + \
      [f'531_{a}_player_tackles_milestones_{b}_or_more' for a, b in ((1272, 1), (1073, 9), (1066, 2), (1072, 8), (1068, 4), (1069, 5), (1070, 6), (1067, 3), (1071, 7), (1074, 10))] + \
      ['578_sacks', '43_kicking_points', '213_field_goals_made', '212_extra_points_made', '66_rushing_receiving_yards', '70_tackles_assists', '71_passing_rushing_yards']
ALL = ['core_bet_type_' + t for t in ALL]


class Blocked(Exception):
    """Action Network refused the request from this machine (403/429/HTML challenge)."""


def _get(url):
    try:
        return http_json(url, headers=HDR, retries=2, what='action network')
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 429, 451, 503): raise Blocked(f'HTTP {e.code}')
        raise
    except json.JSONDecodeError:
        raise Blocked('non-JSON reply (bot challenge page)')


def markets(week, t):
    """One markets request; returns (rows, players{id: obj}, games{id: obj}). rows = (type, outcome dict, book id)."""
    r = _get(f'{API}/markets?bookIds={BOOKS}&customPickTypes={t}&seasonType=reg&week={week}')
    mk = need(r, 'markets', dict, 'an markets'); pl = r.get('players') or []; gm = r.get('games') or []
    if not isinstance(pl, list) or not isinstance(gm, list): raise SchemaError('an markets: players/games not lists')
    P = {p['id']: p for p in pl if isinstance(p, dict) and 'id' in p}; G = {g['id']: g for g in gm if isinstance(g, dict) and 'id' in g}
    out = []
    for bid, m in mk.items():
        if not isinstance(m, dict): raise SchemaError('an markets: book entry not an object')
        for obj in m.values():
            if not isinstance(obj, dict): continue
            for typ, arr in obj.items():
                if typ != t or not isinstance(arr, list): continue
                for o in arr:
                    for k in ('player_id', 'side', 'event_id'):
                        if k not in o: raise SchemaError(f'an outcome missing {k}')
                    if 'odds' not in o and KIND_OF(bid) != 'pickem': raise SchemaError('an outcome missing odds')
                    if o.get('is_live'): continue
                    out.append((typ, o, int(bid)))
    return out, P, G


def KIND_OF(bid):
    try: return BK.KIND.get(int(bid))
    except (TypeError, ValueError): return None


def book_counts(rows, col):
    """Rows per book (short code) in one pull, for the status file and the run log."""
    c = {}
    for r in rows: k = {BK.CONSENSUS: 'consensus', BK.OPEN: 'Open', BK.CZR_FALLBACK: 'CZR49'}.get(r[col]) or BK.CODE.get(r[col], str(r[col])); c[k] = c.get(k, 0) + 1
    return dict(sorted(c.items(), key=lambda x: -x[1]))


def _pct(o, k):
    try: return float(((o.get('bet_info') or {}).get(k) or {}).get('percent') or 0)
    except (TypeError, ValueError): return 0.0


def pull_props(week, types, slim=False):
    rows, players, games, log_ = [], {}, {}, []
    def job(t):
        return t, markets(week, t)
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda t: _try(job, t), types))
    blocked = [r for r in res if isinstance(r, Blocked)]
    if blocked and len(blocked) == len(res): raise blocked[0]
    errs = [str(r) for r in res if isinstance(r, Exception)]
    if len(errs) > len(types) // 2: raise SchemaError(f'an: {len(errs)}/{len(types)} market pulls failed: {errs[:3]}')
    for r in res:
        if isinstance(r, Exception): continue
        t, (rr, P, G) = r; players.update(P); games.update(G); n = 0
        for typ, o, bid in rr:
            if not o.get('player_id'): continue
            p = P.get(o['player_id']) or {}; g = G.get(o['event_id']) or {}
            if slim: rows.append([typ, o['event_id'], bid, o['player_id'], o['side'], o.get('value'), o.get('odds'), 1 if o.get('is_alt_market') else 0, o.get('deeplink_id') or None])
            else: rows.append([week, typ, o['event_id'], g.get('start_time'), bid, o['player_id'], p.get('full_name'), p.get('position'), p.get('team_id'),
                               o['side'], o.get('value'), o.get('odds'), 1 if o.get('is_alt_market') else 0, _pct(o, 'tickets'), _pct(o, 'money')])
            n += 1
        log_.append(f'{t[14:]}:{n}')
    return rows, players, games, log_, errs


def _try(f, *a):
    try: return f(*a)
    except Exception as e: return e                                           # noqa: BLE001


def teams_of(games):
    T = {}
    for g in games.values():
        for k in ('home_team', 'away_team'):
            tm = g.get(k)
            if isinstance(tm, dict) and 'id' in tm: T[str(tm['id'])] = tm.get('abbr')
    return T


def game_odds(week):
    """Game lines + public % (moneyline, spread, total). Tolerant walk of games[].markets[book][period][type][]."""
    r = _get(f'{API}?bookIds={BOOKS}&periods=event&seasonType=reg&week={week}')
    gs = need(r, 'games', list, 'an scoreboard')
    rows = []
    for g in gs:
        h, a = g.get('home_team') or {}, g.get('away_team') or {}
        tid = {h.get('id'): h.get('abbr'), a.get('id'): a.get('abbr')}
        for bid, per in (g.get('markets') or {}).items():
            for period, types in (per or {}).items():
                for typ, arr in (types or {}).items():
                    for o in arr or []:
                        if o.get('is_live'): continue
                        rows.append([g.get('id'), g.get('start_time'), a.get('abbr'), h.get('abbr'), int(bid), period, typ, o.get('side'), tid.get(o.get('team_id')),
                                     o.get('value'), o.get('odds'), 1 if o.get('is_alt_market') else 0, _pct(o, 'tickets'), _pct(o, 'money')])
    if not rows: raise SchemaError('an scoreboard: no game markets')
    return rows


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--week', type=int, required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--no-board', action='store_true')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    t0 = now_utc(); ts = t0.strftime('%Y-%m-%dT%H%MZ'); pulled = t0.strftime('%Y-%m-%dT%H:%M:%S.000Z'); st = {}
    try:
        rows, P, G, lg, errs = pull_props(a.week, CORE)
        if not rows: raise SchemaError('an props: no rows for the 4 model markets')
        teams = teams_of(G)
        write_json(f'{a.out}/an_nfl_wk{a.week:02d}_props_{ts}.json', dict(pulled=pulled, source='api.actionnetwork.com/web/v2/scoreboard/nfl/markets (server side)',
                   cols=['week', 'type', 'an_gid', 'start', 'book_id', 'player_id', 'player', 'pos', 'team_id', 'side', 'value', 'odds', 'alt', 'tix', 'money'],
                   rows=rows, teams=teams, log=lg), compact=True)
        st['props'] = f'ok {len(rows)} rows' + (f' ({len(errs)} type errors)' if errs else ''); st['props_books'] = book_counts(rows, 4)
    except Blocked as e: st['props'] = f'blocked {e}'
    except Exception as e: st['props'] = f'error {e}'                          # noqa: BLE001
    if not a.no_board and st['props'].startswith('ok'):
        try:
            rows, P, G, lg, errs = pull_props(a.week, ALL, slim=True)
            T = teams_of(G)
            games = {str(gid): [g.get('start_time'), (g.get('away_team') or {}).get('abbr'), (g.get('home_team') or {}).get('abbr'), (g.get('away_team') or {}).get('id'),
                                (g.get('home_team') or {}).get('id')] for gid, g in G.items()}
            players = {str(pid): [p.get('full_name'), p.get('position'), p.get('team_id')] for pid, p in P.items()}
            write_json(f'{a.out}/an_nfl_wk{a.week:02d}_allprops_{ts}.json', dict(pulled=pulled, week=a.week, cols=['type', 'an_gid', 'book_id', 'player_id', 'side', 'value', 'odds', 'alt', 'deeplink_id'],
                       rows=rows, players=players, games=games, teams=T, log=lg), compact=True)
            st['allprops'] = f'ok {len(rows)} rows' + (f' ({len(errs)} type errors)' if errs else ''); st['allprops_books'] = book_counts(rows, 2)
        except Blocked as e: st['allprops'] = f'blocked {e}'
        except Exception as e: st['allprops'] = f'error {e}'                   # noqa: BLE001
    try:
        rows = game_odds(a.week)
        write_json(f'{a.out}/an_nfl_wk{a.week:02d}_odds_{ts}.json', dict(pulled=pulled, cols=['an_gid', 'start', 'away', 'home', 'book_id', 'period', 'type', 'side', 'team', 'value', 'odds', 'alt', 'tickets_pct', 'money_pct'],
                   rows=rows), compact=True)
        st['odds'] = f'ok {len(rows)} rows'
    except Blocked as e: st['odds'] = f'blocked {e}'
    except Exception as e: st['odds'] = f'error {e}'                           # noqa: BLE001
    st['pulled'] = pulled
    write_json(f'{a.out}/an_status.json', st); log('action network', json.dumps(st))


if __name__ == '__main__':
    main()
