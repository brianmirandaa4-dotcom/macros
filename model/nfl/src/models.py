"""Stage 3 · two trained prop models + walk-forward backtest by week.
  A  LightGBM quantile regression (11 quantiles) on the 20+ feature dims  -> full predictive distribution
  B  Two-stage hierarchical model: volume ~ Negative Binomial GLM (targets / carries / attempts),
     per-unit efficiency = player's empirically-Bayes-shrunk rate x learned adjustment, per-unit noise learned
     from data; receptions = Binomial(targets, shrunk catch rate x adjustment). Simulated.
Walk-forward: for each eval week, fit on every game strictly before that week, predict that week, never look back.
Metrics: CRPS, 80% coverage, log loss / Brier / hit rate at the DraftKings line (2026, via ESPN) and at a
model-free reference line (earlier seasons). Market baseline for props = 50/50 at the DraftKings line (no prices posted).
Run: python3 src/models.py [--seasons 2024,2025,2026]   -> work/backtest_props.parquet, work/backtest_summary.json"""
import pandas as pd, numpy as np, os, sys, json, warnings
warnings.filterwarnings('ignore')
import lightgbm as lgb
from sklearn.linear_model import PoissonRegressor, Ridge
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from features import feats
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W = f'{H}/work'
QS = np.array([.03, .1, .2, .3, .4, .5, .6, .7, .8, .9, .97]); NS = 400; SEED = 20261105
MK = {   # target, volume, efficiency feature, eligible rows
 'rec_yds': dict(y='rec_yds', v='targets', e='f_ypt_shr', ok=lambda P: P.pos.isin(['WR', 'TE', 'RB']) & (P.f_tg_sh > .03)),
 'receptions': dict(y='receptions', v='targets', e='f_cr_shr', ok=lambda P: P.pos.isin(['WR', 'TE', 'RB']) & (P.f_tg_sh > .03)),
 'rush_yds': dict(y='rush_yds', v='carries', e='f_ypc_shr', ok=lambda P: (P.pos == 'RB') & (P.f_ca_sh > .08)),
 'pass_yds': dict(y='pass_yds', v='pass_att', e='qb_ypa_shr', ok=lambda P: (P.pos == 'QB') & (P.f_db_sh > .6)),
}
def zfit(X): mu = np.nanmean(X, 0); sd = np.nanstd(X, 0) + 1e-9; return mu, sd
def z(X, mu, sd): return np.clip(np.nan_to_num((X - mu) / sd), -4, 4)

def fit_A(Xtr, ytr):
    return [lgb.LGBMRegressor(objective='quantile', alpha=q, n_estimators=160, learning_rate=.05, num_leaves=15, min_child_samples=80,
                              subsample=.8, subsample_freq=1, colsample_bytree=.8, reg_lambda=5, random_state=SEED, verbose=-1).fit(Xtr, ytr) for q in QS]
def samp_A(ms, X, rng):
    Q = np.sort(np.column_stack([m.predict(X) for m in ms]), 1)               # sort fixes quantile crossing
    u = rng.uniform(QS[0], QS[-1], (len(X), NS))
    return np.maximum(0, np.array([np.interp(u[i], QS, Q[i]) for i in range(len(X))])), Q

def fit_B(Xtr, vtr, ytr, etr, market):
    pv = PoissonRegressor(alpha=1e-3, max_iter=300).fit(Xtr, vtr); lam = pv.predict(Xtr)
    r = max(2.0, np.mean(lam) ** 2 / max(1e-6, np.var(vtr - lam) - np.mean(lam)))      # NB size by moments
    m = vtr > 0; rate = ytr[m] / vtr[m]
    adj = Ridge(alpha=50).fit(Xtr[m], rate / etr[m], sample_weight=vtr[m])              # learned multiplier on the shrunk rate
    e_hat = etr[m] * adj.predict(Xtr[m])
    s2 = np.sum((ytr[m] - vtr[m] * e_hat) ** 2) / np.sum(vtr[m])                         # per-unit variance
    return dict(pv=pv, r=r, adj=adj, s2=s2, market=market)
def samp_B(B, X, e, rng):
    lam = B['pv'].predict(X); r = B['r']; p = r / (r + lam)
    v = rng.negative_binomial(r, p[:, None], (len(X), NS))
    eh = np.clip(e * B['adj'].predict(X), 0, None)[:, None]
    if B['market'] == 'receptions': return rng.binomial(v, np.clip(eh, 0, .95)).astype(float)
    return np.maximum(0, v * eh + rng.standard_normal(v.shape) * np.sqrt(v * B['s2']))

def crps(S, y):     # sample CRPS
    S = np.sort(S, 1); n = S.shape[1]; t1 = np.abs(S - y[:, None]).mean(1)
    w = (2 * np.arange(1, n + 1) - n - 1) / n ** 2; return t1 - (S * w).sum(1)

