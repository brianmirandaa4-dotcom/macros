// Trainer sync server — a Cloudflare Worker you own.
// Pulls your WHOOP (official OAuth API) and Garmin (official Personal API key) data
// and hands it to the MACROS app. Nothing here is shared with anyone else.
//
// Bindings (set in Cloudflare → Workers → your worker → Settings):
//   KV namespace:  MACROS_KV
//   Secrets:       WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, OURA_CLIENT_ID, OURA_CLIENT_SECRET (optional)
//   Variables:     APP_URL   (e.g. https://yourname.github.io/macros/)
//   Cron trigger:  0 */6 * * *   (keeps WHOOP signed in and pre-loads data)

const WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_SCOPES = 'offline read:profile read:recovery read:sleep read:workout read:cycles read:body_measurement';
const OURA_AUTH = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN = 'https://api.ouraring.com/oauth/token';
const OURA_API = 'https://api.ouraring.com/v2/usercollection';
const OURA_SCOPES = 'personal daily heartrate workout spo2Daily';
const GARMIN_API = 'https://personal.connectapi.garmin.com';
const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

// Storage. With a D1 database bound as DB (free tier: 100,000 writes a day, versus KV's 1,000),
// everything lives in one SQLite table. The first request copies the old KV data over once.
// Without DB it falls back to the KV namespace, so nothing breaks either way.
function withStore(env) {
  if (!env.DB) return env;
  const db = env.DB, kv = env.MACROS_KV, now = () => Math.floor(Date.now() / 1000);
  let ready = null;
  const init = () => ready || (ready = (async () => {
    await db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER)').run();
    const done = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('__moved').first();
    if (!done && kv) {
      let cursor, rows = [];
      do {
        const l = await kv.list({ cursor });
        for (const key of l.keys) { const v = await kv.get(key.name); if (v != null) rows.push(db.prepare('INSERT OR IGNORE INTO kv (k, v, exp) VALUES (?, ?, ?)').bind(key.name, v, key.expiration || null)); }
        cursor = l.list_complete ? null : l.cursor;
      } while (cursor);
      rows.push(db.prepare('INSERT OR REPLACE INTO kv (k, v, exp) VALUES (?, ?, NULL)').bind('__moved', String(Date.now())));
      await db.batch(rows);
    }
  })().catch((e) => { ready = null; throw e; }));
  const st = {
    async get(k, type) {
      await init();
      const r = await db.prepare('SELECT v FROM kv WHERE k = ? AND (exp IS NULL OR exp > ?)').bind(k, now()).first();
      if (!r) return null;
      return type === 'json' ? JSON.parse(r.v) : r.v;
    },
    async put(k, v, opt) {
      await init();
      const exp = opt && opt.expirationTtl ? now() + opt.expirationTtl : null;
      await db.prepare('INSERT OR REPLACE INTO kv (k, v, exp) VALUES (?, ?, ?)').bind(k, String(v), exp).run();
    },
    async delete(k) { await init(); await db.prepare('DELETE FROM kv WHERE k = ?').bind(k).run(); },
    async list(o) {
      await init();
      const p = (o && o.prefix) || '';
      const r = await db.prepare("SELECT k FROM kv WHERE k >= ? AND k < ? AND (exp IS NULL OR exp > ?) ORDER BY k").bind(p, p + '\uffff', now()).all();
      return { keys: (r.results || []).map((x) => ({ name: x.k })), list_complete: true };
    },
  };
  return { ...env, MACROS_KV: st };
}

export default {
  async fetch(req, env, ctx) {
    env = withStore(env);
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const p = url.pathname.replace(/\/+$/, '') || '/';
      if (p === '/') return text('Trainer sync server is running.', 200, cors);
      if (p === '/api/register' && req.method === 'POST') return json(await register(env), 200, cors); if (p.startsWith('/api/acct/') && req.method === 'POST') return acct(p.slice(10), req, env, cors); if (p === '/api/hk/in' && req.method === 'POST') return hkIn(req, url, env, cors);
      if (p === '/whoop/connect') return whoopConnect(url, env);
      if (p === '/whoop/callback') return whoopCallback(url, env);
      if (p === '/oura/connect') return ouraConnect(url, env);
      if (p === '/oura/callback') return ouraCallback(url, env);

      if (p.startsWith('/api/team/')) return team(p.slice(10), req, url, env, cors);
      const user = await authUser(req, env);
      if (!user) return json({ error: 'Not signed in to the sync server. Reconnect in Trainer.' }, 401, cors);

      if (p === '/api/status') return json(status(user), 200, cors);
      if (p === '/api/whoop-link' && req.method === 'POST') { const lnk = rand(16); await env.MACROS_KV.put('lnk:' + lnk, user.id, { expirationTtl: 600 }); return json({ url: url.origin + '/whoop/connect?l=' + lnk }, 200, cors); }
      if (p === '/api/oura-link' && req.method === 'POST') { const lnk = rand(16); await env.MACROS_KV.put('lnk:' + lnk, user.id, { expirationTtl: 600 }); return json({ url: url.origin + '/oura/connect?l=' + lnk }, 200, cors); }
      if (p === '/api/garmin' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const key = String(body.apiKey || '').trim();
        if (!key) return json({ error: 'Paste your Garmin Personal API key.' }, 400, cors);
        try { await garminToken({ garmin: { key } }, env, true); }
        catch (e) { return json({ error: 'Garmin rejected that key. Create a new one in Garmin Connect → Settings → Personal API and try again.' }, 400, cors); }
        user.garmin = { key, since: Date.now() };
        await saveUser(env, user);
        return json(status(user), 200, cors);
      }
      if (p === '/api/disconnect' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        if (body.source === 'whoop') delete user.whoop;
        if (body.source === 'garmin') delete user.garmin;
        if (body.source === 'oura') delete user.oura;
        if (body.source === 'all') { await env.MACROS_KV.delete('user:' + user.id); await env.MACROS_KV.delete('cache:' + user.id); return json({ ok: true }, 200, cors); }
        await saveUser(env, user);
        return json(status(user), 200, cors);
      }
      if (p === '/api/sync') {
        const days = Math.min(60, Math.max(1, +url.searchParams.get('days') || 14));
        const force = url.searchParams.get('force') === '1';
        const cached = await env.MACROS_KV.get('cache:' + user.id, 'json');
        if (cached && cached.days >= days && Date.now() - cached.at < (force ? 2 : 20) * 60 * 1000) return json(cached, 200, cors);
        const data = await syncUser(user, env, days);
        if (cacheChanged(cached, data)) ctx.waitUntil(env.MACROS_KV.put('cache:' + user.id, JSON.stringify(data)));
        return json(data, 200, cors);
      }
      if (p === '/api/tier' && req.method === 'GET') return json(await tierOf(user, env), 200, cors); if (p.startsWith('/api/social/')) return social(p.slice(12), req, url, user, env, cors); if (p === '/api/backup') return backupRoute(req, user, env, cors); if (p === '/api/acct-set' && req.method === 'POST') return acctSet(req, user, env, cors); if (p === '/api/ai' && req.method === 'POST') return aiProxy(req, user, env, cors); if (p === '/api/rest' && req.method === 'POST') return restPush(req, user, env, cors); if (p === '/api/vapid') return json({ key: (await vapidKeys(env)).pub }, 200, cors); if (p === '/api/hk-code' && req.method === 'POST') return hkCode(user, env, cors); if (p === '/api/hk') return hkOut(user, env, cors);
      if (p === '/api/raw') {
        // Troubleshooting: shows the raw shape returned by each source for one day.
        const day = url.searchParams.get('date') || isoDate(new Date());
        return json(await rawSample(user, env, day), 200, cors);
      }
      return json({ error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  },

  async queue(batch, env) { env = withStore(env); for (const m of batch.messages) { try { const x = m.body; if (x && (await env.MACROS_KV.get('rest:' + x.u)) === x.id) await webPush(x.ep, env); } catch (e) {} m.ack(); } },
  async scheduled(event, env, ctx) {
    env = withStore(env);
    // Keep every connected account fresh and pre-load the last 14 days.
    let cursor;
    do {
      const list = await env.MACROS_KV.list({ prefix: 'user:', cursor });
      for (const k of list.keys) {
        const user = await env.MACROS_KV.get(k.name, 'json');
        if (!user || (!user.whoop && !user.garmin && !user.oura)) continue;
        try {
          const data = await syncUser(user, env, 14);
          const old = await env.MACROS_KV.get('cache:' + user.id, 'json');
          if (cacheChanged(old, data)) await env.MACROS_KV.put('cache:' + user.id, JSON.stringify(data));
        } catch (e) { /* keep going for other users */ }
      }
      cursor = list.list_complete ? null : list.cursor;
    } while (cursor);
  },
};

/* ---------------- helpers ---------------- */
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  let allowed = '*';
  try { if (env.APP_URL) allowed = new URL(env.APP_URL).origin; } catch (e) {}
  return {
    'Access-Control-Allow-Origin': allowed === '*' || origin === allowed ? (origin || allowed) : allowed,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const text = (t, s = 200, h = {}) => new Response(t, { status: s, headers: { ...h, 'Content-Type': 'text/plain' } });
const page = (title, body, appUrl) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="background:#0B0C10;color:#ECEEF4;font:16px/1.5 system-ui;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div style="max-width:420px"><h1 style="font-size:26px">${title}</h1><p style="color:#8C92A4">${body}</p>${appUrl ? `<p><a href="${appUrl}" style="display:inline-block;background:#C7B6FF;color:#14101F;padding:14px 22px;border-radius:14px;font-weight:800;text-decoration:none">Back to Trainer</a></p>` : ''}</div></body>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
const isoDate = (d) => d.toISOString().slice(0, 10);
const r1 = (n) => Math.round(n * 10) / 10; const b64u = (a) => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); async function vapidKeys(env) { let v = await env.MACROS_KV.get('vapid', 'json'); if (v && v.jwk && v.pub) return v; const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']); v = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) }; await env.MACROS_KV.put('vapid', JSON.stringify(v)); return v; } async function webPush(ep, env) { const v = await vapidKeys(env), u = new URL(ep), te = new TextEncoder(), enc = (o) => b64u(te.encode(JSON.stringify(o))); const h = enc({ typ: 'JWT', alg: 'ES256' }), pl = enc({ aud: u.origin, exp: Math.floor(Date.now() / 1000) + 43200, sub: 'mailto:syncope@users.noreply.github.com' }); const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(h + '.' + pl)); return fetch(ep, { method: 'POST', headers: { Authorization: 'vapid t=' + h + '.' + pl + '.' + b64u(sig) + ', k=' + v.pub, TTL: '120', Urgency: 'high' } }); } async function restPush(req, user, env, cors) { const b = await req.json().catch(() => ({})), k = 'rest:' + user.id; if (b.cancel) { await env.MACROS_KV.put(k, 'x', { expirationTtl: 7200 }); return json({ ok: true }, 200, cors); } if (!b.sub || !/^https:\/\//.test(b.sub.endpoint || '')) return json({ error: 'No push subscription.' }, 400, cors); if (!env.REST_Q) return json({ error: 'Rest alerts are not set up on the server yet.' }, 503, cors); const id = crypto.randomUUID(), d = Math.max(0, Math.min(3600, Math.round((+b.at - Date.now()) / 1000))); await env.MACROS_KV.put(k, id, { expirationTtl: 7200 }); await env.REST_Q.send({ u: user.id, id, ep: b.sub.endpoint }, { delaySeconds: d }); return json({ ok: true, id }, 200, cors); } async function tierOf(user, env) { const raw = String(env.OWNERS || '').toLowerCase(), ow = raw.replace(/\*/g, ',').split(/[\s,]+/).filter(Boolean); if (raw.includes('*')) ow.push('*'); if (ow.length) { const pw = await env.MACROS_KV.get('pw:' + user.id, 'json'); const un = pw && pw.un ? String(pw.un).toLowerCase() : ''; if (un && ow.includes(un)) return { tier: 'elite', comp: 'owner' }; } const m = await env.MACROS_KV.get('mem:' + user.id, 'json'); if (m && m.tier && (!m.until || m.until > Date.now())) return { tier: m.tier, until: m.until || null }; if (ow.includes('*')) return { tier: 'elite', comp: 'beta' }; return { tier: 'free' }; }
async function aiProxy(req, user, env, cors) { if (!env.ANTHROPIC_KEY) return json({ error: 'Scanning is not set up on the server yet.' }, 503, cors); const b = await req.json().catch(() => null); if (!b || !Array.isArray(b.messages)) return json({ error: 'Bad scan request.' }, 400, cors); const web = b.web === true, cost = web ? 3 : 1; const day = isoDate(new Date()), per = (await tierOf(user, env)).comp === 'owner' ? 1000 : (+env.AI_PER_USER || 60), tot = +env.AI_PER_DAY || 600, uk = 'ai:' + day + ':' + user.id, tk = 'ai:' + day; const un = +(await env.MACROS_KV.get(uk)) || 0, tn = +(await env.MACROS_KV.get(tk)) || 0; if (un + cost > per) return json({ error: 'You have used all ' + per + ' scans for today. They reset overnight.' }, 429, cors); if (tn + cost > tot) return json({ error: 'Scanning is maxed out for today. Try again tomorrow.' }, 429, cors); const body = { model: /^claude-(sonnet|haiku)-/.test(b.model || '') ? b.model : 'claude-sonnet-5-5', max_tokens: Math.min(web ? 2500 : 2000, +b.max_tokens || 1000), messages: b.messages.slice(0, 2) }; if (web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]; const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) }); if (r.ok) { await env.MACROS_KV.put(uk, String(un + cost), { expirationTtl: 172800 }); await env.MACROS_KV.put(tk, String(tn + cost), { expirationTtl: 172800 }); } return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }

