"""Guardrail tests: publish checks, freezing / merging, change detection, parsers and schema checks fail safe.
    python3 -m unittest discover -s model/auto/tests -v
Uses the real published week-9 slate and the model run behind it when they are on disk (skipped otherwise)."""
import os, sys, json, copy, glob, tempfile, unittest, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import checks as C, publish as PB, common as CM
from common import parse_ts

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '..', '..', '..', 'wmtl', 'data', 'nfl', '2026-wk09-sun.json')
RUN = os.environ.get('TAIL_TEST_MODEL_RUN', '/home/claude/nfl/work/slate_2026_09.json')
AN_RAW = os.environ.get('TAIL_TEST_AN_RAW', '/home/claude/nfl/raw/an')
AN_PARQ = os.environ.get('TAIL_TEST_AN_PARQUET', '/home/claude/nfl/work/an_props_2026.parquet')


def have(*p): return all(os.path.exists(x) for x in p)


@unittest.skipUnless(have(PUB, RUN), 'published slate / model run not on disk')
class PublishChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pub = json.load(open(PUB)); cls.mrun = json.load(open(RUN))

    def test_published_slate_passes(self):
        self.assertEqual(C.check(self.pub, self.mrun), [])

    def mutate(self, f):
        s = copy.deepcopy(self.pub); f(s); return C.check(s, self.mrun)

    def test_bet_in_unvalidated_market_fails(self):
        def f(s):
            p = next(p for p in s['props'] if p['market'] == 'rush_yds' and not p['no_prediction']); p['tier'] = 'bet'
        self.assertTrue(any(x.startswith('I6') for x in self.mutate(f)))

    def test_negative_projection_fails(self):
        def f(s): next(p for p in s['props'] if not p['no_prediction'])['projection'] = -1.0
        self.assertTrue(any(x.startswith('I4') for x in self.mutate(f)))

    def test_number_not_from_model_fails(self):
        def f(s): next(p for p in s['props'] if p.get('projection') is not None)['projection'] += 0.3
        self.assertTrue(any(x.startswith('I8') for x in self.mutate(f)))

    def test_no_prediction_with_numbers_fails(self):
        def f(s):
            p = next(p for p in s['props'] if p['no_prediction']); p['projection'] = 40.0
        self.assertTrue(any(x.startswith('I5') for x in self.mutate(f)))

    def test_too_many_bets_fails(self):
        def f(s):
            n = 0
            for p in s['props']:
                if p['tier'] != 'bet' and p['market'] in ('receptions', 'rec_yds') and not p['ood'] and not p['no_prediction'] and p.get('interval') and n < 20:
                    p.update(tier='bet', units=1.0, edge_pts=5.0, p=.6, break_even=p['interval'][0] - .01); n += 1
        self.assertTrue(any('per slate' in x or 'more than 15u' in x for x in self.mutate(f)))

    def test_stale_best_book_fails(self):
        def f(s):
            p = next(p for p in s['props'] if isinstance(p.get('odds'), (int, float)) and len([o for o in p['offers'] if o.get('over') and o.get('under')]) >= 3)
            o = next(o for o in p['offers'] if o['book'] == p['book']); o['over'], o['under'] = (500, -900) if p['side'] == 'over' else (-900, 500)
        self.assertTrue(any(x.startswith('I7') for x in self.mutate(f)))

    def test_frozen_props_must_not_change(self):
        g = self.pub['games'][0]['id']
        def f(s): next(p for p in s['props'] if p['gid'] == g)['line'] = 999
        s = copy.deepcopy(self.pub); f(s)
        self.assertTrue(any(x.startswith('I9') for x in C.check(s, self.mrun, self.pub, {g})))

    def test_merge_keeps_started_games(self):
        now = parse_ts(self.pub['games'][0]['kick_utc']) + dt.timedelta(minutes=5)
        fz = PB.frozen(self.pub, now); self.assertTrue(fz)
        new = copy.deepcopy(self.pub); new['games'] = [g for g in new['games'] if g['id'] not in fz]; new['props'] = [p for p in new['props'] if p['gid'] not in fz]
        for p in new['props']:
            if p.get('side') == 'over' and p['tier'] == 'pass': p['side'] = 'under'; break
        m = PB.merge(new, self.pub, fz, 'sun')
        self.assertEqual(len(m['games']), len(self.pub['games'])); self.assertEqual(len(m['props']), len(self.pub['props']))
        self.assertEqual(m['meta']['date_label'], 'Sun Nov 8 – Mon Nov 9'); self.assertEqual(m['meta']['label'], 'Week 9 · Sun–Mon')
        self.assertEqual([x for x in C.check(m, None, self.pub, fz) if x.startswith('I9')], [])
        d = PB.diff_outputs(self.pub, m); self.assertEqual((d['added'], d['removed'], d['flipped']), (0, 0, 1))
        self.assertEqual(m['meta']['funnel'][0]['n'], len(m['props']))

    def test_cappers_rematched_to_current_props(self):
        if not self.pub.get('cappers'): self.skipTest('no cappers block')
        s = copy.deepcopy(self.pub)
        hit = next((k for k in s['cappers']['picks'] if k.get('model')), None)
        if not hit: self.skipTest('no matched capper pick')
        p = next(p for p in s['props'] if p['id'] == hit['model']['prop']); p['side'] = 'under' if p['side'] == 'over' else 'over'
        b = PB.rematch_cappers(s['cappers'], s); k2 = next(k for k in b['picks'] if k['play'] == hit['play'])
        self.assertEqual(k2['model']['model_side'], p['side'])


