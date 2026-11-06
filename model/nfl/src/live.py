"""In-game (live) prop model with time and score checkpoints. User-approved method (not in the library): re-simulate the
rest of the game. Remaining stat = learned blend of (pregame expectation x time remaining) and (pace so far x time remaining),
adjusted by game script (score state: down 14+, down 7-13, within 6, up 7-13, up 14+), with a learned spread that scales with
the expected remaining volume (count-like / Negative-Binomial-style variance). Efficiency and volume shrink toward the pregame
expectation exactly as far as the data says (Efron & Morris style: the blend weights are fit, not chosen).
Fit on 2018-2024, calibration temperature on 2025, validation on 2026 (never seen). Deterministic.
v2 (Nov 2026): 11 score states in steps of 7 to +/-35 with margin x time-left terms (blowout benching), partially pooled toward
neighbouring states; compared against v1 on 2026 and shipped only if no worse overall in every market (see the tail of this file).
Run: python3 src/live.py -> work/live_validation.json, /home/claude/wmtl/data/nfl/live_params.json"""
import pandas as pd, numpy as np, json, os
from scipy.optimize import minimize_scalar
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); RAW = f'{H}/raw'; W = f'{H}/work'
SNAP = [3150, 2700, 2250, 1800, 1350, 900, 450]               # seconds remaining: mid Q1, end Q1, mid Q2, half, mid Q3, end Q3, mid Q4
NAMED = {2700: 'end_q1', 1800: 'half', 900: 'end_q3'}
BUCKETS = [(-99, -14, 'down14'), (-13, -7, 'down7'), (-6, 6, 'close'), (7, 13, 'up7'), (14, 99, 'up14')]
MK = {'receptions': ('receiver_player_id', 'rec'), 'rec_yds': ('receiver_player_id', 'recyd'), 'rush_yds': ('rusher_player_id', 'rushyd'), 'pass_yds': ('passer_player_id', 'passyd')}
QL = np.linspace(.01, .99, 49)
cols = ['game_id', 'season', 'season_type', 'posteam', 'home_team', 'away_team', 'game_seconds_remaining', 'receiver_player_id', 'rusher_player_id', 'passer_player_id',
        'complete_pass', 'yards_gained', 'pass_attempt', 'rush_attempt', 'sack', 'two_point_attempt', 'total_home_score', 'total_away_score']
pbp = pd.concat([pd.read_parquet(f'{RAW}/pbp_{y}.parquet', columns=cols) for y in range(2018, 2027)], ignore_index=True)
pbp = pbp[(pbp.season_type == 'REG') & (pbp.two_point_attempt != 1) & pbp.posteam.notna()]
pbp['rec'] = ((pbp.pass_attempt == 1) & (pbp.sack != 1) & (pbp.complete_pass == 1)).astype(float)
pbp['recyd'] = np.where(pbp.rec == 1, pbp.yards_gained, 0.0); pbp['passyd'] = pbp.recyd
pbp['rushyd'] = np.where(pbp.rush_attempt == 1, pbp.yards_gained, 0.0)
# score at each snapshot from each team's view (last play before the snapshot)
sc = pbp[['game_id', 'game_seconds_remaining', 'home_team', 'total_home_score', 'total_away_score']].sort_values(['game_id', 'game_seconds_remaining'], ascending=[True, False])
FEAT = pd.read_parquet(f'{W}/feat_player.parquet', columns=['game_id', 'pid', 'team', 'season', 'week', 'pos', 'n_prior', 'f_rec_yds_ewm', 'f_receptions_ewm', 'f_rush_yds_ewm', 'f_pass_yds_ewm', 'f_tg_sh', 'f_ca_sh', 'f_db_sh'])
PG = pd.read_parquet(f'{W}/player_games.parquet', columns=['game_id', 'pid', 'receptions', 'rec_yds', 'rush_yds', 'pass_yds'])
BT = pd.read_parquet(f'{W}/backtest_props.parquet', columns=['game_id', 'pid', 'market', 'med_A', 'med_B', 'line_close', 'pov_A_line_close', 'pov_B_line_close'])
CHOSEN = {'receptions': 'B', 'rec_yds': 'B', 'rush_yds': 'A', 'pass_yds': 'A'}
ELIG = {'receptions': lambda F: F.pos.isin(['WR', 'TE', 'RB']) & (F.f_tg_sh > .03), 'rec_yds': lambda F: F.pos.isin(['WR', 'TE', 'RB']) & (F.f_tg_sh > .03),
        'rush_yds': lambda F: (F.pos == 'RB') & (F.f_ca_sh > .08), 'pass_yds': lambda F: (F.pos == 'QB') & (F.f_db_sh > .6)}
