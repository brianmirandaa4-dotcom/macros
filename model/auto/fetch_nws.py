"""National Weather Service hourly forecasts (api.weather.gov only) for this week's not-started games at open-air stadiums.

    python3 model/auto/fetch_nws.py --games model/nfl/work/upcoming_games.json --out model/nfl/raw/nws/weather.json

Input: [{game_id, kick_utc, stadium_id, roof}] (written by run.py from the nflverse schedule).
A forecast is pulled only where nflverse marks the roof 'outdoors' or 'open' and the stadium is in the US table below
(domes, closed or unknown roofs, and international venues get none, so the model keeps its existing defaults there).
Output: {"ts", "games": {game_id: {temp_f, wind_mph, short, pop, period_start, status}}}
  wind_mph = the midpoint of NWS's "5 to 10 mph" style range (one number, as the nflverse wind field is).
"""
import argparse, os, re, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from concurrent.futures import ThreadPoolExecutor
from common import need, http_json, write_json, read_json, now_utc, iso, parse_ts, log, SchemaError

# nflverse stadium_id -> (lat, lon): US open-air and retractable-roof NFL stadiums (forecast grid lookup only)
STADIUMS = {
    'BAL00': (39.2780, -76.6227), 'BOS00': (42.0909, -71.2643), 'BUF00': (42.7738, -78.7870), 'CAR00': (35.2258, -80.8528), 'CHI98': (41.8623, -87.6167),
    'CIN00': (39.0955, -84.5161), 'CLE00': (41.5061, -81.6995), 'DEN00': (39.7439, -105.0201), 'GNB00': (44.5013, -88.0622), 'JAX00': (30.3239, -81.6373),
    'KAN00': (39.0489, -94.4839), 'MIA00': (25.9580, -80.2389), 'NAS00': (36.1665, -86.7713), 'NYC01': (40.8135, -74.0745), 'PHI00': (39.9008, -75.1675),
    'PIT00': (40.4468, -80.0158), 'SEA00': (47.5952, -122.3316), 'SFO01': (37.4030, -121.9700), 'TAM00': (27.9759, -82.5033), 'WAS00': (38.9076, -76.8645),
    'ATL97': (33.7554, -84.4008), 'IND00': (39.7601, -86.1639), 'DAL00': (32.7473, -97.0945), 'HOU00': (29.6847, -95.4107), 'PHO00': (33.5276, -112.2626),
}
OPEN_ROOFS = ('outdoors', 'open')
HDR = {'Accept': 'application/geo+json'}


def mph(s):
    nums = [float(x) for x in re.findall(r'\d+(?:\.\d+)?', str(s or ''))]
    return round(sum(nums) / len(nums), 1) if nums else None


def forecast(g, cache):
    lat, lon = STADIUMS[g['stadium_id']]
    key = f'{lat:.4f},{lon:.4f}'
    url = cache.get(key)
    if not url:
        p = http_json(f'https://api.weather.gov/points/{key}', headers=HDR, what='nws points')
        url = need(p, 'properties.forecastHourly', str, 'nws points'); cache[key] = url
    f = http_json(url, headers=HDR, what='nws hourly')
    per = need(f, 'properties.periods', list, 'nws hourly')
    k = parse_ts(g['kick_utc'])
    for p in per:
        for fld in ('startTime', 'endTime', 'temperature', 'windSpeed'):
            if fld not in p: raise SchemaError(f'nws hourly period missing {fld}')
        if parse_ts(p['startTime']) <= k < parse_ts(p['endTime']):
            t = float(p['temperature']); t = t * 9 / 5 + 32 if p.get('temperatureUnit') == 'C' else t
            pop = (p.get('probabilityOfPrecipitation') or {}).get('value')
            return dict(temp_f=round(t, 1), wind_mph=mph(p['windSpeed']), short=p.get('shortForecast'), pop=pop, period_start=p['startTime'], status='ok')
    return dict(status='kickoff beyond the forecast range' if per and parse_ts(per[-1]['endTime']) <= k else 'no matching period')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--games', required=True); ap.add_argument('--out', required=True); ap.add_argument('--cache')
    a = ap.parse_args()
    games = read_json(a.games, []) or []
    cache = read_json(a.cache, {}) if a.cache else {}
    todo = [g for g in games if str(g.get('roof')) in OPEN_ROOFS and g.get('stadium_id') in STADIUMS]
    out = {g['game_id']: dict(status=f"no forecast: roof {g.get('roof')}" if str(g.get('roof')) not in OPEN_ROOFS else 'no forecast: venue outside NWS coverage') for g in games if g not in todo}
    def job(g):
        try: return g['game_id'], forecast(g, cache)
        except Exception as e: return g['game_id'], dict(status=f'error {str(e)[:160]}')     # noqa: BLE001
    with ThreadPoolExecutor(4) as ex:
        for gid, r in ex.map(job, todo): out[gid] = r
    write_json(a.out, dict(ts=iso(now_utc()), source='api.weather.gov hourly forecast', games=out))
    if a.cache: write_json(a.cache, cache)
    log('nws', sum(1 for v in out.values() if v.get('status') == 'ok'), 'forecasts of', len(todo), 'open-air games')


if __name__ == '__main__':
    main()
