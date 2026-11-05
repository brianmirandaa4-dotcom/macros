"""Overlay NFL · stage 1: put every ESPN number in one structure.
Organized as tensors, following Auddy, Xia & Yuan (2024) and Sun, Hao & Li (2021):
  X  player × game × stat        (box scores; sparse, stored as COO rows)            -> data/tensors/X_*.npy
  T  team × game-slot × stat     (team offense per game)                             -> T.npy
  A  defense × game-slot × stat  (what each defense allowed, split by position)      -> A.npy
Missing entries are real absences (did not play), never zeros we made up. The defense tensor is
denoised with a time-respecting low-rank (truncated HOSVD/SVD) projection before it feeds any question,
because 32 teams × a handful of games is noisy and the multilinear structure restricts sampling error.
Everything here is ESPN only: site.api.espn.com box scores, pickcenter lines, core-API positions."""
import json, numpy as np, pandas as pd, os
H = os.path.dirname(os.path.abspath(__file__)); OUT = f'{H}/store'; os.makedirs(OUT, exist_ok=True)
D = json.load(open(f'{H}/espn_nfl_2021_2026.json')); POS = json.load(open(f'{H}/positions.json'))
AB = {'LAR': 'LA', 'WSH': 'WAS'}; fx = lambda t: AB.get(t, t)
G = pd.DataFrame([g[:14] for g in D['games']], columns=['eid', 'date', 'season', 'week', 'away', 'asc', 'home', 'hsc', 'spread', 'total', 'det', 'indoor', 'temp', 'wx'])
G['away'] = G.away.map(fx); G['home'] = G.home.map(fx); G['date'] = pd.to_datetime(G.date)
G = G.sort_values('date').reset_index(drop=True); G['g'] = np.arange(len(G))
TS = {g[0]: g[14] for g in D['games']}
K = D['keep']; KI = {k: i for i, k in enumerate(K)}
def v(st, k, j=None):
    x = st[KI[k]]
    if isinstance(x, list): return x[j] if j is not None else x
    return x
gmap = dict(zip(G.eid, G.g)); gi_of = {i: g[0] for i, g in enumerate(D['games'])}
rows = []
for gi, tm, pi, st in D['rows']:
    eid = D['games'][gi][0]; pid, name, _ = D['players'][pi]; pos = (POS.get(pid) or [''])[0]
    ca = v(st, 'pa:C/ATT'); sk = v(st, 'pa:SACKS'); fg = v(st, 'ki:FG'); xp = v(st, 'ki:XP')
    rows.append(dict(g=gmap[eid], team=fx(tm), pid=pid, name=name, pos=pos,
        cmp=ca[0] if isinstance(ca, list) else np.nan, att=ca[1] if isinstance(ca, list) else np.nan,
        pyds=v(st, 'pa:YDS'), ptd=v(st, 'pa:TD'), pint=v(st, 'pa:INT'), sacks=sk[0] if isinstance(sk, list) else np.nan,
        car=v(st, 'ru:CAR'), ryds=v(st, 'ru:YDS'), rtd=v(st, 'ru:TD'), rlong=v(st, 'ru:LONG'),
        rec=v(st, 're:REC'), cyds=v(st, 're:YDS'), ctd=v(st, 're:TD'), clong=v(st, 're:LONG'), tgt=v(st, 're:TGTS'),
        fgm=fg[0] if isinstance(fg, list) else np.nan, fga=fg[1] if isinstance(fg, list) else np.nan,
        xpm=xp[0] if isinstance(xp, list) else np.nan, kpts=v(st, 'ki:PTS'), dsk=v(st, 'de:SACKS')))
PG = pd.DataFrame(rows).merge(G[['g', 'eid', 'date', 'season', 'week', 'away', 'home', 'asc', 'hsc', 'spread', 'total', 'indoor']], on='g')
PG['home_f'] = (PG.team == PG.home).astype(int); PG['opp'] = np.where(PG.home_f == 1, PG.away, PG.home)
PG['pf'] = np.where(PG.home_f == 1, PG.hsc, PG.asc); PG['pa'] = np.where(PG.home_f == 1, PG.asc, PG.hsc)
# home-perspective spread (ESPN pickcenter): team spread and market-implied team points
PG['tspread'] = np.where(PG.home_f == 1, PG.spread, -PG.spread)
PG['implied'] = PG.total / 2 - PG.tspread / 2
num = ['cmp', 'att', 'pyds', 'ptd', 'pint', 'sacks', 'car', 'ryds', 'rtd', 'rlong', 'rec', 'cyds', 'ctd', 'clong', 'tgt', 'fgm', 'fga', 'xpm', 'kpts', 'dsk']
PG[num] = PG[num].apply(pd.to_numeric, errors='coerce')
PG['td'] = PG.rtd.fillna(0) + PG.ctd.fillna(0)
# team-game (offense) from box rows + ESPN team stats
TG = PG.groupby(['g', 'team']).agg(att=('att', 'sum'), sacks=('sacks', 'sum'), pyds=('pyds', 'sum'), car=('car', 'sum'), ryds=('ryds', 'sum'), tgt=('tgt', 'sum'), rec=('rec', 'sum'),
                                   cyds=('cyds', 'sum'), td=('td', 'sum'), rtd=('rtd', 'sum'), ctd=('ctd', 'sum'), kpts=('kpts', 'sum'), fga=('fga', 'sum'), xpa=('xpm', 'sum')).reset_index()
