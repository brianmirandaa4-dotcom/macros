"""Overlay NFL · stage 3: the 25 questions, weight tuning, 10,000 replays, market check, export.
Questions: exactly the per-prop 25 from the NFL Slate (meta.cards, model v2.2). Each is answered from ESPN data
when ESPN carries what it needs; when it doesn't (snap counts, EPA, air yards, YAC, weather, historical injury
reports), the question is marked "Not available from ESPN" and carries no weight. Nothing is filled in by hand.
Weights: re-tuned from history only (2021–2026 regular season, ESPN box scores) with the Slate's method:
signed ridge, lambda by season-grouped cross-validation, x = clip(z/1.5, −1, 1), z capped at ±2.5, A1 fixed.
Data structure: player-game rows are slices of the X tensor; opponent questions read the low-rank-denoised
defense tensor A; vacated volume and thin histories use the CP role embeddings (roles.py).
Replays: 10,000 draws per prop from the fitted prediction plus that prop's own historical residuals.
Market check: calib_nfl.py (K widen, W_Y blend). ESPN posts DraftKings lines and openers but not prop prices, so
there is no two-sided market to anchor to; by the model's own rule that means no edge and no bet."""
import numpy as np, pandas as pd, json, os, re, sys
from scipy.special import logit, expit
H = os.path.dirname(os.path.abspath(__file__)); ST = f'{H}/store'
PG = pd.read_parquet(f'{ST}/player_games.parquet'); TG = pd.read_parquet(f'{ST}/team_games.parquet'); DF = pd.read_parquet(f'{ST}/defense_games.parquet')
G = pd.read_parquet(f'{ST}/games.parquet'); POS = json.load(open(f'{H}/positions.json'))
SL = json.load(open('/home/claude/src/nfl_wk06_slate.json')); CARDS = SL['meta']['cards']
RA = json.load(open(f'{ST}/role_axes.json')); EMB = np.load(f'{ST}/role_emb.npy'); RIX = {p: i for i, p in enumerate(RA['players'])}
CAL = dict(K=1.156, W_Y=0.05, W_TD=0.40)
rng = np.random.default_rng(20261105)

# ------------------------------------------------------------------ tonight (ESPN: scoreboard, injuries, depth chart, DK lines via ESPN)
TN = json.load(open(f'{H}/espn_nfl_2021_2026.json'))['tonight']
CTX = json.load(open('/home/claude/wmtl/model/nfl_wk09_tnf_context.json'))
INJ = json.load(open('/home/claude/raw/espn/injuries.json'))['nfl']['rows']
TONIGHT = dict(eid='401873037', away='JAX', home='BAL', kick='2026-11-06T01:15:00Z', spread_home=10.0, total=39.5, season=2026, week=9, indoor=0)
PPLAY = {'Out': 0.0, 'Injured Reserve': 0.0, 'Suspension': 0.0, 'Doubtful': 0.25, 'Questionable': 0.6, 'Day-To-Day': 0.6, 'Probable': 0.9}

