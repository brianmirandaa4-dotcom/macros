"""History back-fill · 2026 Weeks 1-8 from the model's leak-free walk-forward backtest.

    python3 tools/build_history.py [/home/claude/nfl] [data]

Writes data/nfl/history/2026-wk01..08.json (schema wmtl.slate.v2 plus a graded results block) and data/nfl/history/index.json.
Copies or recomputes only what the pipeline already stores; it invents nothing:
  * predictions   work/backtest_props.parquet  (week w fit on games strictly before week w; 25-quantile grid qg_A / qg_B)
  * temperature   work/calibrated_2026.json    (k_by_week, fit on earlier weeks only)
  * prices        work/an_props_2026.parquet   (Action Network last stored pre-game price; 68 DK, 69 FD, 75 BetMGM, 71 BetRivers, 49 Caesars; 30 = opener)
  * OOD flags     work/feat_player.parquet     (n_prior, f_gap, qb_change, qb_new, training range per market and week)
  * results       work/player_games.parquet    (nflverse box scores) and work/games.parquet (finals, closing spread/total)
Selection is the same code path as src/backtest_priced.py (probability at each book's line) and src/slate.py + src/export_overlay.py
(validated market, stale-price guard, edge >= 3 pts at the best price, ceiling 75%, no OOD flag, top 15 by edge, 1u cap).
Not reproducible from stored outputs and therefore NOT applied: the game-bootstrap interval test and the receivers-vs-QB team check
(bootstrap refits were never stored for past weeks). Stakes are therefore a flat 1u, the backtest's own convention."""
import json, os, sys, re, unicodedata, datetime as dt
from zoneinfo import ZoneInfo
import numpy as np, pandas as pd

NFL = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/nfl'
DATA = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
W = f'{NFL}/work'; OUT = os.path.join(DATA, 'nfl', 'history'); os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, f'{NFL}/src')
from features import feats            # the model's own feature lists (training-range OOD check)
MK_OK = {   # eligibility, copied from src/models.py MK (models.py imports lightgbm; only the row filters are needed here)
    'rec_yds': (lambda P: P.pos.isin(['WR', 'TE', 'RB']) & (P.f_tg_sh > .03), 'f_ypt_shr'),
    'receptions': (lambda P: P.pos.isin(['WR', 'TE', 'RB']) & (P.f_tg_sh > .03), 'f_cr_shr'),
    'rush_yds': (lambda P: (P.pos == 'RB') & (P.f_ca_sh > .08), 'f_ypc_shr'),
    'pass_yds': (lambda P: (P.pos == 'QB') & (P.f_db_sh > .6), 'qb_ypa_shr')}

CHOSEN = {'receptions': 'B', 'rec_yds': 'B', 'rush_yds': 'A', 'pass_yds': 'A'}          # src/slate.py, src/backtest_priced.py
VALIDATED = {'receptions', 'rec_yds'}                                                   # src/slate.py
LABEL = {'rec_yds': 'Receiving yards', 'receptions': 'Receptions', 'rush_yds': 'Rushing yards', 'pass_yds': 'Passing yards'}
MODEL_NAME = {'A': 'LightGBM quantile regression', 'B': 'Hierarchical: Negative Binomial volume × shrunk efficiency'}
BOOKS = {68: 'DraftKings', 69: 'FanDuel', 75: 'BetMGM', 71: 'BetRivers', 49: 'Caesars'}
LV = np.arange(2, 100, 4) / 100                                                         # quantile levels of qg_*
MIN_EDGE = .03; CEIL = .75; STALE = .08; MAX_BETS = 15
NY = ZoneInfo('America/New_York')
LABEL_NOTE = "Reconstructed from the model's walk-forward backtest (predictions made with data available before kickoff)"

def nm(x): return re.sub(r'[^a-z ]', '', unicodedata.normalize('NFKD', str(x)).encode('ascii', 'ignore').decode().lower()).replace(' jr', '').replace(' iii', '').replace(' ii', '').strip()
def be(o): return -o / (-o + 100) if o < 0 else 100 / (o + 100)
def dec(o): return 1 + (100 / -o if o < 0 else o / 100)
lg = lambda p: np.log(p / (1 - p)); sgm = lambda x: 1 / (1 + np.exp(-x))
def pover(q, v):                                                                        # src/backtest_priced.py pover()
    q = np.maximum.accumulate(np.array(q, float)); F = np.interp(v, q, LV, left=0.01, right=0.99)
    if (q == v).any(): F = LV[np.where(q <= v)[0].max()]
    return float(np.clip(1 - F, .01, .99))
