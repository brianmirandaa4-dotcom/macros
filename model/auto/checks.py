"""Publish guard: re-check an exported slate against the invariants slate.py enforces, plus traceability to the model run.
A slate that fails any check is NOT published (the last good file stays). Returns a list of failure strings (empty = pass).

  I1 schema          wmtl.slate.v2 with games/props/meta; every prop's gid is a game of the slate
  I2 shares          per team, historical target shares x share_scale of the receiving pool sum to <= 100%
  I3 team passing    receivers' projected yards vs the QB (> 10% apart): QB prop rejected and those receivers neither lean nor bet
  I4 non-negative    projections and 80% ranges >= 0; probabilities in [0, 1]
  I5 no-prediction   a no-prediction prop carries no projection, side or probability
  I6 tiers           bet: validated market, no flags, edge >= 3 pts, bootstrap 10th pct > break-even, p <= .75, units <= 1;
                     <= 15 bets and <= 15u per slate; lean: validated market, no flags
  I7 stale price     the best price's book is within 8 no-vig points of the median of the books offered
  I8 traceability    every refreshed prop with numbers exists in the model run (work/slate_<season>_<week>.json) with the
                     same median (projection) and 80% range; histograms hold the 10,000 simulations
  I9 frozen          props of games that had kicked off are byte-identical to the previously published file
"""
import json
import numpy as np

VALIDATED = {'receptions', 'rec_yds'}


def be(o): return -o / (-o + 100) if o < 0 else 100 / (o + 100)


def check(slate, model_run, prev=None, frozen_gids=()):
    F = []
    if slate.get('schema') != 'wmtl.slate.v2': F.append('I1 schema is not wmtl.slate.v2')
    for k in ('games', 'props', 'meta', 'id'):
        if k not in slate: F.append(f'I1 missing {k}')
    if F: return F
    gids = {g['id'] for g in slate['games']}
    for p in slate['props']:
        if p.get('gid') not in gids: F.append(f"I1 prop {p.get('id')} has no game"); break
    frozen_gids = set(frozen_gids)
    run = {f"{p['game_id']}-{p['pid']}-{p['market']}": p for p in (model_run or {}).get('props', [])}   # = export prop id
    byteam = {}
    for p in model_run.get('props', []) if model_run else []:
        byteam.setdefault((p['game_id'], p['team']), []).append(p)
    # I2 / I3 on the model run rows behind the refreshed games
    for (gid, team), ps in byteam.items():
        if gid in frozen_gids or gid not in gids: continue
        rec = [p for p in ps if p['market'] == 'receptions']
        if rec:
            tot = sum(p['tg_sh'] * p['share_scale'] for p in rec)
            if tot > 1.0 + 1e-6: F.append(f'I2 {gid} {team}: target shares sum to {tot:.3f} > 1')
        qb = [p for p in ps if p['market'] == 'pass_yds']
        ry = sum(p['mean'] for p in ps if p['market'] == 'rec_yds')     # means already include share_scale (slate.py scales the draws)
        # slate.py tests pre-copula sample means; the stored means come from the copula draws, so allow 2 points of slack
        if qb and ry > 1.12 * qb[0]['mean'] and not qb[0]['rejected']:
            F.append(f'I3 {gid} {team}: receivers {ry:.0f} vs QB {qb[0]["mean"]:.0f} but QB prop not rejected')
        if qb and qb[0]['rejected']:
            for p in ps:
                if p['market'] in ('rec_yds', 'receptions') and p['tier'] in ('lean', 'bet'): F.append(f"I3 {gid} {team}: {p['name']} {p['market']} is {p['tier']} despite failed team check")
    bets = []
    for p in slate['props']:
        pid = p.get('id', '?'); fz = p['gid'] in frozen_gids
        np_ = p.get('no_prediction')
        if np_:
            if any(p.get(k) is not None for k in ('projection', 'side', 'p', 'p_raw')): F.append(f'I5 {pid}: no-prediction prop carries numbers')
            continue
        for k in ('projection',):
            if p.get(k) is not None and p[k] < 0: F.append(f'I4 {pid}: negative {k}')
        if p.get('range80') and min(p['range80']) < 0: F.append(f'I4 {pid}: negative range')
        for k in ('p', 'p_raw', 'p_uncal', 'break_even', 'novig'):
            if p.get(k) is not None and not (0 <= p[k] <= 1): F.append(f'I4 {pid}: {k}={p[k]} outside [0,1]')
        flags = bool(p.get('ood'))
        if p.get('tier') == 'bet':
            bets.append(p)
            why = []
            if p['market'] not in VALIDATED: why.append('market not validated')
            if flags: why.append('has flags')
            if (p.get('edge_pts') or 0) < 3: why.append(f"edge {p.get('edge_pts')} < 3")
            if not p.get('interval') or p['interval'][0] <= (p.get('break_even') or 1): why.append('interval does not clear break-even')
            if (p.get('p') or 0) > .75: why.append('above the 75% ceiling')
            if (p.get('units') or 0) > 1.0 + 1e-9: why.append('units > 1')
            if why: F.append(f'I6 {pid}: bet but ' + ', '.join(why))
        if p.get('tier') == 'lean' and (p['market'] not in VALIDATED or flags): F.append(f'I6 {pid}: lean in an unvalidated market or with flags')
        offs = [o for o in p.get('offers') or [] if isinstance(o.get('over'), (int, float)) and isinstance(o.get('under'), (int, float))]
        if isinstance(p.get('odds'), (int, float)) and len(offs) >= 2 and not fz:
            nv = {o['book']: be(o['over']) / (be(o['over']) + be(o['under'])) for o in offs}
            med = float(np.median(list(nv.values())))
            if p.get('book') in nv and abs(nv[p['book']] - med) > .08 + 1e-9: F.append(f"I7 {pid}: best book {p['book']} is a stale price ({nv[p['book']]:.3f} vs median {med:.3f})")
        if not fz and model_run is not None and p.get('projection') is not None:
            m = run.get(pid)
            if m is None: F.append(f'I8 {pid}: not in the model run'); continue
            if abs(round(m['median'], 1) - p['projection']) > 1e-9: F.append(f'I8 {pid}: projection {p["projection"]} != model median {round(m["median"], 1)}')
            if p.get('range80') and (abs(round(m['p10'], 1) - p['range80'][0]) > 1e-9 or abs(round(m['p90'], 1) - p['range80'][1]) > 1e-9): F.append(f'I8 {pid}: range differs from the model run')
            if p.get('hist') and p['hist'].get('n') != 10000: F.append(f'I8 {pid}: histogram is not the 10,000 simulations')
    if len(bets) > 15: F.append(f'I6 {len(bets)} bets > 15 per slate')
    if sum(b.get('units') or 0 for b in bets) > 15 + 1e-6: F.append('I6 more than 15u on the slate')
    if prev and frozen_gids:
        old = {p['id']: p for p in prev.get('props', []) if p.get('gid') in frozen_gids}
        new = {p['id']: p for p in slate['props'] if p.get('gid') in frozen_gids}
        if json.dumps(old, sort_keys=True) != json.dumps(new, sort_keys=True): F.append('I9 props of started games changed')
    return F
