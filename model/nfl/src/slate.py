"""Stage 5 · score an upcoming week: features (same leak-free code), final models fit on every completed game,
10,000 correlated simulations per game, calibration, invariants, out-of-distribution flags, parlay joint probabilities.
Every number written comes from a fitted model or its simulations. Anything the model cannot produce is None ("no prediction").
Run: python3 src/slate.py 2026 9  -> work/slate_2026_09.json  and work/invariants_2026_09.log"""
import pandas as pd, numpy as np, os, sys, json, warnings, zlib
def dseed(*a): return zlib.crc32('|'.join(map(str, a)).encode())
warnings.filterwarnings('ignore')
from scipy.stats import norm, spearmanr
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as FE, models as MO
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W = f'{H}/work'
SEASON, WEEK = int(sys.argv[1]), int(sys.argv[2]); NS = 10000; SEED = 20261105
CHOSEN = {'receptions': 'B', 'rec_yds': 'B', 'rush_yds': 'A', 'pass_yds': 'A'}       # better calibrated at the market line, 2026 walk-forward (calibrated_2026.json)
VALIDATED = {'receptions', 'rec_yds'}                                                  # markets where the calibrated model beat 50/50 at the DraftKings line out of sample
LABEL = {'rec_yds': 'Receiving yards', 'receptions': 'Receptions', 'rush_yds': 'Rushing yards', 'pass_yds': 'Passing yards'}
log = []
def note(kind, msg): log.append(f'{kind}: {msg}')
PG = pd.read_parquet(f'{W}/player_games.parquet'); TG = pd.read_parquet(f'{W}/team_games.parquet'); G = pd.read_parquet(f'{W}/games.parquet'); INJ = pd.read_parquet(f'{W}/injuries.parquet')
DP = pd.read_parquet(f'{W}/def_pos.parquet'); ROS = pd.read_parquet(f'{H}/raw/roster_{SEASON}.parquet')
UP = G[(G.season == SEASON) & (G.week == WEEK) & G.home_score.isna()].copy()
# [auto] freeze started games: a game whose kickoff has passed is never re-modelled (its published props stay as they were at kickoff)
_NOW = pd.Timestamp(os.environ['TAIL_NOW']) if os.environ.get('TAIL_NOW') else pd.Timestamp.now(tz='UTC')
UP = UP[pd.to_datetime(UP.gameday + ' ' + UP.gametime).dt.tz_localize('America/New_York') > _NOW].copy()
if not len(UP): sys.exit('no games left to model this week (all kicked off)')
# ---------------- candidates: active this week, played one of his team's last 3 games, not Out/Doubtful on the official report
inj = INJ[(INJ.season == SEASON) & (INJ.week == WEEK)]; out_ids = set(inj[inj.report_status.isin(['Out', 'Doubtful'])].pid)
act = ROS[(ROS.week == ROS.week.max()) & (ROS.status == 'ACT')][['gsis_id', 'team']].rename(columns={'gsis_id': 'pid'})
pg = PG[PG.season == SEASON].merge(G[['game_id', 'gameday']], on='game_id'); rows_pg, rows_tg, rows_dp = [], [], []
for _, g in UP.iterrows():
    for team, opp, qb in ((g.home_team, g.away_team, g.home_qb_id), (g.away_team, g.home_team, g.away_qb_id)):
        last3 = sorted(pg[pg.team == team].game_id.unique(), key=lambda x: x)[-1:]   # pool: played in the team's most recent game
        recent = pg[(pg.team == team) & pg.game_id.isin(last3)]
        ids = set(recent[(recent.targets + recent.carries > 0) | (recent.dropbacks > 0)].pid) & set(act[act.team == team].pid)
        ids = {i for i in ids if i not in out_ids}
        qbs = set(recent[recent.dropbacks > 0].pid); ids = (ids - qbs) | ({qb} if isinstance(qb, str) else set())      # only the listed starter passes
        if isinstance(qb, str) and qb not in set(PG.pid): note('OOD', f'{team} listed QB {g.home_qb_name if team == g.home_team else g.away_qb_name} has no NFL dropbacks in the data')
        meta = PG[PG.pid.isin(ids)].sort_values('season').groupby('pid').last()[['pos', 'name', 'espn_id', 'pfr_id', 'rookie_year', 'birth_date']]
        for pid in ids:
            m = meta.loc[pid] if pid in meta.index else None
            if m is None: continue
            rows_pg.append(dict(game_id=g.game_id, team=team, pid=pid, **m.to_dict(), season=SEASON, week=WEEK, gameday=g.gameday, home_team=g.home_team, away_team=g.away_team))
        rows_tg.append(dict(game_id=g.game_id, team=team, season=SEASON, week=WEEK, gameday=g.gameday, home_team=g.home_team, away_team=g.away_team))
        rows_dp.append(dict(game_id=g.game_id, team=team, season=SEASON, week=WEEK, gameday=g.gameday))