async function register(env) {
  const id = rand(12), secret = rand(24);
  await env.MACROS_KV.put('user:' + id, JSON.stringify({ id, h: await sha(secret), created: Date.now() }));
  return { uid: id, token: secret };
} const PW_OK = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128 && /\d/.test(p) && /[^A-Za-z0-9]/.test(p); async function pwHash(pw, salt) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']); const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); } async function newDevice(env, uid) { const u = (await env.MACROS_KV.get('user:' + uid, 'json')) || { id: uid, created: Date.now() }; const secret = rand(24); u.hs = [...(u.hs || []), await sha(secret)].slice(-10); await env.MACROS_KV.put('user:' + uid, JSON.stringify(u)); return secret; } async function acctWho(env, raw) { const q = String(raw || '').trim(), digits = q.replace(/\D/g, ''); if (/^[+()\d\s.-]+$/.test(q) && digits.length >= 7) { const pk = await phoneKey(env, q); return { uid: pk && (await env.MACROS_KV.get('ph:' + pk.h)), key: 'ph' + (pk ? pk.h.slice(0, 12) : digits) }; } const un = cleanUser(q); if (!/^[a-z0-9_.]{3,20}$/.test(un)) return { bad: true }; return { uid: await env.MACROS_KV.get('un:' + un), key: un }; } async function acctOut(env, uid, pwr) { const soc = await env.MACROS_KV.get('soc:' + uid, 'json'); return { uid, token: await newDevice(env, uid), username: (soc && soc.username) || (pwr && pwr.un) || '', hasBackup: !!(await env.MACROS_KV.get('bk:' + uid)), soc }; } async function acct(action, req, env, cors) { const b = await req.json().catch(() => ({})); const pw = String(b.password || ''); const who = await acctWho(env, b.id ?? b.username); if (who.bad) return json({ error: 'Enter your username or phone number.' }, 400, cors); const rl = 'rl:' + who.key, n = +((await env.MACROS_KV.get(rl)) || 0); if (n >= 10) return json({ error: 'Too many tries. Wait 15 minutes and try again.' }, 429, cors); const miss = async () => { await env.MACROS_KV.put(rl, String(n + 1), { expirationTtl: 900 }); return json({ error: 'No account with that username or phone number.' }, 404, cors); }; if (!who.uid) return miss(); const pwr = await env.MACROS_KV.get('pw:' + who.uid, 'json'); if (action === 'login') { if (!pwr) return json({ error: 'This account has no password yet. Tap Recover my account to set one.', claim: true }, 404, cors); if ((await pwHash(pw, pwr.salt)) !== pwr.h) { await env.MACROS_KV.put(rl, String(n + 1), { expirationTtl: 900 }); return json({ error: 'Wrong password. Try again.' }, 401, cors); } return json(await acctOut(env, who.uid, pwr), 200, cors); } if (action === 'claim') { if (pwr) return json({ error: 'This account already has a password. Sign in instead.' }, 409, cors); if (!PW_OK(pw)) return json({ error: 'Passwords need at least 8 characters, a number and a special character.' }, 400, cors); const salt = rand(16), rec = { salt, h: await pwHash(pw, salt), t: Date.now(), claimed: true }; await env.MACROS_KV.put('pw:' + who.uid, JSON.stringify(rec)); return json(await acctOut(env, who.uid, rec), 200, cors); } return json({ error: 'Not found' }, 404, cors); } async function acctSet(req, user, env, cors) { const b = await req.json().catch(() => ({})); const un = cleanUser(b.username), pw = String(b.password || ''); if (!/^[a-z0-9_.]{3,20}$/.test(un)) return json({ error: 'Usernames are 3–20 letters, numbers, dots or underscores.' }, 400, cors); if (!PW_OK(pw)) return json({ error: 'Passwords need at least 8 characters, a number and a special character.' }, 400, cors); const owner = await env.MACROS_KV.get('un:' + un); if (owner && owner !== user.id) return json({ error: '@' + un + ' is taken. Try another.' }, 409, cors); let ph = null; if (b.phone && String(b.phone).trim()) { ph = await phoneKey(env, b.phone); if (!ph) return json({ error: 'That phone number doesn’t look right.' }, 400, cors); const po = await env.MACROS_KV.get('ph:' + ph.h); if (po && po !== user.id) return json({ error: 'That phone number is already linked to another account.' }, 409, cors); } const salt = rand(16); await env.MACROS_KV.put('pw:' + user.id, JSON.stringify({ salt, h: await pwHash(pw, salt), t: Date.now(), un })); if (!owner) await env.MACROS_KV.put('un:' + un, user.id); if (ph) await env.MACROS_KV.put('ph:' + ph.h, user.id); const me = await env.MACROS_KV.get('soc:' + user.id, 'json'); if (me) { let ch = false; if (me.username !== un) { if (me.username) await env.MACROS_KV.delete('un:' + me.username); me.username = un; ch = true; } if (ph && me.ph !== ph.h) { if (me.ph) await env.MACROS_KV.delete('ph:' + me.ph); me.ph = ph.h; me.phLast4 = ph.last4; ch = true; } if (ch) await env.MACROS_KV.put('soc:' + user.id, JSON.stringify(me)); } return json({ ok: true, username: un, phoneLast4: ph ? ph.last4 : null }, 200, cors); } async function backupRoute(req, user, env, cors) { if (req.method === 'POST') { const t = await req.text(); if (t.length > 1900000) return json({ error: 'Backup too large.' }, 413, cors); await env.MACROS_KV.put('bk:' + user.id, t); return json({ ok: true, at: Date.now() }, 200, cors); } const t = await env.MACROS_KV.get('bk:' + user.id); return t ? new Response(t, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }) : json({ none: true }, 200, cors); } async function hkCode(user, env, cors) { const u = (await env.MACROS_KV.get('user:' + user.id, 'json')) || user; if (u.hk) return json({ code: u.hk }, 200, cors); const code = rand(10); u.hk = code; await env.MACROS_KV.put('user:' + user.id, JSON.stringify(u)); await env.MACROS_KV.put('hkc:' + code, user.id); return json({ code }, 200, cors); } async function hkIn(req, url, env, cors) { const code = String(url.searchParams.get('k') || '').replace(/[^a-f0-9]/gi, '').slice(0, 40); const uid = code && (await env.MACROS_KV.get('hkc:' + code)); if (!uid) return json({ error: 'Unknown sync code. Copy it again from Trainer.' }, 404, cors); const t = (await req.text()).slice(0, 4000); if (!t.trim()) return json({ error: 'Nothing received.' }, 400, cors); const cur = (await env.MACROS_KV.get('hk:' + uid, 'json')) || { list: [] }; cur.list = [...cur.list, { t: Date.now(), text: t }].slice(-14); await env.MACROS_KV.put('hk:' + uid, JSON.stringify(cur)); return json({ ok: true, message: 'Sent to Trainer. Open the app to see it.' }, 200, cors); } async function hkOut(user, env, cors) { const cur = (await env.MACROS_KV.get('hk:' + user.id, 'json')) || { list: [] }; return json(cur, 200, cors); }
async function authUser(req, env) {
  const a = req.headers.get('Authorization') || '';
  const m = a.match(/^Bearer\s+([a-f0-9]+)\.([a-f0-9]+)$/i);
  if (!m) return null;
  const user = await env.MACROS_KV.get('user:' + m[1], 'json');
  if (!user) return null; const hh = await sha(m[2]); if (user.h !== hh && !(user.hs || []).includes(hh)) return null;
  return user;
}
// Free KV tier allows ~1,000 writes a day, so only write when the data really changed.
const sansAt = (d) => { if (!d) return ''; const { at, ...rest } = d; return JSON.stringify(rest); };
const cacheChanged = (old, data) => !old || old.days < data.days || sansAt(old) !== sansAt(data) || Date.now() - (old.at || 0) > 6 * 3600 * 1000;
async function saveUser(env, user) { await env.MACROS_KV.put('user:' + user.id, JSON.stringify(user)); }
function status(user) {
  return { whoop: !!user.whoop?.refresh, garmin: !!user.garmin?.key, whoopSince: user.whoop?.since || null, garminSince: user.garmin?.since || null, oura: !!user.oura?.refresh, ouraSince: user.oura?.since || null };
}

