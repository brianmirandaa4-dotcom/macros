/* Overlay · charts. Hand-built SVG, one axis and label style everywhere, direct labels instead of legends.
   Every chart draws in (stroke-dashoffset or a clip sweep), never bounces, and is static under reduced motion. */
'use strict';
(function(){
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fx = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();
const NUM = `font-family="ui-monospace,SF Mono,Menlo,monospace"`;
const UI = `font-family="-apple-system,system-ui,sans-serif"`;
let uid = 0; const id = p => `${p}${++uid}`;

/* smooth path through points (monotone-ish Catmull-Rom, clamped so it never overshoots below 0) */
function smooth(pts){ if(pts.length < 2) return ''; let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for(let i = 0; i < pts.length - 1; i++){ const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2; const t = .18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t], c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    const lo = Math.max(p1[1], p2[1]); c1[1] = Math.min(c1[1], lo + 0); c2[1] = Math.min(c2[1], lo + 0);
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; }
  return d; }

/* 1 · Sim distribution: smooth density of the 10,000 replays. The line is a crisp marker; the bet side fills in edge,
   the other side stays muted. The chance rides on the curve. */
function density(o){ const H = o.hist; if(!H || !H.counts || !H.counts.length) return '';
  const W = o.w || 600, Ht = o.h || 220, pb = 24, pt = 18, n = H.counts.length, mx = Math.max(...H.counts), side = o.side || 'over';
  const x = v => 8 + (v - H.lo) / (H.step * n) * (W - 16), y = c => Ht - pb - c / mx * (Ht - pb - pt);
  const pts = H.counts.map((c, i) => [x(H.lo + (i + .5) * H.step), y(c)]); pts.unshift([x(H.lo), Ht - pb]); pts.push([x(H.lo + n * H.step), Ht - pb]);
  const curve = smooth(pts); const area = `${curve} L${x(H.lo + n * H.step)},${Ht - pb} L${x(H.lo)},${Ht - pb} Z`;
  const L = o.line, lx = Math.max(8, Math.min(W - 8, x(L))); const cid = id('cl'), cid2 = id('cm');
  const winLeft = side === 'under'; const clipWin = winLeft ? `<rect x="0" y="0" width="${lx}" height="${Ht}"/>` : `<rect x="${lx}" y="0" width="${W - lx}" height="${Ht}"/>`;
  const clipLose = winLeft ? `<rect x="${lx}" y="0" width="${W - lx}" height="${Ht}"/>` : `<rect x="0" y="0" width="${lx}" height="${Ht}"/>`;
  const pk = H.counts.indexOf(mx); const lab = o.pLabel; const labX = winLeft ? Math.max(40, lx - 70) : Math.min(W - 40, lx + 70);
  const ly = (() => { const i = Math.max(0, Math.min(n - 1, Math.round(((winLeft ? lx - 70 : lx + 70) - 8) / (W - 16) * n - .5))); return Math.max(pt + 22, y(H.counts[i]) - 14); })();
  const proj = o.proj != null ? `<line x1="${x(o.proj)}" x2="${x(o.proj)}" y1="${y(H.counts[Math.min(n - 1, Math.max(0, Math.floor((o.proj - H.lo) / H.step)))])}" y2="${Ht - pb}" stroke="var(--t3)" stroke-width="1" stroke-dasharray="2 3"/>` : '';
  const actual = o.actual != null && o.actual >= H.lo && o.actual <= H.lo + n * H.step ? `<g><line x1="${x(o.actual)}" x2="${x(o.actual)}" y1="${pt}" y2="${Ht - pb}" stroke="var(--live)" stroke-width="1.5"/><text x="${Math.max(30, Math.min(W - 30, x(o.actual)))}" y="${pt - 4}" fill="var(--live)" font-size="13" text-anchor="middle" ${NUM}>final ${fx(o.actual)}</text></g>` : '';
  return `<svg class="ch ch-density" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(o.aria || `Distribution of ${(H.n || 10000).toLocaleString()} replays, line ${L}`)}">
    <defs><clipPath id="${cid}">${clipWin}</clipPath><clipPath id="${cid2}">${clipLose}</clipPath></defs>
    <path d="${area}" fill="var(--s3)" clip-path="url(#${cid2})"/>
    <path d="${area}" fill="${o.color || 'var(--edge)'}" fill-opacity=".22" clip-path="url(#${cid})"/>
    <path class="draw" d="${curve}" fill="none" stroke="var(--t2)" stroke-width="1.5" pathLength="1"/>
    <path d="${curve}" fill="none" stroke="${o.color || 'var(--edge)'}" stroke-width="2" clip-path="url(#${cid})" class="draw" pathLength="1"/>
    ${proj}
    <line x1="${lx}" x2="${lx}" y1="${pt - 6}" y2="${Ht - pb + 6}" stroke="var(--t1)" stroke-width="2"/>
    <text x="${lx}" y="${Ht - 8}" fill="var(--t1)" font-size="13" text-anchor="middle" ${NUM}>${fx(L)}</text>
    ${lab ? `<text x="${labX}" y="${ly}" fill="${o.color || 'var(--edge)'}" font-size="22" font-weight="700" text-anchor="middle" ${NUM}>${lab}</text>` : ''}
    ${actual}
    <line x1="8" x2="${W - 8}" y1="${Ht - pb}" y2="${Ht - pb}" stroke="var(--hair2)" stroke-width="1"/>
  </svg>`; }

/* 2 · The Overlay ring: model chance as an arc, break-even as a brass tick, the overlay as the green slice past the tick */
function ring(o){ const S = o.size || 132, sw = o.stroke || 12, r = (S - sw) / 2 - 2, C = 2 * Math.PI * r, p = Math.max(0, Math.min(1, o.p || 0)), be = o.be;
  const over = be != null && p > be, a = over ? be : p, g = over ? p - be : 0, ang = t => -Math.PI / 2 + t * 2 * Math.PI, c = S / 2;
  const tick = be == null ? '' : (() => { const t = ang(be), r0 = r - sw * .95, r1 = r + sw * .95; return `<line x1="${c + r0 * Math.cos(t)}" y1="${c + r0 * Math.sin(t)}" x2="${c + r1 * Math.cos(t)}" y2="${c + r1 * Math.sin(t)}" stroke="var(--brass)" stroke-width="${Math.max(2, sw * .22)}" stroke-linecap="round"/>`; })();
  const main = o.pass ? 'var(--pass)' : 'var(--t1)';
  return `<svg class="ch ch-ring" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Model chance ${Math.round(p * 100)} percent${be != null ? `, price needs ${fx(be * 100)} percent` : ''}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--s3)" stroke-width="${sw}"/>
    <circle class="sweep" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${main}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${C * a} ${C}" transform="rotate(-90 ${c} ${c})" style="--len:${C * a}"/>
    ${g > 0 ? `<circle class="sweep sweep2" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--edge)" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${C * g} ${C}" transform="rotate(${-90 + a * 360} ${c} ${c})" style="--len:${C * g}"/>` : ''}
    ${tick}
    ${o.label !== false ? `<text x="${c}" y="${c + S * .07}" text-anchor="middle" fill="var(--t1)" font-size="${S * .23}" font-weight="700" letter-spacing="-1" ${NUM}>${Math.round(p * 100)}<tspan font-size="${S * .11}" fill="var(--t2)" font-weight="500">%</tspan></text>` : ''}
  </svg>`; }