pgx = pd.concat([PG, pd.DataFrame(rows_pg)], ignore_index=True); tgx = pd.concat([TG, pd.DataFrame(rows_tg)], ignore_index=True); dpx = pd.concat([DP, pd.DataFrame(rows_dp)], ignore_index=True)
num = [c for c in PG.select_dtypes('number').columns if c not in ('season', 'week')]; pgx[num] = pgx[num].fillna(0)
P, T = FE.build(pgx, tgx.fillna({c: 0 for c in TG.select_dtypes('number').columns if c not in ('season', 'week')}), G, INJ, DP=dpx.fillna(0))
done = P[P.game_id.isin(set(PG.game_id)) & (P.n_prior >= 1)]; up = P[P.game_id.isin(set(UP.game_id))].copy()
# ---------------- learned correlation: player error vs his team's scoring error (2026 walk-forward rows), Spearman -> Gaussian copula rho
BT = pd.read_parquet(f'{W}/backtest_props.parquet'); TT = T[['game_id', 'team', 'implied']]
sc = pd.concat([G[['game_id', 'home_team', 'home_score']].rename(columns={'home_team': 'team', 'home_score': 'pts'}), G[['game_id', 'away_team', 'away_score']].rename(columns={'away_team': 'team', 'away_score': 'pts'})])
BT = BT.merge(TT, on=['game_id', 'team']).merge(sc, on=['game_id', 'team']); RHO = {}
for mk, g in BT.groupby('market'):
    r = spearmanr(g.y - g[f'med_{CHOSEN[mk]}'], g.pts - g.implied).correlation; RHO[mk] = float(2 * np.sin(np.pi * r / 6))
