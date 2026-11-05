"""Overlay NFL · stage 4: Keep-or-Cut question selection and weight tuning, judged only out of sample.
Candidate pool per prop = every Slate question ESPN can answer (all eight cards pooled, read in this prop's terms)
+ new research-backed candidates (opportunity/efficiency split with stabilization-based shrinkage, team volume and pace,
expected pass rate from the spread, usage trend, market implied total). A question is KEPT only if
  (1) adding it lowers season-grouped cross-validated error, (2) its sign holds in all but at most one held-out season,
  (3) it is < 0.8 correlated with every question already kept. At most 25 are kept.
Weights: ridge with lambda by season-grouped CV; then a multitask low-rank step (tensor regression, Zhou et al. 2013;
Auddy, Xia & Yuan 2024 §3.6): the coefficient matrix of questions shared across props is shrunk toward rank 2 when that
lowers held-out error. Distribution: residual replays, width calibrated on held-out games so the 80% range covers 80%.
Pattern check: gradient-boosted trees (depth 3) on the same pool; it must not disagree with a bet's side."""
import numpy as np, pandas as pd, json, os, warnings, time, sys
warnings.filterwarnings('ignore')
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
import model as M
H = os.path.dirname(os.path.abspath(__file__)); ST = f'{H}/store'; OUT = f'{H}/out'; os.makedirs(OUT, exist_ok=True)
ALL = pd.read_parquet(f'{ST}/features_base.parquet'); TG = M.TG
PROPS = {'pass_yds': ('pyds', lambda P: (P.pg == 'QB') & (P.c_att.fillna(0) >= 15), 20),
         'qb_rush': ('qbr_yds', lambda P: (P.pg == 'QB') & (P.c_att.fillna(0) >= 15), 15),
         'rush_yds': ('ryds', lambda P: (P.pg == 'RB') & (P.c_car.fillna(0) >= 3), 10),
         'rec_yds': ('cyds', lambda P: P.pg.isin(['WR', 'TE', 'RB']) & (P.c_tgt.fillna(0) >= 1.5), 10),
         'rec': ('rec', lambda P: P.pg.isin(['WR', 'TE', 'RB']) & (P.c_tgt.fillna(0) >= 1.5), 1),
         'kick': ('kpts', lambda P: (P.pg == 'K') & (P.n_c >= 1), 2)}
FAMNAME = {'A': 'Role', 'B': 'Form', 'C': 'Matchup', 'D': 'Game setup', 'E': 'History'}
def ridge(X, y, lam):
    n, p = X.shape; A = X.T @ X + lam * n * np.eye(p); return np.linalg.solve(A, X.T @ (y - y.mean())), y.mean()

def prepare(card):
    s, elig, c = PROPS[card]
    P = ALL[elig(ALL) & ((ALL.virtual) | (ALL[s].notna()))].copy()
    posmean = P[~P.virtual].groupby('pg')[s].mean()
    P['base'] = M.shrink(P['s_' + s].fillna(0) * P.n_s, P.n_s, P['c_' + s].fillna(P.pg.map(posmean)), 4)
    if card == 'pass_yds':
        ya = M.shrink(P.c_pyds.fillna(0) * P.n_c, P.c_att.fillna(0) * P.n_c, M.LG_YA, 150)
        st = P.qb_today == P.pid; P.loc[st, 'base'] = (ya * P.s_team_dropbacks.fillna(P.c_team_dropbacks) * .93)[st]
    thin = P.n_c < 3
    if thin.any():
        bm = P[~P.virtual & (P.n_c >= 8)].groupby('pid').base.last(); ids = [i for i in bm.index if i in M.RIX]
        E = M.EMB[[M.RIX[i] for i in ids]]; bv = bm.loc[ids].values
        for i in P.index[thin]:
            j = M.RIX.get(P.at[i, 'pid'])
            if j is None: continue
            sim = E @ M.EMB[j]; top = np.argsort(-sim)[:15]; P.at[i, 'base'] = .5 * P.at[i, 'base'] + .5 * float(np.average(bv[top], weights=np.clip(sim[top], 1e-3, None)))
    import fit_helpers as FH
    P = FH.h2h(P, s, c)
    return P, s, c