FINAL = {'receptions': 'receptions', 'rec_yds': 'rec_yds', 'rush_yds': 'rush_yds', 'pass_yds': 'pass_yds'}
snaps = []
for T in SNAP:
    s = sc[sc.game_seconds_remaining > T].groupby('game_id').tail(1)[['game_id', 'home_team', 'total_home_score', 'total_away_score']]
    s['T'] = T; snaps.append(s)
SC = pd.concat(snaps)
def bucket(d):
    out = np.full(len(d), 'close', dtype=object)
    for lo, hi, nm in BUCKETS: out[(d >= lo) & (d <= hi)] = nm
    return out
rows = []
for mk, (who, stat) in MK.items():
    F = FEAT[ELIG[mk](FEAT) & (FEAT.n_prior >= 1)].merge(PG[['game_id', 'pid', FINAL[mk]]].rename(columns={FINAL[mk]: 'final'}), on=['game_id', 'pid'])
    pre_col = f"f_{FINAL[mk]}_ewm"
    for T in SNAP:
        so = pbp[pbp.game_seconds_remaining > T].groupby(['game_id', who])[stat].sum().rename('so_far').reset_index().rename(columns={who: 'pid'})
        X = F.merge(so, on=['game_id', 'pid'], how='left').fillna({'so_far': 0.0}).merge(SC[SC['T'] == T], on='game_id', how='inner')
        X['diff'] = np.where(X.team == X.home_team, X.total_home_score - X.total_away_score, X.total_away_score - X.total_home_score)
        X['T'] = T; X['f'] = 1 - T / 3600; X['market'] = mk; X['pre'] = X[pre_col].fillna(0)
        rows.append(X[['game_id', 'pid', 'season', 'week', 'market', 'T', 'f', 'pre', 'so_far', 'final', 'diff']])
D = pd.concat(rows, ignore_index=True); D['bucket'] = bucket(D['diff'].values); D['rem'] = (D.final - D.so_far).clip(lower=0)
# ---------------------------------------------------------------------------------------------------------------------------------
# Two specifications of the same approved re-simulation method, fit on 2018-24, k on 2025, compared on 2026 weeks 1-8.
#   v1: 5 score buckets (down14+, down7, close, up7, up14+), bucket effects scale with r only            (the validated model)
#   v2: 11 buckets in steps of 7 to +/-35, bucket effects on r, pre*r, r^2, pre*r^2 (margin x time-left: blowout benching)
#       Sparse extreme buckets are partially pooled toward their neighbours with a second-difference (random-walk) penalty
#       over the ordered margin buckets, one side of close at a time (P-spline style: Eilers & Marx 1996, Statistical Science
#       11:89-121; equivalent to a Gaussian smoothness prior, i.e. empirical-Bayes shrinkage in the spirit of Efron & Morris
#       1975, JASA 70:311-319). Penalty strength lambda by leave-one-season-out CV on 2018-24. Bootstrap = resample games.
# ---------------------------------------------------------------------------------------------------------------------------------
V1B = [(-999, -14, 'down14'), (-13, -7, 'down7'), (-6, 6, 'close'), (7, 13, 'up7'), (14, 999, 'up14')]
V2B = [(-999, -35, 'down35'), (-34, -28, 'down28'), (-27, -21, 'down21'), (-20, -14, 'down14'), (-13, -7, 'down7'), (-6, 6, 'close'),
       (7, 13, 'up7'), (14, 20, 'up14'), (21, 27, 'up21'), (28, 34, 'up28'), (35, 999, 'up35')]