TG = TG.merge(PG.drop_duplicates(['g', 'team'])[['g', 'team', 'opp', 'season', 'week', 'date', 'pf', 'pa', 'home_f', 'tspread', 'implied', 'total', 'indoor']], on=['g', 'team'])
def tstat(r, k):
    t = TS.get(G.eid[r.g], {}).get({'LA': 'LAR', 'WAS': 'WSH'}.get(r.team, r.team), {}); return t.get(k)
TG['plays'] = [pd.to_numeric(tstat(r, 'totalOffensivePlays'), errors='coerce') for r in TG.itertuples()]
rz = [str(tstat(r, 'redZoneAttempts') or '') for r in TG.itertuples()]
TG['rz_m'] = [float(x.split('-')[0]) if '-' in x else np.nan for x in rz]; TG['rz_a'] = [float(x.split('-')[1]) if '-' in x else np.nan for x in rz]
TG['dropbacks'] = TG.att + TG.sacks
# what each defense allowed, split by the position that gained it (the A tensor)
grp = lambda p: p if p in ('QB', 'RB', 'WR', 'TE') else ('RB' if p == 'FB' else 'X')
PG['pg'] = PG.pos.map(grp)
al = PG[PG.pg != 'X'].pivot_table(index=['g', 'opp'], columns='pg', values=['cyds', 'rec', 'tgt', 'ryds', 'car', 'td'], aggfunc='sum').fillna(0)
al.columns = [f'{a}_{b}' for a, b in al.columns]; al = al.reset_index().rename(columns={'opp': 'team'})
DF = TG[['g', 'team', 'opp', 'season', 'date', 'pyds', 'att', 'dropbacks', 'sacks', 'pf', 'plays', 'rz_m', 'rz_a', 'kpts', 'fga', 'xpa', 'rtd', 'ctd']].rename(columns={'team': 'off', 'opp': 'team'})
DF = DF.merge(al, on=['g', 'team'], how='left')   # row = defense `team` in game g, columns = what its opponent gained
DF['qb_ryds'] = DF.get('ryds_QB', 0); DF['qb_car'] = DF.get('car_QB', 0)
AK = ['pyds', 'dropbacks', 'sacks', 'pf', 'plays', 'rz_m', 'rz_a', 'kpts', 'fga', 'xpa', 'rtd', 'ctd', 'ryds_RB', 'car_RB', 'qb_ryds', 'qb_car',
      'cyds_WR', 'cyds_TE', 'cyds_RB', 'rec_WR', 'rec_TE', 'rec_RB', 'tgt_WR', 'tgt_TE', 'tgt_RB', 'td_RB', 'td_WR', 'td_TE']
for k in AK:
    if k not in DF: DF[k] = 0.0
# A tensor: defense (32) × game slot (chronological per team) × stat
teams = sorted(TG.team.unique()); tix = {t: i for i, t in enumerate(teams)}
DF = DF.sort_values(['team', 'date']); DF['slot'] = DF.groupby('team').cumcount()
A = np.full((len(teams), DF.slot.max() + 1, len(AK)), np.nan)
for r in DF.itertuples(): A[tix[r.team], r.slot] = [getattr(r, k) for k in AK]
np.save(f'{OUT}/A.npy', A); json.dump(dict(teams=teams, stats=AK), open(f'{OUT}/A_axes.json', 'w'))
TGs = TG.sort_values(['team', 'date']).copy(); TGs['slot'] = TGs.groupby('team').cumcount()
TK = ['att', 'dropbacks', 'pyds', 'car', 'ryds', 'tgt', 'rec', 'cyds', 'td', 'pf', 'pa', 'plays', 'kpts', 'fga', 'xpa']
T = np.full((len(teams), TGs.slot.max() + 1, len(TK)), np.nan)
for r in TGs.itertuples(): T[tix[r.team], r.slot] = [getattr(r, k) for k in TK]
np.save(f'{OUT}/T.npy', T); json.dump(dict(teams=teams, stats=TK), open(f'{OUT}/T_axes.json', 'w'))
# X tensor as COO (player, game, stat)
P = sorted(PG.pid.unique()); pix = {p: i for i, p in enumerate(P)}; XK = num + ['td']
co = [(pix[r.pid], r.g, j, getattr(r, k)) for r in PG.itertuples() for j, k in enumerate(XK) if pd.notna(getattr(r, k))]
np.save(f'{OUT}/X_coo.npy', np.array(co, dtype=np.float64)); json.dump(dict(players=P, games=G.eid.tolist(), stats=XK, shape=[len(P), len(G), len(XK)]), open(f'{OUT}/X_axes.json', 'w'))
G.to_parquet(f'{OUT}/games.parquet'); PG.to_parquet(f'{OUT}/player_games.parquet'); TG.to_parquet(f'{OUT}/team_games.parquet'); DF.to_parquet(f'{OUT}/defense_games.parquet')
print('games', len(G), 'player-games', len(PG), 'X nnz', len(co), 'T', T.shape, 'A', A.shape, 'positions known', round((PG.pos != '').mean(), 3))
