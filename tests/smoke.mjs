import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  analyzeTruthLedger,
  formatTruthSummary,
  loadTruthLedgerFromFile,
} from "../scripts/forecast-truth.mjs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const runtimeScriptFiles = Array.from(
  indexHtml.matchAll(/<script\b[^>]*\bsrc="\.\/([^"]+\.js)"[^>]*><\/script>/g),
  (match) => match[1],
);
const runtimeSources = runtimeScriptFiles.map((file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
);
const context = {
  console,
  URL,
  URLSearchParams,
  window: {
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    setTimeout,
  },
  document: {
    documentElement: { lang: "pt-BR" },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  },
};

vm.createContext(context);
vm.runInContext(
  `${runtimeSources.join("\n")}
globalThis.__surfCheckTest = {
  BEACHES,
  HOURS,
  state,
  dateKey,
  describeDay,
  describeCoastalFit,
  describeSwell,
  describeTide,
  describeWeather,
  describeWind,
  fetchBeachForecast,
  fetchJson,
  getForecastView,
  getScoredSample,
  getNearbyScoredBeachEntries,
  getScoredBeachEntries,
  getScoredTimeline,
  buildRadarTileUrl,
  findClosestRadarFrameIndex,
  normalizeRadarFrames,
  scoreSample,
  selectedBeach,
  windQualityFactor,
  surfableHeightFloor,
  surfableHeightFactor,
  sizeMagnitude,
  effectiveBreakingHeight,
  directionWindowScore,
  coastalFitScore,
  tideScore,
  tideStateAt,
  selectedForecastTimestampSeconds,
  degToCompass,
  numericCell,
  buildSpotRead,
  compactSessionRead,
  contrastReason,
  confidenceMeta,
  scoreLabel,
  pinClass,
  summarizeConditions,
  summarizeTiming,
  scoredSampleCache,
};`,
  context,
  { filename: "app.js" },
);

const surf = context.__surfCheckTest;

test("runtime script lists match page order", () => {
  const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");
  const lintScripts = makefile
    .match(/^RUNTIME_SCRIPTS := (.+)$/m)?.[1]
    .trim()
    .split(/\s+/);

  assert.deepEqual(runtimeScriptFiles, [
    "surf-config.js",
    "runtime-utils.js",
    "forecast-api.js",
    "score-model.js",
    "forecast-selectors.js",
    "forecast-prose.js",
    "rain-radar.js",
    "app.js",
  ]);
  assert.deepEqual(lintScripts, runtimeScriptFiles);
});

function markdownFilesUnder(relativeDir) {
  return readdirSync(new URL(`../${relativeDir}/`, import.meta.url), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return markdownFilesUnder(relativePath);
    if (entry.isFile() && entry.name.endsWith(".md")) return [relativePath];
    return [];
  });
}

test("public source docs do not expose private authoring paths", () => {
  const publicTextFiles = [
    "README.md",
    "styles.css",
    ...markdownFilesUnder("docs"),
  ];
  const publicText = publicTextFiles
    .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
    .join("\n");

  for (const marker of [
    ["Health", "design", "system"].join(" "),
    ["health", "design", "system"].join("-"),
    ["~", ".claude"].join("/"),
    ["German", "surfed"].join(" "),
    ["/", "Users", "/"].join(""),
    ["german", "chernukhin"].join(""),
  ]) {
    assert.equal(publicText.includes(marker), false, marker);
  }
});

test("forecast truth ledger is machine readable", () => {
  const ledger = loadTruthLedgerFromFile(
    new URL("../calibration/forecast-truth-ledger.json", import.meta.url),
  );
  const analysis = analyzeTruthLedger(ledger);

  assert.equal(ledger.schemaVersion, 1);
  assert.equal(analysis.summary.entryCount, 0);
});

test("forecast truth helper compares one forecast with one observed session", () => {
  const analysis = analyzeTruthLedger({
    schemaVersion: 1,
    entries: [
      {
        id: "matadeiro-small-clean-fixture",
        beachId: "matadeiro",
        targetTime: "2026-06-21T08:00:00-03:00",
        forecast: {
          score: 42,
          label: "Marginal",
          sample: {
            waveHeightM: 0.86,
            wavePeriodS: 6.7,
            windSpeedKmh: 1.8,
          },
        },
        observed: {
          rating: 3,
          heightM: 0.8,
          cleanliness: "clean",
          notes: "Small, clean, and worth paddling.",
        },
        tags: ["small-clean", "size-underread"],
      },
    ],
  });
  const [entry] = analysis.comparisons;
  const summary = formatTruthSummary(analysis);

  assert.equal(entry.forecastBand, "marginal");
  assert.equal(entry.observedBand, "workable");
  assert.equal(entry.ratingDelta, 1);
  assert.equal(entry.heightDeltaM, -0.06);
  assert.equal(analysis.summary.tooPessimistic, 1);
  assert.match(summary, /matadeiro/);
  assert.match(summary, /\+1/);
});

function seedForecasts() {
  const date = surf.dateKey(0);
  const times = surf.HOURS.map((hour) => `${date}T${String(hour).padStart(2, "0")}:00`);

  surf.state.forecasts.clear();
  surf.scoredSampleCache.clear();
  surf.state.lang = "pt";
  surf.state.selectedBeachId = "ingleses";
  surf.state.selectedDayOffset = 0;
  surf.state.selectedHour = 8;
  surf.state.loading = false;
  surf.state.error = "";
  surf.state.loadedCount = surf.BEACHES.length;

  surf.BEACHES.forEach((beach, beachIndex) => {
    const swellBoost = beach.id === "ingleses" ? 0.18 : 0;
    const values = times.map((_, index) => index);
    const windSpeed = values.map((index) => 8 + (index % 4));

    surf.state.forecasts.set(beach.id, {
      beachId: beach.id,
      weather: {
        time: times,
        temperature_2m: values.map((index) => 22 + index * 0.2),
        apparent_temperature: values.map((index) => 23 + index * 0.2),
        precipitation_probability: values.map((index) => (index >= 8 ? 35 : 18)),
        cloud_cover: values.map((index) => 30 + index),
        wind_speed_10m: windSpeed,
        wind_direction_10m: values.map(() => beach.offshoreWind),
        wind_gusts_10m: windSpeed.map((speed) => speed + 4),
      },
      marine: {
        time: times,
        wave_height: values.map(() => 1.1 + swellBoost),
        wave_direction: values.map(() => beach.swellCenter),
        wave_period: values.map(() => 11),
        swell_wave_height: values.map(() => 1.05 + swellBoost),
        swell_wave_direction: values.map(() => beach.swellCenter),
        swell_wave_period: values.map(() => 11),
        secondary_swell_wave_height: values.map(() => 0.35 + beachIndex * 0.01),
        secondary_swell_wave_direction: values.map(() => beach.swellCenter + 12),
        secondary_swell_wave_period: values.map(() => 9),
        wind_wave_height: values.map(() => 0.18),
        wind_wave_period: values.map(() => 5),
        sea_level_height_msl: values.map((index) => beach.idealTide + (index - 6) * 0.01),
        sea_surface_temperature: values.map(() => 20.5),
      },
    });
  });
}

