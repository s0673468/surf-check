# Floripa Surf Check

A small static site for a quick, glanceable read on how the surf is shaping up around
Florianópolis. Built for me and a few friends. The app can pick ranked surf windows
across the next four days, or you can pick a day and hour, see which beaches are the
best bets, and tap one for a plain-language detail view.

Pure HTML/CSS/JS, no build step, no API keys.

Canonical GitHub repo: `s0673468/surf-check`; default branch: `master`.

> **Surf a different coast?** The engine is region-agnostic — the location lives
> entirely in config. See [`docs/fork-your-own-coast.md`](docs/fork-your-own-coast.md)
> to point it at your own beaches in six small edits.

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

Validate the static app with the same gates that CI runs:

```bash
make lint    # syntax-check all eight runtime scripts
make lint-workflows  # GitHub Actions workflow lint checks
make test    # run the smoke suite
make test-mutations  # run only the focused mutation smoke
make check   # run both gates; CI uses this
```

`make test` runs the no-dependency smoke suite plus a focused mutation smoke. These
cover the scoring model
directly: wind monotonicity across both speed and the offshore-to-onshore angle (no
glassy cliff, no cross-shore jump), the gust gate that spares a glassy morning, the
surfable-floor continuity and above-floor readiness ramp, size separation, the
period-aware closeout floor, exposure-class direction capping, aligned-vs-opposed windsea
cleanliness, missing-weather neutrality, the normalized tide state, the date-keyed scored
cache (no midnight staleness), forecast-truth ledger parsing, the timezone epoch,
the radar, fetch-resilience, localization, and prose helpers. The suite loads
the same classic scripts as `index.html`, in page order, so split-file script ordering
stays covered. The mutation smoke edits exact source lines in memory and proves the
focused invariants catch representative comparator, fallback, cache-key, numeric,
geometry, weather, radar, and prose-threshold mutants without adding dependencies.

## Runtime structure

The app deliberately stays as classic scripts with no bundler:

- `surf-config.js` — surf-region config, beach/profile data, localized static
  dictionaries, shared time-window constants, and the spot-profile lookup.
- `runtime-utils.js` — shared date, formatting, numeric, compass, geometry,
  clamp, and selected-beach helpers.
- `forecast-api.js` — Open-Meteo hourly field lists, beach forecast URL construction,
  payload validation, shared `fetchJson` retry behavior, and delay handling.
- `score-model.js` — the 0–100 scoring model, score tiers, score labels, scoring
  reasons, and swell/wind/tide scoring helpers.
- `forecast-selectors.js` — selected-hour forecast views, scored-sample extraction,
  memoization, rankings, nearby-beach comparisons, and tide-state normalization.
- `forecast-prose.js` — day summaries, spot reads, metric explanations,
  nearby-spot contrast reasons, factor labels, and confidence-chip metadata.
- `rain-radar.js` — RainViewer metadata loading, frame normalization, frame matching,
  tile URL construction, and Leaflet radar layer lifecycle.
- `app.js` — localization accessors, state, orchestration, DOM rendering, and
  map marker rendering.

The local forecast-truth loop stays outside the browser runtime:

- `calibration/forecast-truth-ledger.json` — append-only manual observations paired with
  one forecast score or snapshot for a beach and local time.
- `scripts/forecast-truth.mjs` — no-network helper that compares forecast score bands with
  observed 1–5 session ratings and summarizes score and height bias.

## Layout

- **Controls** — day (Today + the next three weekdays) and hour (06:00–18:00).
- **The day at a glance** — one plain-language paragraph summarizing the whole selected
  day: overall size and cleanliness, the best time window, the top one or two beaches,
  and a rain watch-out. Whole-day peak score on the left (vs. Best bets, which is the
  selected hour). Generated in-browser from the same scored samples — see `describeDay`
  in `app.js` and scored-sample extraction in `forecast-selectors.js`.
- **Best bets** — beaches ranked for the selected day/hour, with the top pick highlighted.
- **Map** — the same scores as colored pins around the island (Leaflet + OpenStreetMap),
  plus a RainViewer rain layer when radar data exists for the selected surf hour.
