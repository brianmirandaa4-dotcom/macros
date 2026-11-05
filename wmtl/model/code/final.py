"""Overlay NFL · stage 5: score tonight with the kept questions, 10,000 calibrated replays, pattern check, market check,
and write the wmtl.slate.v2 file for the app."""
import numpy as np, pandas as pd, json, os, warnings, re, unicodedata
warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingRegressor
import model as M, evolve as EV
H = os.path.dirname(os.path.abspath(__file__)); OUT = f'{H}/out'
R = json.load(open(f'{OUT}/evolve.json'))
TN = json.load(open(f'{H}/espn_nfl_2021_2026.json'))['tonight']
LINES = {(l['aid'], l['m']): l for l in TN['lines'] if 'aid' in l and l.get('cur') is not None}
MK = {'pass_yds': 'pass_yds', 'qb_rush': 'rush_yds', 'rush_yds': 'rush_yds', 'rec_yds': 'rec_yds', 'rec': 'receptions', 'kick': 'kicker'}
LABEL = {'pass_yds': 'Passing yards', 'qb_rush': 'QB rushing yards', 'rush_yds': 'Rushing yards', 'rec_yds': 'Receiving yards', 'rec': 'Receptions', 'kick': 'Kicking points'}
APPMK = {'pass_yds': 'pass_yds', 'qb_rush': 'qb_rush', 'rush_yds': 'rush_yds', 'rec_yds': 'rec_yds', 'rec': 'receptions', 'kick': 'kicker'}
def norm(s): return re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()).strip()
CAL = dict(K=1.156, W_Y=0.05)
props = []; cards = {}; fitinfo = {}
for card, r in R.items():
    P, s, c = EV.prepare(card); cand, meta = EV.candidates(P, card)
    names = r['kept']; Xr = np.column_stack([cand[k] for k in names]); hist = (~P.virtual & P[s].notna() & (P.n_c >= 1)).values
    Xs = np.clip(np.clip(np.nan_to_num((Xr - np.array(r['mu'])) / np.array(r['sd'])), -2.5, 2.5) / 1.5, -1, 1)
    w = np.array(r['w']); yhat = Xs @ w + r['b']
    y = np.asarray(M.lr(P[s].clip(lower=1 - c), P.base.clip(lower=1 - c), c), float) / r['sp']
    ok = hist & np.isfinite(y); resid = y[ok] - yhat[ok]
    # width calibration on held-out 2026: model fit on < 2026, choose kw so the 80% range covers 80%
    seasons = P.season.values; tr = ok & (seasons < 2026); te = ok & (seasons == 2026)
    w0, b0 = EV.ridge(Xs[tr], y[tr], r['lam']); res0 = y[tr] - (Xs[tr] @ w0 + b0); q10, q90 = np.percentile(res0, [10, 90])
    pe = y[te] - (Xs[te] @ w0 + b0); kw = 1.0
    for k in np.linspace(.8, 1.6, 33):
        if ((pe >= k * q10) & (pe <= k * q90)).mean() >= .80: kw = float(k); break
    cover = float(((pe >= kw * q10) & (pe <= kw * q90)).mean())
    # pattern check: gradient-boosted trees on the whole candidate pool
    allnames = list(cand); Xa = np.column_stack([cand[k] for k in allnames]); Xa_s, _, _ = EV.zscale(Xa, hist)
    gb = HistGradientBoostingRegressor(max_depth=3, max_iter=300, learning_rate=.05, min_samples_leaf=300).fit(Xa_s[ok], y[ok]); gph = gb.predict(Xa_s[ok])
    # 25D score on the Slate's scale
    raw = Xs @ w; k_sc = ((M.CARDS[card]['p77'] - M.CARDS[card]['p27']) / 1.35) / np.std(raw[ok]); score = raw * k_sc; sch = score[ok]
    p77, p27 = np.percentile(sch, 77), np.percentile(sch, 27)
    fam = {f: (Xs[:, [i for i, n in enumerate(names) if r['meta'][n]['fam'] == f]] @ w[[i for i, n in enumerate(names) if r['meta'][n]['fam'] == f]]) * k_sc for f in 'ABCDE'}
    order = sorted(range(len(names)), key=lambda i: (r['meta'][names[i]]['fam'], -abs(w[i])))
    ids = []; cnt = {}
    for i in order:
        f = r['meta'][names[i]]['fam']; cnt[f] = cnt.get(f, 0) + 1; ids.append(f'{f}{cnt[f]}')
    cards[APPMK[card]] = dict(label=LABEL[card], ids=ids, names=[names[i] for i in order], how=[r['meta'][names[i]]['how'] for i in order], w=[round(float(w[i] * k_sc), 3) for i in order],
                             src=[r['meta'][names[i]]['src'] for i in order], p77=float(p77), p27=float(p27), n=int(ok.sum()), first=int(seasons[ok].min()))
    fitinfo[APPMK[card]] = dict(label=LABEL[card], n=int(ok.sum()), first_season=int(seasons[ok].min()), pool=r['pool'], kept=len(names), lam=r['lam'], walk_forward=r['wf'], cover80_2026=round(cover, 3), width=round(kw, 3),
                                rows=[dict(id=ids[k], family=r['meta'][names[i]]['fam'], name=names[i], how=r['meta'][names[i]]['how'], share=round(abs(float(w[i])) / float(np.abs(w).sum()), 4), dir=int(np.sign(w[i]) or 1), src=r['meta'][names[i]]['src']) for k, i in enumerate(order)])
    V = np.where(P.virtual.values & (P.p_play.values > 0))[0]
    for k in V:
        row = P.iloc[k]; L = LINES.get((row.pid, MK[card]))
        if card == 'rush_yds' and row.pg == 'QB': continue
        if card == 'qb_rush' and row.pg != 'QB': continue
        if L is None: continue
        rg = np.random.default_rng(abs(hash((row.pid, card, 20261105))) % 2**32)
        dz = yhat[k] + kw * rg.choice(resid, 10000); sim = np.maximum(0, (row.base + c) * np.exp(dz * r['sp']) - c)
        if card == 'rec': sim = np.round(sim)
        med = float(np.median(sim)); simw = med + (sim - med) * CAL['K']          # calib_nfl.py step 1: widen by K
        line = float(L['cur']); p_over_raw = float((simw > line).mean())
        side = 'over' if p_over_raw >= .5 else 'under'; p_side = p_over_raw if side == 'over' else 1 - p_over_raw
        sc = float(score[k]); pct = float((sch < sc).mean()); gpct = float((gph < gb.predict(Xa_s[k:k + 1])[0]).mean())
        card_ok = (sc > 1.5) if side == 'over' else (sc <= -1.5); kind = 'strong' if sc > 1.5 else 'weak' if sc <= -1.5 else 'normal'
        proj_ok = (med > line) if side == 'over' else (med < line); gap = abs(med - line) / max(line, 1) * 100
        pattern_ok = (gpct >= .5) if side == 'over' else (gpct < .5)
        tier = 'lean' if (card_ok and proj_ok and pattern_ok) else 'pass'
        lo, hi = np.percentile(sim, [10, 90]); top = np.percentile(sim, 98); step = max(1.0, round((top) / 24)) if card not in ('rec', 'kick') else 1.0
        counts, edges = np.histogram(np.clip(sim, 0, top), bins=np.arange(0, top + step, step))
        contrib = [(ids[j], names[order[j]], r['meta'][names[order[j]]]['how'], float(Xs[k, order[j]] * w[order[j]] * k_sc)) for j in range(len(order))]
        helping = sorted([x for x in contrib if x[3] > 0], key=lambda x: -x[3])[:3]; hurting = sorted([x for x in contrib if x[3] < 0], key=lambda x: x[3])[:3]
        props.append(dict(id=f'401873037-{row.pid}-{APPMK[card]}', gid='401873037', player=row['name'], team=row.team, opp=row.opp, market=APPMK[card], market_label=LABEL[card],
            side=side, line=line, odds=None, book='DraftKings', best=dict(book='DraftKings', line=line, over=None, under=None), offers=[dict(book='DraftKings', line=line, over=None, under=None)],
            opener=dict(line=float(L['open'])) if L.get('open') is not None else None, classification='lean' if tier == 'lean' else 'pass', tier=tier,
            model_status=('INFO · NO PRICE' if tier == 'lean' else 'PASS'), projection=round(med, 1), range80=[round(float(lo), 1), round(float(hi), 1)],
            p=None, p_raw=round(p_side, 3), break_even=None, edge_pts=None, ev_per_unit=None, units=None, score25=round(sc, 2), pctile=round(pct, 3), pattern_pct=round(gpct, 3),
            families={f: round(float(fam[f][k]), 2) for f in 'ABCDE'}, helping=[dict(id=a, name=b, how=h, plain=b.lower(), v=round(v, 2)) for a, b, h, v in helping],
            hurting=[dict(id=a, name=b, how=h, plain=b.lower(), v=round(v, 2)) for a, b, h, v in hurting],
            availability=dict(p_play=float(row.p_play), report=row.report), live=None,
            hist=dict(lo=0.0, step=float(step), counts=[int(x) for x in counts], n=10000, clipped_at=float(top)),
            check_news=False, lights=dict(card=bool(card_ok), card_kind=kind, proj=bool(proj_ok), edge=None, play=bool(row.p_play >= .5), gap=bool(gap <= 50), gap_pct=round(gap), pattern=bool(pattern_ok)),
            q25=[[ids[j], round(float(Xs[k, order[j]]), 3), round(float(Xs[k, order[j]] * w[order[j]] * k_sc), 3)] for j in range(len(order))], q25_key=APPMK[card],
            pkey='nfl:' + norm(row['name']), window='TNF', vac=round(float(row.vac_t if card in ('rec', 'rec_yds') else row.vac_c), 3)))
    print(card, 'kept', len(names), 'cover80', round(cover, 3), 'width', kw, 'rows', sum(1 for p in props if p['market'] == APPMK[card]), flush=True)
json.dump(dict(props=props, cards=cards, factors=fitinfo), open(f'{OUT}/final.json', 'w'))
print('props', len(props), 'leans', sum(p['tier'] == 'lean' for p in props))
