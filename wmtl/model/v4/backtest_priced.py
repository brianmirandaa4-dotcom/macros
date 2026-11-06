"""Stage 4b · prop backtest at real book prices, net of vig (Levitt 2004; Kaunitz et al. 2017), 2026 weeks 1-8 walk-forward.
Model probability at each book's line comes from the stored walk-forward quantile grid (qg_*, 25 quantiles) and the
walk-forward temperature for that week (calibrated_2026.json). Prices: Action Network last stored pre-game price (book 68 DK,
69 FD, 75 BetMGM, 71 BetRivers, 49 Caesars). Benchmarks: no-vig market probability (log loss), Hubacek correlation.
Selection by calibration/log loss, not ROI (Walsh & Joshi 2024). ROI shown for information.
Run: python3 src/backtest_priced.py -> work/backtest_priced.json"""
import pandas as pd, numpy as np, json, os, re, unicodedata
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W = f'{H}/work'
CHOSEN = {'receptions': 'B', 'rec_yds': 'B', 'rush_yds': 'A', 'pass_yds': 'A'}
LV = np.arange(2, 100, 4) / 100
CAL = json.load(open(f'{W}/calibrated_2026.json'))
def nm(x): return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', str(x)).encode('ascii', 'ignore').decode().lower()).replace(' jr', '').replace(' iii', '').replace(' ii', '').strip()
def be(o): return np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
def dec(o): return np.where(o < 0, 1 + 100 / -o, 1 + o / 100)
lg = lambda p: np.log(p / (1 - p)); sg = lambda x: 1 / (1 + np.exp(-x))
B = pd.read_parquet(f'{W}/backtest_props.parquet'); B = B[B.season == 2026]
A = pd.read_parquet(f'{W}/an_props_2026.parquet'); A = A[A.book_id.isin([68, 69, 75, 71, 49]) & (A.week <= 8)]
A['key'] = A.player.map(nm)
o = A[A.side == 'over'][['week', 'market', 'key', 'team', 'book_id', 'value', 'odds']].rename(columns={'odds': 'over'})
u = A[A.side == 'under'][['week', 'market', 'key', 'team', 'book_id', 'value', 'odds']].rename(columns={'odds': 'under'})
OU = o.merge(u, on=['week', 'market', 'key', 'team', 'book_id', 'value'])
B['key'] = B.name.map(nm)
M = B.merge(OU, on=['week', 'market', 'key', 'team'])
def pover(row):
    q = np.array(row[f"qg_{CHOSEN[row.market]}"], float); q = np.maximum.accumulate(q)
    F = np.interp(row.value, q, LV, left=0.01, right=0.99)
    if (q == row.value).any(): F = LV[np.where(q <= row.value)[0].max()]            # step at integer outcomes
    return float(np.clip(1 - F, .01, .99))
M['p_raw'] = M.apply(pover, axis=1)
M['k'] = [CAL[mk][CHOSEN[mk]]['k_by_week'].get(str(int(w)), .5) for mk, w in zip(M.market, M.week)]
M['p'] = sg(M.k * lg(M.p_raw))
M = M[M.y != M.value]; M['o'] = (M.y > M.value).astype(float)
bo, bu = be(M.over.values), be(M.under.values); M['nv'] = bo / (bo + bu); M['be_o'] = bo; M['be_u'] = bu
M['e_o'] = M.p - M.be_o; M['e_u'] = (1 - M.p) - M.be_u
def ll(p, y): p = np.clip(p, 1e-4, 1 - 1e-4); return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
out = {}
for mk, g in M.groupby('market'):
    d = g[g.book_id == 68]                                                               # DraftKings: probability scoring
    r = dict(n_dk=len(d), logloss_model=round(ll(d.p, d.o), 4), logloss_novig_market=round(ll(d.nv, d.o), 4), logloss_5050=round(ll(np.full(len(d), .5), d.o), 4),
             hubacek_corr_p_vs_novig=round(float(np.corrcoef(d.p, d.nv)[0, 1]), 3), over_rate=round(float(d.o.mean()), 3))
    # betting: for each player-game take the best edge across books; flat 1u at that price
    g = g.copy(); g['edge'] = np.maximum(g.e_o, g.e_u); g['side'] = np.where(g.e_o >= g.e_u, 'over', 'under')
    best = g.sort_values('edge').groupby(['game_id', 'pid']).tail(1)
    for thr in (0.0, .03, .05, .08):
        s = best[best.edge > thr]
        win = np.where(s.side == 'over', s.o, 1 - s.o); price = np.where(s.side == 'over', s.over, s.under)
        pnl = np.where(win == 1, dec(price) - 1, -1.0)
        r[f'bets_edge{int(thr*100)}'] = dict(n=int(len(s)), win=round(float(win.mean()), 3) if len(s) else None, roi=round(float(pnl.mean()), 4) if len(s) else None, units=round(float(pnl.sum()), 1),
                                            under_share=round(float((s.side == 'under').mean()), 3) if len(s) else None)
        for sd in ('over', 'under'):
            t = s[s.side == sd]; w_ = np.where(t.side == 'over', t.o, 1 - t.o); pr = np.where(t.side == 'over', t.over, t.under); pl = np.where(w_ == 1, dec(pr) - 1, -1.0)
            r[f'bets_edge{int(thr*100)}'][sd] = dict(n=int(len(t)), roi=round(float(pl.mean()), 4) if len(t) else None)
    out[mk] = r
json.dump(out, open(f'{W}/backtest_priced.json', 'w'), indent=1)
for mk, r in out.items():
    print(mk, {k: r[k] for k in ('n_dk', 'logloss_model', 'logloss_novig_market', 'logloss_5050', 'hubacek_corr_p_vs_novig', 'over_rate')})
    for t in (0, 3, 5, 8): x = r[f'bets_edge{t}']; print('   edge>', t, x['n'], 'win', x['win'], 'roi', x['roi'], 'units', x['units'], 'under', x['under_share'], 'O', x['over']['roi'], 'U', x['under']['roi'])
