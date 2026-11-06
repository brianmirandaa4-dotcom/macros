"""Stage 6 · write work/slate_<season>_<week>.json as a wmtl.slate.v2 file for Overlay. Copies model numbers; computes none.
Run: python3 src/export_overlay.py 2026 9 <out.json> [--skip-thu]"""
import json, sys, os, re, unicodedata, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np
H = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); W = f'{H}/work'
SEASON, WEEK, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]; SKIP_THU = '--skip-thu' in sys.argv
S = json.load(open(f'{W}/slate_{SEASON}_{WEEK:02d}.json')); CAL = json.load(open(f'{W}/calibrated_2026.json')); LK = json.load(open(f'{W}/leakage_check.json'))
GS = json.load(open(f'{W}/backtest_games_summary.json')); BP = json.load(open(f'{W}/backtest_priced.json'))
NY = ZoneInfo('America/New_York'); now = dt.datetime.now(NY)
LABEL = {'rec_yds': 'Receiving yards', 'receptions': 'Receptions', 'rush_yds': 'Rushing yards', 'pass_yds': 'Passing yards'}
PLAIN = {'f_tg_sh': 'Target share (recent, weighted)', 'f_ca_sh': 'Carry share (recent, weighted)', 'f_air_sh': 'Air-yard share', 'f_rz_sh': 'Red-zone share', 'f_db_sh': 'Dropback share',
 'f_offense_pct': 'Snap share (recent)', 'f_snap_last': 'Snap share last game', 'f_ypt_shr': 'Yards per target (shrunk)', 'f_ypc_shr': 'Yards per carry (shrunk)', 'f_cr_shr': 'Catch rate (shrunk)',
 't_plays': 'Team plays per game', 't_proe': 'Team pass rate over expected', 't_neutral_plays': 'Team neutral-script plays', 't_off_epa': 'Team offense EPA/play', 't_off_pass_epa': 'Team pass EPA/play',
 't_dropbacks': 'Team dropbacks per game', 't_targets': 'Team targets per game', 't_carries': 'Team carries per game', 'implied': 'Implied team total (close)', 'spread': 'Spread (team view)',
 'total_line': 'Game total (close)', 'home': 'Home', 'rest': 'Rest days', 'dome': 'Dome', 'temp': 'Temperature', 'wind': 'Wind', 'div_game': 'Division game', 'qb_change': 'New starting QB',
 'qb_ypa_shr': 'Starting QB yards/attempt (shrunk)', 'qb_epa_shr': 'Starting QB EPA/dropback (shrunk)', 'f_gap': 'Days since last game', 'f_age': 'Age', 'f_exp': 'NFL seasons', 'f_questionable': 'Listed questionable',
 'f_vac_tg': 'Targets vacated by injured teammates', 'f_vac_ca': 'Carries vacated by injured teammates', 'd_def_pass_epa': 'Opponent pass defense EPA', 'd_def_rush_epa': 'Opponent rush defense EPA',
 'f_opp_targets': 'Targets opponent allows to his position', 'f_opp_rec_yds': 'Receiving yards opponent allows to his position', 'f_opp_carries': 'Carries opponent allows', 'f_opp_rush_yds': 'Rushing yards opponent allows',
 'f_rec_yds_ewm': 'His receiving yards (weighted avg)', 'f_rec_yds_form': 'Receiving yards: recent form', 'f_receptions_ewm': 'His receptions (weighted avg)', 'f_receptions_form': 'Receptions: recent form',
 'f_targets_ewm': 'His targets (weighted avg)', 'f_rush_yds_ewm': 'His rushing yards (weighted avg)', 'f_rush_yds_form': 'Rushing yards: recent form', 'f_carries_ewm': 'His carries (weighted avg)',
 'f_pass_yds_ewm': 'His passing yards (weighted avg)', 'f_pass_yds_form': 'Passing yards: recent form'}
def norm(s): return re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()).strip()
def kick(g):
    t = dt.datetime.strptime(g['kick'], '%Y-%m-%d %H:%M').replace(tzinfo=NY); return t, t.astimezone(dt.timezone.utc)
