"""Stage 2 · leak-free features, one row per player-game (and per team-game for game lines).
Rule: a feature on a row may use (a) that player's / team's games strictly BEFORE this game, and
(b) pregame structured inputs for this game: closing spread/total, roof, temperature, wind, rest, home,
the listed starting QB, and the official injury report for this week. Nothing else.
Sample size is never a feature; it only sets how hard efficiency is shrunk toward the position mean.
Run:  python3 src/features.py            -> work/feat_player.parquet, work/feat_team.parquet
      python3 src/features.py --leakcheck -> rebuild with one week's results scrambled and prove no earlier row moved."""
import pandas as pd, numpy as np, os, sys, json
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W = f'{H}/work'
HL, HL_FAST = 4.0, 2.0           # half-lives in games for usage and recent form
PRIOR = dict(ypt=(8.0, 60), ypc=(4.2, 120), ypa=(6.6, 250), cr=(0.65, 40))   # (position-free mean placeholder, strength in attempts); means are refit below from data before each season

def ewm_prev(s, hl):            # exponentially weighted mean of PREVIOUS games only
    return s.shift(1).ewm(halflife=hl, min_periods=1).mean()

def build(PG, TG, G, INJ, scramble=None, DP=None):
    PG = PG.copy(); TG = TG.copy(); TG[TG.select_dtypes("number").columns] = TG.select_dtypes("number").astype(float); PG[PG.select_dtypes("number").columns] = PG.select_dtypes("number").astype(float)
    if scramble is not None:    # leakage test: change every result in one (season, week); earlier rows must not move
        s, w = scramble; rng = np.random.default_rng(0)
        m = (PG.season == s) & (PG.week == w)
        for c in ['targets', 'receptions', 'rec_yds', 'air_yds', 'carries', 'rush_yds', 'pass_yds', 'pass_att', 'completions', 'dropbacks', 'rz_targets', 'rz_carries', 'offense_pct']:
            PG.loc[m, c] = rng.permutation(PG.loc[m, c].values) + rng.integers(0, 5, m.sum())
        mt = (TG.season == s) & (TG.week == w)
        for c in ['plays', 'dropbacks', 'pass_att', 'carries', 'targets', 'off_epa', 'proe', 'def_pass_epa', 'def_rush_epa', 'off_pass_epa', 'team_pass_yds', 'team_rush_yds', 'rz_plays']:
            TG.loc[mt, c] = rng.permutation(TG.loc[mt, c].values) * 1.3
    G = G.copy(); G['date'] = pd.to_datetime(G.gameday)
    # ---------------- team side, pregame
    TG = TG.merge(G[['game_id', 'date']], on='game_id').sort_values(['team', 'date'])
    g = TG.groupby('team')
    for c in ['plays', 'dropbacks', 'carries', 'targets', 'proe', 'off_epa', 'off_pass_epa', 'off_rush_epa', 'neutral_plays', 'rz_plays']:
        TG[f't_{c}'] = g[c].transform(lambda s: ewm_prev(s, HL))
    # defense allowed (team column = the defense in def_* fields)
    for c in ['def_pass_epa', 'def_rush_epa']:
        TG[f'd_{c}'] = g[c].transform(lambda s: ewm_prev(s, 6.0))
    # game context per team-game
    home = G[['game_id', 'date', 'season', 'week', 'home_team', 'away_team', 'spread_line', 'total_line', 'roof', 'temp', 'wind', 'home_rest', 'away_rest', 'home_qb_id', 'away_qb_id', 'div_game']]
    a = home.assign(team=home.home_team, opp=home.away_team, home=1, spread=home.spread_line, rest=home.home_rest, qb=home.home_qb_id)
    b = home.assign(team=home.away_team, opp=home.home_team, home=0, spread=-home.spread_line, rest=home.away_rest, qb=home.away_qb_id)
    CT = pd.concat([a, b])[['game_id', 'date', 'season', 'week', 'team', 'opp', 'home', 'spread', 'total_line', 'roof', 'temp', 'wind', 'rest', 'qb', 'div_game']]
    CT['implied'] = CT.total_line / 2 + CT.spread / 2          # nflverse spread_line > 0 means home favored
    CT['dome'] = CT.roof.isin(['dome', 'closed']).astype(int)
    CT['temp'] = np.where(CT.dome == 1, 70, CT.temp.fillna(60)); CT['wind'] = np.where(CT.dome == 1, 0, CT.wind.fillna(8))
    CT = CT.sort_values(['team', 'date']); CT['qb_change'] = (CT.groupby('team').qb.shift(1) != CT.qb).astype(int)
    CT.loc[CT.groupby('team').cumcount() == 0, 'qb_change'] = 0
    # starter QB history: shrunk Y/A and EPA/dropback from his own earlier games (any team)
    qbp = PG[PG.dropbacks >= 10][['pid', 'game_id', 'pass_yds', 'pass_att', 'pass_epa', 'dropbacks']].merge(G[['game_id', 'date']], on='game_id').sort_values(['pid', 'date'])
    gq = qbp.groupby('pid')
    qbp['cum_yds'] = gq.pass_yds.cumsum() - qbp.pass_yds; qbp['cum_att'] = gq.pass_att.cumsum() - qbp.pass_att
    qbp['cum_epa'] = gq.pass_epa.cumsum() - qbp.pass_epa; qbp['cum_db'] = gq.dropbacks.cumsum() - qbp.dropbacks
    # value for a QB's NEXT game = everything up to and including his last game
    last = qbp.assign(cy=qbp.cum_yds + qbp.pass_yds, ca=qbp.cum_att + qbp.pass_att, ce=qbp.cum_epa + qbp.pass_epa, cd=qbp.cum_db + qbp.dropbacks)[['pid', 'date', 'cy', 'ca', 'ce', 'cd']]
    CT = CT.sort_values('date'); last = last.sort_values('date').rename(columns={'pid': 'qb'})
    CT = pd.merge_asof(CT, last, on='date', by='qb', allow_exact_matches=False)
    k_ypa, k_epa = 396, 400                                     # stabilization points (attempts) for Y/A and EPA/dropback
    CT['qb_ypa_shr'] = (CT.cy.fillna(0) + 6.4 * k_ypa) / (CT.ca.fillna(0) + k_ypa)
    CT['qb_epa_shr'] = (CT.ce.fillna(0) + (-0.05) * k_epa) / (CT.cd.fillna(0) + k_epa)
    CT['qb_new'] = (CT.cd.fillna(0) < 60).astype(int)          # OOD flag input only, never a model feature
    CT = CT.drop(columns=['cy', 'ca', 'ce', 'cd'])
    T = CT.merge(TG[['game_id', 'team'] + [c for c in TG if c.startswith('t_')]], on=['game_id', 'team'], how='left')
    D = TG[['game_id', 'team', 'd_def_pass_epa', 'd_def_rush_epa']].rename(columns={'team': 'opp'})
    T = T.merge(D, on=['game_id', 'opp'], how='left')
    # ---------------- player side
    P = PG.merge(TG[['game_id', 'team', 'targets', 'carries', 'dropbacks', 'rz_plays']].rename(columns={'targets': 'tm_tg', 'carries': 'tm_ca', 'dropbacks': 'tm_db', 'rz_plays': 'tm_rz'}), on=['game_id', 'team'], how='left')
    P = P.merge(G[['game_id', 'date']], on='game_id').sort_values(['pid', 'date'])
    air_tm = P.groupby(['game_id', 'team']).air_yds.transform('sum')
    P['tg_sh'] = P.targets / P.tm_tg.clip(lower=1); P['ca_sh'] = P.carries / P.tm_ca.clip(lower=1); P['air_sh'] = P.air_yds / air_tm.where(air_tm > 0, np.nan)
    P['rz_sh'] = (P.rz_targets + P.rz_carries) / P.tm_rz.clip(lower=1); P['db_sh'] = P.dropbacks / P.tm_db.clip(lower=1)
    gp = P.groupby('pid')
    F = {}
    for c in ['tg_sh', 'ca_sh', 'air_sh', 'rz_sh', 'db_sh', 'offense_pct']:
        P[f'f_{c}'] = gp[c].transform(lambda s: ewm_prev(s, HL))
    P['f_snap_last'] = gp.offense_pct.shift(1)
    for c in ['rec_yds', 'receptions', 'rush_yds', 'pass_yds', 'targets', 'carries']:
        P[f'f_{c}_ewm'] = gp[c].transform(lambda s: ewm_prev(s, HL))
        P[f'f_{c}_form'] = gp[c].transform(lambda s: ewm_prev(s, HL_FAST)) - P[f'f_{c}_ewm']
    # efficiency, shrunk toward position means (empirical Bayes; strength = stabilization point)
    for num, den, nm, k in (('rec_yds', 'targets', 'ypt', 60), ('rush_yds', 'carries', 'ypc', 120), ('receptions', 'targets', 'cr', 40)):
        cn = gp[num].cumsum() - P[num]; cd = gp[den].cumsum() - P[den]
        # position mean from EARLIER seasons only (first season falls back to a fixed league constant)
        sea = P.groupby(['pos', 'season'])[[num, den]].sum().groupby(level=0).cumsum().groupby(level=0).shift(1)
        sea = (sea[num] / sea[den].clip(lower=1)).rename('pm').reset_index()
        pm = P[['pos', 'season']].merge(sea, on=['pos', 'season'], how='left').pm.values
        pm = np.where(np.isnan(pm), {'ypt': 7.9, 'ypc': 4.3, 'cr': 0.66}[nm], pm)
        P[f'f_{nm}_shr'] = (cn + pm * k) / (cd + k)
    P['f_gap'] = (P.date - gp.date.shift(1)).dt.days.fillna(0)          # days since his last game (absence); also feeds OOD
    P['f_age'] = (P.date - pd.to_datetime(P.birth_date, errors='coerce')).dt.days / 365.25
    P['f_exp'] = P.season - P.rookie_year
    P['n_prior'] = gp.cumcount()                                           # OOD ONLY, never a model feature
    P = P.merge(T, on=['game_id', 'team', 'date', 'season', 'week'], how='left', suffixes=('', '_t'))
    # opponent: what this defense allowed to this position, per game, before this game
    DP = (pd.read_parquet(f'{W}/def_pos.parquet') if DP is None else DP).merge(G[['game_id', 'date']], on='game_id').sort_values(['team', 'date'])
    if scramble is not None:
        s, w = scramble; m = (DP.season == s) & (DP.week == w); DP.loc[m, [c for c in DP if '_' in c and c.split('_')[-1] in ('WR', 'TE', 'RB', 'OTH')]] *= 1.7
    for posg in ['WR', 'TE', 'RB']:
        for st in ['targets', 'rec_yds', 'rush_yds', 'carries']:
            DP[f'a_{st}_{posg}'] = DP.groupby('team')[f'{st}_{posg}'].transform(lambda s: ewm_prev(s, 6.0))
    acols = [c for c in DP if c.startswith('a_')]
    P = P.merge(DP[['game_id', 'team'] + acols].rename(columns={'team': 'opp'}), on=['game_id', 'opp'], how='left')
    pg = P.pos.where(P.pos.isin(['WR', 'TE', 'RB']), 'WR')
    for st in ['targets', 'rec_yds', 'rush_yds', 'carries']:
        P[f'f_opp_{st}'] = np.select([pg == x for x in ['WR', 'TE', 'RB']], [P[f'a_{st}_{x}'] for x in ['WR', 'TE', 'RB']])
    P = P.drop(columns=acols)
    # injuries: official report for this week. own status, and volume vacated by teammates listed Out/Doubtful
    I = INJ.copy(); I['out'] = I.report_status.isin(['Out', 'Doubtful']).astype(int); I['q'] = (I.report_status == 'Questionable').astype(int)
    P = P.merge(I[['season', 'week', 'pid', 'q']].drop_duplicates(['season', 'week', 'pid']), on=['season', 'week', 'pid'], how='left'); P['f_questionable'] = P.q.fillna(0); P = P.drop(columns='q')
    # each player's usage state AFTER his latest game (for when he is out next week)
    post = P[['pid', 'date', 'tg_sh', 'ca_sh']].copy(); gpp = post.groupby('pid')
    post['tg_state'] = gpp.tg_sh.transform(lambda s: s.ewm(halflife=HL).mean()); post['ca_state'] = gpp.ca_sh.transform(lambda s: s.ewm(halflife=HL).mean())
    outs = I[I.out == 1][['season', 'week', 'team', 'pid']].merge(G[['season', 'week', 'home_team', 'away_team', 'date']].melt(id_vars=['season', 'week', 'date'], value_name='team')[['season', 'week', 'team', 'date']], on=['season', 'week', 'team'])
    outs = pd.merge_asof(outs.sort_values('date'), post[['pid', 'date', 'tg_state', 'ca_state']].sort_values('date'), on='date', by='pid', allow_exact_matches=False)
    vac = outs.groupby(['season', 'week', 'team'])[['tg_state', 'ca_state']].sum().rename(columns={'tg_state': 'f_vac_tg', 'ca_state': 'f_vac_ca'}).reset_index()
    P = P.merge(vac, on=['season', 'week', 'team'], how='left'); P[['f_vac_tg', 'f_vac_ca']] = P[['f_vac_tg', 'f_vac_ca']].fillna(0)
    return P, T

