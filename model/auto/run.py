"""Headless refresh of the NFL player-prop model -> wmtl/data. Called by .github/workflows/tail-refresh.yml.

    python3 model/auto/run.py --mode refresh|refit [--offline] [--no-publish] [--reason "..."]

Stages (each failure is contained: the affected output keeps its last good published version):
  1  nflverse release files (schema-checked)                       fetch_nflverse.py
  2  schedule: week to model, kicked-off games, all kickoffs        prepare.schedule
  3  ESPN scoreboard / injuries / game pages / DraftKings lines     fetch_espn.py
     Action Network prices (fallback: ESPN DraftKings prices)       fetch_an.py
     NWS forecasts for open-air stadiums                            fetch_nws.py
  4  work/ inputs: build_data.py, live parameters, lines, injuries, weather
  5  weekly refit (mode refit; promoted only if it passes validation) refit.py
  6  slate.py -> export_overlay.py (thu / sun parts) -> merge with started games -> checks.py -> tools/add_slate.py
  7  board.py, injuries.json, players and defense exports (when nflverse changed)
  8  diff vs the published data; publish only if something changed; run_log.json entry; sw.js bump
A run that exceeds the time budget (TAIL_MAX_MIN, default 35; refit 150) stops before publishing anything.
"""
import argparse, os, sys, json, shutil, subprocess, time, glob, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (REPO, MODEL, NFL_HOME, RAW, WORK, SRC, WMTL, DATA, STATE_REL, SEASON, now_utc, iso, parse_ts, read_json, write_json, log)
import publish as PB
from checks import check

AUTO = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(MODEL, 'tools')
TMP = os.environ.get('RUNNER_TEMP') or os.path.join(NFL_HOME, 'tmp')
RUNLOG_KEEP = 400


class Budget:
    def __init__(self, minutes): self.t0 = time.time(); self.end = self.t0 + minutes * 60
    def left(self): return self.end - time.time()
    def need(self, what, s=60):
        if self.left() < s: raise TimeoutError(f'time budget exhausted before {what} ({self.left():.0f}s left)')


def sh(args, budget, what, env=None, cwd=None, cap=None, ok=(0,)):
    budget.need(what)
    to = min(budget.left() - 30, cap or 1e9)
    e = dict(os.environ); e.update(env or {}); e.setdefault('NFL_HOME', NFL_HOME); e['PYTHONHASHSEED'] = '0'
    t = time.time(); log('>>', what)
    r = subprocess.run(args, cwd=cwd or NFL_HOME, env=e, capture_output=True, text=True, timeout=max(30, to))
    out = (r.stdout or '')[-3000:] + (('\n' + r.stderr[-3000:]) if r.returncode not in ok and r.stderr else '')
    log(f'<< {what} exit {r.returncode} in {time.time() - t:.0f}s', (r.stdout or '').strip().splitlines()[-1:] if r.stdout else '')
    if r.returncode not in ok: raise RuntimeError(f'{what} failed (exit {r.returncode}): {out[-1500:]}')
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', default='refresh', choices=['refresh', 'refit', 'dry-run'])
    ap.add_argument('--offline', action='store_true', help='no network: use the files already in raw/ (tests)')
    ap.add_argument('--no-publish', action='store_true'); ap.add_argument('--reason', default='')
    ap.add_argument('--stamp', default=os.environ.get('TAIL_STAMP', ''))
    a = ap.parse_args()
    if a.mode == 'dry-run': a.no_publish = True
    budget = Budget(float(os.environ.get('TAIL_MAX_MIN', 150 if a.mode == 'refit' else 35)))
    now = now_utc(); os.environ.setdefault('TAIL_NOW', iso(now))      # every stage sees the same "now"
    entry = dict(ts=iso(now), mode=a.mode, reason=a.reason, sources={}, inputs_changed={}, outputs_changed={}, published=[], kept=[], errors=[], timings={})
    stage = os.path.join(TMP, 'stage', 'data')
    rc = 0
    try:
        rc = refresh(a, budget, now, entry, stage)
    except Exception as e:                                              # noqa: BLE001 - the run log records it; nothing is published
        entry['errors'].append(f'{type(e).__name__}: {str(e)[:1500]}'); traceback.print_exc(); rc = 1
    entry['duration_s'] = round(time.time() - budget.t0)
    summary(entry)
    if a.stamp and a.mode != 'dry-run':
        st = read_json(a.stamp, {}) or {}
        if rc == 0: st['last_refresh_utc'] = entry['ts']
        if a.mode == 'refit':
            st['last_refit_attempt_utc'] = entry['ts']
            dec = (entry.get('refit') or {}).get('decision')
            if dec == 'failed': st['refit_failures'] = [t for t in st.get('refit_failures', []) if t >= st.get('last_refit_utc', '')] + [entry['ts']]
            # promoted / kept are decisions; a crash retries hourly, and after 3 crashes the week counts as decided (live parameters kept)
            if dec in ('promoted', 'kept') or (dec == 'failed' and len(st.get('refit_failures', [])) >= 3):
                st['last_refit_utc'] = entry['ts']; st['refit_failures'] = []
        if entry['published']: st['last_commit_utc'] = entry['ts']
        write_json(a.stamp, st)
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as f: f.write(f"changed={'true' if entry['published'] else 'false'}\n")
    sys.exit(rc)


