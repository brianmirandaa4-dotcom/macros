"""Refit promotion gate (refit.validate) on the real walk-forward backtest: an identical candidate is promoted, a degraded one
is kept. Runs the unchanged calibrate.py in sandboxes (a few seconds). Skipped when the local work files are not on disk."""
import os, sys, json, shutil, subprocess, tempfile, unittest
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import refit as RF

LIVE = os.environ.get('TAIL_TEST_WORK', '/home/claude/nfl/work')
FILES = ['backtest_props.parquet', 'calibrated_2026.json', 'backtest_priced.json', 'leakage_check.json']


@unittest.skipUnless(all(os.path.exists(f'{LIVE}/{f}') for f in FILES), 'live work files not on disk')
class RefitGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(); w = f'{cls.tmp}/work'; os.makedirs(w)
        for f in FILES: shutil.copy(f'{LIVE}/{f}', f'{w}/{f}')
        cls.cur = RF.sandbox(f'{cls.tmp}/cur', w)
        subprocess.run([sys.executable, f'{cls.cur}/src/calibrate.py'], check=True, capture_output=True)
        cls.ml, cls.Rl = RF.metrics(cls.cur)
        cls.P = json.load(open(f'{w}/backtest_priced.json')); cls.LK = json.load(open(f'{w}/leakage_check.json'))
        cls.w = w

    @classmethod
    def tearDownClass(cls): shutil.rmtree(cls.tmp, ignore_errors=True)

    def cand(self, mutate=None):
        c = RF.sandbox(f'{self.tmp}/cand', self.w)
        if mutate:
            B = pd.read_parquet(f'{c}/work/backtest_props.parquet'); mutate(B); B.to_parquet(f'{c}/work/backtest_props.parquet')
        subprocess.run([sys.executable, f'{c}/src/calibrate.py'], check=True, capture_output=True)
        return RF.metrics(c)

    def test_live_parameters_pass_their_own_gate(self):
        mc, Rc = self.cand()
        reasons, table = RF.validate(mc, Rc, self.ml, self.Rl, self.LK, self.P)
        self.assertEqual(reasons, []); self.assertEqual(table['receptions']['common']['cand'], table['receptions']['common']['live'])

    def test_degraded_candidate_is_kept(self):
        def noise(B):
            m = B.market == 'receptions'; B.loc[m, 'pov_B_line_close'] = np.random.default_rng(1).uniform(.2, .8, m.sum())
        mc, Rc = self.cand(noise)
        reasons, _ = RF.validate(mc, Rc, self.ml, self.Rl, self.LK, self.P)
        self.assertTrue(any(r.startswith('V2 receptions') for r in reasons), reasons)
        self.assertTrue(any(r.startswith('V5 receptions') for r in reasons), reasons)

    def test_failed_leakage_check_is_kept(self):
        mc, Rc = self.cand()
        reasons, _ = RF.validate(mc, Rc, self.ml, self.Rl, dict(verdict='FAIL'), self.P)
        self.assertTrue(reasons and reasons[0].startswith('V1'))

    def test_priced_backtest_losing_to_market_is_kept(self):
        mc, Rc = self.cand(); P = json.loads(json.dumps(self.P)); P['rec_yds']['logloss_model'] = P['rec_yds']['logloss_novig_market'] + .01
        reasons, _ = RF.validate(mc, Rc, self.ml, self.Rl, self.LK, P)
        self.assertTrue(any(r.startswith('V3 rec_yds') for r in reasons), reasons)


if __name__ == '__main__':
    unittest.main()