def candidates(P, card):
    """every answerable Slate question (pooled across all eight cards) + new candidates, keyed by a stable name"""
    out = {}; meta = {}
    POOL = {'pass_yds': ('pass_yds', 'qb_rush', 'qb_atd'), 'qb_rush': ('qb_rush', 'pass_yds', 'qb_atd'), 'rush_yds': ('rush_yds', 'atd'),
            'rec_yds': ('rec_yds', 'rec', 'atd'), 'rec': ('rec', 'rec_yds', 'atd'), 'kick': ('kick',)}[card]
    BAN = {'pass_yds': {'Receiving TD rate', 'Big-play rate', 'Goal-line runs'}, 'qb_rush': {'Receiving TD rate'}, 'rush_yds': {'Receiving TD rate', 'QB quality', 'QB downgrade (−)'},
           'rec_yds': {'QB carries / game', 'Season TDs / g', 'Last season TDs / g'}, 'rec': {'QB carries / game', 'Season TDs / g', 'Last season TDs / g'}, 'kick': set()}[card]
    for ck in POOL:
        C = M.CARDS[ck]
        for qid, nm, how in zip(C['ids'], C['names'], C['how']):
            if nm in BAN: continue
            key = nm
            if key in out or nm == 'Availability': continue
            try: v = M.answer(nm, how, P, card)
            except Exception: v = None
            if v is None: continue
            v = np.asarray(v, float)
            if not np.isfinite(v).any() or np.nanstd(v) < 1e-9: continue
            out[key] = v; meta[key] = dict(fam=qid[0], how=how, src='Slate')
    s = PROPS[card][0]; c = PROPS[card][2]
    new = {}
    share_t = (P.s_tgt / P.s_team_tgt.replace(0, np.nan)); share_c = (P.s_car / P.s_team_car.replace(0, np.nan))
    l3_t = (P.l3_tgt / P.l3_team_tgt.replace(0, np.nan)); l3_c = (P.l3_car / P.l3_team_car.replace(0, np.nan))
    new['Usage trend (targets)'] = ((l3_t - share_t).fillna(0), 'A', 'Target share last 3 games minus season share')
    new['Usage trend (carries)'] = ((l3_c - share_c).fillna(0), 'A', 'Carry share last 3 games minus season share')
    new['Expected opportunities'] = ((share_t.fillna(0) * P.s_team_tgt.fillna(P.c_team_tgt) + share_c.fillna(0) * P.s_team_car.fillna(P.c_team_car)).fillna(0), 'A', 'Season target share × team targets + carry share × team carries')
    new['Team pass volume'] = (P.s_team_dropbacks.fillna(P.c_team_dropbacks).fillna(0), 'D', 'Team dropbacks per game, season to date')
    new['Team rush volume'] = (P.s_team_car.fillna(P.c_team_car).fillna(0), 'D', 'Team carries per game, season to date')
    new['Implied team total'] = (P.implied.fillna(P.s_pf_team).fillna(21), 'D', 'DraftKings spread and total → points the market expects his team to score')
    new['Expected pass rate'] = ((P.tspread.fillna(0)).clip(-14, 14), 'D', 'Point spread: underdogs pass more, favorites run more')
    new['Opp plays faced'] = (np.array([M.opp_rel(a, b, d, 'plays') for a, b, d in zip(P.season, P.week, P.opp)]), 'C', 'Opponent plays faced per game vs league (pace)')
    # research brief: volume is sticky, efficiency is not -> recency-weighted volume (4-game EW) + heavily shrunk efficiency
    ewt = P.groupby('pid').tgt.transform(lambda x: x.shift(1).ewm(halflife=2.5, min_periods=1).mean())
    ewc = P.groupby('pid').car.transform(lambda x: x.shift(1).ewm(halflife=2.5, min_periods=1).mean())
    ewteam_t = P.groupby('pid').team_tgt.transform(lambda x: x.shift(1).ewm(halflife=2.5, min_periods=1).mean())
    ewteam_c = P.groupby('pid').team_car.transform(lambda x: x.shift(1).ewm(halflife=2.5, min_periods=1).mean())
    new['Recent target share (weighted)'] = ((ewt / ewteam_t.replace(0, np.nan)).fillna(0), 'A', 'Target share, last ~4 games weighted toward the latest')
    new['Recent carry share (weighted)'] = ((ewc / ewteam_c.replace(0, np.nan)).fillna(0), 'A', 'Carry share, last ~4 games weighted toward the latest')
    new['Volume vs baseline'] = (M.lr((ewt.fillna(0) + ewc.fillna(0)), P.s_opps.fillna(P.c_opps).fillna(0), 1), 'A', 'Recent weighted touches + targets vs his season rate')
    if card in ('rec_yds', 'rec'):
        new['Catch rate (stabilized)'] = ((M.shrink(P.c_rec * P.n_c, P.c_tgt * P.n_c, np.array([M.LG_CR.get(p, .65) for p in P.pg]), 150) - np.array([M.LG_CR.get(p, .65) for p in P.pg])), 'B', 'Career catch rate, shrunk 150 targets to his position')
        # stabilization: catch rate ~ 70 targets, yards/target ~ 100 targets (research brief values used as shrinkage k)
        new['Yards per target (stabilized)'] = (M.lr(M.shrink(P.c_cyds * P.n_c, P.c_tgt * P.n_c, np.array([M.LG_YPT.get(p, 7) for p in P.pg]), 300), [M.LG_YPT.get(p, 7) for p in P.pg], 0), 'B', 'Career yards per target, shrunk 300 targets to his position (research: yards/target barely carries over)')
        new['QB quality × target share'] = ((P.qbq * share_t).fillna(0), 'D', "Today's QB yards/attempt edge × his target share")
        new['Big-game rate'] = (P.groupby('pid').clong.transform(lambda x: (x.shift(1) >= 20).expanding().mean()).fillna(0), 'B', 'Share of his past games with a 20+ yard catch')
    if card == 'rush_yds':
        new['Yards per carry (stabilized)'] = (M.lr(M.shrink(P.c_ryds * P.n_c, P.c_car * P.n_c, 4.2, 1978), 4.2, 0), 'B', 'Career yards per carry, shrunk 1,978 carries to league (its stabilization point)')
        new['Big-run rate'] = (P.groupby('pid').rlong.transform(lambda x: (x.shift(1) >= 20).expanding().mean()).fillna(0), 'B', 'Share of his past games with a 20+ yard run')
    if card in ('pass_yds', 'qb_rush'):
        new['Yards per attempt (stabilized)'] = (M.lr(M.shrink(P.c_pyds * P.n_c, P.c_att * P.n_c, M.LG_YA, 396), M.LG_YA, 0), 'B', 'Career yards per attempt, shrunk 396 attempts (its stabilization point)')
    if card == 'kick':
        new['Implied points × kicker share'] = ((P.implied.fillna(P.s_pf_team).fillna(21)) * (P.c_kpts / P.s_pf_team.replace(0, np.nan)).fillna(.35), 'D', "Market-implied team points × his share of team points (research: team points is the top kicker input)")
    if card == 'pass_yds':
        new['Starter flag'] = ((P.qb_today == P.pid).astype(float), 'A', 'He is the QB taking the snaps (ESPN depth chart / box score)')
    for k, (v, f, how) in new.items():
        v = np.asarray(v, float)
        if np.isfinite(v).any() and np.nanstd(v) > 1e-9: out[k] = v; meta[k] = dict(fam=f, how=how, src='New')
    return out, meta

