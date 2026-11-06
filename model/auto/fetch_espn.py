"""ESPN pulls (site.api.espn.com and sports.core.api.espn.com only), every payload schema-checked.

    python3 model/auto/fetch_espn.py --week 9 --out model/nfl/raw/espn

Writes (each only when its pull passed the schema check; a failed pull leaves no file, so callers keep the last good data):
  scoreboard.json   {"ts", "week", "events": [{eid, kick_utc, week, home, away, state, completed, odds}]}
  injuries.json     {"nfl": {"ts", "rows": [[espn_id, name, pos, team, status, type, fantasy, injury, return, date, comment]]}}
                    (the exact input tools/espn_injuries.py reads)
  summaries.json    {"ts", "games": {eid: {"statuses": [[espn_id, name, team, status]]}}}  injuries + inactives per not-started game
  dk_lines.json     {"ts", "provider", "rows": [[eid, espn_id, market, line, line_open, updated, over, under]], "sample_keys"}
  status.json       {"scoreboard": "ok"|"error ...", ...}  what happened to each pull
"""
import argparse, os, re, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concurrent.futures import ThreadPoolExecutor
from common import SchemaError, need, http_json, write_json, now_utc, iso, log, SEASON, ESPN_TO_NFLVERSE

SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl'
AB = lambda t: ESPN_TO_NFLVERSE.get(t, t)
PROP_MARKET = [   # ESPN prop type name (lower case) -> model market; first match wins, combos/ladders/longest are skipped
    ('passing yards', 'pass_yds'), ('receiving yards', 'rec_yds'), ('receptions', 'receptions'), ('rushing yards', 'rush_yds'),
    ('rushing attempts', 'carries'), ('completions', 'pass_cmp'), ('passing attempts', 'pass_att'), ('kicking points', 'kick_pts')]
SKIP_WORDS = ('longest', 'milestone', '+', ' and ', 'first', 'quarter', 'half', 'alt ', 'alternate')


def scoreboard(week, season=SEASON):
    j = http_json(f'{SITE}/scoreboard?dates={season}&seasontype=2&week={week}', what='espn scoreboard')
    evs = need(j, 'events', list, 'espn scoreboard')
    out = []
    for e in evs:
        c = need(e, 'competitions.0', dict, 'espn event'); comp = need(c, 'competitors', list, 'espn event')
        side = {x.get('homeAway'): AB(need(x, 'team.abbreviation', str, 'espn competitor')) for x in comp}
        if set(side) != {'home', 'away'}: raise SchemaError('espn event: competitors lack home/away')
        st = need(c, 'status.type', dict, 'espn status')
        odds = []
        for o in c.get('odds') or []:
            odds.append(dict(provider=(o.get('provider') or {}).get('name'), details=o.get('details'), spread=o.get('spread'), over_under=o.get('overUnder')))
        out.append(dict(eid=str(need(e, 'id', str, 'espn event')), kick_utc=need(e, 'date', str, 'espn event'), week=(e.get('week') or {}).get('number', week),
                        home=side['home'], away=side['away'], state=st.get('state'), completed=bool(st.get('completed')), odds=odds))
    if not out: raise SchemaError('espn scoreboard: no events')
    return out


def _aid(a):
    """ESPN athlete id from an athlete object (id field, $ref or profile link)."""
    if not isinstance(a, dict): return None
    if a.get('id'): return str(a['id'])
    for s in [a.get('$ref', '')] + [l.get('href', '') for l in a.get('links') or [] if isinstance(l, dict)]:
        m = re.search(r'/(?:athletes|id)/(\d+)', s or '')
        if m: return m.group(1)
    return None


def injuries():
    j = http_json(f'{SITE}/injuries', what='espn injuries')
    groups = need(j, 'injuries', list, 'espn injuries')
    rows = []
    for g in groups:
        for i in need(g, 'injuries', list, 'espn injuries team'):
            a = need(i, 'athlete', dict, 'espn injury'); st = need(i, 'status', str, 'espn injury')
            team = (a.get('team') or {}).get('abbreviation') or (g.get('abbreviation'))
            d = i.get('details') or {}; fs = d.get('fantasyStatus') or {}
            rows.append([_aid(a), a.get('displayName'), (a.get('position') or {}).get('abbreviation'), AB(team) if team else None, st,
                         (i.get('type') or {}).get('abbreviation'), fs.get('abbreviation') or fs.get('description'), d.get('type'), d.get('returnDate'),
                         i.get('date'), i.get('shortComment')])
    if len(rows) < 50: raise SchemaError(f'espn injuries: only {len(rows)} rows (expected hundreds in season)')
    if sum(1 for r in rows if r[0]) < 0.9 * len(rows): raise SchemaError('espn injuries: athlete ids missing on >10% of rows')
    return rows


def _walk_status(o, out, team=None):
    """Collect (athlete, status) pairs anywhere in a summary payload; 'inactive' lists count as status Inactive."""
    if isinstance(o, dict):
        tm = (o.get('team') or {}).get('abbreviation') if isinstance(o.get('team'), dict) else None
        tm = AB(tm) if tm else team
        if isinstance(o.get('athlete'), dict):
            st = o.get('status')
            st = st if isinstance(st, str) else (st or {}).get('name') if isinstance(st, dict) else None
            if st: out.append([_aid(o['athlete']), o['athlete'].get('displayName'), tm, st])
        for k, v in o.items():
            if 'inactive' in str(k).lower() and isinstance(v, list):
                for x in v:
                    a = x.get('athlete', x) if isinstance(x, dict) else None
                    if isinstance(a, dict) and _aid(a): out.append([_aid(a), a.get('displayName'), tm, 'Inactive'])
            elif isinstance(v, (dict, list)): _walk_status(v, out, tm)
    elif isinstance(o, list):
        for x in o: _walk_status(x, out, team)


