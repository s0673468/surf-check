# Property and Corruption Findings

No production bugs were found in the Surf property/fuzz campaign.

| Module | Minimal reproducer | Category | Action taken | Commit/test |
| --- | --- | --- | --- | --- |
| `score-model.js`, `forecast-selectors.js`, `forecast-api.js`, `rain-radar.js`, `scripts/forecast-truth.mjs` | 80 deterministic CI examples plus two 1000-example deep runs across generated forecast cells, score samples, radar metadata, API hourly payloads, and calibration ledgers | None | Added regression-oriented property and corruption coverage | `tests/property/fuzz.mjs` |

The corruption harness covers the calibration JSON ledger with truncation, dropped/duplicated/reordered lines, flipped bytes, empty files, NUL bytes, BOM-prefixed files, CRLF conversion, and a valid file with one malformed record in the middle. All cases either parse and validate cleanly or fail with an explicit caught `Error`; no mutated malformed record is accepted as a plausible comparison.