function cleanAlignedSample(beach, { height = 1.2, period = 12 } = {}) {
  return {
    temperature: 22,
    precipitationProbability: 5,
    cloudCover: 10,
    windSpeed: 6,
    windDirection: beach.offshoreWind,
    windGusts: 8,
    waveHeight: height,
    waveDirection: beach.swellCenter,
    wavePeriod: period,
    swellHeight: height,
    swellDirection: beach.swellCenter,
    swellPeriod: period,
    secondarySwellHeight: 0,
    secondarySwellDirection: beach.swellCenter,
    secondarySwellPeriod: period,
    windWaveHeight: 0.04,
    windWavePeriod: 4,
    seaLevel: 0,
    nextSeaLevel: 0.02,
    tideState: beach.idealTide,
    seaTemperature: 20,
  };
}

function assertReadableProse(value) {
  assert.equal(typeof value, "string");
  assert.ok(value.length > 4);
  assert.doesNotMatch(value, /\b(undefined|NaN)\b/);
}

async function withMockedBrowserIO({ fetch, setTimeout }, run) {
  const originalFetch = context.fetch;
  const originalSetTimeout = context.window.setTimeout;

  if (fetch) context.fetch = fetch;
  if (setTimeout) context.window.setTimeout = setTimeout;

  try {
    await run();
  } finally {
    context.fetch = originalFetch;
    context.window.setTimeout = originalSetTimeout;
  }
}

test("forecast selectors build a reusable selected-hour view", () => {
  seedForecasts();

  const view = surf.getForecastView(0, 8);

  assert.equal(view.scoredBeaches.length, surf.BEACHES.length);
  assert.equal(view.rankedBeaches.length, surf.BEACHES.length);
  assert.equal(view.selectedBeach.id, "ingleses");
  assert.equal(view.selectedScored.beach.id, "ingleses");
  assert.ok(view.scoredByBeachId.has("ingleses"));
  assert.ok(
    view.rankedBeaches.every(
      (entry, index, entries) =>
        index === 0 || entries[index - 1].scored.score.score >= entry.scored.score.score,
    ),
  );
});

test("forecast selectors tolerate missing beach forecasts", () => {
  seedForecasts();

  surf.state.forecasts.delete("ingleses");
  surf.scoredSampleCache.clear();

  const view = surf.getForecastView(0, 8);

  assert.equal(view.selectedBeach.id, "ingleses");
  assert.equal(view.selectedScored, null);
  assert.equal(view.scoredBeaches.length, surf.BEACHES.length - 1);
  assert.equal(view.rankedBeaches.length, surf.BEACHES.length - 1);
  assert.equal(view.scoredByBeachId.has("ingleses"), false);
});

test("timeline and nearby selectors keep beach context", () => {
  seedForecasts();

  const beach = surf.selectedBeach();
  const timeline = surf.getScoredTimeline(beach, 0);
  const nearby = surf.getNearbyScoredBeachEntries(beach, 0, 8);

  assert.deepEqual(
    timeline.map((entry) => entry.hour),
    surf.HOURS,
  );
  assert.equal(nearby.length, 4);
  assert.ok(nearby.every((entry) => entry.beach.id !== beach.id));
  assert.ok(
    nearby.every(
      (entry, index, entries) => index === 0 || entries[index - 1].distance <= entry.distance,
    ),
  );
});

test("scored samples align weather, marine, and next tide by timestamp", () => {
  seedForecasts();

  const beach = surf.selectedBeach();
  const scored = surf.getScoredSample(beach, 0, 8);

  assert.ok(scored);
  assert.equal(scored.beach.id, "ingleses");
  assert.match(scored.sample.time, /T08:00$/);
  assert.equal(scored.sample.temperature, 22.4);
  assert.equal(scored.sample.seaLevel, beach.idealTide - 0.04);
  assert.equal(scored.sample.nextSeaLevel, beach.idealTide - 0.03);
});

test("scored samples keep blank hourly cells missing instead of zero", () => {
  seedForecasts();

  const beach = surf.selectedBeach();
  const forecast = surf.state.forecasts.get(beach.id);
  const target = `${surf.dateKey(0)}T08:00`;
  const weatherIndex = forecast.weather.time.indexOf(target);
  const marineIndex = forecast.marine.time.indexOf(target);

  forecast.weather.temperature_2m[weatherIndex] = "  ";
  forecast.weather.wind_speed_10m[weatherIndex] = " 9 ";
  forecast.marine.swell_wave_height[marineIndex] = "\t";
  forecast.marine.wave_height[marineIndex] = " 1.2 ";
  surf.scoredSampleCache.clear();

  const scored = surf.getScoredSample(beach, 0, 8);

  assert.equal(scored.sample.temperature, null);
  assert.equal(scored.sample.windSpeed, 9);
  assert.equal(scored.sample.swellHeight, null);
  assert.equal(scored.sample.waveHeight, 1.2);
});

test("day overview describes seeded forecast in both languages", () => {
  seedForecasts();

  for (const lang of ["pt", "en"]) {
    surf.state.lang = lang;
    const day = surf.describeDay(0);

    assert.ok(day);
    assert.equal(typeof day.text, "string");
    assert.ok(day.text.length > 20);
    assert.equal(typeof day.peakScore, "number");
    assert.ok(!day.text.includes("undefined"));
  }
});

test("forecast prose helpers tolerate partial samples in both languages", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const partial = {
    ...cleanAlignedSample(beach),
    waveHeight: null,
    wavePeriod: null,
    swellHeight: null,
    swellDirection: null,
    swellPeriod: null,
    windSpeed: null,
    windDirection: null,
    windGusts: null,
    tideState: null,
    seaLevel: null,
    precipitationProbability: null,
    cloudCover: null,
  };
  const score = surf.scoreSample(beach, partial, 0);

  for (const lang of ["pt", "en"]) {
    surf.state.lang = lang;
    const reads = [
      surf.describeSwell(beach, partial),
      surf.describeWind(beach, partial),
      surf.describeCoastalFit(beach, partial, score.parts.coastal),
      surf.describeTide(beach, partial, score),
      surf.describeWeather(partial),
    ];

    for (const read of reads) {
      assertReadableProse(read.short);
      assertReadableProse(read.detail);
    }
  }
});

test("nearby contrast prose falls back when scores are nearly tied", () => {
  const selectedBeach = surf.BEACHES.find((item) => item.id === "praia-mole");
  const otherBeach = surf.BEACHES.find((item) => item.id === "joaquina");
  const parts = { swell: 70, wind: 70, coastal: 70, tide: 70, weather: 70 };
  const selectedScored = {
    beach: selectedBeach,
    sample: cleanAlignedSample(selectedBeach),
    score: { parts },
  };
  const otherScored = {
    beach: otherBeach,
    sample: cleanAlignedSample(otherBeach),
    score: { parts },
  };

  surf.state.lang = "en";
  assert.match(surf.contrastReason(selectedScored, otherScored), /Mole and Joaquina/);
  surf.state.lang = "pt";
  assert.match(surf.contrastReason(selectedScored, otherScored), /Mole e Joaquina/);
});

