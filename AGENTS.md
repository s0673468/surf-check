# AGENTS.md

Agent-facing operating notes for this repo.

## Scope

- `Surf` is a static browser app: plain HTML, CSS, and JavaScript.
- There is no build step, backend, auth flow, or secret material here.
- Keep runtime assumptions simple enough to work from a local file or a basic
  static server.

## Working Rules

- Prefer direct simplification over new abstractions.
- Keep user-facing forecast and scoring text tied to the current scoring model:
  core scoring, score tiers, score labels, and scoring reasons live in
  [score-model.js](score-model.js), while day/spot prose and rendering live in
  [app.js](app.js).
- Treat forecast resilience as a product requirement: missing or partial browser
  API responses should degrade cleanly instead of crashing the page. API fetch
  and retry behavior live in [forecast-api.js](forecast-api.js); forecast views,
  scored-sample extraction, and ranking selectors live in
  [forecast-selectors.js](forecast-selectors.js).
- Keep RainViewer metadata normalization, frame matching, tile URL construction,
  and radar layer lifecycle in [rain-radar.js](rain-radar.js).
- Avoid dependencies unless they clearly pay for themselves; the current no-build
  shape is deliberate.

## Runtime Map

- [index.html](index.html) loads the classic scripts in dependency order:
  `forecast-api.js`, `score-model.js`, `forecast-selectors.js`,
  `rain-radar.js`, then `app.js`.
- [app.js](app.js) owns static beach/profile data, localization, state,
  orchestration, DOM rendering, map marker rendering, and shared formatting
  helpers.
- [tests/smoke.mjs](tests/smoke.mjs) mirrors the same script order before
  exporting runtime helpers for direct tests.

## Validation Contract

- CI is defined in [.github/workflows/test.yml](.github/workflows/test.yml).
- The canonical local gates are:

```bash
make lint    # syntax-check all five runtime scripts
make test    # run the smoke suite
make check   # run both gates; CI uses this
```

- `make lint` keeps the classic-script syntax gate in one place. It checks
  `forecast-api.js`, `score-model.js`, `forecast-selectors.js`,
  `rain-radar.js`, and `app.js` in the same order as the page.
- `make test` runs the no-dependency smoke suite (55 tests) in
  [tests/smoke.mjs](tests/smoke.mjs). It loads all runtime scripts in the same
  order as [index.html](index.html). If you change runtime selectors, scoring,
  API resilience, localization, or radar helpers, add or update focused coverage
  there. Scoring helpers that are only exercised transitively (e.g. `tideScore`,
  `coastalFitScore`, `surfableHeightFactor`, `numericCell`) are exported into the
  test harness for direct unit tests — keep that list in sync when you add one.
  For syntax-only confidence on a touched split file, also run `node --check <file>`.
- Do not add snapshot churn or DOM-heavy test scaffolding for logic that can be
  tested directly through the exported runtime helpers.

## Docs

- Keep [README.md](README.md) aligned with the actual validation commands and
  the current runtime split across `forecast-api.js`, `score-model.js`,
  `forecast-selectors.js`, `rain-radar.js`, and `app.js`.