def summary(entry):
    s = os.environ.get('GITHUB_STEP_SUMMARY')
    txt = ['## tail. refresh', f"- mode **{entry['mode']}** · {entry['ts']} · {entry.get('duration_s')} s · week {entry.get('week')}",
           f"- reason: {entry.get('reason')}", f"- sources: `{json.dumps(entry['sources'])[:1200]}`",
           f"- published: {len(entry['published'])} files" + (f" ({', '.join(entry['published'][:12])}{' ...' if len(entry['published']) > 12 else ''})" if entry['published'] else ' (nothing changed)'),
           f"- kept last good: {entry['kept'] or 'none'}", f"- errors: {entry['errors'] or 'none'}",
           f"- outputs: `{json.dumps({k: {kk: v[kk] for kk in ('added', 'removed', 'flipped', 'retiered', 'bets', 'leans')} for k, v in entry['outputs_changed'].items()})}`"]
    if entry.get('refit'): txt.append(f"- refit: `{json.dumps(entry['refit'])[:1500]}`")
    print('\n'.join(txt))
    if s:
        with open(s, 'a') as f: f.write('\n'.join(txt) + '\n')


def refresh(a, budget, now, entry, stage):
    import prepare as PR
    import pandas as pd
    for d in (RAW, WORK, os.path.join(RAW, 'an'), os.path.join(RAW, 'espn'), os.path.join(RAW, 'nws')): os.makedirs(d, exist_ok=True)
    # ---- 1 nflverse
    if not a.offline:
        r = sh([sys.executable, f'{AUTO}/fetch_nflverse.py', '--season', str(SEASON)], budget, 'nflverse download', ok=(0, 2), cap=900)
    man = read_json(f'{RAW}/nflverse_manifest.json', {}) or {}
    entry['sources']['nflverse'] = dict(changed=man.get('changed', []), failed=man.get('failed', []), complete=man.get('complete', a.offline))
    if not a.offline and not man.get('complete'): raise RuntimeError(f"nflverse files missing: {man.get('failed')}")
    # ---- stage = a copy of the published data (everything is built here first)
    if os.path.exists(stage): shutil.rmtree(stage)
    shutil.copytree(DATA, stage)
    # ---- 2 schedule
    sch = PR.schedule(now); W = sch['week']; entry['week'] = W
    write_json(os.path.join(stage, STATE_REL, 'schedule.json'), dict(season=SEASON, week=W, kickoffs=sch['kickoffs'], games=sch['games']))
    if sch['season_done']: entry['kept'].append('season over: nothing to model'); return finish(a, entry, stage, None)
    comp = PR.completeness(W, now); entry['sources']['pbp_complete'] = comp
    upcoming = [g for g in sch['games'] if not g['started']]
    write_json(f'{WORK}/upcoming_games.json', upcoming)
    # ---- 3 pulls
    espn_dir, an_dir, nws = f'{RAW}/espn', f'{RAW}/an', f'{RAW}/nws/weather.json'
    if not a.offline:
        for f in glob.glob(f'{an_dir}/an_*.json') + glob.glob(f'{an_dir}/an_status.json') + glob.glob(f'{espn_dir}/*.json'): os.remove(f)
        sh([sys.executable, f'{AUTO}/fetch_espn.py', '--week', str(W), '--out', espn_dir], budget, 'ESPN pulls', cap=420)
        sh([sys.executable, f'{AUTO}/fetch_an.py', '--week', str(W), '--out', an_dir], budget, 'Action Network pulls', cap=420)
        sh([sys.executable, f'{AUTO}/fetch_nws.py', '--games', f'{WORK}/upcoming_games.json', '--out', nws, '--cache', f'{RAW}/nws/points.json'], budget, 'NWS forecasts', cap=240)
    entry['sources']['espn'] = read_json(f'{espn_dir}/status.json', {'status': 'offline'})
    entry['sources']['action_network'] = read_json(f'{an_dir}/an_status.json', {'status': 'offline'})
    # ---- 4 work inputs
    sh([sys.executable, f'{SRC}/build_data.py'], budget, 'build_data.py', cap=600)
    meta = PR.params_to_work(stage); entry['params'] = dict(version=meta.get('version'), through_week=meta.get('through_week'))
    entry['sources']['dk_lines'] = PR.espn_lines(stage, W, espn_dir, sch)
    pinfo = PR.an_props(stage, W, an_dir, espn_dir, sch, now); entry['sources']['prices'] = pinfo
    inj = PR.injuries(W, espn_dir, sch); entry['sources']['injuries'] = dict(espn_rows=inj['espn_rows'], raised_by_espn=len(inj['raised']))
    wx = PR.weather(W, nws, sch); entry['sources']['weather'] = wx.get('status')
    src_label = {'action_network': 'Action Network', 'action_network_earlier_pull': 'Action Network (earlier pull)', 'espn_draftkings_fallback': 'DraftKings via ESPN (Action Network unavailable)'}.get(pinfo.get('source'), 'no prices this run')
    write_json(f'{WORK}/sources.json', dict(prices_et=f"{src_label} · {now.astimezone(PB.NY).strftime('%a %b %-d, %-I:%M %p ET')}",
               injuries_et='Official NFL injury report (nflverse) + ESPN injury feed and game-day inactives, more severe status wins', prices=pinfo, weather=wx.get('status')))
    # ---- 5 refit
    if a.mode == 'refit':
        import refit as RF
        entry['refit'] = RF.run(stage, W, now, budget, sh, comp)
    # ---- inputs diff (vs the last published snapshot)
    snap_old = read_json(os.path.join(stage, STATE_REL, 'inputs_snapshot.json'), {})
    odds_f = sorted(glob.glob(f'{an_dir}/an_nfl_wk{W:02d}_odds_*.json'))
    lines_df = pd.read_parquet(f'{WORK}/an_props_wk{W:02d}.parquet')
    snap = PB.inputs_snapshot(inj, lines_df if len(lines_df) else None, (read_json(odds_f[-1], {}) or {}).get('rows') if odds_f else None, wx, man.get('changed', []))
    entry['inputs_changed'] = PB.diff_inputs(snap_old, snap)
    entry['inputs_changed']['raised_by_espn'] = inj['raised'][:40]
    # ---- 6 model run + slates
    if not comp['ok']:
        entry['kept'].append(f"slates: nflverse play-by-play still missing finished games {comp['missing'][:6]}; model not rerun")
    elif not upcoming:
        entry['kept'].append('slates: every game of the week has kicked off')
    else:
        run_slates(a, budget, now, entry, stage, W, sch)
    # ---- 7 other outputs
    other_outputs(a, budget, entry, stage, W, man, espn_dir, an_dir, stats_ok=comp['ok'])
    write_json(os.path.join(stage, STATE_REL, 'inputs_snapshot.json'), snap, compact=True)
    return finish(a, entry, stage, W)