test("nearby contrast prose names the dominant factor", () => {
  const selectedBeach = surf.BEACHES.find((item) => item.id === "joaquina");
  const otherBeach = surf.BEACHES.find((item) => item.id === "campeche");
  const selectedScored = {
    beach: selectedBeach,
    sample: cleanAlignedSample(selectedBeach),
    score: { parts: { swell: 70, wind: 90, coastal: 70, tide: 70, weather: 70 } },
  };
  const otherScored = {
    beach: otherBeach,
    sample: {
      ...cleanAlignedSample(otherBeach),
      windDirection: (otherBeach.offshoreWind + 180) % 360,
    },
    score: { parts: { swell: 70, wind: 20, coastal: 70, tide: 70, weather: 70 } },
  };

  surf.state.lang = "en";
  assert.match(surf.contrastReason(selectedScored, otherScored), /Wind is closer to offshore/);
});

test("rain radar metadata normalizes past and nowcast frames", () => {
  const normalized = surf.normalizeRadarFrames({
    host: " https://tilecache.rainviewer.com/ ",
    radar: {
      past: [
        { time: 30, path: "/v2/radar/past-late" },
        { time: 10, path: "/v2/radar/past-early" },
      ],
      nowcast: [
        { time: " 40 ", path: "v2/radar/future" },
        { time: "bad", path: "/v2/radar/bad" },
        { time: 20 },
        { time: 50, path: " " },
        { time: 60, path: "///" },
      ],
    },
  });

  assert.equal(normalized.host, "https://tilecache.rainviewer.com");
  assert.deepEqual(
    Array.from(normalized.frames, (frame) => frame.time),
    [10, 30, 40],
  );
  assert.deepEqual(
    Array.from(normalized.frames, (frame) => frame.path),
    ["/v2/radar/past-early", "/v2/radar/past-late", "/v2/radar/future"],
  );
});

test("rain radar tile urls use RainViewer frame paths", () => {
  assert.equal(
    surf.buildRadarTileUrl("https://tilecache.rainviewer.com", {
      path: "/v2/radar/sample",
    }),
    "https://tilecache.rainviewer.com/v2/radar/sample/256/{z}/{x}/{y}/2/1_1.png",
  );
  assert.equal(
    surf.buildRadarTileUrl(" https://tilecache.rainviewer.com/ ", {
      path: "v2/radar/sample",
    }),
    "https://tilecache.rainviewer.com/v2/radar/sample/256/{z}/{x}/{y}/2/1_1.png",
  );
  assert.equal(surf.buildRadarTileUrl("", { path: "/v2/radar/sample" }), "");
  assert.equal(surf.buildRadarTileUrl("https://tilecache.rainviewer.com", { path: " " }), "");
});

test("rain radar frame matching follows selected forecast time", () => {
  const frames = [
    { time: 1_000, path: "/v2/radar/a" },
    { time: 1_600, path: "/v2/radar/b" },
    { time: 2_200, path: "/v2/radar/c" },
  ];

  assert.equal(surf.findClosestRadarFrameIndex(frames, 1_650, 10), 1);
  assert.equal(surf.findClosestRadarFrameIndex(frames, 3_000, 10), -1);
  assert.equal(surf.findClosestRadarFrameIndex([], 1_650, 10), -1);
});

test("scoring rewards clean aligned groundswell over short-period windsea", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const cleanSample = {
    temperature: 22,
    precipitationProbability: 10,
    cloudCover: 25,
    windSpeed: 8,
    windDirection: beach.offshoreWind,
    windGusts: 11,
    waveHeight: 1.35,
    waveDirection: beach.swellCenter,
    wavePeriod: 12,
    swellHeight: 1.3,
    swellDirection: beach.swellCenter,
    swellPeriod: 12,
    secondarySwellHeight: 0.35,
    secondarySwellDirection: beach.swellCenter + 8,
    secondarySwellPeriod: 10,
    windWaveHeight: 0.12,
    windWavePeriod: 5,
    seaLevel: beach.idealTide,
    nextSeaLevel: beach.idealTide + 0.04,
    seaTemperature: 20,
  };
  const windseaSample = {
    ...cleanSample,
    wavePeriod: 6,
    swellPeriod: 6,
    secondarySwellPeriod: 6,
    windWaveHeight: 0.9,
    windWavePeriod: 5,
  };

  const clean = surf.scoreSample(beach, cleanSample, 0);
  const windsea = surf.scoreSample(beach, windseaSample, 0);

  assert.ok(clean.score > windsea.score + 15);
  assert.ok(clean.detail.periodFit > windsea.detail.periodFit);
  assert.ok(clean.detail.windseaFrac < windsea.detail.windseaFrac);
});

test("scoring keeps sub-floor swell in the Poor tier", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "ingleses");
  const floor = surf.surfableHeightFloor(beach); // 0.7 m for Ingleses
  const low = surf.scoreSample(beach, cleanAlignedSample(beach, { height: floor - 0.15, period: 16 }), 0);

  assert.ok(low.score < 38, `expected Poor, got ${low.score}`);
  assert.ok(low.detail.sizeReadiness < 0.9);
  assert.ok(low.reasons.some((reason) => reason.includes("piso surf")));
});

test("scoring keeps sub-floor swell below the surfable tier at every beach", () => {
  seedForecasts();

  surf.BEACHES.forEach((beach) => {
    const floor = surf.surfableHeightFloor(beach);
    const low = surf.scoreSample(beach, cleanAlignedSample(beach, { height: floor - 0.1, period: 16 }), 0);
    assert.ok(low.score < 52, `${beach.id} scored ${low.score}`);
  });
});

test("scoring is continuous across the surfable floor (no cliff)", () => {
  seedForecasts();

  surf.BEACHES.forEach((beach) => {
    const floor = surf.surfableHeightFloor(beach);
    const below = surf.scoreSample(beach, cleanAlignedSample(beach, { height: floor - 0.01, period: 14 }), 0);
    const above = surf.scoreSample(beach, cleanAlignedSample(beach, { height: floor + 0.01, period: 14 }), 0);
    assert.ok(
      Math.abs(above.score - below.score) <= 5,
      `${beach.id} jumped ${below.score} -> ${above.score} across the floor`,
    );
  });
});

test("scoring lets a solid clean groundswell reach the Good tier", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const solid = surf.scoreSample(beach, cleanAlignedSample(beach, { height: 1.7, period: 14 }), 0);

  assert.ok(solid.score >= 66, `expected Good+, got ${solid.score}`);
});

test("scoring tracks size with diminishing returns and no top-end saturation", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const score = (height) => surf.scoreSample(beach, cleanAlignedSample(beach, { height, period: 14 }), 0).score;
  const small = score(1.0);
  const mid = score(1.6);
  const big = score(2.8);

  assert.ok(mid > small + 5, `1.6m (${mid}) should clearly beat 1.0m (${small})`);
  assert.ok(big > mid + 5, `2.8m (${big}) should still beat 1.6m (${mid}) — no early saturation`);
});

test("scoring rewards long-period overhead swell and punishes a short-period closeout", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "mocambique");
  const groundswell = surf.scoreSample(beach, cleanAlignedSample(beach, { height: 3.2, period: 16 }), 0);
  const closeout = surf.scoreSample(beach, cleanAlignedSample(beach, { height: 3.2, period: 8 }), 0);

  assert.ok(groundswell.score >= 75, `clean overhead groundswell should be Excellent-ish, got ${groundswell.score}`);
  assert.ok(groundswell.score > closeout.score + 30, `closeout (${closeout.score}) should be far below groundswell (${groundswell.score})`);
});

