"""Builds styleguide.html from styleguide.tmpl.html plus real model data (qa/sg_data.json + data/*)."""
import json, sys
from collections import Counter
root = sys.argv[1] if len(sys.argv) > 1 else '.'
sg = json.load(open('/home/claude/qa/sg_data.json'))
idx = json.load(open(f'{root}/data/index.json'))
cfb = json.load(open(f'{root}/data/cfb/2026-wk08.json'))
nfl = json.load(open(f'{root}/data/nfl/2026-wk08.json'))
res = cfb['results']['props']
for b in sg['bets']:
    pid = next(p['id'] for p in cfb['props'] if p['player'] == b['player'] and p.get('tier') == 'bet')
    b['res'] = res.get(pid)
W = Counter(p.get('window') for p in cfb['props']); WB = Counter(p.get('window') for p in cfb['props'] if p.get('tier') == 'bet')
sg['windows'] = [[w, W.get(w, 0), WB.get(w, 0)] for w in cfb['meta']['windows']]
latest = {}
for s in idx['slates']:
    latest.setdefault(s['sport'], s)
sg['sports'] = {k: {'label': v['label'], 'bets': v.get('bets', 0)} for k, v in latest.items()}
rows = sorted(nfl['props'], key=lambda p: -abs(p.get('score25') or 0))[:12]
sg['rows'] = [dict(player=p['player'], team=p['team'], opp=p['opp'], market=p['market_label'], side=p['side'], line=p['line'], score=p.get('score25'), tier=p.get('tier'), p=p.get('p'), be=p.get('break_even'), proj=p.get('projection'), r80=p.get('range80')) for p in rows]
ps = next(p for p in nfl['props'] if p.get('tier') == 'pass' and p.get('line') is not None and (p.get('p') or 0) > .3 and p.get('break_even'))
sg['pass_ex'] = dict(player=ps['player'], market=ps['market_label'], side=ps['side'], line=ps['line'], p=ps['p'], be=ps['break_even'], edge=ps.get('edge_pts'))
# real bankroll: every graded 'bet' tier play, 1 unit each, in kickoff order
pts, bank = [], 0.0
for s in sorted(idx['slates'], key=lambda s: s.get('start_utc') or ''):
    try: d = json.load(open(f"{root}/{s['path']}"))
    except Exception: continue
    R = (d.get('results') or {}).get('props') or {}
    for p in sorted([p for p in d['props'] if p.get('tier') == 'bet'], key=lambda p: p.get('kick') or ''):
        r = R.get(p['id'])
        if not r or r.get('result') not in ('won', 'lost', 'push'): continue
        o = p['odds']; win = (100 / -o) if o < 0 else o / 100
        bank += win if r['result'] == 'won' else (-1 if r['result'] == 'lost' else 0)
        pts.append({'v': round(bank, 2), 't': f"{s['sport']} {s['label']} · {p['player']} {p['side']} {p['line']} · {r['result']}"})
sg['bank'] = [{'v': 0, 't': 'Start'}] + pts
html = open(f'{root}/styleguide.tmpl.html').read().replace('__DATA__', json.dumps(sg, separators=(',', ':')).replace('</', '<\\/'))
open(f'{root}/styleguide.html', 'w').write(html)
print('ok', len(html), sg['windows'], sg['sports'], len(sg['bank']), sg['pass_ex'])
