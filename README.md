# Floripa Surf Check

A small static site for a quick, glanceable read on how the surf is shaping up around
Florianópolis. Built for me and a few friends — pick a day and hour, see which beaches
are the best bets, and tap one for a plain-language detail view.

Pure HTML/CSS/JS, no build step, no API keys.

## Run

Open `index.html` directly, or serve the folder locally:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Layout

- **Controls** — day (Today + the next three weekdays) and hour (06:00–18:00).
- **Best bets** — beaches ranked for the selected day/hour, with the top pick highlighted.
- **Map** — the same scores as colored pins around the island (Leaflet + OpenStreetMap).
- **Selected spot** — score, a plain-language read, key metrics (swell / wind / tide /
  weather), an hour-by-hour timeline, and the closest spots for comparison.

## Design

Dark navy-violet canvas in the **Health design system** language: Outfit (display) +
DM Sans (body) + JetBrains Mono (data readouts), teal as the lead accent, Material
Symbols Rounded icons, 28px cards. See `~/.claude/skills/health-design-system`.

## Data

The app calls Open-Meteo directly from the browser (no key required):

- **Forecast API** — air temperature, cloud cover, precipitation probability, wind
  speed, wind direction, gusts.
- **Marine API** — wave/swell height, direction, period, sea-level height, sea-surface
  temperature.

## Scoring model

Each beach has prototype metadata in `app.js` (approximate coordinates, preferred swell
direction, offshore wind direction, ideal wave-height range, rough tide preference, plus
a lightweight coastal profile). The displayed score is a weighted heuristic:

- 44% swell quality — height, period, swell direction
- 27% wind quality — offshore/cross/onshore direction, speed, gust penalty
- 12% coastal fit — beach angle, shelter, coarse nearshore-depth response
- 9% tide fit — sea level vs. the beach's rough preferred tide
- 8% weather comfort — rain and cloud penalty

These are heuristics combining live Open-Meteo values with rough spot metadata — not live
human surf reports. Always worth a real look at the beach before paddling out.

## Deploy (GitHub Pages)

Pure static and key-free, so it deploys cleanly to GitHub Pages. From a repo with the
files at the root and Pages enabled on the default branch:

```bash
gh repo create <name> --source=. --push          # public or --private
gh api -X POST repos/<owner>/<name>/pages -f source[branch]=<branch> -f source[path]=/
```

The site then serves at `https://<owner>.github.io/<name>/`.

## Next calibration pass

Tune `BEACHES` in `app.js` from local knowledge: which swell directions each beach
really likes, which tides work best, which beaches close out as size increases, and
whether protected corners should be scored separately.
