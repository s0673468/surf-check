import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SCORE_BANDS = [
  { min: 80, band: "excellent", ordinal: 5 },
  { min: 66, band: "good", ordinal: 4 },
  { min: 52, band: "workable", ordinal: 3 },
  { min: 38, band: "marginal", ordinal: 2 },
  { min: 0, band: "poor", ordinal: 1 },
];

const OBSERVED_BANDS = new Map([
  [1, { band: "poor", ordinal: 1 }],
  [2, { band: "marginal", ordinal: 2 }],
  [3, { band: "workable", ordinal: 3 }],
  [4, { band: "good", ordinal: 4 }],
  [5, { band: "excellent", ordinal: 5 }],
]);

const SCORE_MODEL_SOURCE = readFileSync(fileURLToPath(new URL("../score-model.js", import.meta.url)), "utf8");
const SCORE_MODEL_VERSION = readScoreModelVersion();
// Reuse the browser's combined/partition fallback rather than invent another
// definition of essential wave data for exported snapshots.
const { effectiveWaveComponent, effDir } = vm.runInNewContext(
  `${SCORE_MODEL_SOURCE}\n({ effectiveWaveComponent, effDir })`,
);

export function loadTruthLedgerFromFile(pathOrUrl) {
  return JSON.parse(readFileSync(pathOrUrl, "utf8"));
}

