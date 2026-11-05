// MACROS offline cache. Bump VERSION whenever you upload new files.
const VERSION='syncope-v51';
const FILES=['./','./index.html','./manifest.webmanifest','./apple-touch-icon.png','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./foods-db.json','./micro-db.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION&&k!=='syncope-img'&&!k.startsWith('span-')&&!k.startsWith('wmtl-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method==='GET'&&u.hostname==='images.unsplash.com'){e.respondWith(caches.open('syncope-img').then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(res=>{c.put(e.request,res.clone()).then(()=>c.keys()).then(ks=>{if(ks.length>420)ks.slice(0,ks.length-420).forEach(k=>c.delete(k))});return res}))));return} // food photos: keep a copy for offline
  if(e.request.method!=='GET'||u.origin!==location.origin)return; // photo scans go straight to the network
  if(u.pathname.includes('/span-'))return; // SPAN study app lives in its own folder with its own cache
  if(u.pathname.includes('/wmtl/'))return; // whomadethisline lives in its own folder with its own cache
  // Network first for the page so updates show up; cache when offline.
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request.url,{cache:'no-cache',credentials:'same-origin'}).then(r=>{if(r.ok){const cp=r.clone();caches.open(VERSION).then(c=>c.put('./index.html',cp))}return r}).catch(()=>caches.match('./index.html')));return}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
