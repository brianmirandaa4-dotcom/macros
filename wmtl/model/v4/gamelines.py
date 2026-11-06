"""Stage 3b · game model: each team's points from pregame features (LightGBM, mean) + the joint distribution of the two
teams' errors learned from training residuals (keeps the home/away correlation). 10,000 paired draws per game give
win, cover and over probabilities that sum correctly by construction.
Baseline = the closing market (nflverse/nfldata closing spread, total, moneyline WITH prices, vig removed).
Walk-forward by week; ROI is measured betting AT THE CLOSING PRICE, which is the hardest honest test.
Run: python3 src/gamelines.py  -> work/backtest_games.parquet, work/backtest_games_summary.json"""
import pandas as pd, numpy as np, os, json, warnings
warnings.filterwarnings('ignore'); import lightgbm as lgb
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W = f'{H}/work'; SEED = 20261105; NS = 10000
TF = ['t_plays', 't_proe', 't_off_epa', 't_off_pass_epa', 't_off_rush_epa', 't_neutral_plays', 't_dropbacks', 't_carries', 'qb_ypa_shr', 'qb_epa_shr', 'qb_change', 'rest']
def am2p(o): return np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
def p2dec(o): return np.where(o < 0, 1 + 100 / -o, 1 + o / 100)
def table():
    T = pd.read_parquet(f'{W}/feat_team.parquet'); G = pd.read_parquet(f'{W}/games.parquet')
    h = T[T.home == 1].set_index('game_id'); a = T[T.home == 0].set_index('game_id')
    X = pd.DataFrame(index=h.index)
    for c in TF: X[f'h_{c}'] = h[c]; X[f'a_{c}'] = a[c]
    X['h_def_pass'] = h.d_def_pass_epa; X['h_def_rush'] = h.d_def_rush_epa; X['a_def_pass'] = a.d_def_pass_epa; X['a_def_rush'] = a.d_def_rush_epa   # opponent defense faced
    for c in ['spread', 'total_line', 'dome', 'temp', 'wind', 'div_game']: X[c] = h[c]
    X = X.join(G.set_index('game_id')[['season', 'week', 'gameday', 'home_team', 'away_team', 'home_score', 'away_score', 'spread_line', 'total_line', 'home_moneyline', 'away_moneyline',
                                       'home_spread_odds', 'away_spread_odds', 'over_odds', 'under_odds']], rsuffix='_g')
    X['date'] = pd.to_datetime(X.gameday); return X.sort_values('date')
FEATS = None
def run():
    X = table(); feats = [c for c in X if c.startswith(('h_', 'a_')) or c in ('spread', 'total_line', 'dome', 'temp', 'wind', 'div_game')]
    done = X[X.home_score.notna()]; out = []
    for (s, w), te in done[done.season >= 2022].groupby(['season', 'week']):
        tr = done[done.date < te.date.min()]
        ms = {}
        for side in ('home', 'away'):
            ms[side] = lgb.LGBMRegressor(n_estimators=250, learning_rate=.03, num_leaves=7, min_child_samples=60, subsample=.8, subsample_freq=1, colsample_bytree=.7, reg_lambda=10,
                                         random_state=SEED, verbose=-1).fit(tr[feats], tr[f'{side}_score'])
        # residuals from out-of-fold-ish: last 3 seasons of training, predicted by the same fit (shrinks toward in-sample; widened below)
        rtr = tr[tr.season >= tr.season.max() - 2]
        E = np.column_stack([rtr.home_score - ms['home'].predict(rtr[feats]), rtr.away_score - ms['away'].predict(rtr[feats])])
        E = E - E.mean(0); infl = 1.08                                   # in-sample residuals understate error; fixed widening chosen on 2018-21 only
        rng = np.random.default_rng(int(SEED + s * 100 + w))
        mh, ma = ms['home'].predict(te[feats]), ms['away'].predict(te[feats])
        for i, (gid, r) in enumerate(te.iterrows()):
            e = E[rng.integers(0, len(E), NS)] * infl
            hs = np.maximum(0, np.round(mh[i] + e[:, 0])); as_ = np.maximum(0, np.round(ma[i] + e[:, 1]))
            mar = hs - as_; tot = hs + as_
            tie = mar == 0; p_home = (mar > 0).mean() + .5 * tie.mean()
            sl, tl = r.spread_line, r.total_line
            pc_home = ((mar > sl).mean()) / max(1e-9, 1 - (mar == sl).mean()); po = ((tot > tl).mean()) / max(1e-9, 1 - (tot == tl).mean())
            # market no-vig
            mh_ = am2p(np.array(r.home_moneyline)); ma_ = am2p(np.array(r.away_moneyline)); mkt_home = mh_ / (mh_ + ma_)
            sh_ = am2p(np.array(r.home_spread_odds)); sa_ = am2p(np.array(r.away_spread_odds)); mkt_cover = sh_ / (sh_ + sa_)
            oo = am2p(np.array(r.over_odds)); uu = am2p(np.array(r.under_odds)); mkt_over = oo / (oo + uu)
            out.append(dict(game_id=gid, season=s, week=w, home=r.home_team, away=r.away_team, p_home=p_home, mkt_home=float(mkt_home), p_cover=pc_home, mkt_cover=float(mkt_cover), p_over=po, mkt_over=float(mkt_over),
                            proj_margin=float(np.mean(mar)), proj_total=float(np.mean(tot)), y_margin=r.home_score - r.away_score, y_total=r.home_score + r.away_score, spread_line=sl, total_line=tl,
                            ml_h=r.home_moneyline, ml_a=r.away_moneyline, so_h=r.home_spread_odds, so_a=r.away_spread_odds, oo=r.over_odds, uo=r.under_odds))
        print(s, w, flush=True) if w == 1 else None
    R = pd.DataFrame(out); R.to_parquet(f'{W}/backtest_games.parquet'); return R