/* ---------------- WHOOP ---------------- */
async function whoopConnect(url, env) {
  const lnk = url.searchParams.get('l') || '';
  const uid = lnk && await env.MACROS_KV.get('lnk:' + lnk);
  if (!uid) return page('Link expired', 'Open Trainer and tap Connect WHOOP again.', env.APP_URL);
  await env.MACROS_KV.delete('lnk:' + lnk);
  if (!env.WHOOP_CLIENT_ID) return page('WHOOP not set up yet', 'Add WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET to this worker first.', env.APP_URL);
  const state = rand(16);
  await env.MACROS_KV.put('state:' + state, uid, { expirationTtl: 900 });
  const redirect = url.origin + '/whoop/callback';
  const q = new URLSearchParams({ client_id: env.WHOOP_CLIENT_ID, response_type: 'code', redirect_uri: redirect, scope: WHOOP_SCOPES, state });
  return Response.redirect(WHOOP_AUTH + '?' + q, 302);
}
async function whoopCallback(url, env) {
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code');
  if (url.searchParams.get('error')) return page('WHOOP not connected', 'You cancelled or WHOOP declined the request. You can try again from Trainer.', env.APP_URL);
  const uid = await env.MACROS_KV.get('state:' + state);
  if (!uid || !code) return page('Link expired', 'Open Trainer and tap Connect WHOOP again.', env.APP_URL);
  await env.MACROS_KV.delete('state:' + state);
  const r = await fetch(WHOOP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: url.origin + '/whoop/callback', client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET }) });
  if (!r.ok) return page('WHOOP not connected', 'WHOOP did not accept the sign-in (' + r.status + '). Check the redirect URL in your WHOOP developer app matches this server.', env.APP_URL);
  const t = await r.json();
  const user = await env.MACROS_KV.get('user:' + uid, 'json');
  user.whoop = { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000, since: Date.now() };
  await saveUser(env, user);
  return page('WHOOP connected', 'Your recovery, sleep, strain and workouts will now flow into Trainer automatically.', env.APP_URL);
}
async function whoopAccess(user, env) {
  const w = user.whoop;
  if (w.access && w.exp - Date.now() > 120000) return w.access;
  const r = await fetch(WHOOP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: w.refresh, client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET, scope: 'offline' }) });
  if (!r.ok) { throw new Error('WHOOP sign-in expired. Reconnect WHOOP in Trainer.'); }
  const t = await r.json();
  w.access = t.access_token; if (t.refresh_token) w.refresh = t.refresh_token; w.exp = Date.now() + (t.expires_in || 3600) * 1000;
  await saveUser(env, user);
  return w.access;
}
async function whoopList(path, access, startISO, endISO, maxPages = 6) {
  const out = []; let next = null;
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams(next ? { nextToken: next } : { start: startISO, end: endISO, limit: '25' });
    const r = await fetch(WHOOP_API + path + '?' + q, { headers: { Authorization: 'Bearer ' + access } });
    if (!r.ok) throw new Error('WHOOP ' + path + ' failed (' + r.status + ')');
    const j = await r.json();
    out.push(...(j.records || []));
    next = j.next_token || j.nextToken; if (!next) break;
  }
  return out;
}
// WHOOP times are UTC with a timezone_offset like "-05:00"; convert to the local calendar date.
function localDate(iso, off) {
  if (!iso) return null;
  const t = Date.parse(iso); if (!isFinite(t)) return null;
  const m = String(off || '+00:00').match(/([+-])(\d{2}):?(\d{2})/);
  const mins = m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
  return new Date(t + mins * 60000).toISOString().slice(0, 10);
}
async function syncWhoop(user, env, days) {
  const access = await whoopAccess(user, env);
  const end = new Date(), start = new Date(Date.now() - days * 864e5);
  const [rec, slp, cyc, wko] = await Promise.all([
    whoopList('/recovery', access, start.toISOString(), end.toISOString()),
    whoopList('/activity/sleep', access, start.toISOString(), end.toISOString()),
    whoopList('/cycle', access, start.toISOString(), end.toISOString()),
    whoopList('/activity/workout', access, start.toISOString(), end.toISOString()),
  ]);
  const byDay = {}, d = (k) => (byDay[k] = byDay[k] || {});
  const sleepDate = {};
  for (const s of slp) {
    if (s.nap) continue;
    const k = localDate(s.end || s.start, s.timezone_offset); if (!k) continue;
    sleepDate[s.id] = k;
    const sc = s.score || {}, st = sc.stage_summary || {};
    const asleep = (st.total_light_sleep_time_milli || 0) + (st.total_slow_wave_sleep_time_milli || 0) + (st.total_rem_sleep_time_milli || 0);
    Object.assign(d(k), {
      sleepH: asleep ? r1(asleep / 3600000) : undefined,
      sleepPerf: sc.sleep_performance_percentage, sleepEff: sc.sleep_efficiency_percentage != null ? Math.round(sc.sleep_efficiency_percentage) : undefined,
      sleepConsistency: sc.sleep_consistency_percentage, respRate: sc.respiratory_rate != null ? r1(sc.respiratory_rate) : undefined,
      deepH: st.total_slow_wave_sleep_time_milli ? r1(st.total_slow_wave_sleep_time_milli / 3600000) : undefined,
      remH: st.total_rem_sleep_time_milli ? r1(st.total_rem_sleep_time_milli / 3600000) : undefined,
    });
  }
  for (const r of rec) {
    const k = sleepDate[r.sleep_id] || localDate(r.created_at || r.updated_at, r.timezone_offset); if (!k) continue;
    const sc = r.score || {};
    Object.assign(d(k), {
      recovery: sc.recovery_score, rhr: sc.resting_heart_rate,
      hrv: sc.hrv_rmssd_milli != null ? Math.round(sc.hrv_rmssd_milli) : undefined,
      spo2: sc.spo2_percentage != null ? r1(sc.spo2_percentage) : undefined,
      skinTempC: sc.skin_temp_celsius != null ? r1(sc.skin_temp_celsius) : undefined,
    });
  }
  for (const c of cyc) {
    // A WHOOP cycle starts when you fall asleep, so label it by the day you're awake for (start + 12h).
    const k = c.start ? localDate(new Date(Date.parse(c.start) + 12 * 36e5).toISOString(), c.timezone_offset) : null; if (!k) continue;
    const sc = c.score || {};
    const st = c.step_count ?? sc.step_count;
    Object.assign(d(k), { strain: sc.strain != null ? r1(sc.strain) : undefined, kcal: sc.kilojoule != null ? Math.round(sc.kilojoule / 4.184) : undefined, avgHr: sc.average_heart_rate, steps: st != null ? Math.round(st) : undefined });
  }
  const workouts = wko.map(w => {
    const sc = w.score || {};
    return { src: 'WHOOP', id: 'whoop-' + w.id, date: localDate(w.start, w.timezone_offset), name: w.sport_name ? titleCase(w.sport_name) : 'Workout',
      start: w.start, min: w.end ? Math.round((Date.parse(w.end) - Date.parse(w.start)) / 60000) : null,
      kcal: sc.kilojoule != null ? Math.round(sc.kilojoule / 4.184) : null, strain: sc.strain != null ? r1(sc.strain) : null, avgHr: sc.average_heart_rate || null, maxHr: sc.max_heart_rate || null, zones: sc.zone_durations ? ['zero', 'one', 'two', 'three', 'four', 'five'].map(z => Math.round((sc.zone_durations['zone_' + z + '_milli'] || 0) / 60000)) : null, mi: sc.distance_meter ? r1(sc.distance_meter / 1609.34) : null, elev: sc.altitude_gain_meter ? Math.round(sc.altitude_gain_meter * 3.281) : null };
  }).filter(w => w.date);
  return { days: clean(byDay), workouts };
}
/* ---------------- Oura Ring (official OAuth API v2) ---------------- */
async function ouraConnect(url, env) {
  const lnk = url.searchParams.get('l') || '';
  const uid = lnk && await env.MACROS_KV.get('lnk:' + lnk);
  if (!uid) return page('Link expired', 'Open Trainer and tap Connect Oura again.', env.APP_URL);
  await env.MACROS_KV.delete('lnk:' + lnk);
  if (!env.OURA_CLIENT_ID) return page('Oura not set up yet', 'Add OURA_CLIENT_ID and OURA_CLIENT_SECRET to this worker first.', env.APP_URL);
  const state = rand(16);
  await env.MACROS_KV.put('ostate:' + state, uid, { expirationTtl: 900 });
  const q = new URLSearchParams({ response_type: 'code', client_id: env.OURA_CLIENT_ID, redirect_uri: url.origin + '/oura/callback', scope: OURA_SCOPES, state });
  return Response.redirect(OURA_AUTH + '?' + q, 302);
}
async function ouraCallback(url, env) {
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code');
  if (url.searchParams.get('error')) return page('Oura not connected', 'You cancelled or Oura declined the request. You can try again from Trainer.', env.APP_URL);
  const uid = await env.MACROS_KV.get('ostate:' + state);
  if (!uid || !code) return page('Link expired', 'Open Trainer and tap Connect Oura again.', env.APP_URL);
  await env.MACROS_KV.delete('ostate:' + state);
  const r = await fetch(OURA_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: url.origin + '/oura/callback', client_id: env.OURA_CLIENT_ID, client_secret: env.OURA_CLIENT_SECRET }) });
  if (!r.ok) return page('Oura not connected', 'Oura did not accept the sign-in (' + r.status + '). Check the redirect URI in your Oura app matches this server.', env.APP_URL);
  const t = await r.json();
  const user = await env.MACROS_KV.get('user:' + uid, 'json');
  user.oura = { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 86400) * 1000, since: Date.now() };
  await saveUser(env, user);
  return page('Oura connected', 'Your readiness, sleep, HRV, steps and workouts will now flow into Trainer automatically.', env.APP_URL);
}
async function ouraAccess(user, env) {
  const o = user.oura;
  if (o.access && o.exp - Date.now() > 120000) return o.access;
  // Oura refresh tokens are single-use: save the new one straight away.
  const r = await fetch(OURA_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: o.refresh, client_id: env.OURA_CLIENT_ID, client_secret: env.OURA_CLIENT_SECRET }) });
  if (!r.ok) throw new Error('Oura sign-in expired. Reconnect Oura in Trainer.');
  const t = await r.json();
  o.access = t.access_token; if (t.refresh_token) o.refresh = t.refresh_token; o.exp = Date.now() + (t.expires_in || 86400) * 1000;
  await saveUser(env, user);
  return o.access;
}
async function ouraList(kind, access, startDay, endDay, maxPages = 5) {
  const out = []; let next = null;
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams({ start_date: startDay, end_date: endDay }); if (next) q.set('next_token', next);
    const r = await fetch(OURA_API + '/' + kind + '?' + q, { headers: { Authorization: 'Bearer ' + access } });
    if (r.status === 401 || r.status === 403) throw new Error('Oura ' + kind + ' not allowed (' + r.status + '). Reconnect Oura, or renew your Oura membership.');
    if (!r.ok) throw new Error('Oura ' + kind + ' failed (' + r.status + ')');
    const j = await r.json();
    out.push(...(j.data || []));
    next = j.next_token; if (!next) break;
  }
  return out;
}
async function syncOura(user, env, days) {
  const access = await ouraAccess(user, env);
  const startDay = isoDate(new Date(Date.now() - days * 864e5)), endDay = isoDate(new Date(Date.now() + 864e5));
  const soft = (p) => p.catch(e => { errs.push(e.message); return []; });
  const errs = [];
  const [rdy, dsl, slp, act, wko, spo] = await Promise.all([
    ouraList('daily_readiness', access, startDay, endDay),
    soft(ouraList('daily_sleep', access, startDay, endDay)),
    soft(ouraList('sleep', access, startDay, endDay)),
    soft(ouraList('daily_activity', access, startDay, endDay)),
    soft(ouraList('workout', access, startDay, endDay)),
    soft(ouraList('daily_spo2', access, startDay, endDay)),
  ]);
  const byDay = {}, d = (k) => (byDay[k] = byDay[k] || {});
  for (const x of rdy) if (x.day) Object.assign(d(x.day), { recovery: x.score, skinTempDev: x.temperature_deviation != null ? r1(x.temperature_deviation) : undefined });
  for (const x of dsl) if (x.day) d(x.day).sleepScore = x.score;
  // Main sleep only (long_sleep); if several, keep the longest.
  const best = {};
  for (const x of slp) { if (!x.day || (x.type && x.type !== 'long_sleep')) continue; if (!best[x.day] || (x.total_sleep_duration || 0) > (best[x.day].total_sleep_duration || 0)) best[x.day] = x; }
  for (const [k, x] of Object.entries(best)) Object.assign(d(k), {
    sleepH: x.total_sleep_duration ? r1(x.total_sleep_duration / 3600) : undefined,
    deepH: x.deep_sleep_duration ? r1(x.deep_sleep_duration / 3600) : undefined,
    remH: x.rem_sleep_duration ? r1(x.rem_sleep_duration / 3600) : undefined,
    sleepEff: x.efficiency, hrv: x.average_hrv != null ? Math.round(x.average_hrv) : undefined,
    rhr: x.lowest_heart_rate, respRate: x.average_breath != null ? r1(x.average_breath) : undefined,
  });
  for (const x of act) if (x.day) Object.assign(d(x.day), { steps: x.steps, active: x.active_calories, kcal: x.total_calories });
  for (const x of spo) if (x.day && x.spo2_percentage?.average != null) d(x.day).spo2 = r1(x.spo2_percentage.average);
  const workouts = wko.map(w => ({ src: 'Oura', id: 'oura-' + w.id, date: w.day || (w.start_datetime || '').slice(0, 10), name: w.activity ? titleCase(w.activity) : 'Workout',
    start: w.start_datetime, min: w.end_datetime && w.start_datetime ? Math.round((Date.parse(w.end_datetime) - Date.parse(w.start_datetime)) / 60000) : null,
    kcal: w.calories != null ? Math.round(w.calories) : null, intensity: w.intensity || null, mi: w.distance ? r1(w.distance / 1609.34) : null })).filter(w => w.date);
  return { days: clean(byDay), workouts, errors: errs };
}
const titleCase = (s) => String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/* ---------------- Garmin (Personal API) ---------------- */
async function garminToken(user, env, force) {
  const g = user.garmin;
  if (!force && g.token && g.tokenExp - Date.now() > 3600000) return g.token;
  const r = await fetch(GARMIN_API + GARMIN_TOKEN_PATH, { method: 'POST', headers: { Accept: '*/*', Authorization: 'ApiKey ' + g.key } });
  if (!r.ok) throw new Error('Garmin key was rejected (' + r.status + '). Create a new Personal API key and paste it in Trainer.');
  const tok = (await r.text()).trim();
  let exp = Date.now() + 23 * 3600000;
  try { const p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.exp) exp = p.exp * 1000; } catch (e) {}
  g.token = tok; g.tokenExp = exp; if (!g.since) g.since = Date.now();
  return tok;
}
async function gget(tok, path, params) {
  const r = await fetch(GARMIN_API + path + (params ? '?' + new URLSearchParams(params) : ''), { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
  if (!r.ok) throw new Error('Garmin ' + path + ' failed (' + r.status + ')');
  const t = await r.text(); try { return JSON.parse(t); } catch (e) { return null; }
}
// Garmin's JSON nests differently per endpoint, so collect every object that names a calendarDate.
function byCalendarDate(json) {
  const out = {};
  (function walk(o, depth) {
    if (!o || depth > 6) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, depth + 1)); return; }
    if (typeof o !== 'object') return;
    const cd = o.calendarDate || o.summaryDate || o.calendarDateString || (typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null);
    if (typeof cd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cd)) { const k = cd.slice(0, 10); out[k] = Object.assign(out[k] || {}, o); }
    for (const [kk, v] of Object.entries(o)) if (v && typeof v === 'object') { if (/^\d{4}-\d{2}-\d{2}$/.test(kk) && !Array.isArray(v)) out[kk] = Object.assign(out[kk] || {}, v); walk(v, depth + 1); }
  })(json, 0);
  return out;
}
function pick(o, names, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 4) return undefined;
  for (const n of names) { const v = o[n]; if (typeof v === 'number' && isFinite(v)) return v; }
  for (const v of Object.values(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) { const f = pick(v, names, depth + 1); if (f !== undefined) return f; } }
  return undefined;
}
function sleepScore(o) {
  const s = o && (o.sleepScores || (o.dailySleepDTO && o.dailySleepDTO.sleepScores));
  if (s && s.overall && typeof s.overall.value === 'number') return s.overall.value;
  return pick(o, ['sleepScore', 'overallSleepScore']);
}
async function syncGarmin(user, env, days) {
  const tok = await garminToken(user, env);
  const end = new Date(), start = new Date(Date.now() - (days - 1) * 864e5);
  const sd = isoDate(start), ed = isoDate(end);
  const safe = (p) => p.catch(e => ({ __error: String(e.message || e) }));
  const mid = new Date(Math.min(end.getTime(), start.getTime() + 27 * 864e5)), sd2 = isoDate(new Date(mid.getTime() + 864e5)), rd = [...Array(Math.min(days, 10))].map((_, i) => isoDate(new Date(Date.now() - i * 864e5))); const [sum, slp, hrv, bb, acts, wt, st1, st2, ...hrs] = await Promise.all([
    safe(gget(tok, '/usersummary-service/v2/dailysummaries', { startDate: sd, endDate: ed })),
    safe(gget(tok, '/sleep-service/sleep/dailySleepSummariesByDate', { startDate: sd, endDate: ed })),
    safe(gget(tok, `/hrv-service/hrv/daily/${sd}/${ed}`)),
    safe(gget(tok, '/wellness-service/wellness/bodyBattery/reports/daily', { startDate: sd, endDate: ed })),
    safe(gget(tok, '/activitylist-service/activities/search/activities', { start: 0, limit: 40, startDate: sd, endDate: ed })),
    safe(gget(tok, `/weight-service/weight/range/${sd}/${ed}`, { includeAll: 'true' })), safe(gget(tok, `/usersummary-service/stats/steps/daily/${sd}/${isoDate(mid)}`)), sd2 <= ed ? safe(gget(tok, `/usersummary-service/stats/steps/daily/${sd2}/${ed}`)) : Promise.resolve(null), ...rd.map((x) => safe(gget(tok, '/wellness-service/wellness/dailyHeartRate', { date: x }))),
  ]);
  const byDay = {}, d = (k) => (byDay[k] = byDay[k] || {});
  for (const [k, o] of Object.entries(byCalendarDate(sum))) Object.assign(d(k), {
    steps: pick(o, ['totalSteps', 'steps']), activeKcal: pick(o, ['activeKilocalories', 'activeCalories']),
    rhr: pick(o, ['restingHeartRate', 'restingHeartRateValue']), stress: pick(o, ['averageStressLevel', 'avgStressLevel']),
    bodyBattery: pick(o, ['bodyBatteryHighestValue', 'maxBodyBattery', 'bodyBatteryAtWakeTime']),
  });
  for (const [k, o] of Object.entries(byCalendarDate(slp))) {
    const secs = pick(o, ['sleepTimeSeconds', 'totalSleepTimeInSeconds', 'sleepTimeInSeconds']);
    Object.assign(d(k), { sleepH: secs ? r1(secs / 3600) : undefined, sleepScore: sleepScore(o) });
  }
  for (const [k, o] of Object.entries(byCalendarDate(hrv))) Object.assign(d(k), { hrv: pick(o, ['lastNightAvg', 'lastNight', 'hrvValue', 'weeklyAvg']), hrvStatus: typeof o.status === 'string' ? o.status : undefined });
  for (const [k, o] of Object.entries(byCalendarDate(bb))) { const v = pick(o, ['charged', 'highest', 'bodyBatteryHighestValue', 'max']); if (v != null && d(k).bodyBattery == null) d(k).bodyBattery = v; }
  for (const [k, o] of Object.entries(byCalendarDate(wt))) { const g = pick(o, ['weight']); if (g) d(k).weightLb = r1(g > 1000 ? g / 453.592 : g / 0.4536); } for (const s of [st1, st2]) for (const [k, o] of Object.entries(byCalendarDate(s))) { const v = pick(o, ['totalSteps', 'steps', 'stepCount']); if (v != null && d(k).steps == null) d(k).steps = Math.round(v); } for (const [day, h] of rd.map((x, i) => [x, hrs[i]])) { const v = h && !h.__error ? pick(h, ['restingHeartRate', 'restingHeartRateValue']) : undefined; if (v && d(day).rhr == null) d(day).rhr = v; }
  const list = Array.isArray(acts) ? acts : (acts && (acts.activityList || acts.activities)) || [];
  const workouts = list.map(a => ({ src: 'Garmin', id: 'garmin-' + a.activityId, date: String(a.startTimeLocal || a.startTimeGMT || '').slice(0, 10),
    name: a.activityName || titleCase(a.activityType && a.activityType.typeKey || 'Activity'), type: a.activityType && a.activityType.typeKey || null,
    start: a.startTimeLocal || null, min: a.duration ? Math.round(a.duration / 60) : null, kcal: a.calories ? Math.round(a.calories) : null,
    avgHr: a.averageHR || null, maxHr: a.maxHR || null, sets: a.totalSets || a.activeSets || null, reps: a.totalReps || null, zones: a.hrTimeInZone_1 != null ? [0, 1, 2, 3, 4, 5].map(i => i ? Math.round((a['hrTimeInZone_' + i] || 0) / 60) : 0) : null, mi: a.distance ? r1(a.distance / 1609.34) : null, elev: a.elevationGain ? Math.round(a.elevationGain * 3.281) : null, te: a.aerobicTrainingEffect ? r1(a.aerobicTrainingEffect) : null, steps: a.steps || null })).filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w.date));
  const errors = Object.entries({ summaries: sum, sleep: slp, hrv, bodyBattery: bb, activities: acts, weight: wt, steps: st1 }).filter(([, v]) => v && v.__error).map(([k, v]) => k + ': ' + v.__error);
  return { days: clean(byDay), workouts, errors };
}