test("scoring tiny long-period swell still reads Poor", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const tiny = surf.scoreSample(beach, cleanAlignedSample(beach, { height: 0.5, period: 16 }), 0);
  assert.ok(tiny.score < 38, `0.5m@16s should be Poor, got ${tiny.score}`);
});

// Frozen from the live Open-Meteo feed for Matadeiro on the morning German
// surfed it (clean 0.86 m / 6.7 s SE sea, glassy 2 km/h) - the session that the
// old model buried at 3/100 by sizing on the 0.52 m swell sub-partition.
const matadeiroCleanMorning = {
  temperature: 14,
  precipitationProbability: 0,
  cloudCover: 26,
  windSpeed: 1.8,
  windDirection: 79,
  windGusts: 9.4,
  waveHeight: 0.86,
  waveDirection: 138,
  wavePeriod: 6.7,
  swellHeight: 0.52,
  swellDirection: 107,
  swellPeriod: 5.55,
  secondarySwellHeight: 0.32,
  secondarySwellDirection: 88,
  secondarySwellPeriod: 8.8,
  windWaveHeight: 0,
  windWavePeriod: 0,
  seaLevel: 0.16,
  nextSeaLevel: 0.12,
  seaTemperature: 18.2,
  tideState: 0.21,
};

test("scoring sizes on the combined sea, not the smaller swell sub-partition", () => {
  const beach = surf.BEACHES.find((item) => item.id === "matadeiro");
  const scored = surf.scoreSample(beach, matadeiroCleanMorning, 0);

  // breakingHeight must track the 0.86 m combined sea, not the 0.52 m partition.
  const combined = surf.effectiveBreakingHeight(beach, 0.86, 6.7);
  const partitionOnly = surf.effectiveBreakingHeight(beach, 0.52, 5.55);
  assert.ok(
    Math.abs(scored.detail.breakingHeight - combined) < 0.02,
    `breakingHeight ${scored.detail.breakingHeight} should match combined ${combined}`,
  );
  assert.ok(scored.detail.breakingHeight > partitionOnly + 0.1, "combined sea must read bigger than the sub-partition");
});

test("a clean, glassy, rideable small day reads Surfável, not Poor", () => {
  const beach = surf.BEACHES.find((item) => item.id === "matadeiro");
  const scored = surf.scoreSample(beach, matadeiroCleanMorning, 0);

  assert.ok(scored.score >= 52, `clean glassy rideable morning should be Surfável+, got ${scored.score}`);
  assert.ok(scored.detail.cleanFun > 0.1, `clean-fun term should be active, got ${scored.detail.cleanFun}`);
  assert.ok(scored.reasons.some((reason) => reason.includes("glassy")), "should explain the small clean call");
});

test("the clean-fun bonus is gated off when the same swell blows out", () => {
  const beach = surf.BEACHES.find((item) => item.id === "matadeiro");
  const blown = surf.scoreSample(
    beach,
    {
      ...matadeiroCleanMorning,
      windSpeed: 34,
      windGusts: 44,
      windDirection: (beach.offshoreWind + 180) % 360,
      windWaveHeight: 0.9,
      windWavePeriod: 4,
    },
    0,
  );

  assert.ok(blown.detail.cleanFun < 0.05, `windy/choppy day must not earn clean-fun, got ${blown.detail.cleanFun}`);
  assert.ok(blown.score < 40, `blown-out small day should stay Poor/Marginal, got ${blown.score}`);
});

test("the clean-fun bonus cannot lift a sub-floor day off the Poor tier", () => {
  const beach = surf.BEACHES.find((item) => item.id === "matadeiro");
  const floor = surf.surfableHeightFloor(beach);
  // Glassy, clean, in-window, but below the surfable floor: must stay Poor.
  const subFloor = surf.scoreSample(
    beach,
    { ...matadeiroCleanMorning, waveHeight: floor - 0.15, swellHeight: floor - 0.15 },
    0,
  );

  assert.ok(subFloor.detail.cleanFun < 0.05, `sub-floor day must not earn clean-fun, got ${subFloor.detail.cleanFun}`);
  assert.ok(subFloor.score < 38, `sub-floor day should read Poor, got ${subFloor.score}`);
});

test("short-period chop in the swell columns does not earn the clean-fun bonus", () => {
  const beach = surf.BEACHES.find((item) => item.id === "matadeiro");
  // Above the floor, glassy, in-window, windWave≈0 — but a 3 s sea is wind chop,
  // not surf. Open-Meteo reports exactly this in the swell columns on small days.
  const chop = surf.scoreSample(
    beach,
    { ...matadeiroCleanMorning, waveHeight: 0.9, wavePeriod: 3, swellHeight: 0.9, swellPeriod: 3, secondarySwellHeight: 0 },
    0,
  );
  assert.ok(chop.detail.cleanFun < 0.05, `3 s chop must not earn clean-fun, got ${chop.detail.cleanFun}`);
  assert.ok(chop.score < 45, `3 s chop should not reach Surfável, got ${chop.score}`);
});

test("adding clean size never inverts the score on a glassy in-window day", () => {
  ["matadeiro", "joaquina"].forEach((id) => {
    const beach = surf.BEACHES.find((item) => item.id === id);
    const at = (height) =>
      surf.scoreSample(
        beach,
        {
          ...matadeiroCleanMorning,
          waveHeight: height,
          wavePeriod: 8,
          swellHeight: height,
          swellPeriod: 8,
          swellDirection: beach.swellCenter,
          waveDirection: beach.swellCenter,
          secondarySwellHeight: 0,
          windSpeed: 3,
          windDirection: beach.offshoreWind,
        },
        0,
      ).score;
    const heights = [0.7, 0.9, 1.1, 1.3, 1.6, 2.0, 2.5];
    const scores = heights.map(at);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(
        scores[i] >= scores[i - 1] - 3,
        `${id} clean-size inversion: ${heights.join("/")} -> ${scores.join("/")}`,
      );
    }
  });
});

test("wind factor is monotonic and front-loads light offshore over glassy", () => {
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const wf = (speed) =>
    surf.windQualityFactor(
      beach,
      { windSpeed: speed, windDirection: beach.offshoreWind, windGusts: speed },
      0.6,
    );

  const glassy = wf(0.5);
  const light = wf(9);
  assert.ok(light >= glassy, `light offshore (${light}) should be >= glassy (${glassy})`);

  // Non-decreasing across the grooming range; no glassy/4 km/h cliff.
  for (let speed = 1; speed <= 12; speed += 1) {
    assert.ok(
      wf(speed) >= wf(speed - 1) - 1e-9,
      `offshore wind factor dipped at ${speed} km/h`,
    );
  }
});

test("strong wind tapers smoothly instead of cliffing", () => {
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const wf = (speed) =>
    surf.windQualityFactor(
      beach,
      { windSpeed: speed, windDirection: beach.offshoreWind, windGusts: speed },
      0.6,
    );

  for (let speed = 35; speed <= 55; speed += 5) {
    assert.ok(wf(speed) <= wf(speed - 5) + 1e-9, `wind factor rose into strong wind at ${speed}`);
    assert.ok(wf(speed - 5) - wf(speed) <= 0.25, `wind factor cliffed near ${speed} km/h`);
  }
});

