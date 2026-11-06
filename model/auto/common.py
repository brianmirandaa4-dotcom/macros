"""Shared helpers for the headless tail. refresh (GitHub Actions). Standard library only, so the gate can import it
without installing the model's requirements.

Layout (all overridable by env, so tests and local dry runs never touch the real app):
  REPO        repo checkout (default: two levels above this file)
  NFL_HOME    model/nfl            src/ (committed), raw/ and work/ (created at runtime, never committed)
  WMTL_DATA   wmtl/data            the published app data (the only thing the workflow commits, plus sw.js)
  STATE       wmtl/data/nfl/state  live parameters + captured lines + input snapshot (published with the data)
"""
import json, os, sys, time, datetime as dt, urllib.request, urllib.error, gzip, io, hashlib, shutil, tempfile
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo('America/New_York')
AUTO = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get('REPO') or os.path.dirname(os.path.dirname(AUTO))
MODEL = os.path.join(REPO, 'model')
NFL_HOME = os.environ.get('NFL_HOME') or os.path.join(MODEL, 'nfl')
RAW = os.path.join(NFL_HOME, 'raw'); WORK = os.path.join(NFL_HOME, 'work'); SRC = os.path.join(NFL_HOME, 'src')
WMTL = os.environ.get('WMTL_DIR') or os.path.join(REPO, 'wmtl')
DATA = os.environ.get('WMTL_DATA') or os.path.join(WMTL, 'data')
STATE_REL = 'nfl/state'
SEED = os.path.join(MODEL, 'seed')
SEASON = int(os.environ.get('TAIL_SEASON', 2026))
UA = 'tail-refresh/1.0 (github.com/brianmirandaa4-dotcom/macros; public NFL prop model)'
BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'


def now_utc():
    """Current time; TAIL_NOW (ISO 8601) pins it for tests and replays."""
    v = os.environ.get('TAIL_NOW')
    if v: return dt.datetime.fromisoformat(v.replace('Z', '+00:00')).astimezone(UTC)
    return dt.datetime.now(UTC)


def iso(t): return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_ts(s):
    if s is None: return None
    if isinstance(s, (int, float)): return dt.datetime.fromtimestamp(s, UTC)
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(UTC)


def log(*a):
    print(f'[{now_utc():%H:%M:%S}]', *a, flush=True)


class SchemaError(Exception):
    """A pulled payload did not have the shape the parser relies on. The caller keeps the last good data."""


def need(obj, path, typ=None, what='payload'):
    """Walk obj along a dotted path ('a.b.0.c'); raise SchemaError if a step is missing or the leaf has the wrong type."""
    cur = obj
    for step in path.split('.') if path else []:
        try:
            cur = cur[int(step)] if isinstance(cur, list) else cur[step]
        except (KeyError, IndexError, TypeError, ValueError):
            raise SchemaError(f'{what}: missing {path!r} (failed at {step!r})')
    if typ is not None and not isinstance(cur, typ):
        raise SchemaError(f'{what}: {path!r} is {type(cur).__name__}, expected {typ if isinstance(typ, type) else typ}')
    return cur


def http_json(url, headers=None, timeout=25, retries=3, backoff=2.0, what=None):
    """GET a JSON document. Retries on network errors and 429/5xx; raises the last error. Returns the parsed object."""
    h = {'User-Agent': UA, 'Accept': 'application/json', 'Accept-Encoding': 'gzip'}
    h.update(headers or {})
    err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get('Content-Encoding') == 'gzip': raw = gzip.decompress(raw)
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            err = e
            if e.code not in (429, 500, 502, 503, 504): break           # 403 (blocked) and 404 are final
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            err = e
        time.sleep(backoff * (i + 1))
    raise err


def http_download(url, dest, timeout=120, retries=3, headers=None):
    """Stream a binary file to dest atomically (temp file + rename)."""
    h = {'User-Agent': UA}; h.update(headers or {})
    err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r, tempfile.NamedTemporaryFile(dir=os.path.dirname(dest), delete=False) as f:
                shutil.copyfileobj(r, f, 1 << 20); tmp = f.name
            os.replace(tmp, dest); return dest
        except Exception as e:                                           # noqa: BLE001 - retried then re-raised
            err = e; time.sleep(2 * (i + 1))
    raise err


def read_json(path, default=None):
    try:
        with open(path) as f: return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, obj, compact=False):
    """Atomic JSON write (temp file + rename) so a crash never leaves a half-written file behind."""
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or '.', suffix='.tmp')
    with os.fdopen(fd, 'w') as f:
        if compact: json.dump(obj, f, separators=(',', ':'), ensure_ascii=False, default=_default)
        else: json.dump(obj, f, indent=1, ensure_ascii=False, default=_default)
    os.replace(tmp, path)


def _default(o):
    if hasattr(o, 'item'): return o.item()
    if isinstance(o, (dt.datetime, dt.date)): return o.isoformat()
    if isinstance(o, set): return sorted(o)
    return str(o)


def sha(path_or_bytes, n=16):
    h = hashlib.sha256()
    if isinstance(path_or_bytes, (bytes, bytearray)): h.update(path_or_bytes)
    else:
        with open(path_or_bytes, 'rb') as f:
            for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()[:n]


def kick_utc_from_et(gameday, gametime):
    """nflverse schedule times are US Eastern wall clock."""
    t = dt.datetime.strptime(f'{gameday} {gametime}', '%Y-%m-%d %H:%M').replace(tzinfo=NY)
    return t.astimezone(UTC)


# nflverse team codes; ESPN and Action Network use a few different ones
ESPN_TO_NFLVERSE = {'WSH': 'WAS', 'LAR': 'LA', 'JAC': 'JAX'}
AN_TO_NFLVERSE = {'JAC': 'JAX', 'LAR': 'LA', 'WSH': 'WAS'}