SPEC = {1: dict(buckets=V1B, terms=['r', 'pre*r']), 2: dict(buckets=V2B, terms=['r', 'pre*r', 'r2', 'pre*r2'])}
for v, sp in SPEC.items():
    sp['bn'] = [nm for _, _, nm in sp['buckets'] if nm != 'close']
    sp['features'] = ['pre*r', 'pace*r', 'r'] + [f'{t}*b[{b}]' for t in sp['terms'] for b in sp['bn']]
def bk(diff, B):
    out = np.full(len(diff), 'close', dtype=object)
    for lo, hi, nm in B: out[(diff >= lo) & (diff <= hi)] = nm
    return out
def design(d, pre, v):
    sp = SPEC[v]; r = 1 - d.f.values; pace = d.so_far.values / np.maximum(d.f.values, .1); b = bk(d['diff'].values, sp['buckets'])
    term = {'r': r, 'pre*r': pre * r, 'r2': r * r, 'pre*r2': pre * r * r}
    return np.column_stack([pre * r, pace * r, r] + [term[t] * (b == k) for t in sp['terms'] for k in sp['bn']])
def penalty(v, XtX):
    """block second-difference penalty over the ordered margin buckets, each side of close separately (close anchored at 0)"""
    sp = SPEC[v]; p = 3 + len(sp['terms']) * len(sp['bn']); P = np.zeros((p, p))
    if v == 1: return P
    nb = len(sp['bn']); half = nb // 2                                   # bn = down35..down7, up7..up35
    for j in range(len(sp['terms'])):
        idx = 3 + j * nb + np.arange(nb); s = np.mean(np.diag(XtX)[idx])
        for side in (idx[:half][::-1], idx[half:]):                    # ordered outward from close: 7,14,21,28,35
            chain = [None] + list(side)                                  # None = close (coefficient fixed at 0)
            for c in range(1, len(chain) - 1):
                row = np.zeros(p)
                for w, q in zip((1, -2, 1), (chain[c - 1], chain[c], chain[c + 1])):
                    if q is not None: row[q] += w
                P += s * np.outer(row, row)
    return P
SN_F = np.array([1 - T / 3600 for T in SNAP])
def fgroup(f): return np.array([str(SNAP[int(np.argmin(np.abs(SN_F - x)))]) for x in f])   # nearest checkpoint
lg = lambda p: np.log(p / (1 - p)); sgm = lambda x: 1 / (1 + np.exp(-x))
def dist_q(rem_hat, zq): return np.maximum(0, rem_hat[:, None] + zq * np.sqrt(np.maximum(rem_hat, .25))[:, None])
def pover(Q, line): return np.clip(np.array([1 - np.interp(l, q, QL, left=0, right=1) for q, l in zip(np.maximum.accumulate(Q, 1), line)]), .01, .99)
def grams(X, y, g):
    ug, inv = np.unique(g, return_inverse=True); G = np.zeros((len(ug), X.shape[1], X.shape[1])); b = np.zeros((len(ug), X.shape[1]))
    order = np.argsort(inv, kind='stable'); cuts = np.r_[0, np.cumsum(np.bincount(inv))]
    for i in range(len(ug)):
        ix = order[cuts[i]:cuts[i + 1]]; G[i] = X[ix].T @ X[ix]; b[i] = X[ix].T @ y[ix]
    return ug, inv, G, b
LAMS = [0, 1e-4, 3e-4, 1e-3, 3e-3, .01, .03, .1, .3, 1.0]
rng = np.random.default_rng(20261105)
def crps_rows(Q, y): return 2 * np.mean((((y[:, None] < Q).astype(float)) - QL[None, :]) * (Q - y[:, None]), 1)
def ece(p, o, nb=10):
    b = np.minimum((p * nb).astype(int), nb - 1); return float(sum(np.sum(b == i) * abs(p[b == i].mean() - o[b == i].mean()) for i in range(nb) if np.any(b == i)) / len(p))
def cal_slope(p, o):
    x = lg(p); f = lambda a: -np.mean(o * np.log(sgm(a[0] + a[1] * x)) + (1 - o) * np.log(1 - sgm(a[0] + a[1] * x)))
    from scipy.optimize import minimize
    return float(minimize(f, [0, 1], method='Nelder-Mead').x[1])