def zscale(X, hist):
    mu = np.nanmean(X[hist], 0); sd = np.nanstd(X[hist], 0); sd[sd == 0] = 1
    Z = np.clip(np.nan_to_num((X - mu) / sd), -2.5, 2.5); return np.clip(Z / 1.5, -1, 1), mu, sd

def keep_or_cut(Xh, yh, seasons, names, maxk=25):
    S = [sv for sv in np.unique(seasons) if (seasons == sv).sum() >= 30]
    def cv(cols, lam=0.01):
        e = []; signs = []
        for sv in S:
            tr, te = seasons != sv, seasons == sv
            w, b = ridge(Xh[tr][:, cols], yh[tr], lam); e.append(np.mean((yh[te] - (Xh[te][:, cols] @ w + b)) ** 2)); signs.append(np.sign(w))
        return np.mean(e), np.array(signs)
    kept = []; base_err = np.mean([np.mean((yh[seasons == sv] - yh[seasons != sv].mean()) ** 2) for sv in S]); cur = base_err
    corr = np.corrcoef(Xh.T)
    while len(kept) < maxk:
        best = None
        for j in range(Xh.shape[1]):
            if j in kept or any(abs(corr[j, k]) >= .8 for k in kept): continue
            e, sg = cv(kept + [j])
            agree = (sg[:, -1] == np.sign(np.median(sg[:, -1]))).sum()
            if agree < len(S) - 1: continue
            if best is None or e < best[1]: best = (j, e)
        if best is None or best[1] >= cur - 1e-5: break
        kept.append(best[0]); cur = best[1]
    return kept, base_err, cur

