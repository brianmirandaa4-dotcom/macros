"""Gate logic tests (stdlib unittest).   python3 -m unittest discover -s model/auto/tests -v"""
import os, sys, json, tempfile, unittest, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gate as G
from common import parse_ts

T = parse_ts
SUN_KICKS = [T('2026-11-08T14:30:00Z'), T('2026-11-08T18:00:00Z'), T('2026-11-08T21:05:00Z'), T('2026-11-08T21:25:00Z'), T('2026-11-09T01:20:00Z'), T('2026-11-10T01:15:00Z')]
DECIDED = '2026-11-06T00:41:00Z'          # seed parameters: counts as this week's refit decision


def st(last_refresh=None, **kw):
    d = dict(kw)
    if last_refresh: d['last_refresh_utc'] = last_refresh
    return d


class Gate(unittest.TestCase):
    def d(self, now, stamp=None, run_log=None, manual='auto', decided=DECIDED, ks=SUN_KICKS):
        return G.decide(T(now), ks, stamp or {}, run_log, manual, decided)

    # ---- 3-hour cadence outside any window
    def test_skip_between_refreshes(self):
        self.assertEqual(self.d('2026-11-06T12:00:00Z', st('2026-11-06T10:00:00Z'))['mode'], 'skip')

    def test_refresh_at_2h45(self):
        self.assertEqual(self.d('2026-11-06T12:45:00Z', st('2026-11-06T10:00:00Z'))['mode'], 'refresh')

    def test_never_more_than_3h_with_15min_ticks(self):
        last = T('2026-11-06T10:00:00Z'); now = last; gaps = []
        for _ in range(4 * 24):
            now += dt.timedelta(minutes=15)
            r = G.decide(now, SUN_KICKS, {'last_refresh_utc': last.isoformat()}, None, 'auto', DECIDED)
            if r['mode'] == 'refresh': gaps.append(now - last); last = now
        self.assertTrue(gaps and max(gaps) <= dt.timedelta(hours=3), gaps)

    def test_no_history_runs(self):
        self.assertEqual(self.d('2026-11-06T12:00:00Z')['mode'], 'refresh')

    def test_run_log_backs_up_a_lost_cache(self):
        self.assertEqual(self.d('2026-11-06T12:00:00Z', None, '2026-11-06T11:00:00Z')['mode'], 'skip')

    # ---- kickoff window
    def test_window_every_tick(self):
        r = self.d('2026-11-08T12:00:00Z', st('2026-11-08T11:45:00Z'))
        self.assertEqual((r['mode'], r['in_window']), ('refresh', True))

    def test_window_no_double_run(self):
        self.assertEqual(self.d('2026-11-08T12:00:00Z', st('2026-11-08T11:55:00Z'))['mode'], 'skip')

    def test_window_starts_at_3h(self):
        self.assertEqual(self.d('2026-11-08T11:20:00Z', st('2026-11-08T10:30:00Z'))['mode'], 'skip')     # 3h10m before the first kick
        self.assertEqual(self.d('2026-11-08T11:30:00Z', st('2026-11-08T11:15:00Z'))['mode'], 'refresh')  # exactly 3h before

    def test_window_max_gap_20min(self):
        """Inside a window no tick ever skips once 20 minutes have passed (outside windows the 3-hour rule applies)."""
        last = T('2026-11-08T11:30:00Z'); now = last; bad = []; inwin = 0
        while now < T('2026-11-09T01:20:00Z'):
            now += dt.timedelta(minutes=15)
            r = G.decide(now, SUN_KICKS, {'last_refresh_utc': last.isoformat()}, None, 'auto', DECIDED)
            if r.get('in_window'):
                inwin += 1
                if r['mode'] != 'refresh' and now - last >= dt.timedelta(minutes=20): bad.append(now)
            if r['mode'] == 'refresh': last = now
        self.assertGreater(inwin, 30); self.assertEqual(bad, [])

    def test_after_last_kick_falls_back_to_3h(self):
        r = self.d('2026-11-09T02:00:00Z', st('2026-11-09T01:15:00Z'))       # SNF kicked; MNF is 23 h away
        self.assertEqual(r['mode'], 'skip')

    # ---- weekly refit (Tuesday 06:00 America/New_York)
    def test_refit_due_tuesday_morning(self):
        self.assertEqual(self.d('2026-11-10T11:30:00Z', st('2026-11-10T11:00:00Z'))['mode'], 'refit')    # 06:30 EST

    def test_no_refit_before_6am(self):
        self.assertNotEqual(self.d('2026-11-10T10:30:00Z', st('2026-11-10T10:15:00Z'))['mode'], 'refit')  # 05:30 EST

    def test_refit_once(self):
        self.assertNotEqual(self.d('2026-11-10T13:00:00Z', st('2026-11-10T12:50:00Z', last_refit_utc='2026-11-10T12:40:00Z'))['mode'], 'refit')

    def test_refit_deferred_retries_hourly(self):
        s = st('2026-11-10T11:40:00Z', last_refit_attempt_utc='2026-11-10T11:30:00Z')
        self.assertNotEqual(self.d('2026-11-10T12:00:00Z', s)['mode'], 'refit')
        self.assertEqual(self.d('2026-11-10T12:31:00Z', s)['mode'], 'refit')

    def test_refit_dst_edt(self):                       # Tue Oct 27 2026 is still EDT: 06:00 ET = 10:00Z
        self.assertEqual(G.last_refit_anchor(T('2026-10-28T03:00:00Z')).isoformat(), '2026-10-27T10:00:00+00:00')
        self.assertEqual(G.last_refit_anchor(T('2026-11-10T11:00:00Z')).isoformat(), '2026-11-10T11:00:00+00:00')
        self.assertEqual(G.last_refit_anchor(T('2026-11-10T10:59:00Z')).isoformat(), '2026-11-03T11:00:00+00:00')

    def test_seed_counts_as_decided(self):
        self.assertNotEqual(self.d('2026-11-06T12:00:00Z')['mode'], 'refit')
        self.assertEqual(self.d('2026-11-06T12:00:00Z', decided=None)['mode'], 'refit')

    # ---- manual
    def test_manual_overrides(self):
        for m in ('refresh', 'refit', 'dry-run'): self.assertEqual(self.d('2026-11-06T12:00:00Z', st('2026-11-06T11:59:00Z'), manual=m)['mode'], m)

    # ---- kickoffs from the data folder
    def test_kickoffs_from_index_and_schedule(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(f'{d}/nfl/state')
            json.dump(dict(slates=[dict(id='x', start_utc='2026-11-08T14:30:00.000Z', end_utc='2026-11-10T01:15:00.000Z', kickoffs=['2026-11-08T21:05:00.000Z'])],
                           upcoming=[dict(first='2026-11-13T01:15:00Z')]), open(f'{d}/index.json', 'w'))
            json.dump(dict(kickoffs=['2026-11-15T18:00:00Z']), open(f'{d}/nfl/state/schedule.json', 'w'))
            ks = G.kickoffs(d)
            self.assertEqual([k.isoformat() for k in ks], ['2026-11-08T14:30:00+00:00', '2026-11-08T21:05:00+00:00', '2026-11-10T01:15:00+00:00',
                                                           '2026-11-13T01:15:00+00:00', '2026-11-15T18:00:00+00:00'])

    def test_real_index_json(self):
        p = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'wmtl', 'data')
        if not os.path.exists(os.path.join(p, 'index.json')): self.skipTest('no wmtl/data/index.json')
        ks = G.kickoffs(p)
        self.assertIn(T('2026-11-08T14:30:00Z'), ks)
        self.assertEqual(G.decide(T('2026-11-08T12:00:00Z'), ks, {}, None, 'auto', DECIDED)['mode'], 'refresh')


if __name__ == '__main__':
    unittest.main()
