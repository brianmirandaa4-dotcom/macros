"""Stage 1 · deterministic data build (nflverse only; documented in SOURCES.md).
Inputs : raw/pbp_YYYY.parquet, snaps_YYYY.parquet, inj_YYYY.parquet, roster_YYYY.parquet, games.csv (nflverse/nfldata)
Outputs: work/player_games.parquet  one row per player-game (regular season 2018–2026) with actual stats
         work/team_games.parquet    one row per team-game with volume, pace, PROE, EPA for and against
         work/def_pos.parquet       what each defense allowed to WR / TE / RB per game (targets, yards)
         work/games.parquet         schedule + closing lines (spread, total, moneyline, prices), roof, weather, rest, QBs
Nothing here looks at future games; this is just the record of what happened."""
import pandas as pd, numpy as np, os, hashlib, json
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); RAW = f'{H}/raw'; W = f'{H}/work'; os.makedirs(W, exist_ok=True)
YEARS = range(2018, 2027)
COLS = ['game_id', 'season', 'week', 'season_type', 'posteam', 'defteam', 'home_team', 'away_team', 'play_type', 'yards_gained', 'yardline_100', 'down',
        'qb_dropback', 'qb_scramble', 'sack', 'pass_attempt', 'rush_attempt', 'complete_pass', 'air_yards', 'epa', 'xpass', 'pass_oe', 'wp',
        'passer_player_id', 'receiver_player_id', 'rusher_player_id', 'two_point_attempt', 'touchdown', 'pass_touchdown', 'rush_touchdown', 'td_player_id',
        'game_seconds_remaining', 'qtr', 'score_differential', 'posteam_score', 'defteam_score', 'play_id']
pbp = pd.concat([pd.read_parquet(f'{RAW}/pbp_{y}.parquet', columns=COLS) for y in YEARS], ignore_index=True)
pbp = pbp[(pbp.season_type == 'REG') & pbp.posteam.notna() & (pbp.two_point_attempt != 1)]
pbp['is_pass'] = (pbp.pass_attempt == 1) | (pbp.sack == 1)
pbp['is_rush'] = (pbp.rush_attempt == 1) & (pbp.qb_scramble != 1)
pbp['play'] = pbp.is_pass | pbp.is_rush | (pbp.qb_scramble == 1)
pbp['rz'] = pbp.yardline_100 <= 20
pbp['neutral'] = pbp.wp.between(.2, .8) & (pbp.qtr <= 3)
# ---------------- player-game
rec = pbp[pbp.receiver_player_id.notna() & (pbp.pass_attempt == 1) & (pbp.sack != 1)].groupby(['game_id', 'posteam', 'receiver_player_id']).agg(
    targets=('play_id', 'size'), receptions=('complete_pass', 'sum'), rec_yds=('yards_gained', lambda s: s[pbp.loc[s.index, 'complete_pass'] == 1].sum()),
    air_yds=('air_yards', 'sum'), rz_targets=('rz', 'sum'), rec_td=('pass_touchdown', 'sum')).reset_index().rename(columns={'receiver_player_id': 'pid', 'posteam': 'team'})
ru = pbp[pbp.rusher_player_id.notna() & (pbp.rush_attempt == 1)].groupby(['game_id', 'posteam', 'rusher_player_id']).agg(
    carries=('play_id', 'size'), rush_yds=('yards_gained', 'sum'), rz_carries=('rz', 'sum'), gl_carries=('yardline_100', lambda s: (s <= 5).sum()), rush_td=('rush_touchdown', 'sum')).reset_index().rename(columns={'rusher_player_id': 'pid', 'posteam': 'team'})
pa = pbp[pbp.passer_player_id.notna() & (pbp.qb_dropback == 1)].groupby(['game_id', 'posteam', 'passer_player_id']).agg(
    dropbacks=('play_id', 'size'), pass_att=('pass_attempt', lambda s: ((s == 1) & (pbp.loc[s.index, 'sack'] != 1)).sum()), completions=('complete_pass', 'sum'),
    pass_yds=('yards_gained', lambda s: s[(pbp.loc[s.index, 'complete_pass'] == 1)].sum()), sacks=('sack', 'sum'), pass_epa=('epa', 'sum'), pass_td=('pass_touchdown', 'sum')).reset_index().rename(columns={'passer_player_id': 'pid', 'posteam': 'team'})
PG = rec.merge(ru, on=['game_id', 'team', 'pid'], how='outer').merge(pa, on=['game_id', 'team', 'pid'], how='outer').fillna(0)
# ---------------- team-game
TG = pbp.groupby(['game_id', 'posteam']).agg(plays=('play', 'sum'), dropbacks=('is_pass', 'sum'), pass_att=('pass_attempt', 'sum'), carries=('is_rush', 'sum'),
    targets=('receiver_player_id', lambda s: s.notna().sum()), off_epa=('epa', 'mean'), proe=('pass_oe', 'mean'), rz_plays=('rz', 'sum')).reset_index().rename(columns={'posteam': 'team'})