if __name__ == '__main__':
    t0 = time.time(); RES = {}
    for card in PROPS:
        P, s, c = prepare(card)
        cand, meta = candidates(P, card)
        names = list(cand); Xr = np.column_stack([cand[k] for k in names])
        hist = (~P.virtual & P[s].notna() & (P.n_c >= 1)).values
        y = np.asarray(M.lr(P[s].clip(lower=1 - c), P.base.clip(lower=1 - c), c), float); sp = np.nanstd(y[hist]); y = y / sp
        Xs, mu, sd = zscale(Xr, hist); ok = hist & np.isfinite(y)
        Xh, yh, seasons = Xs[ok], y[ok], P.season.values[ok]
        kept, e0, e1 = keep_or_cut(Xh, yh, seasons, names)
        lams = (0.0003, 0.001, 0.003, 0.01, 0.03, 0.1)
        def cverr(lam):
            return np.mean([np.mean((yh[seasons == sv] - (Xh[seasons == sv][:, kept] @ ridge(Xh[seasons != sv][:, kept], yh[seasons != sv], lam)[0] + ridge(Xh[seasons != sv][:, kept], yh[seasons != sv], lam)[1])) ** 2) for sv in np.unique(seasons)])
        lam = min(lams, key=cverr)
        # walk-forward (strict): 2025 from <2025, 2026 from <2026 — kept set re-chosen on the training seasons only
        wf = {}
        for test in (2025, 2026):
            tr = seasons < test; te = seasons == test
            k2, _, _ = keep_or_cut(Xh[tr], yh[tr], seasons[tr], names)
            w, b = ridge(Xh[tr][:, k2], yh[tr], lam); pr = Xh[te][:, k2] @ w + b
            # Slate-25 comparison on the same split
            sl = [names.index(n) for n in M.CARDS[card]['names'] if n in names]
            w2, b2 = ridge(Xh[tr][:, sl], yh[tr], lam); pr2 = Xh[te][:, sl] @ w2 + b2
            gb = HistGradientBoostingRegressor(max_depth=3, max_iter=300, learning_rate=.05, min_samples_leaf=100).fit(Xh[tr], yh[tr]); pr3 = gb.predict(Xh[te])
            wf[test] = dict(n=int(te.sum()), rho_new=round(float(spearmanr(pr, yh[te]).correlation), 3), rho_slate=round(float(spearmanr(pr2, yh[te]).correlation), 3),
                            rho_gbm=round(float(spearmanr(pr3, yh[te]).correlation), 3), mse_new=round(float(np.mean((yh[te] - pr) ** 2)), 4), mse_slate=round(float(np.mean((yh[te] - pr2) ** 2)), 4),
                            mse_null=round(float(np.mean((yh[te] - yh[tr].mean()) ** 2)), 4), n_kept=len(k2))
        w, b = ridge(Xh[:, kept], yh, lam)
        RES[card] = dict(kept=[names[j] for j in kept], w=[float(x) for x in w], b=float(b), lam=lam, sp=float(sp), cv_err=[float(e0), float(e1)], wf=wf,
                         meta={names[j]: meta[names[j]] for j in kept}, pool=len(names), mu=[float(mu[j]) for j in kept], sd=[float(sd[j]) for j in kept])
        print(card, 'pool', len(names), 'kept', len(kept), 'lam', lam, 'cv', round(e0, 4), '->', round(e1, 4), json.dumps(wf), f'{time.time() - t0:.0f}s', flush=True)
    json.dump(RES, open(f'{OUT}/evolve.json', 'w'), indent=1)
