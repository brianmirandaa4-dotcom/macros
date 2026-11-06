/* whomadethisline · app
   Vanilla JS, no build step. Renders whatever is in /data. The model is the only source of truth:
   nothing here invents a pick, a line, a stat or an injury; missing data reads "Not available". */
'use strict';
const APP_VERSION = '2.0.0';
const STORE_KEY = 'wmtl.v1';

/* ================================================================ helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const isNum = x => typeof x === 'number' && isFinite(x);
const NA = '<span class="na">Not available</span>';
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pc = (x, d = 0) => isNum(x) ? (x * 100).toFixed(d) + '%' : '—';
const sg = (x, d = 1) => isNum(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d) : '—';
const ln = x => isNum(x) ? (Math.round(x * 10) / 10).toString() : '—';
const od = o => isNum(o) ? (o > 0 ? '+' : '−') + Math.abs(Math.round(o)) : '—';
const am2p = o => o > 0 ? 100 / (o + 100) : -o / (-o + 100);
const decOdds = o => o > 0 ? 1 + o / 100 : 1 + 100 / -o;
const money = (x, d = 0) => isNum(x) ? (x < 0 ? '−$' : '$') + Math.abs(x).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—';
const SPORTS = ['NFL'];   // NFL only for now; add sports back here when their models are in
const SPORTC = {NFL: 'var(--nfl)', CFB: 'var(--cfb)', NBA: 'var(--nba)', NHL: 'var(--nhl)', MLB: 'var(--mlb)'};
const SPORTHEX = {NFL: '#A08BF7', CFB: '#E7C46A', NBA: '#EC9455', NHL: '#8FD0EE', MLB: '#63C7B2'};
const FAM = {A: 'Role', B: 'Form', C: 'Matchup', D: 'Game setup', E: 'History'};
const LPRICES = [-105, -115, -125, -140];
const MKT_ORDER = ['pass_yds', 'rush_yds', 'rec_yds', 'receptions', 'qb_rush', 'atd', 'qb_atd', 'kicker', 'pts', 'reb', 'ast', 'tpm', 'pra', 'pr', 'pa', 'ra', 'stl', 'blk', 'tov'];
const STATWORD = {rec_yds: 'rec yds', receptions: 'rec', rush_yds: 'rush yds', qb_rush: 'rush yds', pass_yds: 'pass yds', atd: 'TD', qb_atd: 'TD', kicker: 'kick pts', pts: 'pts', reb: 'reb', ast: 'ast', tpm: '3PM', pra: 'PRA', pr: 'P+R', pa: 'P+A', ra: 'R+A', stl: 'stl', blk: 'blk', tov: 'TO'};
const ICON = new Proxy({}, {get: (_, k) => typeof k === 'string' ? Icon.svg(k) : undefined});
function toast(msg){ const w = $('#toastw'), t = $('#toast'); t.innerHTML = Icon.svg('check', {size: 20}) + esc(msg); w.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => w.classList.remove('on'), 2000); }
function countUp(el){ if(RM) return; $$('[data-count]', el).forEach(n => { const to = parseFloat(n.dataset.count); if(!isFinite(to)) return; const dp = (n.dataset.count.split('.')[1] || '').length; const t0 = performance.now(), D = 520;
  const step = t => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); n.textContent = (n.dataset.prefix || '') + (to * e).toFixed(dp) + (n.dataset.suffix || ''); if(k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }); }
const lossLine = p => { if(!isNum(p)) return ''; const l = Math.round((1 - p) * 100); return `Loses about <b>${l}</b> in 100`; };
function etTime(iso, opts){ try{ return new Date(iso).toLocaleString('en-US', Object.assign({timeZone: 'America/New_York'}, opts)); }catch(e){ return ''; } }
const winWord = w => w && !/\d/.test(w) ? w + ' · ' : '';
const kickET = iso => etTime(iso, {hour: 'numeric', minute: '2-digit'}) + ' ET';
const dayET = iso => etTime(iso, {weekday: 'short', month: 'short', day: 'numeric'});
function countdown(iso){ const ms = new Date(iso) - Date.now(); if(ms <= 0) return null; const h = Math.floor(ms / 3.6e6), m = Math.floor(ms % 3.6e6 / 6e4), d = Math.floor(h / 24);
  return d >= 2 ? `${d}d ${h % 24}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; }

/* ================================================================ storage */
const store = {
  d: null,
  load(){ try{ const raw = localStorage.getItem(STORE_KEY); this.d = raw ? JSON.parse(raw) : null; }catch(e){ this.d = null; }
    const base = {v: 1, bets: [], settings: {unit: 10, bankroll: 500, room: 'auto'}, ui: {}};
    this.d = Object.assign(base, this.d || {}); this.d.settings = Object.assign(base.settings, this.d.settings || {}); return this.d; },
  save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(this.d)); }catch(e){} }
};
const idb = {
  db: null,
  open(){ return new Promise(res => { try{ const r = indexedDB.open('wmtl', 1); r.onupgradeneeded = () => r.result.createObjectStore('slates'); r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => res(null); }catch(e){ res(null); } }); },
  async put(k, v){ const db = this.db || await this.open(); if(!db) return false; return new Promise(res => { try{ const t = db.transaction('slates', 'readwrite'); t.objectStore('slates').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); }catch(e){ res(false); } }); },
  async all(){ const db = this.db || await this.open(); if(!db) return []; return new Promise(res => { try{ const out = []; const t = db.transaction('slates').objectStore('slates').openCursor(); t.onsuccess = e => { const c = e.target.result; if(c){ out.push(c.value); c.continue(); } else res(out); }; t.onerror = () => res([]); }catch(e){ res([]); } }); }
};

/* ================================================================ data */
let INDEX = null; const SLATE = {}; const PLAYERS = {}; const RESULTS = {}; const IMPORTED = {};
async function getJSON(path, fresh){ const r = await fetch(path, fresh ? {cache: 'no-store'} : {}); if(!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); }
async function loadIndex(fresh){ INDEX = await getJSON('data/index.json', fresh); for(const s of await idb.all()){ IMPORTED[s.id] = s; addImportedToIndex(s); } return INDEX; }
function addImportedToIndex(d){ if(INDEX.slates.find(x => x.id === d.id)) return; const ks = d.games.map(g => g.kick_utc).sort();
  INDEX.slates.push({id: d.id, sport: d.sport || d.meta.sport, path: null, imported: true, label: d.meta.label || d.meta.date_label, date: d.meta.date, date_label: d.meta.date_label, week: d.meta.week, start_utc: ks[0], end_utc: ks[ks.length - 1], n_games: d.games.length, n_props: d.props.length, priced: d.props.filter(p => p.odds != null).length,
    bets: d.props.filter(p => p.classification === 'recommended').length, watch: d.props.filter(p => p.classification === 'watch').length, leans: d.props.filter(p => p.classification === 'lean').length, model_version: d.meta.model_version, generated_et: d.meta.generated_et, prices_et: d.meta.prices_et, results: {status: d.results ? d.results.status : 'pending'}}); }
const slateInfo = id => INDEX.slates.find(s => s.id === id);
async function loadSlate(id, fresh){ if(SLATE[id] && !fresh) return SLATE[id]; const info = slateInfo(id); if(!info) throw new Error('Unknown slate');
  const raw = info.imported ? IMPORTED[id] : await getJSON(info.path, fresh); const d = upgrade(raw); SLATE[id] = d; gradeMyBets(d); return d; }
async function loadPlayers(sport){ if(PLAYERS[sport]) return PLAYERS[sport]; const p = INDEX.players && INDEX.players[sport]; if(!p) return null; try{ PLAYERS[sport] = await getJSON(p); }catch(e){ PLAYERS[sport] = null; } return PLAYERS[sport]; }
async function loadResults(sport){ if(RESULTS[sport] !== undefined) return RESULTS[sport]; const p = INDEX.results && INDEX.results[sport]; RESULTS[sport] = null; if(p){ try{ RESULTS[sport] = await getJSON(p); }catch(e){} } return RESULTS[sport]; }

/* v1 or v2 slate -> one in-memory shape (an imported v1 export works too) */
const TIER = {recommended: 'bet', watch: 'live', lean: 'lean', check_news: 'check', pass: 'pass'};
function validate(d){ const e = []; if(!d || typeof d !== 'object') return ['The file is not a JSON object.']; if(!/^wmtl\.slate\.v[12]$/.test(d.schema || '')) e.push('Schema must be "wmtl.slate.v1" or "wmtl.slate.v2".'); if(!d.meta) e.push('Missing meta.'); if(!Array.isArray(d.games) || !d.games.length) e.push('Missing games.'); if(!Array.isArray(d.props)) e.push('Missing props.'); return e; }
function upgrade(d){
  d.sport = d.sport || d.meta.sport; const g = {}; d.games.forEach(x => { g[x.id] = x; x.window = x.window || x.slate; });
  const W = d.meta.windows || [...new Set(d.games.slice().sort((a, b) => a.kick_utc < b.kick_utc ? -1 : 1).map(x => x.window))]; d.meta.windows = W;
  d.props.forEach(p => { p._g = g[p.gid]; p.tier = p.tier || TIER[p.classification] || 'pass'; p.window = p.window || (p._g && p._g.window); p.pkey = p.pkey || (d.sport.toLowerCase() + ':x:' + p.player.toLowerCase()); });
  d.gmap = g; d.parlays = d.parlays || {status: 'not_exported', items: []}; d.results = d.results || {status: 'pending', props: {}, games: {}};
  d.byPlayer = {}; d.props.forEach(p => (d.byPlayer[p.pkey] = d.byPlayer[p.pkey] || []).push(p));
  return d; }
function slateStatus(s){ const now = Date.now(), a = new Date(s.start_utc).getTime(), b = new Date(s.end_utc).getTime() + 4 * 3.6e6;
  if(now < a) return {k: 'up', word: 'Starts in ' + countdown(s.start_utc)}; if(now <= b) return {k: 'live', word: 'In progress'}; return {k: 'final', word: s.results && s.results.status === 'graded' ? 'Final · graded' : 'Final'}; }

/* card strength used across screens */
const PCT_MARKETS = new Set(['atd', 'qb_atd', 'kicker']);
function cardKind(p){ const k = p.lights && p.lights.card_kind; if(k === 'strong' || k === 'weak') return k;
  if(PCT_MARKETS.has(p.market)){ if(isNum(p.pctile)) return p.pctile >= .77 ? 'strong' : p.pctile <= .23 ? 'weak' : 'normal'; return 'normal'; }
  if(!isNum(p.score25)) return 'none'; return p.score25 > 1.5 ? 'strong' : p.score25 <= -1.5 ? 'weak' : 'normal'; }
const isV4 = d => (d.props || []).some(p => p.model);
const selText = p => p.no_prediction ? `No prediction · line ${ln(p.line)} ${STATWORD[p.market] || p.market_label}` : p.market === 'atd' || p.market === 'qb_atd' ? 'Anytime TD' : `${p.side === 'under' ? 'Under' : 'Over'} ${ln(p.line)} ${STATWORD[p.market] || p.market_label}`;
const scoreChip = p => isNum(p.score25) ? `<span class="score ${p.score25 > 1.5 ? 'up' : p.score25 <= -1.5 ? 'dn' : ''}">${sg(p.score25, 1)}</span>` : `<span class="score">n/a</span>`;
const teamOpp = p => `${esc(p.team)}${p.opp ? ' vs ' + esc(p.opp) : ''}`;
function resultOf(d, p){ return d.results && d.results.props ? d.results.props[p.id] : null; }
function resultTag(r){ if(!r || !r.result) return ''; const c = r.result === 'won' ? 'edge' : r.result === 'lost' ? 'loss' : ''; const w = {won: 'Hit', lost: 'Miss', push: 'Push', void: 'Void'}[r.result] || r.result; return `<span class="tag ${c}">${w}${isNum(r.actual) ? ' · ' + ln(r.actual) : ''}</span>`; }

/* ================================================================ state + routing */
const S = {tab: 'lobby', slate: null, win: 'all', props: {mk: null, mode: 'strong', q: '', n: 50}, liveWin: 'all', resSport: 'NFL'};
const TABS = [['lobby', 'Home'], ['live', 'Live Now'], ['card', 'Picks'], ['mybets', 'My Bets'], ['players', 'Players']];
const ROUTES = ['board', 'props', 'more'];
function drawTabs(){ const n = S.slate && slateInfo(S.slate) ? slateInfo(S.slate).bets : 0;
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${ICON[k]}${k === 'card' && n ? `<span class="badge">${n}</span>` : ''}<span>${l}</span></button>`).join('');
  $$('#tabs button').forEach(b => b.onclick = () => { if(b.dataset.tab === S.tab){ window.scrollTo({top: 0, behavior: RM ? 'auto' : 'smooth'}); return; } go(b.dataset.tab); }); }
function go(tab, opts = {}){ if(!TABS.find(t => t[0] === tab) && !ROUTES.includes(tab)) tab = 'lobby'; if(!['lobby', 'more', 'live', 'mybets', 'players'].includes(tab) && !S.slate) tab = 'lobby';
  const same = S.tab === tab; S.tab = tab; store.d.ui.tab = tab; store.save(); try{ history.replaceState(null, '', '#' + tab); }catch(e){}
  drawTabs(); render(); if(!same && !opts.keepScroll) window.scrollTo(0, 0); }
async function setSlate(id, tab){ S.slate = id; S.win = 'all'; S.liveWin = 'all'; S.props.mk = null; store.d.ui.slate = id; store.save(); drawSlateBtn(); try{ await loadSlate(id); }catch(e){ toast('Could not load that slate'); } if(tab) go(tab); else render(); }
function drawSlateBtn(){ const b = $('#slatebtn'); const s = S.slate && slateInfo(S.slate); $('#top').classList.toggle('has-slate', !!s); if(!s){ b.hidden = true; return; } b.hidden = false;
  const parts = String(s.label || '').split(' · '); const st = slateStatus(s);
  b.className = 'slatebtn sb2' + (st.k === 'live' ? ' is-live' : '');
  b.innerHTML = `<span class="sb2-ic" aria-hidden="true">${SB2_ICON[s.sport] || SB2_ICON.NFL}</span><span class="sb2-tx"><b>${esc(parts[0] || s.sport)}</b><small>${st.k === 'live' ? '<i class="sb2-live"></i>Live now' : esc(parts[1] || s.sport)}</small></span><span class="sb2-ch" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg></span>`;
  b.setAttribute('aria-label', `${s.sport} ${s.label}. Change slate`); }
const SB2_ICON = {NFL: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="12" rx="9.5" ry="6" transform="rotate(-35 12 12)"/><path d="M9.2 14.8l5.6-5.6M10.6 11.4l2 2M12.4 9.6l2 2"/></svg>', CFB: null};
SB2_ICON.CFB = SB2_ICON.NFL;

async function render(){ const m = $('#main'); const v = S.tab;
  if(v !== 'lobby' && window.World && World.ready) World.pause(true);
  if(v === 'lobby'){ if(window.viewHome2){ m.innerHTML = '<div class="view"><p class="sub">Loading…</p></div>'; await viewHome2(); applyProgress(m, SLATE[S.slate] || {props: []}); return; } m.innerHTML = viewLobby(); wireLobby(); return; }
  if(v === 'more'){ m.innerHTML = viewMore(); wireMore(); return; }
  if(v === 'live' && window.viewLiveNow2){ await viewLiveNow2(); return; }
  if(v === 'players' && window.viewPlayers2){ await viewPlayers2(); return; }
  if(v === 'mybets'){ m.innerHTML = `<div class="view" id="mybets">${betsHTML()}</div>`; wireBetsIn(m, () => render()); return; }
  let d; try{ d = await loadSlate(S.slate); }catch(e){ m.innerHTML = `<div class="view"><div class="lt"><h1>Not available</h1><p>This slate could not be loaded. Pull down to try again.</p></div></div>`; return; }
  if(S.tab !== v) return;
  if(v === 'board'){ const B = await loadBoard(d); if(S.tab !== v) return; m.innerHTML = viewBoard(d, B); wireBoard(d, B); return; }
  m.innerHTML = v === 'card' ? viewCard(d) : v === 'props' ? viewProps(d) : viewLive(d); ({card: wireCard, props: wireProps, live: wireLive})[v](d); countUp(m); }

/* ================================================================ lobby */
function sportSummaries(){ return SPORTS.map(sp => { const ss = INDEX.slates.filter(s => s.sport === sp).sort((a, b) => a.start_utc < b.start_utc ? 1 : -1); const s = ss[0]; const meta = (INDEX.sports || {})[sp] || {};
  if(!s) return {key: sp, sport: sp, built: false, title: meta.status === 'offseason' ? 'Offseason' : 'Not built yet', sub: meta.status === 'offseason' ? 'No slate exported' : 'No model yet', when: '', bets: 0, watch: 0, games: 0, priced: 0};
  const st = slateStatus(s); return {key: sp, sport: sp, built: true, id: s.id, title: s.label, sub: `${s.n_games} game${s.n_games === 1 ? '' : 's'} · ${s.priced ? s.priced + ' priced' : (s.lines || 0) + ' lines'}`, when: st.k === 'up' ? st.word : st.k === 'live' ? 'Live now' : 'Final', bets: s.bets, watch: s.watch, games: s.n_games, priced: s.priced}; }); }
function viewLobby(){ const sums = sportSummaries(); const ss = INDEX.slates.slice().sort((a, b) => a.start_utc < b.start_utc ? 1 : -1);
  const up = (INDEX.upcoming || []).map(u => { const cd = countdown(u.first); return `<div class="sl off" style="--c:${SPORTHEX[u.sport]}"><div class="t">${esc(u.sport)} ${esc(u.label)}</div><div class="w">${cd ? `First game in <span class="cd">${cd}</span> · ` : ''}${u.games} games. ${esc(u.note)}</div><div class="cnt"><span class="sp" style="--c:${SPORTHEX[u.sport]}">${esc(u.sport)}</span></div></div>`; }).join('');
  const off = SPORTS.filter(sp => !INDEX.slates.some(s => s.sport === sp)).map(sp => { const m = (INDEX.sports || {})[sp] || {}; return `<div class="sl off"><div class="t">${sp} · ${m.status === 'offseason' ? 'Offseason' : 'Not built yet'}</div><div class="w">${esc(m.note || 'Not available')}</div><div class="cnt"><span class="sp" style="--c:${SPORTHEX[sp]}">${sp}</span></div></div>`; }).join('');
  return `<div class="view">
    <section class="sec"><div class="hd"><h2>Slates</h2><span class="sub">${INDEX.slates.length} loaded · newest first</span></div>
      <div class="slates">${up}${ss.map(slateCard).join('')}${off}</div></section>
    <section class="sec"><div class="help"><b>Bet only what you can afford to lose.</b><span>If betting stops being fun, call or text 1-800-GAMBLER, any time.</span></div>
      <div class="sub">tail. · data built ${esc(etTime(INDEX.built_utc, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}))} ET · app ${APP_VERSION}</div></section>
  </div>`; }
function room2d(sums){ return `<div class="room2d" id="room2d"><div class="tables">${sums.map(s => `<button class="tb ${s.built ? '' : 'off'}" data-sport="${s.key}" style="--c:${SPORTHEX[s.sport]};--glow:${s.bets ? 'var(--edge)' : s.watch ? 'var(--live)' : 'var(--pass)'}" ${s.built ? '' : 'disabled'} aria-label="${s.sport}"><span class="holo">${s.sport}</span><span class="ped"></span></button>`).join('')}</div></div>`; }
function slateCard(s){ const st = slateStatus(s); const r = s.results || {};
  return `<button class="sl tap" data-slate="${esc(s.id)}" style="--c:${SPORTHEX[s.sport]}"><div><span class="sp" style="--c:${SPORTHEX[s.sport]}">${s.sport}${s.imported ? ' · imported' : ''}</span><div class="t" style="margin-top:8px">${esc(s.label)}</div></div>
    <div class="cnt">${s.bets ? `<span class="pill pill-bet">${s.bets} bet${s.bets > 1 ? 's' : ''}</span>` : `<span class="pill pill-pass">No bets</span>`}${s.watch ? `<span class="pill pill-live">${s.watch} live</span>` : ''}</div>
    <div class="w">${esc(s.date_label || '')} · ${s.n_games} game${s.n_games === 1 ? '' : 's'} · ${s.priced ? s.priced + ' priced' : (s.lines ? s.lines + ' lines, no prices' : '0 priced')} · <span class="${st.k === 'up' ? 'cd' : ''}">${esc(st.word)}</span>${r.status === 'graded' && r.bets && (r.bets.w + r.bets.l) ? ` · bets ${r.bets.w}–${r.bets.l}` : ''}</div></button>`; }
function wireLobby(){ const m = $('#main');
  $$('[data-slate]', m).forEach(b => b.onclick = () => setSlate(b.dataset.slate, 'card'));
  $$('[data-sport]', m).forEach(b => b.onclick = () => openSport(b.dataset.sport));
  clearInterval(wireLobby._t); wireLobby._t = setInterval(() => { if(S.tab === 'lobby' && !document.hidden) $$('.cd', m).length && (render()); }, 60000);
  }
function openSport(sp){ const s = INDEX.slates.filter(x => x.sport === sp).sort((a, b) => a.start_utc < b.start_utc ? 1 : -1)[0]; if(s) setSlate(s.id, 'card'); else toast(`${sp}: not available yet`); }
/* 3D room: lazy, after the first screen is usable; never on reduced motion or when turned off */
let roomState = 'idle';
function roomAllowed(){ const set = store.d.settings.room; if(set === 'off' || RM) return false; try{ const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }catch(e){ return false; } }
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function startRoom(){ if(!roomAllowed()) return;
  const mount = () => { const host = $('#roomCanvas'); if(!host || !window.World) return; if(World.ready){ const c = World._canvas; if(c && c.parentNode !== host) host.appendChild(c); World.build(sportSummaries()); World.pause(false); World.resize(); $('#room2d') && ($('#room2d').style.opacity = 0); return; }
    if(World.init({onSport: k => openSport(k)})){ World._canvas = $('#roomCanvas canvas'); World.build(sportSummaries()); const f = $('#room2d'); if(f){ f.style.transition = 'opacity .5s'; f.style.opacity = 0; f.style.pointerEvents = 'none'; } } };
  if(roomState === 'ready') return mount(); if(roomState === 'loading') return;
  roomState = 'loading'; const go3d = () => loadScript('vendor/three.min.js').then(() => loadScript('room.js')).then(() => { roomState = 'ready'; if(S.tab === 'lobby') mount(); }).catch(() => { roomState = 'failed'; });
  (window.requestIdleCallback || (f => setTimeout(f, 350)))(go3d, {timeout: 1200}); }

/* ================================================================ card */
function windowSeg(d, cur, key, count){ const W = d.meta.windows || []; if(W.length < 2) return '';
  return `<div class="seg" role="group" aria-label="Betting window" data-seg="${key}"><button data-w="all" aria-pressed="${cur === 'all'}">All${count ? `<span class="n">${count('all')}</span>` : ''}</button>${W.map(w => `<button data-w="${esc(w)}" aria-pressed="${cur === w}">${esc(w)}${count ? `<span class="n">${count(w)}</span>` : ''}</button>`).join('')}</div>`; }
function funnelHTML(F){ if(!F || !F.length) return ''; const mx = Math.max(1, F[0].n); return `<div class="funnel">${F.map(f => `<div class="fr ${f.n ? '' : 'zero'}"><div><div class="l">${esc(f.step)}</div><div class="bar"><span style="width:${Math.max(f.n ? 2 : 0, f.n / mx * 100)}%"></span></div></div><div class="n">${f.n.toLocaleString()}</div></div>`).join('')}</div>`; }
function noBetReason(F){ if(!F || !F.length) return 'The model did not export its rule funnel for this slate.'; const z = F.findIndex(f => f.n === 0); if(z < 0) return 'Every bet that cleared the rules was capped by the exposure limits.'; const f = F[z];
  return `Of ${F[0].n.toLocaleString()} ${F[0].step.replace(/^Props? /, 'props ').replace(/^Priced props/, 'priced props')}, none made it past “${f.step.toLowerCase()}”${f.note ? `: ${f.note}` : ''}.`; }
function ticket(p, d){ const r = resultOf(d, p); const sp = d.sport.toLowerCase();
  const res = r && r.result ? (r.result === 'won' ? '<span class="pill pill-edge">Won</span>' : r.result === 'lost' ? '<span class="pill pill-loss">Lost</span>' : `<span class="pill pill-fair">${esc(r.result === 'push' ? 'Push' : 'Void')}</span>`) + (isNum(r.actual) ? ` <span>Final <b class="num">${ln(r.actual)}</b></span>` : '') : `<span>25D <b class="num">${sg(p.score25, 1)}</b></span>`;
  return `<button class="betcard tap" data-prop="${esc(p.id)}" style="--c:var(--${sp})">
  <div class="bc-top"><span class="bc-when">${Icon.svg(sp, {size: 15})}<span>${esc(winWord(p.window))}${p._g ? esc(dayET(p._g.kick_utc).split(',')[0]) + ' ' + kickET(p._g.kick_utc) : esc(p.window || '')}</span></span><span class="bc-tier">Model bet</span></div>
  <div class="bc-head"><div class="bc-pick"><div class="bc-sel">${esc(selText(p))}</div><div class="bc-who"><span class="bc-name">${esc(p.player)}</span><span class="bc-mu">${teamOpp(p)}</span></div></div>
    <div class="bc-price"><b class="num">${od(p.odds)}</b><span>${esc(p.book || '')}</span></div></div>
  ${chanceRail(p.p, p.break_even, lossLine(p.p))}
  <div class="bc-stats"><span class="bc-edge">Edge <b class="num">${sg(p.edge_pts)}</b></span>${isNum(p.units) ? `<span>Stake <b class="num">${p.units}u</b></span>` : ''}<span class="bc-res">${res}</span></div>
  <div class="bkrow">${bookBtns(p)}</div></button>`; }
/* bet card signature: the model's chance as a rail, the price's break-even as a tick, the gap between them (the edge) in gold foil */
function chanceRail(pm, be, note){ if(!isNum(pm)) return ''; const q = v => Math.max(0, Math.min(100, v * 100)).toFixed(1) + '%'; const hb = isNum(be);
  return `<div class="bc-meter" role="img" aria-label="Model chance ${Math.round(pm * 100)} percent${hb ? `, price needs ${Math.round(be * 1000) / 10} percent` : ''}" style="--p:${q(pm)}${hb ? `;--be:${q(be)}` : ''}">
    <div class="bc-mtop"><span class="bc-pct num">${pc(pm).replace('%', '')}<i>%</i></span><span class="bc-mlab">model chance</span>${note ? `<span class="bc-loss">${note}</span>` : ''}</div>
    <div class="bc-rail"><span class="bc-fill"></span>${hb ? '<span class="bc-over"></span><span class="bc-tick"></span>' : ''}</div>
    ${hb ? `<div class="bc-need"><span>Price needs ${pc(be)}</span></div>` : ''}</div>`; }
function viewCard(d){ const m = d.meta, info = slateInfo(d.id) || {}; const st = slateStatus(info);
  const inWin = p => S.win === 'all' || p.window === S.win;
  const bets = d.props.filter(p => p.tier === 'bet').sort((a, b) => (b.edge_pts || 0) - (a.edge_pts || 0));
  const leans = d.props.filter(p => p.tier === 'lean').sort((a, b) => (b.edge_pts ?? -99) - (a.edge_pts ?? -99));
  const bw = bets.filter(inWin), lw = leans.filter(inWin);
  const R = d.results && d.results.summary;
  const verdict = bets.length ? `<div class="verdict"><span class="label">The card</span><div class="big"><span class="num" data-count="${bets.length}">${bets.length}</span> bet${bets.length > 1 ? 's' : ''} pass${bets.length > 1 ? '' : 'es'} the model</div><p>${isV4(d) ? 'Each one cleared the model: an edge of 3+ points over the break-even of the best price across DraftKings, FanDuel, BetMGM, BetRivers and Caesars, a bootstrap interval that stays above break-even, and a market where the model beat the line in the 2026 priced backtest. Max 1u each, 15u per slate. Tap FanDuel or DK to copy the bet and open the app.' : 'Each one cleared both keys: a strong 25D report card with the pattern check, and an edge of 5 or more points after the market check at the best price.'}</p></div>`
    : topPicksHTML(d, m);
  return `<div class="view">
    <div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(m.label || '')}</span><h1>${esc(m.date_label || 'The card')}</h1><p>${esc(st.word)} · prices ${esc(m.prices_et || 'Not available')}</p></div>
    ${verdict}
    ${bets.length && (m.windows || []).length > 1 ? windowSeg(d, S.win, 'card', w => bets.filter(p => w === 'all' || p.window === w).length) : ''}
    ${bets.length ? `<section class="sec cardlist stagger">${bw.length ? bw.map(p => ticket(p, d)).join('') : `<p class="sub">No bets in this window. Swipe or pick another window.</p>`}${bw.length ? `<div class="sub">Tap a ticket for its full report card and the Log bet button.</div>` : ''}</section>` : ''}
    ${R && R.graded ? `<section class="sec"><div class="hd"><h2>How it went</h2><span class="sub">${R.graded.toLocaleString()} of ${R.priced.toLocaleString()} priced props graded</span></div>${gradedStrip(d)}</section>` : ''}
    ${sidesHTML(d, inWin)}
    ${prosHTML(d)}
    <section class="sec"><div class="sub">Model ${esc(m.model_version || '')} · built ${esc(m.generated_et || 'Not available')} · injuries ${esc(m.injuries_et || 'Not available')} · ${(m.sims_per_game || 10000).toLocaleString()} replays per game</div></section>
  </div>`; }
const BOOKURL = {FanDuel: 'https://sportsbook.fanduel.com/', DraftKings: 'https://sportsbook.draftkings.com/'};
function bookOffer(p, book){ const o = (p.offers || []).find(x => x.book === book); if(!o) return null; const pr = p.side === 'under' ? o.under : o.over; return {line: o.line, price: pr}; }
function betText(p, book){ const o = bookOffer(p, book); const ln_ = o ? o.line : p.line; const pr = o && isNum(o.price) ? ' ' + od(o.price) : '';
  return `${p.player} ${p.side === 'under' ? 'Under' : 'Over'} ${ln(ln_)} ${STATWORD[p.market] || p.market_label} · ${book}${pr}`; }
function bookBtns(p){ if(!p || p.no_prediction || !p.side) return ''; return ['FanDuel', 'DraftKings'].map(b => { const o = bookOffer(p, b);
  return `<span class="bkbtn ${b === 'FanDuel' ? 'fd' : 'dk'}" role="button" tabindex="0" data-book="${b}" data-bp="${esc(p.id)}">${b === 'FanDuel' ? 'FanDuel' : 'DK'}${o && isNum(o.price) ? ' ' + od(o.price) : ''}</span>`; }).join(''); }
async function openBook(d, id, book){ const p = d.props.find(x => x.id === id); if(!p) return; const t = betText(p, book);
  try{ await navigator.clipboard.writeText(t); toast('Copied: ' + t); }catch(e){ toast(t); }
  setTimeout(() => { location.href = BOOKURL[book]; }, 450); }
const prosOn = (d, p) => ((d.cappers || {}).picks || []).filter(k => k.model && k.model.prop === p.id && k.model.agree).map(k => k.capper);
const rankKey = (d, p) => pSide(p) + (prosOn(d, p).length ? .03 : 0);
const pSide = p => isNum(p.p) ? p.p : isNum(p.p_raw) ? p.p_raw : null;
const grade = x => x >= .60 ? 'A' : x >= .55 ? 'B' : 'C';
function topPicksHTML(d, m){ const top = d.props.filter(p => !p.no_prediction && p.side && isNum(pSide(p)) && isNum(p.line) && pSide(p) >= .55).sort((a, b) => rankKey(d, b) - rankKey(d, a)).slice(0, 5);
  if(!top.length) return `<div class="verdict"><span class="label">Top picks</span><div class="big none">Every prop is close to a coin flip on this slate.</div><p>No side reaches 55% in the model's calibrated simulations. ${esc(noBetReason(m.funnel))}</p>${funnelHTML(m.funnel)}</div>`;
  return `<div class="verdict"><span class="label">Top picks · the model's ${top.length} strongest sides</span><div class="big"><span class="num">${top.length}</span> recommended</div>
    <p>Ranked by the calibrated chance from 10,000 simulations; a side an approved pro is also on ranks a little higher, without changing its numbers. These clear 55%, but none has a confirmed edge at a real price yet, so keep stakes small (0.5u) until prices are checked.</p>
    <div class="list" style="margin-top:8px">${top.map(p => sideRow(p, d)).join('')}</div></div>`; }
