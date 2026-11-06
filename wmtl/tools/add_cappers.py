"""Attach approved cappers' verified Action Network picks to a slate file (display only).
Capper picks never move a model number. For each pick we look up the model's own prop at the same player,
market and line; the comparison numbers are copied from that prop (p_raw, projection), never computed here.
Usage: python3 tools/add_cappers.py data/nfl/<slate>.json <cappers.json>"""
import json, sys, re, unicodedata
SL, CP = sys.argv[1], sys.argv[2]
d = json.load(open(SL)); c = json.load(open(CP))
APPROVED = {'Brandon Anderson', 'Sean Koerner', 'Nick Giffen'}
def norm(s): return re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()).strip()
teams = {t for g in d['games'] for t in (g['away']['abbr'], g['home']['abbr'])}
alias = {'JAC': 'JAX'}
recs, picks = [], []
for cap in c['cappers']:
    if cap['name'] not in APPROVED: continue
    r = cap['record']; recs.append(dict(name=cap['name'], bets=r['bets'], w=r['w'], l=r['l'], p=r['p'], units=r['units'], roi=r['roi'], props=r['props'], updated=r['updated']))
    for k in cap['picks']:
        if k['created_at'] >= k['starts_at']: continue            # must be timestamped before kickoff
        gt = {alias.get(t, t) for t in re.split(r'[@ ]', k['game']) if t}
        if not gt <= teams: continue                                 # pick is for a game on another slate
        m = None
        if k.get('player'):
            for p in d['props']:
                if norm(p['player']) == norm(k['player']) and p['market'] == k['market'] and p['line'] == k['value']: m = p; break
        cmp = None
        if m:
            ps = m['p_raw'] if m['side'] == k['side'] else round(1 - m['p_raw'], 3)
            cmp = dict(prop=m['id'], model_side=m['side'], agree=m['side'] == k['side'], p_capper_side=ps, projection=m['projection'], tier=m['tier'])
        picks.append(dict(capper=cap['name'], play=k['play'], market=k['market'], side=k['side'], player=k.get('player'), team=alias.get(k['team'], k['team']),
                          line=k['value'], odds=k['odds'], units=k['units'], created_at=k['created_at'], verified=k['verified'], model=cmp))
d['cappers'] = dict(source='Action Network verified picks', pulled=c['pulled'], weight=0,
                    note='Shown for information. Capper picks are not a model input yet: there is no graded pick history to test them on, so their weight is 0 until archived picks are backtested.',
                    records=recs, picks=sorted(picks, key=lambda x: x['created_at']))
json.dump(d, open(SL, 'w'), separators=(',', ':'))
print('picks on slate', len(picks), 'matched to a model prop', sum(1 for p in picks if p['model']))
