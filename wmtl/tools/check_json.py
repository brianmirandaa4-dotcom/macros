#!/usr/bin/env python3
"""Fail if any app data file is not strict JSON (NaN/Infinity break JSON.parse in the browser)."""
import json,glob,sys
bad=[]
for f in glob.glob('/home/claude/wmtl/data/**/*.json',recursive=True):
    try: json.loads(open(f).read(),parse_constant=lambda c:(_ for _ in ()).throw(ValueError(c)))
    except Exception as e: bad.append(f'{f}: {e}')
print('\n'.join(bad) or 'all data JSON strict'); sys.exit(1 if bad else 0)