function sidesHTML(d, inWin){ const all = d.props.filter(p => !p.no_prediction && p.side && isNum(pSide(p)) && p.tier !== 'bet' && isNum(p.line)).sort((a, b) => rankKey(d, b) - rankKey(d, a));
  const L = all.filter(inWin); if(!L.length) return ''; const n = S.leanAll ? 999 : 12; const cnt = k => all.filter(p => grade(pSide(p)) === k).length;
  return `<section class="info" aria-label="Model side on every prop"><div class="hd"><b>Model side · every prop</b><span class="sub">${all.length} props · A ${cnt('A')} · B ${cnt('B')} · C ${cnt('C')}</span></div>
    <p class="note" style="margin:0">The trained model's side and chance on every prop with a line, best first. A is 60%+, B is 55–60%, C is under 55%. These are model predictions, not bets: a bet also needs an edge at a real price whose interval clears break-even.</p>
    ${L.slice(0, n).map(p => sideRow(p, d)).join('')}${L.length > n ? `<button class="link" data-leanall>Show all ${L.length}</button>` : ''}</section>`; }
function sideRow(p, d){ const r = resultOf(d, p); const x = pSide(p); const g = grade(x);
  return `<button class="ir" data-prop="${esc(p.id)}"><span><b>${esc(p.player)}</b> · ${esc(selText(p))}<br><span class="s">${teamOpp(p)} · proj ${ln(p.projection)} · ${esc(p.window || '')}${prosOn(d, p).length ? ` · <span class="proag">Pro agrees: ${esc(prosOn(d, p).map(n => n.split(' ').pop()).join(', '))}</span>` : ''}</span></span><span class="r"><span class="grade g${g}">${g}</span> <b class="num">${pc(x)}</b><br><span class="s">${r && r.result ? (r.result === 'won' ? 'hit' : r.result === 'lost' ? 'miss' : r.result) + (isNum(r.actual) ? ' · ' + ln(r.actual) : '') : isNum(p.odds) ? od(p.odds) + ' ' + esc(p.book || '') : 'no price'}</span><span class="bkrow">${bookBtns(p)}</span></span></button>`; }
function prosHTML(d, only){ const C = d.cappers; if(!C || !(C.picks || []).length) return ''; const R = Object.fromEntries((C.records || []).map(r => [r.name, r]));
  const ps = only ? C.picks.filter(k => k.model && k.model.prop === only) : C.picks; if(!ps.length) return '';
  const t = s => new Date(s).toLocaleString('en-US', {timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit'}) + ' ET';
  const mline = k => k.model ? `<span class="${k.model.agree ? 'pos' : 'neg'}">Model ${k.model.agree ? 'agrees' : 'disagrees'}</span> · model chance on this side ${pc(k.model.p_capper_side)}, before the market check · proj ${ln(k.model.projection)}` : '<span class="na">No prediction from the model for this market</span>';
  const rows = ps.map(k => { const r = R[k.capper] || {}; return `<div class="pro"${k.model && !only ? ` data-prop="${esc(k.model.prop)}"` : ''}><div class="pro-top"><b>${esc(k.capper)}</b><span class="sub">${r.bets ? `${r.bets.toLocaleString()} bets · ROI ${sg(r.roi, 1)}%` : ''}</span></div>
    <div class="pro-play"><span>${esc(k.play)}</span><span class="num">${od(k.odds)} · ${k.units}u</span></div>
    <div class="sub">${mline(k)}</div><div class="sub">Posted ${esc(t(k.created_at))}${k.verified ? ' · verified' : ''}</div></div>`; }).join('');
  const recs = only ? '' : `<div class="tbl"><table><thead><tr><th>Capper</th><th>NFL record</th><th>Units</th><th>ROI</th></tr></thead><tbody>${(C.records || []).map(r => `<tr><td>${esc(r.name)}</td><td>${r.w}–${r.l}–${r.p}</td><td class="${r.units < 0 ? 'neg' : 'pos'}">${sg(r.units, 1)}</td><td>${sg(r.roi, 1)}%</td></tr>`).join('')}</tbody></table></div>`;
  return `<section class="sec"><div class="hd"><h2>${only ? 'Pros on this prop' : 'Pros on this game'}</h2><span class="sub">${ps.length} pick${ps.length === 1 ? '' : 's'} · ${esc(C.source)}</span></div><div class="group pad pros">${rows}${recs}<p class="note" style="margin:0">${esc(C.note)}</p></div></section>`; }

/* ---------------- Board: every prop for every player on this slate (Action Network prices; model numbers where the model has one) */
const BOARDS = {}; const BKS = ['DK', 'FD', 'MGM', 'BR', 'CZR'];
const nkey = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|iii|ii|iv)$/, '').trim();
async function loadBoard(d){ if(d.sport !== 'NFL') return null; const yr = (d.meta.date || '2026').slice(0, 4), wk = String(d.meta.week || '').padStart(2, '0'); const path = `data/nfl/board-${yr}-wk${wk}.json`;
  if(!(path in BOARDS)){ try{ BOARDS[path] = await getJSON(path); }catch(e){ BOARDS[path] = null; } } const B = BOARDS[path]; if(!B) return null;
  const teams = new Set(d.games.flatMap(g => [g.away.abbr, g.home.abbr])); return {...B, games: B.games.filter(g => teams.has(g.away) || teams.has(g.home))}; }
function bestOf(e, side){ let b = null; for(const k of BKS){ const o = (e.books || {})[k]; if(!o) continue; const v = side === 'yes' ? o.yes : o[side]; if(!isNum(v)) continue; if(!b || decOdds(v) > decOdds(b.v)) b = {k, v, line: o.line}; } return b; }
function propLine(e){ if(e.kind === 'ladder') return ''; const o = BKS.map(k => (e.books || {})[k]).find(Boolean) || Object.values(e.books || {})[0]; return o && isNum(o.line) ? ln(o.line) : ''; }
function boardRow(e, P){ const md = e.model;
  if(e.kind === 'ladder') return `<div class="brow lad"><div class="bm">${esc(e.market)}</div><div class="blad">${Object.entries(e.rungs).sort((a, b) => +a[0] - +b[0]).map(([r, bk]) => { const b = BKS.map(k => [k, bk[k]]).filter(x => isNum(x[1])).sort((a, b) => decOdds(b[1]) - decOdds(a[1]))[0]; return b ? `<span class="rung"><b>${r}+</b> ${od(b[1])} <i>${b[0]}</i></span>` : ''; }).join('')}</div></div>`;
  const bo = e.kind === 'yes' ? bestOf(e, 'yes') : bestOf(e, 'over'), bu = e.kind === 'yes' ? null : bestOf(e, 'under');
  const mtxt = md ? (md.no_prediction ? '<span class="na">no prediction</span>' : `<span class="mdl ${md.tier === 'bet' ? 'bet' : ''}" data-prop="${esc(md.prop)}">Proj <b>${ln(md.projection)}</b>${md.side && isNum(md.p) ? ` · ${md.side === 'under' ? 'U' : 'O'} ${pc(md.p)}` : ''}${md.tier === 'bet' ? ' · BET' : ''}</span>`) : '';
  return `<div class="brow"><div class="bm">${esc(e.market)} <b class="num">${propLine(e)}</b>${mtxt ? `<div>${mtxt}</div>` : ''}</div>
    <div class="bb">${e.kind === 'yes' ? (bo ? `<span>Yes <b class="num">${od(bo.v)}</b> <i>${bo.k}</i></span>` : '—') : `${bo ? `<span>O <b class="num">${od(bo.v)}</b> <i>${bo.k}${isNum(bo.line) && bo.line !== +propLine(e) ? ' ' + ln(bo.line) : ''}</i></span>` : ''}${bu ? `<span>U <b class="num">${od(bu.v)}</b> <i>${bu.k}${isNum(bu.line) && bu.line !== +propLine(e) ? ' ' + ln(bu.line) : ''}</i></span>` : ''}`}</div>
    <div class="ball">${BKS.filter(k => (e.books || {})[k]).map(k => { const o = e.books[k]; return `<span>${k} ${e.kind === 'yes' ? od(o.yes) : `${isNum(o.line) ? ln(o.line) + ' ' : ''}${od(o.over)}/${od(o.under)}`}</span>`; }).join('')}</div></div>`; }
function viewBoard(d, B){ const m = d.meta; S.board = S.board || {g: 'all', q: '', open: {}};
  if(!B) return `<div class="view"><div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(m.label || '')}</span><h1>Board</h1><p>The full prop board is not available for this slate.</p></div></div>`;
  const q = nkey(S.board.q || ''); const gs = B.games.filter(g => S.board.g === 'all' || String(g.gid) === S.board.g);
  const nP = B.games.reduce((a, g) => a + g.players.length, 0), nE = B.games.reduce((a, g) => a + g.players.reduce((x, P) => x + P.n, 0), 0);
  return `<div class="view"><div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(m.label || '')}</span><h1>Board</h1><p>Every player prop posted for this slate: ${nP} players, ${nE.toLocaleString()} props, best price across DraftKings, FanDuel, BetMGM, BetRivers and Caesars. The model's projection shows where it has one.</p></div>
    <div class="fld search"><label for="bq" class="sr">Find a player on the board</label>${Icon.svg('search', {size: 18})}<input id="bq" type="search" autocomplete="off" placeholder="Find a player on this board" value="${esc(S.board.q || '')}"></div>
    <div class="chips" role="tablist"><button class="chip tap" data-bg="all" aria-pressed="${S.board.g === 'all'}">All games</button>${B.games.map(g => `<button class="chip tap" data-bg="${g.gid}" aria-pressed="${S.board.g === String(g.gid)}">${esc(g.away)} @ ${esc(g.home)}</button>`).join('')}</div>
    ${gs.map(g => { const ps = g.players.filter(P => !q || nkey(P.name).includes(q)); if(!ps.length) return '';
      return `<section class="sec"><div class="hd"><h2><button class="x-link" style="font-size:20px;color:var(--t1)" data-og="${esc(g.away)}|${esc(g.home)}">${esc(g.away)} @ ${esc(g.home)} ›</button></h2><span class="sub">${esc(g.kick_et)} ET · ${ps.length} players</span></div><div class="group bplist">${ps.map(P => { const k = g.gid + ':' + P.name; const op = q || S.board.open[k];
        return `<div class="bp"><button class="bph" data-bo="${esc(k)}"><span><b>${esc(P.name)}</b> <span class="sub">${esc(P.team || '')} · ${esc(P.pos || '')}</span></span><span class="sub">${P.n} props ${op ? '▴' : '▾'}</span></button>
          ${op ? `<div class="bpb"><button class="link" data-prof="${esc(P.name)}|${esc(P.team || '')}">Player profile, stats and game log ›</button>${P.props.map(e => boardRow(e, P)).join('')}</div>` : ''}</div>`; }).join('')}</div></section>`; }).join('')}
    <section class="sec"><div class="sub">Prices: ${esc(B.source)} · pulled ${esc(new Date(B.pulled).toLocaleString('en-US', {timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit'}))} ET. Best price = highest payout among the five books.</div></section></div>`; }
function wireBoard(d, B){ const m = $('#main'); bindTaps(m, d); applyProgress(m, d); liveLoop(d);
  $$('[data-bg]', m).forEach(b => b.onclick = () => { S.board.g = b.dataset.bg; render(); });
  $$('[data-bo]', m).forEach(b => b.onclick = () => { const [gid, ...rest] = b.dataset.bo.split(':'); const nm = rest.join(':'); const G = B.games.find(g => String(g.gid) === gid); const P = G && G.players.find(x => x.name === nm); openCard(nm, P && P.team); });
  $$('[data-prof]', m).forEach(b => b.onclick = () => { const [n, t] = b.dataset.prof.split('|'); openProfileByName(n, t); });
  $$('[data-og]', m).forEach(b => b.onclick = () => { const [aw, hm] = b.dataset.og.split('|'); const g = d.games.find(x => x.away.abbr === aw && x.home.abbr === hm); if(g) openGame(d.id, g.id); });
  const i = $('#bq', m); if(i){ i.oninput = () => { S.board.q = i.value; clearTimeout(wireBoard._t); wireBoard._t = setTimeout(() => { const pos = i.selectionStart; render().then(() => { const j = $('#bq'); if(j){ j.focus(); j.setSelectionRange(pos, pos); } }); }, 250); }; } }

/* ---------------- Universal search + player profiles (nflverse rosters and play-by-play, every rostered player) */
let PIDX = null;
async function loadPlayerIndex(){ if(!PIDX){ try{ PIDX = await getJSON('data/nflp/index.json'); }catch(e){ PIDX = {players: []}; } } return PIDX; }
async function openProfileByName(name, team){ const I = await loadPlayerIndex(); const k = nkey(name);
  const hit = I.players.find(r => nkey(r[1]) === k && (!team || r[2] === team)) || I.players.find(r => nkey(r[1]) === k);
  if(hit) return openProfile(hit[0]); toast('No profile found for ' + name); }
function openSearch(){ pushSheet('Search', `<div class="body"><div class="lt"><h1>Find any player</h1><p>Every player on a 2026 NFL roster, including depth and practice squad.</p></div>
  <div class="fld search"><label for="uq" class="sr">Player name or team</label>${Icon.svg('search', {size: 18})}<input id="uq" type="search" autocomplete="off" placeholder="Name, or team like PHI" autofocus></div><div id="ures" class="list"></div></div>`, async el => {
    const I = await loadPlayerIndex(); const inp = $('#uq', el), out = $('#ures', el);
    const draw = () => { const q = nkey(inp.value), up = inp.value.trim().toUpperCase(); if(q.length < 2 && up.length < 2){ out.innerHTML = `<p class="sub">${I.players.length.toLocaleString()} players. Start typing.</p>`; return; }
      const r = I.players.filter(p => nkey(p[1]).includes(q) || p[2] === up).slice(0, 60);
      out.innerHTML = r.length ? r.map(p => `<button class="row" data-pid="${esc(p[0])}"><div><div class="nm">${esc(p[1])}</div><div class="mt">${esc(p[2] || 'FA')} · ${esc(p[3] || '')}${p[4] ? ' · #' + esc(p[4]) : ''}${p[5] && p[5] !== 'ACT' ? ' · ' + esc(p[5]) : ''}</div></div><div class="rt">${ICON.chev}</div></button>`).join('') : `<p class="sub">No player matches “${esc(inp.value)}”.</p>`;
      $$('[data-pid]', out).forEach(b => b.onclick = () => openProfile(b.dataset.pid)); };
    inp.oninput = draw; draw(); setTimeout(() => inp.focus(), 350); }); }
