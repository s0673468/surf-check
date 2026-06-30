import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const runtimeScriptFiles = Array.from(
  indexHtml.matchAll(/<script\b[^>]*\bsrc="\.\/([^"]+\.js)"[^>]*><\/script>/g),
  (match) => match[1],
);
const runtimeSourceByFile = new Map(
  runtimeScriptFiles.map((file) => [
    file,
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  ]),
);

function loadRuntime(mutation = null) {
  const sources = runtimeScriptFiles.map((file) => {
    const source = runtimeSourceByFile.get(file);
    if (mutation?.file !== file) return source;
    const count = source.split(mutation.from).length - 1;
    assert.equal(count, 1, `mutation target must match exactly once in ${file}`);
    return source.replace(mutation.from, mutation.to);
  });
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
    `${sources.join("\n")}
globalThis.__surfMutationTest = {
  BEACHES,
  HOURS,
  state,
  dateKey,
  getForecastView,
  getScoredSample,
  scoreSample,
  selectedBeach,
  windQualityFactor,
  findClosestRadarFrameIndex,
  numericCell,
  angularDiff,
  contrastReason,
  scoredSampleCache,
};`,
    context,
    { filename: mutation?.file ?? "runtime" },
  );
  return context.__surfMutationTest;
}

function seedForecasts(surf) {
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
    windWaveDirection: beach.swellCenter,
    windWavePeriod: 4,
    seaLevel: 0,
    nextSeaLevel: 0.02,
    tideState: beach.idealTide,
    seaTemperature: 20,
  };
}

const invariants = {
  rankedBeachesStayDescending(surf) {
    seedForecasts(surf);
    const view = surf.getForecastView(0, 8);
    assert.ok(
      view.rankedBeaches.every(
        (entry, index, entries) =>
          index === 0 || entries[index - 1].scored.score.score >= entry.scored.score.score,
      ),
    );
  },

  missingSelectedForecastStaysNull(surf) {
    seedForecasts(surf);
    surf.state.forecasts.delete("ingleses");
    surf.scoredSampleCache.clear();
    assert.equal(surf.getForecastView(0, 8).selectedScored, null);
  },

  scoredCacheKeysOnLanguage(surf) {
    seedForecasts(surf);
    const beach = surf.selectedBeach();
    surf.state.lang = "pt";
    const ptLabel = surf.getScoredSample(beach, 0, 8).score.label;
    surf.state.lang = "en";
    const enLabel = surf.getScoredSample(beach, 0, 8).score.label;
    assert.notEqual(ptLabel, enLabel);
  },

  numericCellsRejectWhitespace(surf) {
    assert.equal(surf.numericCell("   "), null);
    assert.equal(surf.numericCell(" 9 "), 9);
  },

  angularDiffWrapsCompass(surf) {
    assert.equal(surf.angularDiff(350, 10), 20);
    assert.equal(surf.angularDiff(10, 350), 20);
  },

  gustSpreadPenalizesRealWind(surf) {
    const beach = surf.BEACHES.find((item) => item.id === "joaquina");
    const steady = surf.windQualityFactor(
      beach,
      { windSpeed: 20, windDirection: beach.offshoreWind, windGusts: 22 },
      0.5,
    );
    const gusty = surf.windQualityFactor(
      beach,
      { windSpeed: 20, windDirection: beach.offshoreWind, windGusts: 44 },
      0.5,
    );
    assert.ok(gusty < steady);
  },

  missingWeatherIsNeutralNotPerfect(surf) {
    const beach = surf.BEACHES.find((item) => item.id === "joaquina");
    const sample = cleanAlignedSample(beach, { height: 1.2, period: 12 });
    const score = surf.scoreSample(
      beach,
      { ...sample, precipitationProbability: null, cloudCover: null },
      0,
    );
    assert.ok(score.parts.weather < 100);
    assert.ok(score.parts.weather >= 60);
  },

  radarToleranceIsInclusive(surf) {
    const frames = [{ time: 1_000, path: "/v2/radar/a" }];
    assert.equal(surf.findClosestRadarFrameIndex(frames, 1_600, 10), 0);
  },

  contrastDominantFactorBeatsFallback(surf) {
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
  },
};

