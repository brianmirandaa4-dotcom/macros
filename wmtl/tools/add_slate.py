"""Drop a new model run into the app.

    python3 tools/add_slate.py <slate.json> [--label "Week 9"] [--id nfl-2026-wk09]

<slate.json> is what the model already writes (code/web/export_wmtl.py -> schema wmtl.slate.v1), or a v2 file.
This script:
  1. upgrades it to wmtl.slate.v2 (tiers, betting windows, player keys) without changing a single model number,
  2. writes it to data/<sport>/<id-without-sport>.json,
  3. adds or replaces its row in data/index.json.
Then commit and push. The app picks it up on the next pull-to-refresh. No UI code changes, ever.

Grading and player histories come from tools/build_data.py, which needs the box-score files. Run it after the games.
"""
import json, sys, os, re, argparse
from datetime import datetime, timezone, timedelta

ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('--label'); ap.add_argument('--id'); ap.add_argument('--data', default=os.path.join(os.path.dirname(__file__), '..', 'data'))
a = ap.parse_args()
d = json.load(open(a.src))
assert d.get('schema') in ('wmtl.slate.v1', 'wmtl.slate.v2'), 'not a whomadethisline slate'
meta = d['meta']; sport = d.get('sport') or meta['sport']
TIER = {'recommended': 'bet', 'watch': 'live', 'lean': 'lean', 'check_news': 'check', 'pass': 'pass'}
def et(ts):
    t = datetime.fromisoformat(ts.replace('Z', '+00:00'))
    off = -4 if (3, 8) <= (t.month, t.day) < (11, 1) else -5  # close enough for window labels; kick times stay in UTC
    return t.astimezone(timezone(timedelta(hours=off)))
def window(g):
    if sport != 'NFL': return g.get('window') or g['slate']
    t = et(g['kick_utc']); wd = t.strftime('%a')
    return {'Thu': 'TNF', 'Mon': 'MNF', 'Sat': 'Sat'}.get(wd) or ('SNF' if t.hour >= 19 else '1 PM' if t.hour < 15 else '4 PM')
def norm(s): return re.sub(r'[^a-z0-9]+', ' ', str(s).lower()).strip()
order = []
for g in sorted(d['games'], key=lambda g: g['kick_utc']):
    g['window'] = window(g)
    if g['window'] not in order: order.append(g['window'])
gm = {g['id']: g for g in d['games']}
for p in d['props']:
    p['tier'] = p.get('tier') or TIER.get(p['classification'], 'pass'); p['window'] = gm[p['gid']]['window']
    if not p.get('pkey'):
        parts = p['id'].split('-')
        if sport == 'NFL' and len(parts) >= 4: p['pkey'] = 'nfl:' + '-'.join(parts[1:-1])
        elif sport == 'CFB': p['pkey'] = f"cfb:{norm(p['player'])}:{norm(p['team'])}"
        else: p['pkey'] = f"{sport.lower()}:{norm(p['player'])}"
meta['windows'] = order; meta['label'] = a.label or meta.get('label') or meta.get('date_label')
sid = a.id or d.get('id') or f"{sport.lower()}-{meta.get('date')}"
d.update(schema='wmtl.slate.v2', id=sid, sport=sport)
d.setdefault('parlays', dict(status='not_exported', items=[], note='This model run did not export parlay combinations, so none are shown.'))
d.setdefault('results', dict(status='pending', props={}, games={}))
rel = f"{sport.lower()}/{sid.split('-', 1)[1]}.json"; os.makedirs(os.path.join(a.data, sport.lower()), exist_ok=True)
json.dump(d, open(os.path.join(a.data, rel), 'w'), separators=(',', ':'), ensure_ascii=False)
ip = os.path.join(a.data, 'index.json'); idx = json.load(open(ip))
ks = sorted(g['kick_utc'] for g in d['games']); priced = [p for p in d['props'] if p.get('odds') is not None]
row = dict(id=sid, sport=sport, path='data/' + rel, label=meta['label'], date=meta.get('date'), date_label=meta.get('date_label'), week=meta.get('week'), start_utc=ks[0], end_utc=ks[-1],
           n_games=len(d['games']), n_props=len(d['props']), priced=len(priced), bets=sum(p['tier'] == 'bet' for p in d['props']), watch=sum(p['tier'] == 'live' for p in d['props']),
           leans=sum(p['tier'] == 'lean' for p in d['props']), model_version=meta.get('model_version'), generated_et=meta.get('generated_et'), prices_et=meta.get('prices_et'), results=dict(status=d['results'].get('status', 'pending')))
idx['slates'] = [s for s in idx['slates'] if s['id'] != sid] + [row]
idx['upcoming'] = [u for u in idx.get('upcoming', []) if not (u['sport'] == sport and u['label'] == meta['label'])]
idx['built_utc'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
json.dump(idx, open(ip, 'w'), indent=1, ensure_ascii=False)
print(f"added {sid}: {row['n_games']} games, {row['priced']} priced props, {row['bets']} bets -> data/{rel}")
