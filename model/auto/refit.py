"""Weekly refit + recalibration (Tuesday morning ET), promoted only if it passes the existing validation.

Runs the unchanged model code in a sandbox copy of work/ (cand/), after the week's games are in nflverse:
  features.py               leak-free features with the new week
  features.py --leakcheck   must PASS (scrambling one week moves no earlier feature)
  models.py --seasons S     walk-forward backtest of the current season (earlier seasons' walk-forward rows are kept from
                            the live parameters: they are fit on data that has not changed)
  calibrate.py              walk-forward temperature by week -> calibrated_<S>.json (log loss vs 50/50 at the DK line)
  backtest_priced.py        the same model at real book prices, graded weeks only (log loss vs the no-vig market)
  gamelines.py, live.py     when the time budget allows (otherwise their live files are kept)

Promotion rule, for each validated market (receptions, receiving yards; the markets that can become bets):
  V1  leakage check PASS
  V2  calibrated walk-forward log loss < 50/50 log loss at the DraftKings line            (calibrate.py)
  V3  priced log loss <= no-vig market log loss + 0.001 and < 50/50                       (backtest_priced.py)
  V4  calibration: 10-bin ECE of the calibrated probabilities <= live ECE + 0.01
  V5  no regression: log loss on the rows both versions predicted <= live + 0.002
All pass -> the candidate replaces the live parameters (state/params). Any fail -> the live parameters stay and the reasons
are logged (run_log.json "refit" and state/refit_log.json). Rushing and passing yards are reported, never gated: they
cannot become bets. live.py's in-game parameters are replaced only if no market loses its own validated flag.
"""
import os, sys, json, shutil, glob
import numpy as np, pandas as pd
from common import WORK, RAW, SRC, SEASON, STATE_REL, iso, read_json, write_json, log
from prepare import PARAM_FILES

CHOSEN = {'receptions': 'B', 'rec_yds': 'B', 'rush_yds': 'A', 'pass_yds': 'A'}       # = slate.py CHOSEN
VALIDATED = ('receptions', 'rec_yds')                                                  # = slate.py VALIDATED
TOL_NOVIG, TOL_ECE, TOL_REG = 0.001, 0.01, 0.002


def sandbox(root, work_from):
    """A model home whose src/ and raw/ point at the real ones and whose work/ is a private copy."""
    if os.path.exists(root): shutil.rmtree(root)
    os.makedirs(root); os.symlink(SRC, f'{root}/src'); os.symlink(RAW, f'{root}/raw'); shutil.copytree(work_from, f'{root}/work')
    return root


def ll(p, o): p = np.clip(p, 1e-4, 1 - 1e-4); return float(-np.mean(o * np.log(p) + (1 - o) * np.log(1 - p)))


def ece(p, o, nb=10):
    b = np.minimum((p * nb).astype(int), nb - 1)
    return float(sum(np.sum(b == i) * abs(p[b == i].mean() - o[b == i].mean()) for i in range(nb) if np.any(b == i)) / len(p))


def metrics(home):
    C = read_json(f'{home}/work/calibrated_{SEASON}.json'); R = pd.read_parquet(f'{home}/work/calibrated_{SEASON}.parquet')
    out = {}
    for m, c in CHOSEN.items():
        h = R[R.market == m]; ok = h[f'pc_{c}'].notna()
        out[m] = dict(logloss=C[m][c]['logloss'], logloss_5050=C[m]['market_5050']['logloss'], n=C[m]['n'],
                      ece=round(ece(h.loc[ok, f'pc_{c}'].values, h.loc[ok, 'o'].values), 4), weeks=int(h.week.max()) if len(h) else None)
    return out, R


