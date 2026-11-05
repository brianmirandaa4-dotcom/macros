"""Overlay NFL · stage 6: write tonight's wmtl.slate.v2 file (JAX @ BAL, NFL Week 9 Thursday)."""
import json, os, datetime as dt
from zoneinfo import ZoneInfo
H = os.path.dirname(os.path.abspath(__file__)); F = json.load(open(f'{H}/out/final.json'))
now = dt.datetime.now(ZoneInfo('America/New_York'))
props = F['props']; leans = [p for p in props if p['tier'] == 'lean']
strong = [p for p in props if p['lights']['card']]; projok = [p for p in strong if p['lights']['proj']]; pat = [p for p in projok if p['lights'].get('pattern')]
funnel = [dict(step='Props with a DraftKings line', n=len(props)), dict(step='Strong or weak report card on that side', n=len(strong)),
          dict(step='Projection on that side', n=len(projok)), dict(step='Pattern check agrees', n=len(pat)),
          dict(step='Priced, so the market check can run', n=0, note='ESPN posts DraftKings lines and openers but not their prices'), dict(step='On the card', n=0)]
meta = dict(brand='Overlay', sport='NFL', league='NFL', date='2026-11-05', date_label='Thu Nov 5 · JAX @ BAL', week=9, label='Week 9 · Thursday',
            model_version='v3.0 · ESPN rebuild (questions kept or cut out of sample)', generated_et=now.strftime('%a %b %-d, %-I:%M %p ET'),
            prices_et='DraftKings lines and openers via ESPN, Thu Nov 5 early afternoon ET · prices not posted', prices_utc=None,
            injuries_et='ESPN injury report and depth chart, Thu Nov 5 12:26 PM ET', books=['DraftKings'], opener_book='DraftKings (via ESPN)', sims_per_game=10000, factors_per_prop=25,
            n_games=1, n_props=len(props), calibration=dict(K=1.156, W_Y=0.05, W_TD=0.40, note='calib_nfl.py: widen by K, then anchor to the two-sided no-vig market. No prices tonight, so no anchor and no edge.'),
            rules=['25D score above +1.5 for an over or at most −1.5 for an under.', 'Projection on the bet side of the line.', 'Play chance of at least 50% from the ESPN injury report.',
                   'Calibrated edge of at least 5 points over the break-even of the best price (needs both sides priced).', 'Projection and line within 50% of each other.', 'Pattern check (gradient-boosted trees) does not disagree.'],
            staking='Model sizing: 1 unit flat (1u = 1% of bankroll). 0.5u for QB rushing and prices of +300 or longer.', funnel=funnel, factors=F['factors'], cards=F['cards'],
            windows=['TNF'], histogram_note='Histograms show 10,000 replays per prop after the K widening. Ranges are calibrated so the 80% range covered about 80% of 2026 games the model never saw.',
            method='Questions: the NFL Slate 25 per prop, pooled with research-backed candidates, then kept only if they improved held-out seasons, kept their sign, and were not near-duplicates. Data: ESPN box scores 2021–2026 organized as player × game × stat and defense × game × stat tensors; defenses denoised by low-rank projection; player roles by non-negative CP decomposition.')
game = dict(id='401873037', sport='NFL', kick_utc='2026-11-06T01:15:00.000Z', kick_et='8:15 PM', slate='TNF', window='TNF',
            away=dict(abbr='JAX', name='Jacksonville Jaguars', model_name='JAX'), home=dict(abbr='BAL', name='Baltimore Ravens', model_name='BAL'),
            market=dict(spread_home=10.0, total=39.5, home_win_novig=None, open_spread_home=None, open_total=None, book='DraftKings', moneyline=dict(away=-520, home=390), spread_odds=dict(away=-105, home=-115), total_odds=dict(over=-110, under=-110)),
            lines={}, counts={'recommended': 0, 'watch': 0, 'lean': len(leans), 'check_news': 0, 'pass': len(props) - len(leans)})
slate = dict(schema='wmtl.slate.v2', id='nfl-2026-wk09-thu', sport='NFL', meta=meta, games=[game], props=props, parlays=dict(status='none', items=[], note='No parlays: no leg has a priced, market-checked edge.'),
             results=dict(status='pending', props={}, games={}))
json.dump(slate, open(f'{H}/out/nfl-2026-wk09-thu.json', 'w'), separators=(',', ':'))
print('props', len(props), 'leans', len(leans), 'funnel', [(f['step'], f['n']) for f in funnel])
