// Offline behavioral contracts for the forecast helpers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import "./test_score_contracts.mjs";

let now = Date.UTC(2026, 9, 7, 12);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({
  Date: FixedDate,
  __stryker__: { activeMutant: process.env.__STRYKER_ACTIVE_MUTANT__ },
  state: { lang: "en", selectedDayOffset: 0, selectedHour: 9, forecasts: new Map() },
  BEACHES: [], HOURS: [6, 7, 8], TZ: "America/Sao_Paulo",
  SAO_PAULO_UTC_OFFSET_HOURS: 3, HOUR_MIN: 6, HOUR_MAX: 20,
  COMPASS: { en: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] },
  spotDataProfile: (beach) => beach.profile,
  tProfile: (beach, key) => beach.profile[key],
}, { codeGeneration: { strings: false, wasm: false } });
const sources = ["runtime-utils.js", "score-model.js", "forecast-selectors.js"];
for (const file of sources) {
  vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    context, { timeout: 1000, filename: file });
}
const allowed = new Set(["average", "valueAt", "angularDiff", "distanceKm",
  "compassWindow", "smoothstep", "formatDistance", "formatSigned", "formatDegrees",
  "selectedForecastTimestampSeconds", "initialSelectedHour", "waveEnergy",
  "breakingHeight", "sizeMagnitude", "periodCurve", "fullySurfableHeight",
  "effectiveWaveComponent", "effDir", "forecastDataQuality", "coastalFitScore",
  "scoreSample", "bestScoredEntry", "scoreValue", "nearTiedEntries",
  "groupScoredEntries", "compareByScoreDesc", "computeScoredSample",
  "getScoredTimeline", "getScoredSample", "tideStateAt"]);
