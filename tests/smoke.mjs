import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
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
  `${appSource}
globalThis.__surfCheckTest = {
  BEACHES,
  HOURS,
  state,
  dateKey,
  describeDay,
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
  sizeMagnitude,
  effectiveBreakingHeight,
  directionWindowScore,
  tideStateAt,
  selectedForecastTimestampSeconds,
  degToCompass,
  scoredSampleCache,
};`,
  context,
  { filename: "app.js" },
);

const surf = context.__surfCheckTest;

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
  assert.equal(nearby.length, 3);
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
      ],
    },
  });

  assert.equal(normalized.host, "https://tilecache.rainviewer.com");
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
  const originalFetch = context.fetch;
  const originalSetTimeout = context.window.setTimeout;

  context.fetch = async () => {
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
  };
  context.window.setTimeout = (callback) => {
    callback();
    return 0;
  };

  try {
    assert.deepEqual(await surf.fetchJson(new URL("https://example.test/forecast")), {
      attempts: 3,
    });
    assert.equal(attempts, 3);
  } finally {
    context.fetch = originalFetch;
    context.window.setTimeout = originalSetTimeout;
  }
});

test("beach forecasts reject successful responses without hourly time arrays", async () => {
  const originalFetch = context.fetch;

  context.fetch = async (url) => ({
    ok: true,
    async json() {
      if (String(url).includes("marine-api")) {
        return { hourly: { time: ["2026-06-17T06:00"] } };
      }
      return { hourly: {} };
    },
  });

  try {
    await assert.rejects(
      surf.fetchBeachForecast(surf.BEACHES[0]),
      /Weather forecast missing hourly time series/,
    );
  } finally {
    context.fetch = originalFetch;
  }
});

test("beach forecasts normalize missing optional hourly fields", async () => {
  const originalFetch = context.fetch;
  const time = ["2026-06-17T06:00", "2026-06-17T07:00"];

  context.fetch = async (url) => ({
    ok: true,
    async json() {
      if (String(url).includes("marine-api")) {
        return { hourly: { time, wave_height: [1.1, 1.2] } };
      }
      return { hourly: { time, temperature_2m: [21, 22] } };
    },
  });

  try {
    const forecast = await surf.fetchBeachForecast(surf.BEACHES[0]);

    assert.deepEqual(forecast.weather.temperature_2m, [21, 22]);
    assert.deepEqual(Array.from(forecast.weather.wind_speed_10m), [null, null]);
    assert.deepEqual(forecast.marine.wave_height, [1.1, 1.2]);
    assert.deepEqual(Array.from(forecast.marine.sea_surface_temperature), [null, null]);
  } finally {
    context.fetch = originalFetch;
  }
});