# game-level: home/away scoring errors vs the market (learned from completed games since 2018)
gg = G[G.home_score.notna()].copy(); gg['ih'] = gg.total_line / 2 + gg.spread_line / 2; gg['ia'] = gg.total_line / 2 - gg.spread_line / 2
EH, EA = (gg.home_score - gg.ih).values, (gg.away_score - gg.ia).values; RHO_GAME = float(np.corrcoef(EH, EA)[0, 1])
# ---------------- calibration temperature: latest walk-forward value per market
CAL = json.load(open(f'{W}/calibrated_2026.json'))
K = {mk: list(CAL[mk][CHOSEN[mk]]['k_by_week'].values())[-1] for mk in CHOSEN}
# ---------------- fit final models on every completed game and simulate
out_props = []; sims = {}; CTX = {}
for mk, cfg in MO.MK.items():
    cols = FE.feats(mk); tr = done[cfg['ok'](done) & done[cfg['e']].notna()]; te = up[cfg['ok'](up) & up[cfg['e']].notna()].copy()
    if mk == 'pass_yds': te = up[(up.pos == 'QB') & up.pid.isin(set(UP.home_qb_id) | set(UP.away_qb_id)) & up[cfg['e']].notna()].copy()
    if not len(te): continue
    Xtr = tr[cols].values.astype(float); mu, sd = MO.zfit(Xtr); Ztr = MO.z(Xtr, mu, sd); Zte = MO.z(te[cols].values.astype(float), mu, sd)
    rng = np.random.default_rng(dseed(SEED, mk)); MO.NS = NS
    A = MO.fit_A(Ztr, tr[cfg['y']].values); SA, QA = MO.samp_A(A, Zte, rng)
    if CHOSEN[mk] == 'B':
        B = MO.fit_B(Ztr, tr[cfg['v']].values.astype(float), tr[cfg['y']].values.astype(float), tr[cfg['e']].values, mk); S = MO.samp_B(B, Zte, te[cfg['e']].values, rng)
    else: S = SA
    contrib = A[5].booster_.predict(Zte, pred_contrib=True)                 # what moved the median (LightGBM q50), per feature
    lo, hi = np.nanpercentile(Xtr, .5, 0), np.nanpercentile(Xtr, 99.5, 0); Xte = te[cols].values.astype(float)
    for i, (_, r) in enumerate(te.iterrows()):
        sims[(r.game_id, r.pid, mk)] = np.sort(S[i])
        outside = [cols[j] for j in range(len(cols)) if np.isfinite(Xte[i, j]) and (Xte[i, j] < lo[j] or Xte[i, j] > hi[j])]
        ood = []
        if r.n_prior < 3: ood.append('fewer than 3 prior NFL games')
        if r.f_gap > 21 and r.season == pd.to_datetime(r.date).year and r.week > 2 and r.n_prior > 0 and r.f_gap < 200: ood.append(f'returning after {int(r.f_gap)} days out')
        if r.qb_change == 1: ood.append('different starting QB than last game')
        if r.qb_new == 1: ood.append('starting QB has under 60 career dropbacks')
        if outside: ood.append('outside training range: ' + ', '.join(outside[:3]))
        hard = any(x.startswith(('fewer', 'returning', 'starting QB has')) for x in ood)
        c = contrib[i][:-1]; o = np.argsort(c)
        out_props.append(dict(game_id=r.game_id, pid=r.pid, name=r['name'], team=r.team, opp=r.opp, pos=r.pos, espn_id=r.espn_id, market=mk, model=CHOSEN[mk],
                              median=float(np.median(S[i])), mean=float(S[i].mean()), p10=float(np.percentile(S[i], 10)), p90=float(np.percentile(S[i], 90)),
                              q=[float(x) for x in np.percentile(S[i], [5, 25, 50, 75, 95])], tg_sh=float(r.f_tg_sh) if pd.notna(r.f_tg_sh) else 0.0,
                              ood=ood, ood_hard=hard, questionable=bool(r.f_questionable),
                              up=[(cols[j], float(c[j])) for j in o[::-1][:3] if c[j] > 0], down=[(cols[j], float(c[j])) for j in o[:3] if c[j] < 0]))
    CTX[mk] = (tr, Ztr, te, Zte, cfg)
    print(mk, len(te), 'rows', flush=True)
