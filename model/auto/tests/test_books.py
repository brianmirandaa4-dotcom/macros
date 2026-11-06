"""Book registry and pick'em handling (every book Action Network carries).
    python3 -m unittest discover -s model/auto/tests -v"""
import os, sys, copy, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, os.path.join(HERE, '..', '..', 'nfl', 'src'))
import books as BK, checks as C


class Registry(unittest.TestCase):
    def test_requested_ids(self):
        want = {15, 30, 49, 68, 69, 71, 75, 79, 123, 1929, 2194, 2724, 2988, 3348, 3612, 4620, 4727, 5203, 5204}
        self.assertEqual(set(BK.REQUEST), want); self.assertEqual(len(BK.REQUEST), len(want))

    def test_original_names_and_codes_unchanged(self):
        for b, n, c in ((68, 'DraftKings', 'DK'), (69, 'FanDuel', 'FD'), (75, 'BetMGM', 'MGM'), (71, 'BetRivers', 'BR'), (49, 'Caesars', 'CZR'), (123, 'Caesars', 'CZR')):
            self.assertEqual((BK.NAME[b], BK.CODE[b]), (n, c))

    def test_codes_unique_per_book(self):
        codes = [BK.INFO[n]['code'] for n in BK.ORDER]
        self.assertEqual(len(codes), len(set(codes))); self.assertEqual(BK.INFO['Caesars']['an_id'], 123)

    def test_caesars_never_both(self):
        self.assertEqual(BK.drop_fallback([49, 123, 68]), {123, 68}); self.assertEqual(BK.drop_fallback([49, 68]), {49, 68})

    def test_pickem(self):
        self.assertTrue(BK.is_pickem(2194, -110, -110))           # PrizePicks is line-only whatever it posts
        self.assertTrue(BK.is_pickem(68, 0, None))                # odds 0 / null
        self.assertTrue(BK.is_pickem(68, float('nan')))
        self.assertFalse(BK.is_pickem(68, -110, 0))               # one side priced: a sportsbook row, not pick'em
        self.assertFalse(BK.is_pickem(5203, -105, -105))

    def test_sets(self):
        self.assertEqual(BK.SETS['core5'], ('DraftKings', 'FanDuel', 'BetMGM', 'BetRivers', 'Caesars'))
        self.assertEqual(set(BK.SETS['core7']) - set(BK.SETS['core5']), {'bet365', 'Fanatics'})
        for n in ('PrizePicks', 'Underdog', 'Sleeper'): self.assertNotIn(n, BK.SETS['all'])


class PickemInChecks(unittest.TestCase):
    def test_pickem_offer_never_counts_as_a_price(self):
        g = dict(id='g1', kick_utc='2026-11-08T18:00:00.000Z')
        p = dict(id='g1-x-receptions', gid='g1', market='receptions', tier='lean', ood=[], no_prediction=False, projection=None, odds=-110, book='DraftKings', side='over',
                 offers=[dict(book='DraftKings', line=4.5, over=-110, under=-110), dict(book='FanDuel', line=4.5, over=-112, under=-108),
                         dict(book='PrizePicks', line=5.5, over=None, under=None, pickem=True)])
        s = dict(schema='wmtl.slate.v2', id='t', meta={}, games=[g], props=[p])
        self.assertEqual(C.check(s, None), [])


class ParseNullOdds(unittest.TestCase):
    def test_null_odds_parse_to_zero(self):
        import prepare as PR
        cols = ['week', 'type', 'an_gid', 'start', 'book_id', 'player_id', 'player', 'pos', 'team_id', 'side', 'value', 'odds', 'alt', 'tix', 'money']
        rows = [[9, 'core_bet_type_15_receptions', 1, '2026-11-08T18:00:00.000Z', 2194, 7, 'A B', 'WR', 3, 'over', 4.5, None, 0, 0, 0],
                [9, 'core_bet_type_15_receptions', 1, '2026-11-08T18:00:00.000Z', 68, 7, 'A B', 'WR', 3, 'over', 4.5, -110, 0, 0, 0]]
        X = PR.parse_props(dict(cols=cols, rows=rows, teams={'3': 'NYG'}))
        self.assertEqual(X.odds.tolist(), [0, -110]); self.assertEqual(str(X.odds.dtype), 'int64')


if __name__ == '__main__':
    unittest.main()
