// All rows in this file are synthetic, memory-only regression fixtures. Some
// deliberately claim evidenceKind: field to exercise validation of that contract.
// They are never saved as observations and do not establish empirical accuracy.
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTruthLedger, formatTruthSummary } from "../scripts/forecast-truth.mjs";

function fixture(overrides = {}) {
  return {
    id: "synthetic-contract-a",
    beachId: "joaquina",
    status: "observed",
    evidenceKind: "field",
    capturedAt: "2026-07-09T11:00:00.000Z",
    targetTime: "2026-07-10T11:00:00.000Z",
    forecast: {
      score: 70, rawScore: 70.2, breakingHeightM: 1,
      algorithmVersion: "2.0.0", leadHours: 24,
      rawInputs: { waveHeight: 1, wavePeriod: 8, waveDirection: 135, windSpeed: 8, windDirection: 315 },
      dataQuality: { scorable: true, tier: "high", completeness: 1, missingEssential: [] },
      model: { provider: "open-meteo", weatherModel: null, marineModel: null },
    },
    observed: {
      observedAt: "2026-07-10T11:20:00.000Z", rating: 4, heightM: 1,
      cleanliness: "clean", board: "shortboard", rater: "test-rater",
      crowd: null, accessNotes: "",
    },
    ...overrides,
  };
}

function analyze(entries) {
  return analyzeTruthLedger({ schemaVersion: 2, algorithmVersion: "2.0.0", entries });
}

test("empty ledger reports observation work remaining and no accuracy", () => {
  const analysis = analyze([]);
  assert.equal(analysis.collection.remainingToMinimum, 40);
  assert.equal(analysis.collection.remainingToTarget, 60);
  assert.equal(analysis.collection.remainingSameWindowChecks, 15);
  assert.equal(analysis.collection.sampleMinimumMet, false);
  assert.equal(analysis.summary.withinOneTierRate, null);
  assert.match(formatTruthSummary(analysis), /Field collection: collection-incomplete/);
});

test("synthetic, reconstructed, unverified and legacy rows are diagnostic only", () => {
  for (const evidenceKind of ["synthetic", "reconstructed", "unverified", undefined]) {
    const analysis = analyze([fixture({ evidenceKind })]);
    assert.equal(analysis.summary.entryCount, 0);
    assert.equal(analysis.diagnostics.summary.entryCount, 1);
    assert.equal(analysis.collection.matchedSpotHours, 0);
    assert.equal(analysis.summary.meanAbsoluteTierError, null);
  }
  const legacy = analyzeTruthLedger({ schemaVersion: 1, entries: [fixture()] });
  assert.equal(legacy.summary.entryCount, 0);
  assert.equal(legacy.diagnostics.summary.entryCount, 1);
  const templates = analyze([fixture({ status: "template" }), fixture({ status: "example" })]);
  assert.equal(templates.diagnostics.summary.entryCount, 0);
});

test("only a complete timestamped field contract contributes to field metrics", () => {
  const analysis = analyze([fixture()]);
  assert.equal(analysis.summary.entryCount, 1);
  assert.equal(analysis.collection.matchedSpotHours, 1);
  assert.equal(analysis.collection.sameWindowChecks, 0);
  assert.equal(analysis.summary.meanAbsoluteTierError, 0);
  assert.equal(analysis.collection.sampleMinimumMet, false);
});

test("late capture, invalid timestamps, timing mismatch and outside-window checks are excluded", () => {
  const base = fixture();
  const cases = [
    { capturedAt: base.targetTime },
    { capturedAt: "2026-07-11T11:00:00Z" },
    { capturedAt: "2026-13-01T11:00:00Z" },
    { targetTime: "2026-02-30T11:00:00Z" },
    { targetTime: "2026-07-10T11:00:00" },
    { forecast: { ...base.forecast, leadHours: 23 } },
    { capturedAt: "2026-07-06T11:00:00Z", forecast: { ...base.forecast, leadHours: 96 } },
    { observed: { ...base.observed, observedAt: null } },
    { observed: { ...base.observed, observedAt: "2026-07-10T12:30:01Z" } },
    { observed: { ...base.observed, observedAt: "2026-07-10T09:29:59Z" } },
    { capturedAt: "2026-07-10T10:59:00Z", forecast: { ...base.forecast, leadHours: 0.02 },
      observed: { ...base.observed, observedAt: "2026-07-10T10:58:00Z" } },
  ];
  for (const override of cases) {
    const analysis = analyze([fixture(override)]);
    assert.equal(analysis.collection.matchedSpotHours, 0, JSON.stringify(override));
    assert.ok(analysis.collection.exclusions[0].reasons.length);
  }
  for (const observedAt of ["2026-07-10T09:30:00Z", "2026-07-10T12:30:00Z"]) {
    assert.equal(analyze([fixture({ observed: { ...base.observed, observedAt } })]).summary.entryCount, 1);
  }
});

