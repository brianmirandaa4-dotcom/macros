/* Overlay style guide renderer. Every value shown comes from tokens.css or the model's own exported data (embedded as #sg-data). */
'use strict';
(function(){
const D = JSON.parse(document.getElementById('sg-data').textContent);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const odds = o => o > 0 ? `+${o}` : `−${Math.abs(o)}`;
const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const pct = p => `${(p * 100).toFixed(1)}`;
const MK = {'Receiving yards': 'rec yds', 'Rushing yards': 'rush yds', 'Passing yards': 'pass yds', 'QB rushing yards': 'QB rush yds', 'Receptions': 'rec'};
const cap = s => s[0].toUpperCase() + s.slice(1);
const sel = b => b.line == null ? `${b.market} \u00b7 ${cap(b.side)}` : `${cap(b.side)} ${b.line} ${MK[b.market] || b.market.toLowerCase()}`;
const et = iso => new Date(iso).toLocaleString('en-US', {timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit'}) + ' ET';

/* ---- contrast (WCAG 2.x) */
const rgb = s => { const c = document.createElement('i'); c.style.color = s; document.body.appendChild(c); const m = getComputedStyle(c).color.match(/[\d.]+/g).map(Number); c.remove(); return m; };
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)); };
const ratio = (fg, bg) => { const F = rgb(fg), B = rgb(bg), L1 = lum(over(F, B)), L2 = lum(B); return (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); };
const aa = r => r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'AA large' : 'fails';

/* ---- 01 color */
const SURF = [['--s0', 'Canvas', 'The page itself'], ['--s1', 'Grouped', 'Section backgrounds, row groups'], ['--s2', 'Card', 'Bet cards, report cards'], ['--s3', 'Raised', 'Chips, inputs, pressed rows'], ['--s4', 'Floating', 'Sheets, toasts, popovers']];
$('#sw-surf').innerHTML = SURF.map(([v, n, u]) => `<div class="swatch"><div class="chip-c" style="background:var(${v})"></div><div><b>${n}</b><span>${u}</span></div><span class="num">${css(v)}</span></div>`).join('');
const TXT = [['--t1', 'Primary', 'Names, selections, numbers'], ['--t2', 'Secondary', 'Supporting text, 66%'], ['--t3', 'Tertiary', 'Labels and metadata, 54%']];
$('#sw-text').innerHTML = TXT.map(([v, n, u]) => { const a = ratio(css(v), css('--s0')), b = ratio(css(v), css('--s4'));
  return `<div class="swatch"><div class="chip-c" style="background:var(--s2);display:grid;place-items:center;color:var(${v});font:700 17px/1 var(--f-ui)">Aa</div><div><b style="color:var(${v})">${n}</b><span>${u}</span></div><span class="num">${a.toFixed(1)} on canvas<br>${b.toFixed(1)} on sheet<span class="aa">${aa(Math.min(a, b))}</span></span></div>`; }).join('');
const SEM = [['--brass', 'Brass', 'Primary action · bet passes'], ['--edge', 'Edge', 'Clears break-even by 5+ · won'], ['--fair', 'Fair', 'Price about right'], ['--pass', 'Pass', 'No bet'], ['--live', 'Live', 'Live watch · in progress'], ['--loss', 'Loss', 'Lost · pulls the score down']];
$('#sw-sem').innerHTML = SEM.map(([v, n, u]) => { const r = ratio(css(v), css('--s2'));
  return `<div class="swatch"><div class="chip-c" style="background:var(${v})"></div><div><b>${n}</b><span>${u}</span></div><span class="num">${css(v)}<br>${r.toFixed(1)} on card<span class="aa">${aa(r)}</span></span></div>`; }).join('');
const SP = [['nfl', 'NFL'], ['cfb', 'College football'], ['nba', 'NBA'], ['nhl', 'NHL'], ['mlb', 'MLB']];
$('#sw-sport').innerHTML = SP.map(([k, n]) => `<div class="swatch"><div class="chip-c" style="background:var(--s2);display:grid;place-items:center;color:var(--${k})">${Icon.svg(k, {size: 22})}</div><div><b>${n}</b><span>Dot, icon tint, 3px card bar</span></div><span class="num">${css('--' + k)}</span></div>`).join('');

/* ---- 02 ticker: tabular numerals */
{ const seq = [53.5, 64.1, 58.8, 7.0, 100.0, 11.1]; let i = 0; setInterval(() => { i = (i + 1) % seq.length; $('#ticker').innerHTML = `${seq[i].toFixed(1)}<small>%</small>`; }, 900); }

/* ---- 04 motion */
const MO = [['--d1', '--ease-out', 'Micro', 'Press, toggles'], ['--d2', '--ease-out', 'Small', 'Tabs, chips, fades'], ['--d3', '--ease-in', 'Medium', 'Sheets, cards, entries'], ['--d4', '--ease-out', 'Large', 'Charts drawing in']];
$('#motion-demos').innerHTML = MO.map(([d, e, n, u]) => `<button class="mbox tap" style="--dur:var(${d});--ease:var(${e})" aria-label="Play ${n} motion"><b>${n} · ${css(d)}</b><span>${u}<br>${e === '--ease-in' ? 'slight overshoot' : 'settles, no bounce'}</span><i></i></button>`).join('');
document.querySelectorAll('.mbox').forEach(b => b.addEventListener('click', () => b.classList.toggle('go')));
setInterval(() => document.querySelectorAll('.mbox').forEach(b => b.classList.toggle('go')), 1800);

/* ---- 05 icons */
const GROUPS = {Tabs: ['lobby', 'card', 'props', 'live', 'bets', 'more'], Sports: ['nfl', 'cfb', 'nba', 'nhl', 'mlb'], Props: ['pass_yds', 'rush_yds', 'rec_yds', 'receptions', 'qb_rush', 'atd', 'kicker', 'pts', 'reb', 'ast', 'tpm', 'pra', 'stl', 'blk', 'tov'], Actions: ['plus', 'check', 'close', 'back', 'chev', 'down', 'share', 'search', 'refresh', 'import', 'gear', 'info', 'learn', 'lines', 'parlay', 'results', 'ring']};
$('#icon-grid').outerHTML = Object.entries(GROUPS).map(([g, L]) => `<div class="sub"><span class="label">${g}</span><div class="icons">${L.map(n => `<div>${Icon.svg(n, {size: 26})}<span>${n}</span></div>`).join('')}</div></div>`).join('');
document.querySelectorAll('[data-ic]').forEach(i => { i.outerHTML = Icon.svg(i.dataset.ic, {size: 20}); });

/* ---- 06 components */
const [B1, B2] = D.bets;
const chip = b => `<span class="linechip"><span class="lc-open"><span class="lbl">Opened</span><span class="num">${b.opener.line}</span></span><span class="lc-arrow">→</span><span class="lc-best"><span class="lbl">Best now</span><span class="num">${b.line} ${odds(b.odds)}</span></span><span><b>${esc(b.book)}</b></span></span>`;
$('#linechips').innerHTML = chip(B1) + chip(B2);
$('#sheetchip').outerHTML = chip(B1);

const seg = $('#seg-demo');
seg.innerHTML = `<div class="seg" role="group" aria-label="Slate window"><span class="seg-thumb"></span>${D.windows.map(([w, n, b], i) => `<button aria-pressed="${i === 1}" class="tap">${esc(w)}<span class="n">${b ? b + ' bet' + (b > 1 ? 's' : '') : n}</span></button>`).join('')}</div>`;
const segEl = seg.firstChild, thumb = segEl.querySelector('.seg-thumb');
const placeThumb = () => { const on = segEl.querySelector('[aria-pressed="true"]'); thumb.style.left = on.offsetLeft + 'px'; thumb.style.width = on.offsetWidth + 'px'; };
segEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { segEl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); placeThumb(); }));
requestAnimationFrame(placeThumb); addEventListener('resize', placeThumb);