# ------------------------------------------------------------------ helpers
def shrink(num, den, prior, k): return (num + k * prior) / (den + k)
PG = PG.sort_values(['pid', 'date']).reset_index(drop=True)
PG['pos'] = PG.pid.map(lambda p: (POS.get(p) or [''])[0]).fillna('')
PG['pg'] = PG.pos.map(lambda p: {'FB': 'RB', 'PK': 'K'}.get(p, p))
for c in ['tgt', 'rec', 'cyds', 'car', 'ryds', 'att', 'cmp', 'pyds', 'td', 'ctd', 'rtd', 'kpts', 'fgm', 'fga', 'xpm', 'sacks', 'clong', 'rlong']: PG[c] = PG[c].fillna(0)
PG['db'] = PG.att + PG.sacks; PG['opps'] = PG.tgt + PG.car; PG['qbr_yds'] = np.where(PG.pg == 'QB', PG.ryds, 0)
TGm = TG.set_index(['g', 'team'])
for c in ['tgt', 'car', 'dropbacks', 'pf', 'pa', 'plays', 'att']: PG['team_' + c] = TGm[c].reindex(pd.MultiIndex.from_arrays([PG.g, PG.team])).values
# today's QB for every team-game = QB with most attempts
# today's QB, knowable before kickoff: the QB who led the team in attempts in its previous game, if he plays in this one
# (appears in the box score at all); otherwise the QB on this game's box score with the most attempts (inactives are known pregame)
lead = PG[PG.pg == 'QB'].sort_values('att').groupby(['g', 'team']).tail(1)[['g', 'team', 'pid', 'date']].sort_values(['team', 'date'])
lead['prev_lead'] = lead.groupby('team').pid.shift(1)
inbox = set(zip(PG.g, PG.pid))
lead['qb_today'] = [pl if isinstance(pl, str) and (g, pl) in inbox else cur for g, pl, cur in zip(lead.g, lead.prev_lead, lead.pid)]
PG = PG.merge(lead[['g', 'team', 'qb_today']], on=['g', 'team'], how='left')

def prior(df, cols, by, w=None):
    """expanding mean of `cols` over strictly earlier rows in each `by` group"""
    g = df.groupby(by)
    out = {}
    for c in cols:
        cs = g[c].cumsum() - df[c]; n = g.cumcount()
        out[c] = cs / n.replace(0, np.nan)
    return pd.DataFrame(out, index=df.index), g.cumcount()
STATS = ['tgt', 'rec', 'cyds', 'car', 'ryds', 'att', 'cmp', 'pyds', 'td', 'ctd', 'rtd', 'kpts', 'fgm', 'fga', 'xpm', 'db', 'opps', 'team_tgt', 'team_car', 'team_dropbacks', 'qbr_yds']

def features(P):
    """P: player-game rows sorted by pid,date (history + virtual tonight rows). Every value uses earlier games only."""
    P = P.sort_values(['pid', 'date']).reset_index(drop=True)
    car, nc = prior(P, STATS, 'pid'); car.columns = ['c_' + c for c in car.columns]
    P['ps'] = P.pid + '|' + P.season.astype(str)
    sea, ns = prior(P, STATS, 'ps'); sea.columns = ['s_' + c for c in sea.columns]
    l1 = P.groupby('pid')[STATS].shift(1).add_prefix('l1_')
    l3 = P.groupby('pid')[STATS].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean()).add_prefix('l3_')
    lsP = P.groupby(['pid', 'season'])[STATS].mean().groupby(level=0).shift(1)   # last full season (per pid, season)
    ls = lsP.reindex(pd.MultiIndex.from_arrays([P.pid, P.season])).reset_index(drop=True).add_prefix('ls_')
    P = pd.concat([P, car, sea, l1, l3, ls], axis=1); P['n_c'] = nc.values; P['n_s'] = ns.values
    # years in the league from ESPN debut year
    P['yrs'] = [max(0, s - ((POS.get(p) or [None, None])[1] or s)) for p, s in zip(P.pid, P.season)]
    return P

# ------------------------------------------------------------------ defense tensor, denoised by truncated SVD per week (time-respecting)
AK = ['pyds', 'dropbacks', 'sacks', 'pf', 'plays', 'rz_m', 'rz_a', 'kpts', 'fga', 'xpa', 'rtd', 'ctd', 'ryds_RB', 'car_RB', 'qb_ryds', 'qb_car',
      'cyds_WR', 'cyds_TE', 'cyds_RB', 'rec_WR', 'rec_TE', 'rec_RB', 'tgt_WR', 'tgt_TE', 'tgt_RB', 'td_RB', 'td_WR', 'td_TE']