def win(t): wd = t.strftime('%a'); return {'Thu': 'TNF', 'Mon': 'MNF'}.get(wd) or ('SNF' if t.hour >= 19 else '1 PM' if t.hour < 15 else '4 PM')
games, props = [], []
for gid, g in S['games'].items():
    t, tu = kick(g)
    if SKIP_THU and t.strftime('%a') == 'Thu': continue
    games.append(dict(id=gid, sport='NFL', kick_utc=tu.strftime('%Y-%m-%dT%H:%M:%S.000Z'), kick_et=t.strftime('%-I:%M %p'), slate=win(t), window=win(t),
        away=dict(abbr=g['away'], name=g['away'], model_name=g['away']), home=dict(abbr=g['home'], name=g['home'], model_name=g['home']),
        market=dict(spread_home=g['spread_home'], total=g['total'], home_win_novig=None, open_spread_home=None, open_total=None, book='closing line (nflverse)', moneyline=dict(away=g['ml_away'], home=g['ml_home'])),
        sim=g['sim'], qbs=dict(home=g['home_qb'], away=g['away_qb']), lines={}, counts={}))
GW = {g['id']: g for g in games}
for p in S['props']:
    if p['game_id'] not in GW or (p['line'] is None and not p.get('best')): continue
    st = 'no prediction' if p['no_prediction'] else None
    top = p['hist_top']; step = top / 24
    flags = list(p['ood']) + (['team passing check failed: receivers and QB projections more than 10% apart'] if p.get('team_check_failed') else []) + (['rejected by an invariant check'] if p['rejected'] else [])
    bst = p.get('best') if not st else None; offs = p.get('offers') or []
    if bst:   # stale-price guard: drop books whose no-vig over price sits > 8 points from the median of the other books, then re-pick the best edge
        live_ = [o for o in offs if o['book'] != 'Open']; med = float(np.median([o['novig_over'] for o in live_])) if live_ else None
        keep = [o for o in live_ if med is None or abs(o['novig_over'] - med) <= .08]
        if keep:
            cand = [(o['edge_over'], 'over', o) for o in keep] + [(o['edge_under'], 'under', o) for o in keep]
            e_, sd_, o_ = max(cand, key=lambda x: x[0]); pr = o_[sd_]; ps_ = o_['p_over'] if sd_ == 'over' else 1 - o_['p_over']
            bst = dict(book=o_['book'], side=sd_, line=o_['line'], odds=pr, p=round(ps_, 4), break_even=round(-pr / (-pr + 100) if pr < 0 else 100 / (pr + 100), 4), edge=round(e_, 4),
                       novig=round(o_['novig_over'] if sd_ == 'over' else 1 - o_['novig_over'], 4))
            if p['tier'] == 'bet' and (e_ < .03 or (p.get('interval') and p['interval'][0] <= bst['break_even'])): p['tier'] = 'lean'
        else: bst = None
    if bst:
        side_, line_, odds_, book_ = bst['side'], bst['line'], bst['odds'], bst['book']
        units_ = round(min(3.0, max(0.0, (p['kelly'] or {}).get('stake', 0) * 100)), 2) if p.get('kelly') else None
    props.append(dict(id=f"{p['game_id']}-{p['pid']}-{p['market']}", gid=p['game_id'], player=p['name'], team=p['team'], opp=p['opp'], market=p['market'], market_label=LABEL[p['market']],
        side=None if st else p['side'], line=p['line'], odds=None, book='DraftKings', best=dict(book='DraftKings', line=p['line'], over=None, under=None), offers=[dict(book='DraftKings', line=p['line'], over=None, under=None)],
        opener=dict(line=p['line_open']) if p.get('line_open') is not None else None, classification=p['tier'], tier=p['tier'], model_status=st.upper() if st else ('INFO · NO PRICE' if p['tier'] == 'lean' else 'PASS'),
        projection=None if st else round(p['median'], 1), range80=None if st else [round(p['p10'], 1), round(p['p90'], 1)],
        p=None, p_raw=None if st or p['p_side'] is None else round(p['p_side'], 3), p_uncal=None if st or p['pov_raw'] is None else round(p['pov_raw'] if p['side'] == 'over' else 1 - p['pov_raw'], 3), break_even=None, edge_pts=None, ev_per_unit=None, units=None,
        score25=None, pctile=None, families={}, model=('Hierarchical: Negative Binomial volume × shrunk efficiency' if p['model'] == 'B' else 'LightGBM quantile regression'),
        helping=[dict(id=k, name=PLAIN.get(k, k), how='', plain=PLAIN.get(k, k).lower(), v=v) for k, v in p['up']], hurting=[dict(id=k, name=PLAIN.get(k, k), how='', plain=PLAIN.get(k, k).lower(), v=v) for k, v in p['down']],
        availability=dict(p_play=None, report='Questionable' if p['questionable'] else None), live=None, ood=flags, no_prediction=bool(st),
        hist=None if st else dict(lo=0.0, step=round(step, 3), counts=p['hist'], n=10000, clipped_at=round(top, 2)), check_news=False,
        lights=dict(card=None, proj=None if st or p['line'] is None else ((p['median'] > p['line']) if p['side'] == 'over' else (p['median'] < p['line'])), edge=None, play=True, gap=None, pattern=None),
        q25=[], q25_key=p['market'], pkey='nfl:' + norm(p['name']), window=GW[p['game_id']]['window'], share_scale=p['share_scale']))
    if bst:
        q = props[-1]; op = next((o for o in offs if o['book'] == 'Open'), None)
        q.update(side=side_, line=line_, odds=odds_, book=book_, p=bst['p'], p_raw=bst['p'], break_even=bst['break_even'], edge_pts=round(bst['edge'] * 100, 1), novig=bst['novig'],
                 ev_per_unit=round(bst['p'] * (1 + (100 / -odds_ if odds_ < 0 else odds_ / 100)) - 1, 3), units=units_ if q['tier'] == 'bet' else None, interval=p.get('interval'), kelly=p.get('kelly'),
                 best=dict(book=book_, line=line_, over=next((o['over'] for o in offs if o['book'] == book_), None), under=next((o['under'] for o in offs if o['book'] == book_), None)),
                 offers=[dict(book=o['book'], line=o['line'], over=o['over'], under=o['under']) for o in offs if o['book'] != 'Open'],
                 opener=dict(line=op['line'], over=op['over'], under=op['under']) if op else q['opener'], ceiling=p.get('ceiling'),
                 model_status='BET' if q['tier'] == 'bet' else ('LEAN' if q['tier'] == 'lean' else 'PASS'),
                 lights=dict(q['lights'], edge=bool(bst['edge'] >= .03)))