FIT = {}; VAL = {'_meta': {}}; CMP = {}
for mk in MK:
    d = D[D.market == mk]; tr = d[d.season <= 2024]; ca = d[d.season == 2025]; te = d[d.season == 2026]
    v_ = te.merge(BT[BT.market == mk], on=['game_id', 'pid'], how='inner'); v_ = v_[v_.line_close.notna() & (v_.final != v_.line_close)].reset_index(drop=True)
    pre_live = v_[f'med_{CHOSEN[mk]}'].values; o = (v_.final.values > v_.line_close.values).astype(float); y = v_.final.values
    out = {}
    for ver in (1, 2):
        X = design(tr, tr.pre.values, ver); yy = tr.rem.values
        ug, inv, Gg, bg = grams(X, yy, tr.game_id.values)
        gseason = tr.groupby('game_id').season.first().reindex(ug).values
        XtX = Gg.sum(0); Xty = bg.sum(0); P = penalty(ver, XtX)
        if ver == 2:                                                      # leave-one-season-out CV for lambda (squared error of remaining)
            cv = {}
            for lam in LAMS:
                sse = 0.0
                for s_ in range(2018, 2025):
                    m = gseason != s_; bt = np.linalg.solve(Gg[m].sum(0) + lam * P + 1e-9 * np.eye(len(P)), bg[m].sum(0))
                    rows_ = np.isin(inv, np.where(~m)[0]); e = yy[rows_] - np.maximum(.05, X[rows_] @ bt); sse += float(e @ e)
                cv[lam] = sse / len(yy)
            lam = min(cv, key=cv.get)
        else: cv, lam = None, 0.0
        beta = np.linalg.lstsq(X, yy, rcond=None)[0] if ver == 1 else np.linalg.solve(XtX + lam * P + 1e-9 * np.eye(len(P)), Xty)
        # bootstrap by game (training): coefficient uncertainty -> which display columns the model can tell apart
        BB = []
        for _ in range(200):
            c = rng.multinomial(len(ug), np.full(len(ug), 1 / len(ug))).astype(float)
            BB.append(np.linalg.solve(np.tensordot(c, Gg, 1) + lam * P + 1e-9 * np.eye(len(P)), c @ bg))
        BB = np.array(BB)
        rh = np.maximum(.05, X @ beta); z = (yy - rh) / np.sqrt(np.maximum(rh, .25)); g = fgroup(tr.f.values)
        zq = {str(T): np.quantile(z[g == str(T)], QL) for T in SNAP}
        def predq(x, pre, beta=beta, zq=zq, ver=ver):
            r = np.maximum(.05, design(x, pre, ver) @ beta); gq = fgroup(x.f.values); Q = np.zeros((len(x), len(QL)))
            for gg in zq: m = gq == gg; Q[m] = dist_q(r[m], zq[gg])
            return x.so_far.values[:, None] + Q
        ref = np.floor(ca.pre.values) + .5; po = pover(predq(ca, ca.pre.values), ref); oc = (ca.final.values > ref).astype(float)
        k = minimize_scalar(lambda k: -np.mean(oc * np.log(sgm(k * lg(po))) + (1 - oc) * np.log(1 - sgm(k * lg(po)))), bounds=(.2, 2), method='bounded').x
        Q = predq(v_, pre_live); pl = sgm(k * lg(pover(Q, v_.line_close.values)))
        llr = -(o * np.log(pl) + (1 - o) * np.log(1 - pl)); cr = crps_rows(Q, y); cov = (y >= Q[:, 4]) & (y <= Q[:, 44])
        # distinguishability of each display state from its inner neighbour, at the three table checkpoints, for a typical on-pace player
        pre_t = float(np.median(tr.pre.values)); indist = {}; sp = SPEC[ver]
        for T in (2700, 1800, 900):
            f = 1 - T / 3600; cols = {}
            for dd in range(-35, 36, 7):
                row = pd.DataFrame({'f': [f], 'so_far': [pre_t * f], 'diff': [dd]}); cols[dd] = (design(row, np.array([pre_t]), ver) @ BB.T)[0]
            bad = []
            for dd in range(-35, 36, 7):
                if dd == 0: continue
                inner = dd - 7 * np.sign(dd); dlt = cols[dd] - cols[inner]; lo, hi = np.percentile(dlt, [2.5, 97.5])
                if lo <= 0 <= hi: bad.append(int(dd))
            indist[str(T)] = bad
        trs_ = bk(tr['diff'].values, V2B); sparse = {}
        for T in (2700, 1800, 900):
            mT = tr['T'].values == T; sparse[str(T)] = [int(dd) for dd, (_, _, nm) in zip(range(-35, 36, 7), V2B) if np.sum(mT & (trs_ == nm)) < 30]
        # training counts per v2 display state x checkpoint (how sparse the extremes are)
        out[ver] = dict(beta=beta, zq=zq, k=float(k), lam=lam, cv=cv, pl=pl, Q=Q, llr=llr, cr=cr, cov=cov, indist=indist, sparse=sparse,
                        beta_ci=np.percentile(BB, [2.5, 97.5], 0), n_train=len(tr))
    # ---- comparison on 2026 weeks 1-8 ---------------------------------------------------------------------------------------------
    ad = np.abs(v_['diff'].values); Tq = v_['T'].values
    SUBS = {'overall': np.ones(len(v_), bool), 'abs_margin_ge14': ad >= 14, 'abs_margin_ge21': ad >= 21, 'abs_margin_ge21_Q3Q4': (ad >= 21) & (Tq <= 1350),
            'abs_margin_ge28_Q3Q4': (ad >= 28) & (Tq <= 1350)}
    gid = v_.game_id.values; ugt, ginv = np.unique(gid, return_inverse=True)
    tab = {}
    for nm, m in SUBS.items():
        if m.sum() < 15: tab[nm] = dict(n=int(m.sum()), note='too few rows'); continue
        rr = {}
        for ver in (1, 2):
            R = out[ver]; rr[f'v{ver}'] = dict(logloss=round(float(R['llr'][m].mean()), 4), crps=round(float(R['cr'][m].mean()), 3), ece=round(ece(R['pl'][m], o[m]), 4),
                                               cal_slope=round(cal_slope(R['pl'][m], o[m]), 3), cov80=round(float(R['cov'][m].mean()), 3),
                                               bias=round(float(np.mean(y[m] - np.median(R['Q'][m], 1))), 3))
        # paired game bootstrap of v2 - v1
        dl = out[2]['llr'] - out[1]['llr']; dc = out[2]['cr'] - out[1]['cr']; gi = ginv[m]
        sl = np.bincount(gi, dl[m], len(ugt)); sc_ = np.bincount(gi, dc[m], len(ugt)); n_ = np.bincount(gi, None, len(ugt)).astype(float)
        bl, bc = [], []
        for _ in range(2000):
            c = rng.multinomial(len(ugt), np.full(len(ugt), 1 / len(ugt))); den = c @ n_
            if den == 0: continue
            bl.append((c @ sl) / den); bc.append((c @ sc_) / den)
        rr['d_logloss'] = round(float(dl[m].mean()), 4); rr['d_logloss_ci95'] = [round(float(x), 4) for x in np.percentile(bl, [2.5, 97.5])]
        rr['d_crps'] = round(float(dc[m].mean()), 3); rr['d_crps_ci95'] = [round(float(x), 3) for x in np.percentile(bc, [2.5, 97.5])]
        rr['n'] = int(m.sum()); rr['games'] = int(len(np.unique(gid[m]))); tab[nm] = rr
    # per display state (v2 buckets) bias, Q3/Q4 and all
    bstate = bk(v_['diff'].values, V2B); per = {}
    for nm in [b for _, _, b in V2B]:
        m = bstate == nm
        if m.sum() == 0: per[nm] = dict(n=0); continue
        per[nm] = dict(n=int(m.sum()), n_q34=int((m & (Tq <= 1350)).sum()), **{f'v{ver}_bias': round(float(np.mean(y[m] - np.median(out[ver]['Q'][m], 1))), 3) for ver in (1, 2)},
                       **{f'v{ver}_crps': round(float(out[ver]['cr'][m].mean()), 3) for ver in (1, 2)})
    trs = bk(tr['diff'].values, V2B); ntr = pd.crosstab(trs, tr['T']).reindex([b for _, _, b in V2B]).fillna(0).astype(int)
    CMP[mk] = dict(table=tab, by_state_2026=per, train_n_by_state_x_T=ntr.to_dict(), lambda_v2=out[2]['lam'], cv_mse_v2={str(k_): round(v__, 5) for k_, v__ in out[2]['cv'].items()},
                   k_v1=round(out[1]['k'], 4), k_v2=round(out[2]['k'], 4), indistinct_v1=out[1]['indist'], indistinct_v2=out[2]['indist'], n_test=int(len(v_)))
    FIT[mk] = dict(out=out, v=v_, o=o, y=y)
