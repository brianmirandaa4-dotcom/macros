import numpy as np, pandas as pd
import model as M
TG = M.TG
def h2h(P, s, c):
    """player vs this opponent (prior meetings since 2021) and team vs this opponent, both shrunk"""
    P = P.sort_values('date').copy(); P['po'] = P.pid + '|' + P.opp
    g = P.groupby('po'); n = g.cumcount(); cs = g[s].cumsum() - P[s]
    mean_vs = cs / n.replace(0, np.nan); w = n / (n + 3)
    P['h2h_n'] = n.values; P['h2h_prod'] = np.nan_to_num(w.values * M.lr(mean_vs, P.base, c))
    csv = g['opps'].cumsum() - P['opps']; P['h2h_vol'] = np.nan_to_num(w.values * M.lr(csv / n.replace(0, np.nan), P.c_opps, 1))
    P['h2h_last'] = np.nan_to_num(M.lr(g[s].shift(1), P.base, c))
    P['h2h_td'] = (w * ((g['td'].cumsum() - P['td']) / n.replace(0, np.nan) - P.c_td)).fillna(0).values
    P['h2h_lasttd'] = g['td'].shift(1).fillna(0).values; P['h2h_fga'] = (w * ((g['fga'].cumsum() - P['fga']) / n.replace(0, np.nan) - P.c_fga)).fillna(0).values
    # team vs opp: points the team scored in prior meetings vs its season usual
    tg = TG.sort_values('date').copy(); tg['to'] = tg.team + '|' + tg.opp; gg = tg.groupby('to'); nn = gg.cumcount()
    tg['tvo'] = (nn / (nn + 2)).values * M.lr((gg.pf.cumsum() - tg.pf) / nn.replace(0, np.nan), tg.groupby('team').pf.transform(lambda x: x.shift(1).expanding().mean()), 3)
    tv = tg.set_index(['team', 'opp']).groupby(level=[0, 1]).tvo.last()
    P['team_vs_opp'] = [tv.get((t, o), 0.0) if v else np.nan for t, o, v in zip(P.team, P.opp, P.virtual)]
    m = tg.set_index(['g', 'team']).tvo
    P.loc[~P.virtual, 'team_vs_opp'] = m.reindex(pd.MultiIndex.from_arrays([P.loc[~P.virtual, 'g'], P.loc[~P.virtual, 'team']])).values
    P['team_vs_opp'] = P.team_vs_opp.fillna(0)
    return P

