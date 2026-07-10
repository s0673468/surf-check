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
real check is filled in. Append it to `calibration/forecast-truth-ledger.json`, then run
`npm run forecast-truth`.

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
