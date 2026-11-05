"""Overlay NFL · stage 2: player role embeddings by non-negative CP decomposition.
Following the tHoops framework reviewed in Reising (2019, ETSU thesis, sec. 3.3) and the CP model in
Auddy, Xia & Yuan (2024, sec. 2.2.1): the usage tensor
    U[player, usage stat, half-season]   (targets, receptions, rec yds, carries, rush yds, dropbacks, red-zone TDs ...)
is approximated by a sum of F rank-one tensors  a_f ∘ b_f ∘ c_f  with non-negative factors.
The player factor rows a_i are "soft memberships" in role prototypes (deep WR, slot WR, receiving back, early-down back,
pass-catching TE, pocket QB, running QB ...). The model uses them for two things:
  1. vacated volume: when a starter is out, his share goes to teammates at his position in proportion to how close
     their role vectors are to his (cosine), not evenly;
  2. thin histories: a player with < 3 games gets his baseline pulled toward players with the same role vector.
Fit uses only games before the date being predicted (the embedding for tonight uses everything through Week 8)."""
import numpy as np, pandas as pd, json, os
H = os.path.dirname(os.path.abspath(__file__)); ST = f'{H}/store'
PG = pd.read_parquet(f'{ST}/player_games.parquet')
US = ['tgt', 'rec', 'cyds', 'car', 'ryds', 'att', 'pyds', 'td']
def build(pg):
    pg = pg.copy(); pg['half'] = pg.season.astype(str) + np.where(pg.week <= 9, 'a', 'b')
    pg[US] = pg[US].fillna(0)
    agg = pg.groupby(['pid', 'half'])[US].mean().reset_index()
    agg = agg[agg[US].sum(axis=1) > 0]
    P = sorted(agg.pid.unique()); hs = sorted(agg.half.unique()); pi = {p: i for i, p in enumerate(P)}; hi = {h: i for i, h in enumerate(hs)}
    X = np.zeros((len(P), len(US), len(hs))); M = np.zeros_like(X)
    sc = np.array([agg[k][agg[k] > 0].quantile(.95) for k in US])      # scale each usage stat so yards don't swamp counts
    for r in agg.itertuples(index=False):
        X[pi[r.pid], :, hi[r.half]] = np.array(r[2:], float) / sc; M[pi[r.pid], :, hi[r.half]] = 1
    return P, hs, X, M
def ncp(X, M, F=8, it=200, seed=0):
    """Non-negative CP by masked multiplicative updates (missing half-seasons are unobserved, not zero)."""
    rng = np.random.default_rng(seed); I, J, K = X.shape
    A, B, C = rng.random((I, F)) + .1, rng.random((J, F)) + .1, rng.random((K, F)) + .1; e = 1e-9
    for _ in range(it):
        R = np.einsum('if,jf,kf->ijk', A, B, C) * M
        A *= np.einsum('ijk,jf,kf->if', X * M, B, C) / (np.einsum('ijk,jf,kf->if', R, B, C) + e)
        R = np.einsum('if,jf,kf->ijk', A, B, C) * M
        B *= np.einsum('ijk,if,kf->jf', X * M, A, C) / (np.einsum('ijk,if,kf->jf', R, A, C) + e)
        R = np.einsum('if,jf,kf->ijk', A, B, C) * M
        C *= np.einsum('ijk,if,jf->kf', X * M, A, B) / (np.einsum('ijk,if,jf->kf', R, A, B) + e)
    R = np.einsum('if,jf,kf->ijk', A, B, C)
    fit = 1 - np.linalg.norm((X - R) * M) / np.linalg.norm(X * M)
    return A, B, C, fit
if __name__ == '__main__':
    P, hs, X, M = build(PG)
    A, B, C, fit = ncp(X, M)
    emb = A / (np.linalg.norm(A, axis=1, keepdims=True) + 1e-9)
    np.save(f'{ST}/role_emb.npy', emb); np.save(f'{ST}/role_B.npy', B)
    json.dump(dict(players=P, halves=hs, stats=US, fit=round(float(fit), 3)), open(f'{ST}/role_axes.json', 'w'))
    top = {f: [US[j] for j in np.argsort(-B[:, f])[:3]] for f in range(B.shape[1])}
    print('players', len(P), 'half-seasons', len(hs), 'CP rank', A.shape[1], 'fit', round(float(fit), 3)); print('role prototypes (top usage stats):', top)
