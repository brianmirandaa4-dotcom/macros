/* tail. History · the slate time machine, the player card's "Now vs line", and the game-detail sheet behind every past game.
   Reads only data files: data/nfl/history/*.json (Weeks 1–8, reconstructed from the model's leak-free walk-forward backtest),
   the posted slates in data/index.json (Week 9 onward), the player library and the live ESPN state the app already polls (LV).
   Every number is copied from those files or counted from them; nothing here estimates a stat, a line or a price. */
(function(){
'use strict';
const HROOT = 'data/nfl/history/';
const REC_NOTE = "Reconstructed from the model's walk-forward backtest (predictions made with data available before kickoff)";
const MKW = {receptions: 'rec', rec_yds: 'rec yds', rush_yds: 'rush yds', pass_yds: 'pass yds', qb_rush: 'rush yds', atd: 'TD', qb_atd: 'TD'};
const MKL = {receptions: 'Receptions', rec_yds: 'Receiving yards', rush_yds: 'Rushing yards', pass_yds: 'Passing yards', qb_rush: 'QB rushing yards', atd: 'Anytime TD', qb_atd: 'Anytime TD'};
const LOGKEY = {receptions: ['rec'], rec_yds: ['rec_yds'], rush_yds: ['rush_yds'], qb_rush: ['rush_yds'], pass_yds: ['pass_yds'], atd: ['rec_td', 'rush_td'], qb_atd: ['rush_td']};
/* the player card's market names -> live ESPN stat keys (LV.stats) and the in-game model's market */
const CARDLIVE = {'Receptions': ['receptions'], 'Receiving yards': ['rec_yds'], 'Rushing yards': ['rush_yds'], 'Passing yards': ['pass_yds'], 'Carries': ['car'], 'Completions': ['cmp'], 'Pass attempts': ['att'],
  'Rush + rec yards': ['rush_yds', 'rec_yds'], 'Pass + rush yards': ['pass_yds', 'rush_yds']};
const CARDMODEL = {'Receptions': 'receptions', 'Receiving yards': 'rec_yds', 'Rushing yards': 'rush_yds', 'Passing yards': 'pass_yds'};
const BOOKFULL = {DK: 'DraftKings', FD: 'FanDuel', MGM: 'BetMGM', BR: 'BetRivers', CZR: 'Caesars'};
const etDate = iso => { try{ return new Date(iso).toLocaleDateString('en-CA', {timeZone: 'America/New_York'}); }catch(e){ return String(iso).slice(0, 10); } };
const dlab = (ymd, o) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', o || {weekday: 'short', month: 'short', day: 'numeric'});
const U = x => isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + 'u' : '—';
const U1 = x => isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1) + 'u' : '—';
const tone = x => isNum(x) ? (x > 0 ? 'up' : x < 0 ? 'dn' : '') : '';
const num = x => isNum(x) ? (Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toString()) : '—';
const decO = o => o > 0 ? 1 + o / 100 : 1 + 100 / -o;

/* ================================================================ data */
const H = {idx: null, wk: {}, lib: {}};
async function hIndex(){ if(!H.idx){ try{ H.idx = await getJSON(HROOT + 'index.json'); }catch(e){ H.idx = {weeks: []}; } } return H.idx; }
async function hWeek(w){ const row = (await hIndex()).weeks.find(x => x.week === w); if(!row) return null;
  if(!H.wk[w]){ try{ const d = await getJSON(row.path); d.gmap = {}; d.games.forEach(g => d.gmap[g.id] = g); H.wk[w] = d; }catch(e){ H.wk[w] = null; } } return H.wk[w]; }
async function lib(pid){ if(!(pid in H.lib)){ try{ H.lib[pid] = await getJSON(`data/nflp/p/${pid}.json`); }catch(e){ H.lib[pid] = null; } } return H.lib[pid]; }
const pidOf = p => p.pid || ((String(p.id).match(/(00-\d{7})/) || [])[1]) || null;
const liveSlates = () => (INDEX && INDEX.slates || []).filter(s => s.sport === 'NFL' && !s.imported);

/* one list of slate "sources": reconstructed weeks (history files) and posted slates (data/index.json), with ET days */
async function sources(){ const I = await hIndex(); const out = [];
  const recW = new Set(I.weeks.map(w => w.week));
  for(const w of I.weeks) out.push({kind: 'rec', week: w.week, label: w.label, id: w.id, days: w.days, row: w});
  for(const s of liveSlates()){ if(recW.has(s.week)) continue;                 // a reconstructed week replaces its thinner posted slate in the calendar
    const days = {}; const a = etDate(s.start_utc), b = etDate(s.end_utc); const r = s.results && s.results.status === 'graded' ? s.results.bets : null;
    days[a] = {games: s.n_games || null, bets: r, slate: s.id}; if(b !== a) days[b] = {games: null, bets: null, slate: s.id};
    out.push({kind: 'live', week: s.week, label: s.label, id: s.id, days, row: s}); }
  return out; }
/* load one source as a slate-shaped object: {games, props, results, meta, kind} */
async function loadSrc(src){ if(src.kind === 'rec'){ const d = await hWeek(src.week); return d && Object.assign(d, {kind: 'rec'}); }
  const d = await loadSlate(src.id); d.kind = 'live'; return d; }
const resOf = (d, p) => (d.results && d.results.props && d.results.props[p.id]) || null;
const finalOf = (d, g) => { const r = d.results && d.results.games && d.results.games[g.id]; if(r && r.final && isNum(r.final.home)) return r.final;
  const st = Object.values(LV.games || {}).find(x => x.away === g.away.abbr && x.home === g.home.abbr); return st && st.state === 'post' ? {away: st.as, home: st.hs, live: 1} : null; };
const isEdge = p => isNum(p.edge_pts) && p.edge_pts >= 3;
const stakeOf = p => p.tier === 'bet' && isNum(p.units) && p.units > 0 ? p.units : 1;
function settle(d, p){ const r = resOf(d, p); if(!r || !r.result || !isNum(p.odds)) return null; const s = stakeOf(p);
  const u = r.result === 'won' ? s * (decO(p.odds) - 1) : r.result === 'lost' ? -s : 0; return {result: r.result, actual: r.actual, stake: s, units: u}; }
function tallyP(d, ps){ let w = 0, l = 0, pu = 0, units = 0, risk = 0, n = 0;
  for(const p of ps){ const x = settle(d, p); if(!x) continue; n++; if(x.result === 'won') w++; else if(x.result === 'lost') l++; else if(x.result === 'push') pu++;
    units += x.units; if(x.result === 'won' || x.result === 'lost') risk += x.stake; }
  return {w, l, p: pu, n, units, risk, roi: risk ? units / risk : null, hit: (w + l) ? w / (w + l) : null}; }
const sideProps = d => d.props.filter(p => !p.no_prediction && p.side && isNum(p.line) && isNum(p.odds));
const gameProps = (d, g) => d.props.filter(p => p.gid === g.id || (!p.gid && (p.team === g.away.abbr || p.team === g.home.abbr)));
const gameDay = g => g.date_et || etDate(g.kick_utc);

/* ================================================================ shared bits */
const tiles = arr => `<div class="hs-tiles">${arr.map(([l, v, c, s]) => `<div class="hs-tile ${c || ''}"><small>${esc(l)}</small><b>${v}</b>${s ? `<span>${s}</span>` : ''}</div>`).join('')}</div>`;
const srcBadge = kind => kind === 'rec' ? `<span class="hs-badge rec">Reconstructed</span>` : `<span class="hs-badge live">Posted live</span>`;
const srcNote = kind => kind === 'rec' ? `<p class="hs-src">${esc(REC_NOTE)}. Not picks posted live.</p>` : `<p class="hs-src">Posted live in the app before kickoff.</p>`;
const resWord = r => ({won: 'Won', lost: 'Lost', push: 'Push', void: 'Void'}[r] || 'Pending');
function selOf(p){ if(p.market === 'atd' || p.market === 'qb_atd') return 'Anytime TD'; return `${p.side === 'under' ? 'Under' : 'Over'} ${ln(p.line)} ${MKW[p.market] || p.market_label || ''}`; }
function margin(p, actual){ if(!isNum(actual) || !isNum(p.line)) return ''; const d = Math.round(Math.abs(actual - p.line) * 10) / 10;
  if(actual === p.line) return 'landed on the line'; const cleared = p.side === 'under' ? actual < p.line : actual > p.line; return `${cleared ? 'cleared by' : 'missed by'} ${num(d)}`; }
function resultCell(d, p){ const x = settle(d, p); const r = resOf(d, p);
  if(!x) return `<div class="hs-res"><span class="hs-rt pend">${r && isNum(r.actual) ? num(r.actual) + ' · ' : ''}Pending</span></div>`;
  return `<div class="hs-res ${x.result}"><span class="hs-rt">${resWord(x.result)}</span><b>${U(x.units)}</b></div>`; }

/* ================================================================ FEATURE 2 · History sheet */
let ST = {month: null, day: null, week: null};
async function openHistory(opts = {}){ const src = await sources(); const I = await hIndex();
  const dayMap = {}; for(const s of src) for(const [k, v] of Object.entries(s.days || {})) dayMap[k] = Object.assign({src: s}, v);
  const allDays = Object.keys(dayMap).sort(); if(!allDays.length){ toast('History not available'); return; }
  const today = etDate(new Date().toISOString());
  const pastDays = allDays.filter(k => k <= today);
  if(!ST.day || !dayMap[ST.day]) ST.day = opts.day || mainDay(src.filter(s_ => s_.kind === 'rec').slice(-1)[0]) || pastDays.slice(-1)[0] || allDays[0];
  if(opts.week){ ST.day = mainDay(src.find(s => s.week === opts.week)) || ST.day; }
  ST.month = ST.day.slice(0, 7); ST.week = dayMap[ST.day].src.week;
  /* season tiles: reconstructed weeks plus any graded posted slate (ungraded slates count nothing) */
  const S = I.weeks.reduce((a, w) => { a.w += w.bets.w; a.l += w.bets.l; a.p += w.bets.p; a.u += w.bets.units; a.r += w.bets.risked; a.sw += w.model_sides.w; a.sl += w.model_sides.l; return a; }, {w: 0, l: 0, p: 0, u: 0, r: 0, sw: 0, sl: 0});
  const weeks = [...new Set(src.map(s => s.week))].sort((a, b) => a - b);
  const html = `<div class="body hs">
    <div class="lt"><h1>History</h1><p>Every 2026 NFL slate, graded against the box score. Tap a day, a game, then a prop.</p></div>
    <section class="hs-sec">${tiles([['Bets', `${S.w}–${S.l}${S.p ? '–' + S.p : ''}`, '', `Weeks ${I.weeks[0].week}–${I.weeks[I.weeks.length - 1].week}`], ['Units', U1(S.u), tone(S.u), 'flat 1u'], ['ROI', S.r ? pc(S.u / S.r, 1) : '—', tone(S.u), `${S.r} risked`], ['Sides hit', S.sw + S.sl ? pc(S.sw / (S.sw + S.sl), 1) : '—', '', `${(S.sw + S.sl).toLocaleString()} props`]])}
      <p class="hs-src">Weeks ${I.weeks[0].week}–${I.weeks[I.weeks.length - 1].week}: ${esc(REC_NOTE)}. Never picks posted live. Week 9 onward: slates posted live in the app.</p></section>
    <div class="hs-weeks" role="tablist" aria-label="Weeks">${weeks.map(w => { const s = src.find(x => x.week === w); const r = s.kind === 'rec' ? s.row.bets : (s.row.results && s.row.results.status === 'graded' ? s.row.results.bets : null);
      return `<button class="hs-wk" data-wk="${w}" role="tab"><b>Week ${w}</b><span class="${r && (r.w + r.l) ? tone(r.units) : ''}">${r && (r.w + r.l) ? `${r.w}–${r.l} · ${U1(r.units)}` : s.kind === 'live' ? 'Posted' : '0 bets'}</span></button>`; }).join('')}</div>
    <section class="hs-cal" id="hs-cal"></section>
    <section id="hs-day" class="hs-day" aria-live="polite"></section></div>`;
  pushSheet('History', html, el => {
    const drawCal = () => { $('#hs-cal', el).innerHTML = calHTML(ST.month, dayMap, today);
      $$('[data-day]', el).forEach(b => b.onclick = () => { ST.day = b.dataset.day; ST.week = dayMap[ST.day].src.week; sync(); drawDay(); });
      $$('[data-mon]', el).forEach(b => b.onclick = () => { ST.month = b.dataset.mon; drawCal(); }); };
    const sync = () => { $$('[data-wk]', el).forEach(b => { const on = +b.dataset.wk === ST.week; b.setAttribute('aria-selected', on); if(on){ const r = b.parentElement; r.scrollLeft = Math.max(0, b.offsetLeft - (r.clientWidth - b.offsetWidth) / 2); } });
      $$('[data-day]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.day === ST.day)); };
    const drawDay = async () => { const box = $('#hs-day', el); box.innerHTML = '<p class="sub">Loading…</p>'; const info = dayMap[ST.day]; const d = await loadSrc(info.src).catch(() => null);
      if(!d){ box.innerHTML = '<p class="sub">This slate could not be loaded.</p>'; return; } box.innerHTML = dayHTML(d, info.src, ST.day); wireDay(box, d, info.src); };
    $$('[data-wk]', el).forEach(b => b.onclick = () => { const s = src.find(x => x.week === +b.dataset.wk); const k = mainDay(s); if(!k) return; ST.day = k; ST.week = s.week; ST.month = k.slice(0, 7); drawCal(); sync(); drawDay(); });
    drawCal(); sync(); drawDay(); }); }
function mainDay(s){ if(!s) return null; const e = Object.entries(s.days || {}); if(!e.length) return null; return e.sort((a, b) => ((b[1].games || 0) - (a[1].games || 0)) || (a[0] < b[0] ? -1 : 1))[0][0]; }
function calHTML(month, dayMap, today){ const [y, m] = month.split('-').map(Number); const first = new Date(y, m - 1, 1), n = new Date(y, m, 0).getDate(), lead = first.getDay();
  const months = [...new Set(Object.keys(dayMap).map(k => k.slice(0, 7)))].sort(); const i = months.indexOf(month);
  const cells = []; for(let k = 0; k < lead; k++) cells.push('<span class="hs-c empty" aria-hidden="true"></span>');
  for(let dd = 1; dd <= n; dd++){ const key = `${month}-${String(dd).padStart(2, '0')}`; const info = dayMap[key];
    if(!info){ cells.push(`<span class="hs-c${key === today ? ' today' : ''}"><i>${dd}</i></span>`); continue; }
    const r = info.bets, graded = r && isNum(r.units); const tn = graded && (r.w + r.l) ? tone(r.units) : '';
    const sub = graded ? `<em>${r.w}–${r.l}</em><em class="${tn}">${(r.w + r.l + (r.p || 0)) ? U1(r.units) : ' '}</em>` : `<em class="pend">${key > today ? 'Soon' : key === today ? 'Today' : 'Open'}</em>`;
    cells.push(`<button class="hs-c on ${tn}${key === today ? ' today' : ''}" data-day="${key}" aria-label="${esc(dlab(key, {weekday: 'long', month: 'long', day: 'numeric'}))}${graded ? `, ${r.w} won ${r.l} lost, ${U1(r.units)}` : ''}"><i>${dd}</i><s class="dot ${tn}${info.src.kind === 'live' ? ' live' : ''}"></s>${sub}</button>`); }
  return `<div class="hs-calh"><button class="hs-nav" ${i > 0 ? `data-mon="${months[i - 1]}"` : 'disabled'} aria-label="Previous month"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
    <h2>${esc(first.toLocaleDateString('en-US', {month: 'long', year: 'numeric'}))}</h2><button class="hs-nav" ${i >= 0 && i < months.length - 1 ? `data-mon="${months[i + 1]}"` : 'disabled'} aria-label="Next month"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>
    <div class="hs-dow" aria-hidden="true">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<span>${x}</span>`).join('')}</div><div class="hs-grid">${cells.join('')}</div>
    <div class="hs-leg"><span><s class="dot up"></s>Up</span><span><s class="dot dn"></s>Down</span><span><s class="dot"></s>Even or no bets</span><span><s class="dot live"></s>Posted live</span></div>`; }
function dayHTML(d, src, day){ const games = d.games.filter(g => gameDay(g) === day).sort((a, b) => a.kick_utc < b.kick_utc ? -1 : 1);
  const ps = d.props.filter(p => games.some(g => p.gid === g.id || (!p.gid && (p.team === g.away.abbr || p.team === g.home.abbr))));
  const bets = ps.filter(p => p.tier === 'bet'); const B = tallyP(d, bets), Sd = tallyP(d, sideProps({props: ps}));
  const graded = d.results && d.results.status === 'graded';
  const pub = d.meta && d.meta.published;
  return `<div class="hs-dayh"><div><h2>${esc(dlab(day, {weekday: 'long', month: 'short', day: 'numeric'}))}</h2><p>Week ${esc(d.meta.week)} · ${games.length} game${games.length === 1 ? '' : 's'}</p></div>${srcBadge(src.kind)}</div>
    ${tiles([['Bets', `${B.w}–${B.l}${B.p ? '–' + B.p : ''}`, '', `${bets.length} bet${bets.length === 1 ? '' : 's'}`], ['Units', graded || B.n ? U(B.units) : '—', tone(B.units), B.risk ? `${num(B.risk)}u risked` : ''], ['ROI', B.roi == null ? '—' : pc(B.roi, 1), tone(B.units)], ['Sides hit', Sd.hit == null ? '—' : pc(Sd.hit, 1), '', `${Sd.w + Sd.l} graded`]])}
    ${srcNote(src.kind)}
    ${pub ? `<button class="hs-pub" data-pub="${esc(pub.id)}"><div><b>Posted live this week</b><span>${esc(pub.model_version || '')} · ${pub.n_props} props · ${pub.bets} bet${pub.bets === 1 ? '' : 's'}${pub.record && (pub.record.w + pub.record.l) ? ` · ${pub.record.w}–${pub.record.l}` : ''}</span></div>${ICON.chev}</button>` : ''}
    <div class="hs-games">${games.map(g => gameRow(d, g)).join('') || '<p class="sub">No games on this day.</p>'}</div>`; }
function gameRow(d, g){ const f = finalOf(d, g); const ps = gameProps(d, g); const bets = ps.filter(p => p.tier === 'bet'); const T = tallyP(d, bets); const ne = ps.filter(p => p.tier !== 'bet' && isEdge(p)).length;
  const w = (a, b) => f && a > b ? ' w' : '';
  return `<button class="hs-g" data-g="${esc(g.id)}"><div class="hs-gt"><div class="hs-tm${f ? w(f.away, f.home) : ''}">${TL(g.away.abbr, 'sm')}<b>${esc(g.away.abbr)}</b><span>${f ? f.away : ''}</span></div><div class="hs-tm${f ? w(f.home, f.away) : ''}">${TL(g.home.abbr, 'sm')}<b>${esc(g.home.abbr)}</b><span>${f ? f.home : ''}</span></div></div>
    <div class="hs-gm"><small>${f ? (f.live ? 'Final · ESPN' : 'Final') : esc(kickET(g.kick_utc))}</small><span>${bets.length ? `<b class="${T.n ? tone(T.units) : ''}">${bets.length} bet${bets.length === 1 ? '' : 's'}${T.n ? ` · ${T.w}–${T.l} · ${U1(T.units)}` : ''}</b>` : '<b class="mut">No bets</b>'}</span><span>${ne} edge prop${ne === 1 ? '' : 's'}</span></div>${ICON.chev}</button>`; }
function wireDay(box, d, src){ $$('[data-g]', box).forEach(b => b.onclick = () => openHGame(d, b.dataset.g, src));
  $$('[data-pub]', box).forEach(b => b.onclick = () => { while(STACK.length) popSheet(); setSlate(b.dataset.pub, 'card'); }); }

/* ---- game sheet: every model bet, then every 3+ point edge, each graded */
function openHGame(d, gid, src){ const g = d.gmap ? d.gmap[gid] : d.games.find(x => x.id === gid); if(!g) return; const f = finalOf(d, g); const mk = g.market || {};
  const ps = gameProps(d, g); const bets = ps.filter(p => p.tier === 'bet').sort((a, b) => (b.edge_pts || 0) - (a.edge_pts || 0)); const edges = ps.filter(p => p.tier !== 'bet' && isEdge(p)).sort((a, b) => b.edge_pts - a.edge_pts);
  const rest = sideProps({props: ps}).filter(p => p.tier !== 'bet' && !isEdge(p)).sort((a, b) => (b.edge_pts || -99) - (a.edge_pts || -99));
  const TB = tallyP(d, bets), TE = tallyP(d, edges);
  const html = `<div class="body hs">
    <div class="hs-board"><div class="hs-bt">${srcBadge(src.kind)}<span>${esc(dlab(gameDay(g)))} · ${esc(kickET(g.kick_utc))}</span></div>
      <div class="hs-sbd"><div>${TL(g.away.abbr, 'lg')}<b>${esc(g.away.abbr)}</b></div><div class="hs-sc">${f ? `<b class="${f.away > f.home ? 'w' : ''}">${f.away}</b><i>–</i><b class="${f.home > f.away ? 'w' : ''}">${f.home}</b>` : '<i>@</i>'}</div><div>${TL(g.home.abbr, 'lg')}<b>${esc(g.home.abbr)}</b></div></div>
      <div class="hs-lines"><div><small>Spread</small><b>${isNum(mk.spread_home) ? `${esc(g.home.abbr)} ${mk.spread_home > 0 ? '+' : mk.spread_home < 0 ? '−' : ''}${ln(Math.abs(mk.spread_home))}` : '—'}</b></div><div><small>Total</small><b>${isNum(mk.total) ? ln(mk.total) : '—'}</b></div><div><small>${f ? 'Final' : 'Status'}</small><b>${f ? (f.away + f.home) + ' pts' : 'Pending'}</b></div></div></div>
    ${tiles([['Bets', `${TB.w}–${TB.l}${TB.p ? '–' + TB.p : ''}`, '', `${bets.length}`], ['Bet P/L', TB.n ? U(TB.units) : '—', tone(TB.units)], ['Edges', `${TE.w}–${TE.l}`, '', `${edges.length} at 3+ pts`], ['Edge P/L', TE.n ? U(TE.units) : '—', tone(TE.units), 'at 1u']])}
    <section class="hs-sec"><h3 class="hs-h3">Model bets</h3>${bets.length ? `<div class="hs-list">${bets.map(p => propRow(d, p)).join('')}</div>` : '<p class="sub">No model bets in this game.</p>'}</section>
    <section class="hs-sec"><h3 class="hs-h3">Edge of 3+ points</h3><p class="hs-cap">Model chance at least 3 points above the break-even of the best price. Information only unless it was a bet. Units at 1u.</p>${edges.length ? `<div class="hs-list">${edges.map(p => propRow(d, p)).join('')}</div>` : '<p class="sub">No other prop cleared 3 points.</p>'}</section>
    ${rest.length ? `<details class="hs-more"><summary>Every other model side (${rest.length})</summary><div class="hs-list">${rest.map(p => propRow(d, p)).join('')}</div></details>` : ''}
    ${srcNote(src.kind)}</div>`;
  pushSheet(`${g.away.abbr} @ ${g.home.abbr}`, html, el => $$('[data-hp]', el).forEach(b => b.onclick = () => openHProp(d, b.dataset.hp, src))); }
function propRow(d, p){ const x = settle(d, p); const r = resOf(d, p); const act = r && isNum(r.actual) ? r.actual : null;
  return `<button class="hs-p ${x ? x.result : ''}" data-hp="${esc(p.id)}"><div class="hs-pm"><b>${esc(p.player)}</b><span>${esc(selOf(p))}</span><small>${od(p.odds)} ${esc(p.book || '')} · edge ${sg(p.edge_pts)}${p.tier === 'bet' ? ' · <em>Model bet</em>' : ''}</small></div>
    <div class="hs-pa"><b>${act == null ? '—' : num(act)}</b><small>${act == null ? 'no result' : esc(margin(p, act))}</small></div>${resultCell(d, p)}</button>`; }

/* ---- prop sheet: everything the model knew, then what happened */
async function openHProp(d, id, src){ const p = d.props.find(x => x.id === id); if(!p) return; const g = (d.gmap || {})[p.gid] || d.games.find(x => x.id === p.gid) || {}; const x = settle(d, p); const r = resOf(d, p); const act = r && isNum(r.actual) ? r.actual : null;
  let last = p.last10 || null, mu = p.matchup || null;
  if(!last){ const pid = pidOf(p); const P = pid ? await lib(pid) : null; const wk = d.meta.week;
    if(P && P.last10) last = P.last10.filter(e => (e.season || 2026) < 2026 || e.wk < wk).slice(0, 10).map(e => [e.season || 2026, e.wk, e.ha, e.opp, (LOGKEY[p.market] || []).reduce((a, k) => a + (isNum(e[k]) ? e[k] : 0), 0)]); }
  const tier = p.tier === 'bet' ? '<span class="hs-tag bet">Model bet</span>' : isEdge(p) ? '<span class="hs-tag">Edge 3+</span>' : '<span class="hs-tag mut">Model side</span>';
  const offers = (p.offers || []).slice().sort((a, b) => (a.book || '').localeCompare(b.book || ''));
  const html = `<div class="body hs">
    <div class="hs-ph"><div class="hs-phr">${tier}${srcBadge(src.kind)}</div><h1>${esc(p.player)}</h1><p>${esc(p.team)}${p.pos ? ' ' + esc(p.pos) : ''} ${mu ? esc(mu.ha) : 'vs'} ${esc(p.opp)} · Week ${esc(d.meta.week)}${g.kick_utc ? ' · ' + esc(dlab(gameDay(g))) : ''}</p></div>
    <div class="hs-hero ${x ? x.result : ''}"><div><small>${esc(MKL[p.market] || p.market_label || '')}</small><b>${esc(selOf(p))}</b><span>${od(p.odds)} · ${esc(p.book || '—')}</span></div>
      <div class="hs-hr"><small>Actual</small><b>${act == null ? '—' : num(act)}</b><span>${act == null ? 'Not graded yet' : esc(margin(p, act))}</span></div>
      <div class="hs-hv"><span class="hs-rt">${x ? resWord(x.result) : 'Pending'}</span><b>${x ? U(x.units) : ''}</b><small>${x ? `${num(x.stake)}u stake` : ''}</small></div></div>
    ${tiles([['Proj', num(p.projection), '', p.range80 ? `80%: ${num(p.range80[0])}–${num(p.range80[1])}` : ''], ['Chance', pc(p.p, 1), '', esc(p.side === 'under' ? 'under' : 'over')], ['Needs', pc(p.break_even, 1), '', od(p.odds)], ['Edge', sg(p.edge_pts), isNum(p.edge_pts) ? (p.edge_pts >= 3 ? 'up' : p.edge_pts < 0 ? 'dn' : '') : '', isNum(p.ev_per_unit) ? `EV ${sg(p.ev_per_unit * 100, 0)}%` : 'pts']])}
    ${distHTML(p, act)}
    <section class="hs-sec"><h3 class="hs-h3">Prices</h3><div class="hs-tbl"><div class="hs-tr hd"><span>Book</span><span>Line</span><span>Over</span><span>Under</span><span>Model o</span></div>
      ${offers.map(o => `<div class="hs-tr${o.book === p.book ? ' best' : ''}"><span>${esc(BOOKFULL[o.book] || o.book)}</span><span>${ln(o.line)}</span><span class="${o.book === p.book && p.side === 'over' ? 'pick' : ''}">${od(o.over)}</span><span class="${o.book === p.book && p.side === 'under' ? 'pick' : ''}">${od(o.under)}</span><span>${isNum(o.p_over) ? pc(o.p_over) : '—'}</span></div>`).join('') || '<div class="hs-tr"><span>No prices stored</span></div>'}
      ${p.opener ? `<div class="hs-tr mut"><span>Opened</span><span>${ln(p.opener.line)}</span><span>${od(p.opener.over)}</span><span>${od(p.opener.under)}</span><span></span></div>` : ''}
      ${p.close_dk ? `<div class="hs-tr mut"><span>DK close</span><span>${ln(p.close_dk.line)}</span><span></span><span></span><span>${isNum(p.close_dk.p_over) ? pc(p.close_dk.p_over) : ''}</span></div>` : ''}</div>
      <p class="hs-cap">Best price for the model's side highlighted. Model o = calibrated chance of the over at that book's line.${p.close_dk ? ' DK close = DraftKings closing line via ESPN.' : ''}${src.kind === 'rec' ? ' Prices: Action Network, last stored pre-game price.' : ''}</p></section>
    ${last && last.length ? lastHTML(p, last) : `<section class="hs-sec"><h3 class="hs-h3">Last 10 before this game</h3><p class="sub">Not available for this player.</p></section>`}
    ${muHTML(p, mu, g)}
    ${(p.ood || []).length ? `<section class="hs-sec"><h3 class="hs-h3">Flags</h3><ul class="hs-flags">${p.ood.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
    <section class="hs-sec">${srcNote(src.kind)}${src.kind === 'rec' ? `<p class="hs-cap">${esc((d.meta.models || {})[p.market] || '')}. Calibration temperature k = ${esc(p.k)} (fit on earlier weeks only). Not reproducible from stored outputs, so not applied: ${esc((d.meta.not_applied || []).join('; '))}.</p>` : ''}</section></div>`;
  pushSheet(p.player, html); }
function distHTML(p, act){ const q = p.q25; if(!q || q.length < 25){ if(!p.range80) return ''; }
  const lo = q ? q[0] : p.range80[0], hi = q ? q[24] : p.range80[1]; const vals = [lo, hi, p.line, act].filter(isNum); const mn = Math.min(...vals), mx = Math.max(...vals); const span = (mx - mn) || 1;
  const X = v => (4 + (v - mn) / span * 92).toFixed(2) + '%';
  const band = q ? [[q[0], q[24], 'b0'], [q[2], q[22], 'b1'], [q[6], q[18], 'b2']] : [[p.range80[0], p.range80[1], 'b1']];
  return `<section class="hs-sec"><h3 class="hs-h3">Predicted range</h3><div class="hs-dist" role="img" aria-label="Predicted range ${num(lo)} to ${num(hi)}, line ${num(p.line)}${isNum(act) ? ', actual ' + num(act) : ''}">
    ${band.map(([a, b, c]) => `<i class="${c}" style="left:${X(a)};width:calc(${X(b)} - ${X(a)})"></i>`).join('')}
    ${isNum(p.projection) ? `<s class="med" style="left:${X(p.projection)}"></s>` : ''}<s class="lnm" style="left:${X(p.line)}"><em>Line ${num(p.line)}</em></s>${isNum(act) ? `<s class="act" style="left:${X(act)}"><em>${num(act)}</em></s>` : ''}</div>
    <div class="hs-dl"><span>${num(lo)}</span><span>${q ? 'bands: 2–98%, 10–90%, 26–74% · tick = median' : '80% range'}</span><span>${num(hi)}</span></div></section>`; }
function lastHTML(p, last){ const vals = last.map(e => e[4]).filter(isNum); const L = p.line; const mx = Math.max(isNum(L) ? L * 1.5 : 1, ...vals, 1);
  const W = 320, Hh = 130, n = last.length, bw = W / Math.max(n, 10); const ly = Hh - 18 - (L / mx) * (Hh - 30);
  const rows = last.slice().reverse();
  const bars = rows.map((e, i) => { const v = e[4]; const h = Math.max(2, (isNum(v) ? v : 0) / mx * (Hh - 30)); const hit = isNum(v) && (p.side === 'under' ? v < L : v > L);
    return `<g><rect x="${i * bw + 4}" y="${Hh - 18 - h}" width="${bw - 8}" height="${h}" rx="3" class="${hit ? 'hi' : 'lo'}"/><text x="${i * bw + bw / 2}" y="${Hh - 22 - h}" class="v">${num(v)}</text><text x="${i * bw + bw / 2}" y="${Hh - 5}" class="o">${esc(e[3])}</text></g>`; }).join('');
  const hits = vals.filter(v => p.side === 'under' ? v < L : v > L).length;
  return `<section class="hs-sec"><h3 class="hs-h3">Last ${n} before this game</h3><svg class="hs-l10" viewBox="0 0 ${W + 36} ${Hh}" role="img" aria-label="${hits} of ${vals.length} on the model's side"><line x1="0" x2="${W}" y1="${ly}" y2="${ly}" class="ln"/>${bars}<text x="${W + 4}" y="${ly + 4}" class="lt">${num(L)}</text></svg>
    <p class="hs-cap">${hits} of ${vals.length} landed on the model's side (${esc(p.side || '')} ${num(L)}). Oldest on the left; ${rows.length && rows[0][0] < 2026 ? 'includes 2025.' : '2026 games.'}</p></section>`; }
function muHTML(p, mu, g){ const mk = g.market || {}; const home = g.home && g.home.abbr === p.team;
  const sp = mu && isNum(mu.spread_team) ? mu.spread_team : isNum(mk.spread_home) ? (home ? mk.spread_home : -mk.spread_home) : null; const tot = mu && isNum(mu.total) ? mu.total : mk.total;
  const D = mu && mu.defense; const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  return `<section class="hs-sec"><h3 class="hs-h3">Matchup</h3><div class="hs-mu"><div><small>Opponent</small><b>${TL(p.opp, 'sm')}${esc(p.opp)}</b><span>${home ? 'home' : 'away'}</span></div><div><small>${esc(p.team)} spread</small><b>${isNum(sp) ? (sp > 0 ? '+' : sp < 0 ? '−' : '') + ln(Math.abs(sp)) : '—'}</b><span>close</span></div><div><small>Total</small><b>${isNum(tot) ? ln(tot) : '—'}</b><span>close</span></div></div>
    ${D ? `<div class="hs-def ${D.rank <= 8 ? 'up' : D.rank >= 25 ? 'dn' : ''}"><div><small>${esc(p.opp)} vs ${esc(D.pos)}s before this week</small><b>${num(D.pg)} ${esc(MKW[p.market] || '')} per game</b><span>${D.games} game${D.games === 1 ? '' : 's'}${isNum(D.league) ? ` · league ${num(D.league)}` : ''}</span></div><div class="hs-rk"><b>${ord(D.rank)}</b><span>most allowed</span></div></div>` : `<p class="hs-cap">${mu ? 'No 2026 defense sample before this week.' : 'Defense-vs-position as of this week is stored only for reconstructed weeks.'}</p>`}</section>`; }

/* ================================================================ FEATURE 1 · player card */
/* 1.1 Now vs line: inserted at the top of the selected market whenever his game is live or final */
function liveCtx(name, team){ const g = Object.values(LV.games || {}).find(x => x.away === team || x.home === team); if(!g || g.state === 'pre') return null; return {g, st: (LV.stats || {})[nkey(name) + '|' + team] || null}; }
function nowInner(o){ const c = liveCtx(o.name, o.team); if(!c) return null; const {g, st} = c; const keys = CARDLIVE[o.market]; if(!keys) return null;
  const now = st ? keys.reduce((a, k) => a + (isNum(st[k]) ? st[k] : 0), 0) : 0; const L = o.line, over = o.side !== 'under', done = g.state === 'post';
  let ch = null;
  try{ if(typeof LP !== 'undefined' && LP && LP.markets && CARDMODEL[o.market] && isNum(o.projection) && !done){ const diff = o.team === g.home ? g.hs - g.as : g.as - g.hs; const Q = liveQ({market: CARDMODEL[o.market], projection: o.projection}, now, g.f, diff); if(Q){ const po = qOver(Q, L); ch = over ? po : 1 - po; } } }catch(e){}
  const hit = now > L; let state, word;
  if(over){ if(hit){ state = 'win'; word = 'Cashed'; } else if(done){ state = 'loss'; word = 'Missed'; } else { const ok = ch != null ? ch >= .5 : now / Math.max(g.f, .05) >= L; state = ok ? 'run' : 'behind'; word = ok ? 'On pace' : 'Behind'; } }
  else { if(hit){ state = 'loss'; word = 'Missed'; } else if(done){ state = 'win'; word = 'Cashed'; } else { const ok = ch != null ? ch >= .5 : now / Math.max(g.f, .05) <= L; state = ok ? 'run' : 'behind'; word = ok ? 'On pace' : 'Behind'; } }
  const need = Math.floor(L) + 1 - now; const gap = Math.round(Math.abs(now - L) * 10) / 10;
  const msg = over ? (hit ? `cleared by ${num(gap)}` : done ? `missed by ${num(gap)}` : `needs ${num(need)} more`) : (hit ? `over the line by ${num(gap)}` : done ? `stayed under by ${num(gap)}` : `${num(Math.max(0, (Number.isInteger(L) ? L - 1 : Math.floor(L)) - now))} to spare`);
  const frac = Math.max(0, Math.min(1, L > 0 ? now / L : (now > 0 ? 1 : 0)));
  const clock = done ? 'Final' : esc(g.detail || '');
  return `<div class="hn-top"><span class="hn-live ${done ? 'fin' : ''}">${done ? 'Final' : '<i></i>Live'}</span><span class="hn-clk">${done ? `${esc(g.away)} ${g.as} – ${esc(g.home)} ${g.hs}` : `${clock} · ${esc(g.away)} ${g.as}–${g.hs} ${esc(g.home)}`}</span><span class="hn-st ${state}">${word}</span></div>
    <div class="hn-mid"><div class="hn-now"><small>Now</small><b>${num(now)}</b></div><div class="hn-took"><small>Line we took</small><b>${over ? 'Over' : 'Under'} ${ln(L)}</b><span>${isNum(o.odds) ? od(o.odds) + (o.book ? ' \u00b7 ' + esc(o.book) : '') : 'no price posted at this line'}</span></div><div class="hn-msg"><small>${over ? (hit ? 'Over' : done ? 'Short' : 'To go') : (hit ? 'Busted' : done ? 'Under' : 'Room')}</small><b>${esc(msg)}</b></div></div>
    <div class="hn-bar ${state}${over ? '' : ' under'}" role="progressbar" aria-valuemin="0" aria-valuemax="${L}" aria-valuenow="${now}" aria-label="${num(now)} of ${num(L)}"><i style="width:${(state === 'win' && over ? 100 : frac * 100).toFixed(1)}%"></i><s style="left:100%"></s></div>
    <div class="hn-foot"><span>${num(now)} / ${num(L)} ${esc((MKW[CARDMODEL[o.market]] || o.market || '').toLowerCase())}</span><span>${done ? '' : ch != null ? `In-game model: <b>${pc(ch)}</b> ${over ? 'over' : 'under'}` : 'In-game model: not available for this market'}</span></div>`; }
function nowHTML(name, team, e, md, ds){ if(!md || md.no_prediction || !isNum(md.line) || !md.side || !CARDLIVE[e.market] || !name || !team) return '';
  let odds = null, book = null; const sp = (ds || []).flatMap(d => d.props).find(x => x.id === md.prop);
  if(sp && isNum(sp.odds)){ odds = sp.odds; book = sp.book; } else { for(const [k, b] of Object.entries(e.books || {})){ if(k === 'Open' || !b || b.line !== md.line) continue; const v = b[md.side]; if(isNum(v) && (odds == null || decO(v) > decO(odds))){ odds = v; book = BOOKFULL[k] || k; } } }
  const o = {name, team, market: e.market, side: md.side, line: md.line, odds, book, projection: md.projection}; const inner = nowInner(o); if(!inner) return '';
  return `<div class="hn" data-hn="${esc(JSON.stringify(o))}">${inner}</div>`; }
function refreshNow(){ $$('.hn[data-hn]').forEach(el => { try{ const o = JSON.parse(el.dataset.hn); const h = nowInner(o); if(h) el.innerHTML = h; }catch(e){} }); }

/* 1.2 every bar of the last-10 chart and every game-log row opens that game */
function wireCard(el, P, games){ if(!P) return;
  $$('[data-gl]', el).forEach(b => { if(b._hw) return; b._hw = 1; b.setAttribute('tabindex', '0'); b.setAttribute('role', 'button'); const i = +b.dataset.gl; const g = games[i]; if(!g) return;
    b.setAttribute('aria-label', `Week ${g.wk} ${g.ha === '@' ? 'at' : 'vs'} ${g.opp}: open game`); const go = () => openGameLog(P, Object.assign({season: 2026}, g));
    b.addEventListener('click', go); b.addEventListener('keydown', ev => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); go(); } }); });
  const tb = $('.x-more .tbl tbody', el); if(tb && !tb._hw){ tb._hw = 1; $$('tr', tb).forEach((tr, i) => { const g = (P.log || [])[i]; if(!g) return; tr.classList.add('hs-tap'); tr.setAttribute('tabindex', '0'); tr.setAttribute('role', 'button');
    const go = () => openGameLog(P, Object.assign({season: 2026}, g)); tr.addEventListener('click', go); tr.addEventListener('keydown', ev => { if(ev.key === 'Enter'){ go(); } }); }); } }