# portfolio guard: only the 15 largest edges are Bets; 1u cap per bet; 15u cap per slate (scaled proportionally)
bets_ = sorted([p for p in props if p['tier'] == 'bet'], key=lambda p: -(p['edge_pts'] or 0))
for p in bets_[15:]: p.update(tier='lean', classification='lean', model_status='LEAN', units=None)
bets_ = bets_[:15]
for p in bets_: p['units'] = min(1.0, p['units'] or 0)
tot = sum(p['units'] for p in bets_)
if tot > 15: 
    for p in bets_: p['units'] = round(p['units'] * 15 / tot, 2)
leans = [p for p in props if p['tier'] == 'lean']
cal = {mk: dict(model=S['chosen'][mk], logloss=CAL[mk][S['chosen'][mk]]['logloss'], market_5050=CAL[mk]['market_5050']['logloss'], picks55=CAL[mk][S['chosen'][mk]]['picks55'], hit55=CAL[mk][S['chosen'][mk]]['hit55'], n=CAL[mk]['n'], k=S['K'][mk]) for mk in S['chosen']}
funnel = [dict(step='Props with a DraftKings line', n=len(props)), dict(step='Model can predict (not out-of-distribution, passes invariants)', n=sum(not p['no_prediction'] for p in props)),
          dict(step='Market where the model beat the line out of sample (receptions, receiving yards)', n=sum(not p['no_prediction'] and p['market'] in S['validated'] for p in props)),
          dict(step='Priced at a sportsbook (Action Network: DraftKings, FanDuel, BetMGM, BetRivers, Caesars)', n=sum(isinstance(p['odds'], (int, float)) for p in props)), dict(step='Edge of 3+ points over break-even at the best price', n=sum((p.get('edge_pts') or -99) >= 3 for p in props)), dict(step='Interval (bootstrap by game) clears break-even, validated market, no flags = Bet', n=sum(p['tier'] == 'bet' for p in props))]