r1 = lambda x: None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), 1)
r4 = lambda x: None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), 4)
def fnum(x): return None if x is None or pd.isna(x) else float(x)

CAL = json.load(open(f'{W}/calibrated_2026.json'))
B = pd.read_parquet(f'{W}/backtest_props.parquet'); B = B[B.season == 2026].copy(); B['week'] = B.week.astype(int); B['key'] = B.name.map(nm)
A = pd.read_parquet(f'{W}/an_props_2026.parquet'); A = A[A.book_id.isin(list(BOOKS) + [30]) & (A.week <= 8)].copy(); A['key'] = A.player.map(nm)
o = A[A.side == 'over'][['week', 'market', 'key', 'team', 'book_id', 'value', 'odds']].rename(columns={'odds': 'over'})
u = A[A.side == 'under'][['week', 'market', 'key', 'team', 'book_id', 'value', 'odds']].rename(columns={'odds': 'under'})
OU = o.merge(u, on=['week', 'market', 'key', 'team', 'book_id', 'value'])
OFF = {}
for r in OU.itertuples(): OFF.setdefault((r.week, r.market, r.key, r.team), {})[int(r.book_id)] = (float(r.value), float(r.over), float(r.under))
PG = pd.read_parquet(f'{W}/player_games.parquet'); G = pd.read_parquet(f'{W}/games.parquet'); F = pd.read_parquet(f'{W}/feat_player.parquet')
F['date'] = pd.to_datetime(F.date)
G26 = G[(G.season == 2026)].copy()
STAT = {'receptions': 'receptions', 'rec_yds': 'rec_yds', 'rush_yds': 'rush_yds', 'pass_yds': 'pass_yds'}
PGs = PG.sort_values(['season', 'week'])
PGs['opp'] = np.where(PGs.team == PGs.home_team, PGs.away_team, PGs.home_team); PGs['ha'] = np.where(PGs.team == PGs.home_team, 'vs', '@')

# ---- OOD flags exactly as src/slate.py builds them (training range = 0.5 / 99.5 percentiles of the rows the week's model was fit on)
OOD = {}
for mk, (ok, e) in MK_OK.items():
    cols = feats(mk); D = F[ok(F) & F[e].notna() & (F.n_prior >= 1)]
    for w in range(1, 9):
        te = D[(D.season == 2026) & (D.week == w)]
        if not len(te): continue
        tr = D[D.date < te.date.min()]; X = tr[cols].values.astype(float); lo, hi = np.nanpercentile(X, .5, 0), np.nanpercentile(X, 99.5, 0)
        Xte = te[cols].values.astype(float)
        for i, r in enumerate(te.itertuples()):
            outside = [cols[j] for j in range(len(cols)) if np.isfinite(Xte[i, j]) and (Xte[i, j] < lo[j] or Xte[i, j] > hi[j])]
            fl = []
            if r.n_prior < 3: fl.append('fewer than 3 prior NFL games')
            if r.f_gap > 21 and r.season == r.date.year and r.week > 2 and r.n_prior > 0 and r.f_gap < 200: fl.append(f'returning after {int(r.f_gap)} days out')
            if r.qb_change == 1: fl.append('different starting QB than last game')
            if r.qb_new == 1: fl.append('starting QB has under 60 career dropbacks')
            if outside: fl.append('outside training range: ' + ', '.join(outside[:3]))
            OOD[(r.game_id, r.pid, mk)] = fl
FP = F.set_index(['game_id', 'pid'])

def kick(g):
    t = dt.datetime.strptime(f'{g.gameday} {g.gametime}', '%Y-%m-%d %H:%M').replace(tzinfo=NY); return t, t.astimezone(dt.timezone.utc)
def win(t): wd = t.strftime('%a'); return {'Thu': 'TNF', 'Mon': 'MNF', 'Sat': 'Sat'}.get(wd) or ('SNF' if t.hour >= 19 else '1 PM' if t.hour < 15 else '4 PM')