def validate(mc, Rc, ml, Rl, LK, P):
    """Rules V1-V5 (module docstring). mc/ml = metrics() of candidate / live, Rc/Rl their calibrated rows, LK leakage report,
    P the candidate's backtest_priced.json. Returns (reasons the candidate fails, per-market metrics table)."""
    J = Rc.merge(Rl, on=['game_id', 'pid', 'market'], suffixes=('_c', '_l'))
    reasons, table = [], {}
    if not str(LK.get('verdict', '')).startswith('PASS'): reasons.append(f"V1 leakage check: {LK.get('verdict')}")
    for m, c in CHOSEN.items():
        t = dict(cand=mc[m], live=ml[m], priced=dict((k, P.get(m, {}).get(k)) for k in ('n_dk', 'logloss_model', 'logloss_novig_market', 'logloss_5050')))
        j = J[(J.market == m) & J[f'pc_{c}_c'].notna() & J[f'pc_{c}_l'].notna()]
        if len(j): t['common'] = dict(n=len(j), cand=round(ll(j[f'pc_{c}_c'].values, j.o_c.values), 4), live=round(ll(j[f'pc_{c}_l'].values, j.o_l.values), 4))
        table[m] = t
        if m not in VALIDATED: continue
        if not mc[m]['logloss'] < mc[m]['logloss_5050']: reasons.append(f"V2 {m}: calibrated log loss {mc[m]['logloss']} not below 50/50 {mc[m]['logloss_5050']}")
        pm = P.get(m) or {}
        if pm.get('logloss_model') is None: reasons.append(f'V3 {m}: priced backtest missing')
        elif not (pm['logloss_model'] <= pm['logloss_novig_market'] + TOL_NOVIG and pm['logloss_model'] < pm['logloss_5050']):
            reasons.append(f"V3 {m}: priced log loss {pm['logloss_model']} vs no-vig {pm['logloss_novig_market']} / 50-50 {pm['logloss_5050']}")
        if mc[m]['ece'] > ml[m]['ece'] + TOL_ECE: reasons.append(f"V4 {m}: ECE {mc[m]['ece']} > live {ml[m]['ece']} + {TOL_ECE}")
        if 'common' in t and t['common']['cand'] > t['common']['live'] + TOL_REG: reasons.append(f"V5 {m}: log loss on common rows {t['common']['cand']} > live {t['common']['live']} + {TOL_REG}")
    return reasons, table