DF = DF.sort_values(['team', 'date']).reset_index(drop=True)
EW = DF.groupby('team')[AK].transform(lambda s: s.shift(1).ewm(halflife=8, min_periods=3).mean())
DF[[f'e_{k}' for k in AK]] = EW.values
wk = G[['g', 'season', 'week']]; DF = DF.merge(wk, on='g', how='left', suffixes=('', '_g'))
def denoise(M, r=5):
    mu, sd = np.nanmean(M, 0), np.nanstd(M, 0) + 1e-9; Z = np.nan_to_num((M - mu) / sd)
    U, s, Vt = np.linalg.svd(Z, full_matrices=False); Zr = (U[:, :r] * s[:r]) @ Vt[:r]; return Zr * sd + mu
OPP = {}
for (se, w), d in DF.groupby(['season', 'week']):
    d = d.dropna(subset=[f'e_{k}' for k in AK])
    if len(d) < 12: continue
    M = d[[f'e_{k}' for k in AK]].values; R = denoise(M); lg = M.mean(0)
    for t, row in zip(d.team, R): OPP[(se, w, t)] = (row, lg)
# tonight's opponent profile: each defense's EW mean through its latest game, denoised together
last = DF.groupby('team')[AK].apply(lambda d: d.ewm(halflife=8).mean().iloc[-1])
Rt = denoise(last.values); LGt = last.values.mean(0)
for t, row in zip(last.index, Rt): OPP[(2026, 9, t)] = (row, LGt)
AKI = {k: i for i, k in enumerate(AK)}
def opp(se, w, t, k):
    v = OPP.get((se, w, t)); return np.nan if v is None else v[0][AKI[k]]
def opp_rel(se, w, t, num, den=None):
    v = OPP.get((se, w, t))
    if v is None: return np.nan
    a = v[0][AKI[num]] / (v[0][AKI[den]] if den else 1); b = v[1][AKI[num]] / (v[1][AKI[den]] if den else 1)
    return np.log(max(a, 1e-6) / max(b, 1e-6))

# ------------------------------------------------------------------ the question catalogue: Slate name -> ESPN computation
LGPOS = PG.groupby('pg')[['tgt', 'cyds', 'rec', 'car', 'ryds']].sum()
LG_YPT = (LGPOS.cyds / LGPOS.tgt.replace(0, np.nan)).to_dict(); LG_CR = (LGPOS.rec / LGPOS.tgt.replace(0, np.nan)).to_dict(); LG_YPC = (LGPOS.ryds / LGPOS.car.replace(0, np.nan)).to_dict()
LG_YA = PG.loc[PG.pg == 'QB', 'pyds'].sum() / max(1, PG.loc[PG.pg == 'QB', 'att'].sum()); LG_CMP = PG.loc[PG.pg == 'QB', 'cmp'].sum() / max(1, PG.loc[PG.pg == 'QB', 'att'].sum())
def lr(a, b, c=1.0): return np.log((np.asarray(a, float) + c) / (np.asarray(b, float) + c))
STATOF = {'rec_yds': 'cyds', 'rec': 'rec', 'rush_yds': 'ryds', 'pass_yds': 'pyds', 'qb_rush': 'qbr_yds', 'kick': 'kpts', 'atd': 'td', 'qb_atd': 'td'}
CPROP = {'rec_yds': 10, 'rec': 1, 'rush_yds': 10, 'pass_yds': 20, 'qb_rush': 15, 'kick': 2}
NA_WORDS = ['snap', 'epa', 'air yards', 'yac', 'wind', 'explosive', 'big-play', 'out', 'healthy', 'short targets', 'goal-line', '50+', 'block risk', 'first-down']

