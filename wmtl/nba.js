/* tail. NBA — the basketball side, built to the NFL side's standard and fed only by data the app is given:
   slates in data/nba/<date>.json (wmtl.slate.v2), the player library in data/nbap, teams in data/nba/teams.json,
   and ESPN's public NBA scoreboard + box scores for live scores. Nothing here estimates a number; anything missing reads "Not available"
   or is left out. Also owns the one-banner header ticker (NFL | NBA switch, Auto by default) that app.js drawTicker hands its items to.
   Loaded after every other script; it wraps, never replaces, the NFL screens (Home, Live Now, game screen, search). */
(function(){
'use strict';
if(typeof SLATE === 'undefined' || typeof LV === 'undefined') return;
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

/* ------------------------------------------------------------ teams: one canonical code per club, ESPN logo slugs, team-colour chips */
const CANON = {GS: 'GSW', NY: 'NYK', NO: 'NOP', NOR: 'NOP', SA: 'SAS', UTAH: 'UTA', UTH: 'UTA', WSH: 'WAS', PHO: 'PHX', BRK: 'BKN', NJN: 'BKN', CHO: 'CHA', OKL: 'OKC'};
const nab = a => { const u = String(a || '').trim().toUpperCase(); return CANON[u] || u; };
const SLUG = {GSW: 'gs', NYK: 'ny', NOP: 'no', SAS: 'sa', UTA: 'utah', WAS: 'wsh'};
const COL = {ATL: '#E03A3E', BOS: '#2E9E5B', BKN: '#A5A8AC', CHA: '#1D8CAB', CHI: '#CE1141', CLE: '#A8324A', DAL: '#1F6FD1', DEN: '#FEC524', DET: '#D4213D', GSW: '#2F6FE0',
  HOU: '#CE1141', IND: '#FDBB30', LAC: '#1D72C8', LAL: '#8A5CC7', MEM: '#5D76A9', MIA: '#D3254A', MIL: '#2E7D4F', MIN: '#2A6FB0', NOP: '#B4975A', NYK: '#F58426',
  OKC: '#1D8FD6', ORL: '#1C7FD0', PHI: '#1D6FC4', PHX: '#E56020', POR: '#E03A3E', SAC: '#6F45B8', SAS: '#A7ADB3', TOR: '#CE1141', UTA: '#7B5CC9', WAS: '#E31837'};
const logoURL = a => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/${SLUG[a] || a.toLowerCase()}.png&w=96&h=96`;
const TLN = (a, cls = '') => { const t = nab(a); return COL[t] ? `<i class="tl ${cls}" style="--tc:${COL[t]}" aria-hidden="true"><img src="${logoURL(t)}" alt="" decoding="async" onerror="this.parentNode.classList.add('nologo')"></i>` : ''; };
window.TLN = TLN;
window.TLS = (sp, a, cls) => sp === 'NBA' ? TLN(a, cls) : (window.TL ? TL(a, cls) : '');

/* ------------------------------------------------------------ markets + stat keys */
const MK = {pts: 'PTS', reb: 'REB', ast: 'AST', tpm: '3PM', pra: 'PRA', pr: 'P+R', pa: 'P+A', ra: 'R+A', stl: 'STL', blk: 'BLK', tov: 'TOV'};
const MKORD = ['pts', 'reb', 'ast', 'tpm', 'pra', 'stl', 'blk', 'pr', 'pa', 'ra', 'tov'];
const BROWSE = ['pts', 'reb', 'ast', 'tpm', 'pra', 'stl', 'blk'];
const MKSUM = {pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast']};
const MKALIAS = {points: 'pts', rebounds: 'reb', assists: 'ast', threes: 'tpm', '3pm': 'tpm', fg3m: 'tpm', steals: 'stl', blocks: 'blk', turnovers: 'tov', pts_reb_ast: 'pra'};
const mkey = m => { const s = String(m || '').toLowerCase(); return MKALIAS[s] || s; };
const SKEY = {pts: ['pts', 'points'], reb: ['reb', 'trb', 'rebounds'], ast: ['ast', 'assists'], tpm: ['tpm', 'fg3m', '3pm', 'fg3', 'threes'], stl: ['stl', 'steals'], blk: ['blk', 'blocks'], tov: ['tov', 'to', 'turnovers'], min: ['min', 'minutes']};
function sv(r, k){ if(!r) return null; const o = r.st || r;
  if(MKSUM[k]){ let s = 0, any = false; for(const x of MKSUM[k]){ const v = sv(r, x); if(isNum(v)){ s += v; any = true; } } return any ? s : null; }
  for(const a of SKEY[k] || [k]){ const v = o[a]; if(isNum(v)) return v; if(typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v; } return null; }
const BK = {DraftKings: 'DK', FanDuel: 'FD', BetMGM: 'MGM', BetRivers: 'BR', Caesars: 'CZR', ESPNBet: 'ESPN', Fanatics: 'FAN'};
const bk = b => BK[b] || String(b || '').slice(0, 4);
const odds = v => isNum(v) ? od(v) : '—';
const GLY = {
  NFL: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="9.5" ry="6" transform="rotate(-35 12 12)"/><path d="M9.2 14.8l5.6-5.6M10.6 11.4l2 2M12.4 9.6l2 2"/></svg>',
  NBA: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 2.5v19M2.5 12h19M5.6 5.2c2.4 2.2 3.6 4.4 3.6 6.8s-1.2 4.6-3.6 6.8M18.4 5.2c-2.4 2.2-3.6 4.4-3.6 6.8s1.2 4.6 3.6 6.8"/></svg>'};
const INDOOR = '<span class="wx-c">🏟️ Indoors</span>';

/* ------------------------------------------------------------ data: current NBA slates, player library, teams */
const rows = () => ((INDEX && INDEX.slates) || []).filter(s => s.sport === 'NBA').sort((a, b) => a.start_utc < b.start_utc ? 1 : -1);
function currentRows(){ const R = rows(); if(!R.length) return []; const now = Date.now();
  const cur = R.filter(s => new Date(s.end_utc || s.start_utc).getTime() + 6 * 3.6e6 > now && new Date(s.start_utc).getTime() < now + 36 * 3.6e6); return cur.length ? cur : [R[0]]; }
async function slates(){ const out = []; for(const s of currentRows()){ try{ out.push(await loadSlate(s.id)); }catch(e){} } return out.sort((a, b) => ((a.games[0] || {}).kick_utc || '') < ((b.games[0] || {}).kick_utc || '') ? -1 : 1); }
const loaded = () => { const ids = new Set(currentRows().map(s => s.id)); return Object.values(SLATE).filter(d => d && d.sport === 'NBA' && (ids.has(d.id) || d.id === S.slate)); };
let PIX = null, TEAMS;
const crow = r => Array.isArray(r) ? {pid: String(r[0]), name: r[1], team: nab(r[2]), pos: r[3] || '', jersey: r[4], status: r[5] || '', contract: r[6] || ''}
  : {pid: String(r.pid ?? r.id ?? ''), name: r.name, team: nab(r.team), pos: r.pos || '', jersey: r.jersey, status: r.status || '', contract: r.contract_type || r.contract || '', gleague: r.gleague || null};
async function loadIndex(){ if(!PIX){ try{ const I = await getJSON('data/nbap/index.json'); PIX = (I.players || []).map(crow).filter(p => p.pid && p.name); }catch(e){ PIX = []; } } return PIX; }
async function loadTeams(){ if(TEAMS === undefined){ try{ TEAMS = await getJSON('data/nba/teams.json'); }catch(e){ TEAMS = null; } } return TEAMS; }
/* contract badge from what the library says: contract_type / contract{type,label} ("two_way", "10_day"…), or a G League assignment */
const contractOf = p => { if(!p) return null; const c = p.contract && typeof p.contract === 'object' ? [p.contract.type, p.contract.label].join(' ') : p.contract;
  const s = [c, p.contract_type, p.status, p.status_label].filter(Boolean).join(' ');
  return /two[\s_-]?way/i.test(s) ? 'Two-way' : /\b10[\s_-]?day|ten[\s_-]?day/i.test(s) ? '10-day' : (p.gleague || /g[\s_-]?league|\bgl\b|assigned/i.test(s)) ? 'G League' : null; };
const samePlayer = (p, pid, name, team) => (pid && (String(p.pid || '') === pid || String(p.pkey || '').split(':').pop() === pid)) || (nkey(p.player) === nkey(name) && (!team || nab(p.team) === team));

/* ------------------------------------------------------------ live: ESPN scoreboard + box scores, every 10 s while a game is live */
const NLV = {games: {}, stats: {}, at: null, err: null, fails: 0, done: {}, t: null, busy: null}; window.NLV = NLV;
const preDetail = iso => iso ? `${dayET(iso).split(',')[0]} ${kickET(iso).replace(' ET', '')}` : '';
const liveOf = (a, h) => NLV.games[nab(a) + '@' + nab(h)] || null;
const gameFor = team => { const t = nab(team); return Object.values(NLV.games).find(g => g.away === t || g.home === t) || null; };
const statsOf = p => NLV.stats[nkey(p.player) + '|' + nab(p.team)] || null;
function parseBox(sm){ for(const t of ((sm && sm.boxscore) || {}).players || []){ const tm = nab((t.team || {}).abbreviation);
  for(const st of t.statistics || []){ const L = (st.names || st.labels || []).map(x => String(x).toUpperCase()), K = st.keys || [];
    for(const at of st.athletes || []){ if(!at.athlete || !Array.isArray(at.stats) || !at.stats.length) continue;
      const v = (lab, key) => { let i = L.indexOf(lab); if(i < 0) i = K.indexOf(key); return i < 0 ? null : at.stats[i]; };
      const num = x => x == null || x === '' || x === '--' || !isFinite(+x) ? null : +x; const made = x => { const n = x == null ? NaN : +String(x).split('-')[0]; return isFinite(n) ? n : null; };
      const o = {pts: num(v('PTS', 'points')), reb: num(v('REB', 'rebounds')), ast: num(v('AST', 'assists')), stl: num(v('STL', 'steals')), blk: num(v('BLK', 'blocks')), tov: num(v('TO', 'turnovers')),
        tpm: made(v('3PT', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted')), min: num(v('MIN', 'minutes'))};
      if(o.pts == null && o.reb == null && o.ast == null) continue; NLV.stats[nkey(at.athlete.displayName) + '|' + tm] = o; } } } }
async function poll(){ if(NLV.busy) return NLV.busy; NLV.busy = (async () => {
  try{ const sb = await getJSON(API + '/scoreboard', true); if(!Array.isArray(sb.events)) throw new Error('ESPN NBA scoreboard changed shape'); const G = {};
    for(const ev of sb.events){ const c = ev.competitions && ev.competitions[0]; if(!c) continue; const cs = c.competitors || []; const h = cs.find(x => x.homeAway === 'home'), a = cs.find(x => x.homeAway === 'away'); if(!h || !a || !h.team || !a.team) continue;
      const H = nab(h.team.abbreviation), A = nab(a.team.abbreviation); const s = c.status || ev.status || {}, ty = s.type || {}; const per = +s.period || 0; const ck = String(s.displayClock || '12:00').split(':');
      const el = per <= 0 ? 0 : per > 4 ? 2880 : Math.min(2880, (per - 1) * 720 + (720 - ((+ck[0] || 0) * 60 + (+ck[1] || 0)))); const state = ty.state || 'pre', kick = ev.date || c.date || null;
      G[A + '@' + H] = {id: String(ev.id), sport: 'NBA', state, away: A, home: H, as: +a.score || 0, hs: +h.score || 0, f: state === 'post' ? 1 : Math.max(0, el / 2880), period: per, kick,
        detail: state === 'pre' ? preDetail(kick) : (ty.shortDetail || ty.detail || '')}; }
    NLV.games = G; const want = new Set(loaded().flatMap(d => d.games.flatMap(g => [nab(g.away.abbr), nab(g.home.abbr)])));
    await Promise.all(Object.values(G).filter(g => (g.state === 'in' || (g.state === 'post' && !NLV.done[g.id])) && (want.has(g.away) || want.has(g.home)))
      .map(async g => { try{ parseBox(await getJSON(API + '/summary?event=' + encodeURIComponent(g.id), true)); if(g.state === 'post') NLV.done[g.id] = 1; }catch(e){} }));
    NLV.at = new Date(); NLV.fails = 0; NLV.err = null;
  }catch(e){ NLV.fails++; NLV.err = e.message; }
  NLV.busy = null; afterPoll(); })(); return NLV.busy; }
function afterPoll(){ try{ TKL.nba(); }catch(e){}
  try{ if(S.tab === 'live' && liveSport() === 'NBA') liveNBA(); if(S.tab === 'lobby') refreshHome();
    const d = SLATE[S.slate]; if(d && d.sport === 'NBA' && ['card', 'props', 'board'].includes(S.tab)) applyNBA($('#main'), d);
    if(NBA._gameTick && !NBA._gameTick()) NBA._gameTick = null; }catch(e){} }
function loop(){ clearTimeout(NLV.t); const live = Object.values(NLV.games).some(g => g.state === 'in'); NLV.t = setTimeout(tick, (NLV.fails >= 3 ? 30 : live ? 10 : 60) * 1000); }
function tick(){ clearTimeout(NLV.t); if(document.visibilityState !== 'visible'){ NLV.t = setTimeout(tick, 15000); return; } poll().then(loop); }
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') tick(); for(const L of Object.values(LANE)) schedule(L); });

/* ------------------------------------------------------------ bet progress (applyProgress hands NBA slates here) */
function pickNow(p){ const g = gameFor(p.team); if(!g || g.state === 'pre') return null; const k = mkey(p.market); if(!(k in MK) || !isNum(p.line) || !p.side) return null;
  const st = statsOf(p); if(!st) return null; const now = sv(st, k); if(!isNum(now)) return null; const over = p.side !== 'under', hit = now > p.line, done = g.state === 'post';
  return {g, now, over, done, win: over ? hit : (done && !hit), loss: over ? (done && !hit) : hit}; }
function applyNBA(root, d){ if(!root || !d) return;
  for(const el of root.querySelectorAll('[data-prop]')){ const p = d.props.find(x => x.id === el.dataset.prop); if(!p || p.no_prediction) continue; const s = pickNow(p); if(!s) continue;
    const state = s.win ? 'win' : s.loss ? 'loss' : 'run'; const frac = Math.max(0, Math.min(1, p.line > 0 ? s.now / p.line : (s.now > 0 ? 1 : 0)));
    const ck = p.id + (el.classList.contains('betcard') ? '|c' : el.classList.contains('x-bet') ? '|h' : '|o');
    if(state === 'win' && typeof CASH_SEEN !== 'undefined' && !CASH_SEEN.has(ck)){ CASH_SEEN.add(ck); if(!el.classList.contains('pg-win')) el.classList.add('pg-cash'); }
    el.classList.add('pg'); el.classList.toggle('pg-win', state === 'win'); el.classList.toggle('pg-loss', state === 'loss'); el.classList.toggle('pg-under', !s.over);
    el.style.setProperty('--pg', (state === 'win' ? 100 : frac * 100).toFixed(1) + '%');
    let tag = el.querySelector(':scope > .pgtag'); if(!tag){ tag = document.createElement('span'); tag.className = 'pgtag'; el.appendChild(tag); }
    tag.textContent = state === 'win' ? `✓ Cashed · ${ln(s.now)}` : state === 'loss' ? `✕ ${s.over ? 'Missed' : 'Over the line'} · ${ln(s.now)}` : `${ln(s.now)} / ${ln(p.line)} ${MK[mkey(p.market)]}${s.over ? '' : ' (under)'}`; } }

/* checkpoint triggers: only where the slate itself carries a plan (props[].live q1_trigger / ht_trigger) */
function betNowNBA(){ const out = [];
  for(const d of loaded()) for(const p of d.props){ const L = p.live; if(!L || !L.plan) continue; const g = gameFor(p.team); if(!g || g.state !== 'in') continue;
    const cp = /half/i.test(g.detail) ? 'ht' : /end (of )?(the )?1st|end q1|end of q1/i.test(g.detail) ? 'q1' : null; if(!cp) continue;
    const m = String((cp === 'ht' ? L.ht_trigger : L.q1_trigger) || '').match(/^\s*(≤|<=|≥|>=|<|>)\s*(-?\d+(?:\.\d+)?)/); if(!m) continue;
    const st = statsOf(p); const v = st ? sv(st, mkey(p.market)) : null; if(!isNum(v)) continue; const n = +m[2];
    const ok = /≤|<=/.test(m[1]) ? v <= n : /≥|>=/.test(m[1]) ? v >= n : m[1] === '<' ? v < n : v > n; if(!ok) continue;
    out.push({p, d, v, cp, line: isNum(L.number) ? L.number : p.line}); } return out; }

/* ------------------------------------------------------------ header ticker: two lanes, one item at a time, NFL rolls up and NBA rolls down */
const LANE = {NFL: {sp: 'NFL', dir: 'up', items: [], i: 0, paused: false, t: null, sigs: {}, seen: new Set(), init: false, next: null},
              NBA: {sp: 'NBA', dir: 'down', items: [], i: 0, paused: false, t: null, sigs: {}, seen: new Set(), init: false, next: null}};
const HOLD = 3200, HOLD_BET = 5200;
function mountLanes(){ const tk = $('#ticker'), tr = $('#tktrack'); if(!tk || !tr) return false; if(tr.dataset.lanes) return true;
  tk.classList.add('tkl2'); tr.dataset.lanes = '1'; tr.removeAttribute('style');
  tr.innerHTML = ['NFL', 'NBA'].map(sp => `<div class="tkl" data-lane="${sp}" data-dir="${LANE[sp].dir}"><span class="tkl-seg" role="group" aria-label="Banner sport">${['NFL', 'NBA'].map(x => `<button type="button" class="tkl-sw" data-sw="${x}" aria-pressed="false">${GLY[x]}<span>${x}</span></button>`).join('')}<i class="tkl-auto" aria-hidden="true">AUTO</i></span><div class="tkl-vp"></div><button type="button" class="tkl-n" aria-label="Next ${sp} item"><span></span><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${sp === 'NFL' ? 'M7 14l5-5 5 5' : 'M7 10l5 5 5-5'}"/></svg></button></div>`).join('');
  for(const sp of ['NFL', 'NBA']){ const L = LANE[sp]; L.el = tr.querySelector(`[data-lane="${sp}"]`); L.vp = $('.tkl-vp', L.el); L.cnt = $('.tkl-n span', L.el);
    $$('.tkl-sw', L.el).forEach(b => b.onclick = e => { e.stopPropagation(); const want = b.dataset.sw;
      if(want === SHOW.on && SHOW.mode !== 'auto'){ SHOW.mode = 'auto'; save(); show(autoPick()); toast('Banner: Auto. Shows the sport that is live or up next'); }
      else { SHOW.mode = want; save(); show(want); toast(`Banner: ${want}. Tap ${want} again for Auto`); } });
    $('.tkl-n', L.el).onclick = e => { e.stopPropagation(); roll(L, true); };
    L.vp.onclick = e => { const t = e.target.closest('[data-tkp],[data-tkg],[data-nbg]'); if(t && openTarget(t)) return; roll(L, true); }; }
  show(SHOW.mode === 'auto' ? autoPick() : SHOW.mode); return true; }
/* one banner: the user picks NFL or NBA with one tap; until then (and after tapping the active sport again) Auto shows what matters now */
const SHOW = {mode: (() => { try{ const v = localStorage.getItem('tail.banner'); return v === 'NFL' || v === 'NBA' ? v : 'auto'; }catch(e){ return 'auto'; } })(), on: null};
function save(){ try{ localStorage.setItem('tail.banner', SHOW.mode); }catch(e){} }
function nextNFL(){ const now = Date.now(); let t = Infinity; for(const d of Object.values(SLATE)){ if(!d || d.sport !== 'NFL') continue; for(const g of d.games || []){ const k = Date.parse(g.kick_utc); if(k > now - 4 * 3600e3 && k < t) t = k; } } return t; }
function nextNBA(){ const now = Date.now(); let t = Infinity; for(const g of Object.values(NLV.games)){ if(g.state !== 'pre') continue; const k = Date.parse(g.kick); if(k > now - 3600e3 && k < t) t = k; } return t; }
function autoPick(){ const has = (sp, k) => LANE[sp].items.some(x => x.kind === k);
  for(const k of ['bet', 'live']) for(const sp of ['NFL', 'NBA']) if(has(sp, k)) return sp;
  const a = nextNFL(), b = nextNBA(); if(a === Infinity && b === Infinity) return SHOW.on || 'NFL'; return b < a ? 'NBA' : 'NFL'; }
function show(sp){ const tr = $('#tktrack'); if(!tr || !sp) return; const ch = SHOW.on !== sp; SHOW.on = sp; tr.dataset.show = sp; tr.dataset.mode = SHOW.mode;
  tr.querySelectorAll('.tkl-sw').forEach(b => { const on = b.dataset.sw === sp; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  for(const x of ['NFL', 'NBA']){ const L = LANE[x]; if(x === sp){ if(ch && L.items.length){ L.i = Math.min(L.i, L.items.length - 1); paint(L, L.items[L.i], false); } schedule(L); } else clearTimeout(L.t); } }
function openTarget(t){
  if(t.dataset.tkp){ const d = Object.values(SLATE).find(x => x && x.props.some(p => p.id === t.dataset.tkp)); if(d){ openProp(d, t.dataset.tkp); return true; } return false; }
  if(t.dataset.tkg){ const [a, h] = t.dataset.tkg.split('|'); for(const d of Object.values(SLATE)){ if(!d || d.sport !== 'NFL') continue; const g = d.games.find(x => x.away.abbr === a && x.home.abbr === h); if(g){ openGame(d.id, g.id); return true; } } toast(`${a} @ ${h} is not on a modeled slate`); return true; }
  if(t.dataset.nbg){ const [a, h] = t.dataset.nbg.split('|'); openByTeams(a, h); return true; } return false; }
function schedule(L){ clearTimeout(L.t); if(!L.el || L.paused || (SHOW.on && SHOW.on !== L.sp) || L.items.length < 2 || document.visibilityState !== 'visible') return; const it = L.items[L.i];
  L.t = setTimeout(() => roll(L), (it && it.kind === 'bet' ? HOLD_BET : HOLD) ); }
function count(L){ if(!L.cnt) return; const n = L.items.length; L.cnt.textContent = n > 1 ? `${L.i + 1}/${n}` : ''; L.el.classList.toggle('single', n < 2); }
function paint(L, it, anim){ const vp = L.vp, old = vp.querySelector('.tkl-it.cur'); const n = document.createElement('div'); n.className = 'tkl-it k-' + it.kind; n.dataset.k = it.k; n.innerHTML = it.html;
  if(it.flash){ n.classList.add('flash'); it.flash = false; } if(it.pulse){ n.classList.add('pulse'); it.pulse = false; }
  if(!old || !anim){ vp.querySelectorAll('.tkl-it').forEach(x => x.remove()); n.classList.add('cur'); vp.appendChild(n); }
  else { vp.querySelectorAll('.tkl-it.leave').forEach(x => x.remove()); n.classList.add('enter'); vp.appendChild(n); void n.offsetWidth; n.classList.remove('enter'); n.classList.add('cur'); old.classList.remove('cur'); old.classList.add('leave'); setTimeout(() => old.remove(), 650); }
  count(L); }
function roll(L, now){ clearTimeout(L.t); if(!L.items.length || !L.el) return; let j = -1; if(L.next){ j = L.items.findIndex(x => x.k === L.next); L.next = null; }
  if(j < 0) j = (L.i + 1) % L.items.length; if(j === L.i && L.vp.querySelector('.tkl-it.cur') && !now){ schedule(L); return; }
  L.i = j; paint(L, L.items[j], true); schedule(L); }
/* team chips render as <span> in the lanes: app.css styles every `.tk i` as a LIVE/FINAL badge */
const spanChips = h => h.replace(/<i class="tl([^"]*)"([^>]*)>(<img[^>]*>)<\/i>/g, '<span class="tl$1"$2>$3</span>');
function setItems(L, list){ if(!mountLanes()) return; const cur = L.items[L.i]; const was = L.init; list.forEach(x => { x.html = spanChips(x.html); });
  for(const x of list){ if(x.sig != null){ const o = L.sigs[x.k]; if(o != null && o !== x.sig) x.pulse = true; L.sigs[x.k] = x.sig; } if(was && !L.seen.has(x.k) && (x.kind === 'win' || x.kind === 'bet')) x.flash = x.kind === 'win'; }
  const jump = was ? list.find(x => x.kind === 'bet' && !L.seen.has(x.k)) || list.find(x => x.kind === 'win' && !L.seen.has(x.k)) : null;
  list.forEach(x => L.seen.add(x.k)); L.items = list;
  if(!was){ L.init = true; L.i = 0; if(list[0]) paint(L, list[0], false); schedule(L); return; }
  const ci = cur ? list.findIndex(x => x.k === cur.k) : -1;
  if(jump){ L.i = ci >= 0 ? ci : Math.min(L.i, list.length - 1); L.next = jump.k; roll(L, true); return; }
  if(ci >= 0){ L.i = ci; const it = list[ci], el = L.vp.querySelector('.tkl-it.cur');
    if(el && el.innerHTML !== it.html){ el.innerHTML = it.html; if(it.pulse){ el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); it.pulse = false; } }
    count(L); if(!L.t) schedule(L); return; }
  L.i = Math.max(0, Math.min(L.i, list.length - 1)); if(list.length) paint(L, list[L.i], true); schedule(L); }
const parse = h => { const t = document.createElement('template'); t.innerHTML = h.trim(); const e = t.content.firstElementChild; if(!e) return null; const c = e.classList, tx = e.textContent.replace(/\s+/g, ' ').trim();
  if(e.dataset.tkg) return {k: 'g:' + e.dataset.tkg, html: h, kind: c.contains('tk-live') ? 'live' : 'final', sig: e.dataset.sc || null};
  if(e.dataset.tkp) return {k: 'p:' + e.dataset.tkp, html: h, kind: c.contains('tk-bet') ? 'bet' : 'win'};
  if(c.contains('tk-sum')) return {k: 'sum', html: h, kind: 'sum'}; if(c.contains('tk-wx')) return {k: 'wx:' + tx, html: h, kind: 'wx'}; return {k: 'i:' + tx, html: h, kind: 'info'}; };
function betNowNFL(){ const out = []; if(!LV.at || !Object.values(LV.games).some(g => g.state === 'in')) return out;
  for(const d of Object.values(SLATE)){ if(!d || d.sport !== 'NFL') continue; try{ liveNowHTML(d); }catch(e){ continue; }
    for(const p of d.props){ const lm = p._lm; if(!lm || !lm.bet || !Object.values(LV.games).some(g => g.state === 'in' && (g.away === p.team || g.home === p.team))) continue;
      out.push({k: `b:${p.id}:${lm.side}:${lm.line}`, kind: 'bet', html: `<span class="tk tk-bet" data-tkp="${esc(p.id)}"><i>BET NOW</i>${window.TL ? TL(p.team, 'xs') : ''}${esc(p.player)} ${lm.side === 'under' ? 'U' : 'O'} <b>${ln(lm.line)}</b> ${esc(STATWORD[p.market] || p.market_label)}${isNum(lm.price) ? ` · <b>${od(lm.price)}</b>` : ''}</span>`}); } }
  return out; }
function itemsNBA(){ const out = [], G = Object.values(NLV.games); const ord = s => s === 'in' ? 0 : s === 'post' ? 1 : 2;
  for(const b of betNowNBA()){ const p = b.p; out.push({k: `b:${p.id}:${b.cp}`, kind: 'bet', html: `<span class="tk tk-bet" data-tkp="${esc(p.id)}"><i>BET NOW</i>${TLN(p.team, 'xs')}${esc(p.player)} ${p.side === 'under' ? 'U' : 'O'} <b>${ln(b.line)}</b> ${MK[mkey(p.market)]} · ${ln(b.v)} at ${b.cp === 'ht' ? 'half' : 'end Q1'}</span>`}); }
  const nb = out.length; let w = 0, l = 0; const seen = new Set(), wins = [];
  for(const d of loaded()) for(const p of d.props){ if(p.no_prediction || !(p.tier === 'bet' || (pSide(p) || 0) >= .55)) continue; const s = pickNow(p); if(!s) continue; const k = p.player + p.market; if(seen.has(k)) continue; seen.add(k);
    if(s.win){ w++; wins.push({k: 'p:' + p.id, kind: 'win', html: `<span class="tk tk-win" data-tkp="${esc(p.id)}">✓ ${TLN(p.team, 'xs')}${esc(p.player)} ${esc(selText(p))} · <b>${ln(s.now)}</b>${p.tier === 'bet' ? ' · BET' : ''}</span>`}); } else if(s.loss) l++; }
  for(const g of G.filter(g => g.state !== 'pre').sort((a, b) => ord(a.state) - ord(b.state)))
    out.push({k: `g:${g.away}@${g.home}`, kind: g.state === 'in' ? 'live' : 'final', sig: `${g.as}-${g.hs}`, html: `<span class="tk ${g.state === 'in' ? 'tk-live' : ''}" data-nbg="${esc(g.away)}|${esc(g.home)}"><i>${g.state === 'in' ? 'LIVE' : 'FINAL'}</i>${TLN(g.away, 'xs')}${esc(g.away)} <b>${g.as}</b> · ${TLN(g.home, 'xs')}${esc(g.home)} <b>${g.hs}</b>${g.state === 'in' ? ' · ' + esc(g.detail) : ''}</span>`});
  out.push(...wins); if(w + l) out.splice(nb, 0, {k: 'sum', kind: 'sum', html: `<span class="tk tk-sum"><i>MODEL PICKS</i> <b>${w}</b> cashed · <b>${l}</b> missed</span>`});
  if(!G.some(g => g.state === 'in')) for(const g of G.filter(g => g.state === 'pre').sort((a, b) => (a.kick || '') < (b.kick || '') ? -1 : 1).slice(0, 8))
    out.push({k: `u:${g.away}@${g.home}`, kind: 'pre', html: `<span class="tk tk-pre" data-nbg="${esc(g.away)}|${esc(g.home)}"><i>TIP</i><b>${esc(g.kick ? kickET(g.kick).replace(' ET', '') : '')}</b> · ${TLN(g.away, 'xs')}${esc(g.away)} @ ${TLN(g.home, 'xs')}${esc(g.home)}</span>`});
  if(!out.length) out.push({k: 'i:none', kind: 'info', html: `<span class="tk">${NLV.at ? 'No NBA game on today' : NLV.err ? 'NBA scores not available right now' : 'Checking NBA scores…'}</span>`});
  return out; }
const TKL = window.TKL = {
  nfl(items){ if(!mountLanes()) return; const list = (items || []).map(parse).filter(Boolean); setItems(LANE.NFL, [...betNowNFL(), ...list]); if(SHOW.mode === 'auto') show(autoPick()); },
  nba(){ if(!mountLanes()) return; setItems(LANE.NBA, itemsNBA()); if(SHOW.mode === 'auto') show(autoPick()); }, lanes: LANE, show: s => { SHOW.mode = s === 'auto' ? 'auto' : s; save(); show(s === 'auto' ? autoPick() : s); }};

/* ------------------------------------------------------------ shared pieces (same markup and classes as the NFL screens) */
function best(p, side){ const offs = (p.offers || []).filter(o => isNum(o[side])); const at = offs.filter(o => o.line === p.line); let b = null;
  for(const o of (at.length ? at : offs)){ if(!b || decOdds(o[side]) > decOdds(b.v)) b = {k: (window.BOOK && BOOK.find(o.book)) ? o.book : bk(o.book), v: o[side], line: o.line}; }
  if(!b && p.best && isNum(p.best[side])) b = {k: (window.BOOK && BOOK.find(p.best.book)) ? p.best.book : bk(p.best.book), v: p.best[side], line: p.best.line}; return b; }
const priceBtn = (lab, b, cls = '') => b ? `<span class="x-odd ${cls}"><small>${esc(lab)}</small><b>${odds(b.v)}</b><i>${window.BOOK && BOOK.find(b.k) ? `<img class="bk-mini" src="${BOOK.find(b.k).logo}" alt="">` : ''}${esc(window.BOOK && BOOK.find(b.k) ? BOOK.find(b.k).short : b.k)}</i></span>` : `<span class="x-odd x-off"><small>${esc(lab)}</small><b>—</b></span>`;
const mpick = p => !p.no_prediction && p.side && (isNum(p.p) || isNum(pSide(p)));
const pidOf = p => p.pid ? String(p.pid) : String(p.pkey || '').startsWith('nba:') && !/^nba:x:/.test(p.pkey) ? String(p.pkey).split(':').pop() : '';
function mrow(p, d){ const k = mkey(p.market), g = p._g || {}; const md = mpick(p);
  return `<div class="x-mrow" data-nbpl="${esc(pidOf(p))}|${esc(p.player)}|${esc(nab(p.team))}|${esc(k)}"><div class="x-mwho"><b>${esc(p.player)}</b><span>${esc(nab(p.team))} · ${g.away ? `${esc(nab(g.away.abbr))} @ ${esc(nab(g.home.abbr))}` : 'vs ' + esc(nab(p.opp))}</span>${md ? `<span class="x-model ${p.tier === 'bet' ? 'bet' : ''}">${p.tier === 'bet' ? 'Bet · ' : 'Model · '}${p.side === 'under' ? 'Under' : 'Over'} ${pc(pSide(p))}${isNum(p.projection) ? ' · proj ' + ln(p.projection) : ''}</span>` : ''}</div>
    <div class="x-mline">${priceBtn('O ' + ln(p.line), best(p, 'over'), md && p.side === 'over' ? 'pick' : '')}${priceBtn('U ' + ln(p.line), best(p, 'under'), md && p.side === 'under' ? 'pick' : '')}</div></div>`; }
const wireRows = el => $$('[data-nbpl]', el).forEach(b => b.onclick = () => { const [pid, n, t, k] = b.dataset.nbpl.split('|'); NBA.openCard(pid || n, t, k); });
function openByTeams(a, h){ a = nab(a); h = nab(h); for(const d of Object.values(SLATE)){ if(!d || d.sport !== 'NBA') continue; const g = d.games.find(x => nab(x.away.abbr) === a && nab(x.home.abbr) === h); if(g){ openGame(d.id, g.id); return; } }
  toast(`${a} @ ${h} is not on a modeled NBA slate`); }
const scoreBoxNBA = (st, big) => window.scoreBox ? scoreBox(st, big) : '';
function wireBoxes(root){ if(window.wireSB) wireSB(root); $$('[data-sbs="NBA"]', root).forEach(b => b.onclick = () => { const [a, h] = b.dataset.sbg.split('|'); openByTeams(a, h); }); }

/* ------------------------------------------------------------ Live Now: NFL | NBA toggle, remembered per device */
const LSK = 'tail.liveSport';
const getLS = () => { try{ return localStorage.getItem(LSK); }catch(e){ return null; } };
const setLS = v => { try{ localStorage.setItem(LSK, v); }catch(e){} };
const liveN = sp => Object.values(sp === 'NBA' ? NLV.games : LV.games).filter(g => g.state === 'in').length;
function liveSport(){ const s = getLS(); if(s === 'NFL' || s === 'NBA') return s; return !liveN('NFL') && liveN('NBA') ? 'NBA' : 'NFL'; }
const segHTML = sp => `<div class="seg lvseg" role="group" aria-label="Sport">${['NFL', 'NBA'].map(k => `<button type="button" data-lvsp="${k}" aria-pressed="${sp === k}">${GLY[k]}<span>${k}</span>${liveN(k) ? `<span class="n">${liveN(k)} live</span>` : ''}</button>`).join('')}</div>`;
function wireSeg(root){ $$('[data-lvsp]', root).forEach(b => b.onclick = () => { const k = b.dataset.lvsp; setLS(k); if(k === 'NBA' && !NLV.at) poll(); window.viewLiveNow2(); window.scrollTo(0, 0); }); }
function liveNBA(){ const m = $('#main'); if(S.tab !== 'live') return; const G = Object.values(NLV.games);
  const live = G.filter(g => g.state === 'in'), pre = G.filter(g => g.state === 'pre').sort((a, b) => (a.kick || '') < (b.kick || '') ? -1 : 1), fin = G.filter(g => g.state === 'post');
  m.innerHTML = `<div class="view"><div class="x-hero"><h1>Live now</h1><p>${live.length ? `${live.length} game${live.length > 1 ? 's' : ''} in progress · updates every 10 seconds` : NLV.at ? 'No NBA game is in progress right now.' : NLV.err ? 'NBA scores are not available right now. Retrying.' : 'Checking NBA scores…'}</p></div>
    ${segHTML('NBA')}
    ${live.length ? `<div class="x-livehero">${live.map(st => scoreBoxNBA(st, true)).join('')}</div>` : ''}
    ${pre.length ? `<div class="x-shelf"><div class="x-shead"><h2>Coming up</h2></div><div class="x-sbgrid">${pre.map(st => scoreBoxNBA(st)).join('')}</div></div>` : ''}
    ${fin.length ? `<div class="x-shelf"><div class="x-shead"><h2>Final</h2></div><div class="x-sbgrid">${fin.map(st => scoreBoxNBA(st)).join('')}</div></div>` : ''}
    ${!G.length ? `<p class="sub">${NLV.at ? 'No NBA games on today’s ESPN scoreboard.' : 'Loading scores…'}</p>` : ''}</div>`;
  wireSeg(m); wireBoxes(m); }
const _live = window.viewLiveNow2;
if(_live) window.viewLiveNow2 = async function(){ if(liveSport() === 'NBA') return liveNBA(); await _live.apply(this, arguments);
  const v = $('#main .view'); if(!v || S.tab !== 'live' || $('.lvseg', v)) return; const w = document.createElement('div'); w.innerHTML = segHTML('NFL'); const s = w.firstElementChild; const h = $('.x-hero', v); h ? h.after(s) : v.prepend(s); wireSeg(v); };
const _hero = window.liveHeroHTML;
if(_hero) window.liveHeroHTML = () => { const a = _hero(); const L = Object.values(NLV.games).filter(g => g.state === 'in'); if(!L.length) return a;
  const boxes = L.map(st => scoreBoxNBA(st, true)).join(''); return a ? a.replace(/<\/div><\/div>$/, boxes + '</div></div>') : `<div class="x-shelf"><div class="x-shead"><h2>Live now</h2></div><div class="x-livehero">${boxes}</div></div>`; };

/* ------------------------------------------------------------ Home: NBA shelf (games, model bets, browse PTS/REB/AST/3PM/PRA/STL/BLK, strongest sides) */
const todayET = () => new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
function gameCard({g, d}){ const A = nab(g.away.abbr), H = nab(g.home.abbr); const st = liveOf(A, H); const mk = g.market || {}; const live = st && st.state === 'in', fin = st && st.state === 'post';
  const sp = isNum(mk.spread_home) ? mk.spread_home : null; const fmt = v => v === 0 ? 'PK' : (v > 0 ? '+' : '−') + ln(Math.abs(v));
  const nb = d.props.filter(p => p.tier === 'bet' && [A, H].includes(nab(p.team))).length;
  return `<button class="x-game ${live ? 'is-live' : ''}" data-game="${esc(g.id)}" data-sl="${esc(d.id)}"><div class="x-gtop"><span class="wx-slot">${INDOOR}</span>${live ? `<span class="x-live">Live</span> ${esc(st.detail)}` : fin ? 'Final' : `${esc(dayET(g.kick_utc).split(',')[0])} ${kickET(g.kick_utc).replace(' ET', '')}`}</div>
    <div class="x-team">${TLN(A)}<b>${esc(A)}</b><span class="num">${st && st.state !== 'pre' ? st.as : isNum(sp) ? fmt(-sp) : ''}</span></div>
    <div class="x-team">${TLN(H)}<b>${esc(H)}</b><span class="num">${st && st.state !== 'pre' ? st.hs : isNum(sp) ? fmt(sp) : ''}</span></div>
    <div class="x-gfoot">${isNum(mk.total) ? `O/U ${ln(mk.total)}` : ''}${nb ? ` · <em>${nb} bet${nb > 1 ? 's' : ''}</em>` : ''}</div></button>`; }
function espnCard(st){ return `<button class="x-game ${st.state === 'in' ? 'is-live' : ''}" data-nbg="${esc(st.away)}|${esc(st.home)}"><div class="x-gtop"><span class="wx-slot">${INDOOR}</span>${st.state === 'in' ? `<span class="x-live">Live</span> ${esc(st.detail)}` : st.state === 'post' ? 'Final' : esc(st.detail)}</div>
    <div class="x-team">${TLN(st.away)}<b>${esc(st.away)}</b><span class="num">${st.state === 'pre' ? '' : st.as}</span></div><div class="x-team">${TLN(st.home)}<b>${esc(st.home)}</b><span class="num">${st.state === 'pre' ? '' : st.hs}</span></div></button>`; }
function betCard({p, d}){ return `<button class="x-bet" data-prop="${esc(p.id)}" data-sl="${esc(d.id)}"><div class="xb-top"><span class="xb-tier">Model bet</span><span class="xb-mu">${esc(nab(p.team))} vs ${esc(nab(p.opp))}</span></div>
    <div class="xb-head"><div class="xb-sel">${esc(selText(p))}</div><div class="xb-price"><b>${odds(p.odds)}</b><i>${esc(p.book || '')}</i></div></div>
    <div class="xb-name">${esc(p.player)}</div>${chanceRail(p.p ?? pSide(p), p.break_even, '')}
    <div class="xb-foot"><span class="xb-edge">Edge <b>${sg(p.edge_pts)}</b></span>${isNum(p.units) ? `<span>Stake <b>${p.units}u</b></span>` : ''}</div></button>`; }
const tag = t => `<span class="nb-tag">${GLY.NBA}NBA</span>${esc(t)}`;
function homeHTML(ds){ const games = ds.flatMap(d => d.games.map(g => ({g, d}))).sort((a, b) => a.g.kick_utc < b.g.kick_utc ? -1 : 1);
  if(!games.length){ const G = Object.values(NLV.games); if(!G.length) return '';
    return `<div class="x-shelf"><div class="x-shead"><h2>${tag('Today')}</h2></div><div class="x-row" data-nbrow>${G.map(espnCard).join('')}</div><p class="note">The NBA model has not posted a slate for these games yet. Scores: ESPN.</p></div>`; }
  const bets = ds.flatMap(d => d.props.filter(p => p.tier === 'bet').map(p => ({p, d}))).sort((a, b) => (b.p.edge_pts || 0) - (a.p.edge_pts || 0));
  const tops = ds.flatMap(d => d.props.filter(p => p.tier !== 'bet' && mpick(p) && isNum(p.line) && isNum(pSide(p))).map(p => ({p, d}))).sort((a, b) => pSide(b.p) - pSide(a.p)).slice(0, 6);
  const cnt = k => ds.reduce((a, d) => a + d.props.filter(p => mkey(p.market) === k && isNum(p.line)).length, 0);
  const m0 = ds[0].meta || {}; const when = m0.date === todayET() ? 'Tonight' : (m0.date_label || m0.label || 'Slate');
  return `<div class="x-shelf"><div class="x-shead"><h2>${tag(when)}</h2><button class="x-link" data-nbgo="card">All picks</button></div><div class="x-row" data-nbrow>${games.map(gameCard).join('')}</div></div>
    ${bets.length ? `<div class="x-shelf"><div class="x-shead"><h2>${tag('Model bets')}</h2><button class="x-link" data-nbgo="card">See all ${bets.length}</button></div><div class="x-row">${bets.slice(0, 10).map(betCard).join('')}</div></div>` : ''}
    <div class="x-shelf"><div class="x-shead"><h2>${tag('Browse props')}</h2></div><div class="x-chips">${BROWSE.map(k => { const n = cnt(k); return `<button class="x-chip" data-nbmk="${k}"${n ? '' : ' disabled'}>${MK[k]}${n ? `<span class="nb-n">${n}</span>` : ''}</button>`; }).join('')}<button class="x-chip" data-search>Find a player</button></div></div>
    ${tops.length ? `<div class="x-shelf"><div class="x-shead"><h2>${tag('Strongest sides')}</h2></div><div class="x-list">${tops.map(({p, d}) => `<button class="x-li" data-prop="${esc(p.id)}" data-sl="${esc(d.id)}"><div><b>${esc(p.player)}</b><span>${esc(selText(p))} · ${esc(nab(p.team))} vs ${esc(nab(p.opp))}</span></div><div class="x-pct">${pc(pSide(p))}</div></button>`).join('')}</div></div>` : ''}`; }
function wireHome(host, ds){ $$('[data-game]', host).forEach(b => b.onclick = () => openGame(b.dataset.sl, b.dataset.game)); $$('[data-nbg]', host).forEach(b => b.onclick = () => { const [a, h] = b.dataset.nbg.split('|'); openByTeams(a, h); });
  $$('[data-prop]', host).forEach(b => b.onclick = () => { const d = SLATE[b.dataset.sl]; if(d) openProp(d, b.dataset.prop); });
  $$('[data-nbmk]', host).forEach(b => b.onclick = () => openMarket(b.dataset.nbmk)); $$('[data-search]', host).forEach(b => b.onclick = () => openSearch());
  $$('[data-nbgo]', host).forEach(b => b.onclick = () => { const s = ds.find(d => d.props.some(p => p.tier === 'bet')) || ds[0]; if(s) setSlate(s.id, b.dataset.nbgo); });
  for(const d of ds) applyNBA(host, d); }
let HDS = [];
async function homeNBA(){ if(S.tab !== 'lobby') return; const v = $('#main .x-home'); if(!v) return; const ds = await slates(); if(S.tab !== 'lobby' || !document.body.contains(v)) return; HDS = ds;
  let host = $('#nba-home', v); if(!host){ host = document.createElement('section'); host.id = 'nba-home'; host.className = 'nb-home'; host.setAttribute('aria-label', 'NBA');
    const g = $('.x-shelf .x-row [data-game]', v); const anchor = g ? g.closest('.x-shelf') : $('#x-livehero-slot', v); if(anchor) anchor.after(host); else v.appendChild(host); }
  host.innerHTML = homeHTML(ds); host.hidden = !host.innerHTML.trim(); wireHome(host, ds); }
function refreshHome(){ const host = $('#nba-home'); if(!host) return homeNBA(); const r = $('[data-nbrow]', host); if(!r){ if(!HDS.length && Object.keys(NLV.games).length) homeNBA(); return; }
  const x = r.scrollLeft; r.innerHTML = HDS.length ? HDS.flatMap(d => d.games.map(g => ({g, d}))).sort((a, b) => a.g.kick_utc < b.g.kick_utc ? -1 : 1).map(gameCard).join('') : Object.values(NLV.games).map(espnCard).join('');
  r.scrollLeft = x; wireHome(r, HDS); for(const d of HDS) applyNBA(host, d); }
const _home = window.viewHome2;
if(_home) window.viewHome2 = async function(){ const r = await _home.apply(this, arguments); try{ await homeNBA(); }catch(e){} return r; };

/* market sheet: one NBA stat across the current slate */
async function openMarket(k){ const ds = await slates(); const rs = ds.flatMap(d => d.props.filter(p => mkey(p.market) === k && isNum(p.line)).map(p => ({p, d})))
    .sort((a, b) => ((b.p.tier === 'bet') - (a.p.tier === 'bet')) || ((mpick(b.p) ? pSide(b.p) : 0) - (mpick(a.p) ? pSide(a.p) : 0)));
  pushSheet(`NBA ${MK[k]}`, `<div class="body"><div class="lt"><span class="sp" style="--c:var(--act)">NBA · ${esc(MK[k])}</span><h1>${esc(MK[k])}</h1><p>${rs.length} player${rs.length === 1 ? '' : 's'} on the current slate. Best price among the books the slate lists; model side where it has one.</p></div><div class="x-mkt">${rs.map(r => mrow(r.p, r.d)).join('') || '<p class="sub">No props posted for this stat.</p>'}</div></div>`, el => wireRows(el)); }

/* ------------------------------------------------------------ game screen: Picks / Live / Props / Players (no Weather: NBA is indoors) */
async function nbaGame(d, gid){ const g = d.games.find(x => x.id === gid); if(!g) return; const A = nab(g.away.abbr), H = nab(g.home.abbr); const mk = g.market || {};
  const ps = d.props.filter(p => [A, H].includes(nab(p.team))); let tab = 'Picks'; const TABS = ['Picks', 'Live', 'Props', 'Players'];
  const head = () => { const st = liveOf(A, H) || {state: 'pre', as: '', hs: ''}; const live = st.state === 'in';
    return `<div class="x-board ${live ? 'live' : ''}"><div class="x-bt"><span class="wx-slot">${INDOOR}</span>${live ? `<span class="x-live">Live</span>${esc(st.detail)}` : st.state === 'post' ? 'Final' : `${esc(dayET(g.kick_utc))} · ${kickET(g.kick_utc)}`}</div>
      <div class="sbd"><div class="sbd-t">${TLN(A, 'lg')}<b>${esc(A)}</b></div><div class="sbd-s">${st.state === 'pre' ? '<i>@</i>' : `<b class="${+st.as > +st.hs ? 'w' : ''}">${st.as}</b><i>–</i><b class="${+st.hs > +st.as ? 'w' : ''}">${st.hs}</b>`}</div><div class="sbd-t">${TLN(H, 'lg')}<b>${esc(H)}</b></div></div>
      <div class="x-lines"><div><small>Spread</small><b>${isNum(mk.spread_home) ? `${esc(H)} ${mk.spread_home > 0 ? '+' : ''}${ln(mk.spread_home)}` : '—'}</b></div><div><small>Total</small><b>${isNum(mk.total) ? ln(mk.total) : '—'}</b></div><div><small>Moneyline</small>${mk.moneyline && (isNum(mk.moneyline.away) || isNum(mk.moneyline.home)) ? `<b class="ml2"><span>${esc(A)} ${odds(mk.moneyline.away)}</span><span>${esc(H)} ${odds(mk.moneyline.home)}</span></b>` : '<b>—</b>'}</div></div></div>`; };
  const liveTab = () => { const st = liveOf(A, H); if(!st || st.state === 'pre') return `<div class="group pad"><span class="sub">${NLV.err && !NLV.at ? 'Live data not available right now (' + esc(NLV.err) + '). Retrying.' : `Tips off ${esc(dayET(g.kick_utc))} · ${kickET(g.kick_utc)}. Player stats show here once the game starts, every 10 seconds.`}</span></div>`;
    const rs = ps.filter(p => isNum(p.line) && p.side && !p.no_prediction).sort((a, b) => (b.tier === 'bet') - (a.tier === 'bet') || (pSide(b) || 0) - (pSide(a) || 0)); const t = NLV.at ? NLV.at.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', second: '2-digit'}) : '';
    return `<div class="group lvlist">${rs.map(p => { const s = statsOf(p), k = mkey(p.market), now = s ? sv(s, k) : null;
      return `<div class="lv" data-prop="${esc(p.id)}"><div class="lvt"><b>${esc(p.player)}</b> <span class="sub">${esc(MK[k] || p.market_label)}</span>${p.tier === 'bet' ? ' <span class="pill pill-bet">Bet</span>' : ''}</div>
        <div class="lvg"><div><span class="label">Now</span><b class="num">${isNum(now) ? ln(now) : '—'}</b></div><div><span class="label">Line</span><b class="num">${ln(p.line)}</b><span class="sub">${p.side === 'under' ? 'U' : 'O'} ${pc(pSide(p))}</span></div>
        <div><span class="label">Projection</span><b class="num">${ln(p.projection)}</b></div><div><span class="label">Minutes</span><b class="num">${s && isNum(s.min) ? s.min : '—'}</b></div></div></div>`; }).join('') || '<div class="pad sub">No props with a line for this game.</div>'}</div>
      <p class="note">Updated ${esc(t)}, every 10 seconds while live. Stats: ESPN box score. The NBA side has no in-game model yet, so live bets show only where the slate carries a checkpoint plan.</p>`; };
  const body = el => { const box = $('#x-gb', el); $$('[data-gt2]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.gt2 === tab));
    if(tab === 'Picks'){ const bets = ps.filter(p => p.tier === 'bet').sort((a, b) => (b.edge_pts || 0) - (a.edge_pts || 0)); const sides = ps.filter(p => p.tier !== 'bet' && mpick(p) && isNum(pSide(p)) && isNum(p.line)).sort((a, b) => pSide(b) - pSide(a));
      box.innerHTML = `${bets.length ? `<h3 class="x-h3">Model bets</h3><div class="cardlist">${bets.map(p => ticket(p, d)).join('')}</div>` : (ps.some(p => isNum(p.odds)) ? '<div class="x-take off"><b>No priced model bets in this game</b><small>The strongest model sides are below.</small></div>' : '<div class="x-take off"><b>No sportsbook prices posted yet</b><small>Picks appear once books post lines. The model\'s projections are below.</small></div>')}
        ${sides.length ? `<h3 class="x-h3">Model side on every prop</h3><div class="info" style="padding:0">${sides.map(p => sideRow(p, d)).join('')}</div>` : (window.projHTML ? projHTML(ps, d) : '')}`; bindTaps(box, d); applyNBA(box, d); $$('[data-pl]', box).forEach(b => b.onclick = () => { const [nm, tm] = b.dataset.pl.split('|'); NBA.openCard(nm, tm); }); }
    else if(tab === 'Live'){ box.innerHTML = liveTab(); bindTaps(box, d); applyNBA(box, d); }
    else if(tab === 'Props'){ const by = {}; ps.filter(p => isNum(p.line)).forEach(p => (by[mkey(p.market)] = by[mkey(p.market)] || []).push(p));
      const ks = Object.keys(by).sort((a, b) => (MKORD.indexOf(a) + 99) % 99 - (MKORD.indexOf(b) + 99) % 99);
      box.innerHTML = ks.length ? ks.map(k => `<div class="x-grp"><h3>${esc(MK[k] || k)}</h3>${by[k].sort((a, b) => (b.tier === 'bet') - (a.tier === 'bet') || b.line - a.line).map(p => mrow(p, d)).join('')}</div>`).join('') : '<p class="sub">No props posted for this game yet.</p>'; wireRows(box); }
    else { const by = {}; for(const p of ps){ const t = nab(p.team); by[t] = by[t] || new Map(); const k = nkey(p.player); const e = by[t].get(k) || {p, n: 0}; e.n++; by[t].set(k, e); }
      box.innerHTML = [A, H].filter(t => by[t]).map(t => `<h3 class="x-h3">${TLN(t, 'sm')}${esc(t)}</h3><div class="x-list">${[...by[t].values()].map(({p, n}) => `<button class="x-li" data-nbpl="${esc(pidOf(p))}|${esc(p.player)}|${esc(t)}|"><div><b>${esc(p.player)}</b><span>${n} prop${n > 1 ? 's' : ''}</span></div><div>${ICON.chev}</div></button>`).join('')}</div>`).join('') || '<p class="sub">No player props posted for this game yet.</p>';
      wireRows(box); } };
  const html = `<div class="body nb-game"><div id="x-ghead">${head()}</div><div class="x-tabs" role="tablist">${TABS.map(l => `<button data-gt2="${l}" aria-pressed="${l === tab}">${l}</button>`).join('')}</div><div id="x-gb"></div></div>`;
  pushSheet(`${A} @ ${H}`, html, el => { $$('[data-gt2]', el).forEach(b => b.onclick = () => { tab = b.dataset.gt2; body(el); }); body(el); if(!NLV.at) poll();
    NBA._gameTick = () => { if(!document.body.contains(el)) return false; $('#x-ghead', el).innerHTML = head(); if(tab === 'Live' || tab === 'Picks') body(el); return true; }; }); }
const _og = window.openGame;
window.openGame = async function(slId, gid){ let d = SLATE[slId]; if(!d){ try{ d = await loadSlate(slId); }catch(e){ d = null; } } if(d && d.sport === 'NBA') return nbaGame(d, gid); return _og.apply(this, arguments); };

/* ------------------------------------------------------------ player card (mirrors openCard) + universal search rows */
const LOGC = [['min', 'MIN'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['tpm', '3PM'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO']];
function logTable(rs){ if(!rs.length) return '<p class="sub">No games.</p>'; const cols = LOGC.filter(([k]) => rs.some(r => isNum(sv(r, k))));
  return `<div class="tbl"><table><thead><tr><th>Date</th><th>Opp</th><th>Result</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rs.map(r => `<tr><td>${esc(String(r.d || r.date || '').slice(5))}</td><td>${esc(r.ha === '@' ? '@' : 'vs')} ${esc(nab(r.opp))}</td><td>${esc(r.dnp ? 'DNP' : r.res || '')}</td>${cols.map(([k]) => { const v = sv(r, k); return `<td class="num">${isNum(v) ? (Number.isInteger(v) ? v : v.toFixed(1)) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`; }
function careerTable(rs){ if(!rs.length) return ''; const cols = [['g', 'G'], ...LOGC.slice(1)].filter(([k]) => rs.some(r => isNum(k === 'g' ? r.g : sv(r, k))));
  return `<div class="tbl"><table><thead><tr><th>Yr</th><th>Tm</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rs.map(r => `<tr><td>${esc(r.season || '')}</td><td>${esc(nab(r.team || r.tm || ''))}</td>${cols.map(([k]) => { const v = k === 'g' ? r.g : sv(r, k); return `<td class="num">${isNum(v) ? (Number.isInteger(v) ? v : v.toFixed(1)) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`; }
function cardBody(P, x, log){ if(!x) return `<p class="sub">No props posted for this player on the current NBA slate.</p>`;
  const {p, d} = x, k = mkey(p.market), L = p.line, md = mpick(p); const bo = best(p, 'over'), bu = best(p, 'under');
  let out = `<div class="x-sel"><div class="x-selh"><div><small>${esc(MK[k] || p.market_label)}</small><b class="num">${ln(L)}</b></div><div class="x-mline big">${priceBtn('Over', bo, md && p.side === 'over' ? 'pick' : '')}${priceBtn('Under', bu, md && p.side === 'under' ? 'pick' : '')}</div></div>
    ${md ? `<div class="x-take ${p.tier === 'bet' ? 'bet' : ''}" data-prop="${esc(p.id)}" data-sl="${esc(d.id)}"><div><small>${p.tier === 'bet' ? 'Model bet' : 'Model side'}</small><b>${p.side === 'under' ? 'Under' : 'Over'} ${ln(L)}</b></div><div><small>Chance</small><b>${pc(pSide(p))}</b></div><div><small>Projection</small><b>${ln(p.projection)}</b></div><div class="x-go">Report</div></div>`
      : `<div class="x-take off"><b>No model prediction</b><small>${p.no_prediction ? esc((p.flags || []).join(' · ') || 'outside what the model was trained on') : 'The model has no side on this prop.'}</small></div>`}
    ${window.BOOK ? BOOK.slip({label: `${p.player} ${(md ? p.side : 'over') === 'under' ? 'Under' : 'Over'} ${ln(L)} ${MK[k] || p.market_label}`, side: md ? p.side : 'over', line: L, rows: p.offers || []}) : ''}</div>`;
  const games = log.filter(r => !r.dnp && isNum(sv(r, k))).slice(0, 10);
  if(games.length && isNum(L)){ const vals = games.map(r => sv(r, k)); const rate = n => { const v = vals.slice(0, n); return v.length ? v.filter(z => z > L).length / v.length : null; };
    const all = log.filter(r => !r.dnp).map(r => sv(r, k)).filter(isNum); const sr = all.length ? all.filter(z => z > L).length / all.length : null;
    const mx = Math.max(L * 1.6, ...vals, 1), W = 300, Hh = 150, bw = W / 10; const ly = Hh - 18 - L / mx * (Hh - 22);
    const bars = vals.slice().reverse().map((v, i) => { const h = Math.max(2, v / mx * (Hh - 22)); const r = games[games.length - 1 - i]; return `<g><rect x="${i * bw + 4}" y="${Hh - 18 - h}" width="${bw - 8}" height="${h}" rx="4" class="${v > L ? 'hi' : 'lo'}"/><text x="${i * bw + bw / 2}" y="${Hh - 22 - h}" class="v">${ln(v)}</text><text x="${i * bw + bw / 2}" y="${Hh - 4}" class="o">${esc(nab(r.opp || ''))}</text></g>`; }).join('');
    out += `<div class="x-hit"><div class="x-rates">${[['Last 5', rate(5)], ['Last 10', rate(10)], ['Season', sr]].map(([l, r]) => `<div class="${r == null ? '' : r >= .6 ? 'good' : r <= .4 ? 'bad' : ''}"><small>${l}</small><b>${r == null ? '—' : pc(r)}</b></div>`).join('')}</div>
      <svg class="x-chart" viewBox="0 0 ${W + 40} ${Hh}" role="img" aria-label="Last ${vals.length} games against the line"><line x1="0" x2="${W + 4}" y1="${ly}" y2="${ly}" class="ln"/>${bars}<text x="${W + 8}" y="${ly + 4}" class="lt" style="text-anchor:start">${ln(L)}</text></svg>
      <p class="note">${esc(MK[k] || p.market_label)} in his last ${vals.length} games, newest on the right. Green cleared the line of ${ln(L)}.</p></div>`; }
  const offs = p.offers || []; if(offs.length && window.BOOK) out += `<div class="x-books"><h3 class="x-h3">Every book</h3>${BOOK.table({label: `${p.player} ${MK[k] || p.market_label}`, side: md ? p.side : 'over', line: L, rows: offs, open: p.opener})}</div>`;
  return out; }
async function openCard(id, team, market){ await loadIndex(); const ds = await slates(); const t0 = team ? nab(team) : '';
  const row = PIX.find(r => r.pid === String(id)) || PIX.find(r => nkey(r.name) === nkey(id) && (!t0 || r.team === t0)) || PIX.find(r => nkey(r.name) === nkey(id)) || null;
  let P = null; if(row){ try{ P = await getJSON(`data/nbap/p/${encodeURIComponent(row.pid)}.json`); }catch(e){} }
  const name = (P && P.name) || (row && row.name) || String(id), tm = nab((P && P.team) || (row && row.team) || t0), pid = row ? row.pid : (P && P.pid ? String(P.pid) : '');
  const props = ds.flatMap(d => d.props.filter(p => isNum(p.line) && samePlayer(p, pid, name, tm)).map(p => ({p, d}))).sort((a, b) => (MKORD.indexOf(mkey(a.p.market)) + 99) % 99 - (MKORD.indexOf(mkey(b.p.market)) + 99) % 99);
  let sel = props.find(x => mkey(x.p.market) === market) || props[0] || null;
  const gm = sel ? sel.p._g : ds.flatMap(d => d.games).find(g => [nab(g.away.abbr), nab(g.home.abbr)].includes(tm)); const opp = gm ? (nab(gm.away.abbr) === tm ? nab(gm.home.abbr) : nab(gm.away.abbr)) : null;
  const log = (P ? (P.log || P.games || []) : []).slice().sort((a, b) => String(b.d || b.date || '') < String(a.d || a.date || '') ? -1 : 1);
  const ct = contractOf(P || row); const inj = P && P.injury && (P.injury.status || P.injury.detail); const pos = (P && P.pos) || (row && row.pos) || '', jer = (P && P.jersey) ?? (row && row.jersey);
  const draw = el => { const box = $('#x-cbody', el); box.innerHTML = cardBody(P, sel, log); $$('[data-cm]', el).forEach(b => b.setAttribute('aria-pressed', sel && b.dataset.cm === sel.p.id));
    { const on = $('[data-cm][aria-pressed="true"]', el), rail = on && on.parentElement; if(rail) rail.scrollLeft = Math.max(0, on.offsetLeft - (rail.clientWidth - on.offsetWidth) / 2); }
    $$('[data-prop]', box).forEach(b => b.onclick = () => { const d = SLATE[b.dataset.sl]; if(d) openProp(d, b.dataset.prop); });
    $$('[data-copy]', box).forEach(b => b.onclick = async () => { const t = b.dataset.copy; try{ await navigator.clipboard.writeText(t); }catch(e){} toast('Copied: ' + t); setTimeout(() => { location.href = b.dataset.url; }, 450); }); };
  const bio = P ? [['Age', P.age], ['Height', P.height_ft], ['Weight', P.weight ? P.weight + ' lb' : null], ['College', P.college || P.country], ['Experience', isNum(P.exp) ? (P.exp ? P.exp + ' yr' : 'Rookie') : null], ['Draft', P.draft ? [P.draft.year, P.draft.round ? 'R' + P.draft.round : null, P.draft.pick ? '#' + P.draft.pick : null].filter(Boolean).join(' ') : null], ['Contract', ct || (P.contract && typeof P.contract === 'object' ? P.contract.label : P.contract) || null], ['G League', P.gleague && typeof P.gleague === 'object' ? P.gleague.team || P.gleague.name : P.gleague]].filter(x => x[1] != null && x[1] !== '') : [];
  const html = `<div class="body"><div class="x-ch"><div><span class="sp" style="--c:var(--act)">NBA · ${esc(tm || 'FA')}</span><h1>${esc(name)}</h1><p>${esc(tm)} · ${esc(pos)}${jer != null && jer !== '' ? ' · #' + esc(jer) : ''}${opp ? ` · vs ${esc(opp)}` : ''}${gm ? ` · ${esc(kickET(gm.kick_utc))}` : ''}</p>
      <div class="nb-tags">${inj ? `<span class="x-tag red">${esc(P.injury.status || 'Injury')}${P.injury.reason || P.injury.detail ? ' · ' + esc(P.injury.reason || P.injury.detail) : ''}</span>` : ''}${ct ? `<span class="x-tag nb-ct">${esc(ct)}</span>` : ''}</div></div></div>
    ${props.length ? `<div class="x-tabs scroll">${props.map(x => `<button data-cm="${esc(x.p.id)}" aria-pressed="${x === sel}">${esc(MK[mkey(x.p.market)] || x.p.market_label)}</button>`).join('')}</div>` : ''}<div id="x-cbody"></div>
    ${!props.length && log.length ? `<h3 class="x-h3">Last 10 games</h3>${logTable(log.slice(0, 10))}` : ''}
    ${P ? `<details class="x-more"${props.length ? '' : ' open'}><summary>Bio, season and career</summary>${bio.length ? `<div class="group pad pgrid">${bio.map(([a, b]) => `<div><span class="label">${a}</span><b>${esc(b)}</b></div>`).join('')}</div>` : ''}
      <h3 class="x-h3">Game log</h3>${logTable(log)}${(P.career || []).length ? `<h3 class="x-h3">Career</h3>${careerTable(P.career)}` : ''}</details>` : row ? '' : '<p class="sub">This player is not in the NBA player library yet.</p>'}
    <p class="note">${esc((P && P.source) || 'Stats and bio: the NBA player library.')} Prices: the books listed on the slate. Live: ESPN box score.</p></div>`;
  pushSheet(name, html, el => { $$('[data-cm]', el).forEach(b => b.onclick = () => { sel = props.find(x => x.p.id === b.dataset.cm) || sel; draw(el); }); draw(el); }); }
async function searchIndex(){ await loadIndex(); return PIX; }
/* relevance shared with app.js openSearch so both sports merge into one list */
const score = (name, teamHit, q) => { const n = nkey(name); return (teamHit ? 4 : 0) + (q && n.startsWith(q) ? 2 : 0) + (q && n.split(' ').some(w => w.startsWith(q)) ? 1 : 0); };
function searchRows(q, up){ if(!PIX || !PIX.length) return []; const T = up.length >= 2 ? nab(up) : '';
  const hitT = T && PIX.some(p => p.team === T); const r = PIX.filter(p => (q.length >= 2 && nkey(p.name).includes(q)) || (hitT && p.team === T));
  return r.map(p => ({p, s: score(p.name, hitT && p.team === T, q)})).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, 40).map(({p, s}) => { const ct = contractOf(p);
    return {s, h: `<button class="row" data-nbpid="${esc(p.pid)}"><div><div class="nm">${esc(p.name)}<span class="sbg nba">${GLY.NBA}NBA</span>${ct ? `<span class="sbg ct">${esc(ct)}</span>` : ''}</div><div class="mt">${TLN(p.team, 'xs')}${esc(p.team || 'FA')}${p.pos ? ' · ' + esc(p.pos) : ''}${p.jersey != null && p.jersey !== '' ? ' · #' + esc(p.jersey) : ''}${p.status && !/^(act|active)$/i.test(p.status) && !ct ? ' · ' + esc(p.status) : ''}</div></div><div class="rt">${ICON.chev}</div></button>`}; }); }
const wireSearch = out => $$('[data-nbpid]', out).forEach(b => b.onclick = () => openCard(b.dataset.nbpid));

window.NBA = {poll: () => poll(), applyProgress: applyNBA, openCard, openGame: nbaGame, openByTeams, openMarket, searchIndex, searchRows, score, wireSearch, slates, nab, MK, live: NLV, _gameTick: null};

/* ------------------------------------------------------------ start: lanes now, NBA data once the slate list is in */
mountLanes(); try{ drawTicker(); }catch(e){} TKL.nba();
const sb = $('#srchbtn'); if(sb){ sb.onclick = () => openSearch(); }
/* the first Home render can finish before this file runs (data/index.json is preloaded), so wait for it, then add the NBA shelf */
const homeWhenReady = (n = 0) => { if(S.tab !== 'lobby' || n > 40) return; if($('#main .x-home') && !$('#nba-home')) return homeNBA(); if(!$('#nba-home')) setTimeout(() => homeWhenReady(n + 1), 250); };
(function start(){ if(!INDEX) return setTimeout(start, 250); slates().catch(() => {}).finally(() => { homeWhenReady(); tick(); }); loadIndex(); })();
})();