FEATS = {   # the model's dimensions per market (20+ each; none is a count of games or attempts)
 'common': ['f_offense_pct', 'f_snap_last', 'f_rz_sh', 't_plays', 't_proe', 't_neutral_plays', 't_off_epa', 'implied', 'spread', 'total_line', 'home', 'rest', 'dome', 'temp', 'wind', 'div_game',
            'qb_change', 'qb_ypa_shr', 'qb_epa_shr', 'f_gap', 'f_age', 'f_exp', 'f_questionable', 'f_vac_tg', 'f_vac_ca', 'd_def_pass_epa', 'd_def_rush_epa'],
 'rec_yds': ['f_tg_sh', 'f_air_sh', 'f_ypt_shr', 'f_cr_shr', 'f_rec_yds_ewm', 'f_rec_yds_form', 'f_targets_ewm', 't_dropbacks', 't_targets', 'f_opp_targets', 'f_opp_rec_yds'],
 'receptions': ['f_tg_sh', 'f_air_sh', 'f_cr_shr', 'f_receptions_ewm', 'f_receptions_form', 'f_targets_ewm', 't_dropbacks', 't_targets', 'f_opp_targets'],
 'rush_yds': ['f_ca_sh', 'f_ypc_shr', 'f_rush_yds_ewm', 'f_rush_yds_form', 'f_carries_ewm', 't_carries', 'f_opp_carries', 'f_opp_rush_yds'],
 'pass_yds': ['f_db_sh', 'f_pass_yds_ewm', 'f_pass_yds_form', 't_dropbacks', 't_off_pass_epa'],
}
def feats(market): return FEATS['common'] + FEATS[market]