def defense_asof(w):   # what each defense allowed per game, by position and stat, in 2026 games strictly before week w
    P = PGs[(PGs.season == 2026) & (PGs.week < w)]; out = {}
    if not len(P): return out, {}
    ng = P.groupby('opp').game_id.nunique()
    for pos in ('QB', 'RB', 'WR', 'TE'):
        q = P[P.pos == pos]
        for mk, c in STAT.items():
            s = q.groupby('opp')[c].sum().reindex(ng.index).fillna(0) / ng
            rk = s.rank(ascending=False, method='min').astype(int)
            for t in s.index: out[(t, pos, mk)] = dict(pg=round(float(s[t]), 1), rank=int(rk[t]), games=int(ng[t]))
            out[('league', pos, mk)] = dict(pg=round(float(s.mean()), 1))
    return out, ng

def box_of(r):
    g = lambda c: None if pd.isna(getattr(r, c)) else (int(getattr(r, c)) if float(getattr(r, c)).is_integer() else round(float(getattr(r, c)), 1))
    b = dict(snap=None if pd.isna(r.offense_pct) else int(round(r.offense_pct * 100)), tgt=g('targets'), rec=g('receptions'), rec_yds=g('rec_yds'), rec_td=g('rec_td'),
             car=g('carries'), rush_yds=g('rush_yds'), rush_td=g('rush_td'), att=g('pass_att'), cmp=g('completions'), pass_yds=g('pass_yds'), pass_td=g('pass_td'), sacks=g('sacks'))
    return {k: v for k, v in b.items() if v not in (None, 0) or k in ('rec', 'rec_yds', 'rush_yds', 'pass_yds')}

def tally(rows):
    w = sum(r['result'] == 'won' for r in rows); l = sum(r['result'] == 'lost' for r in rows); p_ = sum(r['result'] == 'push' for r in rows)
    units = round(sum(r['units_won'] for r in rows), 2); risked = float(sum(r['stake'] for r in rows if r['result'] in ('won', 'lost')))
    return dict(w=w, l=l, p=p_, units=units, risked=risked, roi=round(units / risked, 4) if risked else None)

