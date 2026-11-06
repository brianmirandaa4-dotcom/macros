/* tail. sportsbooks: one registry (logo, colour, app link) and one book switcher used on every pick, NFL and NBA.
   Prices come only from the slate files (Action Network, per book). This file never makes a price: it shows, sorts and links.
   BOOK.chip(spec)  compact chip for list rows: best book logo + price + "N books"; tap opens the book sheet.
   BOOK.slip(spec)  report-card switcher: big "Bet on <book>" button + dropdown of every book; tap a logo to open that app.
   BOOK.table(spec) every-book list with logos (both sides), each row opens that book.
   spec = {label: 'Puka Nacua Over 5.5 Receptions', side: 'over'|'under'|'yes', line: 5.5, rows: offers[] | {DK:{...}} } */
(function(){
const R = [
  // key, canonical name, short, aliases, app link (universal link: opens the app when it's installed), brand colour
  ['dk', 'DraftKings', 'DK', ['draftkings', 'dk'], 'https://sportsbook.draftkings.com/', '#53A318'],
  ['fd', 'FanDuel', 'FD', ['fanduel', 'fd'], 'https://sportsbook.fanduel.com/', '#0078FF'],
  ['mgm', 'BetMGM', 'MGM', ['betmgm', 'mgm', 'book75'], 'https://sports.nj.betmgm.com/en/sports', '#AE9967'],
  ['czr', 'Caesars', 'CZR', ['caesars', 'czr', 'book49', 'williamhill'], 'https://sportsbook.caesars.com/us/nj/bet', '#C5A459'],
  ['br', 'BetRivers', 'BR', ['betrivers', 'br', 'book71'], 'https://nj.betrivers.com/', '#18355E'],
  ['b365', 'bet365', 'B365', ['bet365', 'b365'], 'https://www.nj.bet365.com/', '#147254'],
  ['fan', 'Fanatics', 'FAN', ['fanatics', 'fan'], 'https://sportsbook.fanatics.com/', '#111111'],
  ['hr', 'Hard Rock', 'HR', ['hardrock', 'hard rock', 'hr', 'hardrockbet'], 'https://app.hardrock.bet/', '#880ADB'],
  ['parx', 'BetParx', 'PARX', ['betparx', 'parx'], 'https://nj.betparx.com/', '#190532'],
  ['score', 'theScore', 'SCORE', ['thescore', 'score', 'thescore bet', 'espnbet', 'espn bet'], 'https://thescore.bet/', '#1B2E67'],
  ['poly', 'Polymarket', 'POLY', ['polymarket', 'poly'], 'https://polymarket.com/sports', '#1749DE'],
  ['kal', 'Kalshi', 'KAL', ['kalshi', 'kal'], 'https://kalshi.com/sports', '#14E188'],
  ['novig', 'Novig', 'NOVIG', ['novig'], 'https://novig.us/', '#76C7FF'],
  ['pp', 'PrizePicks', 'PP', ['prizepicks', 'pp'], 'https://app.prizepicks.com/', '#740ED8'],
  ['ud', 'Underdog', 'UD', ['underdog', 'ud', 'underdogfantasy'], 'https://underdogfantasy.com/pick-em/higher-lower', '#E0B404'],
  ['slp', 'Sleeper', 'SLP', ['sleeper', 'slp'], 'https://sleeper.com/', '#09203F'],
];
const BY = {}, AL = {};
for(const [k, name, short, al, url, color] of R){ const b = {k, name, short, url, color, logo: `brand/books/${k}.png`}; BY[name] = b; for(const a of [name, short, ...al]) AL[norm(a)] = b; }
function norm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const find = s => AL[norm(s)] || null;
const isN = x => typeof x === 'number' && isFinite(x);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const od = o => isN(o) ? (o > 0 ? '+' + Math.round(o) : '−' + Math.abs(Math.round(o))) : '—';
const lnf = x => isN(x) ? (Math.round(x * 10) / 10).toString() : '—';
const dec = o => isN(o) && o !== 0 ? (o > 0 ? 1 + o / 100 : 1 + 100 / -o) : null;
const LS = 'tail.book';
const mine = () => { try{ return localStorage.getItem(LS) || ''; }catch(e){ return ''; } };
const setMine = n => { try{ localStorage.setItem(LS, n); }catch(e){} };

/* offers[] or {short: {...}} -> [{b, line, over, under, yes, pickem}] for known books, one per book */
function rows(src){ const out = [], seen = new Set();
  const add = (name, o) => { if(!o || /^(open|opened|consensus)$/i.test(name)) return; const b = find(name) || {k: norm(name), name: String(name), short: String(name).slice(0, 4).toUpperCase(), url: null, color: '#555', logo: null};
    if(seen.has(b.name)) return; seen.add(b.name);
    const z = v => isN(v) && v !== 0 ? v : null; const r = {b, line: isN(o.line) ? o.line : null, over: z(o.over), under: z(o.under), yes: z(o.yes)};
    r.pickem = !!o.pickem || (r.over == null && r.under == null && r.yes == null && r.line != null); out.push(r); };
  if(Array.isArray(src)) src.forEach(o => o && add(o.book, o)); else if(src) Object.entries(src).forEach(([k, o]) => add(k, o));
  return out; }
/* sort: priced first, best price for the side first (at the main line ahead of other lines), then line-only books */
function ranked(rs, side, line){ const pr = r => r[side]; return rs.slice().sort((a, b) => {
  const pa = pr(a), pb = pr(b); if((pa == null) !== (pb == null)) return pa == null ? 1 : -1;
  if(pa == null) return a.b.name.localeCompare(b.b.name);
  const la = isN(line) && a.line === line ? 0 : 1, lb = isN(line) && b.line === line ? 0 : 1; if(la !== lb) return la - lb;
  return dec(pb) - dec(pa); }); }
const sideWord = (side, line) => side === 'yes' ? 'Yes' : `${side === 'under' ? 'U' : 'O'} ${lnf(line)}`;
function logo(b, cls = ''){ return b.logo ? `<img class="bk-lg ${cls}" src="${b.logo}" alt="${esc(b.name)}" width="28" height="28" loading="lazy" decoding="async">`
  : `<span class="bk-lg bk-mono ${cls}" style="--bc:${b.color}" aria-label="${esc(b.name)}">${esc(b.short.slice(0, 3))}</span>`; }
function betText(spec, r){ const side = spec.side; const p = r[side];
  const base = String(spec.label || '').replace(/\s(Over|Under)\s[\d.]+/, side === 'yes' ? '' : ` ${side === 'under' ? 'Under' : 'Over'} ${lnf(r.line ?? spec.line)}`);
  return `${base} · ${r.b.name}${p != null ? ' ' + od(p) : ''}`; }
const enc = o => encodeURIComponent(JSON.stringify(o));
function pack(spec, rs){ return enc({label: spec.label, side: spec.side, line: spec.line, rows: rs.map(r => ({book: r.b.name, line: r.line, over: r.over, under: r.under, yes: r.yes, pickem: r.pickem}))}); }
function pick(rs, side){ const m = mine(); const own = rs.find(r => r.b.name === m && r[side] != null); return own || rs.find(r => r[side] != null) || null; }

/* ---------------------------------------------------------------- list-row chip */
function chip(spec){ const rs = ranked(rows(spec.rows), spec.side, spec.line); if(!rs.length || !spec.side) return '';
  const best = rs.find(r => r[spec.side] != null); const n = rs.length;
  return `<span class="bk-chip" role="button" tabindex="0" data-bsheet="${pack(spec, rs)}" aria-label="Compare ${n} sportsbooks">${best ? `${logo(best.b, 'sm')}<b class="num">${od(best[spec.side])}</b>` : '<b>Lines</b>'}<i>${n} book${n === 1 ? '' : 's'}</i><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span>`; }

/* ---------------------------------------------------------------- the switcher (report cards) */
function rowHTML(spec, r, bestP, cur){ const p = r[spec.side]; const isBest = p != null && dec(p) === bestP && (!isN(spec.line) || r.line === spec.line);
  const off = isN(spec.line) && isN(r.line) && r.line !== spec.line && spec.side !== 'yes';
  return `<div class="bk-row${r.b.name === cur ? ' on' : ''}" role="option" aria-selected="${r.b.name === cur}" data-bsel="${esc(r.b.name)}">
    <button class="bk-lgbtn" data-bgo="${esc(r.b.name)}" aria-label="Open ${esc(r.b.name)}">${logo(r.b)}</button>
    <span class="bk-nm"><b>${esc(r.b.name)}</b>${isBest ? '<em>Best price</em>' : r.pickem ? '<i>Pick’em · line only</i>' : off ? `<i>Different line</i>` : ''}</span>
    <span class="bk-ln num${off ? ' off' : ''}">${spec.side === 'yes' ? '' : lnf(r.line)}</span>
    <span class="bk-px num${p == null ? ' na' : ''}">${p != null ? od(p) : r.pickem ? 'Pick' : '—'}</span>
    <button class="bk-open" data-bgo="${esc(r.b.name)}" aria-label="Bet on ${esc(r.b.name)}"><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M4.5 2.5l3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`; }
function goHTML(spec, r){ const p = r ? r[spec.side] : null;
  return r ? `<button class="bk-go" data-bgo="${esc(r.b.name)}" style="--bc:${r.b.color}">${logo(r.b, 'lg')}<span class="bk-gt"><small>Bet on</small><b>${esc(r.b.name)}</b></span><span class="bk-gp"><small>${esc(sideWord(spec.side, r.line ?? spec.line))}</small><b class="num">${p != null ? od(p) : 'Pick’em'}</b></span></button>` : ''; }
function slip(spec){ const rs = ranked(rows(spec.rows), spec.side, spec.line); if(!rs.length || !spec.side) return '';
  const cur = pick(rs, spec.side) || rs[0]; const bp = Math.max(...rs.filter(r => r[spec.side] != null && (!isN(spec.line) || r.line === spec.line)).map(r => dec(r[spec.side])), 0);
  const priced = rs.filter(r => r[spec.side] != null).length;
  return `<div class="bk-slip" data-bslip="${pack(spec, rs)}">
    <div class="bk-top">${goHTML(spec, cur)}<button class="bk-dd" data-bmenu aria-expanded="false" aria-label="Switch sportsbook"><span>${rs.length}</span><small>books</small><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
    <div class="bk-menu" role="listbox" aria-label="Sportsbooks" hidden><div class="bk-mh"><span>${priced} priced · best first</span><span>Tap a logo to open the app</span></div>${rs.map(r => rowHTML(spec, r, bp, cur.b.name)).join('')}</div></div>`; }

/* ---------------------------------------------------------------- every-book table (both sides) */
function table(spec){ const rs = rows(spec.rows); if(!rs.length) return ''; const yes = spec.side === 'yes' || rs.every(r => r.yes != null);
  const at = r => !isN(spec.line) || r.line === spec.line; const mx = k => Math.max(...rs.filter(r => r[k] != null && at(r)).map(r => dec(r[k])), 0);
  const bo = mx('over'), bu = mx('under'), by = mx('yes');
  const cell = (v, b, r) => `<span class="bk-px num${v == null ? ' na' : ''}${v != null && at(r) && dec(v) === b ? ' best' : ''}">${v != null ? od(v) : '—'}</span>`;
  const sorted = rs.slice().sort((a, b) => (a.pickem - b.pickem) || a.b.name.localeCompare(b.b.name));
  return `<div class="bk-table" data-bslip="${pack({label: spec.label, side: spec.side || 'over', line: spec.line}, rs)}"><div class="bk-th"><span>Book</span><span>${yes ? '' : 'Line'}</span><span>${yes ? 'Yes' : 'Over'}</span><span>${yes ? '' : 'Under'}</span></div>
    ${sorted.map(r => `<button class="bk-tr" data-bgo="${esc(r.b.name)}" aria-label="Open ${esc(r.b.name)}">${logo(r.b, 'sm')}<span class="bk-nm"><b>${esc(r.b.name)}</b>${r.pickem ? '<i>line only</i>' : ''}</span><span class="bk-ln num">${yes ? '' : lnf(r.line)}</span>${yes ? cell(r.yes, by, r) + '<span></span>' : cell(r.over, bo, r) + cell(r.under, bu, r)}</button>`).join('')}
    ${spec.open && (isN(spec.open.line) || isN(spec.open.over)) ? `<div class="bk-tr open"><span class="bk-lg sm bk-mono" style="--bc:#444">OPN</span><span class="bk-nm"><b>Opened</b></span><span class="bk-ln num">${yes ? '' : lnf(spec.open.line)}</span>${yes ? `<span class="bk-px num">${od(spec.open.yes)}</span><span></span>` : `<span class="bk-px num">${od(spec.open.over)}</span><span class="bk-px num">${od(spec.open.under)}</span>`}</div>` : ''}</div>`; }

/* ---------------------------------------------------------------- sheet for list rows */
function sheet(spec){ close(); const rs = ranked(rows(spec.rows), spec.side, spec.line);
  const el = document.createElement('div'); el.className = 'bk-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Sportsbooks');
  el.innerHTML = `<div class="bk-scrim" data-bclose></div><div class="bk-panel"><div class="bk-grab"></div><div class="bk-sh"><div><small>Pick</small><b>${esc(spec.label || '')}</b></div><button class="bk-x" data-bclose aria-label="Close">×</button></div>${slip(spec).replace('class="bk-menu" role="listbox" aria-label="Sportsbooks" hidden', 'class="bk-menu" role="listbox" aria-label="Sportsbooks"').replace('aria-expanded="false"', 'aria-expanded="true"')}</div>`;
  document.body.appendChild(el); requestAnimationFrame(() => el.classList.add('in')); document.documentElement.classList.add('bk-lock'); }
function close(){ document.querySelectorAll('.bk-sheet').forEach(s => s.remove()); document.documentElement.classList.remove('bk-lock'); }

/* ---------------------------------------------------------------- open a book: copy the bet, then hand off to the app */
async function go(spec, name){ const rs = rows(spec.rows); const r = rs.find(x => x.b.name === name); if(!r) return; setMine(name);
  const t = betText(spec, r); try{ await navigator.clipboard.writeText(t); }catch(e){}
  if(window.toast) toast('Copied: ' + t); if(!r.b.url) return; setTimeout(() => { location.href = r.b.url; }, 450); }
const unpack = el => { try{ return JSON.parse(decodeURIComponent(el.dataset.bslip || el.dataset.bsheet)); }catch(e){ return null; } };

/* one capture-phase listener: works for every screen that renders these, and keeps taps from opening the row underneath */
document.addEventListener('click', e => {
  const t = e.target; if(!t || !t.closest) return;
  const cl = t.closest('[data-bclose]'); if(cl){ e.preventDefault(); e.stopPropagation(); close(); return; }
  const g = t.closest('[data-bgo]'); if(g){ const host = g.closest('[data-bslip]'); const spec = host && unpack(host); if(spec){ e.preventDefault(); e.stopPropagation(); go(spec, g.dataset.bgo); } return; }
  const s = t.closest('[data-bsel]'); if(s){ const host = s.closest('[data-bslip]'); const spec = host && unpack(host); if(!spec) return; e.preventDefault(); e.stopPropagation();
    setMine(s.dataset.bsel); const rs = ranked(rows(spec.rows), spec.side, spec.line); const r = rs.find(x => x.b.name === s.dataset.bsel);
    const top = host.querySelector('.bk-go'); if(top && r) top.outerHTML = goHTML(spec, r);
    host.querySelectorAll('.bk-row').forEach(x => { const on = x.dataset.bsel === s.dataset.bsel; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    if(!host.closest('.bk-sheet')){ const m = host.querySelector('.bk-menu'), b = host.querySelector('[data-bmenu]'); if(m){ m.hidden = true; if(b) b.setAttribute('aria-expanded', 'false'); } } return; }
  const m = t.closest('[data-bmenu]'); if(m){ e.preventDefault(); e.stopPropagation(); const host = m.closest('[data-bslip]'); const menu = host && host.querySelector('.bk-menu'); if(menu){ menu.hidden = !menu.hidden; m.setAttribute('aria-expanded', String(!menu.hidden)); } return; }
  const c = t.closest('[data-bsheet]'); if(c){ e.preventDefault(); e.stopPropagation(); const spec = unpack(c); if(spec) sheet(spec); return; }
}, true);
document.addEventListener('keydown', e => { if(e.key === 'Escape') close(); const c = e.target && e.target.closest && e.target.closest('[data-bsheet]'); if(c && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); e.stopPropagation(); const spec = unpack(c); if(spec) sheet(spec); } }, true);

window.BOOK = {find, rows, ranked, chip, slip, table, sheet, close, logo, all: () => Object.values(BY)};
})();