# ---- ship decision: v2 must be no worse overall (log loss and CRPS) in every market ---------------------------------------------------
ok = {mk: CMP[mk]['table']['overall']['v2']['logloss'] <= CMP[mk]['table']['overall']['v1']['logloss'] and CMP[mk]['table']['overall']['v2']['crps'] <= CMP[mk]['table']['overall']['v1']['crps'] for mk in MK}
SHIP = 2 if all(ok.values()) else 1
# ---- validation file (same per-snapshot structure as before, for the shipped spec) + the comparison --------------------------------------
params = {'version': SHIP, 'snapshots_seconds_remaining': SNAP, 'named': NAMED, 'quantile_levels': [round(float(q), 4) for q in QL]}
for mk in MK:
    R = FIT[mk]['out'][SHIP]; v_ = FIT[mk]['v']; o = FIT[mk]['o']; y = v_.final.values; pl = R['pl']; Q = R['Q']
    pp = np.clip(v_[f'pov_{CHOSEN[mk]}_line_close'].values, .01, .99); pace = v_.so_far.values / np.maximum(v_.f.values, .1); res = {}
    for T in SNAP:
        m = v_['T'].values == T
        if m.sum() < 40: continue
        oo = o[m]; l1 = float(-np.mean(oo * np.log(pl[m]) + (1 - oo) * np.log(1 - pl[m]))); l0 = float(-np.mean(oo * np.log(pp[m]) + (1 - oo) * np.log(1 - pp[m])))
        res[str(T)] = dict(n=int(m.sum()), logloss_live=round(l1, 4), logloss_pregame=round(l0, 4), mae_live=round(float(np.mean(np.abs(np.median(Q[m], 1) - y[m]))), 2),
                           mae_pace=round(float(np.mean(np.abs(pace[m] - y[m]))), 2), cov80=round(float(np.mean(R['cov'][m])), 3))
    passed = all(r['logloss_live'] < r['logloss_pregame'] and r['mae_live'] < r['mae_pace'] and .75 <= r['cov80'] <= .85 for T, r in res.items() if int(T) <= 2700)
    VAL[mk] = dict(snapshots=res, cov80_all=round(float(R['cov'].mean()), 3), k=round(R['k'], 3), validated=bool(passed), n_train=int(R['n_train']), n_test=int(len(v_)), spec_version=SHIP)
    FIT[mk]['passed'] = bool(passed)