meta = dict(brand='Overlay', sport='NFL', league='NFL', date=min(g['kick_utc'] for g in games)[:10], date_label='Sun Nov 8 – Mon Nov 9', week=WEEK, label=f'Week {WEEK} · Sun–Mon', model_version='v4.1 · trained model + Action Network prices',
    generated_et=now.strftime('%a %b %-d, %-I:%M %p ET'), prices_et=(lambda f: 'Action Network · ' + (dt.datetime.strptime(re.search(r'(\d{4}-\d{2}-\d{2}T\d{4})Z', f).group(1), '%Y-%m-%dT%H%M').replace(tzinfo=dt.timezone.utc).astimezone(NY).strftime('%a %b %-d, %-I:%M %p ET') if f and re.search(r'\d{4}-\d{2}-\d{2}T\d{4}Z', f) else 'time not recorded'))(S.get('prices_file')), prices_utc=None,
    injuries_et='Official NFL injury report via nflverse (Sunday teams report Friday; this run is preliminary)', books=['DraftKings', 'FanDuel', 'BetMGM', 'BetRivers', 'Caesars'], opener_book='Action Network opener', sims_per_game=10000, factors_per_prop=f"{len(set(sum(([k] for k in PLAIN), [])))} defined, 32–38 per market",
    n_games=len(games), n_props=len(props), calibration=dict(by_market=cal, note='Temperature on the log-odds, fit walk-forward on earlier 2026 weeks only.'),
    backtest=dict(props_2026=cal, props_priced_2026=BP, hubacek_wk9=S.get('hubacek'), game_lines_2022_2026={k: dict(n=GS[k]['n'], model=GS[k]['model'], market_close=GS[k]['market_close'], roi_at_close_edge3=GS[k]['bets_edge3']) for k in ('moneyline', 'spread', 'total')},
                  leakage=LK['verdict'], game_line_verdict='Trained game model lost to the closing line every season 2022–2026, so game numbers shown are the market, with outcome spread learned from data.'),
    rules=['Market must be one where the calibrated model beat the DraftKings line out of sample (receptions, receiving yards).', 'Calibrated chance of 55% or more on the side.',
           'No out-of-distribution flag (backup QB with almost no NFL snaps, return from absence, under 3 prior games, new starting QB, features outside the training range).',
           'Team invariants pass (target shares ≤ 100%; receivers and QB within 10%).', 'Bet: edge of 3+ points over the break-even of the best price, and the 10th percentile of the bootstrap interval (refit on games resampled with replacement) also above break-even.', 'No bet above a 75% chance (Lopez, Matthews & Baumer ceiling check).', 'A book is ignored when its no-vig price is more than 8 points from the other books (stale price).', 'At most 15 bets per slate, 1u each at most, 15u total.', 'Rushing and passing yards never become bets: the model lost to the no-vig market there in the 2026 priced backtest.'],
    staking='Units are reduced Kelly (Kelly 1956) shrunk by the bootstrap uncertainty (Baker & McHale 2013), 1u = 1% of bankroll, capped at 1u per bet and 15u per slate.', funnel=funnel, factors={}, cards={}, windows=sorted({g['window'] for g in games}, key=['1 PM', '4 PM', 'SNF', 'MNF'].index),
    histogram_note='10,000 simulations per prop, linked to the game script by a correlation learned from 2026 data.',
    method='Two trained models per market (LightGBM quantile regression; hierarchical Negative Binomial volume × Efron–Morris shrunk efficiency), chosen by calibrated log loss at the market line in a 2026 week-by-week walk-forward. Features use only earlier games plus pregame structured inputs; a leakage test that scrambles one week of results passes.')
slate = dict(schema='wmtl.slate.v2', id=f'nfl-{SEASON}-wk{WEEK:02d}-sun', sport='NFL', meta=meta, games=games, props=props,
             parlays=dict(status='info', items=[dict(legs=x['legs'], p_joint=x['p_joint_raw'], p_independent=x['p_if_independent_raw'], gid=x['game_id']) for x in S['parlays'] if x['game_id'] in GW][:8],
                          note='Joint chances from the correlated simulation, before calibration. Information only, no prices.'), results=dict(status='pending', props={}, games={}))
json.dump(slate, open(OUT, 'w'), separators=(',', ':'), default=lambda o: o.item() if hasattr(o, 'item') else None)
print('games', len(games), 'props', len(props), 'leans', len(leans), 'no-pred', sum(p['no_prediction'] for p in props))
