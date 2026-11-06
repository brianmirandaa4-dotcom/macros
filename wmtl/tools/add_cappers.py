"""Attach the approved cappers' verified Action Network picks to a slate (Koerner, Giffen, Anderson only).
Capper picks never change a model number. Each pick is matched to the model's own prop (same player, market, line);
the comparison copies the model's side and chance. The app may rank agreeing picks higher; it never edits probabilities.
Usage: python3 tools/add_cappers.py data/nfl/<slate>.json <an_cappers.json>"""
import json, sys, re, unicodedata
SL, CP = sys.argv[1], sys.argv[2]
d = json.load(open(SL)); c = json.load(open(CP))
APPROVED = {'Brandon Anderson', 'Sean Koerner', 'Nick Giffen'}
MK = {'Recs': 'receptions', 'Rec Yds': 'rec_yds', 'Rush Yds': 'rush_yds', 'Pass Yds': 'pass_yds'}
ALIAS = {'JAC': 'JAX', 'LAR': 'LA'}
def norm(s): return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()).strip()
teams = {t for g in d['games'] for t in (g['away']['abbr'], g['home']['abbr'])}
recs, picks = [], []
for cap in c['cappers']:
    if cap['name'] not in APPROVED: continue
    r = cap['record']; recs.append(dict(name=cap['name'], bets=r['bets'], w=r['w'], l=r['l'], p=r['p'], units=r['units'], roi=r['roi'], props=r['props']))
    for k in cap['picks']:
        if k['created_at'] >= k['starts_at']: continue                                   # posted before kickoff only
        gt = {ALIAS.get(t, t) for t in k['teams']}
        if not gt <= teams: continue
        m = re.match(r'^([A-Z])\.\s*([A-Za-z\'\-\. ]+?)\s+([ou])(\d+(?:\.\d+)?)\s+(.+)$', k['play'])
        match = None; market = side = line = None
        if m and m.group(5) in MK:
            ini, last, side, line, market = m.group(1).lower(), norm(m.group(2)), 'over' if m.group(3) == 'o' else 'under', float(m.group(4)), MK[m.group(5)]
            for p in d['props']:
                pn = norm(p['player']).split()
                if p['market'] == market and p['line'] == line and pn and pn[0][0] == ini and last in ' '.join(pn[1:]) and p['team'] in gt: match = p; break
        cmp = None
        if match and match.get('side') and match.get('p_raw') is not None:
            ps = match['p_raw'] if match['side'] == side else round(1 - match['p_raw'], 3)
            cmp = dict(prop=match['id'], model_side=match['side'], agree=match['side'] == side, p_capper_side=ps, projection=match['projection'], tier=match['tier'])
        picks.append(dict(capper=cap['name'], play=k['play'], market=market, side=side, line=line, odds=k['odds'], units=k['units'], created_at=k['created_at'], verified=k['verified'], model=cmp))
d['cappers'] = dict(source='Action Network verified picks', pulled=c['pulled'], weight=0,
                    note='Shown for information and ranking only. Capper picks never change the model\'s numbers; when a pro agrees with the model\'s side, that pick is ranked higher.',
                    records=recs, picks=sorted(picks, key=lambda x: x['created_at']))
json.dump(d, open(SL, 'w'), separators=(',', ':'))
print(SL.split('/')[-1], 'picks', len(picks), 'matched', sum(1 for p in picks if p['model']), 'agree', sum(1 for p in picks if p['model'] and p['model']['agree']))
