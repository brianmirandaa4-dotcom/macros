/* Overlay (whomadethisline) service worker. It reads and writes only its own "wmtl-" caches, and only for files inside its own
   folder, so it never touches SYNCOPE or SPAN on the same site. Shell: cache first. Slate data: network first. */
const VERSION = 'wmtl-v38-2026-11-05';
const DATA = 'wmtl-data';
const SCOPE = new URL('./', self.location).pathname;
const SHELL = ['./', './index.html', './tokens.css', './components.css', './app.css', './icons.js', './charts.js', './app.js', './ui2.js', './weather.js', './wximpact.js', './teams.js', './teams.css', './community.js', './community.css', './pickem.js', './pickem.css','./welcome.js', './welcome.css', './polish.css', './audit-a.css', './audit-c.css','./engage.css', './engage.js', './nba.js', './nba.css', './history.css', './history.js','./schemes/lounge.css', './schemes/bank.css', './schemes/signal.css', './schemes/lounge2.css','./weather.css', './room.js', './vendor/three.min.js', './manifest.webmanifest',
  './fonts/display-600.woff2', './fonts/display-700.woff2', './fonts/display-800.woff2', './fonts/bodoni-moda-latin-500-normal.woff2', './fonts/bodoni-moda-latin-600-normal.woff2', './fonts/bodoni-moda-latin-500-italic.woff2', './fonts/manrope-latin-500-normal.woff2', './fonts/manrope-latin-600-normal.woff2', './fonts/manrope-latin-700-normal.woff2', './fonts/manrope-latin-800-normal.woff2', './theme.css', './mono.css', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-64.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('wmtl-') && k !== VERSION && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if(e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith(SCOPE)) return;
  const key = u.origin + u.pathname;
  if(u.pathname.startsWith(SCOPE + 'data/')){ // newest slate wins; the last copy keeps it working offline
    e.respondWith(caches.open(DATA).then(c => fetch(e.request).then(r => { if(r.ok) c.put(key, r.clone()); return r; }).catch(() => c.match(key))));
    return; }
  e.respondWith(caches.open(VERSION).then(c => {
    if(e.request.mode === 'navigate') return fetch(e.request).then(r => { if(r.ok) c.put('./index.html', r.clone()); return r; }).catch(() => c.match('./index.html'));
    return c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if(r.ok) c.put(e.request, r.clone()); return r; }).catch(() => c.match(e.request, {ignoreSearch: true})));
  }));
});
/* BET NOW alerts (push.js + the Supabase Edge Function live-alerts). iOS requires every push to show a notification. */
self.addEventListener('push', e => { let d = {}; try{ d = e.data ? e.data.json() : {}; }catch(_){ d = {body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'BET NOW · tail.', {body: d.body || 'The in-game model fired a live bet.', tag: d.tag || 'tail-live', icon: './icons/icon-192.png', badge: './icons/icon-192.png',
    data: {url: d.url || './#live', slate: d.slate || null, gid: d.gid || null}})); });
self.addEventListener('notificationclick', e => { e.notification.close(); const D = e.notification.data || {}; const url = new URL(D.url || './#live', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => { const c = cs.find(x => new URL(x.url).pathname.startsWith(SCOPE));
    if(c){ c.postMessage({type: 'tail-alert', slate: D.slate, gid: D.gid}); return c.focus(); } return self.clients.openWindow(url); })); });
