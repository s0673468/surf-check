# AGENTS.md

Agent-facing operating notes for this repo.

## Scope

- `Surf` is a static browser app: plain HTML, CSS, and JavaScript.
- There is no build step, backend, auth flow, or secret material here.
- Keep runtime assumptions simple enough to work from a local file or a basic
  static server.

## Working Rules

- Prefer direct simplification over new abstractions.
- Keep user-facing forecast and scoring text tied to the current scoring model
  in [app.js](app.js).
- Treat forecast resilience as a product requirement: missing or partial browser
  API responses should degrade cleanly instead of crashing the page.
- Avoid dependencies unless they clearly pay for themselves; the current no-build
  shape is deliberate.

## Validation Contract

- CI is defined in [.github/workflows/test.yml](.github/workflows/test.yml).
- The canonical local gates are:

```bash
node --check app.js
npm test
```

- `npm test` runs the no-dependency smoke suite in
  [tests/smoke.mjs](tests/smoke.mjs). If you change runtime selectors, scoring,
  localization, or radar helpers, add or update focused coverage there.
- Do not add snapshot churn or DOM-heavy test scaffolding for logic that can be
  tested directly through the exported runtime helpers.

## Docs

- Keep [README.md](README.md) aligned with the actual validation commands and
  the scoring/runtime behavior described in `app.js`.