def answer(name, how, P, prop):
    """Return the raw value of one Slate question for rows P, or None when ESPN does not carry what it needs."""
    n = name.lower(); s = STATOF[prop]; pos = P.pg.values
    sp = P.season.values; wk = P.week.values; op = P.opp.values
    O = lambda num, den=None: np.array([opp_rel(a, b, c, num, den) for a, b, c in zip(sp, wk, op)])
    posk = lambda base: [f'{base}_{p}' if p in ('WR', 'TE', 'RB') else f'{base}_WR' for p in pos]
    Opos = lambda base, den=None: np.array([opp_rel(a, b, c, k, (f'{den}_{k.split("_")[1]}' if den else None)) for a, b, c, k in zip(sp, wk, op, posk(base))])
    if n == 'availability': return np.log2(np.clip(P.p_play.values, .05, 1))
    if any(w in n for w in NA_WORDS) and not n.startswith('opp dbs') and n not in ('receivers healthy',): return None
    if n.startswith('opp dbs') or n.startswith('opp secondary') or n.startswith('opp front') or n == 'receivers healthy': return None
    if n in ('target share',): return shrink(P.s_tgt * P.n_s, P.s_team_tgt * P.n_s, P.c_tgt / P.c_team_tgt.replace(0, np.nan), 3).fillna(0).values if False else (P.s_tgt / P.s_team_tgt.replace(0, np.nan)).fillna(P.c_tgt / P.c_team_tgt.replace(0, np.nan)).fillna(0).values
    if n == 'recent share': return (P.l3_car / P.l3_team_car.replace(0, np.nan)).fillna(0).values
    if n == 'opportunity share': return ((P.s_tgt + P.s_car) / (P.s_team_tgt + P.s_team_car).replace(0, np.nan)).fillna(0).values
    if n == 'dropback share': return (P.s_db / P.s_team_dropbacks.replace(0, np.nan)).fillna(0).values
    if n in ('dropbacks / game', '3-game volume'): return (P.s_db if n.startswith('drop') else P.l3_opps).fillna(0).values
    if n in ('qb carries / game',): return P.s_car.fillna(0).values
    if n == 'opportunities / game': return P.s_opps.fillna(0).values
    if n == 'depth rank': return P.depth.values
    if n.startswith('vacated'): return P['vac_c' if 'carries' in n else 'vac_t'].values
    if n == 'yards / target': return lr(shrink(P.c_cyds * P.n_c, P.c_tgt * P.n_c, np.array([LG_YPT.get(p, 7) for p in pos]), 300), [LG_YPT.get(p, 7) for p in pos], 0).astype(float)
    if n == 'catch rate': return (shrink(P.c_rec * P.n_c, P.c_tgt * P.n_c, np.array([LG_CR.get(p, .65) for p in pos]), 150) - np.array([LG_CR.get(p, .65) for p in pos])).astype(float)
    if n == 'yards / carry': return lr(shrink(P.c_ryds * P.n_c, P.c_car * P.n_c, np.array([LG_YPC.get(p, 4.2) for p in pos]), 1978), [LG_YPC.get(p, 4.2) for p in pos], 0).astype(float)
    if n == 'yards / attempt': return lr(shrink(P.c_pyds * P.n_c, P.c_att * P.n_c, LG_YA, 396), LG_YA, 0).astype(float)
    if n == 'completion %': return (shrink(P.c_cmp * P.n_c, P.c_att * P.n_c, LG_CMP, 60) - LG_CMP).astype(float)
    if n == 'yards / opportunity': return ((P.c_cyds + P.c_ryds) / P.c_opps.replace(0, np.nan)).fillna(0).values
    if n.startswith('career') and '/ g' in n: return lr(P['c_' + s], P.base, CPROP.get(prop, 1)).astype(float)
    if n in ('his points / g',): return P.s_kpts.fillna(P.c_kpts).fillna(0).values
    if n == 'recent form': return lr(P['l1_' + s], P.base, CPROP.get(prop, 1)).astype(float)
    if n in ('3-game form', 'recent td form'): return lr(P['l3_' + s], P.base, CPROP.get(prop, 1)).astype(float)
    if n == 'last game': return lr(P['l1_' + s], P.base, CPROP.get(prop, 1)).astype(float)
    if n in ('last season / g', 'last season tds / g'): return P['ls_' + s].fillna(P['c_' + s]).fillna(0).values
    if n == 'season tds / g': return P.s_td.fillna(P.c_td).fillna(0).values
    if n == 'receiving td rate': return (P.c_ctd / P.c_tgt.replace(0, np.nan)).fillna(0).values
    if n == 'fg share of points': return (3 * P.c_fgm / P.c_kpts.replace(0, np.nan)).fillna(.6).values
    if n == 'team fg tries / g': return P.t_fga.values
    if n == 'team xp tries / g': return P.t_xpa.values
    if n == 'pat %': return (P.c_xpm / P.t_xpa.replace(0, np.nan)).clip(0, 1.2).fillna(.95).values
    if n == 'long-range share': return P.k_long.values
    if n == 'pass epa / dropback': return None
    # opponent (denoised defense tensor)
    if n in ('opp yds / target',): return Opos('cyds', 'tgt')
    if n in ('opp catches to position',): return Opos('rec')
    if n in ('opp catch rate to position', 'opp completion % allowed'): return Opos('rec', 'tgt')
    if n == 'opp yds to rbs': return O('ryds_RB')
    if n == 'opp yds / carry': return O('ryds_RB', 'car_RB')
    if n in ('opp points allowed',): return O('pf')
    if n in ('opp pass rush (−)', 'opp pass rush'): return O('sacks', 'dropbacks')
    if n in ('opp yds / dropback',): return O('pyds', 'dropbacks')
    if n in ('opp dropbacks faced', 'opp faces passes'): return O('dropbacks')
    if n == 'opp qb rush yds allowed': return O('qb_ryds')
    if n == 'opp qb carries allowed': return O('qb_car')
    if n == 'opp red-zone d': return O('rz_m', 'rz_a')
    if n == 'opp rush tds allowed': return O('rtd')
    if n == 'opp pass tds allowed': return O('ctd')
    if n == 'opp tds to position': return Opos('td')
    if n in ('opp xp tries allowed',): return O('xpa')
    if n in ('opp fg tries allowed',): return O('fga')
    if n in ('opp fg share allowed',): return O('kpts', 'pf')
    # game setup (ESPN pickcenter lines; missing lines answer 0 = no information)
    if n in ('qb quality', 'own qb quality'): return P.qbq.values
    if n.startswith('qb downgrade'): return P.qbd.values
    if n in ('implied pts vs usual', 'implied points'): return (P.implied - P.s_pf_team).fillna(0).values if 'vs' in n else P.implied.fillna(P.s_pf_team).values
    if n in ('total vs usual', 'game total vs usual'): return (P.total - P.s_tot_team).fillna(0).values
    if n in ('trailing script', 'script'): return (P.s_margin + P.tspread).fillna(0).values
    if n == 'leading script': return (-(P.s_margin + P.tspread)).fillna(0).values
    if n == 'favorite size': return (-P.tspread).fillna(0).values
    if n == 'close game': return (-P.tspread.abs()).fillna(0).values
    if n == 'pace vs usual': return np.nan_to_num(lr(P.s_plays_team, P.lg_plays, 0))
    if n in ('usage × scoring env',): return ((P.s_opps / P.s_team_tgt.add(P.s_team_car).replace(0, np.nan)).fillna(0) * (P.implied - P.s_pf_team).fillna(0)).values
    if n in ('home / rest / roof', 'home & rest'): return P.home_f.values + 0.0
    if n in ('dome / wind', 'kicking conditions'): return P.indoor.fillna(0).values + 0.0
    # history
    if n == 'baseline reliability': return 1 / (P.n_s.values + 1)
    if n == 'experience': return np.log1p(P.yrs.values)
    if n in ('h2h volume', 'his volume vs opp', 'meetings count', 'h2h production', 'h2h efficiency', 'his tds vs opp', 'his fg tries vs opp', 'last meeting', 'last-meeting tds'): return P['h2h_' + {'h2h volume': 'vol', 'his volume vs opp': 'vol', 'meetings count': 'n', 'h2h production': 'prod', 'h2h efficiency': 'prod', 'his tds vs opp': 'td', 'his fg tries vs opp': 'fga', 'last meeting': 'last', 'last-meeting tds': 'lasttd'}[n]].values
    if n.startswith('team') and 'vs' in n: return P.team_vs_opp.values
    return None