weeks_index = []
for w in range(1, 9):
    gw = G26[G26.week == w].sort_values(['gameday', 'gametime'])
    DEF, _ = defense_asof(w)
    games = []
    for g in gw.itertuples():
        t, tu = kick(g)
        games.append(dict(id=g.game_id, sport='NFL', kick_utc=tu.strftime('%Y-%m-%dT%H:%M:%S.000Z'), kick_et=t.strftime('%-I:%M %p'), date_et=t.strftime('%Y-%m-%d'), slate=win(t), window=win(t),
                          away=dict(abbr=g.away_team, name=g.away_team, model_name=g.away_team), home=dict(abbr=g.home_team, name=g.home_team, model_name=g.home_team),
                          market=dict(spread_home=None if pd.isna(g.spread_line) else -float(g.spread_line), total=fnum(g.total_line), book='closing line (nflverse)',
                                      moneyline=dict(away=fnum(g.away_moneyline), home=fnum(g.home_moneyline))),
                          qbs=dict(home=g.home_qb_name, away=g.away_qb_name), lines={}, counts={}))
    GM = {x['id']: x for x in games}; GR = {g.game_id: g for g in gw.itertuples()}
    bw = B[B.week == w]; props = []; box = {}
    for r in bw.itertuples():
        if r.game_id not in GM: continue
        mk = r.market; c = CHOSEN[mk]; q = np.maximum.accumulate(np.array(getattr(r, f'qg_{c}'), float))
        k = CAL[mk][c]['k_by_week'].get(str(w), .5)
        flags = OOD.get((r.game_id, r.pid, mk), [])
        hard = any(x.startswith(('fewer', 'returning', 'starting QB has')) for x in flags)
        offs = []
        for bid, (v, ov, un) in OFF.get((w, mk, r.key, r.team), {}).items():
            po = float(sgm(k * lg(pover(q, v)))); bo, bu = be(ov), be(un); nv = bo / (bo + bu)
            offs.append(dict(book='Open' if bid == 30 else BOOKS[bid], line=v, over=ov, under=un, p_over=round(po, 4), novig_over=round(nv, 4), edge_over=round(po - bo, 4), edge_under=round((1 - po) - bu, 4)))
        live_ = [x for x in offs if x['book'] != 'Open']; opn = next((x for x in offs if x['book'] == 'Open'), None)
        if not live_ and pd.isna(r.line_close): continue
        g = GR[r.game_id]; opp = g.away_team if r.team == g.home_team else g.home_team
        y = float(r.y); pos = FP.loc[(r.game_id, r.pid)].pos if (r.game_id, r.pid) in FP.index else None
        # model side at the DraftKings line (ESPN close): src/slate.py lean gate
        pov_dk = None if pd.isna(r.line_close) else float(sgm(k * lg(np.clip(getattr(r, f'pov_{c}_line_close'), 1e-3, 1 - 1e-3))))
        ps_dk = None if pov_dk is None else max(pov_dk, 1 - pov_dk)
        tier = 'pass'
        if not hard and ps_dk is not None and ps_dk >= .55 and mk in VALIDATED and not flags: tier = 'lean'
        best = None
        if live_ and not hard:
            med = float(np.median([x['novig_over'] for x in live_])); keep = [x for x in live_ if abs(x['novig_over'] - med) <= STALE]   # export_overlay.py stale guard
            if keep:
                e_, sd_, o_ = max([(x['edge_over'], 'over', x) for x in keep] + [(x['edge_under'], 'under', x) for x in keep], key=lambda z: z[0])
                pr = o_[sd_]; ps = o_['p_over'] if sd_ == 'over' else 1 - o_['p_over']
                best = dict(book=o_['book'], side=sd_, line=o_['line'], odds=pr, p=round(ps, 4), break_even=round(be(pr), 4), edge=round(e_, 4), novig=round(o_['novig_over'] if sd_ == 'over' else 1 - o_['novig_over'], 4),
                            over=o_['over'], under=o_['under'])
        if best:
            if mk in VALIDATED and not flags and best['edge'] >= MIN_EDGE and best['p'] <= CEIL: tier = 'bet'
            elif tier == 'lean' and best['edge'] <= 0: tier = 'pass'
        side = best['side'] if best else (None if pov_dk is None or hard else ('over' if pov_dk >= .5 else 'under'))
        line = best['line'] if best else (None if pd.isna(r.line_close) else float(r.line_close))
        res = None
        if side and line is not None:
            res = 'push' if y == line else ('won' if (y > line) == (side == 'over') else 'lost')
        pid_ = f'{r.game_id}-{r.pid}-{mk}'
        last = PGs[(PGs.pid == r.pid) & ((PGs.season < 2026) | ((PGs.season == 2026) & (PGs.week < w)))].tail(10)
        d_ = DEF.get((opp, pos, mk)) if pos in ('QB', 'RB', 'WR', 'TE') else None
        p = dict(id=pid_, gid=r.game_id, pid=r.pid, player=r.name, team=r.team, opp=opp, pos=pos, market=mk, market_label=LABEL[mk],
                 side=side, line=line, odds=best['odds'] if best else None, book=best['book'] if best else None,
                 best=dict(book=best['book'], line=best['line'], over=best['over'], under=best['under']) if best else None,
                 offers=[dict(book=x['book'], line=x['line'], over=x['over'], under=x['under'], p_over=x['p_over']) for x in live_],
                 opener=dict(line=opn['line'], over=opn['over'], under=opn['under']) if opn else None,
                 close_dk=dict(line=fnum(r.line_close), p_over=r4(pov_dk)) if not pd.isna(r.line_close) else None,
                 tier=tier, classification={'bet': 'recommended', 'lean': 'lean'}.get(tier, 'pass'), no_prediction=bool(hard), ood=flags,
                 projection=r1(getattr(r, f'med_{c}')), mean=r1(getattr(r, f'mean_{c}')), range80=[r1(q[2]), r1(q[22])], q25=[r1(x) for x in q], q_levels='0.02 to 0.98 in steps of 0.04',
                 p=best['p'] if best else (r4(ps_dk) if side else None), break_even=best['break_even'] if best else None, edge_pts=round(best['edge'] * 100, 1) if best else None,
                 novig=best['novig'] if best else None, k=k, ev_per_unit=round(best['p'] * dec(best['odds']) - 1, 3) if best else None, units=None, pkey='nfl:' + nm(r.name),
                 window=GM[r.game_id]['window'],
                 last10=[[int(x.season), int(x.week), x.ha, x.opp, None if pd.isna(x[STAT[mk]]) else float(x[STAT[mk]])] for _, x in last.iloc[::-1].iterrows()],
                 matchup=dict(opp=opp, ha='vs' if r.team == g.home_team else '@', spread_team=None if pd.isna(g.spread_line) else (-float(g.spread_line) if r.team == g.home_team else float(g.spread_line)),
                              total=fnum(g.total_line), defense=dict(d_, league=DEF.get(('league', pos, mk), {}).get('pg'), pos=pos, note='per game allowed to that position, 2026 games before this week') if d_ else None),
                 _y=y, _res=res)
        if not (tier in ('bet', 'lean') or (p['edge_pts'] or -99) >= 3):   # deep detail only where the History sheet shows it
            for k_ in ('q25', 'q_levels', 'last10', 'matchup'): p.pop(k_)
        props.append(p)
        pgr = PG[(PG.game_id == r.game_id) & (PG.pid == r.pid)]
        if len(pgr): box[r.pid] = dict(name=r.name, team=r.team, pos=pos, **box_of(pgr.iloc[0]))
    # portfolio guard (export_overlay.py): only the 15 largest edges are bets; flat 1u (bootstrap Kelly not stored for past weeks)
    bets = sorted([p for p in props if p['tier'] == 'bet'], key=lambda p: -(p['edge_pts'] or 0))
    for p in bets[MAX_BETS:]: p.update(tier='lean', classification='lean')
    for p in bets[:MAX_BETS]: p['units'] = 1.0
    R = {}; graded = []
    for p in props:
        y, res = p.pop('_y'), p.pop('_res'); R[p['id']] = dict(actual=y, result=res) if res else dict(actual=y, result=None)
        if res and p['odds'] is not None:
            stake = 1.0; uw = (dec(p['odds']) - 1) if res == 'won' else (-1.0 if res == 'lost' else 0.0)
            R[p['id']]['units_1u'] = round(uw, 3); graded.append(dict(p=p, result=res, stake=stake, units_won=uw))
    gres = {g.game_id: dict(final=dict(away=None if pd.isna(g.away_score) else int(g.away_score), home=None if pd.isna(g.home_score) else int(g.home_score))) for g in gw.itertuples()}
    bet_rows = [x for x in graded if x['p']['tier'] == 'bet']; side_rows = [x for x in graded if not x['p']['no_prediction']]
    edge_rows = [x for x in graded if (x['p']['edge_pts'] or -99) >= 3]
    hit = lambda rs: (round(sum(x['result'] == 'won' for x in rs) / max(1, sum(x['result'] in ('won', 'lost') for x in rs)), 4) if rs else None)
    by_day = {}
    for x in games: by_day.setdefault(x['date_et'], dict(games=[], bets=[]))['games'].append(x['id'])
    gday = {x['id']: x['date_et'] for x in games}
    for x in bet_rows: by_day[gday[x['p']['gid']]]['bets'].append(x)
    days = {d: dict(games=len(v['games']), bets=tally(v['bets'])) for d, v in sorted(by_day.items())}
    summary = dict(priced=sum(bool(p['offers']) for p in props), props=len(props), graded=len(graded), bets=tally(bet_rows), model_sides=dict(tally(side_rows), hit=hit(side_rows)),
                   edge3=dict(tally(edge_rows), hit=hit(edge_rows), n=len(edge_rows)), by_market={mk: dict(tally([x for x in bet_rows if x['p']['market'] == mk]), label=LABEL[mk]) for mk in LABEL}, days=days)
    meta = dict(brand='tail.', sport='NFL', league='NFL', week=w, label=f'Week {w}', date=games[0]['date_et'], date_label=f"{dt.date.fromisoformat(games[0]['date_et']).strftime('%a %b %-d')} – {dt.date.fromisoformat(games[-1]['date_et']).strftime('%a %b %-d')}",
                model_version='v4.1 walk-forward backtest', source='reconstructed', source_note=LABEL_NOTE, posted_live=False,
                prices_et='Action Network, last stored pre-game price at each book', close_source='DraftKings closing line via ESPN', models={mk: MODEL_NAME[CHOSEN[mk]] for mk in CHOSEN}, books=list(BOOKS.values()), opener_book='Action Network opener',
                calibration=dict(k={mk: CAL[mk][CHOSEN[mk]]['k_by_week'].get(str(w), .5) for mk in CHOSEN}, note='Temperature on the log-odds, fit walk-forward on earlier 2026 weeks only.'),
                rules=['Validated market only (receptions, receiving yards).', 'Edge of 3+ points over the break-even of the best price, after dropping any book whose no-vig price sits more than 8 points from the others.',
                       'No out-of-distribution flag (fewer than 3 prior games, returning from absence, QB change, new QB, features outside the training range).', 'No bet above a 75% chance.', 'At most 15 bets, the largest edges, 1u each.'],
                not_applied=['Game-bootstrap interval test (bootstrap refits were not stored for past weeks)', 'Receivers-vs-QB team check', 'Reduced-Kelly staking (flat 1u instead)'],
                edge_rule='Edge = model chance minus the break-even of the best price, in points; an edge prop is 3+ points.',
                windows=[x for x in ['TNF', '1 PM', '4 PM', 'SNF', 'MNF', 'Sat'] if any(g['window'] == x for g in games)], n_games=len(games), n_props=len(props))
    pub = None
    if w == 8 and os.path.exists(os.path.join(DATA, 'nfl', '2026-wk08.json')):
        P8 = json.load(open(os.path.join(DATA, 'nfl', '2026-wk08.json'))); ix = json.load(open(os.path.join(DATA, 'index.json')))
        row = next((s for s in ix['slates'] if s['id'] == 'nfl-2026-wk08'), {})
        pub = dict(id='nfl-2026-wk08', path='data/nfl/2026-wk08.json', model_version=P8['meta'].get('model_version'), n_props=len(P8['props']),
                   bets=sum(1 for p in P8['props'] if p.get('classification') == 'recommended'), record=(row.get('results') or {}).get('bets'),
                   note='The slate actually posted for Week 8 (older v2.3 model, 44 props, partial board). History shows the richer walk-forward reconstruction; the posted slate stays under Slates.')
    meta['published'] = pub
    slate = dict(schema='wmtl.slate.v2', id=f'nfl-2026-wk{w:02d}-hist', sport='NFL', meta=meta, games=games, props=props, box=box,
                 parlays=dict(status='not_exported', items=[]),
                 results=dict(status='graded', source='nflverse box scores (work/player_games.parquet) and finals (work/games.parquet)', props=R, games=gres, summary=summary))
    path = os.path.join(OUT, f'2026-wk{w:02d}.json')
    json.dump(slate, open(path, 'w'), separators=(',', ':'), default=lambda o: o.item() if hasattr(o, 'item') else None)
    weeks_index.append(dict(week=w, id=slate['id'], path=f'data/nfl/history/2026-wk{w:02d}.json', label=f'Week {w}', source='reconstructed', posted_live=False,
                            start=games[0]['date_et'], end=games[-1]['date_et'], n_games=len(games), n_props=len(props), priced=summary['priced'],
                            bets=summary['bets'], model_sides=summary['model_sides'], edge3=summary['edge3'], days=days, published=pub and dict(id=pub['id'], bets=pub['bets'], record=pub['record'])))
    print(f'week {w}: games {len(games)} props {len(props)} priced {summary["priced"]} bets {summary["bets"]} sides {summary["model_sides"]["hit"]} edge3 n {summary["edge3"]["n"]} size {os.path.getsize(path)//1024}KB')

json.dump(dict(schema='wmtl.history.v1', season=2026, sport='NFL', built_utc=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), source_note=LABEL_NOTE,
               method=__doc__.strip(), weeks=weeks_index, live_weeks='Weeks with a posted slate (Week 9 onward) are read from data/index.json.'),
          open(os.path.join(OUT, 'index.json'), 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else None)
