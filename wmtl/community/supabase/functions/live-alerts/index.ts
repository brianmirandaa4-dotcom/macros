// tail. live-alerts: the in-game model on the server. Called every minute by pg_cron during game windows.
// When a NEW "BET NOW" trigger appears (same rule as liveNowHTML in app.js), it sends a Web Push to every enabled push_subs row.
// Secrets (Edge Function secrets, never in the app or repo): VAPID_PRIVATE_KEY (base64url d), VAPID_PUBLIC_KEY (base64url, 65 bytes), VAPID_SUBJECT.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
// Body: {} = normal run (needs x-cron-secret, checked against Vault through public.live_alerts_auth)
//       {"dry_run": true} = compute and log triggers, send nothing, write nothing
//       {"test_push": true, "user_id": "<uuid>"} = send one test notification (needs x-cron-secret)

const APP = 'https://brianmirandaa4-dotcom.github.io/macros/wmtl/';
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ---------------------------------------------------------------- helpers (same as app.js)
const isNum = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
const nkey = (s: string) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|iii|ii|iv)$/, '').trim();
const ln = (x: number) => isNum(x) ? (Math.round(x * 10) / 10).toString() : '—';
const od = (o: number) => isNum(o) ? (o > 0 ? '+' : '-') + Math.abs(Math.round(o)) : '—';
const ESPN_AB: Record<string, string> = {WSH: 'WAS', LAR: 'LA', JAC: 'JAX'};
const ab = (a: string) => ESPN_AB[a] || a;
const AN_TYPES: Record<string, string> = {core_bet_type_9_passing_yards: 'pass_yds', core_bet_type_12_rushing_yards: 'rush_yds', core_bet_type_15_receptions: 'receptions', core_bet_type_16_receiving_yards: 'rec_yds'};
const SK: Record<string, string> = {qb_rush: 'rush_yds', rush_yds: 'rush_yds', rec_yds: 'rec_yds', receptions: 'receptions', pass_yds: 'pass_yds'};
const SHORT: Record<string, string> = {receptions: 'rec', rec_yds: 'rec yds'};
async function getJSON(u: string) { const r = await fetch(u, {headers: {'User-Agent': 'tail-live-alerts/1', Accept: 'application/json'}}); if (!r.ok) throw new Error(`${u.split('?')[0]}: ${r.status}`); return r.json(); }

// ---------------------------------------------------------------- in-game model: exact port of app.js liveQ / qOver / BKT / LMK (live_params v1 and v2)
// deno-lint-ignore no-explicit-any
let LP: any = null;
const LMK = (m: string) => m === 'qb_rush' ? 'rush_yds' : m;
// score buckets come from live_params.json (v2: 11 states in 7s to +/-35); v1 files fall back to the 5-bucket rule
const BKT1: [number, number, string][] = [[-999, -14, 'down14'], [-13, -7, 'down7'], [-6, 6, 'close'], [7, 13, 'up7'], [14, 999, 'up14']];
const BKT = (d: number) => { const e = ((LP && LP.buckets) || BKT1).find(([lo, hi]: [number, number]) => d >= lo && d <= hi); return e ? e[2] : 'close'; };
// deno-lint-ignore no-explicit-any
function liveQ(p: any, soFar: number, f: number, diff: number) { const M = LP && LP.markets[LMK(p.market)]; if (!M || !M.validated || !isNum(p.projection)) return null;
  const pre = p.projection, r = 1 - f, pace = soFar / Math.max(f, .1), b = BKT(diff), B = M.beta; const ind = (k: string) => b === k ? 1 : 0;
  // x order = LP.feature_order: [pre*r, pace*r, r] then each bucket term x each non-close bucket (v2 adds r2 = r*r and pre*r2)
  const tv: Record<string, number> = {r, 'pre*r': pre * r, r2: r * r, 'pre*r2': pre * r * r}, bn = (LP.buckets || BKT1).map((e: [number, number, string]) => e[2]).filter((k: string) => k !== 'close');
  const x = [pre * r, pace * r, r]; for (const t of (LP.version >= 2 ? LP.bucket_terms : ['r', 'pre*r'])) for (const k of bn) x.push(tv[t] * ind(k));
  if (x.length !== B.length) return null;
  const rem = Math.max(.05, x.reduce((a: number, v: number, i: number) => a + v * B[i], 0)); const T = (1 - f) * 3600;
  const g = String(LP.snapshots_seconds_remaining.reduce((a: number, s: number) => Math.abs(s - T) < Math.abs(a - T) ? s : a)); const zq = M.zq[g];
  return {q: zq.map((z: number) => soFar + Math.max(0, rem + z * Math.sqrt(Math.max(rem, .25)))), k: M.k}; }
