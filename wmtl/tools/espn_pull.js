/* Overlay · ESPN collector. Run in a browser tab on https://www.espn.com (ESPN's own site API, same origin family).
   It reads only ESPN: scoreboards for the dates/weeks you pass, then each final game's summary (box score).
   Usage in the page console:
     await harvest2('nfl', 'football/nfl', nflScoreboardUrls, ['passing','rushing','receiving','kicking','defensive']);
     await harvest2('cfb', 'football/college-football', cfbScoreboardUrls, ['passing','rushing','receiving','kicking']);
     await harvest2('nba', 'basketball/nba', nbaDailyScoreboardUrls, null);
     copy(await pack3(H.out.nfl, KEEP_FOOTBALL))   // gzip+base64; decode with tools/espn_unpack.py
   Scoreboard URL patterns:
     https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=9
     https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=2026&seasontype=2&week=10&groups=80&limit=400
     https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261104 */
window.H = window.H || {log: [], out: {}};
const KEEP_FOOTBALL = ['passing:C/ATT','passing:YDS','passing:TD','passing:INT','rushing:CAR','rushing:YDS','rushing:TD','receiving:REC','receiving:YDS','receiving:TD','receiving:TGTS','kicking:FG','kicking:XP','kicking:PTS','defensive:TOT'];
const KEEP_NBA = ['all:MIN','all:PTS','all:REB','all:AST','all:3PT','all:STL','all:BLK','all:TO','all:FG'];
window.harvest2 = async function(key, sportPath, scoreboardUrls, want){
  const st = H.out[key] = {status: 'scoreboards', events: [], rows: [], games: [], fails: 0, done: 0};
  const seen = new Set();
  for(const u of scoreboardUrls){ try{ const j = await fetch(u, {cache: 'no-store'}).then(r => r.json()); for(const e of (j.events || [])){ if(seen.has(e.id)) continue; const c = e.competitions[0]; if(!c || !c.status || !c.status.type.completed) continue; seen.add(e.id); st.events.push({id: e.id, date: e.date, wk: e.week && e.week.number, st: e.season && e.season.type}); } }catch(err){ st.fails++; } }
  st.status = 'summaries';
  const q = st.events.slice(); const work = async () => { while(q.length){ const e = q.shift();
    try{ const s = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${e.id}`, {cache: 'no-store'}).then(r => r.json());
      const comp = s.header.competitions[0]; const T = {}; comp.competitors.forEach(x => T[x.team.id] = {ab: x.team.abbreviation, loc: x.team.location, nm: x.team.displayName, home: x.homeAway === 'home', sc: Number(x.score)});
      const h = Object.values(T).find(t => t.home), a = Object.values(T).find(t => !t.home);
      st.games.push([e.id, e.date, e.wk, a.ab, a.loc, a.sc, h.ab, h.loc, h.sc, e.st]);
      for(const tp of (s.boxscore.players || [])){ const me = T[tp.team.id]; const op = Object.values(T).find(t => t !== me); const P = {};
        for(const cat of tp.statistics){ const ck = cat.name || 'all'; if(want && !want.includes(ck)) continue; const labels = cat.labels || cat.keys || [];
          for(const a2 of cat.athletes){ const p = P[a2.athlete.id] || (P[a2.athlete.id] = {id: a2.athlete.id, n: a2.athlete.displayName, pos: a2.athlete.position && a2.athlete.position.abbreviation, dnp: a2.didNotPlay || false, st: {}}); (a2.stats || []).forEach((v, i) => { p.st[ck + ':' + labels[i]] = v; }); if(a2.starter) p.starter = true; } }
        for(const p of Object.values(P)) st.rows.push([e.id, e.date.slice(0, 10), e.wk, me.ab, op.ab, me.home ? 1 : 0, me.sc, op.sc, p.id, p.n, p.pos, p.dnp ? 1 : 0, p.st, p.starter ? 1 : 0, e.st, me.loc, op.loc]); }
    }catch(err){ st.fails++; } st.done++; } };
  await Promise.all(Array.from({length: 8}, work)); st.status = 'done'; return st.events.length; };
window.pack3 = async function(o, keep){
  const G = new Map(), GL = [], PL = [], PI = new Map(); const rows = [];
  const num = v => { if(v === '' || v == null) return null; if(/^\d+[-/]\d+$/.test(v)) return v.split(/[-/]/).map(Number); const n = Number(v); return isFinite(n) ? n : v; };
  for(const r of o.rows){ let gi = G.get(r[0]); if(gi === undefined){ gi = GL.length; G.set(r[0], gi); GL.push([r[0], r[1], r[2], r[14]]); }
    let pi = PI.get(r[8]); if(pi === undefined){ pi = PL.length; PI.set(r[8], pi); PL.push([r[8], r[9], r[10] || '']); }
    rows.push([gi, pi, r[3], r[4], r[5], r[6], r[7], r[11], r[13], keep.map(k => num(r[12][k])), r[15] || '', r[16] || '']); }
  const s = JSON.stringify({keep, games: GL, players: PL, rows, finals: o.games || []});
  const cs = new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer()); let bin = ''; for(let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(bin); };
/* Also save every game's start time (ESPN dates are UTC; the builder converts to Eastern):
   copy(JSON.stringify(Object.fromEntries(Object.values(H.out).flatMap(o => o.events.map(e => [e.id, e.date]))))) -> raw/espn/kick_times.json */
