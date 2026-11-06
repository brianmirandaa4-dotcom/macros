/* tail. BET NOW alerts: lock-screen Web Push for the Home Screen app (iOS 16.4+, also Android/desktop browsers that support Push).
   The server side is the Supabase Edge Function live-alerts (community/supabase/functions/live-alerts), run every minute by pg_cron.
   Only PUBLIC keys live here: the VAPID public key and the Supabase anon key. The VAPID private key exists only as an Edge Function secret.
   Cards are placed on the Live Now screen and in the Club tab by watching #main, so app.js / ui2.js / community.js need no changes. */
(function(){
const VAPID = 'BPUZRk3EROmMrP4A5cPGFxfsg9hSqEJkFx9D1fEaC3NH51bhBIPxxg6Lt4LKv4ho9wej8ISY61wSTyX7t6h4llc';
const SB = {url: 'https://zsstjpnqqrxkzrfuejww.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpzc3RqcG5xcXJ4a3pyZnVland3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MzQ3MDcsImV4cCI6MjEwOTUxMDcwN30.JoJsAUYDbkQl-KWMs5Hk9ZiZFZMdDDeLq3f91ZLFU5s'};
const LK = 'tail.push';
const ls = {get(){ try{ return JSON.parse(localStorage.getItem(LK) || 'null'); }catch(e){ return null; } }, set(v){ try{ localStorage.setItem(LK, JSON.stringify(v)); }catch(e){} }};
const ua = navigator.userAgent || '';
const IOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const STANDALONE = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
const CAN = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const u8 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* state: install | unsupported | denied | off | on | busy */
let ST = 'off', MSG = '';
async function getSub(){ if(!CAN) return null; const reg = await navigator.serviceWorker.getRegistration(); return reg ? reg.pushManager.getSubscription() : null; }
async function refresh(){
  if(IOS && !STANDALONE) ST = 'install';
  else if(!CAN) ST = 'unsupported';
  else if(Notification.permission === 'denied') ST = 'denied';
  else { const L = ls.get(); let sub = null; try{ sub = await getSub(); }catch(e){}
    ST = Notification.permission === 'granted' && sub && L && L.on && L.endpoint === sub.endpoint ? 'on' : 'off';
    /* the push service can rotate the endpoint; re-save quietly so alerts keep reaching this phone */
    if(Notification.permission === 'granted' && sub && L && L.on && L.endpoint !== sub.endpoint){ save(sub, true).then(() => { ST = 'on'; paint(); }).catch(() => {}); } }
  paint(); autoOn(); }

/* automatic alerts for every member: no "Turn on" tap needed.
   - permission already granted (or granted once) and not switched off -> subscribe quietly on open
   - permission not asked yet -> iOS only allows the Allow/Don't Allow prompt from a tap, so the first tap anywhere in the app asks once
   - an explicit "Turn off" (tail.push.off) is always respected */
let AUTO = false;
const autoOK = () => { const L = ls.get(); return !(L && L.off); };
function autoOn(){ if(AUTO || ST !== 'off' || !autoOK() || !CAN || (IOS && !STANDALONE)) return;
  if(Notification.permission === 'granted'){ AUTO = true; turnOn().finally(() => { AUTO = false; }); return; }
  if(Notification.permission === 'default') armTap(); }
let ARMED = false;
function armTap(){ if(ARMED) return; ARMED = true;
  const h = ev => { const t = ev.target; if(t && t.closest && (t.closest('input,textarea,select,[data-push],.wl,#welcome'))) return;
    document.removeEventListener('click', h, true); ARMED = false;
    if(Notification.permission === 'default' && autoOK() && ST === 'off') turnOn(); };
  document.addEventListener('click', h, true); }

async function save(sub, on){ if(!window.CLUB || !CLUB.auth) throw new Error('Club sign-in is not ready');
  const s = await CLUB.auth(); const j = sub.toJSON ? sub.toJSON() : sub; const k = j.keys || {};
  const r = await fetch(`${SB.url}/rest/v1/rpc/push_sub_save`, {method: 'POST', headers: {apikey: SB.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json'},
    body: JSON.stringify({p_endpoint: j.endpoint, p_p256dh: k.p256dh || b64u(sub.getKey('p256dh')), p_auth: k.auth || b64u(sub.getKey('auth')), p_enabled: !!on})});
  if(!r.ok) throw new Error('save failed (' + r.status + ')');
  ls.set({endpoint: j.endpoint, on: !!on, at: Date.now()}); }

async function turnOn(){
  /* iOS only shows the permission prompt from a tap, so this is the first await in the tap handler */
  let perm = Notification.permission; if(perm !== 'granted') perm = await Notification.requestPermission();
  if(perm !== 'granted'){ ST = perm === 'denied' ? 'denied' : 'off'; MSG = perm === 'denied' ? '' : 'Alerts stay off until you tap Allow.'; paint(); return; }
  ST = 'busy'; MSG = ''; paint();
  try{ if(!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('sw.js', {scope: './'});
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('service worker not ready')), 15000))]); let sub = await reg.pushManager.getSubscription();
    if(sub && sub.options && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== VAPID){ await sub.unsubscribe(); sub = null; }
    if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: u8(VAPID)});
    await save(sub, true); ST = 'on'; MSG = ''; if(window.toast) toast('BET NOW alerts are on');
  }catch(e){ ST = 'off'; MSG = "Couldn't turn alerts on. Check your connection and try again."; }
  paint(); }
