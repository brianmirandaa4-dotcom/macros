/* tail. team marks: official logos from ESPN's CDN (approved source) on a glossy chip lit in the team's own colour */
(function(){
const ESPN = {LA: 'lar', WAS: 'wsh'};
const COL = {ARI:'#B3274A',ATL:'#C8203A',BAL:'#6A4CD8',BUF:'#2F6BE0',CAR:'#1D9BE0',CHI:'#E05A1A',CIN:'#FB4F14',CLE:'#FF5A1F',DAL:'#3A6FD8',DEN:'#FB6A2C',DET:'#1C8FD6',GB:'#3C8A5F',
  HOU:'#C62A3E',IND:'#2D6BD0',JAX:'#14A3B0',KC:'#E8263F',LV:'#B9C0C4',LAC:'#1A9BE6',LA:'#3B63E0',MIA:'#14B3BB',MIN:'#7A4BC8',NE:'#3A5FA8',NO:'#D9C391',NYG:'#3354C8',NYJ:'#24A06E',
  PHI:'#1A8A93',PIT:'#FFB612',SF:'#D42020',SEA:'#69BE28',TB:'#E5262A',TEN:'#4B92DB',WAS:'#B53A2E'};
const url = a => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${ESPN[a] || String(a).toLowerCase()}.png&w=96&h=96`;
window.TCOL = a => COL[a] || '#8A8F98';
/* sport-aware: TL(a, cls, 'NBA') hands off to nba.js's TLN (NBA codes collide with NFL ones: DAL, DEN, MIA…); no sport = NFL, as before */
window.TL = (a, cls = '', sport) => sport && sport !== 'NFL' ? (sport === 'NBA' && window.TLN ? TLN(a, cls) : '') : COL[a] ? `<i class="tl ${cls}" style="--tc:${COL[a]}" aria-hidden="true"><img src="${url(a)}" alt="" decoding="async" onerror="this.parentNode.classList.add('nologo')"></i>` : '';
})();