const SPORTS = [['nfl', 'NFL'], ['cfb', 'CFB'], ['nba', 'NBA'], ['nhl', 'NHL'], ['mlb', 'MLB']];
$('#sport-demo').innerHTML = SPORTS.map(([k, n], i) => { const s = D.sports[n]; const dis = k === 'nhl';
  return `<button class="sport tap" style="--c:var(--${k})" aria-pressed="${k === 'cfb'}" ${dis ? 'disabled' : ''}>${Icon.svg(k, {size: 20})}${n}${s && s.bets ? `<span class="ct">${s.bets}</span>` : ''}</button>`; }).join('');
$('#sport-demo').querySelectorAll('.sport').forEach(b => b.addEventListener('click', () => $('#sport-demo').querySelectorAll('.sport').forEach(x => x.setAttribute('aria-pressed', x === b))));

const L = D;  // Lamar Jackson, NFL Week 8
$('#meter-demo').innerHTML = [
  ['Clears break-even by 5+', Charts.meter({p: B1.p, be: B1.be, label: `${B1.player} · ${sel(B1)}`})],
  ['Below break-even', Charts.meter({p: L.p, be: L.be, label: `${L.player} · Over ${L.line} pass yds`})],
  ['Loading', `<div class="meter"><div class="sk" style="height:6px"></div><div class="meter-labels"><span class="sk" style="width:140px;height:12px"></span><span class="sk" style="width:44px;height:16px"></span></div></div>`]
].map(([s, h]) => `<div class="state"><span class="label">${s}</span>${h}</div>`).join('');