def run_slates(a, budget, now, entry, stage, W, sch):
    try:
        sh([sys.executable, f'{SRC}/slate.py', str(SEASON), str(W)], budget, f'slate.py {SEASON} {W}', cap=1500)
    except RuntimeError as e:
        entry['kept'].append('slates: slate.py failed, every slate keeps its last good version'); entry['errors'].append(str(e)[:1500]); return
    run = read_json(f'{WORK}/slate_{SEASON}_{W:02d}.json')
    entry['sources']['invariants_log'] = (run.get('log') or [])[:30]
    parts = sorted({'thu' if g['weekday'] in ('Wed', 'Thu', 'Fri') else 'sun' for g in sch['games'] if not g['started']})
    for part in parts:
        sid = f'nfl-{SEASON}-wk{W:02d}-{part}'; rel = f'nfl/{SEASON}-wk{W:02d}-{part}.json'
        prev = read_json(os.path.join(stage, rel)); fz = PB.frozen(prev, now)
        fb = [p for p in (prev or {}).get('props', []) if p['gid'] in fz and p.get('tier') == 'bet']
        out = f'{WORK}/export_{part}.json'
        try:
            sh([sys.executable, f'{SRC}/export_overlay.py', str(SEASON), str(W), out, '--part', part, '--frozen-bets', str(len(fb)),
                '--frozen-units', str(sum(p.get('units') or 0 for p in fb))], budget, f'export_overlay {part}', cap=300)
        except RuntimeError as e:
            entry['kept'].append(f'{sid}: export failed ({str(e)[:300]})'); continue
        new = read_json(out); merged = PB.merge(new, prev, fz, part)
        fails = check(merged, run, prev, fz)
        if fails:
            entry['kept'].append(f'{sid}: NOT published, failed {len(fails)} invariant checks'); entry['errors'] += fails[:25]; continue
        write_json(f'{WORK}/merged_{part}.json', merged, compact=True)
        sh([sys.executable, f'{TOOLS}/add_slate.py', f'{WORK}/merged_{part}.json', '--id', sid, '--label', merged['meta']['label'], '--data', stage], budget, f'add_slate {part}')
        entry['outputs_changed'][sid] = PB.diff_outputs(prev, read_json(os.path.join(stage, rel)))
        # per-game kickoffs on the index row (the gate reads them)
        ip = os.path.join(stage, 'index.json'); idx = read_json(ip)
        for r in idx['slates']:
            if r['id'] == sid: r['kickoffs'] = sorted(g['kick_utc'] for g in merged['games'])
        write_json(ip, idx)


