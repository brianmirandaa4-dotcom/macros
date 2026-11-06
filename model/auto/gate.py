"""Gate: decide what this 15-minute tick should do. Standard library only (runs before any pip install).

    python3 model/auto/gate.py [--stamp PATH] [--mode auto|refresh|refit|dry-run|skip] [--github-output PATH]

Rules (times in UTC, "kickoff" = any game kickoff found in wmtl/data/index.json or wmtl/data/nfl/state/schedule.json):
  1. A manual mode other than auto wins (workflow_dispatch).
  2. REFIT when the weekly refit is due: the most recent Tuesday 06:00 America/New_York has passed and no refit has been
     decided (promoted or kept) since then. A deferred attempt (data not complete yet) retries at most once an hour.
  3. REFRESH inside the kickoff window: some kickoff k with k - 3h <= now < k, and the last refresh is at least
     MIN_GAP_WINDOW (12 min) old. With the 15-minute cron that means every tick (<= 20 minutes between runs).
  4. REFRESH outside the window when the last refresh is at least MAX_GAP - 15 min old (2h45m), so with 15-minute ticks the
     gap never exceeds 3 hours.
  5. Otherwise SKIP.
"Last refit" = the newer of the stamp and params/params_meta.json decided_utc (the seed counts as decided).
"Last refresh" = the newest of the stamp (actions/cache, written by every completed refresh, including no-change runs)
and the last entry of wmtl/data/nfl/run_log.json (survives cache eviction).
"""
import argparse, json, os, sys, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, NY, SEED, UTC, now_utc, iso, parse_ts, read_json, STATE_REL

WINDOW = dt.timedelta(hours=3)
MIN_GAP_WINDOW = dt.timedelta(minutes=12)
MAX_GAP = dt.timedelta(hours=3)
TICK = dt.timedelta(minutes=15)
REFIT_RETRY = dt.timedelta(minutes=60)
REFIT_DAY, REFIT_HOUR = 1, 6          # Tuesday (Mon=0), 06:00 ET


def kickoffs(data_dir):
    """Every kickoff time we know of: per-game kickoffs on index rows, slate start/end, upcoming rows, the schedule file."""
    ks = set()
    idx = read_json(os.path.join(data_dir, 'index.json'), {}) or {}
    for s in idx.get('slates', []):
        for k in s.get('kickoffs') or []: ks.add(k)
        for f in ('start_utc', 'end_utc'):
            if s.get(f): ks.add(s[f])
    for u in idx.get('upcoming', []) or []:
        if u.get('first'): ks.add(u['first'])
    sch = read_json(os.path.join(data_dir, STATE_REL, 'schedule.json'), {}) or {}
    for k in sch.get('kickoffs', []): ks.add(k)
    out = []
    for k in ks:
        try: out.append(parse_ts(k))
        except (ValueError, TypeError): pass
    return sorted(set(out))


def last_refit_anchor(now):
    """The most recent Tuesday 06:00 ET at or before now."""
    et = now.astimezone(NY)
    d = et.date() - dt.timedelta(days=(et.weekday() - REFIT_DAY) % 7)
    anchor = dt.datetime(d.year, d.month, d.day, REFIT_HOUR, tzinfo=NY)
    if anchor > et: anchor -= dt.timedelta(days=7)
    return anchor.astimezone(UTC)


def decide(now, ks, stamp, run_log_last=None, manual='auto', refit_decided=None):
    stamp = stamp or {}
    if manual and manual != 'auto':
        return dict(mode=manual, reason=f'manual dispatch ({manual})')
    lr = [t for t in (parse_ts(stamp.get('last_refresh_utc')), parse_ts(run_log_last)) if t]
    last = max(lr) if lr else None
    since = (now - last) if last else None
    # weekly refit
    anchor = last_refit_anchor(now)
    dl = [t for t in (parse_ts(stamp.get('last_refit_utc')), parse_ts(refit_decided)) if t]
    done = max(dl) if dl else None
    tried = parse_ts(stamp.get('last_refit_attempt_utc'))
    if (done is None or done < anchor) and (tried is None or tried < anchor or now - tried >= REFIT_RETRY):
        return dict(mode='refit', reason=f'weekly refit due (anchor {iso(anchor)}; last decided {iso(done) if done else "never"})')
    # kickoff window
    nxt = [k for k in ks if k > now]
    inwin = [k for k in nxt if k - WINDOW <= now]
    if inwin:
        k = inwin[0]; mins = int((k - now).total_seconds() // 60)
        if since is None or since >= MIN_GAP_WINDOW:
            return dict(mode='refresh', reason=f'kickoff window: next kickoff {iso(k)} in {mins} min', in_window=True, next_kick=iso(k))
        return dict(mode='skip', reason=f'kickoff window but last refresh only {int(since.total_seconds() // 60)} min ago', in_window=True, next_kick=iso(k))
    if since is None or since >= MAX_GAP - TICK:
        why = 'no previous refresh recorded' if since is None else f'{since.total_seconds() / 3600:.2f} h since last refresh'
        return dict(mode='refresh', reason=f'3-hour cadence: {why}', in_window=False, next_kick=iso(nxt[0]) if nxt else None)
    return dict(mode='skip', reason=f'last refresh {int(since.total_seconds() // 60)} min ago; next kickoff {iso(nxt[0]) if nxt else "unknown"}',
                in_window=False, next_kick=iso(nxt[0]) if nxt else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stamp', default=os.environ.get('TAIL_STAMP', ''))
    ap.add_argument('--mode', default=os.environ.get('TAIL_MODE', 'auto') or 'auto')
    ap.add_argument('--data', default=DATA)
    ap.add_argument('--github-output', default=os.environ.get('GITHUB_OUTPUT', ''))
    a = ap.parse_args()
    now = now_utc()
    stamp = read_json(a.stamp, {}) if a.stamp else {}
    rl = read_json(os.path.join(a.data, 'nfl', 'run_log.json'), {}) or {}
    last_run = (rl.get('runs') or [{}])[-1].get('ts') if rl.get('runs') else None
    meta = read_json(os.path.join(a.data, STATE_REL, 'params', 'params_meta.json')) or read_json(os.path.join(SEED, 'params_meta.json'), {}) or {}
    d = decide(now, kickoffs(a.data), stamp, last_run, a.mode, meta.get('decided_utc'))
    d['now'] = iso(now)
    print(json.dumps(d))
    if a.github_output:
        with open(a.github_output, 'a') as f:
            for k in ('mode', 'reason'):
                f.write(f'{k}={d.get(k, "")}\n')


if __name__ == '__main__':
    main()
