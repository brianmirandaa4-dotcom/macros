# Overlay · by whomadethisline

In betting, an overlay is a price that pays more than its real chance. That is what the model hunts, and the icon shows it: the ring is the model's chance, the brass tick is what the price needs, and the green slice is the overlay.

The model's betting command center, as an iPhone app: every sport, every slate, one place.
It is a static web app, plain HTML, CSS and JavaScript with no build step, so it installs on your home screen and works offline once a slate has loaded.

**The model is the only source of truth.** The app never invents a pick, a line, a stat or an injury. Anything missing reads "Not available."

## What's inside

| Screen | What it does |
|---|---|
| Lobby | The 3D sportsbook room, with one table per sport. Below it, every slate with a countdown and how many bets pass. A 2D room stands in under Reduce Motion or when the 3D room is turned off. |
| Card | Only plays that pass both keys. If nothing passes: "No bets pass the model today" and the rule funnel that explains why. Leans sit in a gray information-only block. Swipe between betting windows. |
| Props | One tab per prop type. Each one's 25-question page comes first, then its board: strong (+1.5) or weak (−1.5) cards by window, projection against the best line, and the opening line marked. |
| Report card | Model chance against the price, both sides, the 10,000-replay distribution with the line marked, every question that pushed the score up or down, the five rules, every book's price, and availability with its source. |
| Player profile | ESPN-style page for every player: season per-game averages, a trend chart against today's line, the full game log, and every time the model graded him. |
| Live | Pre-built end-of-Q1 and halftime scenarios, plus a live calculator. Enter his stat, the score, the live line and the price. It returns P(over) and P(under) from his shipped replay ladders, and the model's own stake. |
| More | Game lines (ranked out of the slate), parlays, results and the model report, my bets, how it works, import a slate, settings. |

## Put it on your iPhone (about 5 minutes)

1. **Create the repo.** On github.com, sign in, click **+ → New repository**, name it `wmtl` (any name works), set it to **Public**, and click **Create repository**.
2. **Upload the files.** On the new repo page, click **uploading an existing file**. Unzip `whomadethisline.zip` on your laptop and drag in everything inside the `wmtl` folder (`index.html`, `app.js`, `data/`, `vendor/` and the rest), keeping the folders. Click **Commit changes**.
3. **Turn on Pages.** Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, **Folder: / (root)**, and click **Save**. After about a minute the page shows your link: `https://<your-username>.github.io/wmtl/`.
4. **Add it to your Home Screen.** Open that link in **Safari** on your iPhone. Tap **Share**, then **Add to Home Screen**, then **Add**. It opens full screen, like your SYNCOPE app.
5. **Update a slate.** Upload the new JSON into `data/<sport>/` and the updated `data/index.json`, then commit. In the app, pull down on any screen to load it.

The repo is public so GitHub Pages stays free. It contains model output and game data, nothing personal: your bets and bankroll stay on your phone.

## Every future model run

At the end of a model run in THE MODEL project, the existing exporter already writes the slate (`code/web/export_wmtl.py` → `wmtl.slate.v1`). Then:

```
python3 tools/add_slate.py path/to/slate.json --label "Week 9" --id nfl-2026-wk09
```

That upgrades the file to v2 without touching a model number, writes it to `data/nfl/2026-wk09.json`, and updates `data/index.json`. Commit and push.

After the games, grade everything and rebuild the player histories:

```
python3 -I tools/build_data.py <published-slates-dir> <box-score-dir> data
```

You can also skip GitHub: in the app, go to **More → Import a slate**, then paste the JSON or pick the file. It stays on that phone.

See `SCHEMA.md` for every field.

## Data sources for history and grading

- NFL: nflverse weekly player stats and final scores (2025–26).
- NBA: ESPN box scores via sportsdataverse (2025–26 and 2026–27).
- CFB: box scores rebuilt from cfbfastR 2026 play-by-play. Plays without a player tag are missing, so a few totals can run low.

## Honesty, built in

Every pick shows its loss rate. The results page keeps every bad night. Parlays show the true combined chance. Bet only what you can afford to lose; **1-800-GAMBLER** is free and confidential, any time.

three.js r149 (MIT) ships locally in `vendor/`; there are no CDN calls.