function clean(byDay) {
  for (const o of Object.values(byDay)) for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return byDay;
}
async function syncUser(user, env, days) {
  const out = { at: Date.now(), days, whoop: null, garmin: null, oura: null, errors: [] };
  if (user.whoop?.refresh) { try { out.whoop = await syncWhoop(user, env, days); } catch (e) { out.errors.push('WHOOP: ' + e.message); } }
  if (user.oura?.refresh) { try { out.oura = await syncOura(user, env, days); if (out.oura.errors.length) out.errors.push(...out.oura.errors.map(x => 'Oura: ' + x)); } catch (e) { out.errors.push('Oura: ' + e.message); } }
  if (user.garmin?.key) { try { out.garmin = await syncGarmin(user, env, days); if (out.garmin.errors.length) out.errors.push(...out.garmin.errors.map(x => 'Garmin ' + x)); await saveUser(env, user); } catch (e) { out.errors.push('Garmin: ' + e.message); } }
  return out;
}
async function rawSample(user, env, day) {
  const out = {};
  if (user.garmin?.key) {
    const tok = await garminToken(user, env);
    const g = async (p, q) => { try { const j = await gget(tok, p, q); return JSON.stringify(j).slice(0, 1500); } catch (e) { return String(e.message); } };
    out.garmin = {
      summaries: await g('/usersummary-service/v2/dailysummaries', { startDate: day, endDate: day }),
      sleep: await g('/sleep-service/sleep/dailySleepSummariesByDate', { startDate: day, endDate: day }),
      hrv: await g(`/hrv-service/hrv/daily/${day}/${day}`),
    };
    await saveUser(env, user);
  }
  if (user.whoop?.refresh) {
    const a = await whoopAccess(user, env);
    const w = async (p) => { const r = await fetch(WHOOP_API + p + '?limit=1', { headers: { Authorization: 'Bearer ' + a } }); return (await r.text()).slice(0, 1500); };
    out.whoop = { recovery: await w('/recovery'), sleep: await w('/activity/sleep'), cycle: await w('/cycle'), workout: await w('/activity/workout') };
  }
  if (user.oura?.refresh) {
    const a = await ouraAccess(user, env);
    const o = async (k) => { const r = await fetch(OURA_API + '/' + k + '?start_date=' + day + '&end_date=' + day, { headers: { Authorization: 'Bearer ' + a } }); return (await r.text()).slice(0, 1500); };
    out.oura = { readiness: await o('daily_readiness'), sleep: await o('sleep'), activity: await o('daily_activity'), workout: await o('workout') };
  }
  return out;
}