const FAM = {A: 'Role', B: 'Form', C: 'Matchup', D: 'Game setup', E: 'History'};
const fmx = Math.max(...Object.values(L.fam).map(Math.abs));
$('#fbar-demo').innerHTML = Object.entries(L.fam).map(([k, v]) => `<div class="fbar"><div class="nm">${FAM[k]}<span>${v >= 0 ? 'pushes up' : 'pulls down'}</span></div><div class="tr"><span class="${v >= 0 ? 'up' : 'dn'}" style="width:${Math.abs(v) / fmx * 50}%"></span></div><div class="v">${sgn(v, 2)}</div></div>`).join('') + `<p class="note b13 t3" style="margin:8px 0 0">${esc(L.player)}, passing yards, NFL Week 8. Five family scores from the 25-question report card.</p>`;

const resLine = r => !r ? 'Not graded yet' : `${r.result === 'won' ? '<span class="pill pill-edge">Won</span>' : r.result === 'lost' ? '<span class="pill pill-loss">Lost</span>' : '<span class="pill pill-fair">Push</span>'} <span>Final <b class="num">${r.actual}</b></span>`;
const betcard = (b, cls = '') => `<button class="betcard tap ${cls}" style="--c:var(--cfb)">
  <div class="bc-top"><span style="display:flex;align-items:center;gap:6px;color:var(--cfb)">${Icon.svg('cfb', {size: 16})}<span class="t2">CFB · ${esc(b.window)} · ${et(b.kick)}</span></span><span class="pill pill-bet">Bet</span></div>
  <div class="bc-main">${Charts.ring({p: b.p, be: b.be, size: 88, stroke: 9})}<div><div class="bc-sel">${sel(b)}</div><div class="bc-who">${esc(b.player)} · ${esc(b.team)} vs ${esc(b.opp)}</div>
    <div class="bc-px"><span class="num">${odds(b.odds)}</span><span><b>${esc(b.book)}</b></span><span class="pill pill-edge">Edge ${sgn(b.edge)}</span></div></div></div>
  <div class="bc-foot"><span>Loses about <b class="num">${Math.round((1 - b.p) * 100)}</b> in 100</span><span style="display:flex;align-items:center;gap:8px">${resLine(b.res)}</span></div></button>`;