- **Selected spot** — score, a **confidence chip** (forecast horizon blended with the
  spot's source-data confidence, so a thin-data break like Brava reads as an estimate), a
  plain-language read, key metrics (swell / wind / tide / weather), an hour-by-hour
  timeline, and the closest spots for comparison.

## Design

Dark navy-violet canvas with Outfit (display), DM Sans (body), JetBrains Mono
(data readouts), teal as the lead accent, Material Symbols Rounded icons, and
28px cards.

## Data

The app calls Open-Meteo directly from the browser (no key required):

- **Forecast API** — air temperature, cloud cover, precipitation probability, wind
  speed, wind direction, gusts.
- **Marine API** — wave/swell height, direction, period, sea-level height, sea-surface
  temperature.
- **RainViewer API** — recent radar frames for the map overlay. RainViewer only covers
  the recent window, so future surf hours still use Open-Meteo rain probability.

Open-Meteo fetch/retry and hourly payload normalization live in `forecast-api.js`.
RainViewer frame normalization and tile URL handling live in `rain-radar.js`.

## Scoring model

The 0–100 score is a *clean-swell power, then degrade for wind* core, the shape real
rating services use (Surf-Forecast / MagicSeaweed / Surfline LOLA), plus one deliberate
**clean-fun** term on top (see 7). Each physical input enters the **core** exactly once,
so the power model never double-counts. The implementation lives in `score-model.js`:

1. **Size — breaking height of the combined sea, soft-knee.** Size and period read the
   *combined* sea (`wave_height`/`wave_period`), not the dominant swell sub-partition —
   Open-Meteo often splits a small day into a short primary swell plus a separate
   longer-period secondary, so the partition alone can read ~40 % smaller than what
   actually breaks. (Direction stays on the swell partition — "where's the groundswell
   from" is the meaningful angle.) Deep-water swell shoals taller the longer its period
   (`breakingHeight`), and a sheltered bay sheds part of that height (`shelterAttenuation`)
   — so Ingleses/Armação/Barra read smaller on average (they're "too small" more often)
   yet survive as the clean-up call on oversized days. The size term is a **soft knee**
   (`SIZE_REF`) with diminishing returns and *no early saturation*, so the whole 0.6–3.5 m
   range stays separable.
2. **Period — quality multiplier.** `periodCurve` is a smooth curve. Short clean swell
   (5–7 s — the bread and butter of small fun beachbreak here) keeps real value (floor
   `0.55`) rather than being written off; solid groundswell (10–12 s) scores near-full and
   premium long period (15 s+) tops out. The period fed to the curve (and to the shoaling
   in `breakingHeight`) is the **longer of the combined and swell-partition periods**, so a
   clean long-period groundswell hidden under short windsea isn't graded as chop — while
   *size* still reads the combined sea. The windsea *mess* is docked by cleanliness, not
   here, so period only measures swell quality. Period multiplies size; it is *not* also
   folded into the size term.
3. **Cleanliness, direction, closeout.** A **windsea-contamination** penalty cuts quality
   when the wind-wave partition is large (computed from the swell *partition* energy, so
   sizing on the combined sea never launders chop into free size) — and windsea running
   *with* the swell window contaminates **less** than opposed chop (`wind_wave_direction`);
   **swell direction** modulates against each beach's window (`directionWindowScore`, where
   the configured `swellSpread` is the real window) with an **exposure-class floor** so a
   sheltered/filtered bay caps harder on a bad angle than an open swell magnet; a
   **period-aware closeout** penalty bites smoothly once the swell overpowers the beach
   (long groundswell holds bigger than short windsea).
4. **Surfable floor.** Below a per-spot rideable floor (`DEFAULT_MIN_SURF_HEIGHT`, e.g.
   `minSurfHeight` 0.7 m for Ingleses) the size curve falls off continuously — no cliff at
   the boundary — so `0.5 m @ 16 s` reads Poor even though it's clean.
5. **Wind — multiplicative gate.** Clean-swell potential is multiplied by a wind factor
   (`windQualityFactor`): a glassy surface sits at a ~0.9 baseline from **any** direction,
   clean **light offshore is ideal** (grooms toward 1.0; the old 4 km/h cliff is gone),
   then the factor degrades **monotonically** as the wind turns onshore — **cross-shore**
   is texture, **dead onshore** is the worst (the old branch split that jumped ~0.1 at the
   cross-shore seam and rated dead-onshore above oblique is fixed). **Bigger swell shrugs
   wind off**, and gusts / very strong wind taper it toward zero — but the gust penalty is
   **gated by base speed**, so a glassy morning with a spurious gust spike stays glassy.
   A great swell blown out by strong onshore collapses to Poor.
6. **Context (gated).** Coastal depth fit, **tide**, and weather contribute a small amount
   *gated by the core* so they can't lift a flat or blown-out hour — but a calm-clean-
   rideable day lets the context through (good tide and a clear sky *do* matter when it's
   actually nice out). Tide is compared as a normalized **low/mid/high state** within the
   day's local range, not as absolute metres (Open-Meteo's `sea_level_height_msl` is
   referenced to the global datum and carries a surge residual, so absolute height isn't a
   reliable tide phase). Missing weather reads as **neutral**, not a flawless clear sky.
7. **Clean-fun (the one composite).** A pure power engine buries small days: a rideable,
   clean, glassy, in-window day with little power scores ~Poor even when it's a genuinely
   good call to paddle out (the kind of fine small Matadeiro morning that draws a crowd).
   `CLEAN_FUN_BONUS` earns those sessions points back. It's a deliberate composite, gated
   on *every* condition that makes it true: rideable (above the surfable floor), clean,
   **groomed period** (a separate gate — short windsea dumped into the swell columns earns
   nothing), glassy **and not onshore**, in-window, and **not big** (fades out by head-high
   so a closeout never qualifies). It fades on the score's own **headroom**, not on size,
   so it lifts low-scoring small days but can *never* invert a bigger/cleaner day below a
   smaller one. Big/blown/choppy/flat/off-window days keep their power-only score.

Data is the full swell decomposition from Open-Meteo (primary + secondary swell, wind
wave, tide via `sea_level_height_msl`). `SIZE_REF` in `score-model.js` is the main
calibration knob — raise it for a stricter scale, lower it for a friendlier one. The per-beach
`swellCenter` / `swellSpread` / `offshoreWind` / `idealTide` (0–1 tide state) /
`minSurfHeight` / `maxHeight` are tuned from the source-backed priors in
`docs/spot-research.md`.

These are heuristics over model data — not live human surf reports. Always worth a real
look at the beach before paddling out.

## Fork it for your own coast

Florianópolis is the showcase, not a hard dependency. Open-Meteo's forecast and
marine APIs cover the whole planet, so you can retarget the app to any coastline
by editing a config array, a timezone, a map center, and a few page strings — no
build step, no keys, no backend. The full walkthrough (the `BEACHES` schema, the
optional per-spot physics knobs, and how to find `swellCenter`/`offshoreWind` for
a new break) is in [`docs/fork-your-own-coast.md`](docs/fork-your-own-coast.md).

## License

[MIT](LICENSE) — © 2026 German Chernukhin. Fork it, rename it, ship your own coast.

## Deploy (GitHub Pages)

Pure static and key-free, so it deploys cleanly to GitHub Pages. From a repo with the
files at the root and Pages enabled on the default branch:

```bash
gh repo create <name> --source=. --push          # public or --private
gh api -X POST repos/<owner>/<name>/pages -f source[branch]=<branch> -f source[path]=/
```

The site then serves at `https://<owner>.github.io/<name>/`.

## Calibration

The per-beach `BEACHES` config in `surf-config.js` was calibrated against source-backed priors
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

For the local forecast-truth loop, append manual observations to
`calibration/forecast-truth-ledger.json` after checking a beach. Pair the beach and local
time with the forecast score or snapshot you saw, then add the observed 1–5 session rating,
height, cleanliness, and tags. Run:

```bash
npm run forecast-truth
```

Use the summary to spot repeat bias before changing `score-model.js`; do not retune from
one row.
