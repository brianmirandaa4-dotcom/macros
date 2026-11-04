// MACROS sync server — a Cloudflare Worker you own.
// Pulls your WHOOP (official OAuth API) and Garmin (official Personal API key) data
// and hands it to the MACROS app. Nothing here is shared with anyone else.
//
// Bindings (set in Cloudflare → Workers → your worker → Settings):
//   KV namespace:  MACROS_KV
//   Secrets:       WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET
//   Variables:     APP_URL   (e.g. https://yourname.github.io/macros/)
//   Cron trigger:  0 */6 * * *   (keeps WHOOP signed in and pre-loads data)

const WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_SCOPES = 'offline read:profile read:recovery read:sleep read:workout read:cycles read:body_measurement';
const GARMIN_API = 'https://personal.connectapi.garmin.com';
const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const p = url.pathname.replace(/\/+$/, '') || '/';
      if (p === '/') return text('Syncope sync server is running.', 200, cors);
      if (p === '/api/register' && req.method === 'POST') return json(await register(env), 200, cors);
      if (p === '/whoop/connect') return whoopConnect(url, env);
      if (p === '/whoop/callback') return whoopCallback(url, env);

      const user = await authUser(req, env);
      if (!user) return json({ error: 'Not signed in to the sync server. Reconnect in Syncope.' }, 401, cors);

      if (p === '/api/status') return json(status(user), 200, cors);
      if (p === '/api/whoop-link' && req.method === 'POST') { const lnk = rand(16); await env.MACROS_KV.put('lnk:' + lnk, user.id, { expirationTtl: 600 }); return json({ url: url.origin + '/whoop/connect?l=' + lnk }, 200, cors); }
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
        if (body.source === 'all') { await env.MACROS_KV.delete('user:' + user.id); await env.MACROS_KV.delete('cache:' + user.id); return json({ ok: true }, 200, cors); }
        await saveUser(env, user);
        return json(status(user), 200, cors);
      }
      if (p === '/api/sync') {
        const days = Math.min(60, Math.max(1, +url.searchParams.get('days') || 14));
        const force = url.searchParams.get('force') === '1';
        const cached = await env.MACROS_KV.get('cache:' + user.id, 'json');
        if (!force && cached && cached.days >= days && Date.now() - cached.at < 20 * 60 * 1000) return json(cached, 200, cors);
        const data = await syncUser(user, env, days);
        ctx.waitUntil(env.MACROS_KV.put('cache:' + user.id, JSON.stringify(data)));
        return json(data, 200, cors);
      }
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

  async scheduled(event, env, ctx) {
    // Keep every connected account fresh and pre-load the last 14 days.
    let cursor;
    do {
      const list = await env.MACROS_KV.list({ prefix: 'user:', cursor });
      for (const k of list.keys) {
        const user = await env.MACROS_KV.get(k.name, 'json');
        if (!user || (!user.whoop && !user.garmin)) continue;
        try {
          const data = await syncUser(user, env, 14);
          await env.MACROS_KV.put('cache:' + user.id, JSON.stringify(data));
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
const page = (title, body, appUrl) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="background:#0B0C10;color:#ECEEF4;font:16px/1.5 system-ui;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div style="max-width:420px"><h1 style="font-size:26px">${title}</h1><p style="color:#8C92A4">${body}</p>${appUrl ? `<p><a href="${appUrl}" style="display:inline-block;background:#C7B6FF;color:#14101F;padding:14px 22px;border-radius:14px;font-weight:800;text-decoration:none">Back to Syncope</a></p>` : ''}</div></body>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
const isoDate = (d) => d.toISOString().slice(0, 10);
const r1 = (n) => Math.round(n * 10) / 10;

async function register(env) {
  const id = rand(12), secret = rand(24);
  await env.MACROS_KV.put('user:' + id, JSON.stringify({ id, h: await sha(secret), created: Date.now() }));
  return { uid: id, token: secret };
}
async function authUser(req, env) {
  const a = req.headers.get('Authorization') || '';
  const m = a.match(/^Bearer\s+([a-f0-9]+)\.([a-f0-9]+)$/i);
  if (!m) return null;
  const user = await env.MACROS_KV.get('user:' + m[1], 'json');
  if (!user || user.h !== await sha(m[2])) return null;
  return user;
}
async function saveUser(env, user) { await env.MACROS_KV.put('user:' + user.id, JSON.stringify(user)); }
function status(user) {
  return { whoop: !!user.whoop?.refresh, garmin: !!user.garmin?.key, whoopSince: user.whoop?.since || null, garminSince: user.garmin?.since || null };
}

/* ---------------- WHOOP ---------------- */
async function whoopConnect(url, env) {
  const lnk = url.searchParams.get('l') || '';
  const uid = lnk && await env.MACROS_KV.get('lnk:' + lnk);
  if (!uid) return page('Link expired', 'Open Syncope and tap Connect WHOOP again.', env.APP_URL);
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
  if (url.searchParams.get('error')) return page('WHOOP not connected', 'You cancelled or WHOOP declined the request. You can try again from Syncope.', env.APP_URL);
  const uid = await env.MACROS_KV.get('state:' + state);
  if (!uid || !code) return page('Link expired', 'Open Syncope and tap Connect WHOOP again.', env.APP_URL);
  await env.MACROS_KV.delete('state:' + state);
  const r = await fetch(WHOOP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: url.origin + '/whoop/callback', client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET }) });
  if (!r.ok) return page('WHOOP not connected', 'WHOOP did not accept the sign-in (' + r.status + '). Check the redirect URL in your WHOOP developer app matches this server.', env.APP_URL);
  const t = await r.json();
  const user = await env.MACROS_KV.get('user:' + uid, 'json');
  user.whoop = { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + (t.expires_in || 3600) * 1000, since: Date.now() };
  await saveUser(env, user);
  return page('WHOOP connected', 'Your recovery, sleep, strain and workouts will now flow into Syncope automatically.', env.APP_URL);
}
async function whoopAccess(user, env) {
  const w = user.whoop;
  if (w.access && w.exp - Date.now() > 120000) return w.access;
  const r = await fetch(WHOOP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: w.refresh, client_id: env.WHOOP_CLIENT_ID, client_secret: env.WHOOP_CLIENT_SECRET, scope: 'offline' }) });
  if (!r.ok) { throw new Error('WHOOP sign-in expired. Reconnect WHOOP in Syncope.'); }
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
    const k = localDate(c.start, c.timezone_offset); if (!k) continue;
    const sc = c.score || {};
    const st = c.step_count ?? sc.step_count;
    Object.assign(d(k), { strain: sc.strain != null ? r1(sc.strain) : undefined, kcal: sc.kilojoule != null ? Math.round(sc.kilojoule / 4.184) : undefined, avgHr: sc.average_heart_rate, steps: st != null ? Math.round(st) : undefined });
  }
  const workouts = wko.map(w => {
    const sc = w.score || {};
    return { src: 'WHOOP', id: 'whoop-' + w.id, date: localDate(w.start, w.timezone_offset), name: w.sport_name ? titleCase(w.sport_name) : 'Workout',
      start: w.start, min: w.end ? Math.round((Date.parse(w.end) - Date.parse(w.start)) / 60000) : null,
      kcal: sc.kilojoule != null ? Math.round(sc.kilojoule / 4.184) : null, strain: sc.strain != null ? r1(sc.strain) : null, avgHr: sc.average_heart_rate || null, maxHr: sc.max_heart_rate || null };
  }).filter(w => w.date);
  return { days: clean(byDay), workouts };
}
const titleCase = (s) => String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/* ---------------- Garmin (Personal API) ---------------- */
async function garminToken(user, env, force) {
  const g = user.garmin;
  if (!force && g.token && g.tokenExp - Date.now() > 3600000) return g.token;
  const r = await fetch(GARMIN_API + GARMIN_TOKEN_PATH, { method: 'POST', headers: { Accept: '*/*', Authorization: 'ApiKey ' + g.key } });
  if (!r.ok) throw new Error('Garmin key was rejected (' + r.status + '). Create a new Personal API key and paste it in Syncope.');
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
    const cd = o.calendarDate || o.summaryDate;
    if (typeof cd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cd)) { const k = cd.slice(0, 10); out[k] = Object.assign(out[k] || {}, o); }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
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
  const [sum, slp, hrv, bb, acts, wt] = await Promise.all([
    safe(gget(tok, '/usersummary-service/v2/dailysummaries', { startDate: sd, endDate: ed })),
    safe(gget(tok, '/sleep-service/sleep/dailySleepSummariesByDate', { startDate: sd, endDate: ed })),
    safe(gget(tok, `/hrv-service/hrv/daily/${sd}/${ed}`)),
    safe(gget(tok, '/wellness-service/wellness/bodyBattery/reports/daily', { startDate: sd, endDate: ed })),
    safe(gget(tok, '/activitylist-service/activities/search/activities', { start: 0, limit: 40, startDate: sd, endDate: ed })),
    safe(gget(tok, `/weight-service/weight/range/${sd}/${ed}`, { includeAll: 'true' })),
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
  for (const [k, o] of Object.entries(byCalendarDate(wt))) { const g = pick(o, ['weight']); if (g) d(k).weightLb = r1(g > 1000 ? g / 453.592 : g / 0.4536); }
  const list = Array.isArray(acts) ? acts : (acts && (acts.activityList || acts.activities)) || [];
  const workouts = list.map(a => ({ src: 'Garmin', id: 'garmin-' + a.activityId, date: String(a.startTimeLocal || a.startTimeGMT || '').slice(0, 10),
    name: a.activityName || titleCase(a.activityType && a.activityType.typeKey || 'Activity'), type: a.activityType && a.activityType.typeKey || null,
    start: a.startTimeLocal || null, min: a.duration ? Math.round(a.duration / 60) : null, kcal: a.calories ? Math.round(a.calories) : null,
    avgHr: a.averageHR || null, maxHr: a.maxHR || null, sets: a.totalSets || a.activeSets || null, reps: a.totalReps || null })).filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w.date));
  const errors = Object.entries({ summaries: sum, sleep: slp, hrv, bodyBattery: bb, activities: acts, weight: wt }).filter(([, v]) => v && v.__error).map(([k, v]) => k + ': ' + v.__error);
  return { days: clean(byDay), workouts, errors };
}

function clean(byDay) {
  for (const o of Object.values(byDay)) for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return byDay;
}
async function syncUser(user, env, days) {
  const out = { at: Date.now(), days, whoop: null, garmin: null, errors: [] };
  if (user.whoop?.refresh) { try { out.whoop = await syncWhoop(user, env, days); } catch (e) { out.errors.push('WHOOP: ' + e.message); } }
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
  return out;
}
