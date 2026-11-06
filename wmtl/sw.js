/* Overlay (whomadethisline) service worker. It reads and writes only its own "wmtl-" caches, and only for files inside its own
   folder, so it never touches SYNCOPE or SPAN on the same site. Shell: cache first. Slate data: network first. */
const VERSION = 'wmtl-v29-2026-11-05';
const DATA = 'wmtl-data';
const SCOPE = new URL('./', self.location).pathname;
const SHELL = ['./', './index.html', './tokens.css', './components.css', './app.css', './icons.js', './charts.js', './app.js', './ui2.js', './weather.js', './weather.css', './room.js', './vendor/three.min.js', './manifest.webmanifest',
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
