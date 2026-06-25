# Fork it for your own coast

This app ships calibrated for Florianópolis, but nothing in the engine is
Floripa-specific — the location lives entirely in **data and config**. The
scoring model (`score-model.js`), the data layer (`forecast-api.js`), the
selectors (`forecast-selectors.js`), and the rendering (`app.js`) are all
region-agnostic. To point it at your own coast you edit a config array, a
timezone, a map center, and a handful of page strings. No build step, no API
keys, no backend.

Open-Meteo (forecast + marine) covers the whole planet, so the data works
anywhere there's an offshore marine cell.

## The 6 edits

| # | File | What | Where |
|---|------|------|-------|
| 1 | `app.js` | `BEACHES` — your spots | the `const BEACHES = [` array |
| 2 | `app.js` | `SPOT_DATA_PROFILES` — optional per-spot physics | the `const SPOT_DATA_PROFILES = {` object |
| 3 | `app.js` | Map center + zoom | `.setView([-27.59, -48.46], 11)` |
| 4 | `forecast-api.js` | Your timezone | `const TZ = "America/Sao_Paulo"` |
| 5 | `index.html` | Title, description, region label, headline, `lang` | `<title>`, `<meta description>`, `<p class="eyebrow">`, `<h1>`, `<html lang>` |
| 6 | `score-model.js` | Optional global scale calibration | `const SIZE_REF = 0.8` |

Steps 1, 3, 4, 5 are required. Steps 2 and 6 are optional — sensible defaults
apply if you skip them.

## 1. `BEACHES` — your spots

Each entry is one break. Copy an existing entry and change the fields. The
required fields (every shipped spot has them):

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Stable slug. Also the key into `SPOT_DATA_PROFILES` and the map. Keep it URL-safe and unique. |
| `name` | string | Display name. |
| `lat`, `lon` | number | Decimal degrees. Drives the Open-Meteo forecast/marine query **and** the map pin. Use a point just offshore of the break so the marine cell resolves to open water. |
| `offshoreWind` | 0–359 | Compass bearing the **offshore (grooming) wind blows _from_**. Wind from here is ideal; the model degrades as wind rotates toward onshore. For an east-facing beach, offshore is roughly west (~270°). |
| `swellCenter` | 0–359 | Compass bearing of the swell the beach faces — the direction groundswell arrives _from_. The center of the directional acceptance window. East-facing beach ≈ 90°. |
| `swellSpread` | degrees | Angular width of the swell window around `swellCenter`. Larger = accepts a wider range of swell angles. This is the real acceptance window, not a soft taper. |
| `idealHeight` | `[min, max]` m | The sweet-spot breaking-height band, in metres. |
| `maxHeight` | number m | Size beyond which the beach starts to close out (period-aware — long groundswell holds bigger than short windsea). |
| `idealTide` | 0–1 | Preferred **normalized** tide state within the day's local range: 0 = low, 1 = high. Not metres — the model normalizes tide per day. |
| `tideSpread` | 0–1 | Tolerance around `idealTide`. |

Optional:

| Field | Type | Meaning |
|-------|------|---------|
| `minSurfHeight` | number m | Per-spot rideable floor. Below this the size term falls off continuously (no cliff). Defaults to the global `DEFAULT_MIN_SURF_HEIGHT` if omitted. |

Display / prose (shown in the UI, not scored):

- `note`, `region`, `exposure`, `breakType` — short labels used for grouping and the spot header.
- `profile`, `whyNearby` — the plain-language paragraphs in the detail and "closest spots" views.
- `traits` — array of short tag chips.

## 2. `SPOT_DATA_PROFILES` — optional physics, keyed by `id`

A second object keyed by beach `id`. It tunes how the nearshore converts swell
into breaking power and how sheltered the break is. **Entirely optional** — if a
beach `id` is missing here, the app falls back to defaults
(`depthPower: 0.58`, `shelterIndex: 0.35`, `dataConfidence: 0.45`,
`beachAxis` derived from `exposure`).

