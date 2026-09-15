# AGENTS.md

Agent-facing operating notes for this repo.

## Scope

- `Surf` is a static browser app: plain HTML, CSS, and JavaScript.
- Canonical GitHub repo: `s0673468/surf-check`; default branch: `master`.
- There is no build step, backend, auth flow, or secret material here.
- Keep runtime assumptions simple enough to work from a local file or a basic
  static server.


## Shared Agent Policy

Follow `~/.config/agent-policy/git-golden-standard.md` for change tiers,
local validation cadence, provider review, finding handling, guarded delivery,
and cleanup. Use ready PRs and carry authorized work through required CI.

Classify risk by changed behavior and a concrete failure path, such as exposing
private data or widening publication access. File location and refactor size
alone do not make a harmless change high-risk. Preserve explicit approval
boundaries for destructive data, credentials/access, and private-data publication.

Use affected checks locally; CI owns the full suite for standard changes. Run the
full local gate when the shared tier or integration/debugging risk warrants it.

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

## Runtime map

[README runtime structure](README.md#runtime-structure) owns the module map and
classic-script dependency order. Keep the page and direct-test harness aligned.

## Validation Contract

- CI is defined in [.github/workflows/test.yml](.github/workflows/test.yml).
- The canonical local gates are:

```bash
make lint    # syntax-check all eight runtime scripts
make lint-workflows  # GitHub Actions workflow lint checks
make test    # run the smoke suite
make test-browser  # rendered Chrome smoke with deterministic API fixtures
make test-mutations  # run only the focused mutation smoke
make check   # run syntax, logic, and rendered-browser gates; CI uses this
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
- `make test-browser` runs an ephemeral static server and drives an installed Chrome or
  Chromium through its DevTools protocol without npm dependencies or external network
  access. It covers responsive ordering and overflow, localization, beach selection,
  ranking/map disclosures, accessible markers, and partial/error forecast states. A
  missing local browser skips clearly; a missing CI browser fails the gate.
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