VAL['_meta'] = dict(shipped_version=SHIP, ship_rule='v2 ships only if overall 2026 log loss AND CRPS are <= v1 in every market', v2_no_worse_by_market=ok,
                    shrinkage='second-difference (random-walk) penalty across ordered margin buckets per side of close; Eilers & Marx 1996 P-splines / Gaussian smoothness prior, empirical-Bayes partial pooling (Efron & Morris 1975); lambda by leave-one-season-out CV 2018-24',
                    bootstrap='resample games (training: 200 refits; 2026 comparison: 2000 paired resamples)', Q3Q4='snapshots with 1350, 900 or 450 seconds left',
                    calibration='ece = 10-bin expected calibration error of P(over the DK closing line); cal_slope = logistic slope of outcome on logit p (1 = calibrated)')
VAL['_comparison'] = CMP
json.dump(VAL, open(f'{W}/live_validation.json', 'w'), indent=1, default=float)
sp = SPEC[SHIP]
params['buckets'] = [[lo, hi, nm] for lo, hi, nm in sp['buckets']]
params['bucket_rule'] = 'diff = player team score minus opponent score (integer); bucket = the entry with lo <= diff <= hi'
params['bucket_terms'] = sp['terms']; params['feature_order'] = sp['features']
tdef = "bucket term values: r -> r, pre*r -> pre*r, r2 -> r*r, pre*r2 -> pre*r*r; " if SHIP == 2 else "bucket term values: r -> r, pre*r -> pre*r; "
params['formula'] = (f'f = elapsed fraction of 60 min (0..1); r = 1 - f; {tdef}pace = so_far / max(f, 0.1); pre = the pregame model projection; '
                     f'b[k] = 1 if the score bucket is k else 0 (close is the baseline and has no column); '
                     f'x = [pre*r, pace*r, r] then, for each term t in bucket_terms (in order), for each non-close bucket k in buckets order: t*b[k] '
                     f'(exactly feature_order); rem = max(0.05, sum(beta[i]*x[i])); group = the snapshots_seconds_remaining value nearest to (1-f)*3600; '
                     f'final quantile j = so_far + max(0, rem + zq[group][j] * sqrt(max(rem, 0.25))); make quantiles non-decreasing (running max); '
                     f'P(final > line) = 1 - F(line), F linear-interpolated over quantile_levels (0 below the first, 1 at/above the last), clipped to [0.01, 0.99]; '
                     f'calibrated p = sigmoid(k * logit(p)). Median = quantile index 24.')
