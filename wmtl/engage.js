/* tail. engage layer: Model record strip, Top play kickoff chip, one-tap Tail, Sweat (pinned list + dock + sheet), cash moment, Your record.
   Every number here is read from the slate files, index.json, results-2026.json, ESPN live stats already polled into LV, or the user's own logged bets.
   Nothing is estimated. No streak pressure, no "bet more" prompts: a cash is celebrated, a miss is shown plainly, and there is no "tail all". */
(function(){
'use strict';
const SK = {qb_rush: 'rush_yds', rush_yds: 'rush_yds', rec_yds: 'rec_yds', receptions: 'receptions', pass_yds: 'pass_yds'};
const UNITW = {rush_yds: 'yds', rec_yds: 'yds', pass_yds: 'yds', receptions: 'rec'};
const isYes = m => m === 'atd' || m === 'qb_atd';
const ENG = window.ENG = {hot: {}, lastLiveW: null};

/* ---------- shared data helpers */
const nfl = () => INDEX ? INDEX.slates.filter(s => s.sport === 'NFL') : [];
const curWeek = () => { const s = nfl().slice().sort((a, b) => a.start_utc < b.start_utc ? 1 : -1)[0]; return s ? s.week : null; };
const weekSlates = () => { const wk = curWeek(); return Object.values(SLATE).filter(d => d && d.sport === 'NFL' && d.meta && d.meta.week === wk); };
const liveOf = g => g ? Object.values(LV.games).find(x => x.away === g.away.abbr && x.home === g.home.abbr) || null : null;
const betSel = b => b.side === 'yes' ? 'Anytime TD' : `${b.side === 'under' ? 'U' : 'O'} ${ln(b.line)} ${STATWORD[b.market] || b.market_label || ''}`.trim();
const kickLine = iso => { const cd = countdown(iso); return cd ? `Starts in ${cd}` : null; };
const winUnits = b => isNum(b.stake) && isNum(b.odds) ? b.stake * (decOdds(b.odds) - 1) : null;
const cashSeen = () => { const u = store.d.ui; if(!Array.isArray(u.cashSeen)) u.cashSeen = []; return u.cashSeen; };

/* live state of one of the user's open bets, from LV.stats and the bet's own side and line */
function track(b){ const d = SLATE[b.slate]; if(!d || !d.gmap) return null; const g = d.gmap[b.gid]; if(!g) return null;
  const p = d.props.find(x => x.id === b.prop); const team = p ? p.team : null; const st = liveOf(g);
  const base = {b, d, g, p, st, team};
  if(!st || st.state === 'pre') return Object.assign(base, {phase: 'pre'});
  const sk = SK[b.market]; const phase = st.state === 'post' ? 'final' : 'live';
  if(!sk || !team || b.side === 'yes' || !isNum(b.line)) return Object.assign(base, {phase, untracked: true});
  const now = (LV.stats[nkey(b.player) + '|' + team] || {})[sk] || 0; const over = b.side !== 'under', hit = now > b.line, done = phase === 'final';
  const state = over ? (hit ? 'win' : done ? 'loss' : 'run') : (hit ? 'loss' : done ? 'win' : 'run');
  const need = over ? Math.floor(b.line) + 1 - now : Math.floor(b.line) - now; // over: still needed to clear; under: room left before it is blown
  return Object.assign(base, {phase, now, over, state, need, frac: Math.max(0, Math.min(1, b.line > 0 ? now / b.line : (now > 0 ? 1 : 0)))}); }
function myWeek(){ const ids = new Set(weekSlates().map(d => d.id)); return store.d.bets.filter(b => b.status === 'open' && ids.has(b.slate)).map(track).filter(Boolean); }

/* ---------- 1. Model record strip (Home) */
async function modelRecord(){ const R = await loadResults('NFL'); const rw = new Set((R && R.weeks) || []); const wk = curWeek();
  const z = () => ({w: 0, l: 0, p: 0, u: 0, any: false}); const add = (a, x, k) => { if(!x) return; a.w += x.w || 0; a.l += x.l || 0; a.p += x.p || 0; a.u += x[k] || 0; a.any = true; };
  const season = z(), week = z(); const weeks = [...rw];
  if(R && R.season && R.season.bets) add(season, R.season.bets, 'profit');
  for(const s of nfl()){ if(!s.results || s.results.status !== 'graded' || !s.results.bets) continue; if(!rw.has(s.week)){ add(season, s.results.bets, 'units'); weeks.push(s.week); } if(s.week === wk) add(week, s.results.bets, 'units'); }
  const live = {w: 0, l: 0, n: 0, won: []};
  for(const d of weekSlates()){ const info = slateInfo(d.id); if(info && info.results && info.results.status === 'graded') continue;
    for(const p of d.props){ if(p.tier !== 'bet') continue; live.n++; const st = pickState(p); if(!st) continue; if(st.win){ live.w++; live.won.push(p.id); } else if(st.loss) live.l++; } }
  const ws = weeks.filter(isNum).sort((a, b) => a - b);
  return {season, week, live, wk, wkRange: ws.length ? (ws[0] === ws[ws.length - 1] ? `wk ${ws[0]}` : `wk ${ws[0]}–${ws[ws.length - 1]}`) : '', replay: !!(R && R.method && /replay/i.test(R.method.caveat || ''))}; }
const rec = x => `${x.w}–${x.l}${x.p ? '–' + x.p : ''}`;
const uCls = u => u > 0 ? 'e-pos' : u < 0 ? 'e-neg' : '';
function recordHTML(M){ const L = M.live, toPlay = Math.max(0, L.n - L.w - L.l);
  return `<button class="e-rec ${L.w ? 'is-live' : ''}" id="e-rec" aria-label="Model record. Open the full results">
    <div class="e-rec-hd"><span>Model record</span><span class="e-rec-go">Full record ${ICON.chev || '›'}</span></div>
    <div class="e-rec-g">
      <div><small>Week ${esc(M.wk)}</small><b>${M.week.any ? rec(M.week) : L.w + L.l ? `${L.w}–${L.l}` : '0–0'}${M.week.any ? `<em class="${uCls(M.week.u)}">${sg(M.week.u, 1)}u</em>` : ''}</b>
        <span>${L.w + L.l ? `<i class="e-dot"></i><span class="e-pos">${L.w} cashed</span> · ${L.l} missed live` : ''}${L.w + L.l && toPlay ? ' · ' : ''}${toPlay ? `${toPlay} to play` : !L.n && !M.week.any ? 'No bets this week yet' : ''}</span></div>
      <div><small>Season${M.wkRange ? ' · ' + esc(M.wkRange) : ''}</small><b>${rec(M.season)}<em class="${uCls(M.season.u)}">${sg(M.season.u, 1)}u</em></b><span>${M.replay ? 'Includes replayed weeks' : 'Graded from box scores'}</span></div>
    </div></button>`; }
async function drawRecord(root){ const slot = $('#e-rec-slot', root || document); if(!slot) return; let M; try{ M = await modelRecord(); }catch(e){ slot.innerHTML = ''; return; }
  const w = M.live.w; slot.innerHTML = recordHTML(M); const el = $('#e-rec', slot);
  if(ENG.lastLiveW !== null && w > ENG.lastLiveW && !RM){ el.classList.add('e-pulse'); setTimeout(() => el.classList.remove('e-pulse'), 3200); }
  ENG.lastLiveW = w; el.onclick = () => openResults(); }

/* ---------- 2. One-tap Tail (Home top play + Home model-bet cards + report card) */
const tailedBet = p => store.d.bets.find(b => b.prop === p.id && b.status === 'open');
function canTail(p){ return p && p.tier === 'bet' && isNum(p.odds) && Math.abs(p.odds) >= 100 && (isYes(p.market) || isNum(p.line)); }
function tail(d, p){ if(!canTail(p)){ logBet(d, p); return null; } const ex = tailedBet(p); if(ex) return ex; const yes = isYes(p.market);
  const b = {id: 'b' + Date.now().toString(36), t: new Date().toISOString(), slate: d.id, sport: d.sport, prop: p.id, gid: p.gid, player: p.player, market: p.market, market_label: p.market_label,
    side: yes ? 'yes' : (p.side === 'under' ? 'under' : 'over'), line: yes ? null : p.line, odds: p.odds, book: p.book || 'Other', stake: isNum(p.units) && p.units > 0 ? p.units : 1, live: false, status: 'open', via: 'tail'};
  store.d.bets.unshift(b); store.save(); gradeMyBets(d); return b; }
function snack(html, act){ let w = $('#e-snack'); if(!w){ w = document.createElement('div'); w.id = 'e-snack'; w.className = 'e-snack'; w.setAttribute('role', 'status'); document.body.appendChild(w); }
  w.innerHTML = html; w.classList.remove('on'); void w.offsetWidth; w.classList.add('on'); clearTimeout(snack._t); snack._t = setTimeout(() => w.classList.remove('on'), act ? 5200 : 3200);
  const u = $('[data-undo]', w); if(u && act) u.onclick = () => { act(); w.classList.remove('on'); }; }
function setTailBtn(el, p){ const t = tailedBet(p); el.classList.toggle('e-tailed', !!t); el.setAttribute('aria-pressed', t ? 'true' : 'false');
  el.innerHTML = t ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>Tailed</span>` : `<span>${el.dataset.lab || 'Tail'}</span>`;
  el.setAttribute('aria-label', t ? `Tailed: ${p.player} ${selText(p)}. Open My Bets` : `Tail ${p.player} ${selText(p)} in one tap`); }
function wireTail(el, d, p){ if(!el || !p || !canTail(p)) return; el.setAttribute('role', 'button'); el.tabIndex = 0; setTailBtn(el, p);
  const act = e => { e.stopPropagation(); e.preventDefault(); if(tailedBet(p)){ go('mybets'); return; }
    const b = tail(d, p); if(!b) return; setTailBtn(el, p); if(!RM){ el.classList.remove('e-pop'); void el.offsetWidth; el.classList.add('e-pop'); }
    $$('[data-etail="' + CSS.escape(p.id) + '"]').forEach(x => x !== el && setTailBtn(x, p));
    snack(`<span class="e-sn-ic">${Icon.svg('check', {size: 18})}</span><span class="e-sn-tx"><b>Tailed · ${esc(p.player)}</b><small>${esc(selText(p))} · ${b.stake}u at ${esc(b.book)} ${od(b.odds)}</small></span><button class="e-sn-btn" data-undo>Undo</button>`,
      () => { store.d.bets = store.d.bets.filter(x => x.id !== b.id); store.save(); $$('[data-etail="' + CSS.escape(p.id) + '"]').forEach(x => setTailBtn(x, p)); ENG.tick(); });
    ENG.tick(); };
  el.dataset.etail = p.id; el.onclick = act; el.onkeydown = e => { if(e.key === 'Enter' || e.key === ' ') act(e); }; }
ENG.propSheet = (el, d, p) => { if(!canTail(p)) return; const lg = $('[data-logp]', el); if(!lg || $('.e-tailbig', el)) return;
  const t = document.createElement('button'); t.className = 'btn primary e-tailbig tap'; t.dataset.lab = 'Tail at ' + od(p.odds); lg.parentNode.insertBefore(t, lg); lg.classList.remove('primary'); lg.classList.add('quiet'); wireTail(t, d, p); };

/* ---------- 3. Top play kickoff chip */
function kickChip(g){ const st = liveOf(g); if(st && st.state === 'in') return `<span class="e-kick is-live"><i class="e-live-dot" aria-hidden="true"></i><b class="e-kick-t">Live · ${esc(st.detail)}</b></span>`; if(st && st.state === 'post') return `<span class="e-kick">Final</span>`;
  const k = kickLine(g.kick_utc); return k ? `<span class="e-kick"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg><b class="e-kick-t">${esc(k)}</b><small class="e-kick-d">· ${esc(dayET(g.kick_utc).split(',')[0])} ${esc(kickET(g.kick_utc))}</small></span>` : ''; }
function drawKick(root){ const c = $('.h-card[data-prop]', root); if(!c) return; const d = SLATE[c.dataset.sl]; const p = d && d.props.find(x => x.id === c.dataset.prop); if(!p || !p._g) return;
  let s = $('.e-kick-slot', c); if(!s){ s = document.createElement('div'); s.className = 'e-kick-slot'; const r = $('.h-row', c); if(r) r.after(s); else c.prepend(s); } s.innerHTML = kickChip(p._g); }

/* ---------- 4. Sweat: the user's own tailed picks this week, live */
function sweatRow(t){ const b = t.b, hot = ENG.hot[b.id] && ENG.hot[b.id] > Date.now();
  const who = `<div class="e-sw-who">${t.team ? TL(t.team, 'sm') : ''}<div><b>${esc(b.player)}</b><span>${esc(betSel(b))} · ${od(b.odds)} · ${b.stake}u</span></div></div>`;
  if(t.phase === 'pre'){ const k = kickLine(t.g.kick_utc); return `<div class="e-sw pre" data-eb="${esc(b.id)}">${who}<div class="e-sw-side"><small>${esc(t.g.away.abbr)} @ ${esc(t.g.home.abbr)}</small><b>${k ? esc(k.replace('Starts in ', '')) : esc(kickET(t.g.kick_utc))}</b></div></div>`; }
  const clock = t.phase === 'final' ? 'Final' : esc(t.st.detail);
  if(t.untracked) return `<div class="e-sw" data-eb="${esc(b.id)}">${who}<div class="e-sw-side"><small>${clock}</small><b class="e-na">No live stat</b></div></div>`;
  const uw = UNITW[SK[b.market]] || ''; const pct = (t.state === 'win' && t.over ? 100 : t.frac * 100).toFixed(1);
  const msg = t.state === 'win' ? `<span class="e-pos">Cashed</span>` : t.state === 'loss' ? `<span class="e-neg">${t.over ? 'Missed' : 'Over the line'}</span>` : t.over ? `<b>${ln(t.need)}</b> ${uw} to go` : `<b>${ln(Math.max(0, t.need))}</b> ${uw} of room`;
  return `<div class="e-sw ${t.state} ${t.over ? '' : 'under'} ${hot ? 'e-cash' : ''}" data-eb="${esc(b.id)}">${who}
    <div class="e-sw-side"><small>${clock}</small><b class="num">${ln(t.now)}<i>/ ${ln(b.line)}</i></b></div>
    <div class="e-sw-bar" role="img" aria-label="${esc(ln(t.now))} of ${esc(ln(b.line))}"><i style="width:${pct}%"></i></div>
    <div class="e-sw-msg">${msg}${t.state === 'win' && isNum(winUnits(b)) ? `<span class="e-sw-u e-pos">+${winUnits(b).toFixed(2)}u</span>` : t.state === 'loss' ? `<span class="e-sw-u">−${b.stake}u</span>` : ''}</div>${t.state === 'win' ? '<span class="e-stamp" aria-hidden="true">Cashed</span>' : ''}</div>`; }
function sweatHTML(T, full){ const on = T.filter(t => t.phase !== 'pre'), pre = T.filter(t => t.phase === 'pre').sort((a, b) => a.g.kick_utc < b.g.kick_utc ? -1 : 1);
  if(!T.length) return ''; const w = on.filter(t => t.state === 'win').length, l = on.filter(t => t.state === 'loss').length, run = on.filter(t => t.phase === 'live' && t.state === 'run').length;
  const preRows = full ? pre : pre.slice(0, on.length ? 0 : 3);
  const more = pre.length - preRows.length; const nx = pre[0] && kickLine(pre[0].g.kick_utc);
  return `<section class="e-sweat ${on.some(t => t.phase === 'live') ? 'is-live' : ''}" aria-label="Sweat: your tailed picks">
    <div class="e-sw-hd"><h2>${on.some(t => t.phase === 'live') ? '<i class="e-live-dot"></i>' : ''}Sweat</h2><span>${on.length ? `${run ? run + ' live · ' : ''}${w} cashed · ${l} missed` : `${T.length} tailed · none live yet`}</span></div>
    <div class="e-sw-list">${on.map(sweatRow).join('')}${preRows.map(sweatRow).join('')}</div>
    ${more > 0 ? `<button class="e-sw-more" data-esweat>${more} more kick later${nx ? ' · next ' + esc(nx.replace('Starts in ', 'in ')) : ''}${ICON.chev || ''}</button>` : ''}
    ${full ? '<p class="e-rg">Bet only what you can afford to lose. 1-800-GAMBLER, any time.</p>' : ''}</section>`; }
function drawSweat(root){ const slot = $('#e-sweat-slot', root || document); if(!slot) return; const T = myWeek(); slot.innerHTML = sweatHTML(T, false); $$('[data-esweat]', slot).forEach(b => b.onclick = openSweat); }
function openSweat(){ const el = pushSheet('Sweat', `<div class="body"><div class="lt"><h1>Sweat</h1><p>Your tailed picks this week, tracked live from ESPN box scores.</p></div><div id="e-sweat-sheet"></div></div>`);
  const draw = () => { const h = $('#e-sweat-sheet', el); if(!h || !document.body.contains(el)) return false; const T = myWeek(); h.innerHTML = T.length ? sweatHTML(T, true) : '<p class="sub">No open tailed picks this week.</p>'; return true; };
  draw(); ENG.sheetDraw = draw; }
/* dock: a pinned pill above the tab bar while any tailed pick is live, on tabs without their own Sweat panel */
function drawDock(T){ let k = $('#e-dock'); const on = T.filter(t => t.phase === 'live'); const show = on.length && !['lobby', 'mybets'].includes(S.tab);
  document.body.classList.toggle('e-dock-on', !!show); if(!show){ if(k) k.hidden = true; return; }
  if(!k){ k = document.createElement('button'); k.id = 'e-dock'; k.className = 'e-dock'; document.body.appendChild(k); k.onclick = openSweat; } k.hidden = false;
  const all = T.filter(t => t.phase !== 'pre'); const w = all.filter(t => t.state === 'win').length;
  k.innerHTML = `<i class="e-live-dot"></i><b>Sweating ${on.length}</b><span class="e-dock-bars">${on.slice(0, 5).map(t => `<i class="${t.state || ''} ${t.over === false ? 'under' : ''}"><em style="width:${t.untracked ? 0 : ((t.state === 'win' && t.over ? 1 : t.frac || 0) * 100).toFixed(0)}%"></em></i>`).join('')}</span>${w ? `<span class="e-pos">${w} cashed</span>` : ''}${ICON.chev || ''}`;
  k.setAttribute('aria-label', `Sweating ${on.length} live picks${w ? `, ${w} cashed` : ''}. Open Sweat`); }

/* ---------- 5. Cash moment: once per bet, ever (stored on this phone), when a tailed pick clears live */
function cashMoments(T){ const seen = cashSeen(); let fresh = [];
  for(const t of T){ if(t.phase === 'pre' || t.untracked || t.state !== 'win') continue; if(seen.includes(t.b.id)) continue; seen.push(t.b.id); fresh.push(t); }
  if(!fresh.length) return; if(seen.length > 300) seen.splice(0, seen.length - 300); store.save();
  for(const t of fresh) ENG.hot[t.b.id] = Date.now() + 2600;
  const t = fresh[0], u = winUnits(t.b);
  snack(`<span class="e-sn-ic e-sn-cash">${Icon.svg('check', {size: 18})}</span><span class="e-sn-tx"><b>Cashed · ${esc(t.b.player)}</b><small>${esc(betSel(t.b))} · ${ln(t.now)}${isNum(u) ? ` · +${u.toFixed(2)}u` : ''}${fresh.length > 1 ? ` · +${fresh.length - 1} more` : ''}</small></span>`);
  try{ if(navigator.vibrate) navigator.vibrate([16, 40, 16]); }catch(e){}
  if(!RM){ let f = $('#e-flash'); if(!f){ f = document.createElement('div'); f.id = 'e-flash'; f.className = 'e-flash'; f.setAttribute('aria-hidden', 'true'); document.body.appendChild(f); } f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
  setTimeout(() => ENG.tick(), 2700); }

/* ---------- 6. Your record (My Bets): the user's own settled bets */
function yourRecordHTML(){ const B = store.d.bets.filter(b => ['won', 'lost', 'push'].includes(b.status)).slice().sort((a, b) => a.t < b.t ? 1 : -1);
  if(!B.length) return `<section class="e-you"><div class="e-you-hd"><h2>Your record</h2></div><p class="sub" style="margin:0">Your record starts when your first logged bet is graded.</p></section>`;
  const w = B.filter(b => b.status === 'won').length, l = B.filter(b => b.status === 'lost').length, p = B.length - w - l;
  const u = B.reduce((a, b) => a + (b.pl || 0), 0); const L = B.slice(0, 10).reverse(); const lw = L.filter(b => b.status === 'won').length, ll = L.filter(b => b.status === 'lost').length;
  const T = B.filter(b => b.via === 'tail'), tw = T.filter(b => b.status === 'won').length, tl = T.filter(b => b.status === 'lost').length;
  return `<section class="e-you" aria-label="Your record"><div class="e-you-hd"><h2>Your record</h2><span>${B.length} graded</span></div>
    <div class="e-you-g"><div><small>Win rate</small><b>${w + l ? pc(w / (w + l)) : '—'}</b><span>${w}–${l}${p ? '–' + p : ''}</span></div>
      <div><small>Units</small><b class="${uCls(u)}">${sg(u, 2)}u</b><span>${money(u * (store.d.settings.unit || 10))}</span></div>
      <div><small>Tailed model bets</small><b>${T.length ? `${tw}–${tl}` : '—'}</b><span>${T.length ? 'one-tap tails' : 'none graded yet'}</span></div></div>
    <div class="e-form"><small>Last ${L.length}</small><div class="e-form-dots" role="img" aria-label="Last ${L.length}: ${lw} won, ${ll} lost">${L.map(b => `<i class="${b.status}" title="${esc(b.player)} · ${esc(betSel(b))}">${b.status === 'won' ? 'W' : b.status === 'lost' ? 'L' : 'P'}</i>`).join('')}</div><span>${lw}–${ll}</span></div></section>`; }
ENG.mybets = root => { if(!root) return; const host = root.id === 'mybets' ? root : $('#mybets', root) || root; const lt = $('.lt', host); if(!lt || $('.e-you', host)) return;
  const s = document.createElement('div'); s.id = 'e-sweat-slot'; s.className = 'e-slot'; lt.after(s); const r = document.createElement('div'); r.innerHTML = yourRecordHTML(); s.after(r.firstElementChild); drawSweat(host); };

/* ---------- Home hook */
ENG.home = root => { const v = $('.x-home', root); if(!v || $('#e-rec-slot', v)) return;
  const sw = document.createElement('div'); sw.id = 'e-sweat-slot'; sw.className = 'e-slot'; v.prepend(sw);
  const rs = document.createElement('div'); rs.id = 'e-rec-slot'; rs.className = 'e-slot'; const hero = $('.x-hero', v); if(hero) hero.after(rs); else v.prepend(rs);
  const c = $('.h-card[data-prop]', v); if(c){ const d = SLATE[c.dataset.sl], p = d && d.props.find(x => x.id === c.dataset.prop); wireTail($('.h-tail', c), d, p); }
  $$('.x-bet[data-prop]', v).forEach(c => { const d = SLATE[c.dataset.sl], p = d && d.props.find(x => x.id === c.dataset.prop); if(!canTail(p)) return; const f = $('.xb-foot', c); if(!f) return;
    const t = document.createElement('span'); t.className = 'e-tb'; f.appendChild(t); wireTail(t, d, p); });
  drawKick(v); drawSweat(v); drawRecord(v); };

/* ---------- tick: live poll results (wraps ui2's onLiveTick) + a 30 s clock for countdowns */
ENG.tick = () => { try{ const T = myWeek(); cashMoments(T);
  if(S.tab === 'lobby'){ drawSweat(); drawKick(document); drawRecord(); } else if(S.tab === 'mybets') drawSweat();
  if(ENG.sheetDraw && !ENG.sheetDraw()) ENG.sheetDraw = null; drawDock(T); }catch(e){} };
const prevTick = window.onLiveTick; window.onLiveTick = function(){ if(prevTick) prevTick.apply(this, arguments); ENG.tick(); };
setInterval(() => { if(document.visibilityState === 'visible' && INDEX) ENG.tick(); }, 30000);
})();