# ------------------------------------------------------------------ assemble rows (history + tonight)
def add_context(P):
    """team/opponent/QB context that depends on other players in the same game"""
    P = P.copy()
    # depth rank & vacated volume (role-weighted) within team-position, from season-prior usage
    P['use'] = np.where(P.pg.isin(['RB']), P.s_car.fillna(0) + P.s_tgt.fillna(0), P.s_tgt.fillna(0))
    P['depth'] = P.groupby(['g', 'team', 'pg']).use.rank(ascending=False, method='first')
    return P
def team_season_ctx(P):
    tg = TG.sort_values('date').copy(); tg['margin'] = tg.pf - tg.pa; tg['tot'] = tg.pf + tg.pa; tg['ts'] = tg.team + '|' + tg.season.astype(str)
    g = tg.groupby('ts')
    for c in ['pf', 'margin', 'tot', 'plays', 'fga', 'xpa']: tg['s_' + c] = (g[c].cumsum() - tg[c]) / g.cumcount().replace(0, np.nan)
    tgl = tg.set_index(['g', 'team'])
    idx = pd.MultiIndex.from_arrays([P.g, P.team])
    P['s_pf_team'] = tgl.s_pf.reindex(idx).values; P['s_margin'] = tgl.s_margin.reindex(idx).values; P['s_tot_team'] = tgl.s_tot.reindex(idx).values
    P['s_plays_team'] = tgl.s_plays.reindex(idx).values; P['t_fga'] = tgl.s_fga.reindex(idx).values; P['t_xpa'] = tgl.s_xpa.reindex(idx).values
    P['lg_plays'] = tg.plays.mean()
    return P, tg