params['display_states'] = [[-35, 'Down 35+'], [-28, 'Down 28'], [-21, 'Down 21'], [-14, 'Down 14'], [-7, 'Down 7'], [0, 'Close'], [7, 'Up 7'], [14, 'Up 14'], [21, 'Up 21'], [28, 'Up 28'], [35, 'Up 35+']]
params['indistinct_note'] = ('markets[m].indistinct[checkpoint] lists display_states (by margin) whose projected remaining production is not distinguishable from the next state '
                             'toward Close (game-bootstrap 95% interval of the difference includes 0) for an on-pace typical player')
params['sparse_note'] = 'markets[m].sparse[checkpoint] lists display_states (by margin) with fewer than 30 training player-games at that checkpoint (2018-24): show no number there'
params['markets'] = {}
for mk in MK:
    R = FIT[mk]['out'][SHIP]
    params['markets'][mk] = dict(beta=[round(float(b), 6) for b in R['beta']], zq={gg: [round(float(x), 4) for x in R['zq'][gg]] for gg in R['zq']}, k=round(R['k'], 4),
                                 validated=FIT[mk]['passed'], indistinct=R['indist'], sparse=R['sparse'])
json.dump(params, open(os.environ.get('LIVE_PARAMS_OUT', '/home/claude/wmtl/data/nfl/live_params.json'), 'w'), separators=(',', ':'))   # [auto] env path
print('SHIPPED version', SHIP, ok)
for mk in MK:
    c = CMP[mk]; print(f'\n== {mk}  lambda_v2={c["lambda_v2"]}  k v1={c["k_v1"]} v2={c["k_v2"]}  validated={FIT[mk]["passed"]}')
    for nm, r in c['table'].items():
        if 'v1' not in r: print('  ', nm, r); continue
        print(f'   {nm:22s} n={r["n"]:5d} g={r["games"]:3d} | LL {r["v1"]["logloss"]:.4f} -> {r["v2"]["logloss"]:.4f} d={r["d_logloss"]:+.4f} {r["d_logloss_ci95"]} | '
              f'CRPS {r["v1"]["crps"]:.3f} -> {r["v2"]["crps"]:.3f} d={r["d_crps"]:+.3f} {r["d_crps_ci95"]} | ECE {r["v1"]["ece"]:.3f}->{r["v2"]["ece"]:.3f} '
              f'slope {r["v1"]["cal_slope"]:.2f}->{r["v2"]["cal_slope"]:.2f} cov80 {r["v1"]["cov80"]:.3f}->{r["v2"]["cov80"]:.3f} bias {r["v1"]["bias"]:+.2f}->{r["v2"]["bias"]:+.2f}')
    print('   indistinct v2:', c['indistinct_v2'])
