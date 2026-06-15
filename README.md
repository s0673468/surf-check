# Floripa Surf Check

A small static site for a quick, glanceable read on how the surf is shaping up around
Florianópolis. Built for me and a few friends — pick a day and hour, see which beaches
are the best bets, and tap one for a plain-language detail view.

Pure HTML/CSS/JS, no build step, no API keys.

**Languages:** Portuguese (default) and English, toggled top-right (`PT` / `EN`). The
choice is remembered via `localStorage`. Dates, compass points, score labels, and all
generated prose localize together.

## Run

Open `index.html` directly, or serve the folder locally:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Test

Run the no-dependency smoke tests with:

```bash
npm test
```

## Layout

- **Controls** — day (Today + the next three weekdays) and hour (06:00–18:00).
- **The day at a glance** — one plain-language paragraph summarizing the whole selected
  day: overall size and cleanliness, the best time window, the top one or two beaches,
  and a rain watch-out. Whole-day peak score on the left (vs. Best bets, which is the
  selected hour). Generated in-browser from the same scored samples — see `describeDay`.
- **Best bets** — beaches ranked for the selected day/hour, with the top pick highlighted.
- **Map** — the same scores as colored pins around the island (Leaflet + OpenStreetMap),
  plus a RainViewer rain layer when radar data exists for the selected surf hour.
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
- **RainViewer API** — recent radar frames for the map overlay. RainViewer only covers
  the recent window, so future surf hours still use Open-Meteo rain probability.

## Scoring model

The 0–100 score is an energy-and-wind model (rewritten from the original additive
heuristic), grounded in how real surf-rating services work — score the *clean swell's
energy*, then degrade it for wind:

1. **Swell quality (the dome).** Built from wave **energy ∝ H²·T** of the swell
   partitions (primary + half the secondary swell), not blended significant height — so
   `1.4 m @ 14 s` rightly outranks `2 m @ 7 s`. A **period curve** rewards groundswell
   (poor < 8 s, solid 10–13 s, premium 13 s+). A **windsea-contamination** penalty cuts
   quality when the wind-wave partition is large (chop on the face). Swell **direction**
   modulates this against each beach's preferred window.
2. **Wind (multiplicative gate).** Clean-swell potential is multiplied by a wind factor:
   glassy and light-offshore groom the face, onshore degrades steeply past ~9 km/h, gusts
   and strong wind from any direction cap it. A great swell with onshore wind collapses
   toward ~35% of its potential, instead of still scoring well.
3. **Context (gated).** Coastal fit, tide, and weather contribute a small amount that is
   *gated by the core* so they can't inflate a flat or blown-out hour.

Data is the full swell decomposition from Open-Meteo (primary + secondary swell, wind
wave, tide via `sea_level_height_msl`). `ENERGY_REF` in `app.js` is the main calibration
knob — raise it for a stricter scale, lower it for a friendlier one. Tune the per-beach
`swellCenter` / `offshoreWind` / `idealTide` from local knowledge.

These are heuristics over model data — not live human surf reports. Always worth a real
look at the beach before paddling out.

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
