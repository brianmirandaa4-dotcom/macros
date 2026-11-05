/* SPAN service worker: cache-first, offline after first load. Bump VERSION when files change.
   Only reads and writes its own cache, and only for files inside its own folder, so it never touches SYNCOPE. */
const VERSION = "span-v2-2026-11-05";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];
const SCOPE = new URL("./", self.location).pathname;
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("span-") && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith(SCOPE)) return;
  e.respondWith(caches.open(VERSION).then(c => {
    if (e.request.mode === "navigate") // network first for the page so updates show up
      return fetch(e.request).then(r => { if (r.ok) c.put("./index.html", r.clone()); return r; }).catch(() => c.match("./index.html"));
    return c.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }));
  }));
});