function qOver(Q: {q: number[], k: number}, line: number) { const L = LP.quantile_levels; const q = Q.q.slice(); for (let i = 1; i < q.length; i++) q[i] = Math.max(q[i], q[i - 1]);
  let F; if (line < q[0]) F = 0; else if (line >= q[q.length - 1]) F = 1; else { let i = 0; while (q[i + 1] <= line) i++; F = q[i + 1] === q[i] ? L[i + 1] : L[i] + (L[i + 1] - L[i]) * (line - q[i]) / (q[i + 1] - q[i]); }
  const p = Math.min(.99, Math.max(.01, 1 - F)); const lgt = Math.log(p / (1 - p)); return 1 / (1 + Math.exp(-Q.k * lgt)); }

// ---------------------------------------------------------------- Supabase REST with the service role (server only)
async function rest(path: string, init: RequestInit = {}) { const r = await fetch(SB + '/rest/v1/' + path, {...init, headers: {apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json', ...(init.headers || {})}});
  const t = await r.text(); if (!r.ok) throw new Error(`rest ${path.split('?')[0]}: ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }

// ---------------------------------------------------------------- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) with WebCrypto
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const te = new TextEncoder();
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt, info}, k, len * 8)); }
let VKEY: CryptoKey | null = null;
async function vapidKey() { if (VKEY) return VKEY; const pub = unb64u(Deno.env.get('VAPID_PUBLIC_KEY')!);
  VKEY = await crypto.subtle.importKey('jwk', {kty: 'EC', crv: 'P-256', d: Deno.env.get('VAPID_PRIVATE_KEY')!, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true}, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']); return VKEY; }
async function vapidJWT(aud: string) { const h = b64u(te.encode(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const c = b64u(te.encode(JSON.stringify({aud, exp: Math.floor(Date.now() / 1000) + 3600, sub: Deno.env.get('VAPID_SUBJECT') || APP})));
  const sig = new Uint8Array(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, await vapidKey(), te.encode(h + '.' + c))); return `${h}.${c}.${b64u(sig)}`; }
async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const ua = unb64u(p256dh), sec = unb64u(auth);
  const eph = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: uaKey}, eph.privateKey, 256));
  const ikm = await hkdf(sec, shared, cat(te.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, key, cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct); }
// deno-lint-ignore no-explicit-any
async function sendPush(sub: any, msg: object) { const body = await encrypt(te.encode(JSON.stringify(msg)), sub.p256dh, sub.auth);
  const aud = new URL(sub.endpoint).origin;
  const r = await fetch(sub.endpoint, {method: 'POST', body, headers: {Authorization: `vapid t=${await vapidJWT(aud)}, k=${Deno.env.get('VAPID_PUBLIC_KEY')}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '1800', Urgency: 'high'}});
  await r.body?.cancel(); return r.status; }
// deno-lint-ignore no-explicit-any
async function fanout(subs: any[], msg: object) { let ok = 0, gone = 0, fail = 0;
  await Promise.all(subs.map(async s => { try { const st = await sendPush(s, msg); if (st >= 200 && st < 300) ok++; else if (st === 404 || st === 410) { gone++; await rest(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {method: 'DELETE'}); } else { fail++; console.log('push status', st, new URL(s.endpoint).host); } } catch (e) { fail++; console.log('push error', String(e)); } }));
  return {ok, gone, fail}; }

// ---------------------------------------------------------------- slates and live data
// deno-lint-ignore no-explicit-any
const SLATES: Record<string, any> = {};
async function liveSlates(now: number) { const idx = await getJSON(APP + 'data/index.json');
  // deno-lint-ignore no-explicit-any
  const on = (idx.slates || []).filter((s: any) => s.sport === 'NFL' && s.start_utc && Date.parse(s.start_utc) - 20 * 60e3 <= now && now <= Date.parse(s.end_utc || s.start_utc) + 5.5 * 3600e3);
  for (const s of on) { const k = s.path + '|' + s.built_utc + '|' + idx.built_utc; if (!SLATES[s.id] || SLATES[s.id]._k !== k) { const d = await getJSON(APP + s.path); d._k = k; SLATES[s.id] = d; } }
  // deno-lint-ignore no-explicit-any
  return on.map((s: any) => SLATES[s.id]); }

// deno-lint-ignore no-explicit-any
async function evaluate(slates: any[]) {
  // deno-lint-ignore no-explicit-any
  const out: any = {games: [], triggers: [], err: null};
  const sb = await getJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'); if (!Array.isArray(sb.events)) throw new Error('ESPN scoreboard schema changed');
  // deno-lint-ignore no-explicit-any
  const games: any[] = [];
  for (const ev of sb.events) { const c = ev.competitions && ev.competitions[0]; if (!c) continue; const cs = c.competitors || []; const h = cs.find((x: {homeAway: string}) => x.homeAway === 'home'), a = cs.find((x: {homeAway: string}) => x.homeAway === 'away'); if (!h || !a) continue;
    const H = ab(h.team.abbreviation), A = ab(a.team.abbreviation);
    const per = c.status.period || 1, ck = String(c.status.displayClock || '15:00').split(':'); const el = Math.min(3600, (per - 1) * 900 + (900 - ((+ck[0] || 0) * 60 + (+ck[1] || 0))));
    games.push({id: ev.id, state: c.status.type.state, detail: c.status.type.shortDetail, away: A, home: H, as: +a.score || 0, hs: +h.score || 0, f: per > 4 ? 1 : Math.max(0, el / 3600)}); }
  // each live game, matched to the modeled slate that holds it
  // deno-lint-ignore no-explicit-any
  const live = games.filter(g => g.state === 'in').map(g => ({g, d: slates.find(d => d.games.some((x: any) => x.away.abbr === g.away && x.home.abbr === g.home) || d.games.some((x: any) => [x.away.abbr, x.home.abbr].some(t => t === g.away || t === g.home)))})).filter(x => x.d);
  out.games = live.map(({g}) => `${g.away} ${g.as} @ ${g.home} ${g.hs} · ${g.detail}`);
  if (!live.length) return out;
  LP = await getJSON(APP + 'data/nfl/live_params.json'); // re-read every live run so a new version (v1 -> v2) takes effect at once
  // box score stats
  const stats: Record<string, Record<string, number>> = {};
  for (const {g} of live) { const sm = await getJSON('https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=' + g.id); const bs = (sm.boxscore || {}).players; if (!Array.isArray(bs)) continue;
    for (const t of bs) { const tm = ab(t.team.abbreviation); for (const st of t.statistics || []) { const L = st.labels || []; for (const at of st.athletes || []) { const k = nkey(at.athlete.displayName) + '|' + tm; const o = stats[k] = stats[k] || {};
      const v = (lab: string) => { const i = L.indexOf(lab); return i < 0 ? null : at.stats[i]; };
      if (st.name === 'passing') { const ca = String(v('C/ATT') || '0/0').split('/'); o.pass_yds = +v('YDS') || 0; o.cmp = +ca[0] || 0; o.att = +ca[1] || 0; }
      if (st.name === 'rushing') { o.rush_yds = +v('YDS') || 0; o.car = +v('CAR') || 0; }
      if (st.name === 'receiving') { o.rec_yds = +v('YDS') || 0; o.receptions = +v('REC') || 0; o.tgt = +v('TGTS') || 0; } } } } }
  // live consensus lines (Action Network), same parse as app.js
  // deno-lint-ignore no-explicit-any
  const lines: Record<string, any> = {};
  for (const wk of [...new Set(live.map(x => x.d.meta.week))]) for (const [t, mk] of Object.entries(AN_TYPES)) {
    const r = await getJSON(`https://api.actionnetwork.com/web/v2/scoreboard/nfl/markets?bookIds=68,69&customPickTypes=${t}&seasonType=reg&week=${wk}`);
    if (!r || typeof r.markets !== 'object') throw new Error('Action Network schema changed');
    // deno-lint-ignore no-explicit-any
    const P = Object.fromEntries((r.players || []).map((p: any) => [p.id, p])); const TM: Record<string, string> = {}; for (const g of r.games || []) for (const x of [g.home_team, g.away_team]) if (x) TM[x.id] = ab(x.abbr);
    // deno-lint-ignore no-explicit-any
    for (const [b, m] of Object.entries(r.markets as Record<string, any>)) for (const o of Object.values(m)) for (const arr of Object.values(o as Record<string, any[]>)) for (const x of arr) { const p = P[x.player_id]; if (!p) continue;
      const k = nkey(p.full_name) + '|' + (TM[p.team_id] || '') + '|' + mk; const e = lines[k] = lines[k] || {};
      const slot = x.is_live ? 'live' : (+b === 68 ? 'DK' : +b === 69 ? 'FD' : null); if (!slot) continue; const s_ = e[slot] = e[slot] || {}; s_.line = x.value; s_[x.side] = x.odds; } }
  // the BET NOW rule from liveNowHTML
  for (const {g, d} of live) {
    // deno-lint-ignore no-explicit-any
    const ps = d.props.filter((p: any) => (p.team === g.away || p.team === g.home) && isNum(p.line) && !p.no_prediction).map((p: any) => ({...p, _lm: null}));
    for (const p of ps) { const st = stats[nkey(p.player) + '|' + p.team] || {}; const sk = SK[p.market]; if (!sk) continue;
      const diff = p.team === g.home ? g.hs - g.as : g.as - g.hs; const Q = liveQ(p, st[sk] || 0, g.f, diff); if (!Q) continue;
      const L = (lines[nkey(p.player) + '|' + p.team + '|' + LMK(p.market)] || {}).live; const line = L ? L.line : p.line; const po = qOver(Q, line);
      const side = po >= .5 ? 'over' : 'under', ps_ = side === 'over' ? po : 1 - po; const price = L ? L[side] : null; const be_ = isNum(price) ? (price < 0 ? -price / (-price + 100) : 100 / (price + 100)) : null;
      p._lm = {p: ps_, side, line, price, be: be_, now: st[sk] || 0, edge: be_ == null ? null : ps_ - be_, bet: be_ != null && ['receptions', 'rec_yds'].includes(LMK(p.market)) && ps_ - be_ >= .05 && ps_ <= .75 && g.f < .95}; }
    // deno-lint-ignore no-explicit-any
    ps.sort((a: any, b: any) => ((b._lm && b._lm.bet) - (a._lm && a._lm.bet)) || ((b._lm ? b._lm.edge ?? -1 : -1) - (a._lm ? a._lm.edge ?? -1 : -1)));
    let kept = 0; for (const p of ps) { if (p._lm && p._lm.bet) { if (kept >= 5) p._lm.bet = false; else kept++; } }
    // deno-lint-ignore no-explicit-any
    const gm = d.games.find((x: any) => x.away.abbr === g.away && x.home.abbr === g.home);
    for (const p of ps) if (p._lm && p._lm.bet) { const lm = p._lm;
      out.triggers.push({prop_id: p.id, side: lm.side, line: lm.line, slate: d.id, gid: gm ? gm.id : p.gid, game: `${g.away} @ ${g.home}`, detail: g.detail,
        title: 'BET NOW · tail.', body: `${p.player} ${lm.side === 'under' ? 'Under' : 'Over'} ${ln(lm.line)} ${SHORT[LMK(p.market)] || p.market_label} — model ${Math.round(lm.p * 100)}% vs price ${Math.round(lm.be * 100)}% (live consensus ${od(lm.price)}) · ${g.away} @ ${g.home}, ${g.detail}`,
        model_p: +lm.p.toFixed(4), break_even: +lm.be.toFixed(4), price: lm.price, now: lm.now }); } }
  return out; }

// ---------------------------------------------------------------- handler
Deno.serve(async req => {
  const t0 = Date.now(); let body: Record<string, unknown> = {}; try { body = await req.json(); } catch { /* empty body */ }
  const dry = body.dry_run === true || new URL(req.url).searchParams.get('dry_run') === '1';
  const sec = req.headers.get('x-cron-secret') || '';
  const authed = sec ? await rest('rpc/live_alerts_auth', {method: 'POST', body: JSON.stringify({s: sec})}) === true : false;
  const j = (o: object, s = 200) => new Response(JSON.stringify(o, null, 1), {status: s, headers: {'Content-Type': 'application/json'}});
  if (!dry && !authed) return j({error: 'forbidden: normal runs need x-cron-secret; use {"dry_run": true} to test'}, 403);
  try {
    if (body.test_push) { const uid = String(body.user_id || ''); const subs = await rest(`push_subs?enabled=eq.true&select=endpoint,p256dh,auth${uid ? '&user_id=eq.' + encodeURIComponent(uid) : ''}`);
      const r = await fanout(subs, {title: 'BET NOW · tail.', body: 'Test alert: lock-screen BET NOW alerts are on for this iPhone.', url: APP + '#live', tag: 'tail-test'}); return j({test_push: true, subs: subs.length, ...r}); }
    const slates = await liveSlates(Date.now());
    if (!slates.length) { const o = {status: 'idle', reason: 'no NFL slate window open', ms: Date.now() - t0}; if (dry) console.log(JSON.stringify(o)); return j(o); }
    const ev = await evaluate(slates);
    if (!ev.games.length) return j({status: 'idle', reason: 'no modeled NFL game live', slates: slates.map(d => d.id), ms: Date.now() - t0});
    if (dry) { console.log('DRY RUN', JSON.stringify(ev.triggers)); return j({status: 'dry_run', games: ev.games, triggers: ev.triggers, ms: Date.now() - t0}); }
    let fresh: typeof ev.triggers = [];
    if (ev.triggers.length) { const ins = await rest('sent_alerts?on_conflict=prop_id,side,line', {method: 'POST', headers: {Prefer: 'resolution=ignore-duplicates,return=representation'},
      body: JSON.stringify(ev.triggers.map((t: {prop_id: string, side: string, line: number, body: string}) => ({prop_id: t.prop_id, side: t.side, line: t.line, body: t.body})))});
      const keys = new Set((ins || []).map((r: {prop_id: string, side: string, line: number}) => `${r.prop_id}|${r.side}|${+r.line}`)); fresh = ev.triggers.filter((t: {prop_id: string, side: string, line: number}) => keys.has(`${t.prop_id}|${t.side}|${+t.line}`)); }
    let sent = {ok: 0, gone: 0, fail: 0}, nsubs = 0;
    if (fresh.length) { const subs = await rest('push_subs?enabled=eq.true&select=endpoint,p256dh,auth'); nsubs = subs.length;
      for (const t of fresh) { const r = await fanout(subs, {title: t.title, body: t.body, url: `${APP}?alert=${encodeURIComponent(t.slate + '|' + t.gid)}#live`, slate: t.slate, gid: t.gid, tag: `${t.prop_id}|${t.side}|${t.line}`});
        sent = {ok: sent.ok + r.ok, gone: sent.gone + r.gone, fail: sent.fail + r.fail}; } }
    return j({status: 'ok', games: ev.games, triggers: ev.triggers.length, new: fresh.map((t: {body: string}) => t.body), subs: nsubs, sent, ms: Date.now() - t0});
  } catch (e) { console.log('live-alerts error', String(e)); return j({status: 'error', error: String(e), ms: Date.now() - t0}, 500); }
});
