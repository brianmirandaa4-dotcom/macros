/* tail. weather → prop impact. Numbers come only from data/nfl/weather_model.json (trained + validated; see nfl/src/weather.py).
   Only markets the model ships are shown. Game totals are held back: they improved log loss but lost calibration in bad weather and still trail the no-vig close. */
(function(){
const HOLD = new Set(['game_total']);
let POS = null; async function posMap(){ if(POS) return POS; POS = {}; try{ const r = await getJSON('data/nflp/index.json'); for(const p of r.players) POS[p[1] + '|' + p[2]] = p[3]; }catch(e){} return POS; }
function feats(w, cap){ const H = w.win; const W = H.reduce((a, h) => a + (h.wind || 0), 0) / H.length, T = Math.min(...H.map(h => h.temp)), pop = H.reduce((a, h) => a + (h.pop || 0), 0) / H.length / 100;
  const Wc = cap ? Math.min(W, cap) : W; const snow = w.snow, rain = w.rain && !snow;
  return {x: [Math.max(0, Wc - 10), Math.max(0, Wc - 20), Math.max(0, 40 - T) / 10, rain ? pop : 0, snow ? pop : 0], W, T, pop}; }
function shift(M, x){ const L = M.b.reduce((a, b, i) => a + b * x[i], 0); let s2 = 0; for(let i = 0; i < x.length; i++) for(let j = 0; j < x.length; j++) s2 += x[i] * M.V[i][j] * x[j]; const s = Math.sqrt(Math.max(0, s2));
  return {mult: Math.exp(L), pct: 100 * (Math.exp(L) - 1), lo: 100 * (Math.exp(L - 1.2816 * s) - 1), hi: 100 * (Math.exp(L + 1.2816 * s) - 1)}; }
const fp = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
window.WXIMPACT = function(MODEL, w, g){ const host = document.getElementById('wx-impact'); if(!host || !w || !w.win) return '';
  (async () => { const P = await posMap(); const ship = Object.entries(MODEL.markets || {}).filter(([m, v]) => v && v.ship && !HOLD.has(m) && v.by_pos);
    if(!ship.length){ host.innerHTML = ''; return; }
    const props = Object.values(SLATE).filter(Boolean).flatMap(d => d.props).filter(p => p.gid === g.id || ((p.team === g.away.abbr || p.team === g.home.abbr) && (p.opp === g.home.abbr || p.opp === g.away.abbr)));
    const blocks = ship.map(([m, M]) => { const f = feats(w, M.wind_cap); const byPos = Object.fromEntries(Object.entries(M.by_pos).map(([k, v]) => [k, shift(v, f.x)]));
      const seen = new Set(); const rows = props.filter(p => p.market === m && isNum(p.projection) && !p.no_prediction && !seen.has(p.player) && seen.add(p.player)).map(p => { const pos = P[p.player + '|' + p.team]; const S = byPos[pos]; if(!S) return null; return {p, pos, S, after: p.projection * S.mult}; }).filter(Boolean).sort((a, b) => Math.abs(b.p.projection - b.after) - Math.abs(a.p.projection - a.after)).slice(0, 8);
      const label = (MODEL.markets[m].label) || ({rec_yds: 'Receiving yards'}[m] || m);
      return `<div class="wx-card"><b>${esc(label)}: weather impact</b>
        <div class="wxi-pos">${Object.entries(byPos).map(([k, S]) => `<div><small>${k}</small><b class="${S.pct < -0.5 ? 'neg' : S.pct > 0.5 ? 'pos' : ''}">${fp(S.pct)}</b><i>${fp(S.lo)} to ${fp(S.hi)}</i></div>`).join('')}</div>
        ${rows.length ? `<div class="wxi-list">${rows.map(r => `<button class="wxi-row" data-prop="${esc(r.p.id)}"><span><b>${esc(r.p.player)}</b><i>${esc(r.pos)} · ${esc(r.p.team)}</i></span><span class="wxi-num">${ln(r.p.projection)} <em>→</em> <b>${ln(Math.round(r.after * 10) / 10)}</b></span></button>`).join('')}</div>` : ''}
        <p class="wx-src">Trained weather model (2018–2025, validated on 2026) · forecast over the game window: wind ${f.W.toFixed(0)} mph, low ${f.T}°, ${Math.round(f.pop * 100)}% ${w.snow ? 'snow' : 'rain'} chance · 80% ranges shown. Applied to the model's projection.</p></div>`; });
    host.innerHTML = blocks.join('') + `<p class="wx-src">Receptions, rushing yards and passing yards showed no reliable weather effect beyond what the model already prices, so they are not adjusted. Game totals are held back pending better calibration.</p>`;
    host.querySelectorAll('[data-prop]').forEach(b => b.onclick = () => { const d = Object.values(SLATE).find(x => x && x.props.some(p => p.id === b.dataset.prop)); if(d && window.openProp) openProp(d, b.dataset.prop); }); })();
  return '<div class="cl-load" style="height:80px"></div>'; };
})();
