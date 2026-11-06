/* Overlay UI v2 · "Stadium at night": sportsbook-native Home, Game screen and Player card.
   Reads the same data as the rest of the app (slate files, the week's prop board, the player library, defense-vs-position);
   every number shown is copied from those files or counted from game logs. Nothing here estimates anything. */
(function(){
const BOOKS = ['DK', 'FD', 'MGM', 'BR', 'CZR'], BOOKNAME = {DK: 'DraftKings', FD: 'FanDuel', MGM: 'BetMGM', BR: 'BetRivers', CZR: 'Caesars'};
const MKSTAT = {'Receptions': ['rec'], 'Receiving yards': ['rec_yds'], 'Rushing yards': ['rush_yds'], 'Carries': ['car'], 'Passing yards': ['pass_yds'], 'Completions': ['cmp'], 'Pass attempts': ['att'],
  'Passing TDs': ['pass_td'], 'Rush + rec yards': ['rush_yds', 'rec_yds'], 'Pass + rush yards': ['pass_yds', 'rush_yds'], 'Anytime TD': ['rec_td', 'rush_td']};
const MKDEF = {'Receptions': 'rec', 'Receiving yards': 'rec_yds', 'Rushing yards': 'rush_yds', 'Carries': 'carries', 'Passing yards': 'pass_yds', 'Completions': 'cmp', 'Pass attempts': 'att', 'Passing TDs': 'pass_td'};
const TABS2 = [['Popular', null], ['Passing', 'Passing'], ['Rushing', 'Rushing'], ['Receiving', 'Receiving'], ['Touchdowns', 'Touchdowns'], ['Defense & kicking', 'DK']];
const MODELMK = {'Receptions': 'receptions', 'Receiving yards': 'rec_yds', 'Rushing yards': 'rush_yds', 'Passing yards': 'pass_yds'};
let DEF = null; async function loadDef(){ if(DEF === null){ try{ DEF = await getJSON('data/nfl/defense_2026.json'); }catch(e){ DEF = false; } } return DEF; }
const odds = v => isNum(v) ? od(v) : '—';
const fmtSp = v => v === 0 ? 'PK' : (v > 0 ? '+' : '−') + ln(Math.abs(v));
async function weekSlates(){ const nfl = INDEX.slates.filter(s => s.sport === 'NFL').sort((a, b) => a.start_utc < b.start_utc ? 1 : -1); const wk = nfl[0] && nfl[0].week;
  const out = []; for(const s of nfl.filter(s => s.week === wk)){ try{ out.push(await loadSlate(s.id)); }catch(e){} } return out.sort((a, b) => (a.games[0] || {}).kick_utc < (b.games[0] || {}).kick_utc ? -1 : 1); }
async function weekBoard(ds){ const d = ds[0]; if(!d) return null; const yr = (d.meta.date || '2026').slice(0, 4), wk = String(d.meta.week || '').padStart(2, '0'); const path = `data/nfl/board-${yr}-wk${wk}.json`;
  if(!(path in BOARDS)){ try{ BOARDS[path] = await getJSON(path); }catch(e){ BOARDS[path] = null; } } return BOARDS[path]; }
function gameState(away, home){ return Object.values(LV.games).find(g => g.away === away && g.home === home) || null; }
function bestPrice(e, side){ let b = null; for(const k of BOOKS){ const o = (e.books || {})[k]; if(!o) continue; const v = side === 'yes' ? o.yes : o[side]; if(!isNum(v)) continue; if(!b || decOdds(v) > decOdds(b.v)) b = {k, v, line: o.line}; } return b; }
function mainLine(e){ const o = BOOKS.map(k => (e.books || {})[k]).find(x => x && isNum(x.line)); return o ? o.line : null; }
const priceBtn = (lab, b, cls = '') => b ? `<span class="x-odd ${cls}"><small>${esc(lab)}</small><b>${odds(b.v)}</b><i>${esc(b.k)}</i></span>` : `<span class="x-odd x-off"><small>${esc(lab)}</small><b>—</b></span>`;

/* ---------- Home */
window.viewHome2 = async function(){ const m = $('#main'); const ds = await weekSlates(); const B = await weekBoard(ds);
  const games = ds.flatMap(d => d.games.map(g => ({g, d}))).sort((a, b) => a.g.kick_utc < b.g.kick_utc ? -1 : 1);
  const bets = ds.flatMap(d => d.props.filter(p => p.tier === 'bet').map(p => ({p, d}))).sort((a, b) => (b.p.edge_pts || 0) - (a.p.edge_pts || 0));
  const tops = ds.flatMap(d => d.props.filter(p => !p.no_prediction && p.side && isNum(pSide(p)) && isNum(p.line) && p.tier !== 'bet').map(p => ({p, d}))).sort((a, b) => pSide(b.p) - pSide(a.p)).slice(0, 8);
  const wk = ds[0] ? ds[0].meta.week : '';
  const gameCard = ({g, d}) => { const st = gameState(g.away.abbr, g.home.abbr); const mk = g.market || {}; const live = st && st.state === 'in', fin = st && st.state === 'post';
    const sp = isNum(mk.spread_home) ? mk.spread_home : null;
    return `<button class="x-game ${live ? 'is-live' : ''}" data-game="${esc(g.id)}" data-sl="${esc(d.id)}"><div class="x-gtop">${live ? `<span class="x-live">Live</span> ${esc(st.detail)}` : fin ? 'Final' : `${esc(dayET(g.kick_utc).split(',')[0])} ${kickET(g.kick_utc).replace(' ET', '')}`}</div>
      <div class="x-team"><b>${esc(g.away.abbr)}</b><span>${st && st.state !== 'pre' ? st.as : isNum(sp) ? fmtSp(-sp) : ''}</span></div>
      <div class="x-team"><b>${esc(g.home.abbr)}</b><span>${st && st.state !== 'pre' ? st.hs : isNum(sp) ? fmtSp(sp) : ''}</span></div>
      <div class="x-gfoot">${isNum(mk.total) ? `O/U ${ln(mk.total)}` : ''}${d.props.filter(p => p.tier === 'bet' && (p.team === g.away.abbr || p.team === g.home.abbr)).length ? ` · <em>${d.props.filter(p => p.tier === 'bet' && (p.team === g.away.abbr || p.team === g.home.abbr)).length} bets</em>` : ''}</div></button>`; };
  const betCard = ({p, d}) => `<button class="x-bet" data-prop="${esc(p.id)}" data-sl="${esc(d.id)}"><div class="x-btop"><span class="x-tag gold">Bet</span><span>${esc(p.team)} vs ${esc(p.opp)}</span></div>
      <div class="x-bname">${esc(p.player)}</div><div class="x-bsel">${esc(selText(p))}</div>
      <div class="x-bfoot"><span class="x-price">${odds(p.odds)} <i>${esc(p.book || '')}</i></span><span class="x-chance">${pc(p.p ?? pSide(p))}</span></div>
      <div class="x-edge" style="--e:${Math.min(100, Math.max(0, (p.edge_pts || 0) * 5))}%"><span></span></div></button>`;
  const MK = [['Receptions', 'receptions'], ['Receiving yards', 'rec_yds'], ['Rushing yards', 'rush_yds'], ['Passing yards', 'pass_yds'], ['Anytime TD', null]];
  m.innerHTML = `<div class="view x-home">
    <div class="x-hero"><h1>Week ${esc(wk)}</h1><p>${games.length} games · ${bets.length} model bets · ${B ? B.games.reduce((a, g) => a + g.players.reduce((x, P) => x + P.n, 0), 0).toLocaleString() + ' props' : ''}</p></div>
    <div id="x-livehero-slot">${window.liveHeroHTML ? liveHeroHTML() : ''}</div>
    <div class="x-shelf"><div class="x-shead"><h2>Games</h2><button class="x-link" data-go="board">All games</button></div><div class="x-row">${games.map(gameCard).join('')}</div></div>
    ${bets.length ? `<div class="x-shelf"><div class="x-shead"><h2>Model bets</h2><button class="x-link" data-go="card">See all ${bets.length}</button></div><div class="x-row">${bets.slice(0, 10).map(betCard).join('')}</div></div>` : ''}
    <div class="x-shelf"><div class="x-shead"><h2>Browse props</h2></div><div class="x-chips">${MK.map(([l, k]) => `<button class="x-chip" data-mkt="${esc(l)}">${esc(l)}</button>`).join('')}<button class="x-chip" data-search>Find a player</button></div></div>
    ${tops.length ? `<div class="x-shelf"><div class="x-shead"><h2>Strongest model sides</h2></div><div class="x-list">${tops.map(({p, d}) => `<button class="x-li" data-prop="${esc(p.id)}" data-sl="${esc(d.id)}"><div><b>${esc(p.player)}</b><span>${esc(selText(p))} · ${esc(p.team)} vs ${esc(p.opp)}</span></div><div class="x-pct">${pc(pSide(p))}</div></button>`).join('')}</div></div>` : ''}
    <div class="x-shelf"><div class="x-shead"><h2>Slates</h2></div><div class="slates">${INDEX.slates.slice().sort((a, b) => a.start_utc < b.start_utc ? 1 : -1).map(slateCard).join('')}</div></div>
    <section class="sec"><div class="help"><b>Bet only what you can afford to lose.</b><span>If betting stops being fun, call or text 1-800-GAMBLER, any time.</span></div></section></div>`;
  $$('[data-game]', m).forEach(b => b.onclick = () => openGame(b.dataset.sl, b.dataset.game)); if(window.wireSB) wireSB(m);
  $$('[data-prop]', m).forEach(b => b.onclick = () => { const d = SLATE[b.dataset.sl]; if(d) openProp(d, b.dataset.prop); });
  $$('[data-slate]', m).forEach(b => b.onclick = () => setSlate(b.dataset.slate, 'card'));
  $$('[data-go]', m).forEach(b => b.onclick = () => { const s = ds.find(d => d.props.some(p => p.tier === 'bet')) || ds[ds.length - 1]; if(s) setSlate(s.id, b.dataset.go); });
  $$('[data-mkt]', m).forEach(b => b.onclick = () => openMarket(b.dataset.mkt));
  $$('[data-search]', m).forEach(b => b.onclick = openSearch); };

/* ---------- Market list (one market across the week, sorted by best model side) */
async function openMarket(mkt){ const ds = await weekSlates(); const B = await weekBoard(ds); if(!B) return toast('Prop board not available');
  const rows = []; for(const g of B.games) for(const P of g.players) for(const e of P.props) if(e.market === mkt) rows.push({g, P, e});
  rows.sort((a, b) => ((b.e.model && b.e.model.tier === 'bet') - (a.e.model && a.e.model.tier === 'bet')) || ((b.e.model && b.e.model.p) || 0) - ((a.e.model && a.e.model.p) || 0));
  pushSheet(mkt, `<div class="body"><div class="lt"><h1>${esc(mkt)}</h1><p>${rows.length} players this week. Best price across five books; model side where it has one.</p></div><div class="x-mkt">${rows.map(r => mktRow(r.g, r.P, r.e)).join('')}</div></div>`, el => wirePlayers(el)); }
function mktRow(g, P, e){ const md = e.model && !e.model.no_prediction ? e.model : null; const ln_ = mainLine(e);
  return `<div class="x-mrow" data-pl="${esc(P.name)}|${esc(P.team || '')}|${esc(e.market)}"><div class="x-mwho"><b>${esc(P.name)}</b><span>${esc(P.team || '')} ${esc(P.pos || '')} · ${esc(g.away)} @ ${esc(g.home)}</span>${md ? `<span class="x-model ${md.tier === 'bet' ? 'bet' : ''}">${md.tier === 'bet' ? 'Bet · ' : 'Model · '}${md.side === 'under' ? 'Under' : 'Over'} ${pc(md.p)} · proj ${ln(md.projection)}</span>` : ''}</div>
    <div class="x-mline">${e.kind === 'yes' ? priceBtn('Yes', bestPrice(e, 'yes')) : `${priceBtn('O ' + (isNum(ln_) ? ln(ln_) : ''), bestPrice(e, 'over'), md && md.side === 'over' ? 'pick' : '')}${priceBtn('U ' + (isNum(ln_) ? ln(ln_) : ''), bestPrice(e, 'under'), md && md.side === 'under' ? 'pick' : '')}`}</div></div>`; }
function wirePlayers(el){ $$('[data-pl]', el).forEach(b => b.onclick = () => { const [n, t, mk] = b.dataset.pl.split('|'); openCard(n, t, mk); }); }

/* ---------- Game screen */
window.openGame = async function(slId, gid){ const d = SLATE[slId] || await loadSlate(slId); const g = d.games.find(x => x.id === gid); if(!g) return; const ds = await weekSlates(); const B = await weekBoard(ds);
  const bg = B && B.games.find(x => x.away === g.away.abbr && x.home === g.home.abbr); const st = gameState(g.away.abbr, g.home.abbr); const mk = g.market || {};
  let tab = 'Popular';
  const draw = el => { const box = $('#x-gbody', el); const T = TABS2.find(t => t[0] === tab)[1]; const rows = [];
    if(bg) for(const P of bg.players) for(const e of P.props){ if(e.kind === 'ladder') continue; const pop = ['Passing yards', 'Rushing yards', 'Receiving yards', 'Receptions', 'Anytime TD'].includes(e.market);
      if(T === null ? pop : T === 'DK' ? ['Defense', 'Kicking'].includes(e.cat) : e.cat === T) rows.push({P, e}); }
    rows.sort((a, b) => a.e.market.localeCompare(b.e.market) || ((b.e.model && b.e.model.tier === 'bet') - (a.e.model && a.e.model.tier === 'bet')) || (mainLine(b.e) || 0) - (mainLine(a.e) || 0));
    const groups = {}; rows.forEach(r => (groups[r.e.market] = groups[r.e.market] || []).push(r));
    box.innerHTML = Object.keys(groups).length ? Object.entries(groups).map(([mkt, rs]) => `<div class="x-grp"><h3>${esc(mkt)}</h3>${rs.map(r => mktRow(bg, r.P, r.e)).join('')}</div>`).join('') : '<p class="sub">No props posted in this group.</p>';
    wirePlayers(box); $$('[data-gt]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.gt === tab)); };
  const html = `<div class="body"><div class="x-gh"><div class="x-gteams"><div><b>${esc(g.away.abbr)}</b><span>${st && st.state !== 'pre' ? st.as : ''}</span></div><i>@</i><div><b>${esc(g.home.abbr)}</b><span>${st && st.state !== 'pre' ? st.hs : ''}</span></div></div>
    <p>${st && st.state === 'in' ? `<span class="x-live">Live</span> ${esc(st.detail)}` : st && st.state === 'post' ? 'Final' : `${esc(dayET(g.kick_utc))} · ${kickET(g.kick_utc)}`}</p>
    <div class="x-lines"><div><small>Spread</small><b>${isNum(mk.spread_home) ? `${esc(g.home.abbr)} ${mk.spread_home > 0 ? '+' : ''}${ln(mk.spread_home)}` : '—'}</b></div><div><small>Total</small><b>${isNum(mk.total) ? ln(mk.total) : '—'}</b></div><div><small>Moneyline</small><b>${mk.moneyline ? `${odds(mk.moneyline.away)} / ${odds(mk.moneyline.home)}` : '—'}</b></div></div></div>
    <div class="x-tabs" role="tablist">${TABS2.map(([l]) => `<button data-gt="${esc(l)}" aria-pressed="${l === tab}">${esc(l)}</button>`).join('')}</div><div id="x-gbody"></div></div>`;
  pushSheet(`${g.away.abbr} @ ${g.home.abbr}`, html, el => { $$('[data-gt]', el).forEach(b => b.onclick = () => { tab = b.dataset.gt; draw(el); }); draw(el); }); };

window.__propsTab = function(el, bg){ let tab = 'Popular'; const host = $('#x-gbody', el);
  const draw = () => { const T = TABS2.find(t => t[0] === tab)[1]; const rows = [];
    if(bg) for(const P of bg.players) for(const e of P.props){ if(e.kind === 'ladder') continue; const pop = ['Passing yards', 'Rushing yards', 'Receiving yards', 'Receptions', 'Anytime TD'].includes(e.market);
      if(T === null ? pop : T === 'DK' ? ['Defense', 'Kicking'].includes(e.cat) : e.cat === T) rows.push({P, e}); }
    rows.sort((a, b) => a.e.market.localeCompare(b.e.market) || ((b.e.model && b.e.model.tier === 'bet') - (a.e.model && a.e.model.tier === 'bet')) || (mainLine(b.e) || 0) - (mainLine(a.e) || 0));
    const groups = {}; rows.forEach(r => (groups[r.e.market] = groups[r.e.market] || []).push(r));
    host.innerHTML = `<div class="x-sub">${TABS2.map(([l]) => `<button data-pt="${esc(l)}" aria-pressed="${l === tab}">${esc(l)}</button>`).join('')}</div>` + (Object.keys(groups).length ? Object.entries(groups).map(([mkt, rs]) => `<div class="x-grp"><h3>${esc(mkt)}</h3>${rs.map(r => mktRow(bg, r.P, r.e)).join('')}</div>`).join('') : '<p class="sub">No props posted in this group.</p>');
    wirePlayers(host); $$('[data-pt]', host).forEach(b => b.onclick = () => { tab = b.dataset.pt; draw(); }); };
  draw(); };
/* ---------- Player card */
window.openCard = async function(name, team, market){ const I = await loadPlayerIndex(); const k = nkey(name); const hit = I.players.find(r => nkey(r[1]) === k && (!team || r[2] === team)) || I.players.find(r => nkey(r[1]) === k);
  let P = null; if(hit){ try{ P = await getJSON(`data/nflp/p/${hit[0]}.json`); }catch(e){} }
  const ds = await weekSlates(); const B = await weekBoard(ds); await loadDef();
  let bg = null, bp = null; if(B) for(const g of B.games) for(const x of g.players) if(nkey(x.name) === k && (!team || x.team === team)){ bg = g; bp = x; }
  const props = bp ? bp.props.filter(e => e.kind !== 'ladder') : []; let sel = props.find(e => e.market === market) || props.find(e => MKSTAT[e.market]) || props[0];
  const opp = bg ? (bg.away === (P ? P.team : team) ? bg.home : bg.away) : null; const pos = P ? P.pos : bp && bp.pos;
  const games = P ? (P.last10 && P.last10.length ? P.last10 : (P.log || [])).slice(0, 10) : [];
  const draw = el => { const box = $('#x-cbody', el); box.innerHTML = cardBody(P, bp, sel, games, opp, pos, ds); $$('[data-cm]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.cm === (sel && sel.market)));
    $$('[data-prop]', box).forEach(b => b.onclick = () => { const d = ds.find(x => x.props.some(p => p.id === b.dataset.prop)); if(d) openProp(d, b.dataset.prop); });
    $$('[data-copy]', box).forEach(b => b.onclick = async () => { const t = b.dataset.copy; try{ await navigator.clipboard.writeText(t); }catch(e){} toast('Copied: ' + t); setTimeout(() => { location.href = b.dataset.url; }, 450); }); };
  const nm = P ? P.name : name; const html = `<div class="body"><div class="x-ch"><div><h1>${esc(nm)}</h1><p>${esc((P && P.team) || team || '')} · ${esc(pos || '')}${P && P.jersey ? ' · #' + esc(P.jersey) : ''}${opp ? ` · vs ${esc(opp)}` : ''}${bg ? ` · ${esc(bg.kick_et)}` : ''}</p>${P && P.injury && P.injury.status ? `<span class="x-tag red">${esc(P.injury.status)}</span>` : ''}</div></div>
    ${props.length ? `<div class="x-tabs scroll">${props.map(e => `<button data-cm="${esc(e.market)}" aria-pressed="${e === sel}">${esc(e.market)}</button>`).join('')}</div>` : ''}<div id="x-cbody"></div>
    ${P ? `<details class="x-more"><summary>Bio, season and career</summary><div class="group pad pgrid">${[['Age', P.age], ['Height', P.height_ft], ['Weight', P.weight ? P.weight + ' lb' : null], ['College', P.college], ['Experience', isNum(P.exp) ? (P.exp ? P.exp + ' yr' : 'Rookie') : null], ['Draft', P.draft ? `${P.draft.club} #${P.draft.pick}` : null]].filter(x => x[1] != null && x[1] !== '').map(([a, b]) => `<div><span class="label">${a}</span><b>${esc(b)}</b></div>`).join('')}</div>
      <h3 class="x-h3">2026 game log</h3>${statTable((P.log || []).map(r => ({...r, g: `${r.wk} ${r.ha === '@' ? '@' : 'vs'} ${r.opp}`})), [['g', 'Wk'], ['res', 'Result']])}<h3 class="x-h3">Career</h3>${statTable((P.career || []).map(r => ({...r, tm: r.team || ''})), [['season', 'Yr'], ['tm', 'Tm'], ['g', 'G']])}</details>` : ''}
    <p class="note">Stats: nflverse play-by-play. Prices: Action Network (five books). Matchup: 2026 defense vs position.</p></div>`;
  pushSheet(nm, html, el => { $$('[data-cm]', el).forEach(b => b.onclick = () => { sel = props.find(e => e.market === b.dataset.cm); draw(el); }); draw(el); }); };
window.openProfileByName = (n, t) => openCard(n, t);
window.openProfile = async pid => { const I = await loadPlayerIndex(); const r = I.players.find(x => x[0] === pid); if(r) openCard(r[1], r[2]); };

function statOf(g, keys){ let s = 0, any = false; for(const k of keys){ if(isNum(g[k])){ s += g[k]; any = true; } } return any ? s : 0; }
function cardBody(P, bp, e, games, opp, pos, ds){ if(!e) return `<p class="sub">No props posted for this player this week.</p>`;
  const keys = MKSTAT[e.market]; const line = mainLine(e); const md = e.model && !e.model.no_prediction ? e.model : null;
  const bo = e.kind === 'yes' ? bestPrice(e, 'yes') : bestPrice(e, 'over'), bu = e.kind === 'yes' ? null : bestPrice(e, 'under');
  let out = `<div class="x-sel"><div class="x-selh"><div><small>${esc(e.market)}</small><b>${e.kind === 'yes' ? 'To score' : isNum(line) ? ln(line) : '—'}</b></div>
    <div class="x-mline big">${e.kind === 'yes' ? priceBtn('Yes', bo) : `${priceBtn('Over', bo, md && md.side === 'over' ? 'pick' : '')}${priceBtn('Under', bu, md && md.side === 'under' ? 'pick' : '')}`}</div></div>
    ${md ? `<div class="x-take ${md.tier === 'bet' ? 'bet' : ''}" data-prop="${esc(md.prop)}"><div><small>${md.tier === 'bet' ? 'Model bet' : 'Model side'}</small><b>${md.side === 'under' ? 'Under' : 'Over'} ${ln(md.line)}</b></div><div><small>Chance</small><b>${pc(md.p)}</b></div><div><small>Projection</small><b>${ln(md.projection)}</b></div><div class="x-go">Report</div></div>` : e.model && e.model.no_prediction ? `<div class="x-take off"><b>No model prediction</b><small>${esc((e.model.flags || []).join(' · ') || 'outside what the model was trained on')}</small></div>` : ''}
    ${['FD', 'DK'].map(b => { const o = (e.books || {})[b]; if(!o) return ''; const side = md ? md.side : 'over'; const pr = e.kind === 'yes' ? o.yes : o[side]; const t = `${bp ? bp.name : ''} ${e.kind === 'yes' ? 'Yes' : (side === 'under' ? 'Under' : 'Over') + ' ' + ln(o.line)} ${e.market} · ${BOOKNAME[b]} ${odds(pr)}`;
      return `<button class="x-book ${b === 'FD' ? 'fd' : 'dk'}" data-copy="${esc(t)}" data-url="${b === 'FD' ? 'https://sportsbook.fanduel.com/' : 'https://sportsbook.draftkings.com/'}">Bet on ${BOOKNAME[b]} · ${e.kind === 'yes' ? '' : (side === 'under' ? 'U' : 'O') + ' ' + ln(o.line) + ' '}${odds(pr)}</button>`; }).join('')}</div>`;
  if(keys && games.length && (isNum(line) || e.kind === 'yes')){ const L = e.kind === 'yes' ? .5 : line; const vals = games.map(g => statOf(g, keys));
    const rate = n => { const v = vals.slice(0, n); return v.length ? v.filter(x => x > L).length / v.length : null; };
    const seasonV = (P.log || []).map(g => statOf(g, keys)); const sr = seasonV.length ? seasonV.filter(x => x > L).length / seasonV.length : null;
    const mx = Math.max(L * 1.6, ...vals, 1); const W = 300, H = 150, bw = W / 10;
    const bars = vals.slice().reverse().map((v, i) => { const h = Math.max(2, v / mx * (H - 22)); const g = games[games.length - 1 - i]; return `<g><rect x="${i * bw + 4}" y="${H - 18 - h}" width="${bw - 8}" height="${h}" rx="4" class="${v > L ? 'hi' : 'lo'}"/><text x="${i * bw + bw / 2}" y="${H - 22 - h}" class="v">${ln(v)}</text><text x="${i * bw + bw / 2}" y="${H - 4}" class="o">${esc(g.opp || '')}</text></g>`; }).join('');
    const ly = H - 18 - L / mx * (H - 22);
    out += `<div class="x-hit"><div class="x-rates">${[['Last 5', rate(5)], ['Last 10', rate(10)], ['2026', sr]].map(([l, r]) => `<div class="${r == null ? '' : r >= .6 ? 'good' : r <= .4 ? 'bad' : ''}"><small>${l}</small><b>${r == null ? '—' : pc(r)}</b></div>`).join('')}</div>
      <svg class="x-chart" viewBox="0 0 ${W + 40} ${H}" role="img" aria-label="Last ${vals.length} games against the line">${bars}<line x1="0" x2="${W + 4}" y1="${ly}" y2="${ly}" class="ln"/><text x="${W + 8}" y="${ly + 4}" class="lt" style="text-anchor:start">${e.kind === 'yes' ? 'scored' : ln(L)}</text></svg>
      <p class="note">${e.kind === 'yes' ? 'Touchdowns' : esc(e.market)} in his last ${vals.length} games, newest on the right. Green cleared ${e.kind === 'yes' ? 'zero (scored)' : 'the line of ' + ln(L)}.</p></div>`; }
  const dk = MKDEF[e.market]; const D = DEF && opp && DEF.teams && DEF.teams[opp]; const pg = pos === 'QB' ? 'QB' : ['WR', 'TE', 'RB'].includes(pos) ? pos : null;
  if(D && pg && dk && D[pg] && D[pg][dk]){ const x = D[pg][dk]; const lg = DEF.league && DEF.league[pg] && DEF.league[pg][dk];
    const tone = x.rank <= 8 ? 'good' : x.rank >= 25 ? 'bad' : ''; out += `<div class="x-match ${tone}"><div><small>Matchup</small><b>${esc(opp)} vs ${pg}s</b><span>${esc(e.market.toLowerCase())} allowed per game</span></div>
      <div class="x-rank"><b>${ln(x.pg)}</b><span>${x.rank}${['th', 'st', 'nd', 'rd'][(x.rank % 100 > 10 && x.rank % 100 < 14) ? 0 : Math.min(x.rank % 10, 4) % 4] || 'th'} most</span></div>
      <div class="x-mm">${isNum(x.last4) ? `<span>Last 4: <b>${ln(x.last4)}</b></span>` : ''}${isNum(lg) ? `<span>League: <b>${ln(lg)}</b></span>` : ''}</div></div>`; }
  else if(opp && dk && pg) out += `<div class="x-match off"><small>Matchup data for ${esc(opp)} is not available yet.</small></div>`;
  out += `<div class="x-books"><h3 class="x-h3">Every book</h3>${BOOKS.filter(k => (e.books || {})[k]).map(k => { const o = e.books[k]; return `<div class="x-brow"><span>${BOOKNAME[k]}</span><span>${e.kind === 'yes' ? '' : ln(o.line)}</span><span class="x-odd sm">${e.kind === 'yes' ? odds(o.yes) : 'O ' + odds(o.over)}</span>${e.kind === 'yes' ? '' : `<span class="x-odd sm">U ${odds(o.under)}</span>`}</div>`; }).join('')}${(e.books || {}).Open ? `<div class="x-brow open"><span>Opened</span><span>${e.kind === 'yes' ? '' : ln(e.books.Open.line)}</span><span>${e.kind === 'yes' ? odds(e.books.Open.yes) : 'O ' + odds(e.books.Open.over)}</span>${e.kind === 'yes' ? '' : `<span>U ${odds(e.books.Open.under)}</span>`}</div>` : ''}</div>`;
  return out; }
})();

/* ===================== v2 information architecture: Live Now, Players, game screen with Picks / Live / Props / Players ===================== */
(function(){
const findGame = (away, home) => { for(const d of Object.values(SLATE)){ if(!d || d.sport !== 'NFL') continue; const g = d.games.find(x => x.away.abbr === away && x.home.abbr === home); if(g) return {d, g}; } return null; };
const scoreBox = (st, big) => { const live = st.state === 'in', fin = st.state === 'post'; const win = (a, b) => fin && a > b ? 'w' : '';
  return `<button class="x-sb ${big ? 'big' : ''} ${live ? 'live' : ''}" data-sbg="${esc(st.away)}|${esc(st.home)}"><div class="x-sbtop">${live ? `<span class="x-live">Live</span>${esc(st.detail)}` : fin ? 'Final' : esc(st.detail || '')}</div>
    <div class="x-sbrow ${win(st.as, st.hs)}"><b>${esc(st.away)}</b><span>${st.state === 'pre' ? '' : st.as}</span></div><div class="x-sbrow ${win(st.hs, st.as)}"><b>${esc(st.home)}</b><span>${st.state === 'pre' ? '' : st.hs}</span></div>
    ${big ? `<div class="x-sbfoot">Picks · Live · Props · Players</div>` : ''}</button>`; };
const wireSB = root => $$('[data-sbg]', root).forEach(b => b.onclick = () => { const [a, h] = b.dataset.sbg.split('|'); const f = findGame(a, h); if(f) openGame(f.d.id, f.g.id); else toast(`${a} @ ${h} is not on a modeled slate`); });
window.onLiveTick = () => { if(window._gameTick) window._gameTick(); if(S.tab === 'lobby'){ const h = $('#x-livehero-slot'); if(h){ h.innerHTML = liveHeroHTML(); wireSB(h); } } if(S.tab === 'live' && window.viewLiveNow2) viewLiveNow2(); };
window.liveHeroHTML = () => { const L = Object.values(LV.games).filter(g => g.state === 'in'); return L.length ? `<div class="x-shelf"><div class="x-shead"><h2>Live now</h2></div><div class="x-livehero">${L.map(st => scoreBox(st, true)).join('')}</div></div>` : ''; };
window.wireSB = wireSB;
window.viewLiveNow2 = async function(){ const m = $('#main'); const draw = () => { if(S.tab !== 'live') return; const G = Object.values(LV.games);
    const live = G.filter(g => g.state === 'in'), pre = G.filter(g => g.state === 'pre'), fin = G.filter(g => g.state === 'post');
    m.innerHTML = `<div class="view"><div class="x-hero"><h1>Live now</h1><p>${live.length ? `${live.length} game${live.length > 1 ? 's' : ''} in progress · updates every 15 seconds` : 'No NFL game is in progress right now.'}</p></div>
      ${live.length ? `<div class="x-livehero">${live.map(st => scoreBox(st, true)).join('')}</div>` : ''}
      ${pre.length ? `<div class="x-shelf"><div class="x-shead"><h2>Coming up</h2></div><div class="x-sbgrid">${pre.map(st => scoreBox(st)).join('')}</div></div>` : ''}
      ${fin.length ? `<div class="x-shelf"><div class="x-shead"><h2>Final</h2></div><div class="x-sbgrid">${fin.map(st => scoreBox(st)).join('')}</div></div>` : ''}
      ${!G.length ? '<p class="sub">Loading scores…</p>' : ''}</div>`; wireSB(m); };
  draw(); };
window.viewPlayers2 = async function(){ const m = $('#main'); const I = await loadPlayerIndex(); let T = {}; try{ T = await getJSON('data/nflp/teams.json'); }catch(e){}
  m.innerHTML = `<div class="view"><div class="x-hero"><h1>Players</h1><p>${I.players.length.toLocaleString()} players on every 2026 roster. Tap a team or search.</p></div>
    <div class="fld search"><label for="pq2" class="sr">Search players</label>${Icon.svg('search', {size: 18})}<input id="pq2" type="search" autocomplete="off" placeholder="Search any player"></div><div id="pres" class="x-list" style="margin-top:10px"></div>
    <div class="x-shelf"><div class="x-shead"><h2>Teams</h2></div><div class="x-teams">${Object.keys(T).sort().map(t => `<button class="x-chip" data-team="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>
    <div class="x-shelf"><button class="x-link" data-more>Settings, how the model works, results</button></div></div>`;
  const out = $('#pres', m), inp = $('#pq2', m); const show = rows => { out.innerHTML = rows.map(p => `<button class="x-li" data-pid="${esc(p[0])}"><div><b>${esc(p[1])}</b><span>${esc(p[2] || 'FA')} · ${esc(p[3] || '')}${p[4] ? ' · #' + esc(p[4]) : ''}${p[5] && p[5] !== 'ACT' ? ' · ' + esc(p[5]) : ''}</span></div><div>${ICON.chev}</div></button>`).join(''); $$('[data-pid]', out).forEach(b => b.onclick = () => openProfile(b.dataset.pid)); };
  inp.oninput = () => { const q = nkey(inp.value); show(q.length < 2 ? [] : I.players.filter(p => nkey(p[1]).includes(q)).slice(0, 40)); };
  $$('[data-team]', m).forEach(b => b.onclick = () => { const t = b.dataset.team; const ids = new Set((T[t] || {}).roster || []); show(I.players.filter(p => ids.has(p[0]) || p[2] === t)); out.scrollIntoView({behavior: 'smooth', block: 'start'}); });
  $('[data-more]', m).onclick = () => go('more'); };
/* game screen v2: solid scoreboard + Picks / Live / Props / Players */
const _old = window.openGame;
window.openGame = async function(slId, gid){ const d = SLATE[slId] || await loadSlate(slId); const g = d.games.find(x => x.id === gid); if(!g) return;
  const yr = (d.meta.date || '2026').slice(0, 4), wk = String(d.meta.week || '').padStart(2, '0'); const path = `data/nfl/board-${yr}-wk${wk}.json`;
  if(!(path in BOARDS)){ try{ BOARDS[path] = await getJSON(path); }catch(e){ BOARDS[path] = null; } } const B = BOARDS[path]; const bg = B && B.games.find(x => x.away === g.away.abbr && x.home === g.home.abbr);
  const tms = [g.away.abbr, g.home.abbr]; const ps = d.props.filter(p => tms.includes(p.team)); let tab = 'Picks'; const mk = g.market || {};
  const head = () => { const st = Object.values(LV.games).find(x => x.away === g.away.abbr && x.home === g.home.abbr) || {state: 'pre', away: g.away.abbr, home: g.home.abbr, as: '', hs: '', detail: `${dayET(g.kick_utc)} · ${kickET(g.kick_utc)}`};
    return `<div class="x-board ${st.state === 'in' ? 'live' : ''}"><div class="x-bt">${st.state === 'in' ? `<span class="x-live">Live</span>${esc(st.detail)}` : st.state === 'post' ? 'Final' : esc(st.detail)}</div>
      <div class="x-bteams"><div><b>${esc(g.away.abbr)}</b><span>${st.state === 'pre' ? '' : st.as}</span></div><i>@</i><div><span>${st.state === 'pre' ? '' : st.hs}</span><b>${esc(g.home.abbr)}</b></div></div>
      <div class="x-lines"><div><small>Spread</small><b>${isNum(mk.spread_home) ? `${esc(g.home.abbr)} ${mk.spread_home > 0 ? '+' : ''}${ln(mk.spread_home)}` : '—'}</b></div><div><small>Total</small><b>${isNum(mk.total) ? ln(mk.total) : '—'}</b></div><div><small>Moneyline</small><b>${mk.moneyline ? `${od(mk.moneyline.away)} / ${od(mk.moneyline.home)}` : '—'}</b></div></div></div>`; };
  const body = el => { const box = $('#x-gb', el); $$('[data-gt2]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.gt2 === tab));
    if(tab === 'Picks'){ const bets = ps.filter(p => p.tier === 'bet').sort((a, b) => (b.edge_pts || 0) - (a.edge_pts || 0)); const sides = ps.filter(p => p.tier !== 'bet' && !p.no_prediction && p.side && isNum(pSide(p)) && isNum(p.line)).sort((a, b) => pSide(b) - pSide(a));
      box.innerHTML = `${bets.length ? `<h3 class="x-h3">Model bets</h3><div class="cardlist">${bets.map(p => ticket(p, d)).join('')}</div>` : '<div class="x-take off"><b>No priced model bets in this game</b><small>The strongest model sides are below.</small></div>'}
        <h3 class="x-h3">Model side on every prop</h3><div class="info" style="padding:0">${sides.map(p => sideRow(p, d)).join('')}</div>`; bindTaps(box, d); applyProgress(box, d); }
    else if(tab === 'Live'){ box.innerHTML = `${liveNowHTML(d, {away: g.away.abbr, home: g.home.abbr})}<h3 class="x-h3">Checkpoint plans</h3>${(window.watchPlansHTML ? watchPlansHTML({...d, props: ps}) : '') || '<p class="sub">No checkpoint plans for this game.</p>'}`; bindTaps(box, d); applyProgress(box, d); }
    else if(tab === 'Props'){ box.innerHTML = '<div id="x-gbody"></div>'; window.__propsTab(el, bg); }
    else { const by = {}; if(bg) for(const P of bg.players) (by[P.team] = by[P.team] || []).push(P);
      box.innerHTML = Object.entries(by).map(([t, L]) => `<h3 class="x-h3">${esc(t)}</h3><div class="x-list">${L.map(P => `<button class="x-li" data-pl="${esc(P.name)}|${esc(P.team || '')}|"><div><b>${esc(P.name)}</b><span>${esc(P.pos || '')} · ${P.n} props</span></div><div>${ICON.chev}</div></button>`).join('')}</div>`).join('') || '<p class="sub">No player props posted for this game yet.</p>';
      $$('[data-pl]', box).forEach(b => b.onclick = () => { const [n, t] = b.dataset.pl.split('|'); openCard(n, t); }); } };
  const html = `<div class="body"><div id="x-ghead">${head()}</div><div class="x-tabs" role="tablist">${['Picks', 'Live', 'Props', 'Players'].map(l => `<button data-gt2="${l}" aria-pressed="${l === tab}">${l}</button>`).join('')}</div><div id="x-gb"></div></div>`;
  pushSheet(`${g.away.abbr} @ ${g.home.abbr}`, html, el => { $$('[data-gt2]', el).forEach(b => b.onclick = () => { tab = b.dataset.gt2; body(el); }); body(el);
    window._gameTick = () => { if(!document.body.contains(el)){ window._gameTick = null; return; } $('#x-ghead', el).innerHTML = head(); if(tab === 'Live' || tab === 'Picks') body(el); }; }); };
})();
