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

These cover the scoring model directly — wind monotonicity (no glassy cliff), surfable-floor
continuity, size separation, period-aware closeout, cross-beach differentiation by exposure
and angle, the normalized tide state, and the timezone epoch.

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

The 0–100 score is a *clean-swell power, then degrade for wind* model, the shape real
rating services use (Surf-Forecast / MagicSeaweed / Surfline LOLA). Each physical input
enters the score **exactly once**, so nothing is double-counted:

1. **Size — breaking height, soft-knee.** Deep-water swell shoals into a taller breaker
   the longer its period (`breakingHeight`), and a sheltered bay sheds part of that
   height (`shelterAttenuation`) — so Ingleses/Armação/Barra read smaller on average
   (they're "too small" more often) yet survive as the clean-up call on oversized days
   when open beaches close out. The size term is a **soft knee** (`SIZE_REF`, the main
   calibration knob) with diminishing returns and *no early saturation*, so the whole
   0.6–3.5 m range stays separable.
2. **Period — quality multiplier.** `periodCurve` is a smooth curve that heavily docks
   windsea (~6 s), lets solid groundswell (10–13 s) score near-full, and tops out for
   premium long period (14 s+). Period multiplies size; it is *not* also folded into the
   size term.
3. **Cleanliness, direction, closeout.** A **windsea-contamination** penalty cuts quality
   when the wind-wave partition is large; **swell direction** modulates against each
   beach's window (`directionWindowScore`, where the configured `swellSpread` is the real
   window); a **period-aware closeout** penalty bites smoothly once the swell overpowers
   the beach (long groundswell holds bigger than short windsea).
4. **Surfable floor.** Below a per-spot rideable floor (`DEFAULT_MIN_SURF_HEIGHT`, e.g.
   `minSurfHeight` 0.7 m for Ingleses) the size curve falls off continuously — no cliff at
   the boundary — so `0.5 m @ 16 s` reads Poor even though it's clean.
5. **Wind — multiplicative gate.** Clean-swell potential is multiplied by a wind factor
   (`windQualityFactor`): glassy is good, clean **light offshore is ideal** (and never
   scores below glassy — the old 4 km/h cliff is gone), **cross-shore** adds chop,
   **onshore** degrades from the ~13 km/h whitecap threshold, **bigger swell shrugs wind
   off**, and gusts / very strong wind from any quarter taper it toward zero. A great swell
   blown out by strong onshore collapses to Poor.
6. **Context (gated).** Coastal depth fit, **tide**, and weather contribute a small amount
   *gated by the core* so they can't lift a flat or blown-out hour. Tide is compared as a
   normalized **low/mid/high state** within the day's local range, not as absolute metres
   (Open-Meteo's `sea_level_height_msl` is referenced to the global datum and carries a
   surge residual, so absolute height isn't a reliable tide phase).

Data is the full swell decomposition from Open-Meteo (primary + secondary swell, wind
wave, tide via `sea_level_height_msl`). `SIZE_REF` in `app.js` is the main calibration
knob — raise it for a stricter scale, lower it for a friendlier one. The per-beach
`swellCenter` / `swellSpread` / `offshoreWind` / `idealTide` (0–1 tide state) /
`minSurfHeight` / `maxHeight` are tuned from the source-backed priors in
`docs/spot-research.md`.

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

## Calibration

The per-beach `BEACHES` config in `app.js` was calibrated against source-backed priors
(Surf-Forecast per-break "ideal swell + offshore wind", a local PT guide, Wikipedia) and
adversarially fact-checked for geographic plausibility. Notable corrections: **Campeche**
faces south (swell from ~174°, not ESE); **Barra da Lagoa** behaves like a north-shore
beach (ENE swell + WSW offshore — the headland blocks the S/SE that feeds Mole/Joaquina);
**Matadeiro & Armação** are offshore on **SW** wind, not NW (NW is onshore for their
ESE/SE-facing coves); **Ingleses** wants NE swell + a strong S/SW offshore and is shadowed
from the dominant winter S groundswell (hence "frequently too small"). One source was
rejected as contaminated — Surf-Forecast's `Praia-Brava_1` page is the Itajaí/Camboriú
Brava (26.95°S), not the Floripa one. Full notes and the verified table live in
`docs/spot-research.md`. The best validation is still a few local observation days — log
where the model and the real beach disagree, then nudge `swellCenter` / `swellSpread` /
`offshoreWind` / `idealTide` / `minSurfHeight`.