PR = pd.DataFrame(out_props)
# ---------------- DraftKings lines (ESPN) for this week
L = pd.read_parquet(f'{W}/espn_dk_prop_lines_2026.parquet'); L = L[(L.season == SEASON) & (L.week == WEEK)]
L['espn_id'] = pd.to_numeric(L.espn_id, errors='coerce'); PR['espn_id'] = pd.to_numeric(PR.espn_id, errors='coerce')
PR = PR.merge(L[['espn_id', 'market', 'line_close', 'line_open', 'updated']].drop_duplicates(['espn_id', 'market']), on=['espn_id', 'market'], how='left')
# ---------------- invariants: shares <= 100% enforced as a constraint (logged); QB vs receivers checked (reject and log)
bad = set(); SCALE = {}; capped = set()
for (gid, team), g in PR.groupby(['game_id', 'team']):
    sh = g[g.market == 'receptions'].tg_sh.sum(); f = min(1.0, 1.0 / sh) if sh > 0 else 1.0; SCALE[(gid, team)] = f
    if f < 1: note('SHARES', f'{gid} {team}: historical target shares of this pool sum to {sh:.2f}; receiving draws scaled by {f:.3f} so shares total 100%')
    qb = g[g.market == 'pass_yds']; ry = g[g.market == 'rec_yds']['mean'].sum() * f
    if len(qb) and ry > 1.10 * qb['mean'].iloc[0]:
        note('INVARIANT', f'{gid} {team}: receivers project {ry:.0f} yds vs QB {qb["mean"].iloc[0]:.0f} (>10% apart); QB passing prop rejected, receivers cannot be leans')
        bad.add((gid, team, 'pass_yds')); capped |= {(gid, team, 'rec_yds'), (gid, team, 'receptions')}
    if (g.p10 < 0).any(): note('INVARIANT', f'{gid} {team}: negative projection; team props rejected'); bad |= {(gid, team, m) for m in g.market}
# ---------------- correlated game simulation: team scoring errors (bivariate, learned), player errors tied to own team by learned rho
rng = np.random.default_rng(SEED); games_out = {}; Zt = {}
for _, g in UP.iterrows():
    ih = g.total_line / 2 + g.spread_line / 2; ia = g.total_line / 2 - g.spread_line / 2
    idx = rng.integers(0, len(EH), NS); eh, ea = EH[idx], EA[idx]
    hs, as_ = np.maximum(0, np.round(ih + eh)), np.maximum(0, np.round(ia + ea))
    Zt[(g.game_id, g.home_team)] = norm.ppf((pd.Series(eh).rank().values - .5) / NS); Zt[(g.game_id, g.away_team)] = norm.ppf((pd.Series(ea).rank().values - .5) / NS)
    mar = hs - as_; ph = float((mar > 0).mean() + .5 * (mar == 0).mean())
    assert abs(ph + (1 - ph) - 1) < 1e-12
    games_out[g.game_id] = dict(home=g.home_team, away=g.away_team, kick=f'{g.gameday} {g.gametime}', spread_home=-g.spread_line, total=g.total_line, ml_home=g.home_moneyline, ml_away=g.away_moneyline,
                                home_qb=g.home_qb_name, away_qb=g.away_qb_name, roof=g.roof,
                                sim=dict(p_home=round(ph, 3), proj_home=round(float(hs.mean()), 1), proj_away=round(float(as_.mean()), 1),
                                         note='Team scoring means are the closing market (the trained game model lost to the close 2022–2026); spread of outcomes and the home/away link are learned from 2,000+ games.'))
def player_draws(r):
    S = sims[(r.game_id, r.pid, r.market)]; rho = RHO[r.market]; z = Zt[(r.game_id, r.team)]
    e = np.random.default_rng(dseed(SEED, r.pid, r.market)).standard_normal(NS)
    u = norm.cdf(rho * z + np.sqrt(1 - rho ** 2) * e); D = S[np.minimum((u * NS).astype(int), NS - 1)]
    return D * SCALE[(r.game_id, r.team)] if r.market in ('rec_yds', 'receptions') else D