const STATCOLS = [['tgt', 'Tgt'], ['rec', 'Rec'], ['rec_yds', 'RecYd'], ['rec_td', 'RecTD'], ['car', 'Car'], ['rush_yds', 'RuYd'], ['rush_td', 'RuTD'], ['att', 'Att'], ['cmp', 'Cmp'], ['pass_yds', 'PaYd'], ['pass_td', 'PaTD'], ['sacks', 'Sk']];
function statTable(rows, lead){ if(!rows || !rows.length) return '<p class="sub">No games.</p>'; const cols = STATCOLS.filter(([k]) => rows.some(r => isNum(r[k]) && r[k] !== 0));
  return `<div class="tbl"><table><thead><tr>${lead.map(l => `<th>${l[1]}</th>`).join('')}${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${lead.map(l => `<td>${esc(r[l[0]] ?? '')}</td>`).join('')}${cols.map(([k]) => `<td class="num">${isNum(r[k]) ? (Number.isInteger(r[k]) ? r[k] : r[k].toFixed(1)) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
async function openProfile(pid){ let P; try{ P = await getJSON(`data/nflp/p/${pid}.json`); }catch(e){ toast('Profile not available'); return; }
  const props = []; for(const B of Object.values(BOARDS)){ if(!B) continue; for(const g of B.games) for(const x of g.players) if(nkey(x.name) === nkey(P.name) && (!x.team || x.team === P.team)) props.push(...x.props.map(e => ({e, g, x}))); }
  const sp = P.splits || {}; const spRows = [['season', '2026 avg'], ['l5', 'Last 5'], ['l3', 'Last 3']].filter(([k]) => sp[k]).map(([k, l]) => ({span: l, ...sp[k]}));
  const html = `<div class="body"><div class="lt"><span class="sp" style="--c:${SPORTHEX.NFL}">NFL · ${esc(P.team || 'FA')}${P.jersey ? ' · #' + esc(P.jersey) : ''}</span><h1>${esc(P.name)}</h1><p>${esc(P.pos || '')}${P.depth && P.depth !== P.pos ? ' (' + esc(P.depth) + ')' : ''} · ${esc(P.status_label || P.status || '')}</p></div>
    <div class="group pad pgrid">${[['Age', P.age], ['Height', P.height_ft], ['Weight', P.weight ? P.weight + ' lb' : null], ['College', P.college], ['Experience', isNum(P.exp) ? (P.exp ? P.exp + ' yr' : 'Rookie') : null], ['Draft', P.draft ? `${P.draft.club} #${P.draft.pick}` : 'Undrafted / n/a']].filter(x => x[1] != null && x[1] !== '').map(([k, v]) => `<div><span class="label">${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
    ${P.injury ? `<section class="sec"><h2>Injury report</h2><div class="group pad t2">Week ${esc(P.injury.week)}: <b style="color:var(--t1)">${esc(P.injury.status || 'listed')}</b>${P.injury.practice ? ' · practice: ' + esc(P.injury.practice) : ''}</div></section>` : ''}
    ${props.length ? `<section class="sec"><div class="hd"><h2>Props this week</h2><span class="sub">${props.length} · ${esc(props[0].g.away)} @ ${esc(props[0].g.home)}</span></div><div class="group bpb">${props.map(o => boardRow(o.e, o.x)).join('')}</div></section>` : ''}
    ${spRows.length ? `<section class="sec"><h2>Averages</h2>${statTable(spRows, [['span', '']])}</section>` : ''}
    <section class="sec"><div class="hd"><h2>2026 game log</h2><span class="sub">${(P.log || []).length} games</span></div>${statTable((P.log || []).map(r => ({...r, g: `${r.wk} ${r.ha === '@' ? '@' : 'vs'} ${r.opp}`, sn: isNum(r.snap) ? r.snap + '%' : ''})), [['g', 'Wk'], ['res', 'Result'], ['sn', 'Snap']])}</section>
    <section class="sec"><h2>Career</h2>${statTable((P.career || []).map(r => ({...r, tm: r.team || r['team(s)'] || ''})), [['season', 'Yr'], ['tm', 'Tm'], ['g', 'G']])}</section>
    <section class="sec"><div class="sub">Stats from nflverse play-by-play (regular season). Bio from nflverse rosters. Props from Action Network.</div></section></div>`;
  pushSheet(P.name, html, el => { const d = SLATE[S.slate]; if(d) bindTaps(el, d); }); }


/* ---------------- Live mode: ESPN live stats + Action Network live consensus line, every 10 s while a game is live and the Live tab is open */
const LV = {t: null, fails: 0, at: null, games: {}, lines: {}, stats: {}, err: null};
const ESPN_AB = {WSH: 'WAS', LAR: 'LA', JAC: 'JAX'}; const AN_TYPES = {core_bet_type_9_passing_yards: 'pass_yds', core_bet_type_12_rushing_yards: 'rush_yds', core_bet_type_15_receptions: 'receptions', core_bet_type_16_receiving_yards: 'rec_yds'};
const ab = a => ESPN_AB[a] || a;
async function livePoll(d){
  try{ await loadLiveParams();
    const sb = await getJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', true); if(!Array.isArray(sb.events)) throw new Error('ESPN scoreboard schema changed');
    LV.games = {};
    for(const ev of sb.events){ const c = ev.competitions && ev.competitions[0]; if(!c) continue; const cs = c.competitors || []; const h = cs.find(x => x.homeAway === 'home'), a = cs.find(x => x.homeAway === 'away'); if(!h || !a) continue;
      const H = ab(h.team.abbreviation), A = ab(a.team.abbreviation);
      const per = c.status.period || 1, ck = String(c.status.displayClock || '15:00').split(':'); const el = Math.min(3600, (per - 1) * 900 + (900 - ((+ck[0] || 0) * 60 + (+ck[1] || 0))));
      LV.games[A + '@' + H] = {id: ev.id, state: c.status.type.state, detail: c.status.type.shortDetail, away: A, home: H, as: +a.score || 0, hs: +h.score || 0, f: per > 4 ? 1 : Math.max(0, el / 3600)}; }
    const live = Object.values(LV.games).filter(g => g.state === 'in'); LV.done = LV.done || {};
    const want = new Set(Object.values(SLATE).filter(x => x && x.sport === 'NFL').flatMap(x => x.games.flatMap(g => [g.away.abbr, g.home.abbr])));
    for(const g of Object.values(LV.games).filter(g => (g.state === 'in' || (g.state === 'post' && !LV.done[g.id])) && (want.has(g.away) || want.has(g.home)))){ if(g.state === 'post') LV.done[g.id] = 1; const sm = await getJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=' + g.id, true); const bs = (sm.boxscore || {}).players; if(!Array.isArray(bs)) continue;
      for(const t of bs){ const tm = ab(t.team.abbreviation); for(const st of t.statistics || []){ const L = st.labels || []; for(const at of st.athletes || []){ const k = nkey(at.athlete.displayName) + '|' + tm; const o = LV.stats[k] = LV.stats[k] || {};
        const v = lab => { const i = L.indexOf(lab); return i < 0 ? null : at.stats[i]; };
        if(st.name === 'passing'){ const ca = String(v('C/ATT') || '0/0').split('/'); o.pass_yds = +v('YDS') || 0; o.cmp = +ca[0] || 0; o.att = +ca[1] || 0; }
        if(st.name === 'rushing'){ o.rush_yds = +v('YDS') || 0; o.car = +v('CAR') || 0; }
        if(st.name === 'receiving'){ o.rec_yds = +v('YDS') || 0; o.receptions = +v('REC') || 0; o.tgt = +v('TGTS') || 0; } } } } }
    if(live.length){ const wk = d.meta.week; LV.lines = {};
      for(const [t, mk] of Object.entries(AN_TYPES)){ const r = await getJSON(`https://api.actionnetwork.com/web/v2/scoreboard/nfl/markets?bookIds=68,69&customPickTypes=${t}&seasonType=reg&week=${wk}`, true);
        if(!r || typeof r.markets !== 'object') throw new Error('Action Network schema changed');
        const P = Object.fromEntries((r.players || []).map(p => [p.id, p])); const TM = {}; for(const g of r.games || []) for(const x of [g.home_team, g.away_team]) if(x) TM[x.id] = ab(x.abbr);
        for(const [b, m] of Object.entries(r.markets)) for(const o of Object.values(m)) for(const arr of Object.values(o)) for(const x of arr){ const p = P[x.player_id]; if(!p) continue;
          const k = nkey(p.full_name) + '|' + (TM[p.team_id] || '') + '|' + mk; const e = LV.lines[k] = LV.lines[k] || {};
          const slot = x.is_live ? 'live' : (+b === 68 ? 'DK' : +b === 69 ? 'FD' : null); if(!slot) continue; const s_ = e[slot] = e[slot] || {}; s_.line = x.value; s_[x.side] = x.odds; } } }
    LV.at = new Date(); LV.fails = 0; LV.err = null; return live.length;
  }catch(e){ LV.fails++; LV.err = e.message; return -1; } }
function liveLoop(d){ clearTimeout(LV.t); if(!['live', 'card', 'board'].includes(S.tab) || document.visibilityState !== 'visible') return;
  livePoll(d).then(n => { if(!['live', 'card', 'board'].includes(S.tab)) return; const box = S.tab === 'live' && $('#livenow'); if(box){ box.innerHTML = liveNowHTML(d); bindTaps(box, d); } applyProgress($('#main'), d);
    const anyLive = Object.values(LV.games).some(g => g.state === 'in'); LV.t = setTimeout(() => liveLoop(d), (LV.fails >= 3 ? 30 : anyLive ? 10 : 60) * 1000); }); }
document.addEventListener('visibilitychange', () => { const d = SLATE[S.slate]; if(d && ['live', 'card', 'board'].includes(S.tab) && document.visibilityState === 'visible') liveLoop(d); });
function liveNowHTML(d, only){ const tms = new Set(d.games.flatMap(g => [g.away.abbr, g.home.abbr])); const G = Object.values(LV.games).filter(g => only ? (g.away === only.away && g.home === only.home) : (tms.has(g.away) || tms.has(g.home))); if(!LV.at) return `<div class="group pad"><span class="sub">${LV.err ? 'Live data not available right now (' + esc(LV.err) + '). Retrying.' : 'Checking for live games…'}</span></div>`;
  const live = G.filter(g => g.state === 'in'); const t = LV.at.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', second: '2-digit'});
  if(!live.length) return `<div class="group pad"><span class="sub">No game on this slate is live right now. ${G.filter(g => g.state === 'pre').length} still to come. Checked ${t}${LV.err ? ' · ' + esc(LV.err) : ''}.</span></div>`;
  return live.map(g => { const ps = d.props.filter(p => (p.team === g.away || p.team === g.home) && isNum(p.line) && !p.no_prediction);
    for(const p of ps){ p._lm = null; const st = LV.stats[nkey(p.player) + '|' + p.team] || {}; const sk = {qb_rush: 'rush_yds', rush_yds: 'rush_yds', rec_yds: 'rec_yds', receptions: 'receptions', pass_yds: 'pass_yds'}[p.market]; if(!sk) continue;
      const diff = p.team === g.home ? g.hs - g.as : g.as - g.hs; const Q = liveQ(p, st[sk] || 0, g.f, diff); if(!Q) continue;
      const L = (LV.lines[nkey(p.player) + '|' + p.team + '|' + LMK(p.market)] || {}).live; const line = L ? L.line : p.line; const po = qOver(Q, line);
      const side = po >= .5 ? 'over' : 'under', ps_ = side === 'over' ? po : 1 - po; const price = L ? L[side] : null; const be_ = isNum(price) ? (price < 0 ? -price / (-price + 100) : 100 / (price + 100)) : null;
      p._lm = {Q, p: ps_, side, line, price, edge: be_ == null ? null : ps_ - be_, bet: be_ != null && ['receptions', 'rec_yds'].includes(LMK(p.market)) && ps_ - be_ >= .05 && ps_ <= .75 && g.f < .95}; }
    ps.sort((a, b) => ((b._lm && b._lm.bet) - (a._lm && a._lm.bet)) || ((b._lm ? b._lm.edge ?? -1 : -1) - (a._lm ? a._lm.edge ?? -1 : -1)));
    let kept = 0; for(const p of ps){ if(p._lm && p._lm.bet){ if(kept >= 5) p._lm.bet = false; else kept++; } }
    const nb = ps.filter(p => p._lm && p._lm.bet).length;
    return `<section class="sec"><div class="hd"><h2>${esc(g.away)} ${esc(g.as)} · ${esc(g.home)} ${esc(g.hs)}</h2><span class="sub"><span class="pill pill-live">LIVE</span> ${esc(g.detail)} · ${nb} live bet${nb === 1 ? '' : 's'}</span></div>
      <div class="group lvlist">${ps.map(p => { const st = LV.stats[nkey(p.player) + '|' + p.team] || {}; const sk = {qb_rush: 'rush_yds', rush_yds: 'rush_yds', rec_yds: 'rec_yds', receptions: 'receptions', pass_yds: 'pass_yds'}[p.market]; const now = sk ? (st[sk] ?? 0) : null; const ln_ = LV.lines[nkey(p.player) + '|' + p.team + '|' + (p.market === 'qb_rush' ? 'rush_yds' : p.market)] || {}; const L = ln_.live;
        const book = k => ln_[k] ? `${k} ${ln(ln_[k].line)} ${od(ln_[k].over)}/${od(ln_[k].under)}` : `${k} —`;
        const lm = p._lm; return `<div class="lv${lm && lm.bet ? ' lvbet' : ''}" data-prop="${esc(p.id)}"${lm && lm.bet ? ` data-lside="${lm.side}" data-lline="${lm.line}"` : ''}><div class="lvt"><b>${esc(p.player)}</b> <span class="sub">${esc(p.market_label)}</span>${lm && lm.bet ? ' <span class="pill pill-edge">Live bet</span>' : p.tier === 'bet' ? ' <span class="pill pill-bet">Bet</span>' : ''}</div>
          <div class="lvg"><div><span class="label">Now</span><b class="num">${isNum(now) ? ln(now) : '—'}</b></div><div><span class="label">Pregame</span><b class="num">${ln(p.line)}</b><span class="sub">${esc(p.side === 'under' ? 'U' : 'O')} ${pc(pSide(p))}</span></div>
          <div><span class="label">Live line</span>${L ? `<b class="num">${ln(L.line)}</b><span class="sub">O ${od(L.over)} · U ${od(L.under)}</span>` : '<b>—</b><span class="sub">not posted</span>'}</div><div><span class="label">In-game model</span>${lm ? `<b class="num">${ln(Math.round(qMed(lm.Q) * 10) / 10)}</b><span class="sub ${lm.bet ? 'pos' : ''}">${lm.side === 'under' ? 'U' : 'O'} ${pc(lm.p)}${lm.bet ? ' · LIVE BET' : ''}</span>` : '<b class="na">no prediction</b><span class="sub">not covered</span>'}</div></div>
          <div class="sub lvb">${book('DK')} · ${book('FD')} <i>(pregame)</i></div><div class="bkrow">${bookBtns(p)}</div></div>`; }).join('') || '<div class="pad sub">No props with a line for this game.</div>'}</div></section>`; }).join('') +
    `<p class="note">Updated ${t}, every 10 seconds while live. Stats: ESPN. Live line: Action Network consensus (its public feed has no book-by-book live lines; DraftKings/FanDuel shown are pregame). In-game model: re-simulation from the stat so far, time left and score (validated on 2026 games). Live bet = receptions or receiving yards only, the in-game chance at the live consensus line beats that price's break-even by 5+ points, chance no higher than 75%, at most 5 per game. Caution: the in-game model is validated against final stats, but there is no history of live prices to backtest live bets against.</p>`; }


/* ---------------- In-game model (data/nfl/live_params.json, fit 2018-24, calibrated 2025, validated on 2026) and checkpoint plans */
let LP = null; async function loadLiveParams(){ if(!LP){ try{ LP = await getJSON('data/nfl/live_params.json'); }catch(e){ LP = {markets: {}}; } } return LP; }
const LMK = m => m === 'qb_rush' ? 'rush_yds' : m;
const BKT = d => d <= -14 ? 'down14' : d <= -7 ? 'down7' : d < 7 ? 'close' : d < 14 ? 'up7' : 'up14';
function liveQ(p, soFar, f, diff){ const M = LP && LP.markets[LMK(p.market)]; if(!M || !M.validated || !isNum(p.projection)) return null;
  const pre = p.projection, r = 1 - f, pace = soFar / Math.max(f, .1), b = BKT(diff), B = M.beta; const ind = k => b === k ? 1 : 0;
  const x = [pre * r, pace * r, r, r * ind('down14'), r * ind('down7'), r * ind('up7'), r * ind('up14'), pre * r * ind('down14'), pre * r * ind('down7'), pre * r * ind('up7'), pre * r * ind('up14')];
  const rem = Math.max(.05, x.reduce((a, v, i) => a + v * B[i], 0)); const T = (1 - f) * 3600;
  const g = String(LP.snapshots_seconds_remaining.reduce((a, s) => Math.abs(s - T) < Math.abs(a - T) ? s : a)); const zq = M.zq[g];
  return {q: zq.map(z => soFar + Math.max(0, rem + z * Math.sqrt(Math.max(rem, .25)))), k: M.k}; }
function qOver(Q, line){ const L = LP.quantile_levels; const q = Q.q.slice(); for(let i = 1; i < q.length; i++) q[i] = Math.max(q[i], q[i - 1]);
  let F; if(line < q[0]) F = 0; else if(line >= q[q.length - 1]) F = 1; else { let i = 0; while(q[i + 1] <= line) i++; F = q[i + 1] === q[i] ? L[i + 1] : L[i] + (L[i + 1] - L[i]) * (line - q[i]) / (q[i + 1] - q[i]); }
  const p = Math.min(.99, Math.max(.01, 1 - F)); const lgt = Math.log(p / (1 - p)); return 1 / (1 + Math.exp(-Q.k * lgt)); }
const qMed = Q => Q.q[Math.floor(Q.q.length / 2)];
function checkpointHTML(p){ if(!LP || !LP.markets[LMK(p.market)] || !isNum(p.projection) || !isNum(p.line)) return '';
  const CK = [[2700, 'End Q1'], [1800, 'Half'], [900, 'End Q3']], SS = [[-14, 'Down 14'], [-7, 'Down 7'], [0, 'Close'], [7, 'Up 7'], [14, 'Up 14']];
  const rows = CK.map(([T, l]) => { const f = 1 - T / 3600; const onPace = p.projection * f;
    const cells = SS.map(([dd]) => { const Q = liveQ(p, onPace, f, dd); return Q ? ln(Math.round(qMed(Q) * 10) / 10) : '—'; });
    let need = null; for(let s_ = 0; s_ <= Math.max(3, p.line * 1.5); s_ += (p.market === 'receptions' ? 1 : Math.max(1, Math.round(p.line / 30)))){ const Q = liveQ(p, s_, f, 0); if(Q && qOver(Q, p.line) >= .55){ need = s_; break; } }
    return `<tr><td>${l}</td><td class="num">${ln(Math.round(onPace * 10) / 10)}</td>${cells.map(c => `<td class="num">${c}</td>`).join('')}<td class="num">${need == null ? '—' : ln(need) + '+'}</td></tr>`; }).join('');
  return `<section class="sec"><div class="hd"><h2>Checkpoints</h2><span class="sub">in-game model</span></div><div class="tbl"><table><thead><tr><th></th><th>On pace</th>${SS.map(x => `<th>${x[1]}</th>`).join('')}<th>Over needs</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Projected final ${esc(STATWORD[p.market] || p.market_label)} if he is exactly on pregame pace at each checkpoint, by score (his team's view). “Over needs” is the stat he needs by then, in a close game, for the in-game model to give the over ${ln(p.line)} at least 55%.</p></section>`; }


function watchPlansHTML(d){ if(!LP || !LP.markets) return ''; const ps = d.props.filter(p => !p.no_prediction && isNum(p.line) && isNum(p.projection) && LP.markets[LMK(p.market)] && (p.tier === 'bet' || p.tier === 'lean' || (pSide(p) || 0) >= .58)).sort((a, b) => (b.tier === 'bet') - (a.tier === 'bet') || (pSide(b) || 0) - (pSide(a) || 0)).slice(0, 12);
  if(!ps.length) return ''; return `<div class="list">${ps.map(p => { const f = .5, onP = p.projection * f; const Q0 = liveQ(p, onP, f, 0); let need = null; for(let s_ = 0; s_ <= Math.max(3, p.line * 1.5); s_ += (p.market === 'receptions' ? 1 : Math.max(1, Math.round(p.line / 30)))){ const Q = liveQ(p, s_, f, 0); if(Q && qOver(Q, p.line) >= .55){ need = s_; break; } }
    return `<button class="row" data-prop="${esc(p.id)}"><div><div class="nm">${esc(p.player)} · ${esc(selText(p))}</div><div class="mt">${teamOpp(p)} · proj ${ln(p.projection)} · at half on pace ${ln(Math.round(onP * 10) / 10)}${need != null ? ` · over live at ${ln(need)}+ by half` : ''}</div></div><div class="rt">${p.tier === 'bet' ? '<span class="pill pill-bet">Bet</span>' : `<span class="sub">${pc(pSide(p))}</span>`}</div></button>`; }).join('')}</div><p class="note">Tap a player for the full checkpoint table (end Q1, half, end Q3 × down 14 to up 14).</p>`; }


/* ---------------- Bet progress: faded bar behind every pick toward its line; green CASHED when it hits, red when an under is blown */
const CASH_SEEN = new Set(); /* one cash animation per pick per session, not on every re-render */
function applyProgress(root, d){ if(!root || !Object.keys(LV.games).length) return;
  for(const el of root.querySelectorAll('[data-prop]')){ const p = d.props.find(x => x.id === el.dataset.prop); if(!p || !p.side || p.no_prediction) continue;
    const g = Object.values(LV.games).find(x => x.away === p.team || x.home === p.team); if(!g || g.state === 'pre') continue;
    const sk = {qb_rush: 'rush_yds', rush_yds: 'rush_yds', rec_yds: 'rec_yds', receptions: 'receptions', pass_yds: 'pass_yds'}[p.market]; if(!sk) continue;
    const now = (LV.stats[nkey(p.player) + '|' + p.team] || {})[sk] || 0;
    const lb = el.dataset.lside ? {side: el.dataset.lside, line: +el.dataset.lline} : {side: p.side, line: p.line}; if(!isNum(lb.line)) continue;
    const over = lb.side !== 'under', hit = now > lb.line, done = g.state === 'post';
    const state = over ? (hit ? 'win' : done ? 'loss' : 'run') : (hit ? 'loss' : done ? 'win' : 'run');
    const frac = Math.max(0, Math.min(1, lb.line > 0 ? now / lb.line : (now > 0 ? 1 : 0)));
    const ck = p.id + (el.classList.contains('betcard') ? '|c' : el.classList.contains('x-bet') ? '|h' : '|o'); if(state === 'win' && !CASH_SEEN.has(ck)){ CASH_SEEN.add(ck); if(!el.classList.contains('pg-win')) el.classList.add('pg-cash'); }
    el.classList.add('pg'); el.classList.toggle('pg-win', state === 'win'); el.classList.toggle('pg-loss', state === 'loss'); el.classList.toggle('pg-under', !over);
    el.style.setProperty('--pg', (state === 'win' ? 100 : frac * 100).toFixed(1) + '%');
    let tag = el.querySelector(':scope > .pgtag'); if(!tag){ tag = document.createElement('span'); tag.className = 'pgtag'; el.appendChild(tag); }
    tag.textContent = state === 'win' ? `✓ Cashed · ${ln(now)}` : state === 'loss' ? `✕ ${over ? 'Missed' : 'Over the line'} · ${ln(now)}` : `${ln(now)} / ${ln(lb.line)} ${over ? '' : '(under)'}`.trim(); } }