export function scoreBandForScore(score) {
  if (!Number.isFinite(score)) return { band: "missing", ordinal: null };
  return SCORE_BANDS.find((entry) => score >= entry.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export function observedBandForRating(rating) {
  const normalized = numeric(rating);
  return OBSERVED_BANDS.get(normalized) ?? { band: "missing", ordinal: null };
}

export function compareTruthEntry(entry) {
  const forecastScore = numeric(entry.forecast?.score);
  const forecastRawScore = firstNumeric(entry.forecast?.rawScore, forecastScore);
  const observedRating = numeric(entry.observed?.rating);
  const forecastBand = scoreBandForScore(forecastScore);
  const observedBand = observedBandForRating(observedRating);
  const forecastHeightM = firstNumeric(
    entry.forecast?.breakingHeightM,
    entry.forecast?.rawInputs?.waveHeight,
    entry.forecast?.sample?.waveHeightM,
    entry.forecast?.sample?.heightM,
    entry.forecast?.sample?.swellHeightM,
  );
  const observedHeightM = firstNumeric(
    entry.observed?.faceHeightM,
    entry.observed?.heightM,
    entry.observed?.waveHeightM,
  );
  const ratingDelta =
    Number.isFinite(observedBand.ordinal) && Number.isFinite(forecastBand.ordinal)
      ? observedBand.ordinal - forecastBand.ordinal
      : null;
  const heightDeltaM =
    Number.isFinite(observedHeightM) && Number.isFinite(forecastHeightM)
      ? round(observedHeightM - forecastHeightM, 2)
      : null;

  return {
    id: entry.id,
    beachId: entry.beachId,
    capturedAt: entry.capturedAt ?? null,
    targetTime: entry.targetTime,
    observedAt: entry.observed?.observedAt ?? null,
    rater: entry.observed?.rater ?? null,
    board: entry.observed?.board ?? null,
    leadHours: numeric(entry.forecast?.leadHours),
    algorithmVersion: entry.forecast?.algorithmVersion ?? null,
    dataQuality: entry.forecast?.dataQuality ?? null,
    model: entry.forecast?.model ?? null,
    forecastScore,
    forecastRawScore,
    forecastBand: forecastBand.band,
    observedRating,
    observedBand: observedBand.band,
    ratingDelta,
    forecastHeightM,
    observedHeightM,
    heightDeltaM,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    notes: entry.observed?.notes ?? "",
  };
}

export function analyzeTruthLedger(ledger) {
  if (![1, 2].includes(ledger?.schemaVersion)) {
    throw new Error("forecast truth ledger schemaVersion must be 1 or 2");
  }
  if (!Array.isArray(ledger.entries)) {
    throw new Error("forecast truth ledger entries must be an array");
  }
  if (ledger.schemaVersion === 2 && !nonBlankString(ledger.algorithmVersion)) {
    throw new Error("forecast truth ledger schemaVersion 2 requires algorithmVersion");
  }
  if (ledger.schemaVersion === 2 && ledger.algorithmVersion !== SCORE_MODEL_VERSION) {
    throw new Error("forecast truth ledger algorithmVersion does not match score-model.js SURF_SCORE_VERSION");
  }

  const candidateEntries = ledger.entries
    .filter((entry) => entry?.status !== "template" && entry?.status !== "example")
    .map((entry) => {
      validateEntry(entry, ledger.schemaVersion, ledger.algorithmVersion);
      return entry;
    });

  const collection = assessCollection(ledger, candidateEntries);
  const comparisons = collection.eligibleEntries.map(compareTruthEntry);
  const diagnosticComparisons = candidateEntries.map(compareTruthEntry);
  delete collection.eligibleEntries;
  return {
    comparisons,
    summary: summarizeComparisons(comparisons, true),
    collection,
    // Legacy, unverified, and synthetic rows can exercise the arithmetic, but
    // must never contribute to the field summary or collection thresholds.
    diagnostics: {
      comparisons: diagnosticComparisons,
      summary: summarizeComparisons(diagnosticComparisons),
    },
  };
}

function summarizeComparisons(comparisons, fieldOnly = false) {
  const ratingDeltas = comparisons.map((entry) => entry.ratingDelta).filter(Number.isFinite);
  const heightDeltas = comparisons.map((entry) => entry.heightDeltaM).filter(Number.isFinite);
  const absoluteRatingDeltas = ratingDeltas.map(Math.abs);
  const classification = surfableClassification(comparisons);
  const ranking = rankingMetrics(comparisons, fieldOnly);

  return {
    entryCount: comparisons.length,
    meanRatingDelta: mean(ratingDeltas),
    meanAbsoluteTierError: mean(absoluteRatingDeltas),
    withinOneTierRate: rate(
      ratingDeltas.filter((delta) => Math.abs(delta) <= 1).length,
      ratingDeltas.length,
    ),
    meanHeightDeltaM: mean(heightDeltas),
    tooPessimistic: comparisons.filter((entry) => entry.ratingDelta > 0).length,
    tooOptimistic: comparisons.filter((entry) => entry.ratingDelta < 0).length,
    matched: comparisons.filter((entry) => entry.ratingDelta === 0).length,
    surfableFalsePositiveRate: classification.falsePositiveRate,
    surfableRecall: classification.recall,
    surfableCounts: classification.counts,
    pairwiseRankingAccuracy: ranking.pairwiseAccuracy,
    pairwiseComparisons: ranking.pairwiseComparisons,
    meanTopPickRegret: ranking.meanTopPickRegret,
    rankedWindows: ranking.rankedWindows,
  };
}

function assessCollection(ledger, entries) {
  const spotHours = new Map();
  for (const entry of entries) {
    if (entry.evidenceKind !== "field" || entry.status !== "observed") continue;
    const target = timestamp(entry.targetTime);
    if (target === null) continue;
    const key = `${entry.beachId}|${Math.floor(target / 3_600_000)}`;
    spotHours.set(key, (spotHours.get(key) ?? 0) + 1);
  }
  const eligibleEntries = [];
  const exclusions = [];
  for (const entry of entries) {
    const reasons = fieldExclusionReasons(entry, ledger.schemaVersion);
    const target = timestamp(entry.targetTime);
    if (target !== null && spotHours.get(`${entry.beachId}|${Math.floor(target / 3_600_000)}`) > 1) {
      reasons.push("duplicate beach/target spot-hour; reconcile repeated observations");
    }
    if (reasons.length) exclusions.push({ id: entry.id, reasons });
    else eligibleEntries.push(entry);
  }
  const comparisons = eligibleEntries.map(compareTruthEntry);
  const sameWindowChecks = rankingMetrics(comparisons, true).distinctTargetWindows;
  const matchedSpotHours = eligibleEntries.length;
  return {
    eligibleEntries,
    matchedSpotHours,
    sameWindowChecks,
    minimumSpotHours: 40,
    targetSpotHours: 60,
    minimumSameWindowChecks: 15,
    remainingToMinimum: Math.max(0, 40 - matchedSpotHours),
    remainingToTarget: Math.max(0, 60 - matchedSpotHours),
    remainingSameWindowChecks: Math.max(0, 15 - sameWindowChecks),
    sampleMinimumMet: matchedSpotHours >= 40 && sameWindowChecks >= 15,
    status: matchedSpotHours >= 40 && sameWindowChecks >= 15
      ? "sample-minimum-met; held-out evaluation still required"
      : "collection-incomplete",
    beachIds: [...new Set(comparisons.map((entry) => entry.beachId))].sort(),
    forecastDayOffsets: [...new Set(comparisons.map((entry) => Math.floor(entry.leadHours / 24)))].sort(),
    exclusions,
  };
}

function fieldExclusionReasons(entry, schemaVersion) {
  const reasons = [];
  if (schemaVersion !== 2) reasons.push("schema v2 forecast snapshot required");
  if (entry.status !== "observed") reasons.push("status must be observed after a real beach check");
  if (entry.evidenceKind !== "field") reasons.push("evidenceKind must explicitly declare field (never synthetic or reconstructed)");
  const captured = timestamp(entry.capturedAt);
  const target = timestamp(entry.targetTime);
  const observed = timestamp(entry.observed?.observedAt);
  if (captured === null) reasons.push("capturedAt needs a valid timestamp with timezone");
  if (target === null) reasons.push("targetTime needs a valid timestamp with timezone");
  if (observed === null) reasons.push("observed.observedAt needs a valid timestamp with timezone");
  if (captured !== null && target !== null) {
    if (captured >= target) reasons.push("forecast must be captured before targetTime");
    const lead = (target - captured) / 3_600_000;
    if (Math.abs(lead - numeric(entry.forecast?.leadHours)) > 0.02) reasons.push("forecast.leadHours disagrees with capture/target times");
    if (lead < 0 || lead >= 96) reasons.push("forecast horizon must be D+0 through D+3 (under 96 hours)");
  }
  if (target !== null && observed !== null && Math.abs(observed - target) > 90 * 60_000) {
    reasons.push("beach check must be within 90 minutes of targetTime");
  }
  if (captured !== null && observed !== null && captured > observed) reasons.push("forecast capture must precede the beach check");
  if (entry.forecast?.dataQuality?.scorable !== true) reasons.push("forecast must have scorable essential inputs");
  if (!Number.isFinite(numeric(entry.forecast?.rawScore)) || numeric(entry.forecast?.rawScore) < 0 || numeric(entry.forecast?.rawScore) > 100) {
    reasons.push("forecast.rawScore must preserve the exported score in 0..100");
  }
  if (!Number.isFinite(numeric(entry.forecast?.breakingHeightM)) || numeric(entry.forecast?.breakingHeightM) < 0) {
    reasons.push("forecast.breakingHeightM must preserve the exported at-beach height");
  }
  const raw = entry.forecast?.rawInputs ?? {};
  const wave = effectiveWaveComponent(raw);
  if (!Number.isFinite(wave.height) || wave.height < 0 ||
      (wave.height > 0 && (!Number.isFinite(wave.period) || !Number.isFinite(effDir(raw)))) ||
      !Number.isFinite(raw.windSpeed) || raw.windSpeed < 0 ||
      (raw.windSpeed > 0 && !Number.isFinite(raw.windDirection))) {
    reasons.push("snapshot needs scorable essential wave and wind inputs, including real zeros");
  }
  if (!nonBlankString(entry.forecast?.model?.provider) || entry.forecast.model.provider === "unknown") {
    reasons.push("forecast provider provenance required (unknown returned model identifiers may stay null)");
  }
  if (!Number.isFinite(numeric(entry.observed?.heightM)) || numeric(entry.observed?.heightM) < 0) reasons.push("observed.heightM must be a nonnegative breaking-height estimate");
  if (!nonBlankString(entry.observed?.cleanliness)) reasons.push("observed.cleanliness required");
  if (!nonBlankString(entry.observed?.board)) reasons.push("observed.board required");
  if (!nonBlankString(entry.observed?.rater)) reasons.push("observed.rater needs a stable identifier");
  return reasons;
}

// Require an explicit timezone and reject normalized impossible dates (e.g. Feb 30).
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = value.slice(0, 10);
  const calendarDate = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTruthSummary(analysis) {
  const { summary, comparisons, collection } = analysis;
  const lines = [
    `Field collection: ${collection.status}`,
    `Matched spot-hours: ${collection.matchedSpotHours} / 40–60 (minimum remaining: ${collection.remainingToMinimum}; target remaining: ${collection.remainingToTarget})`,
    `Same-window checks: ${collection.sameWindowChecks} / 15 (remaining: ${collection.remainingSameWindowChecks})`,
    `Beach coverage: ${collection.beachIds.join(", ") || "--"}`,
    `Forecast horizons: ${collection.forecastDayOffsets.map((day) => `D+${day}`).join(", ") || "--"}`,
    "Basis: self-declared field observations; the helper cannot independently verify a beach visit or an unaltered snapshot.",
    "Sample counts do not establish empirical validation. Date-held-out baseline comparison and condition coverage are still required before retuning.",
    `Excluded diagnostic rows: ${collection.exclusions.length} (templates and examples are ignored)`,
    ...collection.exclusions.map((entry) => `- ${cell(entry.id)}: ${entry.reasons.join("; ")}`),
    "",
    `Eligible field entries: ${summary.entryCount}`,
    `Mean rating delta: ${formatSigned(summary.meanRatingDelta)}`,
    `Mean absolute tier error: ${formatNumber(summary.meanAbsoluteTierError)}`,
    `Within one tier: ${formatPercent(summary.withinOneTierRate)}`,
    `Mean height delta: ${formatSigned(summary.meanHeightDeltaM, " m")}`,
    `Surfable false-positive rate: ${formatPercent(summary.surfableFalsePositiveRate)}`,
    `Surfable recall: ${formatPercent(summary.surfableRecall)}`,
    `Pairwise ranking accuracy: ${formatPercent(summary.pairwiseRankingAccuracy)} (${summary.pairwiseComparisons} comparisons)`,
    `Mean top-pick regret: ${formatNumber(summary.meanTopPickRegret)} rating points (${summary.rankedWindows} windows)`,
    "",
    "| time | beach | forecast | observed | delta | height delta | tags |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const entry of comparisons) {
    lines.push(
      `| ${cell(entry.targetTime)} | ${cell(entry.beachId)} | ${cell(entry.forecastScore)} ${cell(entry.forecastBand)} | ${cell(entry.observedRating)} ${cell(entry.observedBand)} | ${formatSigned(entry.ratingDelta)} | ${formatSigned(entry.heightDeltaM, " m")} | ${cell(entry.tags.join(", "))} |`,
    );
  }

  return lines.join("\n");
}

function validateEntry(entry, schemaVersion = 1, ledgerAlgorithmVersion = null) {
  for (const key of ["id", "beachId", "targetTime"]) {
    if (!nonBlankString(entry?.[key])) throw new Error(`forecast truth entry is missing ${key}`);
  }
  if (schemaVersion === 2) {
    if (!nonBlankString(entry.capturedAt)) {
      throw new Error(`forecast truth entry ${entry.id} is missing capturedAt`);
    }
    if (!Number.isFinite(numeric(entry.forecast?.leadHours))) {
      throw new Error(`forecast truth entry ${entry.id} is missing forecast.leadHours`);
    }
    if (!nonBlankString(entry.forecast?.algorithmVersion)) {
      throw new Error(`forecast truth entry ${entry.id} is missing forecast.algorithmVersion`);
    }
    if (entry.forecast.algorithmVersion !== ledgerAlgorithmVersion) {
      throw new Error(`forecast truth entry ${entry.id} algorithmVersion does not match ledger.algorithmVersion`);
    }
    if (entry.forecast.algorithmVersion !== SCORE_MODEL_VERSION) {
      throw new Error(`forecast truth entry ${entry.id} algorithmVersion does not match score-model.js SURF_SCORE_VERSION`);
    }
    if (!entry.forecast?.rawInputs || typeof entry.forecast.rawInputs !== "object") {
      throw new Error(`forecast truth entry ${entry.id} is missing forecast.rawInputs`);
    }
    if (!entry.forecast?.dataQuality || typeof entry.forecast.dataQuality !== "object") {
      throw new Error(`forecast truth entry ${entry.id} is missing forecast.dataQuality`);
    }
    if (!entry.forecast?.model || typeof entry.forecast.model !== "object") {
      throw new Error(`forecast truth entry ${entry.id} is missing forecast.model`);
    }
  }
  if (!Number.isFinite(numeric(entry.forecast?.score))) {
    throw new Error(`forecast truth entry ${entry.id} is missing forecast.score`);
  }
  if (!Number.isFinite(numeric(entry.observed?.rating))) {
    throw new Error(`forecast truth entry ${entry.id} is missing observed.rating`);
  }
  const forecastScore = numeric(entry.forecast.score);
  if (forecastScore < 0 || forecastScore > 100) {
    throw new Error(`forecast truth entry ${entry.id} has forecast.score outside 0..100`);
  }
  const observedRating = numeric(entry.observed.rating);
  if (!OBSERVED_BANDS.has(observedRating)) {
    throw new Error(`forecast truth entry ${entry.id} has observed.rating outside 1..5`);
  }
}

function readScoreModelVersion() {
  const match = SCORE_MODEL_SOURCE.match(/\bconst\s+SURF_SCORE_VERSION\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("score-model.js SURF_SCORE_VERSION is missing");
  return match[1];
}

function surfableClassification(comparisons) {
  const counts = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
  for (const entry of comparisons) {
    const forecastSurfable = entry.forecastScore >= 52;
    const observedSurfable = entry.observedRating >= 3;
    if (forecastSurfable && observedSurfable) counts.truePositive += 1;
    else if (forecastSurfable) counts.falsePositive += 1;
    else if (observedSurfable) counts.falseNegative += 1;
    else counts.trueNegative += 1;
  }
  return {
    counts,
    falsePositiveRate: rate(counts.falsePositive, counts.falsePositive + counts.trueNegative),
    recall: rate(counts.truePositive, counts.truePositive + counts.falseNegative),
  };
}

function rankingMetrics(comparisons, fieldOnly = false) {
  const byTarget = new Map();
  for (const entry of comparisons) {
    const target = timestamp(entry.targetTime) ?? entry.targetTime;
    const key = fieldOnly
      ? JSON.stringify([target, entry.rater, entry.board, Math.floor(entry.leadHours / 24)])
      : target;
    const group = byTarget.get(key) ?? [];
    group.push(entry);
    byTarget.set(key, group);
  }

  let pairwiseCredit = 0;
  let pairwiseComparisons = 0;
  const regrets = [];
  const targetWindows = new Set();
  for (const entries of byTarget.values()) {
    if (entries.length < 2) continue;
    if (new Set(entries.map((entry) => entry.beachId)).size !== entries.length) continue;
    if (fieldOnly) {
      const observedTimes = entries.map((entry) => timestamp(entry.observedAt));
      if (Math.max(...observedTimes) - Math.min(...observedTimes) > 90 * 60_000) continue;
    }
    const ranked = [...entries].sort((a, b) => b.forecastRawScore - a.forecastRawScore);
    targetWindows.add(timestamp(entries[0].targetTime) ?? entries[0].targetTime);
    const tiedTopRatings = ranked.filter((entry) => entry.forecastRawScore === ranked[0].forecastRawScore)
      .map((entry) => entry.observedRating);
    const tiedTopRating = tiedTopRatings.reduce((sum, rating) => sum + rating, 0) / tiedTopRatings.length;
    regrets.push(Math.max(...entries.map((entry) => entry.observedRating)) - tiedTopRating);
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        const observedDelta = entries[left].observedRating - entries[right].observedRating;
        if (observedDelta === 0) continue;
        const forecastDelta = entries[left].forecastRawScore - entries[right].forecastRawScore;
        pairwiseComparisons += 1;
        if (forecastDelta === 0) pairwiseCredit += 0.5;
        else if (Math.sign(forecastDelta) === Math.sign(observedDelta)) pairwiseCredit += 1;
      }
    }
  }
  return {
    pairwiseAccuracy: rate(pairwiseCredit, pairwiseComparisons),
    pairwiseComparisons,
    meanTopPickRegret: mean(regrets),
    rankedWindows: regrets.length,
    distinctTargetWindows: targetWindows.size,
  };
}

function numeric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function firstNumeric(...values) {
  return values.map(numeric).find(Number.isFinite) ?? null;
}

function mean(values) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return round(numerator / denominator, 4);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatSigned(value, unit = "") {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value}${unit}`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(value) : "--";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${round(value * 100, 1)}%` : "--";
}

function cell(value) {
  if (value === null || value === undefined || value === "") return "--";
  return String(value).replaceAll("|", "\\|");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ledgerPath = process.argv[2] ?? new URL("../calibration/forecast-truth-ledger.json", import.meta.url);
  const analysis = analyzeTruthLedger(loadTruthLedgerFromFile(ledgerPath));
  console.log(formatTruthSummary(analysis));
}
