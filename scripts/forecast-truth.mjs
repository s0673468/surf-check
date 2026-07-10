import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

export function loadTruthLedgerFromFile(pathOrUrl) {
  return JSON.parse(readFileSync(pathOrUrl, "utf8"));
}

export function scoreBandForScore(score) {
  if (!Number.isFinite(score)) return { band: "missing", ordinal: null };
  return SCORE_BANDS.find((entry) => score >= entry.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export function observedBandForRating(rating) {
  const normalized = Number(rating);
  return OBSERVED_BANDS.get(normalized) ?? { band: "missing", ordinal: null };
}

export function compareTruthEntry(entry) {
  const forecastScore = numeric(entry.forecast?.score);
  const forecastRawScore = firstNumeric(entry.forecast?.rawScore, forecastScore);
  const observedRating = numeric(entry.observed?.rating);
  const forecastBand = scoreBandForScore(forecastScore);
  const observedBand = observedBandForRating(observedRating);
  const forecastHeightM = firstNumeric(
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

  const comparisons = ledger.entries
    .filter((entry) => entry.status !== "template" && entry.status !== "example")
    .map((entry) => {
      validateEntry(entry, ledger.schemaVersion);
      return compareTruthEntry(entry);
    });

  const ratingDeltas = comparisons.map((entry) => entry.ratingDelta).filter(Number.isFinite);
  const heightDeltas = comparisons.map((entry) => entry.heightDeltaM).filter(Number.isFinite);
  const absoluteRatingDeltas = ratingDeltas.map(Math.abs);
  const classification = surfableClassification(comparisons);
  const ranking = rankingMetrics(comparisons);

  return {
    comparisons,
    summary: {
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
    },
  };
}

export function formatTruthSummary(analysis) {
  const { summary, comparisons } = analysis;
  const lines = [
    `Entries: ${summary.entryCount}`,
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

function validateEntry(entry, schemaVersion = 1) {
  for (const key of ["id", "beachId", "targetTime"]) {
    if (!entry?.[key]) throw new Error(`forecast truth entry is missing ${key}`);
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

function rankingMetrics(comparisons) {
  const byTarget = new Map();
  for (const entry of comparisons) {
    const group = byTarget.get(entry.targetTime) ?? [];
    group.push(entry);
    byTarget.set(entry.targetTime, group);
  }

  let pairwiseCredit = 0;
  let pairwiseComparisons = 0;
  const regrets = [];
  for (const entries of byTarget.values()) {
    if (entries.length < 2) continue;
    const ranked = [...entries].sort((a, b) => b.forecastRawScore - a.forecastRawScore);
    regrets.push(Math.max(...entries.map((entry) => entry.observedRating)) - ranked[0].observedRating);
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
  };
}

function numeric(value) {
  if (value === null || value === undefined) return null;
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