| Field | Type | Meaning |
|-------|------|---------|
| `depthPower` | 0–1 | How efficiently the nearshore bathymetry converts swell to breaking power. Higher = punchier, steeper break. |
| `shelterIndex` | 0–1 | How sheltered the break is from wind and swell. Higher = more attenuation (protected coves, headland shadow). |
| `dataConfidence` | 0–1 | Your confidence in this spot's calibration. Lower it for spots you haven't observed much. |
| `beachAxis`, `depth`, `shelter` | string | Display descriptions shown in the detail view. |

Start by leaving this empty and let the defaults ride; add entries once you've
watched a spot enough to know it's punchier or more sheltered than average.

## 3. Map center + zoom (`app.js`)

```js
}).setView([-27.59, -48.46], 11);
```

Set `[lat, lon]` to the center of your spots and pick a zoom (11 suits an
island; use 9–10 for a long coastline, 12–13 for a tight cluster). The pins
themselves come from each beach's `lat`/`lon`.

## 4. Timezone (`forecast-api.js`)

```js
const TZ = "America/Sao_Paulo";
```

Use the IANA zone for your coast (e.g. `Europe/Lisbon`, `Australia/Sydney`,
`America/Los_Angeles`). Open-Meteo returns local-time series for this zone, and
the day/hour controls and tide normalization key off it.

## 5. Page strings (`index.html`)

- `<title>Surfe em Floripa</title>` — your app name.
- `<meta name="description" ...>` — your description.
- `<html lang="pt-BR">` — set if your default copy isn't Portuguese.
- `<p class="eyebrow">Florianópolis</p>` — your region label.
- `<h1>Como tá o surfe</h1>` — your headline.

The PT/EN toggle and the localized prose generators stay as-is; only the static
chrome above is region-named.

## 6. Calibration (`score-model.js` + per-spot knobs)

`SIZE_REF = 0.8` is the **global scale knob**: raise it for a stricter scale
(everything reads smaller/harder), lower it for a friendlier one. Tune this once
for your coast's typical energy.

Per-spot, the levers are `swellCenter` / `swellSpread` / `offshoreWind` /
`idealTide` / `tideSpread` / `minSurfHeight` (and `depthPower` / `shelterIndex`
if you added a profile).

### Finding `swellCenter` and `offshoreWind` for a new spot

1. **Shoreline angle.** Look at the beach on a map. The direction the open ocean
   lies, perpendicular to the shoreline, is roughly your `swellCenter`. Offshore
   wind blows from land to sea — roughly the opposite bearing — so
   `offshoreWind ≈ swellCenter ± 180°` for a straight beach, adjusted for any
   headland.
2. **Cross-check a real service.** Surf-Forecast publishes a per-break "ideal
   swell direction + offshore wind" — a strong prior. Magicseaweed/Surfline
   spot pages work too. Use them to sanity-check, not copy blindly.
3. **Then observe.** The single best calibration is a few local observation
   days: note where the model and the real beach disagree, then nudge the knobs.
   See [`spot-research.md`](./spot-research.md) for how the Floripa spots were
   researched and adversarially fact-checked (it caught several wrong-facing
   defaults — e.g. a south-facing beach mistaken for east-facing).

Replace `docs/spot-research.md` with your own notes as you go — it's the
provenance trail for your calibration.

## Verify

```bash
node --check app.js
npm test          # the scoring smoke suite — model invariants, not spot values
python3 -m http.server 4173   # then open http://localhost:4173 and eyeball it
```

The smoke suite checks model invariants (wind monotonicity, surfable-floor
continuity, cross-beach differentiation), so it keeps passing for any sane spot
set. Your real test is loading the page and seeing whether the rankings match
what you'd expect on a known day.

## Deploy

Pure static and key-free — see the **Deploy (GitHub Pages)** section in the
[README](../README.md). It serves from any static host (GitHub Pages, Netlify,
Cloudflare Pages, an S3 bucket) with zero config.