$('#betcard-demo').innerHTML = [
  ['Default', betcard(B1)], ['Pressed', betcard(B2, 'is-pressed')],
  ['Loading', `<div class="betcard" style="--c:var(--s3)" aria-label="Loading"><div class="bc-top"><span class="sk" style="width:160px;height:12px"></span><span class="sk" style="width:44px;height:24px;border-radius:12px"></span></div><div class="bc-main"><div class="sk" style="width:88px;height:88px;border-radius:50%"></div><div style="display:grid;gap:8px"><div class="sk" style="height:20px;width:85%"></div><div class="sk" style="height:12px;width:65%"></div><div class="sk" style="height:16px;width:50%"></div></div></div></div>`],
  ['Empty', `<div class="betcard is-empty" style="--c:var(--nfl)"><span class="label">NFL · ${esc(D.sports.NFL.label)}</span><div class="h22">No bets pass the model.</div><div class="b15 t2">Every prop on this slate was priced. Four are live-watch only; none cleared both keys.</div></div>`]
].map(([s, h]) => `<div class="state"><span class="label">${s}</span>${h}</div>`).join('');

const pvl = r => { if(!r.r80 || r.proj == null) return ''; const lo = Math.min(r.r80[0], r.line) * .9, hi = Math.max(r.r80[1], r.line) * 1.05, x = v => ((v - lo) / (hi - lo) * 100).toFixed(1) + '%';
  return `<div class="pvl strip" aria-label="Projection ${r.proj.toFixed(1)} against line ${r.line}"><span class="tr"></span><span class="rg" style="left:${x(r.r80[0])};width:calc(${x(r.r80[1])} - ${x(r.r80[0])})"></span><span class="ln" style="left:${x(r.line)}"></span><span class="pj" style="left:${x(r.proj)};--c:var(--nfl)"></span></div>`; };
const prow = (r, cls = '', strip = false) => { const s = r.score; return `<button class="prow tap ${cls}"><div><div class="nm">${esc(r.player)}</div><div class="mt">${esc(r.team)} vs ${esc(r.opp)} · ${esc(sel(r))}</div></div>
  <div class="rt"><span class="score ${s >= 3 ? 'up' : s <= -3 ? 'dn' : ''}">${sgn(s, 2)}</span><small>${r.tier === 'live' ? 'Live watch' : 'Pass'}</small></div>${strip ? pvl(r) : ''}</button>`; };
const R = D.rows;
$('#prow-demo').innerHTML = [
  ['Default, with projection strip', `<div class="group">${prow(R[0], '', true)}${prow(R[1])}</div>`],
  ['Pressed', `<div class="group">${prow(R[2], 'is-pressed')}</div>`],
  ['Loading', `<div class="group">${[0, 1].map(() => `<div class="prow"><div style="display:grid;gap:8px"><div class="sk" style="width:150px;height:16px"></div><div class="sk" style="width:200px;height:12px"></div></div><div class="sk" style="width:54px;height:26px"></div></div>`).join('')}</div>`],
  ['Empty', `<div class="group"><div class="prow" style="grid-template-columns:1fr"><div class="nm t2" style="font-weight:500">No props match “Kelce”.</div><div class="mt">Search covers every priced prop on this slate.</div></div></div>`]
].map(([s, h]) => `<div class="state"><span class="label">${s}</span>${h}</div>`).join('') + `<p class="note b13 t3" style="grid-column:1/-1;margin:0">Strip: gray band is the 80% range, white tick the line, dot the projection.</p>`;
$('#sk-demo').innerHTML = [0, 1, 2].map(() => `<div class="prow"><div style="display:grid;gap:8px"><div class="sk" style="width:150px;height:16px"></div><div class="sk" style="width:210px;height:12px"></div></div><div class="sk" style="width:54px;height:26px"></div></div>`).join('');

$('#rchero-demo').innerHTML = `<div class="rchero">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="display:flex;align-items:center;gap:6px;color:var(--nfl)">${Icon.svg('nfl', {size: 16})}<span class="label" style="color:var(--t2)">NFL · Week 8</span></span><span class="pill pill-live">Live watch</span></div>
  <div class="rc-top">${Charts.ring({p: L.p, be: L.be, size: 132, stroke: 12})}<div><div class="rc-sel">Over ${L.line} pass yds</div><div class="rc-sub">${esc(L.player)} · ${L.team} vs ${L.opp}</div><div class="rc-sub">${odds(L.odds)} <b style="color:var(--t1)">${esc(L.book)}</b></div></div></div>
  ${Charts.meter({p: L.p, be: L.be, label: `Needs ${pct(L.be)}% at ${odds(L.odds)}`})}
  <div class="rc-nums"><div><span class="label">Projection</span><span class="num">${L.proj.toFixed(0)}</span></div><div><span class="label">Edge</span><span class="num" style="color:var(--loss)">${sgn(L.edge)}</span></div><div><span class="label">25D</span><span class="num" style="color:var(--edge)">${sgn(L.score, 2)}</span></div></div>
  <p class="b13 t2" style="margin:0">Information only. Strong report card (99th percentile), but the price is too short pre-game. Plan: ${esc(L.live.plan.toLowerCase())}, buy at ${L.live.number} if he is at ${esc(L.live.ht_trigger)} at halftime.</p></div>`;