async function archiveFor(P, season, wk){ const out = []; if(season !== 2026) return out;
  const hw = await hWeek(wk); if(hw) for(const p of hw.props) if(p.pid === P.pid) out.push({d: hw, p, kind: 'rec'});
  for(const s of liveSlates().filter(s => s.week === wk)){ let d; try{ d = await loadSlate(s.id); }catch(e){ continue; }
    for(const p of d.props) if(pidOf(p) === P.pid || (!pidOf(p) && nkey(p.player) === nkey(P.name) && (!P.team || p.team === P.team))) out.push({d, p, kind: 'live', label: s.label}); }
  return out; }
async function openGameLog(P, g){ const rows = await archiveFor(P, g.season || 2026, g.wk);
  const BOX = [['snap', 'Snap %'], ['tgt', 'Tgt'], ['rec', 'Rec'], ['rec_yds', 'Rec yds'], ['rec_td', 'Rec TD'], ['car', 'Car'], ['rush_yds', 'Rush yds'], ['rush_td', 'Rush TD'], ['cmp', 'Cmp'], ['att', 'Att'], ['pass_yds', 'Pass yds'], ['pass_td', 'Pass TD'], ['int', 'Int'], ['sacks', 'Sacked']];
  const cells = BOX.filter(([k]) => isNum(g[k]) && (g[k] !== 0 || ['rec', 'rec_yds', 'rush_yds', 'pass_yds'].includes(k) && ((k.startsWith('pass') && P.pos === 'QB') || (!k.startsWith('pass') && P.pos !== 'QB'))));
  const actual = (p, d) => { const r = resOf(d, p); if(r && isNum(r.actual)) return r.actual; const ks = LOGKEY[p.market]; return ks && ks.some(k => isNum(g[k])) ? ks.reduce((a, k) => a + (isNum(g[k]) ? g[k] : 0), 0) : null; };
  const grp = {}; rows.forEach(x => (grp[x.kind + '|' + (x.label || '')] = grp[x.kind + '|' + (x.label || '')] || []).push(x));
  const line = ({d, p}) => { const a = actual(p, d); const r = resOf(d, p); let res = r && r.result; if(!res && isNum(a) && p.side && isNum(p.line)) res = a === p.line ? 'push' : ((a > p.line) === (p.side !== 'under') ? 'won' : 'lost');
    const pre = p.no_prediction || !p.side;
    return `<div class="hs-ml ${pre ? '' : res || ''}"><div class="hs-mlm"><b>${esc(MKL[p.market] || p.market_label || p.market)}</b><span>${pre ? `Line ${ln(p.line)} · no model prediction` : `${esc(selOf(p))} · ${isNum(p.odds) ? od(p.odds) + ' ' + esc(p.book || '') : 'no price'}`}</span><small>${pre ? '' : `chance ${pc(p.p ?? (window.pSide ? pSide(p) : null))}${isNum(p.edge_pts) ? ` · edge ${sg(p.edge_pts)}` : ''}`}${p.tier === 'bet' ? ' · <em>Model bet</em>' : ' · not a bet'}</small></div>
      <div class="hs-pa"><b>${isNum(a) ? num(a) : '—'}</b><small>${pre ? '' : esc(margin(p, a))}</small></div><div class="hs-res ${pre ? '' : res || ''}"><span class="hs-rt">${pre ? '—' : resWord(res)}</span></div></div>`; };
  const html = `<div class="body hs">
    <div class="hs-ph"><h1>${esc(P.name)}</h1><p>${g.season && g.season !== 2026 ? esc(g.season) + ' · ' : ''}Week ${esc(g.wk)} ${g.ha === '@' ? '@' : 'vs'} ${TL(g.opp, 'sm')}${esc(g.opp)} · ${esc(g.res || '')}${g.date ? ' · ' + esc(dlab(g.date)) : ''}</p></div>
    <section class="hs-sec"><h3 class="hs-h3">Box line</h3><div class="hs-box">${cells.map(([k, l]) => `<div><b>${num(g[k])}</b><small>${l}</small></div>`).join('') || '<p class="sub">No stats recorded.</p>'}</div></section>
    <section class="hs-sec"><h3 class="hs-h3">What the model had</h3>${rows.length ? Object.entries(grp).map(([k, xs]) => `<div class="hs-arch"><div class="hs-archh">${srcBadge(xs[0].kind)}<span>${xs[0].kind === 'rec' ? 'Walk-forward backtest' : esc(xs[0].label || '') + ' · ' + esc(xs[0].d.meta.model_version || '')}</span></div>
      ${xs.sort((a, b) => (b.p.tier === 'bet') - (a.p.tier === 'bet') || (b.p.edge_pts || -99) - (a.p.edge_pts || -99)).map(line).join('')}${xs[0].kind === 'rec' ? `<p class="hs-cap">${esc(REC_NOTE)}.</p>` : ''}</div>`).join('')
      : `<p class="sub">${(g.season || 2026) !== 2026 ? 'No model archive before the 2026 season.' : 'No archived line for him in this game.'}</p>`}</section>
    <p class="note">Box score: nflverse play-by-play. Lines: Action Network (reconstructed weeks) or the slate posted in the app.</p></div>`;
  pushSheet(`Week ${g.wk} ${g.ha === '@' ? '@' : 'vs'} ${g.opp}`, html, el => $$('.hs-ml', el).forEach(() => {})); }