/* ---------------- Friends & leaderboard ----------------
   Opt-in. Each person stores one record: soc:<uid>. Friends see only what that person chose to share. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SHARE_KEYS = ['streak', 'workouts', 'protein', 'steps', 'weight', 'meals', 'nutrition', 'foods', 'recovery', 'templates'];
const EVENT_SHARE = { workout: 'workouts', pr: 'workouts', protein: 'protein', streak: 'streak', steps: 'steps', weight: 'weight', day: 'meals', score: null };
const clampN = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; };
const cleanStr = (v, n) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
// Profile picture: a built-in character id, or a small square JPEG (data URL, under ~24 KB).
const cleanAv = (v) => typeof v === 'string' && (/^[a-z]{2,14}$/.test(v) || (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 24000)) ? v : null;
// Remember what each record looked like when read, so unchanged records are never re-written.
const SOC_SEEN = new WeakMap();
const socSig = (r) => { const { updated, ...rest } = r; return JSON.stringify(rest); };
async function socGet(env, uid) { const r = await env.MACROS_KV.get('soc:' + uid, 'json'); if (r) SOC_SEEN.set(r, socSig(r)); return r; }
async function socPut(env, rec) { if (SOC_SEEN.get(rec) === socSig(rec)) return; rec.updated = Date.now(); await env.MACROS_KV.put('soc:' + rec.uid, JSON.stringify(rec)); SOC_SEEN.set(rec, socSig(rec)); }
async function phoneKey(env, raw) {
  let d = String(raw || '').replace(/\D/g, ''); if (d.length === 10) d = '1' + d; if (d.length < 8 || d.length > 15) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PHONE_PEPPER || env.WHOOP_CLIENT_SECRET || 'syncope'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('phone:' + d));
  return { h: [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40), last4: d.slice(-4) };
}
const cleanUser = (v) => String(v || '').trim().replace(/^@/, '').toLowerCase();
function newCode() { const b = crypto.getRandomValues(new Uint8Array(6)); return [...b].map(x => CODE_CHARS[x % CODE_CHARS.length]).join(''); }
function publicView(r, forSelf) {
  const sh = r.share || {}, st = r.stats || {};
  const stats = { week: st.week, score: st.score || 0, days: st.days || 0 };
  if (forSelf || sh.streak) stats.streak = st.streak || 0;
  if (forSelf || sh.workouts) { stats.workouts = st.workouts || 0; stats.prs = st.prs || 0; }
  if (forSelf || sh.protein) stats.protein = st.protein || 0;
  if (forSelf || sh.steps) stats.steps = st.steps || 0;
  if (forSelf || sh.weight) stats.wchg = st.wchg ?? null;
  if (forSelf || sh.meals) stats.onTarget = st.onTarget || 0;
  const events = (r.events || []).filter(e => forSelf || EVENT_SHARE[e.type] === null || sh[EVENT_SHARE[e.type]]).slice(0, 15)
    .map(e => ({ ...e, cheers: ((r.cheers || {})[e.id] || []).map(c => c.name) }));
  const dt = r.detail || {}, on = k => forSelf || sh[k];
  const daily = (dt.daily || []).map(x => {
    const o = { d: x.d };
    if (on('nutrition')) Object.assign(o, { k: x.k, p: x.p, c: x.c, f: x.f, gk: x.gk, gp: x.gp, gc: x.gc, gf: x.gf, n: x.n });
    if (on('steps')) o.steps = x.steps;
    if (on('recovery')) Object.assign(o, { sleep: x.sleep, rec: x.rec, hrv: x.hrv, rhr: x.rhr, strain: x.strain });
    if (on('weight')) o.w = x.w; if (forSelf || sh.water !== false) Object.assign(o, { ho: x.ho, ht: x.ht, na: x.na });
    return o;
  });
  const detail = { daily, foods: on('foods') ? (dt.foods || []) : null, wks: on('workouts') ? (dt.wks || []) : null, tpls: (forSelf || sh.templates !== false) ? (dt.tpls || []) : null, plan: on('nutrition') ? dt.plan : null, shares: Object.fromEntries(SHARE_KEYS.map(k => [k, k === 'templates' ? sh[k] !== false : !!sh[k]])) };
  return { uid: r.uid, name: r.name, username: r.username, color: r.color, av: r.av || null, stats, events, detail, updated: r.updated };
}
async function social(action, req, url, user, env, cors) {
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  let me = await socGet(env, user.id);
  if (action === 'profile') {
    const name = cleanStr(body.name, 24);
    if (!name) return json({ error: 'Add a name your friends will recognize.' }, 400, cors);
    if (!me) {
      let code; for (let i = 0; i < 6; i++) { code = newCode(); if (!(await env.MACROS_KV.get('code:' + code))) break; }
      me = { uid: user.id, code, friends: [], events: [], cheers: {}, stats: {} };
      await env.MACROS_KV.put('code:' + code, user.id);
    }
    if (body.username !== undefined) {
      const un = cleanUser(body.username);
      if (!/^[a-z0-9_.]{3,20}$/.test(un)) return json({ error: 'Usernames are 3–20 letters, numbers, dots or underscores.' }, 400, cors);
      if (un !== me.username) {
        const owner = await env.MACROS_KV.get('un:' + un);
        if (owner && owner !== me.uid) return json({ error: `@${un} is taken. Try another.` }, 409, cors);
        await env.MACROS_KV.put('un:' + un, me.uid); if (me.username) await env.MACROS_KV.delete('un:' + me.username); me.username = un;
      }
    }
    if (body.phone !== undefined) {
      if (!String(body.phone).trim()) { if (me.ph) await env.MACROS_KV.delete('ph:' + me.ph); delete me.ph; delete me.phLast4; }
      else {
        const pk = await phoneKey(env, body.phone); if (!pk) return json({ error: 'That phone number doesn’t look right.' }, 400, cors);
        if (pk.h !== me.ph) {
          const owner = await env.MACROS_KV.get('ph:' + pk.h);
          if (owner && owner !== me.uid) return json({ error: 'That number is already linked to another Trainer account.' }, 409, cors);
          await env.MACROS_KV.put('ph:' + pk.h, me.uid); if (me.ph) await env.MACROS_KV.delete('ph:' + me.ph); me.ph = pk.h; me.phLast4 = pk.last4;
        }
      }
    }
    me.name = name; me.color = cleanStr(body.color, 9) || '#C7B6FF';
    if (body.share || !me.share) me.share = Object.fromEntries(SHARE_KEYS.map(k => [k, k === 'templates' ? (body.share || {})[k] !== false : !!(body.share || {})[k]]));
    await socPut(env, me);
    return json({ code: me.code, share: me.share, name: me.name, username: me.username, phoneLast4: me.phLast4 || null }, 200, cors);
  }
  if (!me) return json({ error: 'Set up your Trainer profile first.' }, 400, cors);
  if (action === 'stats') {
    if (body.av !== undefined) me.av = cleanAv(body.av);
    const st = body.stats || {};
    me.stats = { week: cleanStr(st.week, 10), score: clampN(st.score, 0, 5000), streak: clampN(st.streak, 0, 3650), workouts: clampN(st.workouts, 0, 50), prs: clampN(st.prs, 0, 200),
      protein: clampN(st.protein, 0, 7), steps: clampN(st.steps, 0, 2e6), onTarget: clampN(st.onTarget, 0, 7), days: clampN(st.days, 0, 7), wchg: st.wchg == null ? null : clampN(st.wchg, -30, 30) };
    const types = Object.keys(EVENT_SHARE);
    me.events = (Array.isArray(body.events) ? body.events : []).filter(e => e && types.includes(e.type)).slice(0, 20)
      .map(e => ({ id: cleanStr(e.id, 40), type: e.type, date: cleanStr(e.date, 10), t: clampN(e.t, 0, 9e15), n: clampN(e.n, -1e6, 1e6), s: cleanStr(e.s, 40) }));
    const D = body.detail || {}, num = (v, hi) => v == null || v === '' ? null : clampN(v, -1e5, hi);
    me.detail = {
      daily: (Array.isArray(D.daily) ? D.daily : []).slice(0, 7).map(x => ({ d: cleanStr(x.d, 10), k: num(x.k, 2e4), p: num(x.p, 2e3), c: num(x.c, 3e3), f: num(x.f, 2e3), gk: num(x.gk, 2e4), gp: num(x.gp, 2e3), gc: num(x.gc, 3e3), gf: num(x.gf, 2e3), n: num(x.n, 500),
        steps: num(x.steps, 2e5), sleep: num(x.sleep, 24), rec: num(x.rec, 100), hrv: num(x.hrv, 400), rhr: num(x.rhr, 250), strain: num(x.strain, 21), w: num(x.w, 1500), ho: num(x.ho, 2000), ht: num(x.ht, 2000), na: num(x.na, 2e4) })),
      foods: (Array.isArray(D.foods) ? D.foods : []).slice(0, 40).map(x => ({ n: cleanStr(x.n, 40), a: cleanStr(x.a, 24), m: cleanStr(x.m, 10), k: num(x.k, 5e3), p: num(x.p, 500), c: num(x.c, 800), f: num(x.f, 500) })),
      wks: (Array.isArray(D.wks) ? D.wks : []).slice(0, 10).map(x => ({ name: cleanStr(x.name, 40), d: cleanStr(x.d, 10), min: num(x.min, 600), sets: num(x.sets, 300), vol: num(x.vol, 1e6), prs: num(x.prs, 50), kcal: num(x.kcal, 5e3), strain: num(x.strain, 21), src: cleanStr(x.src, 10),
        ex: (Array.isArray(x.ex) ? x.ex : []).slice(0, 12).map(e => ({ n: cleanStr(e.n, 40), top: cleanStr(e.top, 20), sets: num(e.sets, 50) })) })),
      tpls: (Array.isArray(D.tpls) ? D.tpls : []).slice(0, 30).map(t => ({ name: cleanStr(t.name, 40), ex: (Array.isArray(t.ex) ? t.ex : []).slice(0, 20).map(e => ({ n: cleanStr(e.n, 40), m: cleanStr(e.m, 24), eq: cleanStr(e.eq, 16), s: cleanStr(e.s, 16) })) })).filter(t => t.name && t.ex.length),
      plan: cleanStr(D.plan, 40) };
    const keep = new Set(me.events.map(e => e.id)); me.cheers = Object.fromEntries(Object.entries(me.cheers || {}).filter(([k]) => keep.has(k)));
    await socPut(env, me);
    return json({ ok: true }, 200, cors);
  }
  if (action === 'add') {
    const q = String(body.q ?? body.code ?? '').trim();
    let fid = null, via = 'code';
    const digits = q.replace(/\D/g, '');
    if (/^[+()\d\s.-]+$/.test(q) && digits.length >= 7) { const pk = await phoneKey(env, q); fid = pk && await env.MACROS_KV.get('ph:' + pk.h); via = 'phone'; }
    else if (q.startsWith('@')) { fid = await env.MACROS_KV.get('un:' + cleanUser(q)); via = 'username'; }
    else {
      if (/^[A-Za-z0-9]{6}$/.test(q)) fid = await env.MACROS_KV.get('code:' + q.toUpperCase());
      if (!fid) { fid = await env.MACROS_KV.get('un:' + cleanUser(q)); via = 'username'; }
    }
    if (!fid) return json({ error: via === 'phone' ? 'No one on Trainer Friends has that number yet. Send them an invite instead.' : via === 'username' ? 'No one has that username.' : 'No one has that code. Check it and try again.' }, 404, cors);
    if (fid === me.uid) return json({ error: 'That’s you.' }, 400, cors);
    const fr = await socGet(env, fid); if (!fr) return json({ error: 'That person left Trainer Friends.' }, 404, cors);
    if ((me.friends || []).includes(fid)) return json({ ok: true, already: true, name: fr.name }, 200, cors);
    if ((me.friends || []).length >= 50) return json({ error: 'You can have up to 50 friends.' }, 400, cors);
    const theyAsked = (me.reqs || {})[fid];
    if (via === 'code' || theyAsked) {
      me.friends = [...new Set([...(me.friends || []), fid])]; fr.friends = [...new Set([...(fr.friends || []), me.uid])];
      if (me.reqs) delete me.reqs[fid]; await socPut(env, me); await socPut(env, fr);
      return json({ ok: true, name: fr.name }, 200, cors);
    }
    fr.reqs = fr.reqs || {}; fr.reqs[me.uid] = { name: me.name, username: me.username || '', color: me.color, av: me.av || null, t: Date.now() };
    await env.MACROS_KV.put('soc:' + fr.uid, JSON.stringify(fr));
    return json({ ok: true, requested: true, name: fr.name }, 200, cors);
  }
  if (action === 'accept' || action === 'decline') {
    const fid = cleanStr(body.uid, 64); const req0 = (me.reqs || {})[fid]; if (!req0) return json({ error: 'That request is gone.' }, 404, cors);
    delete me.reqs[fid];
    if (action === 'accept') { const fr = await socGet(env, fid); if (fr) { me.friends = [...new Set([...(me.friends || []), fid])]; fr.friends = [...new Set([...(fr.friends || []), me.uid])]; await socPut(env, fr); } }
    await socPut(env, me); return json({ ok: true }, 200, cors);
  }
  if (action === 'remove') {
    const fid = cleanStr(body.uid, 64); me.friends = (me.friends || []).filter(x => x !== fid); await socPut(env, me);
    const fr = await socGet(env, fid); if (fr) { fr.friends = (fr.friends || []).filter(x => x !== me.uid); await socPut(env, fr); }
    return json({ ok: true }, 200, cors);
  }
  if (action === 'cheer') {
    const fid = cleanStr(body.to, 64), id = cleanStr(body.id, 40);
    if (!(me.friends || []).includes(fid)) return json({ error: 'Not your friend.' }, 403, cors);
    const fr = await socGet(env, fid); if (!fr) return json({ error: 'Not found' }, 404, cors);
    fr.cheers = fr.cheers || {}; const list = fr.cheers[id] || [];
    if (!list.some(c => c.uid === me.uid)) list.push({ uid: me.uid, name: me.name, t: Date.now() });
    fr.cheers[id] = list.slice(-30); await env.MACROS_KV.put('soc:' + fr.uid, JSON.stringify(fr));
    return json({ ok: true }, 200, cors);
  }
  if (action === 'board') {
    const friends = (await Promise.all((me.friends || []).map(id => socGet(env, id)))).filter(Boolean);
    const reqs = Object.entries(me.reqs || {}).map(([uid, r]) => ({ uid, ...r })).sort((a, b) => b.t - a.t);
    return json({ me: { ...publicView(me, true), code: me.code, share: me.share, phoneLast4: me.phLast4 || null }, friends: friends.map(f => publicView(f, false)), reqs }, 200, cors);
  }
  if (action === 'leave') {
    for (const id of me.friends || []) { const fr = await socGet(env, id); if (fr) { fr.friends = (fr.friends || []).filter(x => x !== me.uid); await socPut(env, fr); } }
    await env.MACROS_KV.delete('code:' + me.code); await env.MACROS_KV.delete('soc:' + me.uid);
    if (!(await env.MACROS_KV.get('pw:' + me.uid))) { if (me.username) await env.MACROS_KV.delete('un:' + me.username); if (me.ph) await env.MACROS_KV.delete('ph:' + me.ph); }
    return json({ ok: true }, 200, cors);
  }
  return json({ error: 'Not found' }, 404, cors);
}

/* ---------------- Teams (coach + player sharing, v1) ---------------- */
async function team(action, req, url, env, cors) { const KV = env.MACROS_KV, G = (k) => KV.get(k, 'json'), P = (k, v) => KV.put(k, JSON.stringify(v)), D = (k) => KV.delete(k); const SPORTS = ['Football', 'Basketball', 'Soccer', 'Baseball', 'Softball', 'Track & Field', 'Wrestling', 'Swimming', 'Volleyball', 'Lacrosse', 'Hockey', 'Other']; const ROLES = ['Head coach', 'Strength & conditioning', 'Nutritionist/dietitian', 'Position coach', 'Athletic trainer']; const link = (c) => 'https://brianmirandaa4-dotcom.github.io/macros/?team=' + c; const ip = req.headers.get('CF-Connecting-IP') || (req.headers.get('X-Forwarded-For') || '').split(',')[0].trim() || 'ip'; const no = (m, s, x) => json({ error: m, ...(x || {}) }, s, cors), ok = (o) => json(o, 200, cors); const rlN = async (k) => +((await KV.get('rl:' + k)) || 0), rlHit = (k, n) => KV.put('rl:' + k, String(n + 1), { expirationTtl: 900 }); const BAN = /sleep|recov|hrv|rhr|strain|whoop|oura|garmin|health|^hk|spo2|skin|resp|stress|battery|steps|readiness|wear|heart|^(avg|max|min|rest)?hr$|zones|chat/i; const scrub = (v, d) => { if (d > 6) return null; if (Array.isArray(v)) return v.slice(0, 500).map((x) => scrub(x, d + 1)); if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !BAN.test(k)).slice(0, 60).map(([k, x]) => [cleanStr(k, 40), scrub(x, d + 1)])); if (typeof v === 'string') return cleanStr(v, 200); if (typeof v === 'number') return Number.isFinite(v) ? v : null; if (typeof v === 'boolean') return v; return null; }; const cleanSet = (s, sport, old) => { s = s || {}; old = old || {}; const wd = Array.isArray(s.weighDays) ? s.weighDays : (old.weighDays || [1, 2, 3, 4, 5]); return { meals: Math.round(clampN(s.meals ?? old.meals ?? 4, 1, 8)) || 4, weighDays: [...new Set(wd.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b), weighBy: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.weighBy || '') ? s.weighBy : (old.weighBy || '10:00'), prePost: typeof s.prePost === 'boolean' ? s.prePost : (typeof old.prePost === 'boolean' ? old.prePost : sport === 'Football') }; }; const pub = (t) => ({ id: t.id, name: t.name, school: t.school, sport: t.sport, coachName: t.coach.name, coachRole: t.coach.role, roster: t.roster, settings: t.settings, size: (t.members || []).length }); const nameOf = async (u) => { const s = await G('soc:' + u); const pw = s && s.username ? null : await G('pw:' + u); return { name: (s && s.name) || '', username: (s && s.username) || (pw && pw.un) || '' }; }; const byCode = async (c) => { c = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const tid = /^[A-Z0-9]{6}$/.test(c) ? await KV.get('teamcode:' + c) : null; return tid ? G('team:' + tid) : null; }; const freshCode = async () => { let c; for (let i = 0; i < 8; i++) { c = newCode(); if (!(await KV.get('teamcode:' + c))) break; } return c; }; const drop = async (u, tid) => { const t = await G('team:' + tid); if (t && (t.members || []).includes(u)) { t.members = t.members.filter((x) => x !== u); await P('team:' + tid, t); } const m = await G('tm:' + u); if (m && m.team === tid) await D('tm:' + u); await D('tmd:' + u); return t; }; const GET = req.method === 'GET', POST = req.method === 'POST'; if (action === 'lookup' && GET) { const n = await rlN('tip:' + ip); if (n >= 20) return no('Too many tries. Wait 15 minutes and try again.', 429); const t = await byCode(url.searchParams.get('code')); if (!t) { await rlHit('tip:' + ip, n); return no('No team has that code. Check it with your coach.', 404); } return ok({ name: t.name, school: t.school, sport: t.sport, coachName: t.coach.name, coachRole: t.coach.role }); } const user = await authUser(req, env); if (!user) return no('Not signed in to the sync server. Reconnect in Trainer.', 401); const uid = user.id, b = POST || req.method === 'PUT' ? (action === 'push' ? null : await req.json().catch(() => ({}))) : {}; const hasAcct = !!(await KV.get('pw:' + uid)), ctid = await KV.get('tco:' + uid), mine = ctid ? await G('team:' + ctid) : null; if (action === 'create' && POST) { if (!hasAcct) return no('Create a Trainer account (username and password) first.', 403, { needAccount: true }); if (mine) return no('You already coach a team.', 409, { code: mine.code }); if (await KV.get('tm:' + uid)) return no('Coach accounts are coach-only. Leave your team first.', 409); const name = cleanStr(b.name, 40), coachName = cleanStr(b.coachName, 40); if (!name) return no('Add your team name.', 400); if (!coachName) return no('Add your name.', 400); const sport = SPORTS.includes(b.sport) ? b.sport : 'Other', code = await freshCode(), id = rand(8); const t = { id, code, name, school: cleanStr(b.school, 60), sport, coach: { uid, name: coachName, role: ROLES.includes(b.role) ? b.role : 'Head coach' }, roster: Math.round(clampN(b.roster, 1, 300)) || null, settings: cleanSet(b.settings, sport), created: Date.now(), members: [] }; await P('team:' + id, t); await KV.put('teamcode:' + code, id); await KV.put('tco:' + uid, id); return ok({ team: pub(t), code, link: link(code) }); } if (action === 'join' && POST) { if (!hasAcct) return no('Create a Trainer account (username and password) first.', 403, { needAccount: true }); if (mine) return no('Coach accounts can’t join a team as a player.', 409); if (b.adult !== true || b.consent !== true) return no('Confirm you’re 18 or older and agree to share with your coaches.', 400); const nu = await rlN('tu:' + uid), ni = await rlN('tip:' + ip); if (nu >= 10 || ni >= 20) return no('Too many tries. Wait 15 minutes and try again.', 429); const t = await byCode(b.code); if (!t) { await rlHit('tu:' + uid, nu); await rlHit('tip:' + ip, ni); return no('No team has that code. Check it with your coach.', 404); } const cur = await G('tm:' + uid); if (cur && cur.team !== t.id) await drop(uid, cur.team); if (!(t.members || []).includes(uid)) { if ((t.members || []).length >= 300) return no('This team is full.', 409); t.members = [...(t.members || []), uid]; await P('team:' + t.id, t); } await P('tm:' + uid, { team: t.id, joined: cur && cur.team === t.id ? cur.joined : Date.now(), consent: { at: Date.now(), adult: true } }); return ok({ team: pub(t) }); } if (action === 'leave' && POST) { const m = await G('tm:' + uid); if (!m) { await D('tmd:' + uid); return ok({ ok: true, none: true }); } await drop(uid, m.team); return ok({ ok: true }); } if (action === 'push' && POST) { if (+(req.headers.get('Content-Length') || 0) > 200000) return no('Team update too large.', 413); const raw = await req.text(); if (new TextEncoder().encode(raw).length > 200000) return no('Team update too large.', 413); const m = await G('tm:' + uid); if (!m) return no('Not on a team.', 403, { noTeam: true }); const t = await G('team:' + m.team); if (!t) { await D('tm:' + uid); await D('tmd:' + uid); return no('Not on a team.', 403, { noTeam: true }); } if (!(t.members || []).includes(uid)) { t.members = [...(t.members || []), uid]; await P('team:' + t.id, t); } let x; try { x = JSON.parse(raw); } catch (e) { return no('Bad team update.', 400); } x = x || {}; const at = Date.now(); await P('tmd:' + uid, { at, days: scrub(Array.isArray(x.days) ? x.days.slice(0, 31) : [], 0), weighIns: scrub(x.weighIns && typeof x.weighIns === 'object' ? x.weighIns : {}, 0), meals: x.meals == null ? null : scrub(x.meals, 0) }); return ok({ ok: true, at }); } if (action === 'me' && GET) { if (mine) { const roster = await Promise.all((mine.members || []).map(async (m) => { const [d, nm, tm] = await Promise.all([G('tmd:' + m), nameOf(m), G('tm:' + m)]); return { uid: m, ...nm, joined: tm ? tm.joined : null, at: d ? d.at : null, days: d && Array.isArray(d.days) ? d.days.map((y) => y && typeof y === 'object' ? Object.fromEntries(Object.entries(y).filter(([, v]) => !Array.isArray(v))) : y) : [], weighIns: (d && d.weighIns) || {} }; })); return ok({ role: 'coach', team: { ...pub(mine), code: mine.code, link: link(mine.code), created: mine.created }, settings: mine.settings, roster }); } const m = await G('tm:' + uid); const t = m ? await G('team:' + m.team) : null; if (m && !t) { await D('tm:' + uid); await D('tmd:' + uid); } if (t) { const d = await G('tmd:' + uid); return ok({ role: 'player', team: pub(t), settings: t.settings, joined: m.joined, consent: m.consent, lastPush: d ? d.at : null }); } return ok({ role: null, hasAccount: hasAcct }); } if (!mine) return no('Only the team’s coach can do that.', 403); if (action === 'player' && GET) { const f = cleanStr(url.searchParams.get('uid'), 64); if (!(mine.members || []).includes(f)) return no('That athlete isn’t on your team.', 404); const [d, nm, tm] = await Promise.all([G('tmd:' + f), nameOf(f), G('tm:' + f)]); return ok({ uid: f, ...nm, joined: tm ? tm.joined : null, data: d || null }); } if (action === 'settings' && (req.method === 'PUT' || POST)) { if (b.name !== undefined) { const n = cleanStr(b.name, 40); if (!n) return no('Add your team name.', 400); mine.name = n; } if (b.school !== undefined) mine.school = cleanStr(b.school, 60); if (SPORTS.includes(b.sport)) mine.sport = b.sport; if (b.coachName !== undefined && cleanStr(b.coachName, 40)) mine.coach.name = cleanStr(b.coachName, 40); if (ROLES.includes(b.role)) mine.coach.role = b.role; if (b.roster !== undefined) mine.roster = Math.round(clampN(b.roster, 1, 300)) || null; mine.settings = cleanSet(b.settings || {}, mine.sport, mine.settings); await P('team:' + mine.id, mine); return ok({ team: pub(mine), settings: mine.settings }); } if (action === 'remove' && POST) { const f = cleanStr(b.uid, 64); if (!(mine.members || []).includes(f)) return no('That athlete isn’t on your team.', 404); const t = await drop(f, mine.id); return ok({ ok: true, size: ((t || mine).members || []).length }); } if (action === 'code' && POST) { await D('teamcode:' + mine.code); mine.code = await freshCode(); await KV.put('teamcode:' + mine.code, mine.id); await P('team:' + mine.id, mine); return ok({ code: mine.code, link: link(mine.code) }); } return no('Not found', 404); }