lg = lambda p: np.log(p / (1 - p)); sgm = lambda x: 1 / (1 + np.exp(-x))
props = []
for _, r in PR.iterrows():
    D = player_draws(r); rej = (r.game_id, r.team, r.market) in bad; line = r.line_close
    pov_raw = float(((D > line).sum() + .5) / (NS + 1)) if pd.notna(line) else None
    pov = float(sgm(K[r.market] * lg(pov_raw))) if pov_raw is not None else None
    side = None if pov is None else ('over' if pov >= .5 else 'under'); ps = None if pov is None else max(pov, 1 - pov)
    nopred = rej or r.ood_hard
    tier = 'pass'
    if not nopred and ps is not None and ps >= .55 and r.market in VALIDATED and not r.ood and (r.game_id, r.team, r.market) not in capped: tier = 'lean'
    r = r.copy(); r['median'], r['mean'], r['p10'], r['p90'] = float(np.median(D)), float(D.mean()), float(np.percentile(D, 10)), float(np.percentile(D, 90)); r['q'] = [float(x) for x in np.percentile(D, [5, 25, 50, 75, 95])]
    props.append(dict(r.drop(['q']).to_dict(), q=r.q, line=None if pd.isna(line) else float(line), pov_raw=pov_raw, pov=pov, side=side, p_side=ps, tier=tier, no_prediction=bool(nopred), rejected=bool(rej), team_check_failed=(r.game_id, r.team, r.market) in capped, share_scale=round(SCALE[(r.game_id, r.team)], 3),
                      hist=np.histogram(D, bins=24, range=(0, max(1, np.percentile(D, 98))))[0].tolist(), hist_top=float(max(1, np.percentile(D, 98))), draws_key=f'{r.game_id}|{r.pid}|{r.market}'))
    sims[('draw', r.game_id, r.pid, r.market)] = D
# ---------------- prices (Action Network: book lines + prices), edge vs break-even and no-vig, game-bootstrap interval, reduced Kelly
# Methods: Brill, Yurko & Wyner (bootstrap by game); Kaunitz et al. / Levitt (market benchmark, net of vig);
# Kelly (1956) with Baker & McHale (2013) shrinkage; Hubacek et al. (2019) model-vs-line correlation; Lopez et al. (2018) ceiling.
import re as _re, unicodedata as _ud
import books as BK
def _nm(x): return _re.sub(r'[^a-z ]', '', _ud.normalize('NFKD', str(x)).encode('ascii', 'ignore').decode().lower()).replace(' jr', '').replace(' iii', '').replace(' ii', '').strip()
# Books: every book Action Network carries (src/books.py). Pick'em books (and any book posting odds 0/null) are kept as
# line-only offers (pickem: true) and never enter edge, p, best, break-even, interval or Kelly.
# `best` and the bet tier choose among BEST_SET only. The 3% MIN_EDGE gate was validated on the 5 original books; the max edge
# over more books adds selection bias, so every run also records what core5 / core7 / all would give (slate book_set.compare).
BEST_SET = 'all'
BEST = set(BK.SETS[BEST_SET])
AP = pd.read_parquet(f'{W}/an_props_wk{WEEK:02d}.parquet') if os.path.exists(f'{W}/an_props_wk{WEEK:02d}.parquet') else pd.DataFrame(columns=['market', 'player', 'team', 'book_id', 'side', 'value', 'odds'])
AP = AP[AP.book_id.isin(set(BK.NAME) | {BK.OPEN})]
OFF, PICK = {}, {}
for (mk, nm_, tm), g in AP.groupby(['market', AP.player.map(_nm), 'team']):
    for bid, h in g.groupby('book_id'):
        bid = int(bid); o = h[h.side == 'over']; u = h[h.side == 'under']
        if not len(o) and not len(u): continue
        if bid != BK.OPEN and BK.is_pickem(bid, *h.odds.tolist()):
            ln_ = (o if len(o) else u).value.iloc[0]
            if pd.notna(ln_): PICK.setdefault((mk, nm_, tm), {})[bid] = float(ln_)
            continue
        if len(o) and len(u) and o.value.iloc[0] == u.value.iloc[0] and not BK.no_price(o.odds.iloc[0]) and not BK.no_price(u.odds.iloc[0]):
            OFF.setdefault((mk, nm_, tm), {})[bid] = (float(o.value.iloc[0]), float(o.odds.iloc[0]), float(u.odds.iloc[0]))