$('#toast-btn').addEventListener('click', () => { const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = Icon.svg('check', {size: 20}) + 'Bet logged'; Object.assign(t.style, {position: 'fixed', left: '50%', bottom: 'calc(24px + env(safe-area-inset-bottom,0px))', transform: 'translate(-50%,20px)', opacity: 0, zIndex: 50, transition: 'transform var(--d3) var(--ease-in),opacity var(--d2) var(--ease-out)'}); document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.transform = 'translate(-50%,0)'; t.style.opacity = 1; }); setTimeout(() => { t.style.transition = 'transform var(--d2) var(--ease-out),opacity var(--d2) var(--ease-out)'; t.style.transform = 'translate(-50%,12px)'; t.style.opacity = 0; setTimeout(() => t.remove(), 260); }, 1800); });

/* ---- 07 navigation */
$('#lt-rows').innerHTML = R.map(r => prow(r)).join('');
$('#tab-demo').innerHTML = [['lobby', 'Lobby'], ['card', 'Card', 2], ['props', 'Props'], ['live', 'Live'], ['more', 'More']].map(([k, l, b], i) => `<button class="tap" ${i === 2 ? 'aria-current="page"' : ''}>${Icon.svg(k)}<span>${l}</span>${b ? `<span class="badge">${b}</span>` : ''}</button>`).join('');
{ const sc = $('#lt-scroll'), nav = $('#lt-nav'), lt = $('#lt-title'); sc.addEventListener('scroll', () => { const y = sc.scrollTop; nav.classList.toggle('is-collapsed', y > 30); lt.style.opacity = Math.max(0, 1 - y / 36); }, {passive: true}); }
{ const sh = $('#sheetdemo'), ph = $('#sheet-phone'); const H = () => sh.offsetHeight, PH = () => ph.offsetHeight;
  const det = () => [0, H() - 96];  // full, peek (translateY)
  let cur = 0; const set = (y, anim = true) => { sh.style.transition = anim ? '' : 'none'; sh.style.transform = `translateY(${y}px)`; cur = y; };
  
  ph.querySelectorAll('.sheet .btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); set(det()[1]); }));
  let y0 = null, c0 = 0;
  sh.addEventListener('pointerdown', e => { y0 = e.clientY; c0 = cur; sh.setPointerCapture(e.pointerId); sh.style.transition = 'none'; });
  sh.addEventListener('pointermove', e => { if(y0 == null) return; let y = c0 + e.clientY - y0; if(y < 0) y = y / 3; set(Math.min(H(), y), false); });
  sh.addEventListener('pointerup', e => { if(y0 == null) return; const v = e.clientY - y0; y0 = null; const D2 = det(); set(v > 40 ? D2[1] : v < -40 ? D2[0] : D2.reduce((a, d) => Math.abs(d - cur) < Math.abs(a - cur) ? d : a, D2[0])); });
  ph.addEventListener('click', e => { if(!sh.contains(e.target)) set(det()[0]); });
}

/* ---- 08 data viz */
const PX = D.pass_ex;
$('#ring-demo').innerHTML = [
  [Charts.ring({p: B1.p, be: B1.be, size: 100, stroke: 10}), 'Bet', `${B1.player} · ${sel(B1)}`],
  [Charts.ring({p: L.p, be: L.be, size: 100, stroke: 10}), 'Below the price', `${L.player} · Over ${L.line} pass yds`],
  [Charts.ring({p: PX.p, be: PX.be, size: 100, stroke: 10, pass: true}), 'Pass', `${PX.player} · ${sel(PX)}`]
].map(([s, t, d]) => `<div style="display:grid;justify-items:center;align-content:start;gap:6px;text-align:center">${s}<b class="b15" style="font-weight:600">${t}</b><span class="b13 t3">${esc(d)}</span></div>`).join('');

$('#density-demo').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px"><span class="b15" style="font-weight:600">${esc(L.player)} · passing yards</span><span class="b13 t3 num">${L.hist.n.toLocaleString()} replays</span></div>
  <div id="dens"></div>
  <p class="note b13 t3" style="margin:8px 0 0">Shaded side is where the over cashes. The big number rides the curve; the dashed line is the projection (${L.proj.toFixed(0)}). A bet draws this in green; a lean or watch draws it in slate.</p>`;

const cw = el => Math.round(el.clientWidth);
const drawResp = () => { const dw = cw($('#dens')); $('#dens').innerHTML = Charts.density({hist: L.hist, line: L.line, side: 'over', proj: L.proj, pLabel: `${Math.round(L.p * 100)}%`, color: 'var(--fair)', w: dw, h: Math.round(Math.min(220, dw * .55))});
  const c = $('#cal-demo'), w = cw(c) - 40; c.innerHTML = Charts.calibration({points: D.calib, w, h: Math.round(w * .82)});
  const v = $('#div-demo'); v.innerHTML = Charts.diverging({q25: L.q25, w: cw(v), rh: 24}); };
requestAnimationFrame(drawResp); let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(drawResp, 150); });
{ const n = D.calib.reduce((a, p) => a + p[2], 0); const err = D.calib.reduce((a, p) => a + Math.abs(p[0] - p[1]) * p[2], 0) / n;
  $('#cal-note').textContent = `${n.toLocaleString()} graded props across every slate the app holds. When the model says ${Math.round(D.calib[3][0] * 100)}%, those props hit ${Math.round(D.calib[3][1] * 100)}%. Average miss: ${(err * 100).toFixed(1)} points. Dot size is sample size.`; }

{ const P = D.bank, last = P[P.length - 1]; const fmt = v => `${sgn(v, 2)}<small>u</small>`;
  $('#bank-now').innerHTML = fmt(last.v); $('#bank-when').textContent = `${P.length - 1} model bets · 1 unit each · drag the line`;
  $('#bank-demo').innerHTML = Charts.bankroll({points: P, base: 0, h: 200});
  Charts.scrub($('#bank-demo svg'), p => { $('#bank-now').innerHTML = fmt(p ? p[2] : last.v); $('#bank-when').textContent = p ? p[3] : `${P.length - 1} model bets · 1 unit each · drag the line`; }); }

/* ---- 09 25D hero */
$('#fp-demo').innerHTML = Charts.fingerprint({q25: L.q25, score: L.score, size: 320});

/* ---- 10 share card */
$('#share-demo').innerHTML = `<div class="sharecard" role="img" aria-label="Share card preview">
  <div class="sc-brand"><img src="icons/icon-180.png" width="28" height="28" alt="" style="border-radius:7px">OVERLAY <span>by whomadethisline</span></div>
  <div style="display:grid;gap:14px"><span class="label" style="color:var(--cfb)">CFB · Week 8 · ${esc(B1.window)}</span><div class="h34">${sel(B1)}</div><div class="b17 t2">${esc(B1.player)} · ${esc(B1.team)} vs ${esc(B1.opp)}</div></div>
  <div style="display:flex;align-items:center;gap:18px">${Charts.ring({p: B1.p, be: B1.be, size: 110, stroke: 10})}<div style="display:grid;gap:6px"><span class="num b17" style="font-weight:600">${odds(B1.odds)} ${esc(B1.book)}</span><span class="pill pill-edge">Edge ${sgn(B1.edge)}</span><span class="b13 t3">Loses about ${Math.round((1 - B1.p) * 100)} in 100</span></div></div>
  <div class="b11 t3">Model output, not advice. Bet within your means.</div></div>`;
})();
