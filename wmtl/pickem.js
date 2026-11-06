/* tail. Pick'em — an optional, free Over/Under game with friends. No money, no staking, no streak pressure.
   Opt-in only: one compact tile at the bottom of Home and a row in Club; nothing else appears until a member joins.
   The card and every result are written by the database (community/pickem.sql), never by this file. */
(function(){
const OK = 'tail.pickem';                       // 'in' | 'out' | null (never asked)
const opt = {get(){ try{ return localStorage.getItem(OK); }catch(_){ return null; } }, set(v){ try{ localStorage.setItem(OK, v); }catch(_){} }};
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ET = 'America/New_York';
const dayET = t => new Intl.DateTimeFormat('en-CA', {timeZone: ET}).format(t);
const today = () => dayET(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const kickTxt = t => new Intl.DateTimeFormat('en-US', {timeZone: ET, weekday: 'short', hour: 'numeric', minute: '2-digit'}).format(new Date(t));
const dayTxt = d => d === today() ? 'Today' : d === addDays(today(), 1) ? 'Tomorrow' : d === addDays(today(), -1) ? 'Yesterday' : new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'}).format(new Date(d + 'T12:00:00Z'));
const open = p => !p.outcome && new Date(p.kick_utc) > new Date();
const num = v => v == null ? '' : (Math.round(v * 10) / 10).toString();
const SIDE = {over: 'Over', under: 'Under'};
const inList = ids => 'in.(' + ids.map(i => '"' + encodeURIComponent(i) + '"').join(',') + ')';
const api = (p, o) => window.CLUB.api(p, o);

let ST = {day: null, props: [], mine: {}, friends: {}, board: [], season: [], tab: 'day'};

/* ---------- data */
async function loadCard(){ const from = addDays(today(), -10);
  ST.props = await api(`pickem_props?select=*&day=gte.${from}&order=day.asc,ord.asc`) || [];
  const days = [...new Set(ST.props.map(p => p.day))];
  if(!ST.day || !days.includes(ST.day)) ST.day = days.includes(today()) ? today() : (days.find(d => d > today()) || days[days.length - 1] || null);
  return days; }
async function loadPicks(){ const s = await window.CLUB.auth(); const ids = ST.props.map(p => p.id); ST.mine = {}; ST.friends = {};
  if(!ids.length) return;
  const rows = await api(`pickem_picks?select=prop_id,side,user_id,profiles(username,name)&prop_id=${inList(ids)}`).catch(() => []) || [];
  rows.forEach(r => { if(r.user_id === s.uid) ST.mine[r.prop_id] = r.side; else (ST.friends[r.prop_id] = ST.friends[r.prop_id] || []).push(r); }); }
async function loadBoards(){ const [b, s] = await Promise.all([ST.day ? api('rpc/pickem_board', {method: 'POST', body: {p_day: ST.day}}).catch(() => []) : [], api('rpc/pickem_season', {method: 'POST', body: {}}).catch(() => [])]);
  ST.board = b || []; ST.season = s || []; }

/* ---------- scoring from real outcomes only */
function dayStats(day){ const card = ST.props.filter(p => p.day === day); let hit = 0, miss = 0, push = 0, pend = 0, picked = 0, mHit = 0, mMiss = 0, live = 0;
  card.forEach(p => { const s = ST.mine[p.id]; const dec = p.outcome === 'over' || p.outcome === 'under';
    if(dec){ if(p.outcome === p.model_side) mHit++; else mMiss++; }
    if(!s) return; picked++;
    if(dec){ if(s === p.outcome) hit++; else miss++; } else if(p.outcome === 'push' || p.outcome === 'void') push++; else { pend++; if(!open(p)) live++; } });
  const counted = card.filter(p => p.outcome !== 'void');
  const done = card.length > 0 && card.every(p => p.outcome);
  const perfect = done && counted.length > 0 && counted.every(p => ST.mine[p.id] && ST.mine[p.id] === p.outcome);
  const mineGraded = card.filter(p => ST.mine[p.id] && (p.outcome === 'over' || p.outcome === 'under'));
  const mOnMine = mineGraded.filter(p => p.outcome === p.model_side).length;
  const beat = done && picked > 0 && hit > mOnMine;
  const nextLock = card.filter(open).map(p => p.kick_utc).sort()[0];
  return {n: card.length, hit, miss, push, pend, picked, mHit, mMiss, mOnMine, done, perfect, beat, nextLock, live}; }

/* ---------- Home tile: compact, last thing on Home, gone after opt-out */
let TILE = null;
/* Home can be redrawn by other code; keep the tile present and last, without touching the shared render path */
(function keep(){ const m = document.querySelector('#main'); if(!m) return; let q = 0;
  const chk = () => { q = 0; if(opt.get() === 'out') return; const v = m.querySelector('.x-home') || (typeof S !== 'undefined' && S.tab === 'lobby' && m.querySelector(':scope > .view')); if(!v) return;
    const t = v.querySelector('#pk-tile'); if(!t) home(m); else if(v.lastElementChild !== t) v.appendChild(t); };
  if(window.MutationObserver) new MutationObserver(() => { if(!q) q = requestAnimationFrame(chk); }).observe(m, {childList: true, subtree: true});
  q = requestAnimationFrame(chk); })();
async function home(m){ const v = m.querySelector('.x-home') || m.querySelector('.view') || m; const old = v.querySelector('#pk-tile'); if(old) old.remove();
  const st = opt.get(); if(st === 'out') return;
  const t = document.createElement('button'); t.id = 'pk-tile'; t.className = 'pk-tile'; t.type = 'button';
  t.innerHTML = tileHTML(st === 'in' ? 'Loading your card…' : 'Free picks with friends. No money.', st === 'in' ? 'Your card' : 'Play');
  t.onclick = openGame; v.appendChild(t);
  if(st !== 'in' || !(window.CLUB && CLUB.profile())) return;
  if(TILE && Date.now() - TILE.t < 60e3){ t.innerHTML = tileHTML(TILE.sub, 'Open'); return; }
  try{ await loadCard(); await loadPicks(); const d = ST.props.some(p => p.day === today()) ? today() : ST.day; if(!d){ t.innerHTML = tileHTML('No card yet. The next one posts with the next slate.', 'Open'); return; }
    const s = dayStats(d); let sub;
    if(s.done) sub = `${dayTxt(d)}: ${s.hit} of ${s.hit + s.miss} hit${s.perfect ? ' · perfect card' : s.beat ? ' · beat the model' : ''}`;
    else if(s.picked < s.n && s.nextLock) sub = `${dayTxt(d)}: ${s.picked} of ${s.n} picked · next lock ${kickTxt(s.nextLock)}`;
    else sub = `${dayTxt(d)}: ${s.hit}–${s.miss}${s.pend ? ` · ${s.pend} to go` : ''}`;
    TILE = {t: Date.now(), sub}; t.innerHTML = tileHTML(sub, 'Open'); }catch(_){ t.innerHTML = tileHTML("Free Over/Under picks with friends.", 'Open'); } }
const tileHTML = (sub, cta) => `<span class="pk-ti" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M8 9l2 2 4-4M8 15.5h8"/></svg></span><span class="pk-tt"><b>Play Pick'em</b><span>${h(sub)}</span></span><span class="pk-tc">${h(cta)}</span>`;

/* ---------- Club row */
function clubRow(){ const body = document.querySelector('#cl-body'); if(!body || body.querySelector('#pk-club') || !body.querySelector('.cl-me')) return;
  const r = document.createElement('button'); r.id = 'pk-club'; r.type = 'button'; r.className = 'cl-row tap pk-club';
  const st = opt.get(); r.innerHTML = `<span class="pk-ti" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M8 9l2 2 4-4M8 15.5h8"/></svg></span><div class="cl-who"><b>Pick'em</b><span>${st === 'in' ? 'Your daily card and friends board' : 'Optional free game · Over/Under with friends'}</span></div><span class="cl-chev" aria-hidden="true">›</span>`;
  r.onclick = openGame; const anchor = body.querySelector('.cl-share'); (anchor || body.querySelector('.cl-me')).after(r); }
if(window.CLUB){ const _view = CLUB.view; CLUB.view = async function(m){ const r = await _view.apply(this, arguments); clubRow(); return r; }; }

/* ---------- the game sheet */
let EL = null;
function openGame(){ EL = pushSheet("Pick'em", `<div class="body pk" id="pk-body"></div>`); draw(); }
async function draw(){ if(!EL) return; const b = EL.querySelector('#pk-body'); if(!b) return;
  if(opt.get() !== 'in'){ b.innerHTML = introHTML(); b.querySelector('#pk-join').onclick = () => { opt.set('in'); draw(); refreshHome(); }; b.querySelector('#pk-later').onclick = () => popSheet(); return; }
  b.innerHTML = `<div class="cl-load" aria-label="Loading"></div>`;
  try{ await CLUB.auth(); await CLUB.me(); }catch(_){ b.innerHTML = `<div class="cl-card"><b>Can't reach Pick'em right now</b><p>Check your connection and try again.</p></div>${leaveHTML()}`; wireLeave(b); return; }
  if(!CLUB.profile()){ b.innerHTML = `<div class="pk-head"><h1>Pick'em</h1><p>Pick a username so friends can find you on the board.</p></div>${CLUB.claimHTML()}${leaveHTML()}`; CLUB.wireClaim(b, () => draw()); wireLeave(b); return; }
  let days = []; try{ days = await loadCard(); await loadPicks(); await loadBoards(); }catch(_){ b.innerHTML = `<div class="cl-card"><b>Can't load the card</b><p>Try again in a moment.</p></div>${leaveHTML()}`; wireLeave(b); return; }
  b.innerHTML = gameHTML(days); wireGame(b); }
const introHTML = () => `<div class="pk-head"><h1>Pick'em</h1><p>An optional free game. Each slate day there's a card of 10 player props. Pick Over or Under on any of them, and see how you do against your friends and the model.</p></div>
  <ul class="pk-rules"><li><b>Free.</b> No money, no stakes, nothing to buy.</li><li><b>Locks at kickoff.</b> Change a pick any time before that game starts.</li><li><b>Graded from real results.</b> The same box scores the model is graded on.</li><li><b>Friends only.</b> Only accepted friends see your picks, and only after they lock.</li></ul>
  <button class="cl-cta pk-cta" id="pk-join">Join Pick'em</button><button class="pk-link" id="pk-later">Not now</button>`;
const leaveHTML = () => `<div class="pk-leave"><button class="pk-link" id="pk-out">Leave Pick'em</button><p>Hides Pick'em from Home. Your picks stay saved and you can rejoin from Club.</p></div>`;
function wireLeave(b){ const o = b.querySelector('#pk-out'); if(o) o.onclick = () => { opt.set('out'); popSheet(); EL = null; refreshHome(); toast("Pick'em hidden. Rejoin from Club any time"); }; }
function refreshHome(){ TILE = null; const m = document.querySelector('#main'); if(typeof S !== 'undefined' && S.tab === 'lobby' && m) home(m); const r = document.querySelector('#pk-club'); if(r){ r.remove(); clubRow(); } }

function gameHTML(days){
  if(!ST.day) return `<div class="pk-head"><h1>Pick'em</h1><p>No card is posted yet. The next one appears with the next slate.</p></div>${boardHTML()}${leaveHTML()}`;
  const card = ST.props.filter(p => p.day === ST.day); const s = dayStats(ST.day);
  const chips = days.length > 1 ? `<div class="pk-days" role="tablist" aria-label="Card day">${days.map(d => `<button role="tab" data-day="${d}" aria-selected="${d === ST.day}">${h(dayTxt(d))}</button>`).join('')}</div>` : '';
  const badges = [s.perfect ? `<span class="pk-badge gold">Perfect card</span>` : '', s.beat ? `<span class="pk-badge">Beat the model</span>` : ''].join('');
  const sum = `<div class="pk-sum"><div><span>You</span><b>${s.hit}–${s.miss}${s.push ? `–${s.push}` : ''}</b><em>${s.picked} of ${s.n} picked</em></div><div><span>Model</span><b>${s.mHit}–${s.mMiss}</b><em>${s.done ? 'full card' : 'graded so far'}</em></div><div><span>Status</span><b>${s.done ? 'Final' : s.nextLock ? 'Open' : s.live ? 'Locked' : 'Final'}</b><em>${s.nextLock ? 'next lock ' + h(kickTxt(s.nextLock)) : s.done ? h(dayTxt(ST.day)) : 'waiting on results'}</em></div></div>`;
  return `<div class="pk-head"><h1>Pick'em</h1><p>${h(dayTxt(ST.day))} · ${card.length} props · free</p></div>${chips}${sum}${badges ? `<div class="pk-badges">${badges}</div>` : ''}
    <div class="pk-list">${card.map(cardHTML).join('')}</div>${boardHTML()}${leaveHTML()}`; }

function cardHTML(p){ const mine = ST.mine[p.id], isOpen = open(p), dec = p.outcome === 'over' || p.outcome === 'under';
  const res = !mine || !p.outcome ? '' : p.outcome === 'void' ? 'void' : p.outcome === 'push' ? 'push' : mine === p.outcome ? 'hit' : 'miss';
  const fr = ST.friends[p.id] || []; const fo = fr.filter(r => r.side === 'over').length, fu = fr.length - fo;
  let foot;
  if(isOpen) foot = `<span>Locks ${h(kickTxt(p.kick_utc))}</span>`;
  else if(dec) foot = `<span>Final <b>${h(num(p.actual))}</b> · went ${SIDE[p.outcome]}</span><span>Model ${SIDE[p.model_side]}${p.outcome === p.model_side ? ' ✓' : ''}</span>`;
  else if(p.outcome) foot = `<span>${p.outcome === 'void' ? 'Void · didn\'t play or pulled' : 'Push · landed on the line'}</span>`;
  else foot = `<span>Locked · waiting on the final</span><span>Model ${SIDE[p.model_side]}</span>`;
  const word = res === 'hit' ? 'Hit' : res === 'miss' ? 'Miss' : res === 'push' ? 'Push' : res === 'void' ? 'Void' : '';
  return `<div class="pk-card ${res} ${isOpen ? '' : 'locked'}" data-id="${h(p.id)}">
    <div class="pk-top"><div class="pk-who"><b>${h(p.player)}</b><span>${h([p.team, p.opp && 'vs ' + p.opp].filter(Boolean).join(' '))} · ${h(p.market_label || p.market)}</span></div><div class="pk-line"><b>${h(num(p.line))}</b><span>line</span></div></div>
    <div class="pk-seg" role="group" aria-label="Pick for ${h(p.player)}">${['over', 'under'].map(sd => `<button type="button" data-side="${sd}" aria-pressed="${mine === sd}" ${isOpen ? '' : 'disabled'}>${SIDE[sd]}${!isOpen && mine === sd && word ? ` · ${word}` : ''}</button>`).join('')}</div>
    <div class="pk-foot">${foot}${!isOpen && fr.length ? `<span>Friends ${[fo ? fo + ' Over' : '', fu ? fu + ' Under' : ''].filter(Boolean).join(' · ')}</span>` : ''}</div></div>`; }

function boardHTML(){ const me = (window.CLUB && CLUB.profile()) || {};
  const rows = ST.tab === 'day' ? ST.board.slice().sort((a, b) => b.hits - a.hits || a.misses - b.misses || b.picks - a.picks) : ST.season.slice().sort((a, b) => a.rank_now - b.rank_now);
  const friends = rows.filter(r => !r.is_me).length;
  const list = rows.map((r, i) => { const mv = ST.tab === 'season' && r.rank_prev ? r.rank_prev - r.rank_now : 0;
    const rec = `${r.hits}–${r.misses}`;
    const extra = ST.tab === 'season' ? [r.perfect ? `${r.perfect} perfect` : '', r.beat_model ? `beat the model ${r.beat_model}×` : ''].filter(Boolean).join(' · ') : (r.card ? `${r.picks} of ${r.card} picked` : '');
    return `<div class="pk-row ${r.is_me ? 'me' : ''}"><span class="pk-rk">${ST.tab === 'season' ? r.rank_now : i + 1}</span><div class="cl-who"><b>${h(r.is_me ? 'You' : r.name)}</b><span>@${h(r.username)}${extra ? ' · ' + h(extra) : ''}</span></div><div class="pk-rec"><b>${rec}</b>${mv ? `<span class="${mv > 0 ? 'up' : 'dn'}" aria-label="${mv > 0 ? 'up' : 'down'} ${Math.abs(mv)}">${mv > 0 ? '▲' : '▼'} ${Math.abs(mv)}</span>` : ''}</div></div>`; }).join('');
  const meRow = rows.find(r => r.is_me); const meVs = meRow ? `<p class="pk-vs">You vs the model${ST.tab === 'season' ? ' this season' : ''}: <b>${meRow.hits}–${meRow.misses}</b> against <b>${meRow.model_hits}–${meRow.hits + meRow.misses - meRow.model_hits}</b> on the same picks.</p>` : '';
  return `<div class="cl-sec pk-board"><div class="pk-bh"><h2>Friends board</h2><div class="pk-seg sm" role="tablist"><button type="button" role="tab" data-tab="day" aria-pressed="${ST.tab === 'day'}">${h(ST.day ? dayTxt(ST.day) : 'Day')}</button><button type="button" role="tab" data-tab="season" aria-pressed="${ST.tab === 'season'}">Season</button></div></div>
    ${rows.length ? `<div class="cl-list">${list}</div>` : `<div class="cl-card soft"><p>No graded picks on this board yet.</p></div>`}${meVs}
    ${friends ? '' : `<p class="pk-note">Only you and your accepted friends appear here. Add friends in Club to compete.</p>`}</div>`; }

function wireGame(b){ wireLeave(b);
  b.querySelectorAll('[data-day]').forEach(x => x.onclick = async () => { ST.day = x.dataset.day; await loadBoards().catch(() => {}); b.innerHTML = gameHTML([...new Set(ST.props.map(p => p.day))]); wireGame(b); });
  wireGame2(b);
  b.querySelectorAll('.pk-card').forEach(c => c.querySelectorAll('[data-side]').forEach(x => x.onclick = () => pick(c, x.dataset.side)));
  if(!(window.RM)) b.querySelectorAll('.pk-card.hit').forEach((c, i) => { c.style.setProperty('--i', i); c.classList.add('flip'); }); }
function wireGame2(b){ b.querySelectorAll('.pk-board [data-tab]').forEach(x => x.onclick = () => { ST.tab = x.dataset.tab; const nb = document.createElement('div'); nb.innerHTML = boardHTML(); b.querySelector('.pk-board').replaceWith(nb.firstElementChild); wireGame2(b); }); }

async function pick(c, side){ const id = c.dataset.id, p = ST.props.find(x => x.id === id); if(!p || !open(p)) return;
  const prev = ST.mine[id], next = prev === side ? null : side; ST.mine[id] = next || undefined; if(!next) delete ST.mine[id];
  c.querySelectorAll('[data-side]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.side === next)));
  try{ const s = await CLUB.auth();
    if(next) await api('pickem_picks?on_conflict=user_id,prop_id', {method: 'POST', body: {user_id: s.uid, prop_id: id, side: next}, prefer: 'resolution=merge-duplicates,return=minimal'});
    else await api(`pickem_picks?user_id=eq.${s.uid}&prop_id=eq.${encodeURIComponent(id)}`, {method: 'DELETE'});
    const sum = EL && EL.querySelector('.pk-sum'); if(sum){ const s2 = dayStats(ST.day); sum.querySelector('em').textContent = `${s2.picked} of ${s2.n} picked`; }
  }catch(err){ if(prev) ST.mine[id] = prev; else delete ST.mine[id]; c.querySelectorAll('[data-side]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.side === prev)));
    toast(err && (err.status === 401 || err.status === 403) ? 'That game has started. Picks are locked' : "Couldn't save that pick"); } }

window.PICKEM = {home, open: openGame, optedIn: () => opt.get() === 'in'};
})();