class Publishing(unittest.TestCase):
    def test_semantic_change_ignores_timestamps(self):
        with tempfile.TemporaryDirectory() as d:
            a = dict(meta=dict(generated_et='Thu 8:09 PM', prices_et='x', n=1), props=[1, 2]); b = copy.deepcopy(a); b['meta']['generated_et'] = 'Fri 1:00 AM'; b['meta']['prices_et'] = 'y'
            json.dump(a, open(f'{d}/a.json', 'w')); json.dump(b, open(f'{d}/b.json', 'w')); self.assertFalse(PB.semantic_changed(f'{d}/a.json', f'{d}/b.json'))
            b['props'][0] = 3; json.dump(b, open(f'{d}/b.json', 'w')); self.assertTrue(PB.semantic_changed(f'{d}/a.json', f'{d}/b.json'))

    def test_plan_and_apply_only_changed(self):
        with tempfile.TemporaryDirectory() as d:
            for root in ('stage', 'data'): os.makedirs(f'{d}/{root}/nfl/state'); os.makedirs(f'{d}/{root}/nflp/p')
            json.dump(dict(x=1, built_utc='a'), open(f'{d}/stage/index.json', 'w')); json.dump(dict(x=1, built_utc='b'), open(f'{d}/data/index.json', 'w'))
            json.dump(dict(y=2), open(f'{d}/stage/nfl/new.json', 'w')); json.dump({}, open(f'{d}/data/nflp/p/gone.json', 'w'))
            ch, de = PB.plan(f'{d}/stage', f'{d}/data'); self.assertEqual((ch, de), (['nfl/new.json'], ['nflp/p/gone.json']))
            PB.apply(f'{d}/stage', f'{d}/data', ch, de); self.assertTrue(os.path.exists(f'{d}/data/nfl/new.json')); self.assertFalse(os.path.exists(f'{d}/data/nflp/p/gone.json'))

    def test_sw_bump_only_version(self):
        with tempfile.TemporaryDirectory() as d:
            src = "const VERSION = 'wmtl-v37-2026-11-05';\nconst DATA = 'wmtl-data';\n"
            open(f'{d}/sw.js', 'w').write(src); self.assertEqual(PB.bump_sw(d), 38)
            self.assertEqual(open(f'{d}/sw.js').read(), src.replace('wmtl-v37-', 'wmtl-v38-'))

    def test_input_diff(self):
        old = dict(injuries={'00-1': ['Questionable', 'A B'], '00-2': ['Out', 'C D']}, lines={'A B|KC|rec_yds|68': [50.5, -110, -110], 'A B|KC|receptions|68': [4.5, -110, -110]},
                   games={'NYJ@KC': dict(spread_home=-10, total=47.5, spread_home_tix=40)}, weather={'g1': dict(temp_f=50, wind_mph=8, short='Sunny')})
        new = dict(injuries={'00-1': ['Out', 'A B']}, lines={'A B|KC|rec_yds|68': [52.5, -110, -110], 'A B|KC|receptions|68': [4.5, -140, 110]},
                   games={'NYJ@KC': dict(spread_home=-11, total=47.5, spread_home_tix=55)}, weather={'g1': dict(temp_f=44, wind_mph=8, short='Rain')})
        d = PB.diff_inputs(old, new)
        self.assertEqual([x['pid'] for x in d['ruled_out']], ['00-1']); self.assertEqual([x['pid'] for x in d['cleared']], ['00-2'])
        self.assertEqual(len(d['line_moves']), 1); self.assertEqual(d['price_moves'], 1)
        self.assertEqual(len(d['game_line_moves']), 1); self.assertEqual(len(d['public_pct']), 1); self.assertEqual(len(d['weather']), 1)


