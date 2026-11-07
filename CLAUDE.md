# Trainer: working rules for Claude Code

Trainer is an offline-first nutrition, training and hydration web app (an iPhone Home Screen PWA). It's live at https://brianmirandaa4-dotcom.github.io/macros/ and served from this repo (`main` → GitHub Pages). The owner is Brian (brianmirandaa4@gmail.com); his business partner is Jack.

## Layout
- `dev/Trainer.html`: **the source.** One file containing CSS, HTML and JS. Edit this, never `index.html` directly.
- `dev/build.py`: builds `index.html` from the source. It adds the PWA meta tags and service-worker registration.
- `dev/tests/`: Playwright checks.
  - `verify.py`: 13 data-safety and regression checks. Must print 13 PASS.
  - `layout_audit.py phone|desktop`: overlap, cut-off text and broken words across every screen. Must print `TOTAL 0`.
  - `hdr_click.py`, `nav_test.py`, `today_full.py <tab>` (screenshots).
  - `team_player_test.py` and `mock_server.mjs`: the Teams API mock on port 8791.
- `sync-server/worker.js`: the Cloudflare Worker `macros-sync`. **It is not deployed from git.** Brian pastes changes into the Cloudflare dashboard editor and clicks Deploy himself, so keep each change pasteable: one function per line, a small number of lines to paste.
- `sw.js`: the service worker. `privacy.html`, `terms.html`.
- `wmtl/`: a **different project** that also pushes to this repo. Don't touch it. Always pull/rebase before pushing.

## Run and test
```bash
python3 dev/build.py
python3 -m http.server 8790        # from the repo root
python3 dev/tests/verify.py         # needs: pip install playwright (Chromium)
python3 dev/tests/layout_audit.py phone && python3 dev/tests/layout_audit.py desktop
```
If the server runs on another port, set `TRAINER_URL=http://localhost:PORT/`.

## Release checklist (every release)
1. Bump `APP_VER` in `dev/Trainer.html` (e.g. `syncope-2.80` → `2.81`) **and** `VERSION` in `sw.js` (e.g. `syncope-v97` → `v98`). The internal names say "syncope"; leave that prefix alone.
2. `python3 dev/build.py`, then confirm: verify.py prints 13 PASS, and layout_audit shows 0 on phone and desktop.
3. `git pull --rebase` and commit with a clear message, then push to `main`.
4. **Never push untested code to `main`.** Put work in progress on a branch.

## Hard rules
- **Storage keys never change:** `macros.offline.v1`, `macros.ai.v1`, `macros.sync.v1`, `syncope.social.v1`, `syncope.join`, `macros.appver`, and every other `syncope.*` key. Add new keys or fields; never rename or reshape existing ones. Users' logs live only on their phones and in account backups.
- **Never tell users to delete the Home Screen app.** Each Home Screen web app has its own storage, so deleting it wipes the log.
- **Wearable data (WHOOP, Garmin, Oura, Apple Health) is never sent to AI**, including the coach chat. Coaches on Teams never see it either. Oura's and Garmin's terms forbid it, and the privacy policy promises it.
- **Eating rules go to AI as food rules only** (e.g. "no pork"), never as a religion.
- **The calorie safety floor stays on every plan.** No deficits for anyone under 18. Teams are 18+ in v1.
- **The app is named Trainer.** Don't use other names in anything public.
- **Claude must not log in, type passwords or API keys, create accounts or accept terms for Brian.** Brian clicks Deploy in Cloudflare himself.
- **Don't recreate trademarked logos.** Use only files Brian supplies.

## Design system (DS3)
- Flat surfaces (`--s1`, `--s2`), hairline dividers (`--hair`), radius 20 for sections and 14 for controls.
- Purple (`--kcal`) only for the main action and selected states.
- No boxes inside boxes, no oversized headings, no truncated or overlapping text.
- Every non-main screen has a top-left Back and supports swipe-from-left-edge back, one step at a time.

## Communication with Brian
- Use plain language. No code jargon or file names in updates, and no HTML files sent back.
- Short status: what changed, whether it's live, and anything he needs to click.

## Business context
See the Claude Project docs: membership tiers and pricing, team pricing options, public-launch permissions (WHOOP/Oura/Garmin/Apple), status.
- Prices: Pro $5.99/mo · $39.99/yr · $1.99/wk; Elite $9.99/mo · $69.99/yr · $2.99/wk; Team plan pricing at launch.
- Subscriptions renew automatically. Reminders go out before every charge: weekly 1 day before, monthly 3 days before, annual 30 and 7 days before. Each states the plan, the price, the renewal date and the cancel-by date (24 h before renewal).