test("missing field context and unknown forecast data cannot look like a poor surf prediction", () => {
  const base = fixture();
  const cases = [
    { forecast: { ...base.forecast, dataQuality: { scorable: false } } },
    { forecast: { ...base.forecast, rawInputs: {} } },
    { forecast: { ...base.forecast, rawScore: null } },
    { forecast: { ...base.forecast, rawScore: 101 } },
    { forecast: { ...base.forecast, breakingHeightM: null } },
    { forecast: { ...base.forecast, rawInputs: { ...base.forecast.rawInputs, wavePeriod: null } } },
    { forecast: { ...base.forecast, rawInputs: { ...base.forecast.rawInputs, windDirection: null } } },
    { forecast: { ...base.forecast, model: { provider: "unknown" } } },
    ...["board", "rater", "cleanliness"].map((key) => ({ observed: { ...base.observed, [key]: "" } })),
    { observed: { ...base.observed, heightM: null } },
    { observed: { ...base.observed, heightM: -1 } },
  ];
  for (const override of cases) {
    const analysis = analyze([fixture(override)]);
    assert.equal(analysis.summary.entryCount, 0);
    assert.equal(analysis.summary.surfableCounts.trueNegative, 0);
  }
  for (const score of [true, [], {}]) {
    assert.throws(() => analyze([fixture({ forecast: { ...base.forecast, score } })]), /forecast.score/);
  }
  const flat = fixture({ forecast: { ...base.forecast, rawInputs: { waveHeight: 0, windSpeed: 0 } } });
  assert.equal(analyze([flat]).summary.entryCount, 1);
  const partition = fixture({ forecast: { ...base.forecast, rawInputs: {
    waveHeight: null, swellHeight: 1, swellPeriod: 8, swellDirection: 135, windSpeed: 0,
  } } });
  assert.equal(analyze([partition]).summary.entryCount, 1);
});

test("duplicate beach/spot-hours fail closed independent of IDs, rater or timestamp spelling", () => {
  const base = fixture();
  const duplicate = fixture({ id: "synthetic-contract-b", targetTime: "2026-07-10T08:00:00-03:00",
    observed: { ...base.observed, rater: "another-rater" } });
  const analysis = analyze([base, duplicate]);
  assert.equal(analysis.collection.matchedSpotHours, 0);
  assert.equal(analysis.collection.sameWindowChecks, 0);
  assert.ok(analysis.collection.exclusions.every((row) => row.reasons.some((reason) => /duplicate/.test(reason))));
  assert.equal(analysis.diagnostics.summary.rankedWindows, 0);
});

test("same-window metrics use distinct beaches, matching rater/board/horizon and comparable times", () => {
  const base = fixture();
  const other = fixture({ id: "synthetic-contract-b", beachId: "matadeiro", targetTime: "2026-07-10T08:00:00-03:00",
    forecast: { ...base.forecast, score: 60, rawScore: 60.2 },
    observed: { ...base.observed, rating: 5, observedAt: "2026-07-10T12:00:00Z" } });
  const analysis = analyze([base, other]);
  assert.equal(analysis.collection.sameWindowChecks, 1);
  assert.equal(analysis.summary.pairwiseComparisons, 1);
  assert.equal(analysis.summary.pairwiseRankingAccuracy, 0);
  assert.equal(analysis.summary.meanTopPickRegret, 1);
  for (const key of ["rater", "board"]) {
    const row = { ...other, observed: { ...other.observed, [key]: "different" } };
    assert.equal(analyze([base, row]).collection.sameWindowChecks, 0);
  }
  const horizon = { ...other, capturedAt: "2026-07-10T10:00:00Z", forecast: { ...other.forecast, leadHours: 1 } };
  assert.equal(analyze([base, horizon]).collection.sameWindowChecks, 0);
  const tooFar = { ...base, observed: { ...base.observed, observedAt: "2026-07-10T09:30:00Z" } };
  assert.equal(analyze([tooFar, other]).collection.sameWindowChecks, 0);
});

test("pair permutations and additional raters cannot inflate the 15-window requirement", () => {
  const base = fixture();
  const rows = ["a", "b", "c", "d"].map((beachId, i) => fixture({ id: `synthetic-${i}`, beachId,
    observed: { ...base.observed, rater: i < 2 ? "one-rater" : "two-rater" } }));
  const analysis = analyze(rows);
  assert.equal(analysis.collection.sameWindowChecks, 1);
  assert.equal(analysis.summary.rankedWindows, 2);
});

test("exact forecast ties have half pairwise credit and order-independent expected regret", () => {
  const base = fixture();
  const other = fixture({ id: "synthetic-tie-b", beachId: "matadeiro",
    observed: { ...base.observed, rating: 2 } });
  const forward = analyze([base, other]);
  const reverse = analyze([other, base]);
  assert.equal(forward.summary.pairwiseRankingAccuracy, 0.5);
  assert.equal(forward.summary.meanTopPickRegret, 1);
  assert.equal(reverse.summary.meanTopPickRegret, forward.summary.meanTopPickRegret);
});

test("meeting synthetic sample counts still cannot claim completed empirical validation", () => {
  const rows = [];
  for (let day = 1; day <= 20; day += 1) {
    const targetTime = `2026-07-${String(day).padStart(2, "0")}T11:00:00Z`;
    const capturedAt = new Date(Date.parse(targetTime) - 3_600_000).toISOString();
    for (const beachId of ["joaquina", "matadeiro"]) {
      const base = fixture();
      rows.push(fixture({ id: `synthetic-${day}-${beachId}`, beachId, targetTime, capturedAt,
        forecast: { ...base.forecast, leadHours: 1 }, observed: { ...base.observed, observedAt: targetTime } }));
    }
  }
  const analysis = analyze(rows);
  assert.equal(analysis.collection.matchedSpotHours, 40);
  assert.equal(analysis.collection.sameWindowChecks, 20);
  assert.equal(analysis.collection.sampleMinimumMet, true);
  assert.match(analysis.collection.status, /held-out evaluation still required/);
  assert.match(formatTruthSummary(analysis), /Sample counts do not establish empirical validation/);
  const markedSynthetic = analyze(rows.map((row) => ({ ...row, evidenceKind: "synthetic" })));
  assert.equal(markedSynthetic.collection.sampleMinimumMet, false);
  assert.equal(markedSynthetic.summary.entryCount, 0);
});
