/* tail. welcome: one-time member sign-in, stored only on this phone (localStorage). No account server, no password. */
(function(){
const KEY = 'tail.member';
let M = null; try{ M = JSON.parse(localStorage.getItem(KEY) || 'null'); }catch(e){}
window.TAIL_MEMBER = M && M.name ? M : null;
window.tailGreeting = () => { const h = +new Date().toLocaleString('en-US', {hour: 'numeric', hour12: false, timeZone: 'America/New_York'}); return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
if(window.TAIL_MEMBER) return;
const seal = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="currentColor"/><g fill="none" stroke="var(--wl-ink)" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M46 19 V63 Q46 78 61 78 L69 76"/><path d="M29 44 L72 36.5"/></g></svg>';
const el = document.createElement('div'); el.className = 'wl'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'wl-h');
el.innerHTML = `<div class="wl-glow" aria-hidden="true"></div>
  <form class="wl-step wl-in" id="wl-form" autocomplete="off" novalidate>
    <div class="wl-seal">${seal}</div>
    <h1 id="wl-h">Welcome to tail.</h1>
    <p class="wl-sub">The model's board, priced against every book. Your membership lives on this phone.</p>
    <label class="wl-fld"><span>Your name</span><input id="wl-name" name="name" type="text" inputmode="text" autocapitalize="words" autocomplete="given-name" maxlength="24" placeholder="First name" required></label>
    <button class="wl-btn" type="submit" disabled>Enter</button>
    <p class="wl-fine">Saved on this iPhone only. 21+ · Gambling problem? Call 1-800-GAMBLER.</p>
  </form>
  <div class="wl-step wl-user-step" hidden><h1>Pick a username</h1><p class="wl-sub">It's how friends find you in the Club. You can share your bets with them later, only if you choose to.</p><div id="wl-claim" class="wl-claim"></div><button class="wl-skip" type="button" id="wl-skip">Skip for now</button></div>
  <div class="wl-step wl-card-step" hidden>
    <div class="wl-card" aria-live="polite"><div class="wl-card-top"><span class="wl-card-seal">${seal}</span><span class="wl-card-brand">tail.</span></div>
      <div class="wl-card-name" id="wl-cname"></div><div class="wl-card-user" id="wl-cuser"></div><div class="wl-card-foot"><span>Member since <b id="wl-since"></b></span><span>Private board</span></div></div>
    <p class="wl-sub" id="wl-hello"></p>
    <button class="wl-btn" type="button" id="wl-go">Open the board</button>
  </div>`;
const mount = () => { document.body.appendChild(el); document.documentElement.classList.add('wl-open'); const inp = el.querySelector('#wl-name'), btn = el.querySelector('#wl-form .wl-btn');
  inp.addEventListener('input', () => { btn.disabled = !inp.value.trim(); });
  el.querySelector('#wl-form').addEventListener('submit', ev => { ev.preventDefault(); const name = inp.value.trim().replace(/\s+/g, ' ').slice(0, 24); if(!name) return;
    const since = new Date().toLocaleDateString('en-US', {month: 'long', year: 'numeric'}); const m = {name, since, created: new Date().toISOString()};
    try{ localStorage.setItem(KEY, JSON.stringify(m)); }catch(e){} window.TAIL_MEMBER = m; inp.blur();
    el.querySelector('#wl-cname').textContent = name; el.querySelector('#wl-since').textContent = since; el.querySelector('#wl-hello').textContent = `${tailGreeting()}, ${name.split(' ')[0]}. Your board is ready.`;
    const f = el.querySelector('#wl-form'), c = el.querySelector('.wl-card-step'), u = el.querySelector('.wl-user-step');
    const showCard = () => { const P = window.CLUB && CLUB.profile(); el.querySelector('#wl-cuser').textContent = P ? '@' + P.username : ''; u.classList.add('wl-out'); f.classList.add('wl-out'); setTimeout(() => { f.hidden = true; u.hidden = true; c.hidden = false; requestAnimationFrame(() => c.classList.add('wl-in')); }, 220); };
    if(!window.CLUB){ showCard(); return; }
    f.classList.add('wl-out'); setTimeout(() => { f.hidden = true; u.hidden = false; u.querySelector('#wl-claim').innerHTML = CLUB.claimHTML(); CLUB.wireClaim(u, showCard); u.querySelector('#wl-skip').onclick = showCard; requestAnimationFrame(() => u.classList.add('wl-in')); setTimeout(() => { const i = u.querySelector('#cl-u'); i && i.focus({preventScroll: true}); }, 400); }, 220); });
  el.querySelector('#wl-go').addEventListener('click', () => { el.classList.add('wl-bye'); document.documentElement.classList.remove('wl-open'); setTimeout(() => { el.remove(); if(window.go) try{ go(S && S.tab || 'lobby'); }catch(e){} }, 380); });
  setTimeout(() => inp.focus({preventScroll: true}), 450); };
if(document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