for k_ in set(OFF) | set(PICK):   # Caesars: 123 when it has a usable offer for this prop, else the fallback 49; never both
    o_, k2 = OFF.get(k_, {}), PICK.get(k_, {})
    if BK.CZR_PRIMARY in o_: o_.pop(BK.CZR_FALLBACK, None); k2.pop(BK.CZR_FALLBACK, None)
    elif BK.CZR_FALLBACK in o_: k2.pop(BK.CZR_PRIMARY, None)
    elif BK.CZR_PRIMARY in k2: k2.pop(BK.CZR_FALLBACK, None)
    if not o_: OFF.pop(k_, None)
    if not k2: PICK.pop(k_, None)
def be(o): return -o / (-o + 100) if o < 0 else 100 / (o + 100)
def dec(o): return 1 + (100 / -o if o < 0 else o / 100)
# bootstrap by game for the hierarchical model (receptions, rec_yds): refit on games resampled with replacement
NB_ = 30; BOOT = {}; MIN_EDGE = 0.03   # edge threshold: 3 points over break-even (2026 weeks 1-8 priced backtest, work/backtest_priced.json)
for mk in ('receptions', 'rec_yds'):
    if mk not in CTX: continue
    tr, Ztr, te, Zte, cfg = CTX[mk]; gids = tr.game_id.values; ug = np.unique(gids); rngb = np.random.default_rng(dseed(SEED, 'boot', mk))
    pos = {g: np.where(gids == g)[0] for g in ug}; draws = []
    for b in range(NB_):
        idx = np.concatenate([pos[g] for g in rngb.choice(ug, len(ug))])
        Bb = MO.fit_B(Ztr[idx], tr[cfg['v']].values[idx].astype(float), tr[cfg['y']].values[idx].astype(float), tr[cfg['e']].values[idx], mk)
        MO.NS = 2000; draws.append(MO.samp_B(Bb, Zte, te[cfg['e']].values, rngb)); MO.NS = NS
    for i, (_, r) in enumerate(te.iterrows()): BOOT[(r.game_id, r.pid, mk)] = [d_[i] for d_ in draws]
pidx = {(p['game_id'], p['pid'], p['market']): k for k, p in enumerate(props)}


def price(p, elig, stale=False):
    """Best edge among the priced offers of the books in `elig` -> best, bootstrap interval, reduced Kelly, ceiling, tier.
    stale=True applies export_overlay.py's stale-price guard first (used for the book-set comparison only)."""
    live = [o for o in p['offers'] if o['book'] != 'Open' and not o.get('pickem')]
    if stale and live:
        med = float(np.median([o['novig_over'] for o in live])); live = [o for o in live if abs(o['novig_over'] - med) <= .08]
    live = [o for o in live if o['book'] in elig]
    if not live: return None
    cand = [(o['edge_over'], 'over', o) for o in live] + [(o['edge_under'], 'under', o) for o in live]
    e_, sd_, o_ = max(cand, key=lambda x: x[0]); pr = o_[sd_]; ps = o_['p_over'] if sd_ == 'over' else 1 - o_['p_over']
    out = dict(best=dict(book=o_['book'], side=sd_, line=o_['line'], odds=pr, p=round(ps, 4), break_even=round(be(pr), 4), edge=round(e_, 4), novig=round(o_['novig_over'] if sd_ == 'over' else 1 - o_['novig_over'], 4)),
               interval=None, kelly=None, ceiling=bool(ps > .75), tier=p['tier'], o=o_)
    bk = BOOT.get((p['game_id'], p['pid'], p['market'])); f = p.get('share_scale', 1.0)
    if bk:
        pb = []
        for Db in bk:
            Db = Db * f; q = float(((Db > o_['line']).sum() + .5) / (len(Db) + 1)); q = float(sgm(K[p['market']] * lg(q))); pb.append(q if sd_ == 'over' else 1 - q)
        lo, hi = np.percentile(pb, [10, 90]); out['interval'] = [round(float(lo), 4), round(float(hi), 4)]
        var = float(np.var(pb)); b_ = dec(pr) - 1; fk = max(0.0, (ps * b_ - (1 - ps)) / b_); edge2 = max(e_, 0) ** 2
        shrink = edge2 / (edge2 + var) if edge2 > 0 else 0.0
        out['kelly'] = dict(full=round(fk, 4), shrink=round(shrink, 3), stake=round(fk * shrink, 4))
    # tier: a bet needs a validated market, no flags, lower interval bound above break-even, and not above the ceiling
    if out['tier'] == 'lean' or (p['market'] in VALIDATED and not p['ood'] and not p.get('team_check_failed')):
        if out['interval'] and out['interval'][0] > out['best']['break_even'] and e_ >= MIN_EDGE and not out['ceiling'] and p['market'] in VALIDATED and not p['ood'] and not p.get('team_check_failed'):
            out['tier'] = 'bet'
        elif out['tier'] == 'lean' and e_ <= 0: out['tier'] = 'pass'
    return out