def run(stage, W, now, budget, sh, comp):
    R_wk = W - 1; tmp = os.path.join(os.environ.get('RUNNER_TEMP') or os.path.dirname(WORK), 'refit')
    rec = dict(ts=iso(now), through_week=R_wk)
    if not comp['ok']:
        rec.update(decision='deferred', reasons=[f"nflverse play-by-play still missing {comp['missing'][:6]}"]); return _log(stage, rec)
    L = pd.read_parquet(f'{WORK}/espn_dk_prop_lines_{SEASON}.parquet')
    rec['dk_lines_last_week'] = int((L.week == R_wk).sum())
    cand = sandbox(f'{tmp}/cand', WORK); cur = sandbox(f'{tmp}/cur', WORK)
    env = dict(NFL_HOME=cand, TAIL_PRICED_MAX_WEEK=str(R_wk), LIVE_PARAMS_OUT=f'{cand}/work/live_params.json')
    py = sys.executable
    try:
        sh([py, f'{cand}/src/features.py'], budget, 'refit features.py', env=env, cwd=cand, cap=900)
        sh([py, f'{cand}/src/features.py', '--leakcheck'], budget, 'refit leakage check', env=env, cwd=cand, cap=900)
        old = pd.read_parquet(f'{WORK}/backtest_props.parquet')
        sh([py, f'{cand}/src/models.py', '--seasons', str(SEASON)], budget, f'refit models.py --seasons {SEASON}', env=env, cwd=cand, cap=5400)
        new = pd.read_parquet(f'{cand}/work/backtest_props.parquet')
        pd.concat([old[old.season != SEASON], new], ignore_index=True).to_parquet(f'{cand}/work/backtest_props.parquet')
        sh([py, f'{cand}/src/calibrate.py'], budget, 'refit calibrate.py', env=env, cwd=cand, cap=600)
        sh([py, f'{cand}/src/backtest_priced.py'], budget, 'refit backtest_priced.py', env=env, cwd=cand, cap=600)
        sh([py, f'{cur}/src/calibrate.py'], budget, 'live-parameter calibrate.py (comparison)', env=dict(env, NFL_HOME=cur), cwd=cur, cap=600)
        extra = {}
        for s, need_min in (('gamelines.py', 40), ('live.py', 35)):
            if budget.left() > need_min * 60:
                try: sh([py, f'{cand}/src/{s}'], budget, f'refit {s}', env=env, cwd=cand, cap=need_min * 60); extra[s] = 'ran'
                except Exception as e: extra[s] = f'failed: {str(e)[:200]}'          # noqa: BLE001
            else: extra[s] = 'skipped: time budget'
        rec['optional'] = extra
    except Exception as e:                                                           # noqa: BLE001
        rec.update(decision='failed', reasons=[f'refit did not complete (live parameters kept): {str(e)[:600]}']); return _log(stage, rec)
    # ---------------- validation
    LK = read_json(f'{cand}/work/leakage_check.json', {}); P = read_json(f'{cand}/work/backtest_priced.json', {})
    mc, Rc = metrics(cand); ml, Rl = metrics(cur)
    reasons, table = validate(mc, Rc, ml, Rl, LK, P)
    rec['metrics'] = table
    sd = os.path.join(stage, STATE_REL, 'params'); meta = read_json(f'{sd}/params_meta.json', {}) or {}
    if reasons:
        rec.update(decision='kept', reasons=reasons)
        meta.update(decided_utc=rec['ts'], last_decision='kept', last_reasons=reasons[:10]); write_json(f'{sd}/params_meta.json', meta)
        return _log(stage, rec)
    # ---------------- promote
    files = [f for f in PARAM_FILES if f not in ('backtest_games_summary.json', 'live_validation.json')]
    if extra.get('gamelines.py') == 'ran': files.append('backtest_games_summary.json')
    live_ok = False
    if extra.get('live.py') == 'ran':
        nv, ov = read_json(f'{cand}/work/live_validation.json', {}), read_json(f'{WORK}/live_validation.json', {})
        lost = [m for m in CHOSEN if (ov.get(m) or {}).get('validated') and not (nv.get(m) or {}).get('validated')]
        live_ok = not lost; rec['live_model'] = 'promoted' if live_ok else f'kept (would lose validation: {lost})'
        if live_ok:
            files.append('live_validation.json'); shutil.copy2(f'{cand}/work/live_params.json', os.path.join(stage, 'nfl', 'live_params.json'))
    for f in files:
        shutil.copy2(f'{cand}/work/{f}', f'{sd}/{f}'); shutil.copy2(f'{cand}/work/{f}', f'{WORK}/{f}')
    for f in ('feat_player.parquet', 'feat_team.parquet'): shutil.copy2(f'{cand}/work/{f}', f'{WORK}/{f}')
    meta.update(version=f'refit-{rec["ts"][:10]}', decided_utc=rec['ts'], promoted_utc=rec['ts'], through_week=R_wk, last_decision='promoted', last_reasons=[],
                files=files, metrics={m: dict(logloss=mc[m]['logloss'], ece=mc[m]['ece']) for m in CHOSEN})
    write_json(f'{sd}/params_meta.json', meta)
    rec.update(decision='promoted', promoted=files)
    return _log(stage, rec)


def _log(stage, rec):
    p = os.path.join(stage, STATE_REL, 'refit_log.json'); d = read_json(p, {}) or {}
    d['refits'] = (d.get('refits') or [])[-51:] + [rec]; write_json(p, d)
    log('refit decision:', rec.get('decision'), rec.get('reasons', [])[:5])
    return dict(decision=rec.get('decision'), reasons=rec.get('reasons', [])[:10], through_week=rec.get('through_week'), optional=rec.get('optional'), live_model=rec.get('live_model'))