pe = pbp[pbp.is_pass].groupby(['game_id', 'posteam']).epa.mean().rename('off_pass_epa'); re_ = pbp[pbp.is_rush].groupby(['game_id', 'posteam']).epa.mean().rename('off_rush_epa')
de = pbp[pbp.is_pass].groupby(['game_id', 'defteam']).epa.mean().rename('def_pass_epa'); dr = pbp[pbp.is_rush].groupby(['game_id', 'defteam']).epa.mean().rename('def_rush_epa')
nt = pbp[pbp.neutral & pbp.play].groupby(['game_id', 'posteam']).size().rename('neutral_plays')
TG = TG.set_index(['game_id', 'team']).join(pe.rename_axis(['game_id', 'team'])).join(re_.rename_axis(['game_id', 'team'])).join(nt.rename_axis(['game_id', 'team'])).reset_index()
D = pd.concat([de, dr], axis=1).rename_axis(['game_id', 'team']).reset_index()     # team = the defense
TG = TG.merge(D, on=['game_id', 'team'], how='left')
# pass yards / rush yards by team for the invariant check later
ty = pbp.groupby(['game_id', 'posteam']).apply(lambda d: pd.Series({'team_pass_yds': d.loc[d.complete_pass == 1, 'yards_gained'].sum(), 'team_rush_yds': d.loc[d.rush_attempt == 1, 'yards_gained'].sum()})).reset_index().rename(columns={'posteam': 'team'})
TG = TG.merge(ty, on=['game_id', 'team'], how='left')
# ---------------- rosters: position, espn id, debut
R = pd.concat([pd.read_parquet(f'{RAW}/roster_{y}.parquet') for y in YEARS], ignore_index=True)
R = R[R.game_type == 'REG'] if 'game_type' in R else R
pos = R.sort_values(['season', 'week']).groupby('gsis_id').agg(pos=('position', 'last'), name=('full_name', 'last'), espn_id=('espn_id', 'last'), pfr_id=('pfr_id', 'last'),
                                                              rookie_year=('rookie_year', 'last'), birth_date=('birth_date', 'last')).reset_index().rename(columns={'gsis_id': 'pid'})
PG = PG.merge(pos, on='pid', how='left')
# defense allowed by position
dp = PG.merge(pbp[['game_id', 'home_team', 'away_team']].drop_duplicates('game_id'), on='game_id')
dp['opp'] = np.where(dp.team == dp.home_team, dp.away_team, dp.home_team); dp['pg'] = dp.pos.where(dp.pos.isin(['WR', 'TE', 'RB']), 'OTH')
DP = dp.pivot_table(index=['game_id', 'opp'], columns='pg', values=['targets', 'rec_yds', 'receptions', 'carries', 'rush_yds'], aggfunc='sum').fillna(0)
DP.columns = [f'{a}_{b}' for a, b in DP.columns]; DP = DP.reset_index().rename(columns={'opp': 'team'})
# ---------------- snaps (offense share) via pfr id
S = pd.concat([pd.read_parquet(f'{RAW}/snaps_{y}.parquet') for y in YEARS], ignore_index=True)
S = S[S.game_type == 'REG'][['game_id', 'pfr_player_id', 'offense_pct', 'offense_snaps', 'team']].rename(columns={'pfr_player_id': 'pfr_id'})
PG = PG.merge(S[['game_id', 'pfr_id', 'offense_pct']].drop_duplicates(['game_id', 'pfr_id']), on=['game_id', 'pfr_id'], how='left')
# ---------------- games (closing lines etc.)
G = pd.read_csv(f'{RAW}/games.csv'); G = G[(G.season >= 2018) & (G.game_type == 'REG')]
G.to_parquet(f'{W}/games.parquet')
gk = G[['game_id', 'season', 'week', 'gameday', 'gametime', 'home_team', 'away_team']]
for df, nm in ((PG, 'player_games'), (TG, 'team_games'), (DP, 'def_pos')):
    df = df.merge(gk, on='game_id', how='left'); df.to_parquet(f'{W}/{nm}.parquet')
# ---------------- injuries (official report) and weekly rosters (active / status)
I = pd.concat([pd.read_parquet(f'{RAW}/inj_{y}.parquet') for y in YEARS], ignore_index=True)
I = I[I.game_type == 'REG'][['season', 'week', 'team', 'gsis_id', 'position', 'full_name', 'report_status', 'practice_status']].rename(columns={'gsis_id': 'pid'})
I.to_parquet(f'{W}/injuries.parquet')
R[['season', 'week', 'team', 'gsis_id', 'position', 'status', 'depth_chart_position']].rename(columns={'gsis_id': 'pid'}).to_parquet(f'{W}/rosters.parquet')
# checksums of every input
man = {f: hashlib.sha256(open(f'{RAW}/{f}', 'rb').read()).hexdigest()[:16] for f in sorted(os.listdir(RAW)) if os.path.isfile(f'{RAW}/{f}')}   # [auto] skip sub-folders (raw/an)
json.dump(man, open(f'{W}/input_checksums.json', 'w'), indent=1)
print('player-games', len(PG), 'team-games', len(TG), 'def-pos', len(DP), 'games', len(G), 'snap match', round(PG.offense_pct.notna().mean(), 3))