def other_outputs(a, budget, entry, stage, W, man, espn_dir, an_dir, stats_ok=True):
    env = dict(WMTL_DATA=stage)
    allp = sorted(glob.glob(f'{an_dir}/an_nfl_wk{W:02d}_allprops_*.json'))
    st = (read_json(f'{an_dir}/an_status.json', {}) or {}).get('allprops', '')
    if allp and (st.startswith('ok') or a.offline):
        out = f'{WORK}/board.json'
        try:
            sh([sys.executable, f'{SRC}/board.py', allp[-1], os.path.join(stage, f'nfl/{SEASON}-wk{W:02d}-sun.json'), os.path.join(stage, f'nfl/{SEASON}-wk{W:02d}-thu.json'), out], budget, 'board.py', cap=300)
            b = read_json(out)
            if b and b.get('schema') == 'wmtl.board.v1' and b.get('games'):
                shutil.copy2(out, os.path.join(stage, f'nfl/board-{SEASON}-wk{W:02d}.json'))
            else: entry['kept'].append('board: output failed its schema check')
        except RuntimeError as e: entry['kept'].append(f'board: {str(e)[:200]}')
    else: entry['kept'].append(f'board: kept last good (Action Network all-props pull: {st or "none"})')
    if os.path.exists(f'{espn_dir}/injuries.json'):
        t = os.path.join(TMP, 'inj'); shutil.rmtree(t, ignore_errors=True); os.makedirs(t)
        try:
            sh([sys.executable, f'{TOOLS}/espn_injuries.py', RAW, t], budget, 'espn_injuries.py')
            d = read_json(f'{t}/data/injuries.json')
            if d and d.get('nfl', {}).get('by_id'): shutil.copy2(f'{t}/data/injuries.json', os.path.join(stage, 'injuries.json'))
        except RuntimeError as e: entry['kept'].append(f'injuries.json: {str(e)[:200]}')
    else: entry['kept'].append('injuries.json: kept last good (ESPN injuries pull failed)')
    changed = man.get('changed') or []
    missing = not os.path.exists(os.path.join(stage, 'nflp', 'index.json')) or not os.path.exists(os.path.join(stage, 'nfl', f'defense_{SEASON}.json'))
    if not stats_ok: entry['kept'].append('players / defense exports: nflverse play-by-play incomplete')
    elif changed or missing or a.offline:
        for s, cap in (('players_export.py', 600), ('defense_export.py', 300)):
            try: sh([sys.executable, f'{SRC}/{s}'], budget, s, env=env, cap=cap)
            except RuntimeError as e: entry['kept'].append(f'{s}: {str(e)[:200]}')


def finish(a, entry, stage, W):
    ch, de = PB.plan(stage, DATA)
    entry['would_publish'] = ch[:50] if a.no_publish else None
    if ch or de:
        if a.no_publish:
            log(f'dry run: {len(ch)} files would change, {len(de)} deleted', ch[:20]); return 0
        rl = read_json(os.path.join(DATA, 'nfl', 'run_log.json'), {}) or {}
        runs = (rl.get('runs') or [])[-(RUNLOG_KEEP - 1):] + [{k: v for k, v in entry.items() if k != 'would_publish'} | dict(published=ch[:200], deleted=len(de))]
        write_json(os.path.join(stage, 'nfl', 'run_log.json'), dict(schema='tail.run_log.v1', note='One entry per run that published. Inputs and outputs changed are vs the previous published state.', runs=runs))
        PB.apply(stage, DATA, ch + ['nfl/run_log.json', 'nfl/state/inputs_snapshot.json'], de)
        entry['published'] = ch
        if os.environ.get('TAIL_SW_BUMP', 'always') != 'never':
            n = PB.bump_sw(WMTL); log('sw.js version ->', n); entry['sw_version'] = n
    else:
        log('nothing changed: no files written')
    return 0


if __name__ == '__main__':
    main()