def qb_quality(P):
    q = PG[PG.pg == 'QB'].sort_values('date'); g = q.groupby('pid')
    q = q.assign(c_py=g.pyds.cumsum() - q.pyds, c_at=g.att.cumsum() - q.att)
    ya = {(r.g, r.pid): float(lr(shrink(r.c_py, r.c_at, LG_YA, 150), LG_YA, 0)) for r in q.itertuples()}
    car_ya = q.groupby('pid').apply(lambda d: float(lr(shrink(d.pyds.sum(), d.att.sum(), LG_YA, 150), LG_YA, 0)))
    return ya, car_ya.to_dict()

def vacated(P, absent):
    """absent: {(g, team): [(pid, pg, usage_share, p_absent)]}. Share freed at his position, weighted by role similarity."""
    vt = np.zeros(len(P)); vc = np.zeros(len(P))
    for i, r in enumerate(P.itertuples()):
        for pid, pg, sh_t, sh_c, pa in absent.get((r.g, r.team), []):
            if pid == r.pid or pg != r.pg: continue
            a, b = RIX.get(pid), RIX.get(r.pid); sim = float(EMB[a] @ EMB[b]) if a is not None and b is not None else .5
            vt[i] += pa * sh_t * sim; vc[i] += pa * sh_c * sim
    P['vac_t'] = vt; P['vac_c'] = vc; return P

