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
  const observedRating = numeric(entry.observed?.rating);
  const forecastBand = scoreBandForScore(forecastScore);
  const observedBand = observedBandForRating(observedRating);
  const forecastHeightM = firstNumeric(
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
    targetTime: entry.targetTime,
    forecastScore,
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
  if (ledger?.schemaVersion !== 1) {
    throw new Error("forecast truth ledger schemaVersion must be 1");
  }
  if (!Array.isArray(ledger.entries)) {
    throw new Error("forecast truth ledger entries must be an array");
  }

  const comparisons = ledger.entries
    .filter((entry) => entry.status !== "template" && entry.status !== "example")
    .map((entry) => {
      validateEntry(entry);
      return compareTruthEntry(entry);
    });

  const ratingDeltas = comparisons.map((entry) => entry.ratingDelta).filter(Number.isFinite);
  const heightDeltas = comparisons.map((entry) => entry.heightDeltaM).filter(Number.isFinite);

  return {
    comparisons,
    summary: {
      entryCount: comparisons.length,
      meanRatingDelta: mean(ratingDeltas),
      meanHeightDeltaM: mean(heightDeltas),
      tooPessimistic: comparisons.filter((entry) => entry.ratingDelta > 0).length,
      tooOptimistic: comparisons.filter((entry) => entry.ratingDelta < 0).length,
      matched: comparisons.filter((entry) => entry.ratingDelta === 0).length,
    },
  };
}

export function formatTruthSummary(analysis) {
  const { summary, comparisons } = analysis;
  const lines = [
    `Entries: ${summary.entryCount}`,
    `Mean rating delta: ${formatSigned(summary.meanRatingDelta)}`,
    `Mean height delta: ${formatSigned(summary.meanHeightDeltaM, " m")}`,
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

function validateEntry(entry) {
  for (const key of ["id", "beachId", "targetTime"]) {
    if (!entry?.[key]) throw new Error(`forecast truth entry is missing ${key}`);
  }
  if (!Number.isFinite(numeric(entry.forecast?.score))) {
    throw new Error(`forecast truth entry ${entry.id} is missing forecast.score`);
  }
  if (!Number.isFinite(numeric(entry.observed?.rating))) {
    throw new Error(`forecast truth entry ${entry.id} is missing observed.rating`);
  }
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumeric(...values) {
  return values.map(numeric).find(Number.isFinite) ?? null;
}

function mean(values) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatSigned(value, unit = "") {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value}${unit}`;
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