const mutationCases = [
  {
    name: "rank comparator direction",
    mutation: {
      file: "forecast-selectors.js",
      from: "  return b.scored.score.score - a.scored.score.score;\n",
      to: "  return a.scored.score.score - b.scored.score.score;\n",
    },
    invariant: invariants.rankedBeachesStayDescending,
  },
  {
    name: "missing selected forecast fallback",
    mutation: {
      file: "forecast-selectors.js",
      from: "    selectedScored: scoredByBeachId.get(beach.id) ?? null,\n",
      to: "    selectedScored: scoredByBeachId.get(beach.id) ?? scoredBeaches[0]?.scored ?? null,\n",
    },
    invariant: invariants.missingSelectedForecastStaysNull,
  },
  {
    name: "scored cache language key",
    mutation: {
      file: "forecast-selectors.js",
      from: "  const key = `${state.lang}:${beach.id}:${dateKey(dayOffset)}:${hour}`;\n",
      to: "  const key = `${beach.id}:${dateKey(dayOffset)}:${hour}`;\n",
    },
    invariant: invariants.scoredCacheKeysOnLanguage,
  },
  {
    name: "numeric cell string trim",
    mutation: {
      file: "runtime-utils.js",
      from: "  const normalized = typeof value === \"string\" ? value.trim() : value;\n",
      to: "  const normalized = value;\n",
    },
    invariant: invariants.numericCellsRejectWhitespace,
  },
  {
    name: "angular diff compass wrap",
    mutation: {
      file: "runtime-utils.js",
      from: "  const diff = Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);\n  return diff;\n",
      to: "  return Math.abs(a - b);\n",
    },
    invariant: invariants.angularDiffWrapsCompass,
  },
  {
    name: "gust spread penalty sign",
    mutation: {
      file: "score-model.js",
      from: "  factor *= 1 - smoothstep(speed, 3, 10) * clamp(Math.max(0, gustSpread - 8) / 40, 0, 0.6);\n",
      to: "  factor *= 1 + smoothstep(speed, 3, 10) * clamp(Math.max(0, gustSpread - 8) / 40, 0, 0.6);\n",
    },
    invariant: invariants.gustSpreadPenalizesRealWind,
  },
  {
    name: "missing weather neutral score",
    mutation: {
      file: "score-model.js",
      from: "    rainKnown || cloudKnown ? clamp(1 - rain / 170 - cloud / 500, 0.18, 1) : 0.7;\n",
      to: "    rainKnown || cloudKnown ? clamp(1 - rain / 170 - cloud / 500, 0.18, 1) : 1;\n",
    },
    invariant: invariants.missingWeatherIsNeutralNotPerfect,
  },
  {
    name: "radar tolerance boundary",
    mutation: {
      file: "rain-radar.js",
      from: "  return bestDiff <= toleranceMinutes * 60 ? bestIndex : -1;\n",
      to: "  return bestDiff < toleranceMinutes * 60 ? bestIndex : -1;\n",
    },
    invariant: invariants.radarToleranceIsInclusive,
  },
  {
    name: "contrast dominant-factor threshold",
    mutation: {
      file: "forecast-prose.js",
      from: "  if (!factor || factor.impact < 1.5) {\n",
      to: "  if (!factor || factor.impact < 150) {\n",
    },
    invariant: invariants.contrastDominantFactorBeatsFallback,
  },
];

for (const mutationCase of mutationCases) {
  test(`baseline invariant holds before mutation: ${mutationCase.name}`, () => {
    mutationCase.invariant(loadRuntime());
  });

  test(`mutation killed: ${mutationCase.name}`, () => {
    const mutant = loadRuntime(mutationCase.mutation);
    assert.throws(
      () => mutationCase.invariant(mutant),
      assert.AssertionError,
      `${mutationCase.name} mutant survived`,
    );
  });
}
