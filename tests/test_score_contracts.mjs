// Synthetic numeric contracts for score-model.js; no browser or network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [Date.UTC(2026, 9, 7, 12)])); }
  static now() { return Date.UTC(2026, 9, 7, 12); }
}
const context = vm.createContext({
  Date: FixedDate,
  __stryker__: { activeMutant: process.env.__STRYKER_ACTIVE_MUTANT__ },
  state: { lang: "en" },
  COMPASS: { en: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] },
  spotDataProfile: (beach) => beach.profile,
  tProfile: (beach, key) => beach.profile[key],
}, { codeGeneration: { strings: false, wasm: false } });
for (const file of ["runtime-utils.js", "score-model.js"]) {
  vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    context, { timeout: 1000, filename: file });
}
const allowed = new Set(["directionWindowScore", "tideScore", "windQualityFactor",
  "effectiveWaveComponent", "forecastDataQuality", "scoreSample",
  "waveEnergy", "breakingHeight", "periodCurve", "surfableHeightFactor",
  "periodAwareCloseoutHeight", "tideTrendText", "tideQualityText", "windQualityText",
  "scoreLabel", "pinClass"]);
const invocations = new Map();
function call(name, ...args) {
  assert.ok(allowed.has(name));
  context.__args = args;
  if (!invocations.has(name)) invocations.set(name, new vm.Script(`${name}(...__args)`));
  return invocations.get(name).runInContext(context, { timeout: 1000 });
}
function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} differs from independent expectation ${expected}`);
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
const beach = { id: "synthetic", maxHeight: 3, swellCenter: 100, swellSpread: 60,
  offshoreWind: 280, idealTide: 0.5, tideSpread: 0.5,
  profile: { shelterIndex: 0, depthPower: 0.5, dataConfidence: 0.65, beachAxis: "north" } };
const sample = { waveHeight: 1, wavePeriod: 11, waveDirection: 100,
  swellHeight: 1, swellPeriod: 11, swellDirection: 100,
  secondarySwellHeight: 0, secondarySwellPeriod: 12, secondarySwellDirection: 100,
  windWaveHeight: 0, windWavePeriod: 5, windWaveDirection: 100,
  windSpeed: 5, windDirection: 280, windGusts: 9, seaLevel: 0.2, nextSeaLevel: 0.3,
  tideState: 0.5, precipitationProbability: 0, cloudCover: 0 };
const cases = [];
function check(name, body) { cases.push([name, body]); }

check("direction fit is neutral for invalid geometry and invariant under rotation and scaling", () => {
  for (const args of [[NaN, 100, 60], [100, Infinity, 60], [100, 100, NaN],
    [100, 100, 0], [100, 100, -1]]) close(call("directionWindowScore", ...args), 0.5);
  close(call("directionWindowScore", 100, 100, 60), 1);
  const inner = call("directionWindowScore", 120, 100, 60);
  assert.ok(inner > 0.06 && inner < 1);
  close(call("directionWindowScore", 10, 350, 60), inner);
  close(call("directionWindowScore", 110, 100, 30), inner);
  close(call("directionWindowScore", 160, 100, 60), 0.06);
  close(call("directionWindowScore", 180, 100, 60), 0.06);
});

check("normalized tide preference preserves relative distance and rejects invalid geometry", () => {
  for (const args of [[NaN, 0.5, 0.5], [0.5, Infinity, 0.5], [0.5, 0.5, NaN],
    [0.5, 0.5, 0], [0.5, 0.5, -1]]) close(call("tideScore", ...args), 0.6);
  close(call("tideScore", 0.5, 0.5, 0.5), 1);
  const inner = call("tideScore", 0.2, 0.4, 0.5);
  assert.ok(inner > 0.3 && inner < 1);
  close(call("tideScore", 0.4, 0.8, 1), inner);
  close(call("tideScore", 0, 0.5, 0.5), 0.3);
  close(call("tideScore", 0, 0.8, 0.5), 0.3);
});

check("calm wind approaches its direction-independent baseline without a jump", () => {
  const wind = (speed, direction) => call("windQualityFactor", beach,
    { windSpeed: speed, windDirection: direction, windGusts: speed });
  for (const speed of [NaN, 0, -1]) close(wind(speed, 280), 0.9);
  for (const direction of [280, 325, 10, 55, 100]) close(wind(1e-6, direction), 0.9, 1e-8);
  const angles = [280, 325, 10, 55, 100].map((direction) => wind(20, direction));
  for (let index = 1; index < angles.length; index += 1) {
    assert.ok(angles[index] <= angles[index - 1], "turning onshore must not improve wind quality");
  }
});

check("gust spread is free through its allowance and strong wind remains penalized", () => {
  const wind = (speed, gusts, direction = 280, size = 0.5) => call("windQualityFactor",
    beach, { windSpeed: speed, windDirection: direction, windGusts: gusts }, size);
  const base = wind(20, 20);
  const onshore = [15, 20, 25, 30].map((speed) => wind(speed, speed, 100));
  for (let i = 1; i < onshore.length; i += 1) {
    assert.ok(onshore[i] < onshore[i - 1], "growing whitecaps degrade a fixed onshore angle");
  }

  for (const gusts of [20, 24, 28, undefined]) close(wind(20, gusts), base);
  const justPast = wind(20, 28.001);
  assert.ok(justPast < base, "gust spread past the free allowance lowers quality");
  assert.ok(wind(20, 29) < justPast);
  assert.ok(wind(35, 35) < wind(32, 32), "strong offshore wind over-holds the face");
  for (const direction of [280, 10, 100]) assert.ok(wind(80, 80, direction) < 0.1);
  assert.ok(wind(20, 20, 100, 0.9) > wind(20, 20, 100, 0.1),
    "larger swell resists a fixed onshore wind");
});

check("fallback keeps height and period paired and absent physical components remain unknown", () => {
  const fallback = { ...sample, waveHeight: 1.5, wavePeriod: undefined,
    swellHeight: 0.8, swellPeriod: 14 };
  assert.deepEqual(plain(call("effectiveWaveComponent", fallback)),
    { height: 0.8, period: 14, source: "primary" });
  const missing = { ...sample, wavePeriod: undefined, swellPeriod: undefined };
  assert.deepEqual(plain(call("effectiveWaveComponent", missing)),
    { height: null, period: null, source: "missing" });
  const result = call("scoreSample", beach, missing, 1);
  assert.equal(result.status, "unknown");
  assert.equal(result.rawScore, 0);
  assert.ok(result.dataQuality.missingEssential.includes("waveHeight"));
});

check("data quality exposes exact missing machine fields and counts alternative weather once", () => {
  const quality = (changes) => call("forecastDataQuality", beach, { ...sample, ...changes }, 1);
  const directionMissing = quality({ waveDirection: undefined, swellDirection: undefined });
  assert.deepEqual(Array.from(directionMissing.missingEssential), ["waveDirection"]);
  assert.equal(directionMissing.scorable, false);
  const windMissing = quality({ windDirection: undefined });
  assert.deepEqual(Array.from(windMissing.missingEssential), ["windDirection"]);
  assert.equal(windMissing.scorable, false);
  const rainOnly = quality({ cloudCover: undefined });
  const cloudOnly = quality({ precipitationProbability: undefined });
  close(rainOnly.completeness, 1);
  close(cloudOnly.completeness, 1);
  close(quality({ precipitationProbability: undefined, cloudCover: undefined }).completeness, 0.9);
  close(quality({ swellHeight: undefined }).completeness, 0.9);
  close(quality({ swellPeriod: undefined }).completeness, 0.9);
});

check("clean swell energy respects paired primary fallback and each secondary period and direction", () => {
  const scored = (changes = {}) => call("scoreSample", beach, { ...sample, ...changes }, 1);
  const energy = (changes) => scored(changes).detail.energy;
  const base = energy({});
  assert.ok(base > 0);
  close(energy({ swellHeight: undefined, swellPeriod: undefined }), base);
  assert.ok(energy({ swellHeight: 0.8, swellPeriod: 14 }) < base,
    "primary partition keeps its own energy instead of borrowing the combined height");
  const aligned = { secondarySwellHeight: 0.4, secondarySwellPeriod: 16,
    secondarySwellDirection: 100 };
  assert.ok(energy(aligned) > base, "a valid secondary adds clean energy");
  assert.ok(energy({ ...aligned, secondarySwellDirection: 280 }) < energy(aligned));
  assert.ok(energy({ ...aligned, secondarySwellPeriod: 5 }) < energy(aligned));
  const windsea = { windWaveHeight: 0.5, windWavePeriod: 6 };
  const clean = scored({ ...windsea, windWaveDirection: 100 }).detail;
  const opposed = scored({ ...windsea, windWaveDirection: 280 }).detail;
  const unknown = scored({ ...windsea, windWaveDirection: undefined }).detail;
  assert.ok(clean.windseaFrac < opposed.windseaFrac);
  assert.ok(opposed.windseaFrac <= unknown.windseaFrac);
  assert.ok(clean.cleanliness > opposed.cleanliness);
});

check("weather detail penalizes known cloud or rain and preserves neutral missing weather", () => {
  const scored = (changes = {}) => call("scoreSample", beach, { ...sample, ...changes }, 1);
  close(scored().parts.weather, 100);
  close(scored({ precipitationProbability: undefined, cloudCover: undefined }).parts.weather, 70);
  assert.ok(scored({ cloudCover: 50 }).parts.weather < scored().parts.weather);
  assert.ok(scored({ precipitationProbability: 50 }).parts.weather < scored().parts.weather);
  assert.ok(scored({ cloudCover: undefined, precipitationProbability: 50 }).parts.weather < 100);
  assert.ok(scored({ precipitationProbability: undefined, cloudCover: 50 }).parts.weather < 100);
  assert.ok(scored({ waveHeight: 0.1, swellHeight: 0.1 }).score <= 51,
    "context cannot promote a below-floor observation above the documented cap");
  const missing = scored({ waveHeight: undefined, swellHeight: undefined });
  assert.equal(missing.status, "unknown");
  assert.equal(missing.rawScore, 0);
});

check("physical energy and breaker height reject negative height independently of period", () => {
  for (const height of [-0.01, -2]) {
    close(call("waveEnergy", height, 11), 0);
    close(call("breakingHeight", height, 11), 0);
  }
});

check("premium period stays between its documented endpoint qualities and increases smoothly", () => {
  const a = call("periodCurve", 12.5);
  const b = call("periodCurve", 13.5);
  const c = call("periodCurve", 14.5);
  assert.ok(0.95 < a && a < b && b < c && c < 1);
  close(call("periodCurve", 12), 0.95);
  close(call("periodCurve", 15), 1);
  assert.ok(Math.abs(call("periodCurve", 12 + 1e-6) - 0.95) < 1e-6);
});

check("surfable readiness remains continuous at the configured floor and saturates above full", () => {
  const spot = { minSurfHeight: 0.6, fullSurfHeight: 1 };
  close(call("surfableHeightFactor", 0.6, spot), 0.9);
  assert.ok(call("surfableHeightFactor", 0.6 - 1e-6, spot) < 0.9);
  assert.ok(call("surfableHeightFactor", 0.6 + 1e-6, spot) > 0.9);
  close(call("surfableHeightFactor", 1, spot), 1);
  close(call("surfableHeightFactor", 2, spot), 1);
  close(call("surfableHeightFactor", NaN, spot), 0.85);
});

check("zero or missing configured closeout size keeps the explicit no-limit policy", () => {
  for (const maxHeight of [0, -1, undefined, NaN, Infinity]) {
    assert.equal(call("periodAwareCloseoutHeight", { ...beach, maxHeight }, 11), Infinity);
  }
  const limited = call("periodAwareCloseoutHeight", beach, 11);
  assert.ok(Number.isFinite(limited) && limited > 0);
  assert.ok(call("periodAwareCloseoutHeight", beach, 15) > limited);
});

function meaning(value) {
  assert.equal(typeof value, "string");
  assert.ok(value.trim(), "classification must be available");
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function languages(body) {
  const previous = context.state.lang;
  try {
    for (const lang of ["en", "pt"]) { context.state.lang = lang; body(lang); }
  } finally { context.state.lang = previous; }
}

check("tide trend keeps signed movement missing fallback and datum invariance in both languages", () => {
  languages((lang) => {
    const categories = lang === "pt" ? ["enchendo", "vazando", "parada"] : ["rising", "dropping", "steady"];
    for (const [from, to, category] of [[0, 1, categories[0]], [1, 0, categories[1]], [1, 1, categories[2]]]) {
      assert.ok(meaning(call("tideTrendText", from, to)).includes(category));
      assert.ok(meaning(call("tideTrendText", from + 7, to + 7)).includes(category));
    }
    for (const [from, to] of [[undefined, 1], [1, NaN], [null, null]]) {
      assert.ok(meaning(call("tideTrendText", from, to)).includes(categories[2]));
    }
  });
});

check("tide quality preserves four ordered localized categories without prose snapshots", () => {
  languages((lang) => {
    const categories = lang === "pt" ? ["otima", "boa", "dificil", "ruim"] : ["prime", "usable", "tricky", "poor"];
    const labels = [1, 0.7, 0.45, 0].map((score) => meaning(call("tideQualityText", score)));
    assert.equal(new Set(labels).size, 4);
    labels.forEach((label, index) => assert.ok(label.includes(categories[index])));
  });
});

check("wind descriptions retain semantic direction strength and unknown flags in both languages", () => {
  languages((lang) => {
    const strengths = lang === "pt" ? ["leve", "moderado", "forte"] : ["light", "moderate", "strong"];
    for (const [speedIndex, speed] of [5, 20, 35].entries()) {
      for (const [directionIndex, diff] of [0, 70, 115, 180].entries()) {
        const label = meaning(call("windQualityText", diff, speed));
        assert.ok(label.includes(strengths[speedIndex]));
        const direction = lang === "pt" ? (directionIndex < 2 ? "terral" : "maral") : (directionIndex < 2 ? "offshore" : "onshore");
        assert.ok(label.includes(direction));
        assert.equal(label.includes(lang === "pt" ? "lateral" : "cross"), directionIndex === 1 || directionIndex === 2);
      }
    }
    const unknown = [call("windQualityText", 0, 5, false), call("windQualityText", 180, 35, false)].map(meaning);
    assert.equal(unknown[0], unknown[1]);
    assert.ok(unknown[0].includes(lang === "pt" ? "sem direcao" : "unknown"));
  });
});

check("localized tier labels and map pins agree on known categories and missing fallback", () => {
  const pins = ["pin-excellent", "pin-good", "pin-fair", "pin-poor", "pin-bad", "pin-empty"];
  const pin = (score) => {
    const classes = new Set(String(call("pinClass", score)).split(/\s+/));
    const categories = pins.filter((name) => classes.has(name));
    assert.equal(categories.length, 1, "one known map category must be available");
    return categories[0];
  };
  languages((lang) => {
    const categories = lang === "pt" ? ["excelente", "bom", "surfavel", "fraco", "ruim"] : ["excellent", "good", "workable", "marginal", "poor"];
    const labels = [90, 70, 60, 45, 20].map((score, index) => {
      assert.equal(pin(score), pins[index]);
      const label = meaning(call("scoreLabel", score));
      assert.ok(label.includes(categories[index]));
      return label;
    });
    assert.equal(new Set(labels).size, 5);
    assert.equal(pin(-1), "pin-bad");
    assert.ok(meaning(call("scoreLabel", -1)).includes(categories[4]));
    assert.ok(meaning(call("scoreLabel", undefined)).includes(categories[4]));
  });
  for (const absent of [undefined, null, NaN, Infinity]) assert.equal(pin(absent), "pin-empty");
});

let seed = Number(process.env.SURF_CASE_ORDER_SEED ?? 8401) >>> 0;
for (let index = cases.length - 1; index > 0; index -= 1) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const other = seed % (index + 1);
  [cases[index], cases[other]] = [cases[other], cases[index]];
}
for (const [name, body] of cases) test(name, body);
