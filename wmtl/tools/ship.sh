#!/bin/sh
# Safe release into the GitHub Pages repo now that the scheduled workflow also commits data:
# pull first, never overwrite newer data the robot committed, always ship our code, version = max(repo, local)+1.
set -e
python3 /home/claude/wmtl/tools/check_json.py >/dev/null || { python3 /home/claude/wmtl/tools/check_json.py; echo "refusing to ship: invalid data JSON"; exit 1; }
APP=/home/claude/wmtl; REPO=/home/claude/macros; MSG="$1"
cd "$REPO" && git fetch -q && git rebase -q origin/main
NL=$(grep -o "wmtl-v[0-9]*" "$APP/sw.js" | head -1 | tr -dc 0-9); NR=$(grep -o "wmtl-v[0-9]*" "$REPO/wmtl/sw.js" | head -1 | tr -dc 0-9)
N=$(( (NL > NR ? NL : NR) + 1 ))
sed -i "s/wmtl-v[0-9]*-/wmtl-v$N-/" "$APP/sw.js"
sed -i -E "s/([a-z0-9-]+)\.(css|js)\?v=[0-9]+/\1.\2?v=$N/g; s/\?v=[0-9]+';document/?v=$N';document/; s/\?v=[0-9]+\"/?v=$N\"/g" "$APP/index.html"
cp -ru "$APP/." "$REPO/wmtl/"                      # data: only files newer than the repo's copy
for f in "$APP"/*.js "$APP"/*.css "$APP"/index.html "$APP"/sw.js "$APP"/manifest.webmanifest; do cp "$f" "$REPO/wmtl/"; done
mkdir -p "$REPO/wmtl/schemes" && cp "$APP"/schemes/*.css "$REPO/wmtl/schemes/"
cd "$REPO" && git add -A wmtl && git commit -qm "$MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DDGG4dkv3WBCp6FFbiGmLS" && git push -q && echo "shipped v$N $(git log --oneline -1)"