hub = {}; CMP = {k: dict(raw={}, guarded={}) for k in BK.SETS}
for p in props:
    p['offers'] = []; p['best'] = None; p['interval'] = None; p['kelly'] = None; p['ceiling'] = False
    key = (p['market'], _nm(p['name']), p['team']); offs = OFF.get(key, {}); picks = PICK.get(key, {})
    if (not offs and not picks) or p['no_prediction']: continue
    D = sims[('draw', p['game_id'], p['pid'], p['market'])] * 1.0
    for bid, (ln_, ov, un) in offs.items():
        po_raw = float(((D > ln_).sum() + .5) / (NS + 1)); po = float(sgm(K[p['market']] * lg(po_raw)))
        bo, bu = be(ov), be(un); nv = bo / (bo + bu)
        p['offers'].append(dict(book='Open' if bid == BK.OPEN else BK.NAME[bid], code='Open' if bid == BK.OPEN else BK.CODE[bid], line=ln_, over=ov, under=un, p_over=round(po, 4), novig_over=round(nv, 4),
                                edge_over=round(po - bo, 4), edge_under=round((1 - po) - bu, 4)))
    for bid, ln_ in picks.items():   # line only: no price, so no probability, edge or no-vig is attached
        p['offers'].append(dict(book=BK.NAME[bid], code=BK.CODE[bid], line=ln_, over=None, under=None, p_over=None, novig_over=None, edge_over=None, edge_under=None, pickem=True))
    for k, v in BK.SETS.items():
        for mode, st_ in (('raw', False), ('guarded', True)):
            r_ = price(p, set(v), stale=st_)
            if r_: CMP[k][mode][(p['game_id'], p['pid'], p['market'])] = (r_['best']['book'], r_['best']['side'], r_['best']['line'], r_['tier'])
    r_ = price(p, BEST)
    if not r_: continue
    p.update(best=r_['best'], interval=r_['interval'], kelly=r_['kelly'], ceiling=r_['ceiling'], tier=r_['tier']); o_ = r_['o']
    hub.setdefault(p['market'], []).append((p['median'], o_['line'], o_['p_over'], o_['novig_over']))


def _cmp(a, b):
    A, B = CMP[a][b], CMP['core5'][b]
    bets_a = {k for k, v in A.items() if v[3] == 'bet'}; bets_b = {k for k, v in B.items() if v[3] == 'bet'}
    return dict(priced=len(A), bets=len(bets_a), best_changed_vs_core5=sum(1 for k in A if k in B and A[k][:3] != B[k][:3]), priced_only_here=sum(1 for k in A if k not in B),
                bets_added_vs_core5=len(bets_a - bets_b), bets_dropped_vs_core5=len(bets_b - bets_a))