def summary(eid):
    j = http_json(f'{SITE}/summary?event={eid}', what='espn summary')
    need(j, 'header.competitions.0.competitors', list, 'espn summary')
    st = []; _walk_status({k: j.get(k) for k in ('injuries', 'rosters', 'inactives', 'boxscore') if k in j}, st)
    seen = {}; [seen.__setitem__((r[0], r[3]), r) for r in st if r[0]]
    return dict(statuses=list(seen.values()))


def _num(x):
    try: return float(str(x).replace('o', '').replace('u', '').replace('+', '')) if x is not None and str(x).strip() != '' else None
    except ValueError: return None


def _dig(o, *paths):
    for p in paths:
        cur = o
        for k in p.split('.'):
            cur = cur.get(k) if isinstance(cur, dict) else None
            if cur is None: break
        v = _num(cur.get('value') if isinstance(cur, dict) else cur)
        if v is not None: return v
    return None


def provider_for(eid):
    """The DraftKings odds provider id for this event (ESPN lists providers per competition)."""
    j = http_json(f'{CORE}/events/{eid}/competitions/{eid}/odds?lang=en&region=us', what='espn odds providers')
    for it in need(j, 'items', list, 'espn odds providers'):
        p = it.get('provider') if isinstance(it, dict) else None
        if p is None and isinstance(it, dict) and it.get('$ref'):
            it = http_json(it['$ref'].replace('http://', 'https://'), what='espn odds provider'); p = it.get('provider')
        if isinstance(p, dict) and 'draftkings' in str(p.get('name', '')).lower(): return str(p.get('id'))
    return None


def prop_lines(eid):
    pid = provider_for(eid)
    if not pid: raise SchemaError(f'espn odds: no DraftKings provider for event {eid}')
    rows, page, sample = [], 1, None
    while True:
        j = http_json(f'{CORE}/events/{eid}/competitions/{eid}/odds/{pid}/propBets?lang=en&region=us&limit=1000&page={page}', what='espn propBets')
        items = need(j, 'items', list, 'espn propBets')
        if items and set(items[0]) <= {'$ref'}: raise SchemaError('espn propBets: items are bare $refs')
        for it in items:
            sample = sample or sorted(it)
            nm = str((it.get('type') or {}).get('name') or (it.get('type') or {}).get('displayName') or '').lower()
            if not nm or any(w in nm for w in SKIP_WORDS): continue
            mk = next((m for k, m in PROP_MARKET if k in nm), None)
            aid = _aid(it.get('athlete') or {})
            if not mk or not aid: continue
            line = _dig(it, 'current.target', 'odds.total', 'total', 'current.total')
            if line is None: continue
            rows.append([eid, aid, mk, line, _dig(it, 'open.target', 'open.total'), it.get('lastModified') or it.get('lastUpdated'),
                         _dig(it, 'current.over.american', 'odds.over.american', 'over.american'), _dig(it, 'current.under.american', 'odds.under.american', 'under.american')])
        if page >= int(j.get('pageCount') or 1): break
        page += 1
    return pid, rows, sample


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--week', type=int, required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--skip-props', action='store_true')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); ts = iso(now_utc()); status = {}
    evs = []
    try:
        evs = scoreboard(a.week); write_json(f'{a.out}/scoreboard.json', dict(ts=ts, week=a.week, events=evs)); status['scoreboard'] = f'ok {len(evs)} events'
    except Exception as e: status['scoreboard'] = f'error {e}'                 # noqa: BLE001
    try:
        rows = injuries(); write_json(f'{a.out}/injuries.json', dict(nfl=dict(ts=ts, rows=rows))); status['injuries'] = f'ok {len(rows)} rows'
    except Exception as e: status['injuries'] = f'error {e}'                  # noqa: BLE001
    pre = [e for e in evs if e['state'] == 'pre']
    if pre:
        with ThreadPoolExecutor(6) as ex:
            res = dict(zip([e['eid'] for e in pre], ex.map(lambda e: _safe(summary, e['eid']), pre)))
        ok = {k: v for k, v in res.items() if not isinstance(v, Exception)}
        bad = {k: str(v)[:160] for k, v in res.items() if isinstance(v, Exception)}
        if ok: write_json(f'{a.out}/summaries.json', dict(ts=ts, games=ok))
        status['summaries'] = f'ok {len(ok)}/{len(pre)}' + (f' errors {bad}' if bad else '')
        if not a.skip_props:
            with ThreadPoolExecutor(4) as ex:
                pr = dict(zip([e['eid'] for e in pre], ex.map(lambda e: _safe(prop_lines, e['eid']), pre)))
            good = {k: v for k, v in pr.items() if not isinstance(v, Exception)}
            rows = [r for _, rr, _ in good.values() for r in rr]
            errs = {k: str(v)[:160] for k, v in pr.items() if isinstance(v, Exception)}
            if rows:
                write_json(f'{a.out}/dk_lines.json', dict(ts=ts, provider=sorted({p for p, _, _ in good.values()}), rows=rows,
                                                          sample_keys=next((s for _, _, s in good.values() if s), None), events=sorted(good)))
            status['dk_lines'] = (f'ok {len(rows)} rows from {len(good)}/{len(pre)} games' if rows else 'error no rows parsed') + (f' errors {errs}' if errs else '')
    else:
        status['summaries'] = status['dk_lines'] = 'skipped: no pre-game events'
    write_json(f'{a.out}/status.json', status)
    log('espn', json.dumps(status)[:600])


def _safe(f, *a):
    try: return f(*a)
    except Exception as e: return e                                           # noqa: BLE001


if __name__ == '__main__':
    main()