/* ---------------- Ticker banner: scores of every game + every model pick that has cashed, scrolling across the top */
function pickState(p){ const g = Object.values(LV.games).find(x => x.away === p.team || x.home === p.team); if(!g || g.state === 'pre') return null;
  const sk = {qb_rush: 'rush_yds', rush_yds: 'rush_yds', rec_yds: 'rec_yds', receptions: 'receptions', pass_yds: 'pass_yds'}[p.market]; if(!sk || !isNum(p.line) || !p.side) return null;
  const now = (LV.stats[nkey(p.player) + '|' + p.team] || {})[sk] || 0; const over = p.side !== 'under', hit = now > p.line, done = g.state === 'post';
  return {now, win: over ? hit : (done && !hit), loss: over ? (done && !hit) : hit}; }
async function tickerLoop(){ clearTimeout(tickerLoop._t); if(document.visibilityState !== 'visible'){ tickerLoop._t = setTimeout(tickerLoop, 15000); return; }
  try{ const nfl = INDEX.slates.filter(s => s.sport === 'NFL').sort((a, b) => a.start_utc < b.start_utc ? 1 : -1); const wk = nfl[0] && nfl[0].week;
    for(const s of nfl.filter(s => s.week === wk)) await loadSlate(s.id).catch(() => {});
    const d = SLATE[S.slate] || SLATE[nfl[0] && nfl[0].id]; if(d && (!LV.at || Date.now() - LV.at > 8000)) await livePoll(d); }catch(e){}
  drawTicker(); if(window.onLiveTick) onLiveTick(); const live = Object.values(LV.games).some(g => g.state === 'in'); tickerLoop._t = setTimeout(tickerLoop, (live ? 15 : 60) * 1000); }
function drawTicker(){ const el = $('#tktrack'); if(!el) return; const items = [];
  const G = Object.values(LV.games).sort((a, b) => (a.state === 'in' ? 0 : a.state === 'post' ? 1 : 2) - (b.state === 'in' ? 0 : b.state === 'post' ? 1 : 2));
  for(const g of G){ if(g.state === 'pre') continue; items.push(`<span class="tk ${g.state === 'in' ? 'tk-live' : ''}"><i>${g.state === 'in' ? 'LIVE' : 'FINAL'}</i> ${esc(g.away)} <b>${g.as}</b> · ${esc(g.home)} <b>${g.hs}</b>${g.state === 'in' ? ' · ' + esc(g.detail) : ''}</span>`); }
  const seen = new Set(); let w = 0, l = 0;
  for(const d of Object.values(SLATE)){ if(!d || d.sport !== 'NFL') continue; for(const p of d.props){ if(p.no_prediction || !(p.tier === 'bet' || (pSide(p) || 0) >= .55)) continue; const st = pickState(p); if(!st) continue; const k = p.player + p.market;
    if(seen.has(k)) continue; seen.add(k); if(st.win){ w++; items.push(`<span class="tk tk-win" data-tkp="${esc(p.id)}">✓ ${esc(p.player)} ${esc(selText(p))} · ${ln(st.now)}${p.tier === 'bet' ? ' · BET' : ''}</span>`); } else if(st.loss) l++; } }
  if(w + l) items.unshift(`<span class="tk tk-sum"><i>MODEL PICKS</i> ${w} cashed · ${l} missed</span>`);
  if(!items.length){ const next = Object.values(LV.games).filter(g => g.state === 'pre').length; items.push(`<span class="tk">No NFL game live${next ? ` · ${next} game${next > 1 ? 's' : ''} still to play this week` : ''} · picks light up here as they cash</span>`); }
  const html = items.join('<span class="tk-dot">•</span>'); if(el.dataset.h === html) return; el.dataset.h = html;
  el.innerHTML = `<div class="tk-run">${html}<span class="tk-dot">•</span></div><div class="tk-run" aria-hidden="true">${html}<span class="tk-dot">•</span></div>`;
  const sp = Math.max(25, el.firstChild.scrollWidth / 45); el.style.setProperty('--tkdur', sp + 's');
  $$('[data-tkp]', el).forEach(b => b.onclick = () => { const d = Object.values(SLATE).find(x => x && x.props.some(p => p.id === b.dataset.tkp)); if(d) openProp(d, b.dataset.tkp); }); }

function leanRow(p, d){ const r = resultOf(d, p); return `<button class="ir" data-prop="${esc(p.id)}"><span><b>${esc(p.player)}</b> · ${esc(selText(p))}<br><span class="s">${teamOpp(p)} · ${esc(p.window || '')} · 25D ${sg(p.score25, 1)}</span></span><span class="r">${od(p.odds)}<br><span class="s">${r && r.result ? (r.result === 'won' ? 'hit' : r.result === 'lost' ? 'miss' : r.result) + (isNum(r.actual) ? ' · ' + ln(r.actual) : '') : ''}</span></span></button>`; }
function gradedStrip(d){ const s = d.results.summary, b = s.bets || {}, t = s.by_tier || {}, L = s.lines || {};
  const cell = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  const rec = x => x ? `${x.w}–${x.l}${x.p ? '–' + x.p : ''}` : '—';
  return `<div class="statstrip">${cell(rec(b), 'Bets')}${cell(isNum(b.units) && (b.w + b.l) ? sg(b.units, 2) + 'u' : '—', 'Bet units')}${cell(rec(t.lean), 'Leans (info)')}${cell(`${L.won || 0}–${L.lost || 0}`, 'Game lines')}</div>`; }
function wireCard(d){ const m = $('#main'); bindTaps(m, d); applyProgress(m, d); liveLoop(d);
  $$('[data-seg="card"] button', m).forEach(b => b.onclick = () => { S.win = b.dataset.w; render(); });
  const la = $('[data-leanall]', m); if(la) la.onclick = () => { S.leanAll = true; render(); };
  swipeWindows(m, d, () => S.win, w => { S.win = w; render(); }); }
