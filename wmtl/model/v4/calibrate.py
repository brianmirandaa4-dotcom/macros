"""Stage 4 · walk-forward calibration at the market line. For week w, fit one temperature k (and, for ranges, a width factor)
on weeks before w only:  p_cal = sigmoid(k * logit(p_model)). k < 1 pulls overconfident probabilities toward 50/50.
Weeks with fewer than 150 earlier graded rows use k fit on the previous season at the reference line."""
import pandas as pd, numpy as np, json, os
from scipy.optimize import minimize_scalar
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W = f'{H}/work'
lg = lambda p: np.log(p / (1 - p)); sg = lambda x: 1 / (1 + np.exp(-x))
def fitk(p, o):
    p = np.clip(p, 1e-3, 1 - 1e-3); f = lambda k: -np.mean(o * np.log(sg(k * lg(p))) + (1 - o) * np.log(1 - sg(k * lg(p))))
    return minimize_scalar(f, bounds=(0.05, 1.5), method='bounded').x
def ll(p, o): p = np.clip(p, 1e-4, 1 - 1e-4); return float(-np.mean(o * np.log(p) + (1 - o) * np.log(1 - p)))
R = pd.read_parquet(f'{W}/backtest_props.parquet'); out = {}; rows = []
for mk, g in R.groupby('market'):
    h = g[g.line_close.notna() & (g.y != g.line_close)].copy(); h['o'] = (h.y > h.line_close).astype(float)
    res = {}
    for nm in 'AB':
        pc = np.full(len(h), np.nan); ks = {}
        for w in sorted(h.week.unique()):
            prev = h[h.week < w]
            k = fitk(prev[f'pov_{nm}_line_close'].values, prev.o.values) if len(prev) >= 150 else 0.5
            ks[int(w)] = round(float(k), 3); m = (h.week == w).values; pc[m] = sg(k * lg(np.clip(h.loc[m, f'pov_{nm}_line_close'].values, 1e-3, 1 - 1e-3)))
        h[f'pc_{nm}'] = pc; o = h.o.values; side = np.maximum(pc, 1 - pc); win = np.where(pc >= .5, o, 1 - o)
        pick = side >= .55
        b = np.clip((pc * 10).astype(int), 0, 9)
        res[nm] = dict(k_by_week=ks, logloss=round(ll(pc, o), 4), brier=round(float(np.mean((pc - o) ** 2)), 4), picks55=int(pick.sum()), hit55=round(float(win[pick].mean()), 4) if pick.any() else None,
                       roi55_assumed_minus110=round(float(np.mean(np.where(win[pick] == 1, 100 / 110, -1))), 4) if pick.any() else None,
                       calib=[[round(float(pc[b == k].mean()), 3), round(float(o[b == k].mean()), 3), int((b == k).sum())] for k in range(10) if (b == k).sum() >= 15])
    res['market_5050'] = dict(logloss=round(ll(np.full(len(h), .5), h.o.values), 4)); res['n'] = len(h); out[mk] = res
    rows.append(h)
json.dump(out, open(f'{W}/calibrated_2026.json', 'w'), indent=1); pd.concat(rows).to_parquet(f'{W}/calibrated_2026.parquet')
for mk, v in out.items(): print(mk, v['n'], 'mkt', v['market_5050']['logloss'], {nm: (v[nm]['logloss'], v[nm]['picks55'], v[nm]['hit55'], v[nm]['roi55_assumed_minus110'], list(v[nm]['k_by_week'].values())[-1]) for nm in 'AB'})