async function turnOff(){ ST = 'busy'; paint();
  try{ const sub = await getSub(); if(sub) await save(sub, false); ls.set(Object.assign({}, ls.get() || {}, {on: false, off: true})); ST = 'off'; MSG = 'Alerts are off for this phone.'; }
  catch(e){ ST = 'on'; MSG = "Couldn't turn alerts off. Try again."; }
  paint(); }

/* ---------- UI */
const BELL = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>';
const SHARE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M7 11H5.5v9.5h13V11H17"/></svg>';
function cardHTML(where){
  const compact = where === 'live' && ST === 'on';
  if(compact) return `<div class="pu pu-on pu-slim" data-push-card="${where}"><span class="pu-ic" aria-hidden="true">${BELL}</span><div class="pu-tx"><b>BET NOW alerts on</b><span>This phone gets a lock-screen alert when the in-game model fires.</span></div></div>`;
  const head = `<span class="pu-ic" aria-hidden="true">${BELL}</span>`;
  let tx = '', act = '';
  if(ST === 'install'){ tx = `<b>Get BET NOW alerts on your lock screen</b><span>Alerts work in the Home Screen app. Add tail. to your Home Screen first:</span>`;
    act = `<ol class="pu-steps"><li><span>Tap ${SHARE} <b>Share</b> in Safari's toolbar</span></li><li><span>Choose <b>Add to Home Screen</b>, then <b>Add</b></span></li><li><span>Open <b>tail.</b> from your Home Screen and come back here</span></li></ol>`; }
  else if(ST === 'unsupported'){ tx = `<b>Alerts aren't available here</b><span>${IOS ? 'Update this iPhone to iOS 16.4 or later to get lock-screen alerts.' : "This browser doesn't support push alerts."}</span>`; }
  else if(ST === 'denied'){ tx = `<b>Notifications are blocked for tail.</b><span>${IOS ? 'Open Settings › Notifications › tail. and turn on Allow Notifications, then come back.' : 'Allow notifications for this site in your browser settings, then come back.'}</span>`; }
  else if(ST === 'on'){ tx = `<b>BET NOW alerts are on</b><span>This phone gets a lock-screen alert when the in-game model fires a live bet.</span>`; act = `<button class="pu-btn ghost" data-push="off">Turn off</button>`; }
  else { tx = `<b>Turn on BET NOW alerts</b><span>Get a lock-screen alert the moment the in-game model fires a live bet: player, side, line, model chance and the live price.</span>`;
    act = `<button class="pu-btn" data-push="on"${ST === 'busy' ? ' disabled' : ''}>${ST === 'busy' ? 'Turning on…' : 'Turn on alerts'}</button>`; }
  return `<div class="pu pu-${ST}" data-push-card="${where}">${head}<div class="pu-tx">${tx}${MSG ? `<em class="pu-msg" role="status">${MSG}</em>` : ''}</div>${act}</div>`; }
function wire(el){ const b = el.querySelector('[data-push]'); if(b) b.onclick = () => { if(b.dataset.push === 'on') turnOn(); else turnOff(); }; }
function place(){ const m = document.getElementById('main'); if(!m || typeof S === 'undefined') return;
  const where = S.tab === 'live' ? 'live' : S.tab === 'club' ? 'club' : null; if(!where) return;
  if(where === 'live' && ST === 'unsupported' && !IOS) return;
  const anchor = where === 'live' ? m.querySelector('.view > .x-hero') : m.querySelector('.cl > .cl-head'); if(!anchor) return;
  let el = anchor.parentNode.querySelector('[data-push-card]'); const html = cardHTML(where);
  if(el){ if(el.outerHTML === html) return; el.outerHTML = html; } else anchor.insertAdjacentHTML('afterend', html);
  wire(anchor.parentNode.querySelector('[data-push-card]')); }
function paint(){ place(); }
/* the Live Now screen redraws #main every few seconds and Club re-renders on its own, so re-place the card whenever #main is replaced */
function watch(){ const m = document.getElementById('main'); if(!m) return; new MutationObserver(place).observe(m, {childList: true}); place(); }

/* ---------- a tapped notification opens that game's Live tab */
function openAlert(slate, gid){ let n = 0; const t = setInterval(async () => { n++;
  if(typeof go !== 'function' || !window.openGame || !document.querySelector('#tabs button') || typeof SLATE === 'undefined'){ if(n > 60) clearInterval(t); return; }
  clearInterval(t); try{ if(S.tab !== 'live') go('live'); if(slate && gid){ await window.openGame(slate, gid); const tabs = document.querySelectorAll('[data-gt2="Live"]'); const b = tabs[tabs.length - 1]; if(b) b.click(); } }catch(e){} }, 150); }
function fromURL(){ const q = new URLSearchParams(location.search); const a = q.get('alert'); if(!a) return; const [slate, gid] = a.split('|');
  try{ history.replaceState(null, '', location.pathname + '#live'); }catch(e){} openAlert(slate, gid); }
if('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', ev => { const d = ev.data || {}; if(d.type === 'tail-alert') openAlert(d.slate, d.gid); });

window.TAILPUSH = {state: () => ST, refresh, turnOn, turnOff};
fromURL(); watch(); refresh();
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') refresh(); });
})();