def run(seasons):
    P = pd.read_parquet(f'{W}/feat_player.parquet'); P = P[P.n_prior >= 1]
    L = pd.read_parquet(f'{W}/espn_dk_prop_lines_2026.parquet') if os.path.exists(f'{W}/espn_dk_prop_lines_2026.parquet') else None
    P['espn_id'] = pd.to_numeric(P.espn_id, errors='coerce')
    rows = []
    for mk, cfg in MK.items():
        cols = feats(mk); D = P[cfg['ok'](P) & P[cfg['e']].notna()].copy()
        if L is not None:
            l = L[L.market == mk][['espn_id', 'season', 'week', 'line_close', 'line_open']].copy(); l['espn_id'] = pd.to_numeric(l.espn_id, errors='coerce')
            D = D.merge(l.drop_duplicates(['espn_id', 'season', 'week']), on=['espn_id', 'season', 'week'], how='left')
        else: D['line_close'] = np.nan
        D['ref_line'] = np.floor(D[f"f_{cfg['y']}_ewm"].fillna(0)) + .5                     # model-free reference line
        D = D.sort_values('date')
        for s in seasons:
            for w in sorted(D[D.season == s].week.unique()):
                tr = D[D.date < D[(D.season == s) & (D.week == w)].date.min()]; te = D[(D.season == s) & (D.week == w)]
                if len(te) == 0: continue
                Xtr = tr[cols].values.astype(float); mu, sd = zfit(Xtr); Ztr = z(Xtr, mu, sd); Zte = z(te[cols].values.astype(float), mu, sd)
                rng = np.random.default_rng(int(SEED + s * 100 + w))
                A = fit_A(Ztr, tr[cfg['y']].values); SA, QA = samp_A(A, Zte, rng)
                B = fit_B(Ztr, tr[cfg['v']].values.astype(float), tr[cfg['y']].values.astype(float), tr[cfg['e']].values, mk); SB = samp_B(B, Zte, te[cfg['e']].values, rng)
                y = te[cfg['y']].values.astype(float)
                out = te[['game_id', 'pid', 'name', 'team', 'season', 'week', 'line_close', 'ref_line']].copy(); out['market'] = mk; out['y'] = y
                for nm, S in (('A', SA), ('B', SB)):
                    out[f'crps_{nm}'] = crps(S, y); out[f'med_{nm}'] = np.median(S, 1); out[f'mean_{nm}'] = S.mean(1)
                    out[f'qg_{nm}'] = list(np.percentile(S, np.arange(2, 100, 4), axis=1).T.round(2))
                    lo, hi = np.percentile(S, [10, 90], axis=1); out[f'cov80_{nm}'] = (y >= lo) & (y <= hi)
                    for ln in ('line_close', 'ref_line'):
                        lv = te[ln].values; out[f'pov_{nm}_{ln}'] = np.where(np.isnan(lv), np.nan, ((S > lv[:, None]).mean(1) * NS + .5) / (NS + 1))
                naive = te[f"f_{cfg['y']}_ewm"].values; out['crps_naive'] = np.abs(naive - y)          # point forecast baseline (CRPS of a point = abs error)
                rows.append(out)
            print(mk, s, 'done', flush=True)
    R = pd.concat(rows); R.to_parquet(f'{W}/backtest_props.parquet'); return R

def summarize(R):
    def binm(p, o):
        p = np.clip(p, 1e-4, 1 - 1e-4); return dict(n=int(len(p)), logloss=round(float(-np.mean(o * np.log(p) + (1 - o) * np.log(1 - p))), 4), brier=round(float(np.mean((p - o) ** 2)), 4),
                                                     hit=round(float(np.mean((p > .5) == o)), 4))
    S = {}
    for mk, g in R.groupby('market'):
        S[mk] = dict(n=len(g), crps=dict(A=round(g.crps_A.mean(), 3), B=round(g.crps_B.mean(), 3), naive_point=round(g.crps_naive.mean(), 3)), cov80=dict(A=round(g.cov80_A.mean(), 3), B=round(g.cov80_B.mean(), 3)))
        for ln in ('line_close', 'ref_line'):
            h = g[g[ln].notna() & (g.y != g[ln])]; o = (h.y > h[ln]).values.astype(float)
            if len(h) < 30: continue
            S[mk][ln] = dict(A=binm(h[f'pov_A_{ln}'].values, o), B=binm(h[f'pov_B_{ln}'].values, o), market_5050=binm(np.full(len(h), .5), o), over_rate=round(float(o.mean()), 3))
            # calibration bins and flat-stake result at an ASSUMED -110 (prices not posted) for side with p>=.55
            for nm in 'AB':
                p = h[f'pov_{nm}_{ln}'].values; side_p = np.maximum(p, 1 - p); win = np.where(p >= .5, o, 1 - o); pick = side_p >= .55
                S[mk][ln][nm]['picks55'] = int(pick.sum()); S[mk][ln][nm]['hit55'] = round(float(win[pick].mean()), 4) if pick.any() else None
                S[mk][ln][nm]['roi55_at_minus110_assumed'] = round(float(np.mean(np.where(win[pick] == 1, 100 / 110, -1))), 4) if pick.any() else None
                b = np.clip((p * 10).astype(int), 0, 9); S[mk][ln][nm]['calib'] = [[round(float(p[b == k].mean()), 3), round(float(o[b == k].mean()), 3), int((b == k).sum())] for k in range(10) if (b == k).sum() >= 20]
    return S

if __name__ == '__main__':
    seasons = [int(x) for x in (sys.argv[sys.argv.index('--seasons') + 1].split(',') if '--seasons' in sys.argv else ['2024', '2025', '2026'])]
    R = run(seasons); S = summarize(R); json.dump(S, open(f'{W}/backtest_summary.json', 'w'), indent=1)
    for mk, v in S.items(): print(mk, v['crps'], v['cov80'], {k: (v[k]['A']['logloss'], v[k]['B']['logloss'], v[k]['market_5050']['logloss']) for k in ('line_close', 'ref_line') if k in v})
