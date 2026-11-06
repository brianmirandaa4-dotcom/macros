"""In-game (live) prop model with time and score checkpoints. User-approved method (not in the library): re-simulate the
rest of the game. Remaining stat = learned blend of (pregame expectation x time remaining) and (pace so far x time remaining),
adjusted by game script (score state: down 14+, down 7-13, within 6, up 7-13, up 14+), with a learned spread that scales with
the expected remaining volume (count-like / Negative-Binomial-style variance). Efficiency and volume shrink toward the pregame
expectation exactly as far as the data says (Efron & Morris style: the blend weights are fit, not chosen).
Fit on 2018-2024, calibration temperature on 2025, validation on 2026 (never seen). Deterministic.
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
BN = ['down14', 'down7', 'up7', 'up14']
def design(d, pre):
    r = 1 - d.f.values; pace = d.so_far.values / np.maximum(d.f.values, .1)
    cols = [pre * r, pace * r, r] + [r * (d.bucket.values == b) for b in BN] + [pre * r * (d.bucket.values == b) for b in BN]
    return np.column_stack(cols)
SN_F = np.array([1 - T / 3600 for T in SNAP])
def fgroup(f): return np.array([str(SNAP[int(np.argmin(np.abs(SN_F - x)))]) for x in f])   # nearest checkpoint
lg = lambda p: np.log(p / (1 - p)); sgm = lambda x: 1 / (1 + np.exp(-x))
def dist_q(rem_hat, zq): return np.maximum(0, rem_hat[:, None] + zq * np.sqrt(np.maximum(rem_hat, .25))[:, None])
params = {'version': 1, 'snapshots_seconds_remaining': SNAP, 'named': NAMED, 'buckets': [[lo, hi, nm] for lo, hi, nm in BUCKETS], 'quantile_levels': [round(float(q), 4) for q in QL],
          'formula': ('f = elapsed fraction of 60 min; r = 1 - f; pace = so_far / max(f, 0.1); b_k = 1 if score bucket k (down14, down7, up7, up14) from the player team view else 0; '
                      'x = [pre*r, pace*r, r, r*b_down14, r*b_down7, r*b_up7, r*b_up14, pre*r*b_down14, pre*r*b_down7, pre*r*b_up7, pre*r*b_up14]; rem = max(0.05, beta . x); '
                      'final quantile q = so_far + max(0, rem + zq[group][q] * sqrt(max(rem, 0.25))), group = the checkpoint (seconds remaining) nearest to now; '
                      'P(final > line) = share of the 49 quantile levels with final > line, interpolated; calibrated p = sigmoid(k * logit(p)). pre = the pregame model projection.'),
          'markets': {}}
VAL = {}
for mk in MK:
    d = D[D.market == mk]; tr = d[d.season <= 2024]; ca = d[d.season == 2025]; te = d[d.season == 2026]
    beta, *_ = np.linalg.lstsq(design(tr, tr.pre.values), tr.rem.values, rcond=None)
    rh = np.maximum(.05, design(tr, tr.pre.values) @ beta); z = (tr.rem.values - rh) / np.sqrt(np.maximum(rh, .25)); g = fgroup(tr.f.values)
    zq = {str(T): np.quantile(z[g == str(T)], QL) for T in SNAP}
    def predq(x, pre):
        r = np.maximum(.05, design(x, pre) @ beta); gq = fgroup(x.f.values); Q = np.zeros((len(x), len(QL)))
        for gg in zq: m = gq == gg; Q[m] = dist_q(r[m], zq[gg])
        return x.so_far.values[:, None] + Q
    def pover(Q, line):
        return np.clip(np.array([1 - np.interp(l, q, QL, left=0, right=1) for q, l in zip(np.maximum.accumulate(Q, 1), line)]), .01, .99)
    # calibration temperature on 2025 at a reference line = pregame expectation rounded to .5 (no 2025 book lines stored)
    ref = np.floor(ca.pre.values) + .5; po = pover(predq(ca, ca.pre.values), ref); o = (ca.final.values > ref).astype(float)
    k = minimize_scalar(lambda k: -np.mean(o * np.log(sgm(k * lg(po))) + (1 - o) * np.log(1 - sgm(k * lg(po)))), bounds=(.2, 2), method='bounded').x
    # 2026 validation with the actual live input: the pregame model projection (walk-forward median) and the DraftKings pregame line
    v = te.merge(BT[BT.market == mk], on=['game_id', 'pid'], how='inner'); v = v[v.line_close.notna() & (v.final != v.line_close)]
    pre_live = v[f'med_{CHOSEN[mk]}'].values; Q = predq(v, pre_live); pl = sgm(k * lg(pover(Q, v.line_close.values))); o = (v.final.values > v.line_close.values).astype(float)
    pp = np.clip(v[f'pov_{CHOSEN[mk]}_line_close'].values, .01, .99)                                   # baseline A: pregame distribution, ignores the game
    pace = v.so_far.values / np.maximum(v.f.values, .1)                                                   # baseline B: naive pace (point forecast)
    lo, hi = Q[:, 4], Q[:, 44]; cov = float(np.mean((v.final.values >= lo) & (v.final.values <= hi)))   # 10th-90th
    ll = lambda p: float(-np.mean(o * np.log(p) + (1 - o) * np.log(1 - p)))
    res = {}
    for T in SNAP:
        m = v['T'].values == T
        if m.sum() < 40: continue
        oo = o[m]; l1 = float(-np.mean(oo * np.log(pl[m]) + (1 - oo) * np.log(1 - pl[m]))); l0 = float(-np.mean(oo * np.log(pp[m]) + (1 - oo) * np.log(1 - pp[m])))
        mae_live = float(np.mean(np.abs(np.median(Q[m], 1) - v.final.values[m]))); mae_pace = float(np.mean(np.abs(pace[m] - v.final.values[m])))
        res[str(T)] = dict(n=int(m.sum()), logloss_live=round(l1, 4), logloss_pregame=round(l0, 4), mae_live=round(mae_live, 2), mae_pace=round(mae_pace, 2),
                           cov80=round(float(np.mean((v.final.values[m] >= lo[m]) & (v.final.values[m] <= hi[m]))), 3))
    passed = all(r['logloss_live'] < r['logloss_pregame'] and r['mae_live'] < r['mae_pace'] and .75 <= r['cov80'] <= .85 for T, r in res.items() if int(T) <= 2700)
    VAL[mk] = dict(snapshots=res, cov80_all=round(cov, 3), k=round(float(k), 3), validated=bool(passed), n_train=int(len(tr)), n_test=int(len(v)))
    params['markets'][mk] = dict(beta=[round(float(b), 6) for b in beta], zq={gg: [round(float(x), 4) for x in zq[gg]] for gg in zq}, k=round(float(k), 4), validated=bool(passed))
json.dump(VAL, open(f'{W}/live_validation.json', 'w'), indent=1)
json.dump(params, open('/home/claude/wmtl/data/nfl/live_params.json', 'w'), separators=(',', ':'))
for mk, r in VAL.items():
    print(mk, 'validated' if r['validated'] else 'NOT validated', 'k', r['k'], 'cov80', r['cov80_all'], 'test n', r['n_test'])
    for T, x in r['snapshots'].items(): print('   ', NAMED.get(int(T), T), x)
