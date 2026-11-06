/* tail. weather — National Weather Service (api.weather.gov) forecasts + alerts at each stadium, ESPN for the venue.
   Display only: every number shown is NWS data. Prop/player impact numbers come from data/nfl/weather_model.json
   (trained + validated model) and are shown only for markets the model ships. */
(function(){
const STAD = { // home team -> stadium. roof: out | dome | retract (retractable)
  ARI:['State Farm Stadium',33.5276,-112.2626,'retract'], ATL:['Mercedes-Benz Stadium',33.7554,-84.4008,'retract'], BAL:['M&T Bank Stadium',39.2780,-76.6227,'out'],
  BUF:['Highmark Stadium',42.7738,-78.7868,'out'], CAR:['Bank of America Stadium',35.2258,-80.8528,'out'], CHI:['Soldier Field',41.8623,-87.6167,'out'],
  CIN:['Paycor Stadium',39.0955,-84.5161,'out'], CLE:['Huntington Bank Field',41.5061,-81.6995,'out'], DAL:['AT&T Stadium',32.7473,-97.0945,'retract'],
  DEN:['Empower Field',39.7439,-105.0201,'out'], DET:['Ford Field',42.3400,-83.0456,'dome'], GB:['Lambeau Field',44.5013,-88.0622,'out'],
  HOU:['NRG Stadium',29.6847,-95.4107,'retract'], IND:['Lucas Oil Stadium',39.7601,-86.1639,'retract'], JAX:['EverBank Stadium',30.3239,-81.6373,'out'],
  KC:['Arrowhead Stadium',39.0489,-94.4839,'out'], LV:['Allegiant Stadium',36.0909,-115.1833,'dome'], LAC:['SoFi Stadium',33.9535,-118.3392,'dome'], LA:['SoFi Stadium',33.9535,-118.3392,'dome'],
  MIA:['Hard Rock Stadium',25.9580,-80.2389,'out'], MIN:['U.S. Bank Stadium',44.9737,-93.2581,'dome'], NE:['Gillette Stadium',42.0909,-71.2643,'out'],
  NO:['Caesars Superdome',29.9511,-90.0812,'dome'], NYG:['MetLife Stadium',40.8135,-74.0745,'out'], NYJ:['MetLife Stadium',40.8135,-74.0745,'out'],
  PHI:['Lincoln Financial Field',39.9008,-75.1675,'out'], PIT:['Acrisure Stadium',40.4468,-80.0158,'out'], SF:["Levi's Stadium",37.4030,-121.9700,'out'],
  SEA:['Lumen Field',47.5952,-122.3316,'out'], TB:['Raymond James Stadium',27.9759,-82.5033,'out'], TEN:['Nissan Stadium',36.1665,-86.7713,'out'],
  WAS:['Northwest Stadium',38.9077,-76.8645,'out']};
const NWS = 'https://api.weather.gov', ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const C = {pt: {}, fc: {}, grid: {}, al: {}, venue: null, venueAt: 0}; const TTL = 10 * 60e3;
const J = async u => { const r = await fetch(u, {headers: {Accept: 'application/geo+json'}}); if(!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
const kmh = v => v == null ? null : Math.round(v / 1.609);
const mph = s => { const m = String(s || '').match(/(\d+)(?:\s*to\s*(\d+))?/); return m ? +(m[2] || m[1]) : null; };

/* ESPN venue check (schema validated): neutral / international sites get no NWS forecast */
async function venues(){ if(C.venue && Date.now() - C.venueAt < 6 * 3.6e6) return C.venue; const out = {};
  try{ const r = await fetch(ESPN).then(r => r.json()); if(!Array.isArray(r.events)) throw new Error('espn schema');
    for(const e of r.events){ const c = (e.competitions || [])[0]; if(!c || !c.venue) continue; const t = c.competitors || []; const h = t.find(x => x.homeAway === 'home'), a = t.find(x => x.homeAway === 'away'); if(!h || !a) continue;
      const fix = s => s === 'WSH' ? 'WAS' : s === 'LAR' ? 'LA' : s === 'JAC' ? 'JAX' : s; out[fix(a.team.abbreviation) + '@' + fix(h.team.abbreviation)] = {name: c.venue.fullName, indoor: !!c.venue.indoor, country: (c.venue.address || {}).country || 'USA', city: (c.venue.address || {}).city || ''}; } }catch(e){}
  C.venue = out; C.venueAt = Date.now(); return out; }
function site(away, home, V){ const v = V && V[away + '@' + home]; const s = STAD[home];
  if(v && v.country && v.country !== 'USA') return {abroad: true, name: v.name, city: v.city, indoor: v.indoor};
  if(v && s && v.name && !sameName(v.name, s[0])) return {neutral: true, name: v.name, city: v.city, indoor: v.indoor};
  if(!s) return null; return {name: s[0], lat: s[1], lon: s[2], roof: s[3]}; }
const sameName = (a, b) => { const k = x => x.toLowerCase().replace(/[^a-z]/g, ''); const A = k(a), B = k(b); return A.includes(B.slice(0, 6)) || B.includes(A.slice(0, 6)); };

async function point(s){ const k = s.lat.toFixed(4) + ',' + s.lon.toFixed(4); if(!C.pt[k]) C.pt[k] = J(`${NWS}/points/${k}`).then(r => r.properties); return C.pt[k]; }
async function hourly(s){ const k = s.name; const c = C.fc[k]; if(c && Date.now() - c.t < TTL) return c.v;
  const p = await point(s); const r = await J(p.forecastHourly); const v = (r.properties.periods || []).map(x => ({t: new Date(x.startTime).getTime(), temp: x.temperature, wind: mph(x.windSpeed), dir: x.windDirection, pop: (x.probabilityOfPrecipitation || {}).value || 0, sf: x.shortForecast || '', day: x.isDaytime}));
  C.fc[k] = {t: Date.now(), v}; return v; }
async function gusts(s){ const k = s.name; const c = C.grid[k]; if(c && Date.now() - c.t < TTL) return c.v;
  try{ const p = await point(s); const r = await J(p.forecastGridData); const vals = ((r.properties.windGust || {}).values || []).map(x => { const [a, d] = x.validTime.split('/'); const t0 = new Date(a).getTime(); const h = +(d.match(/(\d+)H/) || [0, 1])[1] + 24 * +(d.match(/(\d+)D/) || [0, 0])[1]; return {t0, t1: t0 + h * 3.6e6, v: kmh(x.value)}; });
    C.grid[k] = {t: Date.now(), v: vals}; return vals; }catch(e){ return []; } }
async function alerts(s){ const k = s.name; const c = C.al[k]; if(c && Date.now() - c.t < 5 * 60e3) return c.v;
  try{ const r = await J(`${NWS}/alerts/active?point=${s.lat.toFixed(4)},${s.lon.toFixed(4)}`); const v = (r.features || []).map(f => f.properties).map(p => ({event: p.event, headline: p.headline, severity: p.severity, ends: p.ends || p.expires}));
    C.al[k] = {t: Date.now(), v}; return v; }catch(e){ return []; } }

function emoji(h){ const f = (h.sf || '').toLowerCase();
  let e = /thunder|t-storm/.test(f) ? '⛈️' : /snow|flurr|blizzard/.test(f) ? '🌨️' : /sleet|freezing|ice/.test(f) ? '🧊' : /rain|shower|drizzle/.test(f) ? '🌧️' : /fog|haze|mist/.test(f) ? '🌫️' :
    /partly|mostly sunny|mostly clear/.test(f) ? (h.day === false ? '☁️' : '⛅') : /cloud|overcast/.test(f) ? '☁️' : /sunny|clear|fair/.test(f) ? (h.day === false ? '🌙' : '☀️') : '🌡️';
  return e; }
const windy = w => (w || 0) >= 15;

/* conditions over a game window (kick-1h .. kick+3.5h) */
const indoorSport = sp => !!sp && sp !== 'NFL';   /* NBA (and any other indoor sport): never ask api.weather.gov */
async function game(away, home, kick, sport){ if(indoorSport(sport)) return {site: {name: 'Arena', indoor: true}, kind: 'dome'}; const V = await venues(); const s = site(away, home, V); if(!s) return null;
  if(s.abroad || s.neutral) return {site: s, kind: s.abroad ? 'abroad' : 'neutral'};
  if(s.roof === 'dome') return {site: s, kind: 'dome'};
  let H; try{ H = await hourly(s); }catch(e){ return {site: s, kind: 'error'}; }
  const k = new Date(kick).getTime(); const win = H.filter(h => h.t >= k - 3.6e6 && h.t <= k + 3.5 * 3.6e6);
  if(!win.length) return {site: s, kind: 'far', firstAvail: H.length ? H[H.length - 1].t : null};
  const G = await gusts(s); win.forEach(h => { const g = G.find(x => h.t >= x.t0 && h.t < x.t1); h.gust = g ? g.v : null; });
  const A = await alerts(s); const atK = win.reduce((a, b) => Math.abs(b.t - k) < Math.abs(a.t - k) ? b : a);
  const maxWind = Math.max(...win.map(h => h.wind || 0)), maxGust = Math.max(0, ...win.map(h => h.gust || 0)), maxPop = Math.max(...win.map(h => h.pop || 0)), minTemp = Math.min(...win.map(h => h.temp));
  const snow = win.some(h => /snow|flurr/i.test(h.sf)), rain = win.some(h => /rain|shower|drizzle|thunder/i.test(h.sf));
  const onset = win.find((h, i) => i > 0 && h.pop >= 50 && win[i - 1].pop < 50);
  return {site: s, kind: s.roof === 'retract' ? 'retract' : 'out', win, atK, maxWind, maxGust, maxPop, minTemp, snow, rain, onset, alerts: A}; }

const chipHTML = w => { if(!w) return ''; if(w.kind === 'dome') return '<span class="wx-c">🏟️ Indoors</span>'; if(w.kind === 'abroad') return `<span class="wx-c">${w.site.indoor ? '🏟️ Indoors' : '🌍 ' + esc(w.site.city || 'Abroad')}</span>`;
  if(w.kind === 'neutral') return `<span class="wx-c">${w.site.indoor ? '🏟️ Indoors' : '📍 Neutral site'}</span>`; if(w.kind === 'far' || w.kind === 'error') return '';
  const a = w.atK; return `<span class="wx-c${w.alerts.length ? ' al' : ''}">${w.alerts.length ? '⚠️' : ''}${emoji(a)}${windy(w.maxWind) ? '💨' : ''} ${a.temp}°${windy(w.maxWind) ? ` · ${w.maxWind} mph` : w.maxPop >= 30 ? ` · ${w.maxPop}%` : ''}${w.kind === 'retract' ? ' · roof' : ''}</span>`; };

/* fill every [data-wx="AWAY@HOME|kickISO"] placeholder in a container */
async function fill(root){ const els = [...(root || document).querySelectorAll('[data-wx]')]; await Promise.all(els.map(async el => { const [m, k] = el.dataset.wx.split('|'); const [a, h] = m.split('@');
  try{ el.innerHTML = chipHTML(await game(a, h, k, el.dataset.wxs)); }catch(e){ el.innerHTML = ''; } })); }

/* hourly chart: emoji row, rain/snow chance bars, wind + gust line, temp labels, kickoff + now markers */
function chart(w, kick){ const H = w.win, n = H.length, W = 340, X0 = 26, X1 = W - 10, step = (X1 - X0) / Math.max(1, n - 1); const x = i => X0 + i * step;
  const k = new Date(kick).getTime(); const tx = t => X0 + (t - H[0].t) / (H[n - 1].t - H[0].t || 1) * (X1 - X0);
  const maxW = Math.max(25, ...H.map(h => Math.max(h.wind || 0, h.gust || 0)));
  const yP = v => 150 - v / 100 * 50, yW = v => 222 - v / maxW * 30;
  const wl = H.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${yW(h.wind || 0).toFixed(1)}`).join(''); const gl = H.some(h => h.gust) ? H.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${yW(h.gust || h.wind || 0).toFixed(1)}`).join('') : '';
  const now = Date.now(); const showNow = now >= H[0].t && now <= H[n - 1].t;
  const hr = t => new Date(t).toLocaleTimeString('en-US', {hour: 'numeric', timeZone: 'America/New_York'}).replace(' ', '').toLowerCase();
  return `<svg class="wx-ch" viewBox="0 0 ${W} 262" role="img" aria-label="Hourly forecast through the game">
    <line class="kick" x1="${tx(k)}" x2="${tx(k)}" y1="56" y2="224"/>${showNow ? `<line class="now" x1="${tx(now)}" x2="${tx(now)}" y1="56" y2="224"/>` : ''}
    ${H.map((h, i) => `<text class="e" x="${x(i)}" y="24">${emoji(h)}</text><text class="t" x="${x(i)}" y="46">${h.temp}°</text>`).join('')}
    <text class="lab" x="0" y="88">Rain/snow chance</text>${H.map((h, i) => `<rect class="pb${/snow|flurr/i.test(h.sf) ? ' sn' : ''}" x="${x(i) - 8}" y="${yP(h.pop)}" width="16" height="${150 - yP(h.pop)}" rx="3"/><text class="v" x="${x(i)}" y="${yP(h.pop) - 4}">${h.pop ? h.pop + '%' : ''}</text>`).join('')}
    <line class="base" x1="${X0 - 12}" x2="${X1 + 6}" y1="150" y2="150"/>
    <text class="lab" x="0" y="166">Wind (mph)${gl ? ', gusts dashed' : ''}</text>${gl ? `<path class="gl" d="${gl}"/>` : ''}<path class="wl" d="${wl}"/>${H.map((h, i) => `<circle class="wd" cx="${x(i)}" cy="${yW(h.wind || 0)}" r="3"/><text class="v" x="${x(i)}" y="${yW(Math.max(h.wind || 0, h.gust || 0)) - 7}">${h.wind ?? ''}</text>`).join('')}
    <line class="base" x1="${X0 - 12}" x2="${X1 + 6}" y1="222" y2="222"/>
    ${H.map((h, i) => `<text class="hr" x="${x(i)}" y="242">${hr(h.t)}</text>`).join('')}
    <text class="kl" x="${tx(k)}" y="258">Kickoff</text>
    ${showNow ? `<text class="nl" x="${tx(now)}" y="64">Now</text>` : ''}</svg>`; }

function sentence(w){ const out = []; const hr = t => new Date(t).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'});
  if(w.onset) out.push(`${/snow|flurr/i.test(w.onset.sf) ? 'Snow' : 'Rain'} chance jumps to ${w.onset.pop}% around ${hr(w.onset.t)} ET.`);
  else if(w.maxPop >= 50) out.push(`${w.snow ? 'Snow' : 'Rain'} likely through the game (up to ${w.maxPop}%).`);
  if(windy(w.maxWind)) out.push(`Wind up to ${w.maxWind} mph${w.maxGust > w.maxWind ? `, gusts to ${w.maxGust}` : ''}.`);
  if(w.minTemp <= 32) out.push(`Below freezing (${w.minTemp}°).`);
  if(!out.length) out.push('No weather concerns in the forecast.'); return out.join(' '); }

/* game screen Weather tab */
async function renderGame(host, g){ if(indoorSport(g && g.sport)){ host.innerHTML = `<div class="wx-card"><div class="wx-big">🏟️</div><b>Indoors</b><p>Weather won't affect this game.</p></div>`; return; }
  host.innerHTML = '<p class="sub">Loading the forecast…</p>'; let w; try{ w = await game(g.away.abbr, g.home.abbr, g.kick_utc); }catch(e){ w = null; }
  if(!w){ host.innerHTML = '<p class="sub">No stadium data for this game.</p>'; return; }
  if(w.kind === 'dome'){ host.innerHTML = `<div class="wx-card"><div class="wx-big">🏟️</div><b>${esc(w.site.name)} is indoors</b><p>Weather won't affect this game.</p></div>`; return; }
  if(w.kind === 'abroad' || w.kind === 'neutral'){ host.innerHTML = `<div class="wx-card"><div class="wx-big">${w.site.indoor ? '🏟️' : '🌍'}</div><b>${esc(w.site.name || 'Neutral site')}${w.site.city ? ', ' + esc(w.site.city) : ''}</b><p>${w.site.indoor ? "Indoors, so weather won't affect this game." : 'The National Weather Service only covers US stadiums, so there is no forecast for this site.'}</p></div>`; return; }
  if(w.kind === 'error'){ host.innerHTML = '<p class="sub">The National Weather Service did not answer. Pull down to try again.</p>'; return; }
  if(w.kind === 'far'){ host.innerHTML = `<div class="wx-card"><div class="wx-big">🗓️</div><b>Forecast not out yet</b><p>The hourly forecast reaches about 7 days ahead. Check back closer to kickoff.</p></div>`; return; }
  const a = w.atK; host.innerHTML = `${w.alerts.map(x => `<div class="wx-alert"><b>⚠️ ${esc(x.event)}</b><span>${esc(x.headline || '')}</span></div>`).join('')}
    <div class="wx-card"><div class="wx-top"><div class="wx-big">${emoji(a)}${windy(w.maxWind) ? '💨' : ''}</div><div><b>${a.temp}° · ${esc(a.sf)}</b><span>${esc(w.site.name)}${w.kind === 'retract' ? ' · retractable roof, usually closed in bad weather' : ''}</span></div></div>
      <p class="wx-say">${esc(sentence(w))}</p>
      <div class="wx-stats"><div><small>Wind at kick</small><b>${a.wind ?? '–'} <i>mph ${esc(a.dir || '')}</i></b></div><div><small>Max gust</small><b>${w.maxGust || '–'} <i>mph</i></b></div><div><small>Rain/snow</small><b>${w.maxPop}<i>%</i></b></div><div><small>Low</small><b>${w.minTemp}°</b></div></div>
      ${chart(w, g.kick_utc)}<p class="wx-src">National Weather Service hourly forecast · updates every 10 min</p></div>
    <div id="wx-impact"></div>`;
  impact($('#wx-impact', host), w, g); }

/* model impact: only from data/nfl/weather_model.json, only for markets the model ships */
let WM; async function model(){ if(WM !== undefined) return WM; try{ WM = await getJSON('data/nfl/weather_model.json'); }catch(e){ WM = null; } return WM; }
async function impact(host, w, g){ if(!host) return; const M = await model(); if(!M || !window.WXIMPACT){ host.innerHTML = `<div class="wx-card soft"><b>Prop impact</b><p>The weather model is being validated on 2026 games. Player and prop impacts appear here once it passes.</p></div>`; return; }
  host.innerHTML = window.WXIMPACT(M, w, g) || ''; }

/* Home: games ranked by forecast exposure (data only: strongest wind, then rain/snow chance, then cold) */
async function renderWatch(host, list){ if(!host) return; const rows = (await Promise.all(list.filter(({g, d}) => !indoorSport((d && d.sport) || (g && g.sport))).map(async ({g, d}) => { try{ const w = await game(g.away.abbr, g.home.abbr, g.kick_utc); return w && w.win ? {g, d, w} : null; }catch(e){ return null; } }))).filter(Boolean)
    .filter(r => windy(r.w.maxWind) || r.w.maxPop >= 30 || r.w.minTemp <= 35 || r.w.alerts.length)
    .sort((a, b) => (b.w.alerts.length - a.w.alerts.length) || (b.w.maxWind - a.w.maxWind) || (b.w.maxPop - a.w.maxPop) || (a.w.minTemp - b.w.minTemp));
  if(!rows.length){ host.innerHTML = ''; return; }
  host.innerHTML = `<div class="x-shelf"><div class="x-shead"><h2>Weather watch</h2></div><p class="wx-note">Outdoor games with wind, rain, snow or cold in the forecast. Strongest wind first.</p><div class="x-list">${rows.map(({g, d, w}) => `<button class="x-li wx-li" data-game="${esc(g.id)}" data-sl="${esc(d.id)}"><span class="wx-e">${w.alerts.length ? '⚠️' : ''}${emoji(w.atK)}${windy(w.maxWind) ? '💨' : ''}</span><div><b>${window.TL ? TL(g.away.abbr, 'sm') : ''}${esc(g.away.abbr)} @ ${window.TL ? TL(g.home.abbr, 'sm') : ''}${esc(g.home.abbr)}</b><span>${esc(sentence(w))}</span></div></button>`).join('')}</div></div>`;
  host.querySelectorAll('[data-game]').forEach(b => b.onclick = () => openGame(b.dataset.sl, b.dataset.game)); }

/* ticker: active alerts + rain/snow onsets in the next 90 minutes for games today */
let TK = []; async function refreshTicker(games){ const out = []; for(const {g, d} of games){ if(indoorSport((d && d.sport) || (g && g.sport))) continue; const k = new Date(g.kick_utc).getTime(); if(k - Date.now() > 12 * 3.6e6 || Date.now() - k > 4 * 3.6e6) continue;
    try{ const w = await game(g.away.abbr, g.home.abbr, g.kick_utc); if(!w || !w.win) continue; for(const a of w.alerts) out.push(`<span class="tk tk-wx">⚠️ ${esc(a.event)} · ${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</span>`);
      const soon = w.win.find(h => h.t > Date.now() && h.t - Date.now() < 90 * 60e3 && h.pop >= 50); if(soon) out.push(`<span class="tk tk-wx">${emoji(soon)} ${/snow|flurr/i.test(soon.sf) ? 'Snow' : 'Rain'} ${soon.pop}% within the hour · ${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</span>`);
      if(windy(w.atK.wind) && Date.now() >= k - 3.6e6) out.push(`<span class="tk tk-wx">💨 ${w.atK.wind} mph wind · ${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</span>`); }catch(e){} }
  TK = out; }
window.WX = {fill, renderGame, renderWatch, refreshTicker, ticker: () => TK, game, emoji, STAD};
})();