def summarize(R):
    S = {}
    def m(p, o):
        p = np.clip(p, 1e-4, 1 - 1e-4); return dict(logloss=round(float(-np.mean(o * np.log(p) + (1 - o) * np.log(1 - p))), 4), brier=round(float(np.mean((p - o) ** 2)), 4))
    for name, pm, pk, y, keep, oh, oa in (('moneyline', 'p_home', 'mkt_home', R.y_margin > 0, R.y_margin != 0, 'ml_h', 'ml_a'),
                                           ('spread', 'p_cover', 'mkt_cover', R.y_margin > R.spread_line, R.y_margin != R.spread_line, 'so_h', 'so_a'),
                                           ('total', 'p_over', 'mkt_over', R.y_total > R.total_line, R.y_total != R.total_line, 'oo', 'uo')):
        g = R[keep & R[pk].notna()]; o = y[keep & R[pk].notna()].values.astype(float)
        d = dict(n=len(g), model=m(g[pm].values, o), market_close=m(g[pk].values, o))
        for thr in (.03, .05):     # bet the side where model beats the no-vig close by thr, at the closing price
            eh = g[pm].values - g[pk].values; side_h = eh > thr; side_a = eh < -thr
            dec_h = p2dec(g[oh].values.astype(float)); dec_a = p2dec(g[oa].values.astype(float))
            pnl = np.concatenate([np.where(o[side_h] == 1, dec_h[side_h] - 1, -1), np.where(o[side_a] == 0, dec_a[side_a] - 1, -1)])
            d[f'bets_edge{int(thr*100)}'] = dict(n=int(len(pnl)), roi=round(float(pnl.mean()), 4) if len(pnl) else None, units=round(float(pnl.sum()), 1))
        p = g[pm].values; b = np.clip((p * 10).astype(int), 0, 9); d['calib'] = [[round(float(p[b == k].mean()), 3), round(float(o[b == k].mean()), 3), int((b == k).sum())] for k in range(10) if (b == k).sum() >= 15]
        S[name] = d
    S['by_season'] = {int(s): {k: round(float(v), 4) for k, v in dict(spread_ll_model=m(g.p_cover.values, (g.y_margin > g.spread_line).values.astype(float))['logloss'],
                                                                    spread_ll_market=m(g.mkt_cover.values, (g.y_margin > g.spread_line).values.astype(float))['logloss']).items()}
                      for s, g in R[R.y_margin != R.spread_line].groupby('season')}
    return S
if __name__ == '__main__':
    R = run(); S = summarize(R); json.dump(S, open(f'{W}/backtest_games_summary.json', 'w'), indent=1); print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != 'calib'} if isinstance(v, dict) else v for k, v in S.items()}, indent=0)[:2500])
