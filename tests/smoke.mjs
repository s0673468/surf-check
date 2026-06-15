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
};`,
  context,
  { filename: "app.js" },
);

const surf = context.__surfCheckTest;

function seedForecasts() {
  const date = surf.dateKey(0);
  const times = surf.HOURS.map((hour) => `${date}T${String(hour).padStart(2, "0")}:00`);

  surf.state.forecasts.clear();
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
    host: "https://tilecache.rainviewer.com",
    radar: {
      past: [
        { time: 30, path: "/v2/radar/past-late" },
        { time: 10, path: "/v2/radar/past-early" },
      ],
      nowcast: [
        { time: 40, path: "/v2/radar/future" },
        { time: "bad", path: "/v2/radar/bad" },
        { time: 20 },
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
  assert.equal(surf.buildRadarTileUrl("", { path: "/v2/radar/sample" }), "");
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
