"""ESPN is the only injury source. Reads raw/espn/injuries.json (pulled from site.api.espn.com .../injuries) and writes:
  model/nfl_avail.csv   name|team|pos|status|p|note|source|date   (drop-in for code/nfl/avail.csv, read by factors.py)
  model/nfl_def_out.json {team: ["Name (status)"]}                  (drop-in for context.json def_out, C5 factor)
  model/nba_avail.csv   same columns
  data/injuries.json    for the app: {sport: {ts, by_id: {espn_id: [status, type, detail, return, date, comment]}}}
Play probability matches the CFB model's map: Out 0, Doubtful .25, Questionable .6, Probable .9.
When a player's p drops, the model's existing vacated-volume step (factor A4 + sim redistribution, mostly within the
same position, weighted by usage) hands his share to the teammates at his spot. Backups move only through that step.
CFB: ESPN publishes no current college injury report (its feed returns 3 stale 2020 rows), so CFB is the one
exception: it keeps the model's covers.com injury pull (code/cfb/today_rows.py), approved by Brian 2026-11-05."""
import json, os, sys, csv
RAW, OUT = sys.argv[1], sys.argv[2]
D = json.load(open(f'{RAW}/espn/injuries.json'))
AB = {'NFL': {'LAR': 'LA', 'WSH': 'WAS'}, 'NBA': {'GS': 'GSW', 'NY': 'NYK', 'SA': 'SAS', 'NO': 'NOP', 'UTAH': 'UTA', 'WSH': 'WAS'}}
P = {'Out': 0.0, 'Injured Reserve': 0.0, 'Suspension': 0.0, 'Doubtful': 0.25, 'Questionable': 0.6, 'Day-To-Day': 0.6, 'Probable': 0.9}
DEF = {'LB', 'ILB', 'OLB', 'MLB', 'CB', 'S', 'FS', 'SS', 'DB', 'DT', 'DE', 'NT', 'DL', 'EDGE'}
os.makedirs(f'{OUT}/model', exist_ok=True); app = {}
for sp, k in (('NFL', 'nfl'), ('NBA', 'nba')):
    rows = D[k]['rows']; app[k] = {'ts': D[k]['ts'], 'source': 'ESPN', 'by_id': {}}
    with open(f'{OUT}/model/{k}_avail.csv', 'w', newline='') as f:
        w = csv.writer(f, delimiter='|'); w.writerow(['name', 'team', 'pos', 'status', 'p', 'note', 'source', 'date'])
        for eid, name, pos, team, status, typ, fant, inj, ret, date, com in rows:
            team = AB[sp].get(team, team)
            if eid: app[k]['by_id'][eid] = [status, inj, fant, ret, date, com]
            if status not in P: continue          # 'Active' rows are cleared players: no availability cut
            w.writerow([name, team, pos, status, P[status], (com or '').replace('|', '/'), 'ESPN', date])
    if k == 'nfl':
        do = {}
        for eid, name, pos, team, status, *_ in rows:
            if pos in DEF and status in ('Out', 'Doubtful', 'Injured Reserve'):
                do.setdefault(AB['NFL'].get(team, team), []).append(f"{name} ({'IR' if status == 'Injured Reserve' else status})")
        json.dump(do, open(f'{OUT}/model/nfl_def_out.json', 'w'), indent=1)
app['cfb'] = {'ts': None, 'source': 'covers.com', 'by_id': {}, 'note': 'ESPN publishes no current college football injury report, so college injuries come from covers.com.'}
os.makedirs(f'{OUT}/data', exist_ok=True); json.dump(app, open(f'{OUT}/data/injuries.json', 'w'), separators=(',', ':'))
for k in ('nfl', 'nba'): print(k, sum(1 for _ in open(f'{OUT}/model/{k}_avail.csv')) - 1, 'availability rows;', len(app[k]['by_id']), 'ids for the app')