function swipeWindows(el, d, get, set){ const W = ['all', ...(d.meta.windows || [])]; if(W.length < 3) return; let x0 = null, y0 = null;
  el.ontouchstart = e => { if(e.touches.length !== 1) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; };
  el.ontouchend = e => { if(x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null; if(Math.abs(dx) < 70 || Math.abs(dy) > 45 || e.target.closest('.seg,.chips,.ladder,.gl,.tbl,.room')) return; const i = W.indexOf(get()); const j = Math.max(0, Math.min(W.length - 1, i + (dx < 0 ? 1 : -1))); if(j !== i) set(W[j]); }; }
function bindTaps(root, d){ $$('[data-book]', root).forEach(b => b.onclick = e => { e.stopPropagation(); e.preventDefault(); openBook(d, b.dataset.bp, b.dataset.book); }); $$('[data-prop]', root).forEach(b => b.onclick = () => openProp(d, b.dataset.prop)); $$('[data-player]', root).forEach(b => b.onclick = () => openPlayer(d.sport, b.dataset.player, d)); $$('[data-log]', root).forEach(b => b.onclick = e => { e.stopPropagation(); logBet(d, d.props.find(p => p.id === b.dataset.log)); }); }

/* ================================================================ props */
function marketsOf(d){ return [...new Set(d.props.map(p => p.market))].sort((a, b) => MKT_ORDER.indexOf(a) - MKT_ORDER.indexOf(b)); }
function factorRows(d, mk){ const F = (d.meta.factors || {})[mk]; const C = (d.meta.cards || {})[{receptions: 'rec', kicker: 'kick'}[mk] || mk] || (d.meta.cards || {})[mk];
  if(!F && !C) return null;
  const rows = F && F.rows ? F.rows.map(r => ({id: r.id, name: r.name, how: r.how, share: r.share, dir: r.dir})) : (C.ids || []).map((id, i) => ({id, name: C.names[i], how: C.how[i], share: Math.abs(C.w[i]), dir: Math.sign(C.w[i]) || 1}));
  const tot = rows.reduce((a, r) => a + Math.abs(r.share || 0), 0) || 1; rows.forEach(r => r.share = Math.abs(r.share || 0) / tot); rows.sort((a, b) => b.share - a.share);
  const fit = F ? [F.n ? `${F.n.toLocaleString()} player-games` : '', F.first_season ? `since ${F.first_season}` : '', isNum(F.oos_rho) ? `out-of-sample rank correlation ${F.oos_rho.toFixed(3)}` : isNum(F.r2_oos) ? `out-of-sample R² ${F.r2_oos.toFixed(3)}` : ''].filter(Boolean).join(' · ') : '';
  return {rows, fit, label: (F && F.label) || (C && C.label) || mk}; }
function facBars(rows){ const mx = Math.max(...rows.map(r => r.share));
  return `<div class="fac">${rows.map(r => `<div class="fb"><div class="nm">${esc(r.name)}<span>${esc(FAM[r.id[0]] || '')}${r.how ? ' · ' + esc(r.how) : ''}</span></div><div><div class="bar"><span style="left:0;width:${r.share / mx * 100}%;background:${r.dir >= 0 ? 'var(--edge)' : 'var(--loss)'};opacity:.8"></span></div><div class="sub m" style="text-align:right;margin-top:3px">${(r.share * 100).toFixed(1)}% ${r.dir >= 0 ? '↑' : '↓'}</div></div></div>`).join('')}</div>`; }
function factorPage(d, mk){ const R = factorRows(d, mk);
  if(!R) return `<div class="group pad"><h3>The 25 questions</h3><p class="sub" style="margin:6px 0 0">Not available for this prop in this slate's export.</p></div>`;
  const top = R.rows.slice(0, 3);
  return `<button class="faccard" data-facpage="${esc(mk)}"><div class="fh"><span class="eyebrow">Step 1 · the questions</span><b>${esc(R.label)}: ${R.rows.length} questions</b><span class="sub">The biggest three, by share of the score</span></div>
    <div class="mini">${top.map(r => `<div><span>${esc(r.name)}</span><i style="width:${Math.round(r.share / top[0].share * 100)}%;background:${r.dir >= 0 ? 'var(--edge)' : 'var(--loss)'}"></i></div>`).join('')}</div>
    <span class="go">See all ${R.rows.length} ${ICON.chev}</span></button>`; }
function openFactorPage(d, mk){ const R = factorRows(d, mk); if(!R) return;
  pushSheet(`${R.label} · questions`, `<div class="body"><div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(R.label)}</span><h1>The ${R.rows.length} questions</h1><p>Every player's ${esc(R.label.toLowerCase())} report card adds up these answers. Each weight was learned from this prop's own history${R.fit ? ': ' + esc(R.fit) : ''}.</p></div>
    <div class="group pad" style="display:grid;gap:14px">${facBars(R.rows)}<div class="legend"><span><i style="background:var(--edge)"></i>more of it, higher score</span><span><i style="background:var(--loss)"></i>more of it, lower score</span></div></div></div>`); }
function pvlStrip(p){ const lo0 = p.range80 && p.range80[0], hi0 = p.range80 && p.range80[1]; const L = p.line, O = p.opener && p.opener.line, P = p.projection;
  if(!isNum(L) || !isNum(P)) return ''; const vals = [L, P, lo0, hi0, O].filter(isNum); let a = Math.min(...vals), b = Math.max(...vals); const pad = (b - a) * .08 || 1; a -= pad; b += pad;
  const x = v => ((v - a) / (b - a) * 100).toFixed(2) + '%'; const good = p.side === 'under' ? P < L : P >= L;
  return `<div class="pvl" aria-hidden="true"><div class="tr"></div>${isNum(lo0) && isNum(hi0) ? `<div class="rg" style="left:${x(lo0)};width:calc(${x(hi0)} - ${x(lo0)})"></div>` : ''}${isNum(O) ? `<div class="op" style="left:${x(O)}"></div>` : ''}<div class="ln" style="left:${x(L)}"></div><div class="pj" style="left:${x(P)};--c:${good ? 'var(--edge)' : 'var(--fair)'}"></div></div>`; }
function propRow(p, d){ const o = p.opener; const r = resultOf(d, p); const os = o ? o[p.side === 'under' ? 'under' : 'over'] : null;
  return `<button class="row tap" data-prop="${esc(p.id)}"><div style="min-width:0"><div class="nm">${esc(p.player)}</div><div class="mt">${teamOpp(p)} · ${esc(selText(p))}</div></div>
    <div class="rt">${scoreChip(p)}<span>proj ${ln(p.projection)}</span></div>
    <div class="pl">${pvlStrip(p)}<div style="display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;margin-top:8px">${isNum(p.line) ? `<span class="price">${ln(p.line)} ${isNum(p.odds) ? od(p.odds) + ' ' : ''}<b>${esc(p.book || '')}</b>${isNum(p.odds) ? '' : ' <span class="na" style="font-family:var(--f-ui)">· no price</span>'}</span>` : `<span class="na b13">No line posted</span>`}
      <span class="openbig">Open <b>${o && isNum(o.line) ? ln(o.line) + (isNum(os) ? ' ' + od(os) : '') : o && isNum(o.over) ? od(o.over) : 'n/a'}</b></span>${resultTag(r)}</div></div></button>`; }
function viewProps(d){ const mks = marketsOf(d); if(!S.props.mk || !mks.includes(S.props.mk)) S.props.mk = mks[0]; const mk = S.props.mk;
  const all = d.props.filter(p => p.market === mk); const mode = S.props.mode;
  const v4 = isV4(d); const v4pick = (p, m) => m === 'strong' ? p.tier === 'lean' : m === 'weak' ? !!p.no_prediction : isNum(p.line);
  const pick = p => v4 ? v4pick(p, mode) : mode === 'strong' ? cardKind(p) === 'strong' : mode === 'weak' ? cardKind(p) === 'weak' : p.odds != null;
  const list = all.filter(pick).filter(p => S.win === 'all' || p.window === S.win).sort((a, b) => (d.meta.windows.indexOf(a.window) - d.meta.windows.indexOf(b.window)) || ((b.odds != null) - (a.odds != null)) || (v4 ? (b.p_raw || 0) - (a.p_raw || 0) : Math.abs(b.score25 || 0) - Math.abs(a.score25 || 0)));
  const cnt = k => v4 ? d.props.filter(p => p.market === k && v4pick(p, mode)).length : d.props.filter(p => p.market === k && cardKind(p) === (mode === 'all' ? cardKind(p) : mode) && (mode !== 'all' || p.odds != null)).length;
  const groups = []; list.slice(0, S.props.n).forEach(p => { const g = groups.find(x => x.w === p.window); if(g) g.ps.push(p); else groups.push({w: p.window, ps: [p]}); });
  const q = S.props.q.trim().toLowerCase();
  const hits = q.length >= 2 ? Object.values(d.byPlayer).map(ps => ps[0]).filter(p => p.player.toLowerCase().includes(q)).slice(0, 12) : [];
  return `<div class="view">
    <div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(d.meta.label || '')}</span><h1>Props</h1><p>${v4 ? 'Every number comes from the trained model: projection, 80% range and the calibrated chance on the side it favors. Leans need a market where the model beat the line out of sample.' : 'Each prop has its own 25 questions, learned from that prop\'s history. The board shows projection against the best line found, with the opening line marked.'}</p></div>
    <div class="fld search"><label for="pq" class="sr">Find a player</label>${Icon.svg('search', {size: 18})}<input id="pq" type="search" inputmode="search" autocomplete="off" placeholder="Search ${Object.keys(d.byPlayer).length} players" value="${esc(S.props.q)}"></div>
    <div id="phits">${hits.length ? `<div class="list">${hits.map(p => `<button class="row" data-player="${esc(p.pkey)}"><div><div class="nm">${esc(p.player)}</div><div class="mt">${teamOpp(p)} · ${(d.byPlayer[p.pkey] || []).length} props</div></div><div class="rt">${ICON.chev}</div></button>`).join('')}</div>` : q.length >= 2 ? `<p class="sub">No player matches “${esc(S.props.q)}”.</p>` : ''}</div>
    <div class="chips" role="tablist" aria-label="Prop type">${mks.map(k => `<button class="chip tap" data-mk="${k}" aria-pressed="${k === mk}">${Icon.svg(k, {size: 18})}${esc((all.find(p => p.market === k) || d.props.find(p => p.market === k)).market_label)}<span class="n">${cnt(k)}</span></button>`).join('')}</div>
    ${v4 ? '' : factorPage(d, mk)}
    <div class="seg" role="group" aria-label="Which cards" data-seg="mode"><button data-m="strong" aria-pressed="${mode === 'strong'}">${v4 ? 'Leans' : 'Strong +1.5'}</button><button data-m="weak" aria-pressed="${mode === 'weak'}">${v4 ? 'No prediction' : 'Weak −1.5'}</button><button data-m="all" aria-pressed="${mode === 'all'}">${v4 ? 'All lines' : 'All priced'}</button></div>
    ${windowSeg(d, S.win, 'pwin')}
    <div class="legend"><span><i style="background:var(--edge);border-radius:50%"></i>projection, bet side</span><span><i style="background:var(--t1);width:2px"></i>best line</span><span><i style="background:var(--brass);width:2px"></i>opening line</span><span><i style="background:rgba(var(--w),.12)"></i>80% range</span></div>
    ${list.length ? groups.map(g => `<div class="list"><div class="wl">${esc(g.w)}<span>${g.ps.length}</span></div>${g.ps.map(p => propRow(p, d)).join('')}</div>`).join('') : `<div class="group pad"><h3>No players here</h3><p class="sub" style="margin:6px 0 0">${mode === 'strong' ? 'No player has a report card above +1.5 for this prop' : mode === 'weak' ? 'No player has a report card at −1.5 or below for this prop' : 'No priced props'}${S.win !== 'all' ? ' in this window' : ''}.</p></div>`}
    ${list.length > S.props.n ? `<div id="more-sentinel" class="sub" style="text-align:center;padding:12px">Loading more…</div>` : ''}
  </div>`; }
function wireProps(d){ const m = $('#main'); bindTaps(m, d);
  $$('[data-mk]', m).forEach(b => b.onclick = () => { S.props.mk = b.dataset.mk; S.props.n = 50; render(); });
  $$('[data-seg="mode"] button', m).forEach(b => b.onclick = () => { S.props.mode = b.dataset.m; S.props.n = 50; render(); });
  $$('[data-seg="pwin"] button', m).forEach(b => b.onclick = () => { S.win = b.dataset.w; render(); });
  $$('[data-facpage]', m).forEach(b => b.onclick = () => openFactorPage(d, b.dataset.facpage));
  const q = $('#pq', m); q.oninput = () => { S.props.q = q.value; const pos = q.selectionStart; clearTimeout(q._t); q._t = setTimeout(() => { const keep = window.scrollY; render().then(() => { const n = $('#pq'); if(n){ n.focus({preventScroll: true}); try{ n.setSelectionRange(pos, pos); }catch(e){} window.scrollTo(0, keep); } }); }, 160); };
  const sen = $('#more-sentinel', m); if(sen && 'IntersectionObserver' in window){ const io = new IntersectionObserver(es => { if(es.some(e => e.isIntersecting)){ io.disconnect(); S.props.n += 60; const y = window.scrollY; render().then(() => window.scrollTo(0, y)); } }, {rootMargin: '600px'}); io.observe(sen); }
  swipeWindows(m, d, () => S.win, w => { S.win = w; render(); }); }

/* ================================================================ live */
const liveProps = d => d.props.filter(p => p.live && p.live.cps && p.live.cps.length);
function viewLive(d){ const L = liveProps(d); const inW = p => S.liveWin === 'all' || p.window === S.liveWin;
  const rows = L.filter(inW).sort((a, b) => (d.meta.windows.indexOf(a.window) - d.meta.windows.indexOf(b.window)) || Math.abs(b.score25 || 0) - Math.abs(a.score25 || 0));
  const groups = []; rows.forEach(p => { const g = groups.find(x => x.w === p.window); if(g) g.ps.push(p); else groups.push({w: p.window, ps: [p]}); });
  return `<div class="view">
    <div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(d.meta.label || '')}</span><h1>Live</h1></div><div id="livenow">${liveNowHTML(d)}</div>
    <div class="lt" style="margin-top:12px"><h2>Live watch plans</h2><p>${LP && LP.markets ? 'The model\'s strongest props with their checkpoint plan: where he should be at halftime on pace, and the number that makes the over live. Tap for end Q1, half and end Q3 by score.' : 'Players with a high or low report card. If the first quarter or half goes against the card, the model has a buy number ready. Tap a player to check a live line.'}</p></div>
    ${L.length ? windowSeg(d, S.liveWin, 'lwin', w => L.filter(p => w === 'all' || p.window === w).length) : ''}
    ${watchPlansHTML(d)}
    ${groups.length ? groups.map(g => `<div class="list"><div class="wl">${esc(g.w)}<span>${g.ps.length}</span></div>${g.ps.map(p => liveRow(p)).join('')}</div>`).join('') : watchPlansHTML(d) ? '' : `<div class="group pad"><h3>No live-watch plans</h3><p class="sub" style="margin:6px 0 0">This slate exported no live-watch scenarios${S.liveWin !== 'all' ? ' in this window' : ''}.</p></div>`}
  </div>`; }
function liveRow(p){ const L = p.live, buy = L.plan === 'BUY LOW';
  return `<button class="row" data-live="${esc(p.id)}"><div><div class="nm">${esc(p.player)}</div><div class="mt">${teamOpp(p)} · ${esc(p.market_label)}</div></div><div class="rt">${scoreChip(p)}<span>open ${ln(L.open ?? p.line)}</span></div>
    <div class="pl" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px"><span class="tag live">${buy ? '↑ Buy low · over' : '↓ Sell high · under'}</span><span class="sub m">Q1 ${esc(L.q1_trigger || '—')} · Half ${esc(L.ht_trigger || '—')}</span>${isNum(L.number) ? `<span class="sub">ready at <b class="m" style="color:var(--text)">${ln(L.number)}</b></span>` : ''}</div></button>`; }
function wireLive(d){ const m = $('#main'); bindTaps(m, d); applyProgress(m, d); liveLoop(d); $$('[data-live]', m).forEach(b => b.onclick = () => openLive(d, b.dataset.live)); $$('[data-seg="lwin"] button', m).forEach(b => b.onclick = () => { S.liveWin = b.dataset.w; render(); }); swipeWindows(m, d, () => S.liveWin, w => { S.liveWin = w; render(); }); }
/* scenario matching for the live calculator */
function scenTest(s){ let m; s = String(s); if((m = s.match(/^Up (\d+)\+/i))) return {k: 'up', n: +m[1]}; if((m = s.match(/^Down (\d+)\+/i))) return {k: 'down', n: +m[1]}; if(/within one score/i.test(s)) return {k: 'within', n: 8}; if((m = s.match(/^Within (\d+)/i))) return {k: 'within', n: +m[1]}; if(/tied/i.test(s)) return {k: 'within', n: 0}; return null; }
function pickScen(rows, margin){ const t = rows.map(r => ({r, t: scenTest(r.scen)})).filter(x => x.t);
  const ud = t.filter(x => (x.t.k === 'up' && margin >= x.t.n) || (x.t.k === 'down' && margin <= -x.t.n)).sort((a, b) => b.t.n - a.t.n); if(ud.length) return ud[0].r;
  const w = t.filter(x => x.t.k === 'within' && Math.abs(margin) <= x.t.n).sort((a, b) => a.t.n - b.t.n); return w.length ? w[0].r : null; }
function trigOK(trig, v){ const m = String(trig || '').match(/([≤≥<>])\s*([\d.]+)/); if(!m) return null; const n = +m[2]; return m[1] === '≤' || m[1] === '<' ? v <= n : v >= n; }
function interp(lad, L){ const pts = lad.map(r => [r[0], r[1]]).sort((a, b) => a[0] - b[0]); if(!pts.length || L < pts[0][0] || L > pts[pts.length - 1][0]) return null;
  for(let i = 0; i < pts.length; i++){ if(pts[i][0] === L) return pts[i][1]; if(pts[i][0] > L){ const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (L - x0) / (x1 - x0); } } return null; }
function liveCalc(p, inp){ const L = p.live, buy = L.plan === 'BUY LOW'; const cp = (L.cps || []).find(c => c.cp === inp.cp); const out = {buy, cp};
  if(!cp) return Object.assign(out, {state: 'na', why: `No ${inp.cp.toLowerCase()} replays for this player.`});
  if(!isNum(inp.stat) || !isNum(inp.line) || !isNum(inp.odds) || !isNum(inp.us) || !isNum(inp.them)) return Object.assign(out, {state: 'wait'});
  const ok = trigOK(cp.trig, inp.stat); if(ok === false) return Object.assign(out, {state: 'na', why: `The model only has replays where he is ${cp.trig} at ${inp.cp.toLowerCase()}. ${inp.stat} is outside them, so there is no model number.`});
  const row = pickScen(cp.rows, inp.us - inp.them); if(!row) return Object.assign(out, {state: 'na', why: 'No replay scenario matches this score.'});
  if(isNum(row.n) && row.n < 300) return Object.assign(out, {state: 'na', why: `Only ${row.n} replays match this spot. The model needs 300 before it sets a number.`, row});
  const p0 = interp(row.lad, inp.line); if(p0 == null){ const ls = row.lad.map(r => r[0]); return Object.assign(out, {state: 'na', why: `The model's ladder for this spot runs from ${Math.min(...ls)} to ${Math.max(...ls)}. A live line of ${inp.line} is outside it.`, row}); }
  const other = 1 - p0; const be = am2p(inp.odds); const edge = (p0 - be) * 100;
  const rungs = row.lad.slice().sort((a, b) => a[0] - b[0]); const rung = buy ? rungs.find(r => r[0] >= inp.line) : rungs.slice().reverse().find(r => r[0] <= inp.line);
  const bi = LPRICES.findIndex(b => am2p(b) >= be - 1e-9); const units = rung && bi >= 0 ? rung[2 + bi] : 0;
  return Object.assign(out, {state: 'ok', row, p: p0, other, be, edge, rung, units: units || 0, bucket: bi >= 0 ? LPRICES[bi] : null}); }
function openLive(d, id){ const p = d.props.find(x => x.id === id); if(!p) return; const L = p.live, buy = L.plan === 'BUY LOW';
  const st = store.d.ui.calc && store.d.ui.calc[id] || {cp: 'Halftime', odds: -115};
  const cps = L.cps.map(c => c.cp);
  const html = `<div class="body">
    <div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(p.window || '')} · ${p._g ? kickET(p._g.kick_utc) : ''}</span><h1 style="font-size:clamp(30px,8vw,40px)"><button class="link" data-player="${esc(p.pkey)}" style="font:inherit;color:var(--text);padding:0;min-height:0;text-align:left">${esc(p.player)}</button></h1><p>${esc(p.market_label)} · opened ${ln(L.open ?? p.line)} · 25D ${sg(p.score25, 1)}</p></div>
    <div class="group pad" style="display:grid;gap:8px"><span class="tag live" style="justify-self:start">${buy ? '↑ Buy low · bet the over' : '↓ Sell high · bet the under'}</span>
      <p style="margin:0" class="soft">${buy ? `If he is slow early (end of Q1 ${esc(L.q1_trigger)}, or halftime ${esc(L.ht_trigger)}), the model buys the over below the opener.` : `If he is hot early (end of Q1 ${esc(L.q1_trigger)}, or halftime ${esc(L.ht_trigger)}), the model sells the under above the opener.`} Built from ${(L.replays_with_trigger || 0).toLocaleString()} replays where that happened.</p></div>
    <div class="calc" id="calc"><h2>Live calculator</h2>
      <div class="seg" data-cps>${cps.map(c => `<button data-cp="${esc(c)}" aria-pressed="${st.cp === c}">${esc(c)}</button>`).join('')}</div>
      <div id="c-out"></div>
      <div class="fgrid"><div class="fld"><label for="c-stat">His ${esc(STATWORD[p.market] || 'stat')} now</label><input id="c-stat" inputmode="decimal" type="number" step="any" value="${st.stat ?? ''}" placeholder="0"></div>
        <div class="fld"><label for="c-line">Live line</label><input id="c-line" inputmode="decimal" type="number" step="0.5" value="${st.line ?? ''}" placeholder="${ln(L.number ?? p.line)}"></div>
        <div class="fld"><label for="c-us">${esc(p.team)} score</label><input id="c-us" inputmode="numeric" type="number" value="${st.us ?? ''}" placeholder="0"></div>
        <div class="fld"><label for="c-them">${esc(p.opp || 'Opp')} score</label><input id="c-them" inputmode="numeric" type="number" value="${st.them ?? ''}" placeholder="0"></div>
        <div class="fld" style="grid-column:1 / -1"><label for="c-odds">Price on the ${buy ? 'over' : 'under'}</label><input id="c-odds" inputmode="numeric" type="text" value="${st.odds ?? -115}"></div></div>
      <p class="note" style="margin:0">Chances come from the player's shipped replay ladders, read on this phone. Stakes come from the model's own ladder for that spot, which already includes its haircuts and the tougher bar at the end of Q1. Whole-number lines can push.</p></div>
    <section class="sec"><div class="hd"><h2>Pre-built scenarios</h2></div><div class="seg" data-scps>${cps.map(c => `<button data-scp="${esc(c)}" aria-pressed="${(S.scp || 'Halftime') === c}">${esc(c)}</button>`).join('')}</div><div id="scen"></div></section>
    <div class="btns"><button class="btn" data-openprop>Report card</button><button class="btn primary" data-log2>${ICON.plus}Log bet</button></div>
  </div>`;
  pushSheet(p.player + ' · live', html, el => { bindTaps(el, d);
    const draw = () => { const v = id => { const x = $(id, el).value.trim(); return x === '' ? null : Number(x.replace('−', '-')); }; const inp = {cp: st.cp, stat: v('#c-stat'), line: v('#c-line'), us: v('#c-us'), them: v('#c-them'), odds: v('#c-odds')};
      Object.assign(st, inp); store.d.ui.calc = store.d.ui.calc || {}; store.d.ui.calc[id] = st; store.save();
      const r = liveCalc(p, inp); const o = $('#c-out', el);
      if(r.state === 'wait'){ o.innerHTML = `<div class="verdictbox"><div class="vw" style="color:var(--soft)">Enter the live numbers</div><div class="sub">Stat, score, live line and price.</div></div>`; return; }
      if(r.state === 'na'){ o.innerHTML = `<div class="verdictbox"><div class="vw" style="color:var(--soft)">Not available</div><div class="soft" style="font-size:14.5px">${esc(r.why)}</div></div>`; return; }
      const side = buy ? 'Over' : 'Under', oside = buy ? 'Under' : 'Over'; const bet = r.units > 0; const cls = bet ? 'bet' : r.edge >= 0 ? 'fair' : 'pass';
      o.innerHTML = `<div class="verdictbox ${cls}"><div class="eyebrow">${esc(r.row.scen)} · ${pc(r.row.freq)} of replays</div><div class="vw">${bet ? 'Bet zone' : r.edge >= 0 ? 'Fair · pass' : 'Pass'}</div>
        <div class="sides"><div class="side"><div class="l"><span>${side} ${ln(inp.line)}</span><b>${pc(r.p)}</b></div><div class="bar"><span style="width:${r.p * 100}%;background:${bet ? 'var(--edge)' : 'var(--fair)'}"></span></div></div>
        <div class="side"><div class="l"><span>${oside} ${ln(inp.line)}</span><b>${pc(r.other)}</b></div><div class="bar"><span style="width:${r.other * 100}%;background:var(--pass)"></span></div></div></div>
        <div class="soft" style="font-size:14.5px">Price ${od(inp.odds)} needs ${pc(r.be, 1)}. Edge <b class="m">${sg(r.edge, 1)}</b> pts. ${bet ? `Model stake: <b>${r.units}u</b> (its ladder at ${ln(r.rung[0])}, ${od(r.bucket)}).` : r.bucket == null ? 'The model does not size prices worse than −140.' : 'The model would not stake this.'}</div>
        <div class="sub">${lossLine(r.p)}</div></div>`; };
    const drawScen = () => { const c = L.cps.find(x => x.cp === (S.scp || 'Halftime')) || L.cps[0];
      $('#scen', el).innerHTML = `<div class="group pad"><div class="sub" style="margin-bottom:6px">Trigger: his stat ${esc(c.trig)} at ${esc(c.cp.toLowerCase())}. Each chip: live line · chance the ${buy ? 'over' : 'under'} cashes · model stake at −115.</div><div class="scen">${c.rows.map(r => `<div class="sr2"><b>${esc(r.scen)}</b><span class="sub m">${pc(r.freq)} · ${(r.n || 0).toLocaleString()} replays</span>
        ${isNum(r.n) && r.n < 300 ? `<div class="ladder"><span class="sub">Not enough replays for a number.</span></div>` : `<div class="ladder">${r.lad.map(x => `<div class="rung ${x[3] > 0 ? 'u' : ''}"><b>${ln(x[0])}</b><span>${pc(x[1])}${x[3] > 0 ? ' · ' + x[3] + 'u' : ''}</span></div>`).join('')}</div>`}</div>`).join('')}</div></div>`; };
    $$('[data-cp]', el).forEach(b => b.onclick = () => { st.cp = b.dataset.cp; $$('[data-cp]', el).forEach(x => x.setAttribute('aria-pressed', x === b)); draw(); });
    $$('[data-scp]', el).forEach(b => b.onclick = () => { S.scp = b.dataset.scp; $$('[data-scp]', el).forEach(x => x.setAttribute('aria-pressed', x === b)); drawScen(); });
    $$('#calc input', el).forEach(i => i.oninput = draw); draw(); drawScen();
    $('[data-openprop]', el).onclick = () => openProp(d, p.id);
    $('[data-log2]', el).onclick = () => { const v = $('#c-line', el).value, o = $('#c-odds', el).value; logBet(d, p, {live: true, line: v === '' ? null : +v, odds: o === '' ? null : +o.replace('−', '-'), side: buy ? 'over' : 'under'}); }; }); }

/* ================================================================ sheets (pushed screens) */
const STACK = [];
function pushSheet(title, html, after){ const el = document.createElement('section'); el.className = 'page'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="sbar"><div class="col"><button class="back" aria-label="Back">${ICON.back}Back</button><div class="ttl">${esc(title)}</div><span style="width:64px"></span></div></div><div class="col">${html}</div>`;
  $('#sheets').appendChild(el); if(STACK.length) STACK[STACK.length - 1].classList.add('under'); STACK.push(el); document.documentElement.style.overflow = 'hidden';
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  $('.back', el).onclick = popSheet; el.addEventListener('scroll', () => el.classList.toggle('scrolled', el.scrollTop > 60), {passive: true});
  edgeSwipe(el); if(after) after(el); countUp(el); return el; }
function popSheet(){ const el = STACK.pop(); if(!el) return; el.classList.remove('on'); const prev = STACK[STACK.length - 1]; if(prev) prev.classList.remove('under'); else document.documentElement.style.overflow = '';
  setTimeout(() => el.remove(), RM ? 0 : 240); }
function edgeSwipe(el){ let x0 = null, y0 = null, dx = 0;
  el.addEventListener('touchstart', e => { const t = e.touches[0]; if(t.clientX > 28) return; x0 = t.clientX; y0 = t.clientY; dx = 0; el.style.transition = 'none'; }, {passive: true});
  el.addEventListener('touchmove', e => { if(x0 == null) return; const t = e.touches[0]; dx = Math.max(0, t.clientX - x0); if(Math.abs(t.clientY - y0) > 40 && dx < 20){ x0 = null; el.style.transform = ''; el.style.transition = ''; return; } el.style.transform = `translateX(${dx}px)`; }, {passive: true});
  el.addEventListener('touchend', () => { if(x0 == null) return; x0 = null; el.style.transition = ''; el.style.transform = ''; if(dx > 90) popSheet(); }); }

/* ================================================================ prop report card */
function ringSVG(p, be, size = 132){ return Charts.ring({p: isNum(p) ? p : 0, be: isNum(be) ? be : null, size, stroke: size > 100 ? 12 : 9}); }
function histSVG(p, actual, w){ const H = p.hist; if(!H || !H.counts || !H.counts.length) return ''; const yes = p.market === 'atd' || p.market === 'qb_atd';
  const W = Math.max(280, Math.round(w || 340)); const bet = p.tier === 'bet'; const pSide = isNum(p.p) ? p.p : null;
  return `<div class="chart">${Charts.density({hist: H, line: isNum(p.line) ? p.line : .5, side: p.side === 'under' ? 'under' : 'over', proj: isNum(p.projection) ? p.projection : null, pLabel: pSide != null && !yes ? Math.round(pSide * 100) + '%' : '', color: bet ? 'var(--edge)' : 'var(--fair)', actual: isNum(actual) ? actual : null, w: W, h: Math.round(Math.min(220, W * .56))})}</div>
    <div class="legend"><span><i style="background:${bet ? 'var(--edge)' : 'var(--fair)'};opacity:.5"></i>replays where the ${p.side === 'under' ? 'under' : 'over'} cashes</span><span><i style="background:var(--t3);width:2px"></i>projection ${ln(p.projection)}</span>${isNum(actual) ? `<span><i style="background:var(--live);width:2px"></i>final ${ln(actual)}</span>` : ''}<span>${(H.n || 10000).toLocaleString()} replays${H.clipped_at ? ` · tail capped at ${ln(H.clipped_at)}` : ''}</span></div>`; }
function q25Bars(d, p){ const rows = q25Named(d, p).slice().sort((a, b) => b[2] - a[2]); if(!rows.length) return ''; const mx = Math.max(.01, ...rows.map(r => Math.abs(r[2])));
  return `<div style="display:grid;gap:2px">${rows.map(r => `<div class="fbar"><div class="nm">${esc(r[1])}<span>${esc(FAM[r[0][0]] || '')}</span></div><div class="tr"><span class="${r[2] >= 0 ? 'up' : 'dn'}" style="width:${Math.abs(r[2]) / mx * 50}%"></span></div><div class="v">${sg(r[2], 2)}</div></div>`).join('')}</div>`; }
function famBars(p){ const f = p.families || {}; const ks = Object.keys(FAM).filter(k => isNum(f[k])); if(!ks.length) return ''; const mx = Math.max(1, ...ks.map(k => Math.abs(f[k])));
  return `<div style="display:grid;gap:4px">${ks.map(k => `<div class="fbar"><div class="nm">${FAM[k]}<span>${f[k] >= 0 ? 'pushes up' : 'pulls down'}</span></div><div class="tr"><span class="${f[k] >= 0 ? 'up' : 'dn'}" style="width:${Math.abs(f[k]) / mx * 50}%"></span></div><div class="v">${sg(f[k], 2)}</div></div>`).join('')}</div>`; }
function factorList(list, up){ if(!list || !list.length) return `<p class="sub" style="margin:0">None stood out.</p>`; return `<div class="checks">${list.map(f => `<div class="ck"><i class="${up ? 'ok' : 'no'}">${up ? '↑' : '↓'}</i><div><b style="font-weight:600">${esc(f.name)}</b> <span class="m sub">${sg(f.v, 2)}</span><div class="sub">${esc(f.how || '')}</div></div></div>`).join('')}</div>`; }
function rulesList(p){ const L = p.lights || {}; const rows = [['card', `Report card ${L.card_kind ? `(${L.card_kind})` : ''} on the bet side`], ['proj', 'Projection on the bet side of the line'], ['play', 'Play chance of at least 50%'], ['edge', 'Edge of 5 or more after the market check'], ['gap', `Projection and line within 50%${isNum(L.gap_pct) ? ` (gap ${L.gap_pct}%)` : ''}`]];
  return `<div class="checks">${rows.map(([k, t]) => `<div class="ck"><i class="${L[k] === true ? 'ok' : L[k] === false ? 'no' : 'na'}">${L[k] === true ? '✓' : L[k] === false ? '✕' : '–'}</i><div>${esc(t)}</div></div>`).join('')}</div>`; }
function tierTag(p){ return p.tier === 'bet' ? '<span class="tag edge">Bet · passes both keys</span>' : p.tier === 'live' ? '<span class="tag live">Live watch</span>' : p.tier === 'lean' ? '<span class="tag">Information only</span>' : p.tier === 'check' ? '<span class="tag">Check news</span>' : '<span class="tag">Pass</span>'; }
async function openProp(d, id){ const p = d.props.find(x => x.id === id); if(!p) return; const r = resultOf(d, p); const av = p.availability || {}; const o = p.opener;
  const pm = isNum(p.p) ? p.p : isNum(p.p_raw) ? p.p_raw : null; const modelOnly = !isNum(p.p) && isNum(p.p_raw);
  const pOver = isNum(pm) ? (p.side === 'under' ? 1 - pm : pm) : null, pUnder = isNum(pOver) ? 1 - pOver : null; const rawOver = isNum(p.p_raw) ? (p.side === 'under' ? 1 - p.p_raw : p.p_raw) : null;
  const yes = p.market === 'atd' || p.market === 'qb_atd'; const sp = d.sport.toLowerCase();
  const offers = (p.offers || []).filter(x => x.book); const bestDec = (k) => Math.max(...offers.filter(x => isNum(x[k]) && x.line === p.line).map(x => decOdds(x[k])), -1);
  const inj = await injuryFor(d.sport, p.pkey); const info = slateInfo(d.id) || {}; const upcoming = slateStatus(info).k !== 'final';
  const Q = q25Named(d, p); const vac = Q.find(q => /vacated/i.test(q[1]));
  const tierPill = p.no_prediction ? '<span class="pill pill-pass">No prediction</span>' : p.tier === 'bet' ? '<span class="pill pill-bet">Bet</span>' : p.tier === 'live' ? '<span class="pill pill-live">Live watch</span>' : p.tier === 'lean' ? '<span class="pill pill-fair">Information only</span>' : p.tier === 'check' ? '<span class="pill pill-live">Check news</span>' : '<span class="pill pill-pass">Pass</span>';
  const resPill = r && r.result ? (r.result === 'won' ? '<span class="pill pill-edge">Won</span>' : r.result === 'lost' ? '<span class="pill pill-loss">Lost</span>' : `<span class="pill pill-fair">${r.result === 'push' ? 'Push' : 'Void'}</span>`) : '';
  const html = `<div class="body">
    <div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(winWord(p.window))}${p._g ? esc(dayET(p._g.kick_utc)) + ' · ' + kickET(p._g.kick_utc) : esc(p.window || '')}</span>
      <button class="rc-name tap" data-player="${esc(p.pkey)}">${esc(p.player)}${Icon.svg('chev')}</button>
      <p>${teamOpp(p)} · ${esc(p.market_label)}</p></div>
    <div class="rchero">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${tierPill}${resPill}${isNum(r && r.actual) ? `<span class="t2 b15">Final <b class="num" style="color:var(--t1)">${ln(r.actual)}</b></span>` : ''}</div>
      <div class="rc-top">${p.no_prediction ? '' : ringSVG(pm, p.break_even, 132)}<div style="min-width:0"><div class="rc-sel">${esc(selText(p))}</div>
        <div class="rc-px">${isNum(p.odds) ? `<span class="num">${od(p.odds)}</span><b>${esc(p.book || '')}</b>` : `<span>${isNum(p.line) ? `Line <b class="num" style="color:var(--t1)">${ln(p.line)}</b> at <b>${esc(p.book || '')}</b> · ` : ''}<span class="na">price not posted</span></span>`}</div></div></div>
      ${isNum(pm) ? Charts.meter({p: pm, be: isNum(p.break_even) ? p.break_even : null, label: isNum(p.break_even) ? `Price needs ${pc(p.break_even, 1)}` : modelOnly ? 'Model chance, before the market check' : 'Model chance'}) : ''}
      <div class="rc-nums"><div><span class="label">Projection</span><span class="num">${ln(p.projection)}</span></div><div><span class="label">Edge</span><span class="num" style="color:${isNum(p.edge_pts) && p.edge_pts >= 5 ? 'var(--edge)' : isNum(p.edge_pts) && p.edge_pts < 0 ? 'var(--loss)' : 'var(--t1)'}">${sg(p.edge_pts)}</span></div><div><span class="label">25D</span><span class="num" style="color:${cardKind(p) === 'strong' ? 'var(--edge)' : cardKind(p) === 'weak' ? 'var(--loss)' : 'var(--t1)'}">${sg(p.score25, 2)}</span></div></div>
      ${p.side && !p.no_prediction ? `<div class="bkrow big">${bookBtns(p)}</div>` : ''}
      ${isNum(pm) ? `<div class="lossline">${lossLine(pm)}${isNum(p.pctile) ? ` · report card beats ${Math.round(p.pctile * 100)}% of history` : ''}</div>` : ''}
    </div>
    ${modelOnly && !yes && !p.no_prediction ? `<section class="sec"><div class="hd"><h2>Check a price</h2><span class="sub">DraftKings price not on ESPN</span></div><div class="calc"><div class="fgrid"><div class="fld"><label for="pc-odds">Price you see on the ${p.side === 'under' ? 'under' : 'over'} ${ln(p.line)}</label><input id="pc-odds" inputmode="numeric" type="text" placeholder="−115"></div><div class="fld"><label>Model chance</label><input value="${pc(pm, 1)}" disabled></div></div><div id="pc-out" class="b15 t2">Enter a price to see what it needs.</div><p class="note" style="margin:0">This compares the price with the model's own replays only. The model's market check needs both sides' prices, so a prop priced here can't become a bet on the card.</p></div></section>` : ''}
    ${prosHTML(d, p.id)}
    ${checkpointHTML(p)}
    ${p.model ? `<section class="sec"><div class="hd"><h2>The model</h2><span class="sub">${esc(p.model)}</span></div><div class="group pad" style="display:grid;gap:10px">
      ${p.no_prediction ? `<div class="t2">The model makes no prediction here.</div>` : `<div class="t2">Calibrated chance <b class="num" style="color:var(--t1)">${pc(p.p_raw, 1)}</b> on the ${esc(p.side)} · raw simulation ${pc(p.p_uncal, 1)}</div>`}
      ${(p.ood || []).length ? `<div><span class="label">Flags</span>${p.ood.map(f => `<div class="soft">• ${esc(f)}</div>`).join('')}</div>` : '<div class="sub">No out-of-distribution flags.</div>'}
      ${!p.no_prediction && ((p.helping || []).length || (p.hurting || []).length) ? `<div><span class="label">Raised the median</span>${(p.helping || []).map(h => `<div class="soft">+ ${esc(h.name)} <span class="num sub">${sg(h.v, 1)}</span></div>`).join('') || '<div class="sub">—</div>'}</div><div><span class="label">Lowered the median</span>${(p.hurting || []).map(h => `<div class="soft">− ${esc(h.name)} <span class="num sub">${sg(h.v, 1)}</span></div>`).join('') || '<div class="sub">—</div>'}</div><p class="note" style="margin:0">Driver sizes are from the gradient-boosted median model, in the stat's units.</p>` : ''}
    </div></section>` : ''}
    ${Q.length ? `<section class="sec"><div class="hd"><h2>The ${Q.length} answers</h2><span class="sub">tap a spoke</span></div>
      <div class="fp"><div class="fp-wrap">${Charts.fingerprint({q25: Q, score: isNum(p.score25) ? p.score25 : 0, size: 320})}</div>
        <div class="fp-tip" id="fp-tip">Longer green spokes push him past his normal game. Red spokes pull him short.</div>
        <div class="fp-legend"><span><i style="background:var(--edge)"></i>pushes up</span><span><i style="background:var(--loss)"></i>pulls down</span></div></div>
      <div class="group pad">${famBars(p)}</div>
      <details class="group pad"><summary class="link" style="list-style:none;cursor:pointer;padding:0;min-height:0">All ${Q.length}, sorted by impact</summary><div style="margin-top:12px">${q25Bars(d, p)}</div></details></section>` : ''}
    <section class="sec"><div class="hd"><h2>Projection</h2><span class="sub m">${ln(p.projection)}${p.range80 && isNum(p.range80[0]) ? ` · 80% ${ln(p.range80[0])}–${ln(p.range80[1])}` : ''}</span></div>
      <div class="group pad" id="dens">${p.hist ? '' : `<p class="sub" style="margin:0">The replay distribution was not exported for this prop.</p>`}</div>
      ${!yes && isNum(pOver) ? `<div class="group pad sides"><div class="side"><div class="l"><span>Over ${ln(p.line)}</span><b>${pc(pOver)}</b></div><div class="bar"><span style="width:${pOver * 100}%;background:${p.side !== 'under' ? 'var(--t1)' : 'var(--pass)'}"></span></div></div>
        <div class="side"><div class="l"><span>Under ${ln(p.line)}</span><b>${pc(pUnder)}</b></div><div class="bar"><span style="width:${pUnder * 100}%;background:${p.side === 'under' ? 'var(--t1)' : 'var(--pass)'}"></span></div></div>
        <div class="sub">Both sides come from the same ${(d.meta.sims_per_game || 10000).toLocaleString()} replays after the market check.${isNum(rawOver) ? ` Before the check: over ${pc(rawOver)}.` : ''}</div></div>` : ''}
      ${d.meta.histogram_note ? `<div class="note">${esc(d.meta.histogram_note)}</div>` : ''}</section>
    <section class="sec"><h2>Availability</h2><div class="group pad avail">
      <div class="st"><b>${esc(av.report || 'No injury designation')}</b><span class="t2 b15">play chance <span class="num">${pc(av.p_play)}</span></span>${av.p_play != null && av.p_play < .9 ? '<span class="pill pill-live">Unconfirmed</span>' : ''}</div>
      <span class="sub">At model time · ${esc(d.meta.injuries_et || 'Not available')}</span>
      ${upcoming ? (inj ? `<div class="st" style="margin-top:8px"><span class="pill ${/out|reserve|suspen/i.test(inj[0]) ? 'pill-loss' : /question|doubt|day/i.test(inj[0]) ? 'pill-live' : 'pill-fair'}">${esc(inj[0])}</span>${inj[1] ? `<span class="t2 b15">${esc(inj[1])}</span>` : ''}</div><div class="com">${esc(inj[5] || '')}</div><span class="sub">${esc(injSource(d.sport))} · ${esc(etTime(inj[4], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}))} ET</span>` : `<span class="sub" style="margin-top:8px">${esc(injSource(d.sport))}: not on the injury report.</span>`) : ''}
      ${vac && Math.abs(vac[2]) >= .05 ? `<div class="ck" style="margin-top:4px"><i class="${vac[2] > 0 ? 'ok' : 'no'}">${vac[2] > 0 ? '↑' : '↓'}</i><div>${vac[2] > 0 ? 'Teammates are missing at his spot. The model hands him part of their share' : 'Teammates who were out at his spot are back, so his share shrinks'}: <b class="num">${sg(vac[2], 2)}</b> on his report card.</div></div>` : ''}</div></section>
    <section class="sec"><h2>The rules</h2><div class="group pad">${rulesList(p)}</div></section>
    <section class="sec"><div class="hd"><h2>Prices</h2><span class="openbig">Open <b>${o && isNum(o.line) ? ln(o.line) : o && isNum(o.over) ? od(o.over) : 'n/a'}</b></span></div>
      <div class="group pad">${offers.length ? `<div class="tbl"><table><thead><tr><th>Book</th><th>Line</th><th>Over</th><th>Under</th></tr></thead><tbody>${offers.map(x => `<tr><td>${x.book === p.book ? `<b>${esc(x.book)}</b>` : esc(x.book)}</td><td>${ln(x.line)}</td><td class="${x.line === p.line && isNum(x.over) && decOdds(x.over) === bestDec('over') && p.side !== 'under' ? 'best' : ''}">${od(x.over)}</td><td class="${x.line === p.line && isNum(x.under) && decOdds(x.under) === bestDec('under') && p.side === 'under' ? 'best' : ''}">${od(x.under)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="sub" style="margin:0">Only the best price was exported: ${isNum(p.odds) ? `${od(p.odds)} at ${esc(p.book)}` : 'Not available'}.</p>`}
        <div class="sub" style="margin-top:8px">${o ? `Opening line from ${esc(d.meta.opener_book || 'the opener feed')}.` : 'Opening line: not available for this prop.'}</div></div></section>
    ${p.live ? `<section class="sec"><h2>Live plan</h2><div class="group pad" style="display:grid;gap:12px"><span class="pill pill-live" style="justify-self:start">${p.live.plan === 'BUY LOW' ? 'Buy low · over' : 'Sell high · under'}</span><span class="t2">End of Q1 <span class="num">${esc(p.live.q1_trigger)}</span> · halftime <span class="num">${esc(p.live.ht_trigger)}</span>${isNum(p.live.number) ? ` · ready at <b class="num" style="color:var(--t1)">${ln(p.live.number)}</b>` : ''}</span><button class="btn tap" data-golive>${Icon.svg('live', {size: 20})}Open live calculator</button></div></section>` : ''}
    ${r && r.result ? `<section class="sec"><h2>Result</h2><div class="group pad t2">${r.result === 'void' ? 'Void: he did not play.' : `Final ${esc(STATWORD[p.market] || '')}: <b class="num" style="color:var(--t1)">${ln(r.actual)}</b> against ${yes ? 'a yes/no market' : 'a line of ' + ln(p.line)}. ${r.result === 'won' ? 'The shown side hit.' : r.result === 'lost' ? 'The shown side missed.' : 'Push.'}`} <span class="sub">${esc(d.results.source || '')}</span></div></section>` : ''}
    <div class="btns"><button class="btn quiet tap" data-share>${Icon.svg('share', {size: 20})}Share</button><button class="btn primary tap" data-logp>${Icon.svg('plus', {size: 20})}Log bet</button></div>
  </div>`;
  pushSheet(`${p.player} · ${selText(p)}`, html, el => { bindTaps(el, d); const gl = $('[data-golive]', el); if(gl) gl.onclick = () => openLive(d, p.id);
    $('[data-logp]', el).onclick = () => logBet(d, p); $('[data-share]', el).onclick = () => shareProp(d, p);
    const dn = $('#dens', el); if(dn && p.hist) requestAnimationFrame(() => { dn.innerHTML = histSVG(p, r && r.actual, dn.clientWidth - 32); });
    wireFingerprint($('.ch-fp', el), Q, $('#fp-tip', el));
    const pci = $('#pc-odds', el); if(pci) pci.oninput = () => { const o = Number(String(pci.value).replace('−', '-').trim()); const out = $('#pc-out', el); if(!isNum(o) || Math.abs(o) < 100){ out.textContent = 'Enter a price like −115 or +105.'; return; } const be = am2p(o), e = (pm - be) * 100; out.innerHTML = `${od(o)} needs <b class="num" style="color:var(--t1)">${pc(be, 1)}</b>. Model chance ${pc(pm, 1)}: <b class="num" style="color:${e >= 0 ? 'var(--edge)' : 'var(--loss)'}">${sg(e, 1)}</b> pts before the market check.`; }; }); }
function q25Named(d, p){ const key = p.q25_key || p.market; const C = (d.meta.cards || {})[key]; if(!p.q25 || !C) return [];
  const nm = {}; C.ids.forEach((id, i) => nm[id] = C.names[i]); return p.q25.filter(q => isNum(q[2])).map(([id, x, c]) => [id, nm[id] || id, c]).sort((a, b) => a[0] < b[0] ? -1 : 1); }
function wireFingerprint(svg, Q, tip){ if(!svg || !Q.length || !tip) return; const sp = $$('line.spoke', svg);
  const pick = e => { const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; const x = vb.x + (e.clientX - r.left) / r.width * vb.width, y = vb.y + (e.clientY - r.top) / r.height * vb.height; const c = 160;
    let a = Math.atan2(y - c, x - c) + Math.PI / 2; if(a < 0) a += 2 * Math.PI; const i = Math.round(a / (2 * Math.PI) * Q.length) % Q.length; const q = Q[i];
    sp.forEach((l, k) => l.classList.toggle('is-on', k === i)); tip.innerHTML = `<span><b>${esc(q[1])}</b> · ${esc(FAM[q[0][0]] || '')} · <b class="num" style="color:${q[2] >= 0 ? 'var(--edge)' : 'var(--loss)'}">${sg(q[2], 2)}</b></span>`; };
  svg.addEventListener('click', pick); }
const INJ = {}; async function injuryFor(sport, pkey){ try{ if(!INJ.all) INJ.all = await getJSON('data/injuries.json'); const PF = await loadPlayers(sport); const P = PF && PF.players && PF.players[pkey]; const t = INJ.all[sport.toLowerCase()];
  return P && P.eid && t && t.by_id ? t.by_id[P.eid] || null : null; }catch(e){ return null; } }
const injSource = sp => sp === 'CFB' ? 'covers.com injury report' : 'ESPN injury report';
/* ================================================================ player profile */
const POSKEYS = {QB: ['pass_yds', 'pass_td', 'rush_yds', 'att'], RB: ['rush_yds', 'car', 'rec', 'rec_yds'], FB: ['rush_yds', 'car', 'rec', 'rec_yds'], WR: ['rec', 'rec_yds', 'tgt', 'rec_td'], TE: ['rec', 'rec_yds', 'tgt', 'rec_td'], K: ['kick_pts', 'fgm', 'fga', 'xpm']};
function profileKeys(sport, P, todays){ if(sport === 'NBA') return ['pts', 'reb', 'ast', 'tpm'];
  if(sport === 'NFL' && POSKEYS[P.pos]) return POSKEYS[P.pos];
  const tot = {}; (P.games || []).forEach(g => g.st && Object.entries(g.st).forEach(([k, v]) => tot[k] = (tot[k] || 0) + (v || 0)));
  if((tot.kick_pts || 0) > 0 && (tot.rush_yds || 0) + (tot.rec_yds || 0) + (tot.pass_yds || 0) === 0) return ['kick_pts', 'fgm', 'fga', 'xpm']; if((tot.pass_yds || 0) > 200) return ['pass_yds', 'pass_td', 'rush_yds', 'cmp']; if((tot.rec_yds || 0) >= (tot.rush_yds || 0)) return ['rec', 'rec_yds', 'rec_td', 'rush_yds']; return ['rush_yds', 'car', 'rush_td', 'rec']; }
function trendSVG(games, key, line){ const g = games.filter(x => x.st).slice(-8); if(!g.length) return ''; const vals = g.map(x => x.st[key] || 0); const W = 600, H = 220, pb = 40, pt = 28; const mx = Math.max(1, ...vals, isNum(line) ? line * 1.15 : 0);
  const bw = W / g.length; const y = v => H - pb - v / mx * (H - pb - pt);
  const bars = g.map((x, i) => { const v = vals[i]; const hit = isNum(line) ? v > line : false; return `<rect x="${(i * bw + bw * .18).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw * .64).toFixed(1)}" height="${(H - pb - y(v)).toFixed(1)}" rx="4" fill="${isNum(line) ? (hit ? 'var(--edge)' : 'var(--line2)') : 'var(--fair)'}" opacity="${isNum(line) && hit ? .85 : 1}"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="${(y(v) - 5).toFixed(1)}" text-anchor="middle" font-size="24" fill="var(--t2)" font-family="ui-monospace,SF Mono,Menlo,monospace">${ln(v)}</text><text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="21" fill="var(--t3)" font-family="-apple-system,system-ui,sans-serif">${esc(x.opp || '')}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Last ${g.length} games">${bars}<line x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}" stroke="var(--line2)"/>${isNum(line) ? `<line x1="0" x2="${W}" y1="${y(line)}" y2="${y(line)}" stroke="var(--brass)" stroke-width="2" stroke-dasharray="6 5"/><text x="${W - 4}" y="${y(line) - 8}" text-anchor="end" font-size="22" fill="var(--brass)" font-family="ui-monospace,SF Mono,Menlo,monospace">line ${ln(line)}</text>` : ''}</svg>`; }
async function openPlayer(sport, key, d){ if(window.openCard && sport === 'NFL'){ const p = d && d.props.find(x => x.pkey === key); return openCard(p ? p.player : key.replace(/^nfl:/, ''), p && p.team, p && ({receptions: 'Receptions', rec_yds: 'Receiving yards', rush_yds: 'Rushing yards', pass_yds: 'Passing yards'})[p.market]); } const PF = await loadPlayers(sport); const P = PF && PF.players && PF.players[key]; const todays = d && d.byPlayer[key] || [];
  const nm = (P && P.name) || (todays[0] && todays[0].player) || 'Player';
  if(!P){ pushSheet(nm, `<div class="body"><div class="lt"><h1>${esc(nm)}</h1><p>Game history is not available for this player.</p></div>${todays.length ? todayChips(todays, d) : ''}</div>`, el => d && bindTaps(el, d)); return; }
  const games = (P.games || []).slice(); const played = games.filter(g => g.st); const inj = await injuryFor(sport, key);
  const statLabel = Object.fromEntries(PF.stats); const keys = profileKeys(sport, P, todays);
  const curSeason = sport === 'NBA' ? played.filter(g => g.d >= '2026-10-01') : sport === 'NFL' ? played.filter(g => g.s === 2026) : played;
  const base = curSeason.length ? curSeason : played; const seasonLbl = sport === 'NBA' ? (curSeason.length ? '2026–27' : '2025–26') : '2026';
  const avg = k => base.length ? base.reduce((a, g) => a + (g.st[k] || 0), 0) / base.length : null;
  const MS = PF.market_stat || {}; const lineFor = k => { const t = todays.find(x => MS[x.market] === k && isNum(x.line)); return t ? t.line : null; };
  const st0 = store.d.ui.pstat && store.d.ui.pstat[sport] && keys.includes(store.d.ui.pstat[sport]) ? store.d.ui.pstat[sport] : (todays.length && MS[todays[0].market] && keys.includes(MS[todays[0].market]) ? MS[todays[0].market] : keys[0]);
  const tc = P.color ? '#' + String(P.color).replace('#', '') : SPORTHEX[sport]; const mono = (P.team || sport).slice(0, 4);
  const cols = (sport === 'NBA' ? ['min', 'pts', 'reb', 'ast', 'tpm'] : keys.slice(0, 4));
  const html = `<div class="body">
    <div class="phero" style="--tc:${esc(tc)}" data-mono="${esc(mono)}"><span class="sp" style="--c:${SPORTHEX[sport]}">${sport}</span><div class="nm">${esc(P.name)}</div>
      <div class="meta"><span>${esc(P.team || '')}</span>${P.pos ? `<span>${esc(P.pos)}</span>` : ''}<span>${played.length} games on file</span></div>${inj ? `<div class="meta" style="align-items:center"><span class="pill ${/out|reserve|suspen/i.test(inj[0]) ? 'pill-loss' : /question|doubt|day/i.test(inj[0]) ? 'pill-live' : 'pill-fair'}">${esc(inj[0])}</span><span>${esc(inj[1] || '')}</span><span class="b13">${esc(injSource(sport))}</span></div>` : ''}</div>
    <section class="sec"><div class="hd"><h2>${seasonLbl} per game</h2><span class="sub">${base.length} games</span></div>
      <div class="statstrip">${keys.map(k => `<div><b data-count="${(avg(k) ?? 0).toFixed(1)}">${isNum(avg(k)) ? avg(k).toFixed(1) : '—'}</b><span>${esc(statLabel[k] || k)}</span></div>`).join('')}</div></section>
    <section class="sec"><div class="hd"><h2>Trend</h2><span class="sub" id="trendnote"></span></div>
      <div class="chips" data-pstat>${keys.concat(sport === 'NBA' ? ['pra', 'stl', 'blk'] : []).filter((k, i, a) => a.indexOf(k) === i).map(k => `<button class="chip" data-k="${k}" aria-pressed="${k === st0}">${esc(statLabel[k] || k)}</button>`).join('')}</div>
      <div class="trend" id="trend"></div></section>
    ${todays.length ? todayChips(todays, d) : ''}
    <section class="sec"><div class="hd"><h2>Game log</h2><span class="sub">newest first</span></div>
      <div class="gl"><table><thead><tr><th>Game</th><th>Result</th>${cols.map(k => `<th>${esc(statLabel[k] || k)}</th>`).join('')}</tr></thead><tbody>
      ${games.slice().reverse().map(g => `<tr><td>${esc(fmtDate(g))}<div class="sub" style="font-size:12px;white-space:nowrap">${esc((g.ha || '') + ' ' + (g.opp || ''))}</div></td><td>${g.dnp ? `<span class="dim">DNP</span>` : esc(g.res || '—')}</td>${cols.map(k => `<td>${g.st ? ln(g.st[k] ?? 0) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="note">${esc(PF.source)}</div></section>
    <section class="sec"><div class="hd"><h2>With the model</h2><span class="sub">${(P.model || []).length} graded looks</span></div>${modelHistory(P.model || [])}</section>
  </div>`;
  pushSheet(P.name, html, el => { if(d) bindTaps(el, d);
    const draw = k => { const L = lineFor(k); $('#trend', el).innerHTML = trendSVG(games, k, L) || `<p class="sub" style="margin:0">No games on file.</p>`; const last = played.slice(-10);
      $('#trendnote', el).textContent = isNum(L) && last.length ? `Over ${ln(L)} in ${last.filter(g => (g.st[k] || 0) > L).length} of last ${last.length}` : `last ${Math.min(8, played.length)} games`; };
    $$('[data-pstat] .chip', el).forEach(b => b.onclick = () => { $$('[data-pstat] .chip', el).forEach(x => x.setAttribute('aria-pressed', x === b)); store.d.ui.pstat = store.d.ui.pstat || {}; store.d.ui.pstat[sport] = b.dataset.k; store.save(); draw(b.dataset.k); });
    draw(st0); }); }
function fmtDate(g){ if(g.d){ const [y, m, dd] = g.d.split('-').map(Number); return `${m}/${dd}${g.post ? ' P' : ''}`; } return g.wk ? `Wk ${g.wk}` : '—'; }
function todayChips(todays, d){ return `<section class="sec"><div class="hd"><h2>On this slate</h2><span class="sub">${todays.length} prop${todays.length > 1 ? 's' : ''}</span></div><div class="list">${todays.slice().sort((a, b) => MKT_ORDER.indexOf(a.market) - MKT_ORDER.indexOf(b.market)).map(p => `<button class="row" data-prop="${esc(p.id)}"><div><div class="nm">${esc(p.market_label)}</div><div class="mt">${isNum(p.line) ? esc(selText(p)) + ' · ' + od(p.odds) + ' ' + esc(p.book || '') : 'No line posted'} · proj ${ln(p.projection)}</div></div><div class="rt">${scoreChip(p)}<span>${esc(p.tier === 'bet' ? 'bet' : p.tier === 'live' ? 'live watch' : p.tier === 'lean' ? 'info only' : p.tier)}</span></div></button>`).join('')}</div></section>`; }
function modelHistory(M){ if(!M.length) return `<div class="group pad"><p class="sub" style="margin:0">The model has not graded this player yet.</p></div>`;
  const g = M.filter(x => x.result === 'won' || x.result === 'lost'); const w = g.filter(x => x.result === 'won').length;
  return `<div class="list">${g.length ? `<div class="wl">Shown side hit ${w} of ${g.length}<span>bets, leans and every priced prop</span></div>` : ''}${M.slice(0, 40).map(x => `<div class="row" style="cursor:default"><div><div class="nm" style="font-size:15px">${esc(x.label || x.slate)} · ${esc(x.market_label || x.market || '')}</div><div class="mt">${x.side ? esc((x.side === 'under' ? 'Under ' : x.side === 'yes' ? 'Yes' : 'Over ') + (isNum(x.line) ? ln(x.line) : '')) : ''}${isNum(x.proj) ? ' · proj ' + ln(x.proj) : ''} · ${esc(x.tier === 'bet' ? 'bet' : x.tier === 'lean' ? 'info only' : x.tier === 'live' ? 'live watch' : x.tier || '')}</div></div><div class="rt">${isNum(x.score25) ? `<span class="score ${x.score25 > 1.5 ? 'up' : x.score25 <= -1.5 ? 'dn' : ''}">${sg(x.score25, 1)}</span>` : ''}${resultTag({result: x.result, actual: x.actual}) || '<span>pending</span>'}</div></div>`).join('')}</div>`; }

/* ================================================================ more */
function viewMore(){ const s = S.slate && slateInfo(S.slate);
  const item = (k, ic, t, sub) => `<button class="mi" data-more="${k}"><span class="ic">${ICON[ic]}</span><span>${t}${sub ? `<div class="sub">${sub}</div>` : ''}</span><span class="chev">${ICON.chev}</span></button>`;
  const open = store.d.bets.filter(b => b.status === 'open').length;
  return `<div class="view"><div class="lt"><h1>More</h1>${s ? `<p>${s.sport} · ${esc(s.label)}</p>` : '<p>Pick a slate in the Lobby for game lines and parlays.</p>'}</div>
    <div class="menu">${s ? item('lines', 'lines', 'Game lines', 'Spread, total and moneyline, ranked') + item('parlays', 'parlay', 'Parlays', 'Joint replay win rates vs the payout') : ''}${item('results', 'results', 'Results & model report', 'Graded leans, bets and calibration')}${item('bets', 'bets', 'My bets', open ? `${open} open` : 'Log, bankroll and ROI')}</div>
    <div class="menu">${item('learn', 'learn', 'How the model works', 'Plain English, no stats needed')}${item('import', 'import', 'Import a slate', 'Paste or pick a JSON file')}${item('settings', 'gear', 'Settings', 'Units, bankroll, your data')}</div>
    <div class="help"><b>Bet only what you can afford to lose.</b><span>Call or text 1-800-GAMBLER for free, confidential help, any time.</span></div></div>`; }
function wireMore(){ $$('[data-more]').forEach(b => b.onclick = () => ({lines: openLines, parlays: openParlays, results: openResults, bets: openBets, learn: openLearn, import: openImport, settings: openSettings})[b.dataset.more]()); }

/* game lines */
async function openLines(){ const d = await loadSlate(S.slate); const all = [];
  d.games.forEach(g => ['spread', 'total', 'moneyline'].forEach(k => { const x = g.lines && g.lines[k]; if(x && isNum(x.edge_pts)) all.push({g, k, x}); }));
  all.sort((a, b) => b.x.edge_pts - a.x.edge_pts); all.forEach((e, i) => e.rank = i + 1); const N = all.length;
  const word = e => e.k === 'total' ? `${String(e.x.side || '').replace(/^./, c => c.toUpperCase())} ${ln(e.x.line)}` : e.k === 'moneyline' ? `${e.x.side} ML` : `${e.x.side} ${e.x.line > 0 ? '+' : e.x.line < 0 ? '−' : ''}${ln(Math.abs(e.x.line))}`;
  const R = d.results && d.results.games || {};
  const games = d.games.slice().sort((a, b) => Math.min(...['spread', 'total', 'moneyline'].map(k => (all.find(e => e.g === a && e.k === k) || {rank: 999}).rank)) - Math.min(...['spread', 'total', 'moneyline'].map(k => (all.find(e => e.g === b && e.k === k) || {rank: 999}).rank)));
  const html = `<div class="body"><div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(d.meta.label || '')}</span><h1>Game lines</h1><p>Every spread, total and moneyline, ranked by the model's edge out of ${N} on the slate. A line with an edge under +5 is information, not a bet.</p></div>
    ${games.map(g => { const s = g.sim || {}, m = g.market || {}, fin = R[g.id]; const rows = ['spread', 'total', 'moneyline'].map(k => all.find(e => e.g === g && e.k === k)).filter(Boolean);
      return `<div class="group"><div class="pad" style="display:grid;gap:8px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><b style="font:800 22px/1 var(--f-d);letter-spacing:.02em">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</b><span class="sub">${esc(g.window)} · ${kickET(g.kick_utc)}</span></div>
        <div class="soft" style="font-size:14px">Model <b class="m" style="color:var(--text)">${isNum(s.away) ? `${s.away.toFixed(1)}–${s.home.toFixed(1)}` : '—'}</b> · ${esc(g.home.abbr)} wins ${pc(s.home_win)} · market ${isNum(m.spread_home) ? `${esc(g.home.abbr)} ${m.spread_home > 0 ? '+' : ''}${m.spread_home}` : '—'}, total ${ln(m.total)}${fin ? ` · <b style="color:var(--text)">final ${fin.final.away}–${fin.final.home}</b>` : ''}</div>
        ${isNum(s.home_win) ? `<div style="height:6px;border-radius:3px;background:var(--line);overflow:hidden;display:flex"><span style="width:${(1 - s.home_win) * 100}%;background:var(--fair)"></span><span style="flex:1;background:var(--soft)"></span></div>` : ''}</div>
        ${rows.map(e => `<div class="row" style="cursor:default"><div><div class="nm" style="font-size:15px">${esc(word(e))} <span class="sub">${od(e.x.odds)} ${esc(e.x.book || '')}</span></div><div class="mt">${e.k} · model ${pc(e.x.p)}</div></div><div class="rt"><b class="${e.x.edge_pts >= 5 ? 'pos' : ''}">${sg(e.x.edge_pts)}</b><span>#${e.rank} of ${N}</span>${fin && fin.lines && fin.lines[e.k] ? resultTag({result: fin.lines[e.k]}) : ''}</div></div>`).join('')}</div>`; }).join('')}</div>`;
  pushSheet('Game lines', html); }

/* parlays */
async function openParlays(){ const d = await loadSlate(S.slate); const P = d.parlays || {}; const items = (P.items || []).filter(x => !x.legs || x.legs.every(l => !(String(l.book || '').toLowerCase() === 'bet365' && l.side === 'under' && isNum(l.main_line) && l.line > l.main_line)));
  const html = `<div class="body"><div class="lt"><span class="sp" style="--c:${SPORTHEX[d.sport]}">${d.sport} · ${esc(d.meta.label || '')}</span><h1>Parlays</h1><p>Built only from legs with a positive edge, priced from the replays' joint win rate against the real payout. Unders are never alted up on bet365.</p></div>
    ${items.length ? items.map(x => `<div class="group pad" style="display:grid;gap:10px"><div style="display:flex;justify-content:space-between"><b>${x.legs.length}-leg</b><span class="m">${od(x.odds)}</span></div>${x.legs.map(l => `<div class="soft">${esc(l.player)} · ${esc(l.sel)} <span class="sub">${esc(l.book || '')}</span></div>`).join('')}
      <div class="kv"><div><b>${pc(x.p_joint, 1)}</b><span>True combined chance</span></div><div><b>${pc(x.break_even, 1)}</b><span>Payout needs</span></div><div><b class="${x.edge_pts >= 5 ? 'pos' : ''}">${sg(x.edge_pts)}</b><span>Edge (pts)</span></div></div><div class="lossline">${lossLine(x.p_joint)}</div></div>`).join('')
      : `<div class="verdict"><div class="big none" style="font-size:clamp(32px,9vw,44px)">No parlays for this slate</div><p>${esc(P.note || 'Nothing cleared the bar.')} No padding: when nothing clears, nothing is shown.</p></div>`}
  </div>`; pushSheet('Parlays', html); }

/* results & model report */
async function openResults(){ const sl = INDEX.slates.filter(s => s.results && s.results.status === 'graded'); const sports = [...new Set(sl.map(s => s.sport))]; if(!sports.includes(S.resSport)) S.resSport = sports[0] || 'NFL';
  const el = pushSheet('Results', `<div class="body" id="resbody"></div>`); const draw = async () => { const sp = S.resSport; const ss = sl.filter(s => s.sport === sp); const R = sp === 'NFL' ? await loadResults('NFL') : null; $('#resbody', el).innerHTML = resultsHTML(sp, ss, R, sports); countUp(el);
    $$('[data-rs]', el).forEach(b => b.onclick = () => { S.resSport = b.dataset.rs; draw(); });
    $$('[data-slate-open]', el).forEach(b => b.onclick = () => { while(STACK.length) popSheet(); setSlate(b.dataset.slateOpen, 'card'); }); }; draw(); }
function addT(a, b){ a = a || {w: 0, l: 0, p: 0, units: 0, risked: 0}; b = b || {}; return {w: a.w + (b.w || 0), l: a.l + (b.l || 0), p: a.p + (b.p || 0), units: +(a.units + (b.units || 0)).toFixed(2), risked: +(a.risked + (b.risked || 0)).toFixed(2)}; }
function calibSVG(bins){ if(!bins.length) return ''; return Charts.calibration({points: bins.map(b => [b.pred, b.hit, b.n]), w: 340, h: 290}); }
function resultsHTML(sp, ss, R, sports){ let bets, lean, lines = {won: 0, lost: 0, push: 0}; const tiers = {}, mk = {}; const binsAll = {};
  ss.forEach(s => { const r = s.results; bets = addT(bets, r.bets); lean = addT(lean, (r.by_tier || {}).lean); Object.entries(r.by_tier || {}).forEach(([k, v]) => tiers[k] = addT(tiers[k], v));
    Object.entries(r.by_market || {}).forEach(([k, v]) => { mk[k] = Object.assign(addT(mk[k], v), {label: v.label}); }); Object.entries(r.lines || {}).forEach(([k, v]) => lines[k] += v);
    (r.calib_bins || []).forEach(b => { const k = b.lo; const o = binsAll[k] || (binsAll[k] = {lo: b.lo, n: 0, ps: 0, hs: 0}); o.n += b.n; o.ps += b.pred * b.n; o.hs += b.hit * b.n; }); });
  const bins = Object.values(binsAll).sort((a, b) => a.lo - b.lo).map(b => ({n: b.n, pred: b.ps / b.n, hit: b.hs / b.n}));
  const rec = x => x && (x.w + x.l) ? `${x.w}–${x.l}${x.p ? '–' + x.p : ''}` : '0–0'; const hr = x => x && (x.w + x.l) ? x.w / (x.w + x.l) : null;
  const weak = Object.entries(mk).filter(([, v]) => (v.w + v.l) >= 15 && hr(v) < .45).map(([, v]) => `${v.label} hit ${pc(hr(v))} on the shown side (${rec(v)})`);
  const season = R && R.season;
  const TL = {bet: 'Bets', live: 'Live watch, pregame side', lean: 'Leans, info only', pass: 'All other priced'};
  return `<div class="lt"><h1>Results</h1><p>Every graded prop on the side the model showed, straight from the box scores. Bad nights stay in.</p></div>
    ${sports.length > 1 ? `<div class="seg">${sports.map(x => `<button data-rs="${x}" aria-pressed="${x === sp}">${x}</button>`).join('')}</div>` : ''}
    ${season ? `<section class="sec"><div class="hd"><h2>NFL 2026 season</h2><span class="sub">weeks ${R.weeks[0]}–${R.weeks[R.weeks.length - 1]} as published</span></div>
      <div class="statstrip">${[['bets', 'Bets'], ['leans', 'Leans'], ['live', 'Live calls'], ['lines_edge5', 'Lines +5']].map(([k, l]) => { const x = season[k] || {}; return `<div><b>${x.w ?? 0}–${x.l ?? 0}</b><span>${l} · ${sg(x.profit, 1)}u</span></div>`; }).join('')}</div>
      ${seasonChart(R)}<div class="note">${esc(R.method && R.method.caveat || '')}</div></section>` : ''}
    <section class="sec"><div class="hd"><h2>${sp} graded slates</h2><span class="sub">${ss.length} slate${ss.length === 1 ? '' : 's'}</span></div>
      <div class="statstrip"><div><b>${rec(bets)}</b><span>Bets</span></div><div><b class="${bets && bets.units < 0 ? 'neg' : 'pos'}">${bets ? sg(bets.units, 2) + 'u' : '—'}</b><span>Bet units</span></div><div><b>${rec(lean)}</b><span>Leans (info)</span></div><div><b>${lines.won}–${lines.lost}</b><span>Game lines</span></div></div>
      ${ss.map(s => `<button class="sl" data-slate-open="${esc(s.id)}" style="--c:${SPORTHEX[s.sport]}"><div><div class="t">${esc(s.label)}</div></div><div class="cnt"><span class="tag">${s.results.graded.toLocaleString()} graded</span></div><div class="w">${esc(s.date_label || '')} · bets ${rec(s.results.bets)}${s.results.bets && (s.results.bets.w + s.results.bets.l) ? ` (${sg(s.results.bets.units, 2)}u)` : ''} · lines ${s.results.lines ? `${s.results.lines.won}–${s.results.lines.lost}` : '—'}</div></button>`).join('')}</section>
    <section class="sec"><div class="hd"><h2>Calibration</h2><span class="sub">${bins.reduce((a, b) => a + b.n, 0).toLocaleString()} props</span></div>
      <div class="group pad">${calibSVG(bins) || '<p class="sub" style="margin:0">Not enough graded props yet.</p>'}<div class="legend" style="margin-top:8px"><span><i style="background:var(--brass)"></i>perfect calibration</span><span><i style="background:var(--edge);border-radius:50%"></i>what happened (size = props)</span></div></div>
      <div class="note">If the dots sit on the dashed line, a 60% call wins about 60% of the time. Above the line, the model was too cautious; below it, too confident.</div></section>
    <section class="sec"><h2>Hit rate by tier</h2><div class="group pad"><div class="tbl"><table><thead><tr><th>Tier</th><th>W–L</th><th>Hit</th><th>Units</th></tr></thead><tbody>${['bet', 'live', 'lean', 'pass'].filter(k => tiers[k] && (tiers[k].w + tiers[k].l)).map(k => `<tr><td>${TL[k]}</td><td>${rec(tiers[k])}</td><td>${pc(hr(tiers[k]))}</td><td class="${tiers[k].units < 0 ? 'neg' : 'pos'}">${sg(tiers[k].units, 2)}</td></tr>`).join('')}</tbody></table></div><div class="note" style="margin-top:8px">Only “Bets” were recommended. The other rows are graded for the record so the model's weak spots stay visible.</div></div></section>
    <section class="sec"><h2>By prop type</h2><div class="group pad"><div class="tbl"><table><thead><tr><th>Prop</th><th>Record</th><th>Hit</th></tr></thead><tbody>${Object.values(mk).sort((a, b) => (hr(b) || 0) - (hr(a) || 0)).map(v => `<tr><td>${esc(v.label)}</td><td>${rec(v)}</td><td class="${hr(v) != null && hr(v) < .45 ? 'neg' : ''}">${pc(hr(v))}</td></tr>`).join('')}</tbody></table></div></div></section>
    <section class="sec"><h2>Where the model is weak</h2><div class="group pad" style="display:grid;gap:8px">${weak.length ? weak.map(w => `<div class="soft">• ${esc(w)}</div>`).join('') : '<div class="soft">No prop type with 15 or more graded props is below a 45% hit rate on the shown side.</div>'}
      <div class="soft">• Weight changes: no re-tune ran after these slates, so the weights are unchanged from the versions shown on each slate.</div>${sp === 'NBA' ? '<div class="soft">• NBA pricing leans 90% on the line because the line has been at least as accurate as the model on every graded night.</div>' : ''}</div></section>`; }
function seasonChart(R){ const C = R.cum || {}, wk = R.weeks || []; const ser = [['bets', 'Bets', 'var(--edge)'], ['leans', 'Leans (info)', 'var(--fair)'], ['live', 'Live calls', 'var(--live)']].filter(s => C[s[0]]); if(!ser.length || wk.length < 2) return '';
  const all = ser.flatMap(s => C[s[0]]); const mn = Math.min(0, ...all), mx = Math.max(0, ...all); const W = 600, H = 240, p = 44; const X = i => p + i / (wk.length - 1) * (W - p - 14), Y = v => H - 34 - (v - mn) / ((mx - mn) || 1) * (H - 64) ;
  return `<div class="group pad chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative units by week"><line x1="${p}" x2="${W - 14}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line2)"/><text x="${p - 6}" y="${Y(0) + 6}" text-anchor="end" font-size="18" fill="var(--mute)" font-family="ui-monospace,SF Mono,Menlo,monospace">0u</text>
    ${ser.map(([k, , c]) => `<polyline fill="none" stroke="${c}" stroke-width="2.4" points="${C[k].map((v, i) => `${X(i)},${Y(v)}`).join(' ')}"/><circle cx="${X(C[k].length - 1)}" cy="${Y(C[k][C[k].length - 1])}" r="4" fill="${c}"/><text x="${X(C[k].length - 1) - 8}" y="${Y(C[k][C[k].length - 1]) - 10}" text-anchor="end" font-size="18" fill="${c}" font-family="ui-monospace,SF Mono,Menlo,monospace">${sg(C[k][C[k].length - 1], 1)}u</text>`).join('')}
    ${wk.map((w, i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="17" fill="var(--mute)" font-family="-apple-system,system-ui,sans-serif">W${w}</text>`).join('')}</svg>
    <div class="legend">${ser.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div></div>`; }

/* ================================================================ my bets */
function gradeMyBets(d){ if(!d.results || !d.results.props) return; let ch = 0;
  store.d.bets.forEach(b => { if(b.status !== 'open' || b.slate !== d.id) return; const r = d.results.props[b.prop]; if(!r) return;
    if(r.result === 'void'){ b.status = 'void'; b.pl = 0; ch++; return; } if(!isNum(r.actual)) return;
    const yes = b.market === 'atd' || b.market === 'qb_atd'; let res;
    if(yes) res = r.actual >= 1 ? 'won' : 'lost'; else if(r.actual === b.line) res = 'push'; else res = (r.actual > b.line) === (b.side === 'over') ? 'won' : 'lost';
    b.status = res; b.actual = r.actual; b.pl = res === 'won' ? +(b.stake * (decOdds(b.odds) - 1)).toFixed(2) : res === 'lost' ? -b.stake : 0; ch++; });
  if(ch){ store.save(); setTimeout(() => toast(`${ch} bet${ch > 1 ? 's' : ''} graded`), 400); } }
function logBet(d, p, pre = {}){ if(!p) return; const books = [...new Set((p.offers || []).map(o => o.book).filter(Boolean).concat(p.book ? [p.book] : []))]; const unit = store.d.settings.unit || 10;
  const side = pre.side || (p.side === 'under' ? 'under' : 'over'); const yes = p.market === 'atd' || p.market === 'qb_atd';
  const M = $('#modal'), C = $('#mcard');
  C.innerHTML = `<div class="grab"></div><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2>Log bet</h2><span class="sub">${esc(p.player)}</span></div>
    <div class="soft">${esc(p.market_label)} · ${esc(d.sport)} ${esc(d.meta.label || '')}${pre.live ? ' · live' : ''}</div>
    <div class="fgrid">${yes ? '' : `<div class="fld"><label for="b-side">Side</label><select id="b-side"><option value="over" ${side === 'over' ? 'selected' : ''}>Over</option><option value="under" ${side === 'under' ? 'selected' : ''}>Under</option></select></div><div class="fld"><label for="b-line">Line</label><input id="b-line" type="number" step="0.5" inputmode="decimal" value="${pre.line ?? p.line ?? ''}"></div>`}
      <div class="fld"><label for="b-odds">Odds</label><input id="b-odds" type="text" inputmode="numeric" value="${pre.odds ?? p.odds ?? -110}"></div>
      <div class="fld"><label for="b-book">Book</label><select id="b-book">${[...books, 'DraftKings', 'FanDuel', 'bet365', 'theScore Bet', 'BetMGM', 'Caesars', 'Other'].filter((x, i, a) => a.indexOf(x) === i).map(b => `<option ${b === p.book ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></div>
      <div class="fld" style="grid-column:1 / -1"><label for="b-stake">Stake in units (1u = ${money(unit)})</label><input id="b-stake" type="number" step="0.25" inputmode="decimal" value="${p.units || 1}"></div></div>
    <div id="b-warn"></div>
    <div class="btns"><button class="btn quiet" id="b-cancel">Cancel</button><button class="btn primary" id="b-save">Log bet</button></div>`;
  M.classList.add('on'); M.setAttribute('aria-hidden', 'false');
  const warn = () => { const bk = $('#b-book', C).value, sd = $('#b-side', C) && $('#b-side', C).value, line = +($('#b-line', C) || {}).value; const w = [];
    if(!yes && bk === 'bet365' && sd === 'under' && isNum(p.line) && line > p.line) w.push(`bet365 doesn't let you alt an under up to a higher number. ${ln(line)} is above the main line of ${ln(p.line)}.`);
    $('#b-warn', C).innerHTML = w.map(x => `<div class="help" style="border-color:var(--live)"><b style="color:var(--live)">Heads up</b><span>${esc(x)}</span></div>`).join(''); };
  $$('select,input', C).forEach(x => x.oninput = warn); warn();
  const close = () => { M.classList.remove('on'); M.setAttribute('aria-hidden', 'true'); };
  $('#b-cancel', C).onclick = close; M.onclick = e => { if(e.target === M) close(); };
  $('#b-save', C).onclick = () => { const odds = Number(String($('#b-odds', C).value).replace('−', '-')); const stake = Number($('#b-stake', C).value); const line = yes ? null : Number($('#b-line', C).value);
    if(!isNum(odds) || Math.abs(odds) < 100 || !isNum(stake) || stake <= 0 || (!yes && !isNum(line))){ toast('Check the odds, line and stake'); return; }
    store.d.bets.unshift({id: 'b' + Date.now().toString(36), t: new Date().toISOString(), slate: d.id, sport: d.sport, prop: p.id, gid: p.gid, player: p.player, market: p.market, market_label: p.market_label, side: yes ? 'yes' : $('#b-side', C).value, line, odds, book: $('#b-book', C).value, stake, live: !!pre.live, status: 'open'});
    store.save(); close(); gradeMyBets(d); const L = $('#logged'); L.classList.add('on'); setTimeout(() => L.classList.remove('on'), 1100); if(S.tab === 'more') render(); }; }
function wireBetsIn(el, draw){ $$('[data-del]', el).forEach(b => b.onclick = () => { if(b.dataset.armed){ store.d.bets = store.d.bets.filter(x => x.id !== b.dataset.del); store.save(); draw(); } else { b.dataset.armed = 1; b.textContent = 'Tap again to delete'; } });
  $$('[data-settle]', el).forEach(b => b.onclick = () => { const x = store.d.bets.find(y => y.id === b.dataset.id); if(!x) return; const r = b.dataset.settle; x.status = r; x.pl = r === 'won' ? +(x.stake * (decOdds(x.odds) - 1)).toFixed(2) : r === 'lost' ? -x.stake : 0; store.save(); draw(); });
  const ex = $('#b-export', el); if(ex) ex.onclick = exportData; const im = $('#b-import', el); if(im) im.onclick = importData; }
function openBets(){ const el = pushSheet('My bets', `<div class="body" id="mybets"></div>`); const draw = () => { $('#mybets', el).innerHTML = betsHTML(); wire(); };
  const wire = () => { $$('[data-del]', el).forEach(b => b.onclick = () => { if(b.dataset.armed){ store.d.bets = store.d.bets.filter(x => x.id !== b.dataset.del); store.save(); draw(); } else { b.dataset.armed = 1; b.textContent = 'Tap again to delete'; } });
    $$('[data-settle]', el).forEach(b => b.onclick = () => { const x = store.d.bets.find(y => y.id === b.dataset.id); if(!x) return; const r = b.dataset.settle; x.status = r; x.pl = r === 'won' ? +(x.stake * (decOdds(x.odds) - 1)).toFixed(2) : r === 'lost' ? -x.stake : 0; store.save(); draw(); });
    const ex = $('#b-export', el); if(ex) ex.onclick = exportData; const im = $('#b-import', el); if(im) im.onclick = importData; };
  draw(); }
function betsHTML(){ const B = store.d.bets, unit = store.d.settings.unit || 10, bank0 = store.d.settings.bankroll || 0;
  const settled = B.filter(b => ['won', 'lost', 'push', 'void'].includes(b.status)).slice().sort((a, b) => a.t < b.t ? -1 : 1); const open = B.filter(b => b.status === 'open');
  const pl = settled.reduce((a, b) => a + (b.pl || 0), 0), risk = settled.filter(b => b.status === 'won' || b.status === 'lost').reduce((a, b) => a + b.stake, 0);
  const w = settled.filter(b => b.status === 'won').length, l = settled.filter(b => b.status === 'lost').length;
  let run = bank0; const pts = [bank0].concat(settled.map(b => run += (b.pl || 0) * unit));
  const curve = pts.length > 1 ? (() => { const W = 600, H = 170, mn = Math.min(...pts), mx = Math.max(...pts); const X = i => 8 + i / (pts.length - 1) * (W - 16), Y = v => H - 14 - (v - mn) / ((mx - mn) || 1) * (H - 30);
    return `<div class="trend"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bankroll"><line x1="8" x2="${W - 8}" y1="${Y(bank0)}" y2="${Y(bank0)}" stroke="var(--line2)" stroke-dasharray="4 5"/><polyline fill="none" stroke="${run >= bank0 ? 'var(--edge)' : 'var(--loss)'}" stroke-width="2.6" points="${pts.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}"/><circle cx="${X(pts.length - 1)}" cy="${Y(run)}" r="4.5" fill="${run >= bank0 ? 'var(--edge)' : 'var(--loss)'}"/></svg><div class="sub">Starting bankroll ${money(bank0)} · 1u = ${money(unit)}</div></div>`; })() : '';
  const bySlate = {}; open.forEach(b => (bySlate[b.slate] = bySlate[b.slate] || []).push(b));
  const corr = b => open.some(x => x !== b && x.gid && x.gid === b.gid);
  const row = b => `<div class="row" style="cursor:default"><div><div class="nm" style="font-size:15px">${esc(b.player)} · ${b.side === 'yes' ? 'Anytime TD' : `${b.side === 'under' ? 'Under' : 'Over'} ${ln(b.line)} ${esc(STATWORD[b.market] || b.market_label || '')}`}</div><div class="mt">${od(b.odds)} · ${esc(b.book)} · ${b.stake}u${b.live ? ' · live' : ''} · ${esc((slateInfo(b.slate) || {}).label || b.slate)}</div>${b.status === 'open' && corr(b) ? `<div class="sub" style="color:var(--live)">Same game as another open bet: these results move together.</div>` : ''}</div>
    <div class="rt">${b.status === 'open' ? '<span class="tag">Open</span>' : resultTag({result: b.status, actual: b.actual})}<span>${b.status === 'open' ? '' : sg(b.pl, 2) + 'u'}</span></div>
    <div class="pl" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">${b.status === 'open' ? ['won', 'lost', 'push'].map(r => `<button class="chip" data-settle="${r}" data-id="${b.id}" style="min-height:36px">${r === 'won' ? 'Won' : r === 'lost' ? 'Lost' : 'Push'}</button>`).join('') : ''}<button class="chip" data-del="${b.id}" style="min-height:36px">Delete</button></div></div>`;
  return `<div class="lt"><h1>My bets</h1><p>Log a bet from any card in two taps. Open bets grade themselves when the box scores land.</p></div>
    <div class="statstrip"><div><b>${money(bank0 + pl * unit)}</b><span>Bankroll</span></div><div><b class="${pl < 0 ? 'neg' : 'pos'}">${sg(pl, 2)}u</b><span>Profit</span></div><div><b>${risk ? pc(pl / risk, 1) : '—'}</b><span>ROI</span></div><div><b>${w}–${l}</b><span>Record</span></div></div>
    ${curve}
    <section class="sec"><div class="hd"><h2>Open</h2><span class="sub">${open.length} · ${open.reduce((a, b) => a + b.stake, 0)}u at risk</span></div>
      ${open.length ? Object.entries(bySlate).map(([s, bs]) => `<div class="list"><div class="wl">${esc((slateInfo(s) || {}).label || s)}<span>exposure ${bs.reduce((a, b) => a + b.stake, 0)}u</span></div>${bs.map(row).join('')}</div>`).join('') : '<div class="group pad"><p class="sub" style="margin:0">No open bets. Tap “Log bet” on any report card.</p></div>'}</section>
    <section class="sec"><h2>Settled</h2>${settled.length ? `<div class="list">${settled.slice().reverse().map(row).join('')}</div>` : '<div class="group pad"><p class="sub" style="margin:0">Nothing settled yet.</p></div>'}</section>
    <div class="btns"><button class="btn quiet" id="b-export">Export my data</button><button class="btn quiet" id="b-import">Import my data</button></div>
    <div class="help"><b>Keep it fun.</b><span>Set a bankroll you can lose and stick to it. 1-800-GAMBLER, any time.</span></div>`; }

/* ================================================================ import / export / settings / learn */
function modal(html, after){ const M = $('#modal'), C = $('#mcard'); C.innerHTML = `<div class="grab"></div>${html}`; M.classList.add('on'); M.setAttribute('aria-hidden', 'false'); const close = () => { M.classList.remove('on'); M.setAttribute('aria-hidden', 'true'); }; M.onclick = e => { if(e.target === M) close(); }; if(after) after(C, close); }
function openImport(){ modal(`<h2>Import a slate</h2><p class="note" style="margin:0">Paste a slate JSON from a model run, or pick the file. It stays on this phone until the slate is pushed to GitHub.</p>
  <textarea id="imp-t" placeholder='{"schema":"wmtl.slate.v2", ...}'></textarea><input id="imp-f" type="file" accept="application/json,.json" class="sr"><div id="imp-e"></div>
  <div class="btns"><button class="btn quiet" id="imp-file">Choose file</button><button class="btn primary" id="imp-go">Import</button></div>`, (C, close) => {
    const run = async txt => { let d; try{ d = JSON.parse(txt); }catch(e){ $('#imp-e', C).innerHTML = `<div class="help"><b>That isn't valid JSON.</b><span>${esc(e.message)}</span></div>`; return; }
      const er = validate(d); if(er.length){ $('#imp-e', C).innerHTML = `<div class="help"><b>This doesn't look like a slate.</b><span>${er.map(esc).join('<br>')}</span></div>`; return; }
      d.id = d.id || `${(d.sport || d.meta.sport || 'x').toLowerCase()}-import-${(d.meta.date || Date.now())}`; IMPORTED[d.id] = d; await idb.put(d.id, d); addImportedToIndex(d); delete SLATE[d.id]; close(); toast('Slate imported'); setSlate(d.id, 'card'); };
    $('#imp-go', C).onclick = () => run($('#imp-t', C).value); $('#imp-file', C).onclick = () => $('#imp-f', C).click();
    $('#imp-f', C).onchange = e => { const f = e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = () => run(r.result); r.readAsText(f); }; }); }
function exportData(){ const blob = new Blob([JSON.stringify(store.d, null, 1)], {type: 'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `wmtl-my-data-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Exported'); }
function importData(){ modal(`<h2>Import my data</h2><p class="note" style="margin:0">Paste an export from this app. It replaces the bets and settings on this phone.</p><textarea id="md-t"></textarea><div id="md-e"></div><div class="btns"><button class="btn quiet" id="md-c">Cancel</button><button class="btn primary" id="md-go">Replace my data</button></div>`, (C, close) => {
  $('#md-c', C).onclick = close; $('#md-go', C).onclick = () => { try{ const d = JSON.parse($('#md-t', C).value); if(!Array.isArray(d.bets)) throw new Error('No bets list in this file.'); store.d = Object.assign(store.d, d); store.save(); close(); toast('Data imported'); STACK.length && popSheet(); openBets(); }catch(e){ $('#md-e', C).innerHTML = `<div class="help"><b>Could not import.</b><span>${esc(e.message)}</span></div>`; } }; }); }
function openSettings(){ const s = store.d.settings; pushSheet('Settings', `<div class="body"><div class="lt"><h1>Settings</h1></div>
  <div class="calc"><div class="fgrid"><div class="fld"><label for="s-unit">1 unit ($)</label><input id="s-unit" type="number" inputmode="decimal" value="${s.unit}"></div><div class="fld"><label for="s-bank">Starting bankroll ($)</label><input id="s-bank" type="number" inputmode="decimal" value="${s.bankroll}"></div></div>
    </div>
  <div class="btns"><button class="btn quiet" id="s-ex">Export my data</button><button class="btn quiet" id="s-im">Import my data</button></div>
  <button class="btn quiet" id="s-reset" style="color:var(--loss)">Erase bets and settings</button>
  <div class="help"><b>Bet only what you can afford to lose.</b><span>1-800-GAMBLER · free, confidential help, any time.</span></div>
  <div class="sub">App ${APP_VERSION} · data built ${esc(INDEX.built_utc)} · storage key ${STORE_KEY}</div></div>`, el => {
    $('#s-unit', el).oninput = e => { s.unit = Math.max(0, +e.target.value || 0); store.save(); }; $('#s-bank', el).oninput = e => { s.bankroll = Math.max(0, +e.target.value || 0); store.save(); };
    $$('#s-room button', el).forEach(b => b.onclick = () => { s.room = b.dataset.r; store.save(); $$('#s-room button', el).forEach(x => x.setAttribute('aria-pressed', x === b)); toast(s.room === 'off' ? '3D room off' : '3D room on'); });
    $('#s-ex', el).onclick = exportData; $('#s-im', el).onclick = importData;
    $('#s-reset', el).onclick = e => { const b = e.currentTarget; if(!b.dataset.armed){ b.dataset.armed = 1; b.textContent = 'Tap again to erase everything'; return; } store.d = {v: 1, bets: [], settings: {unit: 10, bankroll: 500, room: 'auto'}, ui: {}}; store.save(); toast('Erased'); popSheet(); }; }); }
function openLearn(){ const bar = (w, c, l) => `<div class="side"><div class="l"><span>${l}</span></div><div class="bar"><span style="width:${w}%;background:${c}"></span></div></div>`;
  pushSheet('How it works', `<div class="body"><div class="lt"><h1>How the model works</h1><p>No stats background needed. Four ideas, one picture each.</p></div>
  <div class="ex"><h2>Why it's called tail.</h2><p>To tail a bet is to ride it. Every pick here comes from the trained model, priced against the books, so you know which ones are worth tailing and which to fade. The seal is the coin you flip when you don't have a model; this one does.</p></div>
  <div class="ex"><h2>1 · The report card (25D)</h2><p>For every player and every prop, the model asks 25 questions: his role, his recent form, the matchup, the game setup, and his history. Each prop has its own 25, and each answer's weight was learned from years of games of that exact prop. Add them up and you get one score. Above +1.5 means he should beat his own normal game; −1.5 or lower means he should fall short.</p>
    <svg viewBox="0 0 600 130" role="img" aria-label="A report card scale"><rect x="20" y="52" width="560" height="14" rx="7" fill="var(--line)"/><rect x="20" y="52" width="160" height="14" rx="7" fill="var(--loss)" opacity=".55"/><rect x="420" y="52" width="160" height="14" rx="7" fill="var(--edge)" opacity=".55"/><line x1="300" x2="300" y1="40" y2="78" stroke="var(--faint)"/><text x="100" y="110" fill="var(--soft)" font-size="22" text-anchor="middle">−1.5 or less</text><text x="300" y="110" fill="var(--soft)" font-size="22" text-anchor="middle">normal</text><text x="500" y="110" fill="var(--soft)" font-size="22" text-anchor="middle">+1.5 or more</text><circle cx="470" cy="59" r="11" fill="var(--text)"/><text x="470" y="28" fill="var(--text)" font-size="22" text-anchor="middle">this player</text></svg></div>
  <div class="ex"><h2>2 · 10,000 replays</h2><p>The model plays each game 10,000 times on the computer, play by play. Count how many of those replays the player cleared the line, and that is his chance. A 60% chance still loses 4 times out of 10.</p>
    <svg viewBox="0 0 600 130" role="img" aria-label="A distribution of replays with a line">${Array.from({length: 30}, (_, i) => { const h = 100 * Math.exp(-Math.pow((i - 16) / 6, 2)); return `<rect x="${20 + i * 19}" y="${110 - h}" width="15" height="${h}" rx="3" fill="${i >= 13 ? 'var(--edge)' : 'var(--line2)'}" opacity="${i >= 13 ? .75 : 1}"/>`; }).join('')}<line x1="267" x2="267" y1="4" y2="114" stroke="var(--text)" stroke-width="2.5"/><text x="277" y="24" fill="var(--text)" font-size="22">the line</text></svg></div>
  <div class="ex"><h2>3 · The edge</h2><p>The price tells you what chance you need to break even (−115 needs 53.5%). The model first checks its chance against what the sportsbooks think, then compares. A bet needs both keys: a strong report card, and an edge of at least 5 points. Most days that is zero or one bet. That is on purpose.</p>
    <div class="sides">${bar(62, 'var(--edge)', 'Model chance after the market check · 62%')}${bar(53.5, 'var(--fair)', 'What −115 needs · 53.5%')}</div><p class="soft" style="font-size:14.5px">62 − 53.5 = 8.5 points of edge: a bet.</p></div>
  <div class="ex"><h2>4 · Live betting</h2><p>The model's best idea: take a player with a strong card, wait for a slow first half, then bet him live at a lower number than he opened. The model already replayed thousands of games where that exact thing happened, so it knows how often he still gets there. The live calculator reads those replays for whatever the score and his stat are right now.</p>
    <svg viewBox="0 0 600 120" role="img" aria-label="Opening line and lower live line"><line x1="30" x2="570" y1="70" y2="70" stroke="var(--line2)" stroke-width="2"/><circle cx="120" cy="70" r="8" fill="var(--brass)"/><text x="120" y="45" text-anchor="middle" fill="var(--brass2)" font-size="21">opens 64.5</text><circle cx="300" cy="70" r="8" fill="var(--live)"/><text x="300" y="45" text-anchor="middle" fill="var(--live)" font-size="21">slow half: 18 yds</text><circle cx="480" cy="70" r="8" fill="var(--edge)"/><text x="480" y="45" text-anchor="middle" fill="var(--edge)" font-size="21">live over 49.5</text><text x="300" y="110" text-anchor="middle" fill="var(--mute)" font-size="20">same player, cheaper number</text></svg></div>
  <div class="ex"><h2>What the model is not</h2><p>It is not a lock. It loses often, and the Results page shows every bad night. If betting stops being fun, call or text 1-800-GAMBLER.</p></div></div>`); }

/* ================================================================ share image */
async function shareProp(d, p){ const W = 1080, H = 1350; const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const FD = '-apple-system,system-ui,sans-serif', FB = '-apple-system,system-ui,sans-serif', FM = 'ui-monospace,"SF Mono",Menlo,monospace';
  x.fillStyle = '#000000'; x.fillRect(0, 0, W, H); const g = x.createRadialGradient(W * .85, 0, 40, W * .85, 0, 1100); g.addColorStop(0, '#2A2A30'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = SPORTHEX[d.sport]; x.fillRect(80, 96, 14, 14); x.fillStyle = 'rgba(242,239,232,.66)'; x.font = `700 30px ${FB}`; x.fillText(`${d.sport} · ${d.meta.label || ''} · ${p.window || ''}`.toUpperCase(), 108, 110);
  x.fillStyle = '#F2EFE8'; x.font = `700 104px ${FD}`; wrapText(x, p.player.toUpperCase(), 80, 250, W - 160, 108);
  x.fillStyle = 'rgba(242,239,232,.66)'; x.font = `600 36px ${FB}`; x.fillText(`${p.team}${p.opp ? ' vs ' + p.opp : ''} · ${p.market_label}`, 80, 470);
  x.fillStyle = '#FFFFFF'; x.font = `700 84px ${FD}`; x.fillText(selText(p).toUpperCase(), 80, 600);
  const kv = [[pc(p.p), 'MODEL CHANCE'], [pc(p.break_even), 'PRICE NEEDS'], [sg(p.edge_pts), 'EDGE']]; kv.forEach(([v, l], i) => { const X = 80 + i * 320; x.fillStyle = '#F2EFE8'; x.font = `600 76px ${FM}`; x.fillText(v, X, 760); x.fillStyle = 'rgba(242,239,232,.54)'; x.font = `700 24px ${FB}`; x.fillText(l, X, 800); });
  x.fillStyle = '#F2EFE8'; x.font = `600 40px ${FM}`; x.fillText(`${od(p.odds)}  ${p.book || ''}`, 80, 900); x.fillStyle = 'rgba(242,239,232,.66)'; x.font = `500 34px ${FB}`; x.fillText(isNum(p.p) ? `Wins about ${Math.round(p.p * 10)} in 10 · loses about ${10 - Math.round(p.p * 10)} in 10` : '', 80, 960); x.fillText(`25D report card ${sg(p.score25, 1)} · ${p.tier === 'bet' ? 'passes both keys' : p.tier === 'lean' ? 'information only, not a bet' : p.tier === 'live' ? 'live watch' : 'not a bet'}`, 80, 1012);
  x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(80, 1130, W - 160, 2); try{ const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.TSEAL.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')); await im.decode(); x.drawImage(im, 80, 1168, 60, 60); }catch(e){} x.fillStyle = '#FFFFFF'; x.font = `800 50px ${FD}`; x.fillText('tail.', 156, 1214); x.fillStyle = 'rgba(242,239,232,.4)'; x.font = `500 24px ${FB}`; x.fillText('Model output, not a promise. 1-800-GAMBLER', 80, 1256);
  c.toBlob(async blob => { if(!blob) return toast('Could not make the image'); const file = new File([blob], `wmtl-${p.player.replace(/\W+/g, '-').toLowerCase()}.png`, {type: 'image/png'});
    try{ if(navigator.canShare && navigator.canShare({files: [file]})){ await navigator.share({files: [file], title: 'tail.'}); return; } }catch(e){ if(e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(blob); pushSheet('Share image', `<div class="body"><img src="${url}" alt="Share card for ${esc(p.player)}" style="width:100%;border-radius:18px"><p class="note">Press and hold the image to save or share it.</p></div>`); }, 'image/png'); }
function wrapText(x, t, X, Y, maxW, lh){ const w = t.split(' '); let line = '', y = Y; for(const word of w){ const test = line ? line + ' ' + word : word; if(x.measureText(test).width > maxW && line){ x.fillText(line, X, y); line = word; y += lh; } else line = test; } x.fillText(line, X, y); }

/* ================================================================ pull to refresh */
function pullToRefresh(){ const ind = $('#ptr'); let y0 = null, dy = 0, busy = false;
  addEventListener('touchstart', e => { if(STACK.length || window.scrollY > 0 || busy || e.target.closest('#roomCanvas,.modal')) return; y0 = e.touches[0].clientY; dy = 0; }, {passive: true});
  addEventListener('touchmove', e => { if(y0 == null) return; dy = e.touches[0].clientY - y0; if(dy <= 0){ ind.style.opacity = 0; return; } const k = Math.min(1, dy / 90); ind.style.opacity = k; ind.style.transform = `scale(${.6 + .4 * k}) rotate(${dy * 2}deg)`; }, {passive: true});
  addEventListener('touchend', async () => { if(y0 == null) return; y0 = null; if(dy < 90){ ind.style.opacity = 0; return; } busy = true; ind.classList.add('spin');
    try{ const before = INDEX && INDEX.built_utc; await loadIndex(true); if(S.slate && slateInfo(S.slate)) await loadSlate(S.slate, true); toast(INDEX.built_utc !== before ? 'Newest slate loaded' : 'Already up to date'); render(); }catch(e){ toast('Offline: showing the saved slate'); }
    busy = false; ind.classList.remove('spin'); ind.style.opacity = 0; }); }

/* ================================================================ boot */
async function boot(){ store.load(); drawTabs();
  addEventListener('scroll', () => $('#top').classList.toggle('scrolled', window.scrollY > 4), {passive: true});
  $('#wm').onclick = () => go('lobby'); $('#slatebtn').onclick = slatePicker; $('#srchbtn').onclick = openSearch;
  loadLiveParams();
  try{ await loadIndex(); }catch(e){ $('#main').innerHTML = `<div class="view"><div class="lt"><h1>Not available</h1><p>The slate list could not be loaded. Check your connection and pull down to retry.</p></div></div>`; pullToRefresh(); return; }
  const hs = (location.hash || '').slice(1); const want = TABS.find(t => t[0] === hs) ? hs : (store.d.ui.tab || 'lobby');
  const newest = INDEX.slates.slice().sort((x, y) => x.start_utc < y.start_utc ? 1 : -1)[0];
  const seen = store.d.ui.seen || (store.d.ui.slate ? [store.d.ui.slate] : []); const fresh = newest && !seen.includes(newest.id);
  const sl = fresh ? newest.id : store.d.ui.slate && slateInfo(store.d.ui.slate) ? store.d.ui.slate : newest ? newest.id : null; if(sl){ S.slate = sl; store.d.ui.slate = sl; drawSlateBtn(); }
  store.d.ui.seen = INDEX.slates.map(x => x.id); store.save();
  go(TABS.find(t => t[0] === want) ? want : 'lobby'); tickerLoop(); document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') tickerLoop(); }); if(fresh) setTimeout(() => toast('New slate: ' + (newest.label || newest.id)), 600); pullToRefresh();
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if(h !== S.tab && TABS.find(t => t[0] === h)) go(h); });
  addEventListener('keydown', e => { if(e.key === 'Escape'){ if($('#modal').classList.contains('on')){ $('#modal').classList.remove('on'); } else if(STACK.length) popSheet(); } });
  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) { navigator.serviceWorker.register('sw.js', {scope: './'}).then(r => { r.update().catch(() => {}); document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') r.update().catch(() => {}); }); }).catch(() => {});
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if(reloaded) return; reloaded = true; location.reload(); }); } }
function slatePicker(){ const by = {}; INDEX.slates.forEach(s => (by[s.sport] = by[s.sport] || []).push(s));
  const mon = d => new Date(d).toLocaleDateString('en-US', {month: 'short', timeZone: 'America/New_York'}), dd = d => new Date(d).toLocaleDateString('en-US', {day: 'numeric', timeZone: 'America/New_York'});
  const rec = s => { const r = s.results && s.results.bets; if(!r || !(r.w + r.l)) return ''; const u = r.units || 0; return `<span class="sp2-rec ${u >= 0 ? 'up' : 'dn'}">${r.w}\u2013${r.l}${r.p ? '\u2013' + r.p : ''} \u00b7 ${u >= 0 ? '+' : '\u2212'}${Math.abs(u).toFixed(1)}u</span>`; };
  const row = s => { const st = slateStatus(s), cur = s.id === S.slate, parts = String(s.label || '').split(' \u00b7 ');
    return `<button class="sp2-row${cur ? ' cur' : ''}${st.k === 'live' ? ' live' : ''}" data-pick="${esc(s.id)}"><span class="sp2-date"><small>${esc(mon(s.start_utc))}</small><b>${esc(dd(s.start_utc))}</b></span>
      <span class="sp2-mid"><b>${esc(parts[0] || s.label)}${parts[1] ? `<em>${esc(parts[1])}</em>` : ''}</b><span>${s.n_games || 0} game${s.n_games === 1 ? "" : "s"} \u00b7 ${s.bets} bet${s.bets === 1 ? '' : 's'}</span></span>
      <span class="sp2-end">${st.k === 'live' ? '<span class="sp2-st live"><i></i>Live</span>' : st.k === 'up' ? `<span class="sp2-st">${esc(st.word.replace('Starts in ', 'in '))}</span>` : rec(s) || '<span class="sp2-st">Final</span>'}${cur ? '<span class="sp2-cur" aria-label="Current slate"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' : ''}</span></button>`; };
  modal(`<div class="sp2"><h2>Slates</h2><p class="sp2-sub">Pick a slate to see its games, picks and props.</p>${SPORTS.filter(sp => by[sp]).map(sp => `<div class="sp2-sec"><h3>${sp}</h3><div class="sp2-list">${by[sp].sort((a, b) => a.start_utc < b.start_utc ? 1 : -1).map(row).join('')}</div></div>`).join('')}
    <button class="sp2-imp" id="pick-imp">${ICON.import}Import a slate</button></div>`, (C, close) => { $$('[data-pick]', C).forEach(b => b.onclick = () => { close(); setSlate(b.dataset.pick, S.tab === 'lobby' || S.tab === 'more' ? 'card' : S.tab); }); $('#pick-imp', C).onclick = () => { close(); setTimeout(openImport, 250); }; }); }
boot();