const invocations = new Map();
function call(name, ...args) {
  assert.ok(allowed.has(name));
  context.__args = args;
  if (!invocations.has(name)) invocations.set(name, new vm.Script(`${name}(...__args)`));
  return invocations.get(name).runInContext(context, { timeout: 1000 });
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} differs from independent expectation ${expected}`);
}
function reset() {
  now = Date.UTC(2026, 9, 7, 12);
  context.state.lang = "en";
  context.state.forecasts.clear();
  vm.runInContext("scoredSampleCache.clear()", context, { timeout: 1000 });
}
const beach = { id: "fixture", maxHeight: 3, swellCenter: 100, swellSpread: 60,
  offshoreWind: 280, idealTide: 0.5, tideSpread: 0.5, name: "Synthetic beach",
  profile: { shelterIndex: 0, depthPower: 0.5, dataConfidence: 0.65, beachAxis: "north" } };
const sample = { waveHeight: 1, wavePeriod: 11, waveDirection: 100,
  swellHeight: 1, swellPeriod: 11, swellDirection: 100,
  secondarySwellHeight: 0, secondarySwellPeriod: 12, secondarySwellDirection: 100,
  windWaveHeight: 0, windWavePeriod: 5, windWaveDirection: 100,
  windSpeed: 5, windDirection: 280, windGusts: 9, seaLevel: 0.2, nextSeaLevel: 0.3,
  tideState: 0.5, precipitationProbability: 0, cloudCover: 0 };
const fields = {
  weather: { temperature_2m: ["temperature", 22],
    precipitation_probability: ["precipitationProbability", 15], cloud_cover: ["cloudCover", 35],
    wind_speed_10m: ["windSpeed", 5], wind_direction_10m: ["windDirection", 270],
    wind_gusts_10m: ["windGusts", 9] },
  marine: { wave_height: ["waveHeight", 1.2], wave_direction: ["waveDirection", 100],
    wave_period: ["wavePeriod", 11], swell_wave_height: ["swellHeight", 1],
    swell_wave_direction: ["swellDirection", 105], swell_wave_period: ["swellPeriod", 10],
    secondary_swell_wave_height: ["secondarySwellHeight", 0.3],
    secondary_swell_wave_direction: ["secondarySwellDirection", 115],
    secondary_swell_wave_period: ["secondarySwellPeriod", 12],
    wind_wave_height: ["windWaveHeight", 0.2], wind_wave_direction: ["windWaveDirection", 90],
    wind_wave_period: ["windWavePeriod", 5], sea_level_height_msl: ["seaLevel", 0.2],
    sea_surface_temperature: ["seaTemperature", 24] },
};
function forecast() {
  const date = "2026-10-07";
  const value = { weather: { time: [`${date}T07:00`, `${date}T06:00`] },
    marine: { time: [`${date}T06:00`, `${date}T07:00`] }, metadata: { synthetic: true } };
  for (const [key, [, amount]] of Object.entries(fields.weather)) value.weather[key] = [amount + 1, amount];
  for (const [key, [, amount]] of Object.entries(fields.marine)) value.marine[key] = [amount, amount + 0.1];
  context.state.forecasts.set(beach.id, value);
  return value;
}
const cases = [];
function check(name, body) { cases.push([name, body]); }

check("finite means ignore missing observations and absent indices stay null", () => {
  assert.equal(call("average", [2, 4, NaN, Infinity]), 3);
  assert.ok(Number.isNaN(call("average", [NaN, Infinity])));
  assert.equal(call("valueAt", { wave: [1] }, "wave", 9), null);
});
check("angular difference rejects one invalid angle without poisoning its neutral result", () => {
  assert.equal(call("angularDiff", NaN, 30), 180);
  assert.equal(call("angularDiff", 30, Infinity), 180);
  assert.equal(call("angularDiff", 350, 10), 20);
});
check("great-circle distance agrees with independent quarter-earth geometry", () => {
  const origin = { lat: 0, lon: 0 };
  assert.equal(call("distanceKm", origin, origin), 0);
  assert.equal(call("distanceKm", { lat: 35, lon: -110 }, { lat: 35, lon: -110 }), 0);
  close(call("distanceKm", origin, { lat: 0, lon: 90 }), 6371 * Math.PI / 2, 1e-6);
  close(call("distanceKm", origin, { lat: 45, lon: 45 }), 6371 * Math.PI / 3, 1e-6);
});
check("compass windows preserve left-right geometry and collapse a narrow window", () => {
  function endpoints(display) {
    const points = String(display).split("-").map((point) => point.toUpperCase());
    assert.ok(points.length === 1 || points.length === 2);
    return points.length === 1 ? [points[0], points[0]] : points;
  }
  assert.deepEqual(endpoints(call("compassWindow", 0, 90)), ["NW", "NE"]);
  assert.deepEqual(endpoints(call("compassWindow", 0, 10)), ["N", "N"]);
});
check("collapsed smoothstep edges have a defined inclusive step", () => {
  assert.equal(call("smoothstep", 4, 5, 5), 0);
  assert.equal(call("smoothstep", 5, 5, 5), 1);
  assert.equal(call("smoothstep", 6, 5, 5), 1);
});
check("dimensioned formats retain distance magnitude and signed angular observations", () => {
  for (const km of [0.999, 1, 1.5]) {
    const displayed = String(call("formatDistance", km)).match(/^([+-]?\d+(?:\.\d+)?) (m|km)$/);
    assert.ok(displayed, "Distance must retain a numeric quantity and recognized physical unit");
    const physicalKm = Number(displayed[1]) * (displayed[2] === "m" ? 0.001 : 1);
    // Accept both unit representations at the existing coarsest0.1km display resolution.
    close(physicalKm, km, 0.0500001);
  }
  for (const value of [-1.234, 1.234]) {
    const displayed = String(call("formatSigned", value));
    assert.match(displayed, /^[+-]?\d+(?:\.\d+)?$/);
    close(Number(displayed), value, 0.0050001);
  }
  const degrees = String(call("formatDegrees", 90.4)).match(/^([+-]?\d+(?:\.\d+)?)°$/);
  assert.ok(degrees, "Angle must retain a numeric observation and physical unit");
  close(Number(degrees[1]), 90.4, 0.5000001);
});
check("nonfinite forecast selections return missing time instead of NaN", () => {
  assert.equal(call("selectedForecastTimestampSeconds", 0, NaN), null);
  assert.equal(call("selectedForecastTimestampSeconds", NaN, 9), null);
});
check("initial selection clamps Sao Paulo local hour at both slider endpoints", () => {
  now = Date.UTC(2026, 9, 7, 4);
  assert.equal(call("initialSelectedHour"), 6);
  now = Date.UTC(2026, 9, 8, 2);
  assert.equal(call("initialSelectedHour"), 20);
});
check("wave energy rejects nonphysical input and retains height-squared power", () => {
  for (const args of [[-2, 8], [2, 0], [NaN, 8], [2, Infinity]]) {
    assert.equal(call("waveEnergy", ...args), 0);
  }
  assert.equal(call("waveEnergy", 2, 8), 32);
});
check("breaking height uses the same fallback for zero and missing period", () => {
  assert.equal(call("breakingHeight", NaN, 11), 0);
  const fallback = call("breakingHeight", 2, 9);
  close(call("breakingHeight", 2, 0), fallback);
  close(call("breakingHeight", 2, undefined), fallback);
});
check("size reference is half magnitude and absent size remains neutral", () => {
  assert.equal(call("sizeMagnitude", NaN), 0);
  assert.equal(call("sizeMagnitude", -1), 0);
  assert.equal(call("sizeMagnitude", 0.8), 0.5);
});
check("period quality preserves its independently documented easing midpoint", () => {
  assert.equal(call("periodCurve", NaN), 0.4);
  assert.equal(call("periodCurve", 4), 0.55);
  close(call("periodCurve", 8.5), 0.75);
  assert.equal(call("periodCurve", 16), 1);
});
check("full readiness always sits above the configured surfable floor", () => {
  close(call("fullySurfableHeight", { minSurfHeight: 1.2, fullSurfHeight: 1.2 }), 1.5);
  close(call("fullySurfableHeight", { minSurfHeight: 1.2, fullSurfHeight: 0.5 }), 1.5);
  assert.equal(call("fullySurfableHeight", { minSurfHeight: 1.2, fullSurfHeight: 1.4 }), 1.4);
});
check("flat components retain their own missing period and source identity", () => {
  assert.deepEqual(plain(call("effectiveWaveComponent", { waveHeight: 0, wavePeriod: null,
    swellHeight: 1, swellPeriod: 12 })), { height: 0, period: null, source: "combined" });
  assert.deepEqual(plain(call("effectiveWaveComponent", { waveHeight: null,
    swellHeight: 0, swellPeriod: null })), { height: 0, period: null, source: "primary" });
  assert.equal(call("effDir", { swellDirection: 0, waveDirection: 100 }), 0);
});
check("quality tiers retain exact horizon-confidence and optional-field coverage", () => {
  const quality = (s, day = 1, b = beach) => call("forecastDataQuality", b, s, day);
  assert.equal(quality(sample).tier, "high");
  assert.equal(quality(sample).completeness, 1);
  assert.equal(quality(sample, 2).tier, "mid");
  assert.equal(quality(sample, 1, { ...beach, profile: { ...beach.profile, dataConfidence: 0.64 } }).tier, "mid");
  const missingPeriod = { ...sample, windWavePeriod: undefined };
  assert.equal(quality(missingPeriod).completeness, 0.9);
  assert.equal(quality(missingPeriod).tier, "high");
  const six = { waveHeight: 1, wavePeriod: 11, swellDirection: 100,
    windSpeed: 5, windDirection: 280, windGusts: 9 };
  assert.equal(quality(six).completeness, 0.6);
  assert.equal(quality(six).tier, "mid");
});
check("coastal confidence is neutral at zero and rewards independently ideal energy", () => {
  const profile = (changes) => ({ ...beach, profile: { ...beach.profile, ...changes } });
  assert.equal(call("coastalFitScore", profile({ dataConfidence: 0 }), 0.65), 50);
  close(call("coastalFitScore", profile({ dataConfidence: 1 }), 0.65), 100);
  close(call("coastalFitScore", profile({ shelterIndex: 1, dataConfidence: 1 }), 0.3), 100);
});
check("scored detail retains numeric scale and configured confidence", () => {
  const result = call("scoreSample", beach, sample, 1);
  assert.ok(result.detail.provisionalRawScore >= 0 && result.detail.provisionalRawScore <= 100);
  assert.equal(result.detail.provisionalRawScore, result.rawScore);
  assert.equal(result.detail.dataConfidence, 0.65);
  const neutral = call("scoreSample", { ...beach, profile: { ...beach.profile, dataConfidence: 0 } }, sample, 1);
  assert.equal(neutral.parts.coastal, 50);
});
check("ranking preserves raw-score precedence empty result and first tie", () => {
  assert.equal(call("bestScoredEntry", []), null);
  const low = { rawScore: 10, score: 99 }, high = { rawScore: 30, score: 30 };
  const middle = { rawScore: 20, score: 20 }, tie = { rawScore: 30, score: 30 };
  assert.equal(call("bestScoredEntry", [low, high, middle, tie]), high);
  assert.equal(call("scoreValue", { scored: { score: { rawScore: 15.25, score: 15 } } }), 15.25);
  assert.equal(call("scoreValue", { rawScore: 2.5, score: 3 }), 2.5);
  assert.equal(call("scoreValue", undefined), undefined);
  assert.ok(call("compareByScoreDesc", low, middle) > 0);
});
check("near-tie grouping includes the exact three-point latent boundary", () => {
  const entries = [{ id: "c", rawScore: 86.999, score: 99 },
    { id: "b", rawScore: 87, score: 87 }, { id: "a", rawScore: 90, score: 90 }];
  assert.deepEqual(Array.from(call("nearTiedEntries", entries), (x) => x.id), ["a", "b"]);
});
check("grouping retains every original entry in ordered Map buckets", () => {
  const first = { key: "a" }, second = { key: "b" }, third = { key: "a" };
  const groups = call("groupScoredEntries", [first, second, third], (entry) => entry.key);
  assert.equal(groups.size, 2);
  assert.equal(groups.get("a").length, 2);
  assert.equal(groups.get("a")[0], first);
  assert.equal(groups.get("a")[1], third);
  assert.equal(groups.get("b")[0], second);
});
check("all forecast fields use their own aligned API columns and final tide clamps", () => {
  const value = forecast(), result = call("computeScoredSample", beach, 0, 6);
  for (const group of Object.values(fields)) {
    for (const [name, expected] of Object.values(group)) assert.equal(result.sample[name], expected);
  }
  assert.equal(result.forecastMetadata, value.metadata);
  close(call("computeScoredSample", beach, 0, 7).sample.nextSeaLevel, 0.3);
  value.marine.time[0] = "2026-10-07T05:00";
  assert.equal(call("computeScoredSample", beach, 0, 6), null);
  assert.deepEqual(Array.from(call("getScoredTimeline", beach, 0), (x) => x.hour), [7]);
});
check("memoization returns the exact object for a repeated selected cell", () => {
  forecast();
  const first = call("getScoredSample", beach, 0, 6);
  assert.ok(first);
  assert.equal(call("getScoredSample", beach, 0, 6), first);
});
check("tide normalization excludes readings beyond its local18-hour range", () => {
  const levels = Array(40).fill(0);
  levels[0] = 2; levels[20] = 1; levels[39] = 2;
  assert.equal(call("tideStateAt", { sea_level_height_msl: levels }, 20), 1);
  // The VM timeout bounds a genuine nonprogressing native loop separately.
});

let seed = Number(process.env.SURF_CASE_ORDER_SEED ?? 7901) >>> 0;
for (let index = cases.length - 1; index > 0; index -= 1) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const other = seed % (index + 1);
  [cases[index], cases[other]] = [cases[other], cases[index]];
}
for (const [name, body] of cases) test(name, () => { reset(); body(); });