/* 3 · Probability meter: thin bar, break-even marked; "clears the break-even" readable in a split second */
function meter(o){ const p = Math.max(0, Math.min(1, o.p)), be = o.be, clear = be != null && p - be >= .05;
  return `<div class="meter${clear ? ' is-clear' : ''}" role="img" aria-label="${o.label || 'Chance'} ${Math.round(p * 100)} percent${be != null ? `, break-even ${fx(be * 100)} percent` : ''}">
    <div class="meter-track"><span class="meter-fill" style="--v:${p}"></span>${be != null ? `<i class="meter-be" style="--v:${be}"></i>` : ''}</div>
    <div class="meter-labels"><span>${esc(o.label || '')}</span><b class="num">${Math.round(p * 100)}<small>%</small></b></div></div>`; }

/* 4 · Calibration: predicted vs actual on the diagonal, dots sized by sample */
function calibration(o){ const P = o.points || []; if(!P.length) return ''; const W = o.w || 600, H = o.h || 400, pl = 34, pb = 40, pr = 12, ptp = 24;
  const X = v => pl + v * (W - pl - pr), Y = v => H - pb - v * (H - pb - ptp); const mx = Math.max(...P.map(p => p[2]));
  const ticks = [0, .25, .5, .75, 1];
  return `<svg class="ch ch-cal" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration of ${P.reduce((a, p) => a + p[2], 0).toLocaleString()} graded props">
    ${ticks.map(v => `<text x="${X(0) - 10}" y="${Y(v) + 6}" text-anchor="end" fill="var(--t3)" font-size="12" ${NUM}>${v * 100}</text><text x="${X(v)}" y="${H - pb + 18}" text-anchor="middle" fill="var(--t3)" font-size="12" ${NUM}>${v * 100}</text>`).join('')}
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--brass)" stroke-width="1.5" stroke-dasharray="4 6"/>
    <text x="${X(.78)}" y="${Y(.78) - 12}" fill="var(--brass)" font-size="13" ${UI} text-anchor="end">perfect</text>
    <polyline class="draw" pathLength="1" fill="none" stroke="var(--t2)" stroke-width="1.5" points="${P.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}"/>
    ${P.map(p => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${5 + 15 * Math.sqrt(p[2] / mx)}" fill="var(--edge)" fill-opacity=".22" stroke="var(--edge)" stroke-width="1.5"/>`).join('')}
    <text x="${X(1)}" y="${H - 2}" text-anchor="end" fill="var(--t2)" font-size="13" ${UI}>model's chance, %</text>
    <text x="${X(0)}" y="${ptp - 10}" fill="var(--t2)" font-size="13" ${UI}>actual hit %</text>
  </svg>`; }

/* 5 · Bankroll: a Stocks-style line with a scrubbable crosshair (wire with charts.scrub) */
function bankroll(o){ const P = o.points || []; if(P.length < 2) return ''; const W = o.w || 600, H = o.h || 220, pt = 20, pb = 28;
  const vs = P.map(p => p.v), mn = Math.min(...vs, o.base ?? vs[0]), mx = Math.max(...vs, o.base ?? vs[0]);
  const X = i => 8 + i / (P.length - 1) * (W - 16), Y = v => H - pb - (v - mn) / ((mx - mn) || 1) * (H - pt - pb);
  const up = vs[vs.length - 1] >= (o.base ?? vs[0]); const col = up ? 'var(--edge)' : 'var(--loss)'; const gid = id('bg');
  const line = P.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  return `<svg class="ch ch-bank" viewBox="0 0 ${W} ${H}" data-scrub='${esc(JSON.stringify(P.map((p, i) => [X(i), Y(p.v), p.v, p.t || ''])))}' role="img" aria-label="Bankroll from ${vs[0]} to ${vs[vs.length - 1]}">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${up ? '#46C98A' : '#F07272'}" stop-opacity=".22"/><stop offset="1" stop-color="${up ? '#46C98A' : '#F07272'}" stop-opacity="0"/></linearGradient></defs>
    ${o.base != null ? `<line x1="8" x2="${W - 8}" y1="${Y(o.base)}" y2="${Y(o.base)}" stroke="var(--hair2)" stroke-dasharray="3 5"/>` : ''}
    <path d="${line} L${X(P.length - 1)},${H - pb} L${X(0)},${H - pb} Z" fill="url(#${gid})"/>
    <path class="draw" pathLength="1" d="${line}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(P.length - 1)}" cy="${Y(vs[vs.length - 1])}" r="4.5" fill="${col}"/>
    <g class="scrub" style="opacity:0"><line class="sx" y1="${pt - 8}" y2="${H - pb}" stroke="var(--t2)" stroke-width="1"/><circle class="sc" r="5.5" fill="var(--t1)" stroke="var(--s0)" stroke-width="2"/></g>
  </svg>`; }
function scrub(svg, onMove){ if(!svg) return; const P = JSON.parse(svg.dataset.scrub || '[]'); const g = svg.querySelector('.scrub'), lx = svg.querySelector('.sx'), cc = svg.querySelector('.sc'); if(!P.length) return;
  const vb = svg.viewBox.baseVal; const at = e => { const r = svg.getBoundingClientRect(); const x = (('touches' in e ? e.touches[0].clientX : e.clientX) - r.left) / r.width * vb.width; let k = 0; P.forEach((p, i) => { if(Math.abs(p[0] - x) < Math.abs(P[k][0] - x)) k = i; }); return k; };
  const show = e => { const k = at(e); const p = P[k]; g.style.opacity = 1; lx.setAttribute('x1', p[0]); lx.setAttribute('x2', p[0]); cc.setAttribute('cx', p[0]); cc.setAttribute('cy', p[1]); onMove && onMove(p, k); };
  const hide = () => { g.style.opacity = 0; onMove && onMove(null); };
  svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); show(e); }); svg.addEventListener('pointermove', e => { if(e.buttons || e.pointerType === 'mouse') show(e); });
  svg.addEventListener('pointerup', hide); svg.addEventListener('pointerleave', hide); svg.style.touchAction = 'pan-y'; }

/* 6a · 25D hero, prototype A: radial fingerprint. 25 spokes; push factors glow outward, pull factors recede inward */
function fingerprint(o){ const Q = o.q25 || []; if(!Q.length) return ''; const S = o.size || 320, c = S / 2, r0 = S * .2, rMax = S * .46, mx = Math.max(...Q.map(q => Math.abs(q[2]))) || 1;
  const fam = {A: 0, B: 1, C: 2, D: 3, E: 4};
  const spokes = Q.map((q, i) => { const a = -Math.PI / 2 + i / Q.length * 2 * Math.PI, v = q[2] / mx; const len = Math.abs(v) * (v >= 0 ? rMax - r0 : r0 * .82);
    const x0 = c + r0 * Math.cos(a), y0 = c + r0 * Math.sin(a), x1 = c + (r0 + (v >= 0 ? len : -len)) * Math.cos(a), y1 = c + (r0 + (v >= 0 ? len : -len)) * Math.sin(a);
    return `<line class="spoke" style="--i:${i}" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${v >= 0 ? 'var(--edge)' : 'var(--loss)'}" stroke-opacity="${v >= 0 ? .55 + .45 * Math.abs(v) : .35 + .4 * Math.abs(v)}" stroke-width="${S * .016}" stroke-linecap="round"><title>${esc(q[1])}: ${q[2] > 0 ? '+' : ''}${fx(q[2], 2)}</title></line>`; }).join('');
  const famTicks = ['A', 'B', 'C', 'D', 'E'].map((f, k) => { const i0 = Q.findIndex(q => q[0][0] === f); if(i0 < 0) return ''; const a = -Math.PI / 2 + (i0 - .5) / Q.length * 2 * Math.PI; return `<line x1="${c + (r0 - 4) * Math.cos(a)}" y1="${c + (r0 - 4) * Math.sin(a)}" x2="${c + (rMax + 6) * Math.cos(a)}" y2="${c + (rMax + 6) * Math.sin(a)}" stroke="var(--hair)" stroke-width="1"/>`; }).join('');
  const famLabels = ['Role', 'Form', 'Matchup', 'Game setup', 'History'].map((nm, k) => { const ids = Q.map((q, i) => q[0][0] === 'ABCDE'[k] ? i : -1).filter(i => i >= 0); if(!ids.length) return ''; const mid = (ids[0] + ids[ids.length - 1]) / 2; const a = -Math.PI / 2 + mid / Q.length * 2 * Math.PI; const rr = rMax + S * .065;
    return `<text x="${c + rr * Math.cos(a)}" y="${c + rr * Math.sin(a) + 5}" text-anchor="middle" fill="var(--t3)" font-size="${S * .04}" ${UI} letter-spacing=".5">${nm.toUpperCase()}</text>`; }).join('');
  return `<svg class="ch ch-fp" viewBox="${-S * .06} ${-S * .06} ${S * 1.12} ${S * 1.12}" role="img" aria-label="25 question report card fingerprint, score ${o.score}">
    <circle cx="${c}" cy="${c}" r="${rMax}" fill="none" stroke="var(--hair)"/><circle cx="${c}" cy="${c}" r="${r0}" fill="none" stroke="var(--hair2)"/>
    ${famTicks}${spokes}${famLabels}
    <text x="${c}" y="${c + S * .03}" text-anchor="middle" fill="var(--t1)" font-size="${S * .1}" font-weight="700" letter-spacing="-1" ${NUM}>${o.score > 0 ? '+' : ''}${fx(o.score, 1)}</text>
    <text x="${c}" y="${c + S * .085}" text-anchor="middle" fill="var(--t3)" font-size="${S * .036}" ${UI} letter-spacing=".6">25D</text>
  </svg>`; }