/* ================================================================ entry points */
const CAL_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none"/></svg>';
function picker(C, close){ const h = $('.sp2 > h2', C); if(!h || $('.hs-calbtn', C)) return; const wrap = document.createElement('div'); wrap.className = 'hs-sph'; h.parentNode.insertBefore(wrap, h); wrap.appendChild(h);
  const b = document.createElement('button'); b.className = 'hs-calbtn'; b.setAttribute('aria-label', 'History: every past slate on a calendar'); b.innerHTML = CAL_SVG + '<span>History</span>'; wrap.appendChild(b);
  b.onclick = () => { close(); setTimeout(() => openHistory(), 180); }; }
async function mybets(root){ if(!root || $('.hs-entry', root)) return; const I = await hIndex(); if(!I.weeks.length || $('.hs-entry', root)) return;
  const S = I.weeks.reduce((a, w) => { a.w += w.bets.w; a.l += w.bets.l; a.u += w.bets.units; return a; }, {w: 0, l: 0, u: 0});
  const b = document.createElement('button'); b.className = 'hs-entry'; b.innerHTML = `<span class="hs-ei">${CAL_SVG}</span><span class="hs-et"><b>History</b><span>Every 2026 slate on a calendar · model ${S.w}–${S.l}, <em class="${tone(S.u)}">${U1(S.u)}</em></span></span>${ICON.chev}`;
  b.onclick = () => openHistory(); const anchor = $('.statstrip', root) || $('.lt', root); if(anchor) anchor.after(b); else root.prepend(b); }

window.HIST = {open: openHistory, picker, mybets, nowHTML, refreshNow, wireCard, openGameLog, _H: H};
const prevTick = window.onLiveTick; window.onLiveTick = function(){ if(prevTick) prevTick.apply(this, arguments); refreshNow(); };
try{ if(typeof loadLiveParams === 'function') loadLiveParams(); }catch(e){}
})();