test("a perfect swell collapses under strong onshore wind", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const base = cleanAlignedSample(beach, { height: 1.8, period: 14 });
  const clean = surf.scoreSample(beach, base, 0);
  const blown = surf.scoreSample(
    beach,
    { ...base, windSpeed: 32, windGusts: 38, windDirection: (beach.offshoreWind + 180) % 360 },
    0,
  );

  assert.ok(clean.score >= 70);
  assert.ok(blown.score < 45, `blown-out perfect swell should be Poor/Marginal, got ${blown.score}`);
});

test("the same swell differentiates beaches by exposure and angle", () => {
  seedForecasts();

  // A SE/S groundswell that the south/east beaches face and the north bays miss.
  const swell = { height: 1.8, period: 14 };
  const scoreFor = (id) => {
    const beach = surf.BEACHES.find((item) => item.id === id);
    const sample = cleanAlignedSample(beach, swell);
    return surf.scoreSample(
      beach,
      { ...sample, swellDirection: 160, waveDirection: 160, windSpeed: 4, windDirection: beach.offshoreWind },
      0,
    ).score;
  };

  const joaquina = scoreFor("joaquina"); // faces SE — should light up
  const ingleses = scoreFor("ingleses"); // north bay — shadowed from a S swell
  assert.ok(joaquina - ingleses >= 15, `S swell spread too small: Joaquina ${joaquina} vs Ingleses ${ingleses}`);
});

test("direction window uses the full configured spread before flooring", () => {
  const center = 100;
  const spread = 70;
  assert.ok(surf.directionWindowScore(center, center, spread) > 0.95);
  assert.ok(surf.directionWindowScore(center + spread * 0.5, center, spread) > 0.4);
  assert.ok(surf.directionWindowScore(center + spread * 0.9, center, spread) > 0.06);
  assert.ok(surf.directionWindowScore(center + spread + 5, center, spread) <= 0.06 + 1e-9);
});

test("tide state normalizes against the local range, not the MSL datum", () => {
  const marine = {
    // A surge-shifted series: all positive metres, but a clear low->high cycle.
    sea_level_height_msl: [0.8, 0.6, 0.4, 0.45, 0.6, 0.85, 1.1, 1.25, 1.2, 1.0],
  };
  assert.equal(surf.tideStateAt(marine, 2), 0); // local low
  assert.equal(surf.tideStateAt(marine, 7), 1); // local high
  assert.ok(Math.abs(surf.tideStateAt(marine, 4) - 0.235) < 0.05);
  assert.equal(surf.tideStateAt({ sea_level_height_msl: [0.5, 0.5, 0.5] }, 1), 0.5); // flat
  assert.equal(surf.tideStateAt({ sea_level_height_msl: [" ", "0.4", "0.8"] }, 1), 0);
  assert.equal(surf.tideStateAt({ sea_level_height_msl: [" ", "0.4", "0.8"] }, 0), 0.5);
});

test("compass labels localize between English and Portuguese", () => {
  surf.state.lang = "en";
  assert.equal(surf.degToCompass(70), "ENE");
  surf.state.lang = "pt";
  assert.equal(surf.degToCompass(70), "LNE");
  surf.state.lang = "pt";
});

test("forecast timestamp advances exactly one hour per forecast hour", () => {
  const a = surf.selectedForecastTimestampSeconds(0, 9);
  const b = surf.selectedForecastTimestampSeconds(0, 10);
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.equal(b - a, 3600);
  // A day step advances 24 hours.
  assert.equal(surf.selectedForecastTimestampSeconds(1, 9) - a, 86400);
});

test("forecast timestamp encodes Sao Paulo local time as UTC", () => {
  const date = surf.dateKey(0);
  const instant = new Date(surf.selectedForecastTimestampSeconds(0, 9) * 1000);

  assert.equal(instant.toISOString(), `${date}T12:00:00.000Z`);
});

test("scoring penalizes onshore wind for the same swell", () => {
  seedForecasts();

  const beach = surf.BEACHES.find((item) => item.id === "praia-mole");
  const baseSample = {
    temperature: 22,
    precipitationProbability: 10,
    cloudCover: 20,
    windSpeed: 20,
    windDirection: beach.offshoreWind,
    windGusts: 23,
    waveHeight: 1.4,
    waveDirection: beach.swellCenter,
    wavePeriod: 12,
    swellHeight: 1.35,
    swellDirection: beach.swellCenter,
    swellPeriod: 12,
    secondarySwellHeight: 0.35,
    secondarySwellDirection: beach.swellCenter + 10,
    secondarySwellPeriod: 10,
    windWaveHeight: 0.15,
    windWavePeriod: 5,
    seaLevel: beach.idealTide,
    nextSeaLevel: beach.idealTide + 0.03,
    seaTemperature: 20,
  };
  const offshore = surf.scoreSample(beach, baseSample, 0);
  const onshore = surf.scoreSample(
    beach,
    {
      ...baseSample,
      windDirection: (beach.offshoreWind + 180) % 360,
      windGusts: 29,
    },
    0,
  );

  assert.ok(offshore.score > onshore.score + 10);
  assert.ok(offshore.parts.wind > onshore.parts.wind);
});

test("fetchJson retries transient failures before returning data", async () => {
  let attempts = 0;

  await withMockedBrowserIO(
    {
      fetch: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("temporary network failure");
        }
        return {
          ok: true,
          async json() {
            return { attempts };
          },
        };
      },
      setTimeout: (callback) => {
        callback();
        return 0;
      },
    },
    async () => {
      assert.deepEqual(await surf.fetchJson(new URL("https://example.test/forecast")), {
        attempts: 3,
      });
      assert.equal(attempts, 3);
    },
  );
});

test("fetchJson retries retryable HTTP failures before returning data", async () => {
  let attempts = 0;
  let delays = 0;

  await withMockedBrowserIO(
    {
      fetch: async () => {
        attempts += 1;
        if (attempts < 2) {
          return {
            ok: false,
            status: 500,
          };
        }
        return {
          ok: true,
          async json() {
            return { attempts };
          },
        };
      },
      setTimeout: (callback) => {
        delays += 1;
        callback();
        return 0;
      },
    },
    async () => {
      assert.deepEqual(await surf.fetchJson(new URL("https://example.test/forecast")), {
        attempts: 2,
      });
      assert.equal(attempts, 2);
      assert.equal(delays, 1);
    },
  );
});

test("fetchJson does not retry permanent HTTP failures", async () => {
  let attempts = 0;
  let delays = 0;

  await withMockedBrowserIO(
    {
      fetch: async () => {
        attempts += 1;
        return {
          ok: false,
          status: 400,
        };
      },
      setTimeout: (callback) => {
        delays += 1;
        callback();
        return 0;
      },
    },
    async () => {
      await assert.rejects(
        surf.fetchJson(new URL("https://example.test/forecast")),
        /HTTP 400/,
      );
      assert.equal(attempts, 1);
      assert.equal(delays, 0);
    },
  );
});

test("fetchJson exhausts retryable failures with fixed backoff delays", async () => {
  let attempts = 0;
  const delays = [];

  await withMockedBrowserIO(
    {
      fetch: async () => {
        attempts += 1;
        return {
          ok: false,
          status: 503,
        };
      },
      setTimeout: (callback, milliseconds) => {
        delays.push(milliseconds);
        callback();
        return 0;
      },
    },
    async () => {
      await assert.rejects(
        surf.fetchJson(new URL("https://example.test/forecast")),
        /HTTP 503/,
      );
      assert.equal(attempts, 3);
      assert.deepEqual(delays, [300, 800]);
    },
  );
});