class Parsers(unittest.TestCase):
    @unittest.skipUnless(glob.glob(f'{AN_RAW}/an_nfl_props_wk01-09_*.json') and os.path.exists(AN_PARQ), 'stored Action Network pull not on disk')
    def test_action_network_parse_is_exact(self):
        import pandas as pd, prepare as PR
        d = json.load(open(glob.glob(f'{AN_RAW}/an_nfl_props_wk01-09_*.json')[0])); X = PR.parse_props(d); R = pd.read_parquet(AN_PARQ)
        self.assertEqual(list(X.columns), list(R.columns)); self.assertTrue((X.fillna(-1) == R.reset_index(drop=True).fillna(-1)).all().all())

    def test_nws_wind(self):
        import fetch_nws as N
        self.assertEqual(N.mph('5 to 10 mph'), 7.5); self.assertEqual(N.mph('12 mph'), 12.0); self.assertIsNone(N.mph(''))

    def test_schema_errors_fail_safe(self):
        import fetch_espn as E, fetch_an as A
        orig_e, orig_a = E.http_json, A.http_json
        try:
            E.http_json = lambda *a, **k: {'events': [{'id': '1', 'date': 'x', 'competitions': [{'competitors': [{'homeAway': 'home'}]}]}]}
            with self.assertRaises(CM.SchemaError): E.scoreboard(9)
            E.http_json = lambda *a, **k: {'injuries': [{'injuries': [{'athlete': {'id': '1'}, 'status': 'Out'}]}]}
            with self.assertRaises(CM.SchemaError): E.injuries()           # far too few rows for an in-season feed
            A.http_json = lambda *a, **k: {'games': [], 'players': []}
            with self.assertRaises(CM.SchemaError): A.markets(9, A.CORE[0])
            A.http_json = lambda *a, **k: (_ for _ in ()).throw(json.JSONDecodeError('x', '<html>', 0))
            with self.assertRaises(A.Blocked): A.markets(9, A.CORE[0])
        finally:
            E.http_json, A.http_json = orig_e, orig_a

    def test_espn_injury_rows(self):
        import fetch_espn as E
        grp = [{'injuries': [{'athlete': {'links': [{'href': f'https://www.espn.com/nfl/player/_/id/{100 + i}/x'}], 'displayName': f'P {i}', 'position': {'abbreviation': 'WR'},
                                          'team': {'abbreviation': 'WSH'}}, 'status': 'Questionable', 'type': {'abbreviation': 'Q'}, 'details': {'type': 'Knee', 'fantasyStatus': {'abbreviation': 'Q'}},
                              'date': '2026-11-05T02:37Z', 'shortComment': 'c'} for i in range(60)]}]
        orig = E.http_json
        try:
            E.http_json = lambda *a, **k: {'injuries': grp}
            rows = E.injuries()
        finally: E.http_json = orig
        self.assertEqual(rows[0][:5], ['100', 'P 0', 'WR', 'WAS', 'Questionable'])


if __name__ == '__main__':
    unittest.main()
