"""Decode a pack3() payload (gzip + base64 text copied from the browser) into raw/espn/<sport>.json.
    python3 -I tools/espn_unpack.py payload.txt raw/espn/nfl.json"""
import sys, json, gzip, base64, re
t = open(sys.argv[1]).read(); b = re.search(r'[A-Za-z0-9+/=]{100,}', t).group(0)
j = json.loads(gzip.decompress(base64.b64decode(b))); json.dump(j, open(sys.argv[2], 'w'))
print(sys.argv[2], {k: len(v) for k, v in j.items() if isinstance(v, list)})
