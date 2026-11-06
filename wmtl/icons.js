/* Overlay · icon set. One 24pt grid, one 1.75 stroke, round caps and joins, no fills except tiny dots.
   Icon.svg(name, {size, label}) returns markup; decorative by default (aria-hidden). */
'use strict';
(function(){
const P = {
  /* tabs */
  lobby:   '<path d="M4 20V10.5L12 4l8 6.5V20"/><circle cx="12" cy="13.5" r="3.2"/><path d="M12 10.3a3.2 3.2 0 0 1 3.1 2.4"/>',
  card:    '<path d="M5 4.5h14a1 1 0 0 1 1 1V9a2.4 2.4 0 0 0 0 4.8v3.7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3.7A2.4 2.4 0 0 0 4 9V5.5a1 1 0 0 1 1-1Z"/><path d="M9 9.5h6M9 13.5h3.5"/>',
  props:   '<path d="M4 19.5h16"/><path d="M7 19.5v-5M12 19.5V6M17 19.5v-9"/><circle cx="12" cy="4.6" r=".9" fill="currentColor" stroke="none"/>',
  live:    '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/><path d="M19.5 5.5l1.2-1.2M4.5 5.5 3.3 4.3"/>',
  more:    '<circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  bets:    '<rect x="3.5" y="6" width="17" height="12.5" rx="2.5"/><path d="M3.5 10h17M7 14.5h4"/>',
  /* sports */
  nfl:     '<path d="M5 19c-1.5-1.5-1.3-6.2 2.3-9.8S17.5 3.5 19 5s1.3 6.2-2.3 9.8S6.5 20.5 5 19Z"/><path d="M9 15l6-6M10.6 11.2l2.2 2.2M12.4 9.4l2.2 2.2"/>',
  cfb:     '<path d="M5 3.5v17"/><path d="M5 4.5l14 4-14 4"/><path d="M9 7.6v2.1"/>',
  nba:     '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4v16"/><path d="M6.2 6.4c2.6 2.4 2.6 8.8 0 11.2M17.8 6.4c-2.6 2.4-2.6 8.8 0 11.2"/>',
  nhl:     '<path d="M7 3.5 13 16c.4.8 1.2 1.5 2.2 1.5H20"/><ellipse cx="7.5" cy="18.5" rx="3.5" ry="1.5"/>',
  mlb:     '<circle cx="12" cy="12" r="8"/><path d="M7.2 5.6c1.9 1.7 2.8 4 2.8 6.4s-.9 4.7-2.8 6.4M16.8 5.6c-1.9 1.7-2.8 4-2.8 6.4s.9 4.7 2.8 6.4"/>',
  /* prop types */
  pass_yds:'<path d="M4 17c3-7 9-10.5 16-11"/><path d="M16.5 3.5 20 6l-2.6 3.3"/><circle cx="5" cy="18" r="1.4"/>',
  rush_yds:'<path d="M4 12h14"/><path d="M14.5 8 18.5 12l-4 4"/><path d="M4 8h5M4 16h5"/>',
  rec_yds: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  receptions:'<path d="M6 10.5V8a2 2 0 0 1 4 0v4M10 9.5V7a2 2 0 0 1 4 0v5M14 10V8.5a2 2 0 0 1 4 0V14a6 6 0 0 1-6 6h-.5A5.5 5.5 0 0 1 6 14.5V12"/>',
  qb_rush: '<path d="M4 12h14"/><path d="M14.5 8 18.5 12l-4 4"/><circle cx="6.5" cy="7" r="1.8"/>',
  atd:     '<path d="M6 20.5V4"/><path d="M6 4.5h11l-2.5 3.5L17 11.5H6"/>',
  qb_atd:  '<path d="M6 20.5V4"/><path d="M6 4.5h11l-2.5 3.5L17 11.5H6"/>',
  kicker:  '<path d="M7 3.5v9h10v-9"/><path d="M12 12.5v8"/><path d="M5 20.5h14"/>',
  pts:     '<circle cx="12" cy="13" r="6.5"/><path d="M5.5 13h13M12 6.5v13"/><path d="M7 3.5h10"/>',
  reb:     '<path d="M5 19c0-6 3-11 9-12.5"/><path d="M11 3.5 14.5 6.5 11.5 10"/><path d="M19 19H9"/>',
  ast:     '<circle cx="6" cy="16.5" r="2.5"/><circle cx="18" cy="7.5" r="2.5"/><path d="M8.2 15 15.8 9"/><path d="M13.2 8.6l2.6.4-.5 2.6"/>',
  tpm:     '<path d="M3.5 18.5a8.5 8.5 0 0 1 17 0"/><path d="M9.5 9.5h4a1.6 1.6 0 0 1 0 3.2h-2.5h2.5a1.6 1.6 0 0 1 0 3.2h-4"/>',
  pra:     '<path d="M4 19.5h16"/><path d="M7 19.5V14M12 19.5V9M17 19.5V5"/>', pr: '<path d="M4 19.5h16"/><path d="M8 19.5v-7M16 19.5V7"/>', pa: '<path d="M4 19.5h16"/><path d="M8 19.5v-7M16 19.5V7"/>', ra: '<path d="M4 19.5h16"/><path d="M8 19.5v-7M16 19.5V7"/>',
  stl:     '<path d="M5 15.5 10 10l3 3 6-6.5"/><path d="M15 6.5h4v4"/>', blk: '<path d="M6 19.5v-6a6 6 0 0 1 12 0v6"/><path d="M4 19.5h16"/>', tov: '<path d="M6 6l12 12M18 6 6 18"/>',
  /* actions */
  plus:    '<path d="M12 5v14M5 12h14"/>',
  check:   '<path d="M5 12.5 9.5 17 19 7.5"/>',
  close:   '<path d="M6 6l12 12M18 6 6 18"/>',
  back:    '<path d="M15 5l-7 7 7 7"/>',
  chev:    '<path d="M9 6l6 6-6 6"/>',
  down:    '<path d="M6 9.5l6 6 6-6"/>',
  share:   '<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M5 11.5v7A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-7"/>',
  search:  '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  board:   '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4h-4"/>',
  import:  '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19.5h14"/>',
  gear:    '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  info:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',
  learn:   '<path d="M12 6.5C10 5 7 4.6 4 5v13c3-.4 6 0 8 1.5 2-1.5 5-1.9 8-1.5V5c-3-.4-6 0-8 1.5Z"/><path d="M12 6.5V19"/>',
  lines:   '<path d="M4 7h10M4 12h16M4 17h7"/><circle cx="18" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  parlay:  '<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="17.5" r="2.5"/><path d="M8 8.5l2.8 6.6M16 8.5l-2.8 6.6"/>',
  results: '<path d="M4 19.5V5M4 19.5h16"/><path d="M7.5 15l4-4 3 3 5-6"/>',
  ring:    '<circle cx="12" cy="12" r="7.5" opacity=".35"/><path d="M12 4.5a7.5 7.5 0 0 1 5.3 12.8"/><path d="M17.3 17.3a7.5 7.5 0 0 1-3.2 1.9" stroke="var(--edge)"/><circle cx="12" cy="12" r="1.2" fill="var(--brass)" stroke="none"/>'
};
function svg(name, o = {}){ const d = P[name] || P.info; const s = o.size || 24;
  return `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${o.stroke || 1.75}" stroke-linecap="round" stroke-linejoin="round" ${o.label ? `role="img" aria-label="${o.label}"` : 'aria-hidden="true"'}>${d}</svg>`; }
window.Icon = {svg, names: Object.keys(P)};
})();