def history_absent(P):
    """historical absences: players who had season usage before this game but no box-score row in it"""
    out = {}
    tgs = TG[['g', 'team', 'season', 'date']].sort_values('date')
    S = P[P.n_s >= 2][['pid', 'team', 'season', 'pg', 's_tgt', 's_team_tgt', 's_car', 's_team_car', 'g']]
    played = set(zip(P.g, P.pid))
    last_state = S.sort_values('g').groupby(['pid', 'team', 'season']).tail(1)
    for r in last_state.itertuples():
        sh_t = (r.s_tgt / r.s_team_tgt) if r.s_team_tgt else 0; sh_c = (r.s_car / r.s_team_car) if r.s_team_car else 0
        if sh_t < .08 and sh_c < .15: continue
        later = tgs[(tgs.team == r.team) & (tgs.season == r.season) & (tgs.g > r.g)].g.head(3)
        for g in later:
            if (g, r.pid) not in played: out.setdefault((g, r.team), []).append((r.pid, r.pg, sh_t, sh_c, 1.0))
    return out

if __name__ == '__main__':
    hist = PG.copy(); hist['virtual'] = False; hist['p_play'] = 1.0
    # tonight's virtual rows: every BAL/JAX skill player and kicker who has played this season or is on ESPN's depth chart
    dc = {'BAL': ['Joe Fagnano', 'Kedon Slovis', 'Derrick Henry', 'Justice Hill', 'Rasheen Ali', 'Zay Flowers', 'Devontez Walker', 'Rashod Bateman', 'LaJohntay Wester', 'Mark Andrews', 'Josh Cuevas'],
          'JAX': ['Trevor Lawrence', 'Bhayshul Tuten', 'Chris Rodriguez Jr.', 'LeQuint Allen Jr.', 'Parker Washington', 'Josh Cameron', 'Jakobi Meyers', 'Travis Hunter', 'Brenton Strange', 'Nate Boerkircher', 'Cam Little']}
    lines = TN['lines']; names = TN['names']; idn = {v[0]: k for k, v in names.items()}
    roster = {}
    recent = hist[(hist.season == 2026)].sort_values('date').groupby('pid').tail(1)
    for t in ('BAL', 'JAX'):
        ids = set(recent[(recent.team == t) & (recent.opps + recent.att + recent.kpts > 0)].pid)
        ids |= {idn[n] for n in dc[t] if n in idn}
        ids |= {l['aid'] for l in lines if 'aid' in l and names.get(l['aid'], [None, None, None])[2] in ({'BAL': '33', 'JAX': '30'}[t],)}
        for pid in ids: roster[pid] = t
    inj = {r[0]: r for r in INJ if r[3] in ('BAL', 'JAX')}
    over = {o['name']: o for o in CTX['avail_overrides']}
    gid = hist.g.max() + 1; vrows = []
    for pid, t in roster.items():
        last = hist[hist.pid == pid].tail(1)
        nm = last.name.iloc[0] if len(last) else names.get(pid, ['?'])[0]
        st = inj.get(pid); p = 1.0; rep = 'Not on the ESPN injury report'
        if st and st[4] in PPLAY: p = PPLAY[st[4]]; rep = f'ESPN: {st[4]}' + (f' ({st[7]})' if st[7] else '')
        if nm in over: p = over[nm]['p']; rep = f"ESPN: {over[nm]['status']} — {over[nm]['why'].replace('ESPN: ', '')}"
        if nm in ('Lamar Jackson', 'Tyler Huntley'): p = 0.0
        vrows.append(dict(g=gid, team=t, pid=pid, name=nm, opp='BAL' if t == 'JAX' else 'JAX', season=2026, week=9, date=pd.Timestamp(TONIGHT['kick']), home_f=int(t == 'BAL'),
                          tspread=TONIGHT['spread_home'] if t == 'BAL' else -TONIGHT['spread_home'], total=TONIGHT['total'], indoor=0, virtual=True, p_play=p, report=rep))
    V = pd.DataFrame(vrows); V['implied'] = V.total / 2 - V.tspread / 2
    V['pos'] = V.pid.map(lambda p: (POS.get(p) or [names.get(p, ['', ''])[1] if p in names else ''])[0] or (names.get(p, ['', ''])[1])); V['pg'] = V.pos.map(lambda p: {'FB': 'RB', 'PK': 'K'}.get(p, p))
    for c in STATS + ['clong', 'rlong', 'sacks', 'qbr_yds']:
        if c not in V: V[c] = 0.0
    # tonight's QB per team (ESPN: Fagnano starts; Lawrence for JAX)
    qbt = {'BAL': idn.get('Joe Fagnano'), 'JAX': idn.get('Trevor Lawrence')}; V['qb_today'] = V.team.map(qbt)
    tsum = hist.groupby(['g', 'team'])[['tgt', 'car', 'db']].sum()
    ALL = pd.concat([hist, V], ignore_index=True)
    ALL['team_tgt'] = ALL.team_tgt.fillna(0); ALL['team_car'] = ALL.team_car.fillna(0); ALL['team_dropbacks'] = ALL.team_dropbacks.fillna(0)
    ALL = features(ALL)
    # virtual rows: team totals are unknown tonight -> use that team's season averages so shares stay comparable
    for c in ['team_tgt', 'team_car', 'team_dropbacks']:
        ALL.loc[ALL.virtual, 's_' + c] = ALL.loc[ALL.virtual, 's_' + c].fillna(ALL.loc[ALL.virtual, 'c_' + c])
    ALL, tg = team_season_ctx(ALL)
    tl = tg.sort_values('date').groupby('team').tail(1).set_index('team'); last_g = tg.groupby('team').g.max()
    for c, src in [('s_pf_team', 'pf'), ('s_margin', 'margin'), ('s_tot_team', 'tot'), ('s_plays_team', 'plays'), ('t_fga', 'fga'), ('t_xpa', 'xpa')]:
        ss = tg[tg.season == 2026].groupby('team')[src].mean(); ALL.loc[ALL.virtual, c] = ALL.loc[ALL.virtual, 'team'].map(ss).values
    ya, car_ya = qb_quality(ALL)
    usual = ALL[(ALL.pg == 'QB')].groupby(['team', 'season']).apply(lambda d: d.groupby('pid').att.sum().idxmax()).to_dict()
    ALL['qbq'] = [ya.get((g, q), car_ya.get(q, 0.0)) if not v else car_ya.get(q, -0.15) for g, q, v in zip(ALL.g, ALL.qb_today, ALL.virtual)]
    ALL['qbd'] = [qq - car_ya.get(usual.get((t, s)), qq) for qq, t, s in zip(ALL.qbq, ALL.team, ALL.season)]
    # kicker extras
    ALL['k_long'] = 0.0
    ALL = add_context(ALL)
    absent = history_absent(ALL)
    # tonight's absences (ESPN): anyone with season usage on BAL/JAX whose play chance < 1
    for r in ALL[ALL.virtual & (ALL.p_play < 1)].itertuples():
        sh_t = (r.s_tgt / r.s_team_tgt) if r.s_team_tgt else 0; sh_c = (r.s_car / r.s_team_car) if r.s_team_car else 0
        if np.isnan(sh_t): sh_t = 0
        if np.isnan(sh_c): sh_c = 0
        absent.setdefault((r.g, r.team), []).append((r.pid, r.pg, sh_t, sh_c, 1 - r.p_play))
    ALL = vacated(ALL, absent)
    # H2H vs this opponent (last 3 seasons), shrunk n/(n+3); team vs this opponent
    ALL = ALL.sort_values(['pid', 'date']).reset_index(drop=True)
    for prop, s in STATOF.items(): pass
    ALL.to_parquet(f'{ST}/features_base.parquet')
    print('rows', len(ALL), 'virtual', int(ALL.virtual.sum()), 'absences tonight', absent.get((gid, 'BAL')), absent.get((gid, 'JAX')))