/* 6b · 25D hero, prototype B: diverging bar stack sorted by impact */
function diverging(o){ const Q = (o.q25 || []).slice().sort((a, b) => b[2] - a[2]); if(!Q.length) return ''; const W = o.w || 600, rh = o.rh || 26, H = Q.length * rh + 10, labEnd = W * .43, mid = W * .72, half = W * .26, mx = Math.max(...Q.map(q => Math.abs(q[2]))) || 1;
  return `<svg class="ch ch-div" viewBox="0 0 ${W} ${H}" role="img" aria-label="25 questions sorted by impact">
    <line x1="${mid}" x2="${mid}" y1="0" y2="${H}" stroke="var(--hair2)"/>
    ${Q.map((q, i) => { const y = i * rh + 4, v = q[2] / mx, w = Math.abs(v) * half; return `<g class="bar-row" style="--i:${i}">
      <text x="${labEnd}" y="${y + rh * .66}" text-anchor="end" fill="${Math.abs(v) > .25 ? 'var(--t1)' : 'var(--t2)'}" font-size="13" ${UI}>${esc(q[1])}</text>
      <rect x="${v >= 0 ? mid : mid - w}" y="${y + rh * .2}" width="${Math.max(1.5, w)}" height="${rh * .56}" rx="${rh * .2}" fill="${v >= 0 ? 'var(--edge)' : 'var(--loss)'}" fill-opacity="${.45 + .55 * Math.abs(v)}"/>
      <text x="${v >= 0 ? mid - 6 : mid + 6}" y="${y + rh * .66}" text-anchor="${v >= 0 ? 'end' : 'start'}" fill="var(--t3)" font-size="11" ${NUM}>${q[2] > 0 ? '+' : ''}${fx(q[2], 2)}</text></g>`; }).join('')}
  </svg>`; }

window.Charts = {density, ring, meter, calibration, bankroll, scrub, fingerprint, diverging};
})();
