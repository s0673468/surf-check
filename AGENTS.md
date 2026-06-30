# AGENTS.md

Agent-facing operating notes for this repo.

## Scope

- `Surf` is a static browser app: plain HTML, CSS, and JavaScript.
- Canonical GitHub repo: `s0673468/surf-check`; default branch: `master`.
- There is no build step, backend, auth flow, or secret material here.
- Keep runtime assumptions simple enough to work from a local file or a basic
  static server.


## Shared Agent Policy

- Favor autonomy: when a low-risk docs, tests, typing, lint, or small behavior
  fix is clearly useful and locally reviewable, make the change, run the
  relevant local gate, open a ready PR, and babysit required CI without pausing
  for permission.
- Pause and ask before destructive data changes, private-data publication,
  credential or access changes, force-pushes, broad product direction shifts, or
  workflow/deploy/scheduled-job changes that need external approval.
- For non-trivial repo changes, use a normal ready PR. Use draft only when the
  work is intentionally incomplete.
- Request extra Codex review only for high-risk changes: data sync, ingestion,
  freshness, provenance, migrations, schema/storage, auth/secrets,
  CI/deploy/public access, launchd/cron/scheduled/background automation, mobile
  offline/cache/startup/headless/notifications, broad refactors/shared
  contracts, or private-data/public-artifact exposure.
- Treat review comments as triage findings: P1/P2 findings must be fixed or
  explicitly dismissed with evidence before merge. Low-risk PRs with green CI
  can merge without extra review.
- After local validation, green required checks, and resolved high-risk findings,
  squash-merge ready PRs.

## Working Rules

- Prefer direct simplification over new abstractions.
- Keep user-facing forecast and scoring text tied to the current scoring model:
  surf-region config and static text dictionaries live in
  [surf-config.js](surf-config.js), core scoring, score tiers, score labels, and
  scoring reasons live in [score-model.js](score-model.js), while day/spot
  prose and rendering live in [app.js](app.js).
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
  `surf-config.js`, `runtime-utils.js`, `forecast-api.js`,
  `score-model.js`, `forecast-selectors.js`, `forecast-prose.js`,
  `rain-radar.js`, then `app.js`.
- [surf-config.js](surf-config.js) owns static beach/profile data, localized
  static dictionaries, shared time-window constants, and the spot-profile
  lookup.
- [runtime-utils.js](runtime-utils.js) owns shared date, formatting, numeric,
  compass, geometry, clamp, and selected-beach helpers.
- [forecast-prose.js](forecast-prose.js) owns day summaries, spot reads,
  metric explanations, nearby-spot contrast reasons, factor labels, and
  confidence-chip metadata.
- [app.js](app.js) owns localization accessors, state, orchestration, DOM
  rendering, and map marker rendering.
- [tests/smoke.mjs](tests/smoke.mjs) mirrors the same script order before
  exporting runtime helpers for direct tests.

## Validation Contract

- CI is defined in [.github/workflows/test.yml](.github/workflows/test.yml).
- The canonical local gates are:

```bash
make lint    # syntax-check all eight runtime scripts
make lint-workflows  # GitHub Actions workflow lint checks
make test    # run the smoke suite
make test-mutations  # run only the focused mutation smoke
make check   # run both gates; CI uses this
```

- `make lint` keeps the classic-script syntax gate in one place. It checks
  `surf-config.js`, `runtime-utils.js`, `forecast-api.js`, `score-model.js`,
  `forecast-selectors.js`, `forecast-prose.js`, `rain-radar.js`, and `app.js`
  in the same order as the page.
- `make test` runs the no-dependency smoke suite in
  [tests/smoke.mjs](tests/smoke.mjs) and the focused mutation smoke in
  [tests/mutation-smoke.mjs](tests/mutation-smoke.mjs). The smoke suite loads
  all runtime scripts in the same order as [index.html](index.html). If you
  change runtime selectors, scoring, API resilience, localization, radar
  helpers, or prose thresholds, add or update focused coverage there. Scoring
  helpers that are only exercised
  transitively (e.g. `tideScore`,
  `coastalFitScore`, `surfableHeightFactor`, `numericCell`) are exported into the
  test harness for direct unit tests — keep that list in sync when you add one.
  For syntax-only confidence on a touched split file, also run `node --check <file>`.
- `make test-mutations` is a quick focused mutation pass. It mutates exact
  source lines in memory and checks the suite kills representative comparator,
  fallback, cache-key, numeric, geometry, weather, radar, and prose-threshold
  changes without adding dependencies.
- Do not add snapshot churn or DOM-heavy test scaffolding for logic that can be
  tested directly through the exported runtime helpers.


## Generated Local State

- Preserve `.understand-anything/` and similar local graph or analysis outputs.
  They are user-owned working state. Report them as generated/local if noisy,
  but do not delete or commit them unless explicitly requested.

## Docs

- Keep [README.md](README.md) aligned with the actual validation commands and
  the current runtime split across `surf-config.js`, `runtime-utils.js`,
  `forecast-api.js`, `score-model.js`, `forecast-selectors.js`,
  `forecast-prose.js`, `rain-radar.js`, and `app.js`.
