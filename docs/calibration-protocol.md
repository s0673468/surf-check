# Forecast calibration protocol

The score is a versioned heuristic until real beach checks show that it predicts useful
sessions. Do not tune spot thresholds or score coefficients from anecdotes, reconstructed
forecasts, or the synthetic test fixtures.

## Collect

Collect at least 40-60 matched spot-hours before the first retune. Aim for at least 15
same-window comparisons between two or more beaches, with checks made within 90 minutes of
the forecast target. Include:

- several beaches and forecast horizons (`D+0` through `D+3`);
- sub-floor, small rideable, solid, and closeout-size conditions;
- clean, cross-shore, and blown-out wind;
- the exact exported forecast template captured before the target time;
- observed 1-5 wave quality, breaking-height estimate, and cleanliness;
- board and stable rater identifier;
- crowd and access as separate context, never folded into wave quality.

Change an exported entry from `status: "template"` to `status: "observed"` only after the
real check is filled in. At that point set `evidenceKind: "field"` and record
`observed.observedAt` with seconds and an explicit timezone (`Z` or `-03:00`). The
export starts with `evidenceKind: "unverified"` and a null observation time; it cannot
establish a beach visit by itself. Preserve the downloaded forecast fields unchanged.
Never relabel a fixture, reconstructed forecast, or later recollection as field evidence.

Append the completed entry to a **local, private** ledger and run:

```bash
node scripts/forecast-truth.mjs /path/to/private-forecast-truth-ledger.json
```

`npm run forecast-truth` checks the repository ledger, which starts empty. This is a
public repository: keep actual visits, rater identifiers and notes out of commits and
PRs. The helper runs offline and only reads the supplied JSON. It does not submit or
store observations. An export can be captured now for a future beach check; retrieving
a historical forecast later does not satisfy the capture-before-target requirement.

### Machine-checkable collection contract

Only explicit `observed` / `field` schema-v2 rows contribute to the primary summary:

- Capture and target timestamps must be valid and include timezone offsets. Capture
  must precede the target and the beach check; `forecast.leadHours` must agree with
  those timestamps (within the export's rounding tolerance).
- The check must be within 90 minutes of its target. The forecast must be scorable,
  with essential raw wave and wind inputs (including the scorer's swell fallback) and
  provider provenance. Returned unknown
  model identifiers can remain null; do not invent them. Preserve the exported raw
  score and at-beach breaking height; do not substitute offshore height for that estimate.
- Observed rating, nonnegative breaking-height estimate, cleanliness, board, and stable
  rater identifier are required. Crowd and access remain optional, separate context.
- Use one row per beach/target spot-hour. Repeated rows, even under different IDs or
  raters, are excluded together until reconciled. Keep other horizon/rater repeats in
  separate diagnostic ledgers; do not use them to inflate independent sample counts.
- A same-window check compares distinct beaches at the same target instant, with the
  same rater, board, elapsed 24-hour forecast-horizon band, and observations no more
  than 90 minutes apart. Equivalent `Z` and `-03:00` timestamps match. Each target window
  counts once toward the 15 checks, regardless of beach-pair permutations or raters.

The report shows eligible matched spot-hours, distinct same-window checks, remaining
counts to 40 and 60, beach/horizon coverage, and exclusion reasons. The primary accuracy
metrics use only eligible field rows. Schema-v1, synthetic, reconstructed, and unverified
rows remain available under the helper API's `diagnostics` for arithmetic checks; their
metrics do not enter the field report. Test fixtures stay synthetic and memory-only.
Exact forecast ties receive half-credit for pairwise ranking; top-pick regret averages
the tied top ratings so rearranging rows cannot change it.

These checks validate declarations and consistency, not the truth of a beach visit or
the integrity of an edited forecast snapshot. Meeting 40 spot-hours and 15 windows means
only the sample minimum is met; condition coverage, frozen baseline, date split, and
held-out evaluation below remain required. The helper never declares empirical validation
complete or authorizes a retune.

## Evaluate

Freeze the current scoring version and a simpler baseline before collecting the held-out
dates. Split by date, not by individual row, so observations from the same weather system
cannot appear in both tuning and evaluation data.

Use these first-pass targets as decision gates, not promises:

| Measure | Initial target |
| --- | --- |
| Within one observed tier | at least 85% |
| Mean absolute tier error | at most 0.65 |
| Surfable false-positive rate | at most 15% |
| Surfable recall | at least 75% |
| Same-window pairwise ranking accuracy | at least 70% |
| Mean top-pick regret | at most 0.5 rating points |

A replacement model should improve the held-out primary metrics by about 10% without
materially worsening surfable false positives. A null result is valid; keep the simpler
model when the new one does not clear the gate.

## Sensitivity guard

Alongside real accuracy, perturb representative inputs by `±0.15 m`, `±1 s`, `±5 km/h`,
and `±15°`. Away from an explicit tier boundary, aim for:

- median score movement no greater than six points;
- fewer than 15% of cases changing tier;
- the selected beach remaining inside the same near-tied top group at least 75% of the
  time;
- missing essential wave or wind inputs always producing `status: "unknown"`.

Only after held-out evaluation should `minSurfHeight`, `idealHeight`, `maxHeight`, or model
coefficients be changed. Record the new algorithm version and preserve the old results for
comparison.