test("beach forecast requests pin the Open-Meteo query contract", async () => {
  const requestedUrls = [];
  const time = [`${surf.dateKey(0)}T06:00`, `${surf.dateKey(0)}T07:00`];

  await withMockedBrowserIO(
    {
      fetch: async (url) => {
        const parsed = new URL(String(url));
        requestedUrls.push(parsed);
        return {
          ok: true,
          async json() {
            if (parsed.hostname === "marine-api.open-meteo.com") {
              return { hourly: { time, wave_height: [1.1, 1.2] } };
            }
            return { hourly: { time, temperature_2m: [21, 22] } };
          },
        };
      },
    },
    async () => {
      const beach = surf.BEACHES[0];
      const forecast = await surf.fetchBeachForecast(beach);
      const weatherUrl = requestedUrls.find((url) => url.hostname === "api.open-meteo.com");
      const marineUrl = requestedUrls.find((url) => url.hostname === "marine-api.open-meteo.com");

      assert.equal(forecast.beachId, beach.id);
      assert.equal(requestedUrls.length, 2);
      assert.ok(weatherUrl);
      assert.ok(marineUrl);
      assert.equal(weatherUrl.pathname, "/v1/forecast");
      assert.equal(weatherUrl.searchParams.get("latitude"), String(beach.lat));
      assert.equal(weatherUrl.searchParams.get("longitude"), String(beach.lon));
      assert.equal(
        weatherUrl.searchParams.get("hourly"),
        "temperature_2m,apparent_temperature,precipitation_probability,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      );
      assert.equal(weatherUrl.searchParams.get("timezone"), "America/Sao_Paulo");
      assert.equal(weatherUrl.searchParams.get("forecast_days"), "4");
      assert.equal(weatherUrl.searchParams.get("wind_speed_unit"), "kmh");

      assert.equal(marineUrl.pathname, "/v1/marine");
      assert.equal(marineUrl.searchParams.get("latitude"), String(beach.lat));
      assert.equal(marineUrl.searchParams.get("longitude"), String(beach.lon));
      assert.equal(
        marineUrl.searchParams.get("hourly"),
        "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_level_height_msl,sea_surface_temperature",
      );
      assert.equal(marineUrl.searchParams.get("timezone"), "America/Sao_Paulo");
      assert.equal(marineUrl.searchParams.get("forecast_days"), "4");
      assert.equal(marineUrl.searchParams.get("cell_selection"), "sea");
    },
  );
});

test("beach forecasts reject successful responses without hourly time arrays", async () => {
  await withMockedBrowserIO(
    {
      fetch: async (url) => ({
        ok: true,
        async json() {
          if (String(url).includes("marine-api")) {
            return { hourly: { time: ["2026-06-17T06:00"] } };
          }
          return { hourly: {} };
        },
      }),
    },
    async () => {
      await assert.rejects(
        surf.fetchBeachForecast(surf.BEACHES[0]),
        /Weather forecast missing hourly time series/,
      );
    },
  );
});

test("beach forecasts normalize missing optional hourly fields", async () => {
  const time = ["2026-06-17T06:00", "2026-06-17T07:00"];

  await withMockedBrowserIO(
    {
      fetch: async (url) => ({
        ok: true,
        async json() {
          if (String(url).includes("marine-api")) {
            return { hourly: { time, wave_height: [1.1, 1.2] } };
          }
          return { hourly: { time, temperature_2m: [21, 22] } };
        },
      }),
    },
    async () => {
      const forecast = await surf.fetchBeachForecast(surf.BEACHES[0]);

      assert.deepEqual(forecast.weather.temperature_2m, [21, 22]);
      assert.deepEqual(Array.from(forecast.weather.wind_speed_10m), [null, null]);
      assert.deepEqual(forecast.marine.wave_height, [1.1, 1.2]);
      assert.deepEqual(Array.from(forecast.marine.sea_surface_temperature), [null, null]);
    },
  );
});

test("scored samples degrade short API arrays to missing cells", async () => {
  const beach = surf.selectedBeach();
  const time = [`${surf.dateKey(0)}T06:00`, `${surf.dateKey(0)}T07:00`];

  await withMockedBrowserIO(
    {
      fetch: async (url) => ({
        ok: true,
        async json() {
          if (String(url).includes("marine-api")) {
            return {
              hourly: {
                time,
                wave_height: [1.1],
                wave_direction: [beach.swellCenter],
                wave_period: [12],
              },
            };
          }
          return {
            hourly: {
              time,
              temperature_2m: [21],
              wind_direction_10m: [beach.offshoreWind],
            },
          };
        },
      }),
    },
    async () => {
      const forecast = await surf.fetchBeachForecast(beach);

      surf.state.forecasts.clear();
      surf.scoredSampleCache.clear();
      surf.state.forecasts.set(beach.id, forecast);
      const scored = surf.getScoredSample(beach, 0, 7);

      assert.ok(scored);
      assert.equal(scored.sample.temperature, null);
      assert.equal(scored.sample.windDirection, null);
      assert.equal(scored.sample.waveHeight, null);
      assert.equal(scored.sample.wavePeriod, null);
    },
  );
});

// ---------------------------------------------------------------------------
// Release-hardening coverage: wind-direction monotonicity, gust gating, the
// closeout floor, period/cleanliness refinements, exposure-class direction cap,
// missing-weather neutrality, cache date keying, and the helper unit tests the
// pre-release review flagged as load-bearing-but-untested.
// ---------------------------------------------------------------------------

function windFactorAt(beach, off, speed, sizeMag = 0.6) {
  return surf.windQualityFactor(
    beach,
    { windSpeed: speed, windDirection: (beach.offshoreWind + off) % 360, windGusts: speed },
    sizeMag,
  );
}

test("wind factor never improves as the wind rotates offshore -> onshore (no cross-shore jump)", () => {
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  // Speeds kept <=30 so the intentional strong-offshore over-hold dip (>32 km/h)
  // does not register as a (benign) offshore-side non-monotonicity.
  for (const speed of [8, 14, 20, 26, 30]) {
    for (let off = 1; off <= 180; off += 1) {
      const here = windFactorAt(beach, off, speed);
      const prev = windFactorAt(beach, off - 1, speed);
      assert.ok(here <= prev + 1e-9, `wind factor rose at ${off}deg / ${speed} km/h (${prev} -> ${here})`);
    }
  }
  // The old branch split jumped ~+0.1 across the 90deg cross-shore seam.
  assert.ok(windFactorAt(beach, 91, 20) <= windFactorAt(beach, 89, 20) + 1e-9, "no jump across cross-shore");
  // Dead onshore is the worst wind, not better than an oblique onshore.
  assert.ok(windFactorAt(beach, 180, 20) <= windFactorAt(beach, 170, 20) + 1e-9, "dead onshore is worst");
});

test("wind factor: cross-shore is worse than offshore and bigger swell shrugs onshore wind", () => {
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  assert.ok(windFactorAt(beach, 90, 18) < windFactorAt(beach, 0, 18), "cross-shore below offshore");
  // Size shield: a bigger swell holds more of its quality under the same onshore wind.
  assert.ok(
    windFactorAt(beach, 180, 22, 0.9) > windFactorAt(beach, 180, 22, 0.2),
    "bigger swell resists onshore wind",
  );
});

test("a glassy morning is not demoted by a spurious gust spike, but real wind still is", () => {
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const calm = surf.windQualityFactor(beach, { windSpeed: 3, windDirection: beach.offshoreWind, windGusts: 4 }, 0.5);
  const gusty = surf.windQualityFactor(beach, { windSpeed: 3, windDirection: beach.offshoreWind, windGusts: 30 }, 0.5);
  assert.ok(gusty >= calm - 0.05, `glassy 3 km/h morning should survive a gust spike (${calm} vs ${gusty})`);

  const windyCalm = surf.windQualityFactor(beach, { windSpeed: 20, windDirection: beach.offshoreWind, windGusts: 22 }, 0.5);
  const windyGusty = surf.windQualityFactor(beach, { windSpeed: 20, windDirection: beach.offshoreWind, windGusts: 44 }, 0.5);
  assert.ok(windyGusty < windyCalm, "a real wind with a big gust spread is still penalized");
});

test("a far-oversized short-period swell collapses to the closeout floor", () => {
  seedForecasts();
  const beach = surf.BEACHES.find((item) => item.id === "mocambique"); // maxHeight 3.2
  const huge = surf.scoreSample(beach, cleanAlignedSample(beach, { height: 5.5, period: 8 }), 0);
  assert.ok(huge.detail.oversize <= 0.2, `oversize should hit the floor, got ${huge.detail.oversize}`);
  assert.ok(huge.score < 38, `far-oversized closeout should read Poor, got ${huge.score}`);

  // Period-aware onset: a long-period swell of the same height holds longer.
  const long = surf.scoreSample(beach, cleanAlignedSample(beach, { height: 3.4, period: 16 }), 0);
  const short = surf.scoreSample(beach, cleanAlignedSample(beach, { height: 3.4, period: 8 }), 0);
  assert.ok(long.detail.oversize > short.detail.oversize, "long groundswell closes out later than short");
});

test("period quality reads the longer of the combined and swell-partition period", () => {
  seedForecasts();
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const base = cleanAlignedSample(beach, { height: 1.3, period: 7 }); // combined 7 s
  const hidden = { ...base, swellPeriod: 13 }; // a 13 s groundswell hidden under the blended sea
  const blended = surf.scoreSample(beach, base, 0);
  const groundswell = surf.scoreSample(beach, hidden, 0);
  assert.ok(
    groundswell.detail.periodFit > blended.detail.periodFit,
    "a long swell-partition period must not be graded as short-period chop",
  );
});

test("windsea aligned with the swell window contaminates less than opposed windsea", () => {
  seedForecasts();
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const base = { ...cleanAlignedSample(beach, { height: 1.4, period: 12 }), windWaveHeight: 0.8, windWavePeriod: 6 };
  const aligned = surf.scoreSample(beach, { ...base, windWaveDirection: beach.swellCenter }, 0);
  const opposed = surf.scoreSample(beach, { ...base, windWaveDirection: (beach.swellCenter + 180) % 360 }, 0);
  assert.ok(aligned.detail.cleanliness > opposed.detail.cleanliness, "aligned windsea reads cleaner");
  assert.ok(aligned.score >= opposed.score, "aligned windsea never scores worse than opposed");
});

test("missing weather reads as neutral, not a flawless clear sky", () => {
  seedForecasts();
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const sample = cleanAlignedSample(beach, { height: 1.2, period: 12 });
  const missing = surf.scoreSample(beach, { ...sample, precipitationProbability: null, cloudCover: null }, 0);
  assert.ok(missing.parts.weather < 100, `missing weather should not be perfect, got ${missing.parts.weather}`);
  assert.ok(missing.parts.weather >= 60, `missing weather should be neutral-ish, got ${missing.parts.weather}`);
});

test("a sheltered bay caps swell power harder than an open beach on an off-window swell", () => {
  seedForecasts();
  const retainedOffWindow = (id) => {
    const beach = surf.BEACHES.find((item) => item.id === id);
    const inWindow = cleanAlignedSample(beach, { height: 1.6, period: 12 });
    const off = (beach.swellCenter + 180) % 360;
    const offWindow = { ...inWindow, swellDirection: off, waveDirection: off };
    const inPower = surf.scoreSample(beach, inWindow, 0).parts.swell;
    const offPower = surf.scoreSample(beach, offWindow, 0).parts.swell;
    return offPower / inPower; // fraction of power kept on a bad angle
  };
  assert.ok(
    retainedOffWindow("armacao") < retainedOffWindow("mocambique"),
    "the filtered bay (Armacao) should keep less off-window power than the open magnet (Mocambique)",
  );
});

test("scored-sample cache keys on the absolute date so it cannot go stale across midnight", () => {
  seedForecasts();
  surf.scoredSampleCache.clear();
  const beach = surf.selectedBeach();
  surf.getScoredSample(beach, 0, 8);
  const today = surf.dateKey(0);
  const keys = Array.from(surf.scoredSampleCache.keys());
  assert.ok(keys.some((key) => key.includes(today)), `cache key should encode the resolved date ${today}, got ${keys[0]}`);
});

test("scored-sample cache keys on language as well as date", () => {
  seedForecasts();
  surf.scoredSampleCache.clear();
  const beach = surf.selectedBeach();

  surf.state.lang = "pt";
  const pt = surf.getScoredSample(beach, 0, 8);
  const ptRead = surf.compactSessionRead(pt);

  surf.state.lang = "en";
  const en = surf.getScoredSample(beach, 0, 8);
  const enRead = surf.compactSessionRead(en);

  const keys = Array.from(surf.scoredSampleCache.keys());
  assert.equal(keys.length, 2);
  assert.ok(keys.some((key) => key.startsWith(`pt:${beach.id}:`)));
  assert.ok(keys.some((key) => key.startsWith(`en:${beach.id}:`)));
  assert.notEqual(pt.score.label, en.score.label);
  assert.notEqual(ptRead, enRead);
});

test("score labels and pin classes hold every tier boundary", () => {
  const rows = [
    [37, "Ruim", "Poor", "pin-bad"],
    [38, "Fraco", "Marginal", "pin-poor"],
    [51, "Fraco", "Marginal", "pin-poor"],
    [52, "Surfável", "Workable", "pin-fair"],
    [65, "Surfável", "Workable", "pin-fair"],
    [66, "Bom", "Good", "pin-good"],
    [79, "Bom", "Good", "pin-good"],
    [80, "Excelente", "Excellent", "pin-excellent"],
  ];

  for (const [score, ptLabel, enLabel, pin] of rows) {
    surf.state.lang = "pt";
    assert.equal(surf.scoreLabel(score), ptLabel, `pt label for ${score}`);
    surf.state.lang = "en";
    assert.equal(surf.scoreLabel(score), enLabel, `en label for ${score}`);
    assert.equal(surf.pinClass(score), pin, `pin for ${score}`);
  }
  assert.equal(surf.pinClass(Number.NaN), "pin-empty");
  surf.state.lang = "pt";
});

test("tideScore peaks at the ideal state, floors at the spread edge, and is neutral when missing", () => {
  assert.ok(surf.tideScore(0.5, 0.5, 0.5) > 0.95);
  assert.ok(surf.tideScore(0.5, 0.5, 0.5) > surf.tideScore(0.8, 0.5, 0.5));
  assert.ok(Math.abs(surf.tideScore(1.0, 0.5, 0.5) - 0.3) < 1e-9, "diff >= spread floors at 0.3");
  assert.equal(surf.tideScore(NaN, 0.5, 0.5), 0.6, "missing tide -> neutral 0.6");
});

test("coastalFitScore stays inside its 0..100 band for known and unknown spots", () => {
  const known = surf.BEACHES.find((item) => item.id === "mocambique");
  const value = surf.coastalFitScore(known, 0.5);
  assert.ok(value >= 12 && value <= 100, `coastalFitScore out of band: ${value}`);
  const unknown = surf.coastalFitScore({ id: "nope", exposure: "Open" }, 0.5);
  assert.ok(unknown >= 12 && unknown <= 100, `unknown-spot coastalFitScore out of band: ${unknown}`);
});

test("surfable readiness rises monotonically from the floor to fully surfable", () => {
  const beach = surf.BEACHES.find((item) => item.id === "joaquina");
  const floor = surf.surfableHeightFloor(beach);
  let prev = -Infinity;
  for (let h = floor; h <= floor + 0.8 + 1e-9; h += 0.05) {
    const readiness = surf.surfableHeightFactor(h, beach);
    assert.ok(readiness >= prev - 1e-9, `readiness dipped at ${h.toFixed(2)} m`);
    prev = readiness;
  }
  assert.ok(surf.surfableHeightFactor(floor + 1.0, beach) >= 0.999, "reaches 1.0 comfortably above the floor");
});

test("day overview describes a flat day without crashing in both languages", () => {
  seedForecasts();
  surf.BEACHES.forEach((beach) => {
    const forecast = surf.state.forecasts.get(beach.id);
    forecast.marine.wave_height = forecast.marine.wave_height.map(() => 0.2);
    forecast.marine.swell_wave_height = forecast.marine.swell_wave_height.map(() => 0.15);
  });
  surf.scoredSampleCache.clear();

  for (const lang of ["pt", "en"]) {
    surf.state.lang = lang;
    const day = surf.describeDay(0);
    assert.ok(day && typeof day.text === "string");
    assert.ok(!day.text.includes("undefined"));
    assert.ok(day.peakScore < 45, `flat day should peak low, got ${day.peakScore}`);
  }
  surf.state.lang = "pt";
});

test("day prose helper keys track size, cleanliness, windows, and trends", () => {
  const entry = (hour, score, height, wind) => ({
    hour,
    scored: {
      sample: { waveHeight: height, swellHeight: height, wavePeriod: 12, swellPeriod: 12 },
      score: { score, parts: { wind } },
    },
  });
  const conditionKeys = (result) => ({
    sizeKey: result.sizeKey,
    cleanKey: result.cleanKey,
  });
  const timingKeys = (result) => ({
    windowHours: Array.from(result.windowHours),
    windowKey: result.windowKey,
    allDay: result.allDay,
    trend: result.trend,
  });
  const conditionScan = [
    entry(8, 72, 1.2, 82),
    entry(8, 68, 1.4, 74),
    entry(14, 52, 0.8, 42),
  ];

  assert.deepEqual(
    conditionKeys(surf.summarizeConditions(conditionScan, { hour: 8 }, 72)),
    { sizeKey: "fun", cleanKey: "clean" },
  );
  assert.equal(
    surf.summarizeConditions(conditionScan, { hour: 8 }, 20).sizeKey,
    "flat",
  );

  const fading = [
    { hour: 6, score: 70 },
    { hour: 7, score: 68 },
    { hour: 8, score: 66 },
    { hour: 14, score: 45 },
    { hour: 15, score: 44 },
    { hour: 16, score: 43 },
  ];
  assert.deepEqual(
    timingKeys(surf.summarizeTiming(fading, { hour: 7 }, 70)),
    { windowHours: [6, 7, 8], windowKey: "early", allDay: false, trend: "fadesPM" },
  );

  const allDay = surf.HOURS.map((hour) => ({ hour, score: 61 }));
  assert.deepEqual(
    timingKeys(surf.summarizeTiming(allDay, { hour: 12 }, 61)),
    { windowHours: Array.from(surf.HOURS), windowKey: "midday", allDay: true, trend: "steady" },
  );

  const building = [
    { hour: 6, score: 40 },
    { hour: 7, score: 42 },
    { hour: 8, score: 44 },
    { hour: 14, score: 64 },
    { hour: 15, score: 66 },
    { hour: 16, score: 68 },
  ];
  assert.equal(surf.summarizeTiming(building, { hour: 16 }, 68).trend, "buildsPM");
});

test("a clean-fun rescued day's one-liner credits the clean call, not swell as the problem", () => {
  const beach = surf.BEACHES.find((item) => item.id === "matadeiro");
  const scored = { beach, sample: matadeiroCleanMorning, score: surf.scoreSample(beach, matadeiroCleanMorning, 0) };
  surf.state.lang = "en";
  const read = surf.compactSessionRead(scored);
  surf.state.lang = "pt";
  assert.ok(/clean and glassy/.test(read), `expected the clean-fun read, got "${read}"`);
  assert.ok(!/swell/i.test(read.slice(read.indexOf(":") + 1)), "must not blame swell on a rescued day");
});

test("confidence chip blends forecast horizon with per-spot data confidence", () => {
  seedForecasts();
  const beach = surf.selectedBeach();
  surf.state.lang = "en";
  const today = surf.confidenceMeta({ score: surf.scoreSample(beach, cleanAlignedSample(beach, { height: 1.3, period: 12 }), 0) });
  const far = surf.confidenceMeta({ score: surf.scoreSample(beach, cleanAlignedSample(beach, { height: 1.3, period: 12 }), 3) });
  surf.state.lang = "pt";
  const tierRank = { high: 3, mid: 2, low: 1 };
  assert.ok(tierRank[today.tier] >= tierRank[far.tier], "a nearer forecast is at least as confident as a far one");
  assert.ok(/confidence/i.test(today.text), "chip carries a human-readable label");
});

test("compass labels wrap around negative and out-of-range degrees", () => {
  surf.state.lang = "en";
  for (const deg of [-10, 350, 360, 720, 725]) {
    assert.equal(surf.degToCompass(deg), "N", `${deg} should normalize to N`);
  }
  assert.equal(surf.degToCompass(45), "NE");
  surf.state.lang = "pt";
});

test("radar frame matching is inclusive exactly at the tolerance boundary", () => {
  const frames = [{ time: 1_000, path: "/v2/radar/a" }];
  assert.equal(surf.findClosestRadarFrameIndex(frames, 1_000 + 600, 10), 0, "exactly 10 min still matches");
  assert.equal(surf.findClosestRadarFrameIndex(frames, 1_000 + 601, 10), -1, "one second past does not");
});

test("numericCell rejects non-finite values and coerces clean numeric strings", () => {
  assert.equal(surf.numericCell(null), null);
  assert.equal(surf.numericCell(undefined), null);
  assert.equal(surf.numericCell(""), null);
  assert.equal(surf.numericCell("   "), null);
  assert.equal(surf.numericCell("1.5"), 1.5);
  assert.equal(surf.numericCell(" 9 "), 9);
  assert.equal(surf.numericCell(Number.NaN), null);
  assert.equal(surf.numericCell(Number.POSITIVE_INFINITY), null);
});