if __name__ == '__main__':
    PG = pd.read_parquet(f'{W}/player_games.parquet'); TG = pd.read_parquet(f'{W}/team_games.parquet'); G = pd.read_parquet(f'{W}/games.parquet'); INJ = pd.read_parquet(f'{W}/injuries.parquet')
    if '--leakcheck' in sys.argv:
        A, TA = build(PG, TG, G, INJ); B, TB = build(PG, TG, G, INJ, scramble=(2024, 10))
        key = ['game_id', 'pid']; cols = sorted(set(sum(FEATS.values(), [])))
        A = A.set_index(key).sort_index(); B = B.set_index(key).sort_index()
        d0 = pd.to_datetime(G[(G.season == 2024) & (G.week == 10)].gameday).min()
        before = A.date < d0; on = (A.season == 2024) & (A.week == 10); after = A.date > d0 + pd.Timedelta(days=7)
        diff = lambda m: {c: int((~np.isclose(A.loc[m, c].fillna(-9e9), B.loc[m, c].fillna(-9e9))).sum()) for c in cols}
        rep = dict(scrambled='2024 week 10 results', rows_before=int(before.sum()), changed_before=diff(before), rows_same_week=int(on.sum()), changed_same_week=diff(on),
                   rows_after=int(after.sum()), changed_after_any=sum(v > 0 for v in diff(after).values()))
        ok = sum(rep['changed_before'].values()) == 0 and sum(rep['changed_same_week'].values()) == 0
        rep['verdict'] = 'PASS: no feature on or before the scrambled week moved; later weeks did (features do use the past)' if ok and rep['changed_after_any'] > 0 else 'FAIL'
        json.dump(rep, open(f'{W}/leakage_check.json', 'w'), indent=1); print(rep['verdict'], 'later features that moved:', rep['changed_after_any'])
        if not ok: print({k: v for k, v in rep['changed_before'].items() if v}, {k: v for k, v in rep['changed_same_week'].items() if v})
    else:
        P, T = build(PG, TG, G, INJ); P.to_parquet(f'{W}/feat_player.parquet'); T.to_parquet(f'{W}/feat_team.parquet')
        for m in ['rec_yds', 'receptions', 'rush_yds', 'pass_yds']: print(m, len(feats(m)), 'dims')
        print('rows', len(P), 'team rows', len(T))