BOOK_SET = dict(best_set=BEST_SET, best_from=[n for n in BK.ORDER if n in BEST], requested_an_ids=BK.REQUEST, pickem_line_only=[n for n in BK.ORDER if BK.INFO[n]['kind'] == 'pickem'],
                min_edge_validated_on='core5', sets={k: list(v) for k, v in BK.SETS.items()},
                books_seen={n: sum(1 for p in props if any(o['book'] == n for o in p['offers'])) for n in BK.ORDER + ['Open']},
                compare={k: dict(raw=_cmp(k, 'raw'), stale_guarded=_cmp(k, 'guarded')) for k in BK.SETS},
                note='compare: tiers before the per-slate cap of 15 bets; stale_guarded applies the export stale-price guard first. Bets are counted over the whole week (thu + sun).')
HUB = {mk: dict(n=len(v), corr_median_line=round(float(np.corrcoef([a for a, _, _, _ in v], [b for _, b, _, _ in v])[0, 1]), 3),
                corr_p_novig=round(float(np.corrcoef([c for _, _, c, _ in v], [d_ for _, _, _, d_ in v])[0, 1]), 3)) for mk, v in hub.items() if len(v) > 5}
print('priced props', sum(p['best'] is not None for p in props), 'with any offer', sum(bool(p['offers']) for p in props), 'best from', BEST_SET, 'bets', sum(p['tier'] == 'bet' for p in props), 'hubacek', HUB)
# ---------------- same-game parlays from the joint simulation (pairs of leans)
par = []; LE = [p for p in props if p['tier'] == 'lean']
for i in range(len(LE)):
    for j in range(i + 1, len(LE)):
        a, b = LE[i], LE[j]
        if a['game_id'] != b['game_id'] or a['pid'] == b['pid']: continue
        Da, Db = sims[('draw', a['game_id'], a['pid'], a['market'])], sims[('draw', b['game_id'], b['pid'], b['market'])]
        ha = (Da > a['line']) if a['side'] == 'over' else (Da < a['line']); hb = (Db > b['line']) if b['side'] == 'over' else (Db < b['line'])
        pj = float((ha & hb).mean()); pi = float(ha.mean() * hb.mean())
        par.append(dict(game_id=a['game_id'], legs=[f"{a['name']} {a['side']} {a['line']} {LABEL[a['market']].lower()}", f"{b['name']} {b['side']} {b['line']} {LABEL[b['market']].lower()}"],
                        p_joint_raw=round(pj, 3), p_if_independent_raw=round(pi, 3), note='raw simulation, before calibration'))
par.sort(key=lambda x: -x['p_joint_raw'])
for p in props:
    p['up'] = [(a, round(b, 2)) for a, b in p['up']]; p['down'] = [(a, round(b, 2)) for a, b in p['down']]
print('book set', json.dumps(BOOK_SET['compare']), 'books seen', json.dumps(BOOK_SET['books_seen']))
def _clean(o):   # strict JSON: NaN / inf -> null, numpy scalars -> Python
    if isinstance(o, dict): return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [_clean(v) for v in o]
    if hasattr(o, 'item') and not isinstance(o, (str, bytes)): o = o.item()
    if isinstance(o, float) and not np.isfinite(o): return None
    return o
json.dump(_clean(dict(season=SEASON, week=WEEK, chosen=CHOSEN, validated=sorted(VALIDATED), K=K, rho=RHO, rho_game=RHO_GAME, games=games_out, props=props, parlays=par[:12], log=log, hubacek=HUB, book_set=BOOK_SET,
          prices_file=sorted(os.listdir(f'{H}/raw/an'))[-1] if os.path.isdir(f'{H}/raw/an') else None)),
          open(f'{W}/slate_{SEASON}_{WEEK:02d}.json', 'w'), allow_nan=False, default=str)
open(f'{W}/invariants_{SEASON}_{WEEK:02d}.log', 'w').write('\n'.join(log) or 'no violations')
print('props', len(props), 'with line', sum(p['line'] is not None for p in props), 'leans', len(LE), 'no-prediction', sum(p['no_prediction'] for p in props), 'parlays', len(par), 'log', len(log))
print('rho', {k: round(v, 3) for k, v in RHO.items()}, 'rho_game', round(RHO_GAME, 3), 'K', K)
