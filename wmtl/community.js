/* tail. community — usernames, friends, shared bets. Backend: Supabase (free plan), anonymous auth per phone, RLS on every table.
   Only the public anon key lives here (safe by design; access is enforced by row-level security in community/schema.sql). */
(function(){
const CFG = {url: 'https://zsstjpnqqrxkzrfuejww.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpzc3RqcG5xcXJ4a3pyZnVland3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MzQ3MDcsImV4cCI6MjEwOTUxMDcwN30.JoJsAUYDbkQl-KWMs5Hk9ZiZFZMdDDeLq3f91ZLFU5s'};
const SK = 'tail.sb', PK = 'tail.profile';
const ls = {get: k => { try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } }, set: (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }};
const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let SES = ls.get(SK), PROF = ls.get(PK);

/* ---------- auth: one anonymous member per phone, refreshed silently */
async function auth(){
  if(SES && SES.expires_at * 1000 - Date.now() > 60e3) return SES;
  const body = SES && SES.refresh_token ? {refresh_token: SES.refresh_token} : {};
  const url = SES && SES.refresh_token ? `${CFG.url}/auth/v1/token?grant_type=refresh_token` : `${CFG.url}/auth/v1/signup`;
  const r = await fetch(url, {method: 'POST', headers: {apikey: CFG.key, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json(); if(!r.ok || !j.access_token){ if(SES && SES.refresh_token && !j.access_token){ SES = null; ls.set(SK, null); } throw new Error(j.msg || j.error_description || 'sign-in failed'); }
  SES = {access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), uid: j.user.id}; ls.set(SK, SES); return SES; }
async function api(path, {method = 'GET', body, prefer} = {}){ const s = await auth();
  const h = {apikey: CFG.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json'}; if(prefer) h.Prefer = prefer;
  const r = await fetch(`${CFG.url}/rest/v1/${path}`, {method, headers: h, body: body ? JSON.stringify(body) : undefined});
  if(!r.ok){ let m = r.status; try{ const j = await r.json(); m = j.message || j.code || m; }catch(_){} const err = new Error(m); err.status = r.status; throw err; }
  return r.status === 204 ? null : r.json().catch(() => null); }

/* ---------- profile */
const USER_RE = /^[a-z0-9_]{3,20}$/;
const clean = u => String(u || '').trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
async function available(u){ u = clean(u); if(!USER_RE.test(u)) return false; const r = await api(`profiles?username=eq.${encodeURIComponent(u)}&select=id`); return !r.length || (SES && r[0].id === SES.uid); }
async function claim(u, name){ u = clean(u); const s = await auth();
  const row = (await api('profiles?on_conflict=id', {method: 'POST', body: {id: s.uid, username: u, name: String(name || '').slice(0, 24) || u}, prefer: 'resolution=merge-duplicates,return=representation'}))[0];
  PROF = row; ls.set(PK, PROF); queueSync(); return row; }
async function me(){ if(!SES) return PROF; try{ const r = await api(`profiles?id=eq.${SES.uid}&select=*`); PROF = r[0] || null; ls.set(PK, PROF); }catch(_){} return PROF; }
async function setShare(on){ const s = await auth(); await api(`profiles?id=eq.${s.uid}`, {method: 'PATCH', body: {share_bets: !!on}}); PROF = {...PROF, share_bets: !!on}; ls.set(PK, PROF); }

/* ---------- bets: mirror My Bets (local store) to the member's private table; friends read it only if sharing is on */
let syncT = null; function queueSync(){ clearTimeout(syncT); syncT = setTimeout(sync, 1500); }
async function sync(){ if(!PROF || typeof store === 'undefined' || !store.d) return; try{ const s = await auth(); const mine = store.d.bets || [];
  if(mine.length) await api('bets?on_conflict=user_id,id', {method: 'POST', body: mine.map(b => ({id: String(b.id), user_id: s.uid, bet: b, updated_at: new Date().toISOString()})), prefer: 'resolution=merge-duplicates'});
  const srv = await api(`bets?user_id=eq.${s.uid}&select=id`); const keep = new Set(mine.map(b => String(b.id))); const gone = srv.map(x => x.id).filter(id => !keep.has(id));
  if(gone.length) await api(`bets?user_id=eq.${s.uid}&id=in.(${gone.map(encodeURIComponent).join(',')})`, {method: 'DELETE'}); }catch(_){} }
if(typeof store !== 'undefined' && store.save){ const _save = store.save.bind(store); store.save = function(){ _save(); queueSync(); }; }

/* ---------- friends */
async function search(q){ q = clean(q); if(q.length < 2) return []; return api(`profiles?username=ilike.${encodeURIComponent(q)}*&select=id,username,name&order=username&limit=8`); }
async function friendships(){ const s = await auth();
  const rows = await api(`friendships?select=id,status,requester,addressee,created_at,rq:profiles!friendships_requester_fkey(id,username,name,share_bets),ad:profiles!friendships_addressee_fkey(id,username,name,share_bets)&or=(requester.eq.${s.uid},addressee.eq.${s.uid})&order=created_at.desc`);
  return rows.map(r => ({...r, other: r.requester === s.uid ? r.ad : r.rq, incoming: r.addressee === s.uid})); }
const request = id => auth().then(s => api('friendships', {method: 'POST', body: {requester: s.uid, addressee: id}}));
const accept = id => api(`friendships?id=eq.${id}`, {method: 'PATCH', body: {status: 'accepted'}});
const remove = id => api(`friendships?id=eq.${id}`, {method: 'DELETE'});
const friendBets = uid => api(`bets?user_id=eq.${uid}&select=bet,updated_at&order=updated_at.desc&limit=50`);

/* ---------- UI: Club tab */
const betLine = b => { const side = b.side === 'yes' ? 'Yes' : b.side === 'under' ? 'Under' : 'Over';
  return `<div class="cl-bet ${b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : ''}"><div><b>${e(b.player || '')}</b><span>${e(side)} ${b.line ?? ''} ${e(b.market_label || b.market || '')}</span></div><div class="cl-bet-r"><b>${b.odds > 0 ? '+' + b.odds : e(b.odds ?? '')}</b><span>${e(b.status === 'won' ? 'Won' : b.status === 'lost' ? 'Lost' : b.status === 'push' ? 'Push' : 'Open')}</span></div></div>`; };
const av = p => `<span class="cl-av" aria-hidden="true">${e((p.name || p.username || '?').trim().charAt(0).toUpperCase())}</span>`;

async function view(m){
  m.innerHTML = `<div class="view cl"><div class="cl-head"><h1>Club</h1><p>Friends, requests and the bets they share with you.</p></div><div id="cl-body"><div class="cl-load" aria-label="Loading"></div></div></div>`;
  const body = m.querySelector('#cl-body');
  try{ await auth(); await me(); }catch(err){ body.innerHTML = `<div class="cl-card"><b>Can't reach the club right now</b><p>Check your connection and pull down to try again.</p></div>`; return; }
  if(!PROF){ body.innerHTML = claimHTML(); wireClaim(body, () => view(m)); return; }
  let F = []; try{ F = await friendships(); }catch(_){}
  const inc = F.filter(f => f.status === 'pending' && f.incoming), sent = F.filter(f => f.status === 'pending' && !f.incoming), fr = F.filter(f => f.status === 'accepted');
  body.innerHTML = `
    <div class="cl-me">${av(PROF)}<div><b>${e(PROF.name)}</b><span>@${e(PROF.username)}</span></div></div>
    <label class="cl-share"><div><b>Share my bets with friends</b><span>${PROF.share_bets ? 'Your accepted friends can see your bets.' : 'Off. Nobody can see your bets.'}</span></div><input type="checkbox" id="cl-sh" role="switch" ${PROF.share_bets ? 'checked' : ''}><i aria-hidden="true"></i></label>
    <div class="cl-sec"><h2>Add a friend</h2><div class="cl-find"><span>@</span><input id="cl-q" type="search" inputmode="text" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="username"></div><div id="cl-res" class="cl-list"></div></div>
    ${inc.length ? `<div class="cl-sec"><h2>Requests <em>${inc.length}</em></h2><div class="cl-list">${inc.map(f => `<div class="cl-row">${av(f.other)}<div class="cl-who"><b>${e(f.other.name)}</b><span>@${e(f.other.username)}</span></div><button class="cl-btn" data-acc="${f.id}">Accept</button><button class="cl-btn ghost" data-del="${f.id}" aria-label="Decline">Decline</button></div>`).join('')}</div></div>` : ''}
    <div class="cl-sec"><h2>Friends <em>${fr.length}</em></h2>${fr.length ? `<div class="cl-list">${fr.map(f => `<button class="cl-row tap" data-fr="${e(f.other.id)}" data-fn="${e(f.other.name)}" data-fu="${e(f.other.username)}" data-fs="${f.other.share_bets ? 1 : 0}">${av(f.other)}<div class="cl-who"><b>${e(f.other.name)}</b><span>@${e(f.other.username)} · ${f.other.share_bets ? 'sharing bets' : 'not sharing'}</span></div><span class="cl-chev" aria-hidden="true">›</span></button>`).join('')}</div>` : `<div class="cl-card soft"><p>No friends yet. Search a username above to send a request.</p></div>`}</div>
    ${sent.length ? `<div class="cl-sec"><h2>Sent</h2><div class="cl-list">${sent.map(f => `<div class="cl-row">${av(f.other)}<div class="cl-who"><b>${e(f.other.name)}</b><span>@${e(f.other.username)} · waiting</span></div><button class="cl-btn ghost" data-del="${f.id}">Cancel</button></div>`).join('')}</div></div>` : ''}`;
  const sh = body.querySelector('#cl-sh'); sh.onchange = async () => { try{ await setShare(sh.checked); sh.closest('.cl-share').querySelector('span').textContent = sh.checked ? 'Your accepted friends can see your bets.' : 'Off. Nobody can see your bets.'; if(sh.checked) sync(); }catch(_){ sh.checked = !sh.checked; } };
  const q = body.querySelector('#cl-q'), res = body.querySelector('#cl-res'); let t = null; const known = new Set(F.map(f => f.other.id));
  q.oninput = () => { clearTimeout(t); t = setTimeout(async () => { const L = (await search(q.value).catch(() => [])).filter(p => p.id !== SES.uid);
    res.innerHTML = q.value.trim().length < 2 ? '' : L.length ? L.map(p => `<div class="cl-row">${av(p)}<div class="cl-who"><b>${e(p.name)}</b><span>@${e(p.username)}</span></div>${known.has(p.id) ? '<span class="cl-tag">Added</span>' : `<button class="cl-btn" data-add="${e(p.id)}">Add</button>`}</div>`).join('') : `<p class="cl-none">No member called @${e(clean(q.value))}</p>`;
    res.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => { b.disabled = true; try{ await request(b.dataset.add); b.outerHTML = '<span class="cl-tag">Requested</span>'; known.add(b.dataset.add); }catch(err){ b.disabled = false; b.textContent = 'Try again'; } }); }, 220); };
  body.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { b.disabled = true; await accept(b.dataset.acc).catch(() => {}); view(m); });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { b.disabled = true; await remove(b.dataset.del).catch(() => {}); view(m); });
  body.querySelectorAll('[data-fr]').forEach(b => b.onclick = () => openFriend(b.dataset));
  sync(); }

async function openFriend(ds){ const html = `<div class="body cl"><div class="cl-me">${av({name: ds.fn})}<div><b>${e(ds.fn)}</b><span>@${e(ds.fu)}</span></div></div><div id="cl-fb"><div class="cl-load"></div></div></div>`;
  const el = pushSheet('@' + ds.fu, html); const box = el.querySelector('#cl-fb');
  if(ds.fs !== '1'){ box.innerHTML = `<div class="cl-card soft"><p>@${e(ds.fu)} isn't sharing bets right now.</p></div>`; return; }
  const L = await friendBets(ds.fr).catch(() => []); const B = L.map(r => r.bet);
  const won = B.filter(b => b.status === 'won').length, lost = B.filter(b => b.status === 'lost').length, open = B.filter(b => !['won', 'lost', 'push'].includes(b.status)).length;
  box.innerHTML = B.length ? `<div class="cl-stats"><div><b>${won}–${lost}</b><span>record</span></div><div><b>${open}</b><span>open</span></div><div><b>${B.length}</b><span>logged</span></div></div><div class="cl-sec"><h2>Bets</h2><div class="cl-list">${B.map(betLine).join('')}</div></div>` : `<div class="cl-card soft"><p>@${e(ds.fu)} hasn't logged any bets yet.</p></div>`; }

/* ---------- claim username (used by Club for existing members, and by the welcome screen) */
const claimHTML = () => `<div class="cl-card"><b>Claim your username</b><p>Friends find you by it. Letters, numbers and underscores, 3–20 characters.</p>
  <div class="cl-find"><span>@</span><input id="cl-u" type="text" inputmode="text" autocapitalize="off" autocomplete="username" spellcheck="false" maxlength="20" value="${e(clean(((window.TAIL_MEMBER || {}).name || '').replace(/\s+/g, '')))}" placeholder="username"></div>
  <p class="cl-msg" id="cl-um" aria-live="polite"></p><button class="cl-cta" id="cl-ub" disabled>Claim username</button></div>`;
function wireClaim(root, done){ const i = root.querySelector('#cl-u'), b = root.querySelector('#cl-ub'), msg = root.querySelector('#cl-um'); let t = null, ok = false;
  const check = () => { clearTimeout(t); const u = clean(i.value); if(i.value !== u) i.value = u; ok = false; b.disabled = true;
    if(!USER_RE.test(u)){ msg.textContent = u ? '3–20 letters, numbers or _' : ''; msg.className = 'cl-msg'; return; }
    msg.textContent = 'Checking…'; msg.className = 'cl-msg'; t = setTimeout(async () => { try{ ok = await available(u); }catch(_){ ok = false; msg.textContent = "Can't check right now"; return; }
      if(clean(i.value) !== u) return; msg.textContent = ok ? `@${u} is yours if you want it` : `@${u} is taken`; msg.className = 'cl-msg ' + (ok ? 'ok' : 'bad'); b.disabled = !ok; }, 300); };
  i.oninput = check; check();
  b.onclick = async () => { if(!ok) return; b.disabled = true; b.textContent = 'Claiming…'; try{ await claim(i.value, (window.TAIL_MEMBER || {}).name); done && done(PROF); }catch(err){ b.disabled = false; b.textContent = 'Claim username'; msg.textContent = err.status === 409 ? 'Just taken. Try another.' : "Couldn't save. Try again."; msg.className = 'cl-msg bad'; } }; }

window.CLUB = {view, sync, claimHTML, wireClaim, profile: () => PROF, auth, available, claim, api, me};

/* ---------- tab registration */
if(typeof TABS !== 'undefined' && !TABS.find(t => t[0] === 'club')) TABS.splice(4, 0, ['club', 'Club']);
if(window.Icon){ const CLUB_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.6 14.2c2.6-.5 4.6 1.1 5 4.3"/></svg>'; const _svg = Icon.svg; Icon.svg = (n, o) => n === 'club' ? CLUB_SVG : _svg(n, o); }
})();
