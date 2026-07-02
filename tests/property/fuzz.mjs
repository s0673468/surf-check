import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import {
  analyzeTruthLedger,
  compareTruthEntry,
  formatTruthSummary,
  loadTruthLedgerFromFile,
} from "../../scripts/forecast-truth.mjs";

const EXAMPLES = Number(process.env.SURF_PROPERTY_EXAMPLES ?? 80);
const BASE_SEED = Number(process.env.SURF_PROPERTY_SEED ?? 0x5eed2026);

const indexHtml = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const runtimeScriptFiles = Array.from(
  indexHtml.matchAll(/<script\b[^>]*\bsrc="\.\/([^"]+\.js)"[^>]*><\/script>/g),
  (match) => match[1],
);
const runtimeSources = runtimeScriptFiles.map((file) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"),
);

function loadRuntime() {
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
globalThis.__surfPropertyTest = {
  BEACHES,
  HOURS,
  WEATHER_HOURLY_FIELDS,
  MARINE_HOURLY_FIELDS,
  state,
  dateKey,
  requireHourlyPayload,
  getForecastView,
  getScoredSample,
  scoreSample,
  selectedBeach,
  windQualityFactor,
  directionWindowScore,
  tideScore,
  tideStateAt,
  numericCell,
  normalizeRadarFrames,
  findClosestRadarFrameIndex,
  buildRadarTileUrl,
  scoredSampleCache,
};`,
    context,
    { filename: "runtime" },
  );
  return context.__surfPropertyTest;
}

const surf = loadRuntime();

function rngFor(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function exampleSeed(index) {
  return (BASE_SEED + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

function integer(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function float(rng, min, max, digits = 3) {
  return Number((min + rng() * (max - min)).toFixed(digits));
}

function pick(rng, values) {
  return values[integer(rng, 0, values.length - 1)];
}

function maybe(rng, value, probability = 0.12) {
  return rng() < probability ? pick(rng, [null, undefined]) : value;
}

function hostileCell(rng, min = -10, max = 80) {
  const value = float(rng, min, max);
  return pick(rng, [
    value,
    String(value),
    ` ${value} `,
    "",
    "   ",
    "\t",
    "NaN",
    "Infinity",
    "-Infinity",
    "\u0000",
    "\ufeff12",
    "12\r\n",
    "1,25",
    "\u202e42",
    "\u030112",
    "\u{1f30a}",
    null,
    undefined,
  ]);
}

function normalizedNumber(rng, min, max, nullProbability = 0.08) {
  if (rng() < nullProbability) return null;
  return float(rng, min, max);
}

function randomBeach(rng) {
  return pick(rng, surf.BEACHES);
}

function randomSample(rng, beach = randomBeach(rng)) {
  const waveHeight = normalizedNumber(rng, 0, 5);
  const swellHeight = normalizedNumber(rng, 0, 5);
  const wavePeriod = normalizedNumber(rng, 2, 20);
  const swellPeriod = normalizedNumber(rng, 2, 20);
  return {
    temperature: normalizedNumber(rng, -5, 38),
    precipitationProbability: normalizedNumber(rng, 0, 100),
    cloudCover: normalizedNumber(rng, 0, 100),
    windSpeed: normalizedNumber(rng, 0, 75),
    windDirection: normalizedNumber(rng, -720, 720),
    windGusts: normalizedNumber(rng, 0, 95),
    waveHeight,
    waveDirection: normalizedNumber(rng, -720, 720),
    wavePeriod,
    swellHeight,
    swellDirection: normalizedNumber(rng, -720, 720),
    swellPeriod,
    secondarySwellHeight: normalizedNumber(rng, 0, 4),
    secondarySwellDirection: normalizedNumber(rng, -720, 720),
    secondarySwellPeriod: normalizedNumber(rng, 2, 20),
    windWaveHeight: normalizedNumber(rng, 0, 3),
    windWaveDirection: normalizedNumber(rng, -720, 720),
    windWavePeriod: normalizedNumber(rng, 2, 14),
    seaLevel: normalizedNumber(rng, -1.5, 1.5),
    nextSeaLevel: normalizedNumber(rng, -1.5, 1.5),
    tideState: normalizedNumber(rng, -0.5, 1.5),
    seaTemperature: normalizedNumber(rng, 8, 30),
  };
}

function assertFiniteOrNull(value, path) {
  assert.ok(value === null || Number.isFinite(value), `${path} must be null or finite`);
}

function assertNoBadWords(value, path) {
  assert.equal(typeof value, "string", `${path} must be a string`);
  assert.doesNotMatch(value, /\b(NaN|undefined)\b/, path);
}

function assertScoreResult(result, seed) {
  assert.equal(Number.isInteger(result.score), true, `score must be integer for seed ${seed}`);
  assert.ok(result.score >= 0 && result.score <= 100, `score out of range for seed ${seed}`);
  assert.equal(typeof result.label, "string");
  assert.ok(result.label.length > 0);
  assert.ok(result.confidence >= 60 && result.confidence <= 94);
  for (const [name, part] of Object.entries(result.parts)) {
    assert.ok(Number.isFinite(part), `score part ${name} must be finite for seed ${seed}`);
  }
  for (const [name, detail] of Object.entries(result.detail)) {
    if (typeof detail === "number") {
      assert.ok(Number.isFinite(detail), `score detail ${name} must be finite for seed ${seed}`);
    }
  }
  for (const [index, reason] of result.reasons.entries()) {
    assertNoBadWords(reason, `reason ${index}`);
  }
}

function shuffled(rng, values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = integer(rng, 0, index);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function hourlyPayload(rng, fields, times) {
  const payload = { time: [...times] };
  for (const field of fields) {
    if (rng() < 0.18) continue;
    const length = Math.max(0, times.length + integer(rng, -2, 2));
    payload[field] = Array.from({ length }, () => hostileCell(rng));
  }
  return payload;
}

function seedGeneratedForecasts(rng) {
  const date = surf.dateKey(0);
  const times = surf.HOURS.map((hour) => `${date}T${String(hour).padStart(2, "0")}:00`);
  surf.state.forecasts.clear();
  surf.scoredSampleCache.clear();
  surf.state.lang = pick(rng, ["pt", "en"]);
  surf.state.selectedBeachId = randomBeach(rng).id;
  surf.state.selectedDayOffset = 0;
  surf.state.selectedHour = pick(rng, surf.HOURS);
  surf.state.loading = false;
  surf.state.error = "";
  surf.state.loadedCount = 0;

  for (const beach of surf.BEACHES) {
    if (rng() < 0.16) continue;
    const weather = surf.requireHourlyPayload(
      { hourly: hourlyPayload(rng, surf.WEATHER_HOURLY_FIELDS, times) },
      "Weather",
      beach,
      surf.WEATHER_HOURLY_FIELDS,
    );
    const marine = surf.requireHourlyPayload(
      { hourly: hourlyPayload(rng, surf.MARINE_HOURLY_FIELDS, times) },
      "Marine",
      beach,
      surf.MARINE_HOURLY_FIELDS,
    );
    surf.state.forecasts.set(beach.id, { beachId: beach.id, weather, marine });
    surf.state.loadedCount += 1;
  }
}

function generatedLedgerEntry(rng, index) {
  const rating = integer(rng, 1, 5);
  const score = integer(rng, 0, 100);
  return {
    id: `generated-${index}-${integer(rng, 0, 9999)}`,
    beachId: randomBeach(rng).id,
    targetTime: `2026-07-${String(1 + (index % 27)).padStart(2, "0")}T${String(integer(rng, 6, 18)).padStart(2, "0")}:00:00-03:00`,
    forecast: {
      score,
      sample: {
        waveHeightM: maybe(rng, float(rng, 0, 4), 0.05),
        wavePeriodS: maybe(rng, float(rng, 2, 18), 0.05),
      },
    },
    observed: {
      rating,
      heightM: maybe(rng, float(rng, 0, 4), 0.05),
      cleanliness: pick(rng, ["clean", "mixed", "windy"]),
      notes: pick(rng, ["clean", "small | table", "wind came up", "\u202ehostile"]),
    },
    tags: shuffled(rng, ["generated", "property", `seed-${index}`]).slice(0, integer(rng, 0, 3)),
  };
}

test("numeric helpers are total over hostile cells", () => {
  for (let index = 0; index < EXAMPLES; index += 1) {
    const seed = exampleSeed(index);
    const rng = rngFor(seed);
    const value = hostileCell(rng, -1000, 1000);
    const parsed = surf.numericCell(value);
    assertFiniteOrNull(parsed, `numericCell(${JSON.stringify(value)}) seed ${seed}`);
  }
});

test("score-model properties preserve score bounds and determinism", () => {
  for (let index = 0; index < EXAMPLES; index += 1) {
    const seed = exampleSeed(index);
    const rng = rngFor(seed);
    const beach = randomBeach(rng);
    const sample = randomSample(rng, beach);
    const dayOffset = integer(rng, -2, 8);
    surf.state.lang = pick(rng, ["pt", "en"]);

    const first = surf.scoreSample(beach, sample, dayOffset);
    const second = surf.scoreSample(beach, structuredClone(sample), dayOffset);

    assert.deepEqual(second, first, `scoreSample must be deterministic for seed ${seed}`);
    assertScoreResult(first, seed);
  }
});

test("forecast selectors tolerate generated hostile hourly cells", () => {
  for (let index = 0; index < EXAMPLES; index += 1) {
    const seed = exampleSeed(index);
    const rng = rngFor(seed);
    seedGeneratedForecasts(rng);

    const view = surf.getForecastView(0, surf.state.selectedHour);
    assert.equal(view.selectedBeach.id, surf.selectedBeach().id);
    assert.ok(view.rankedBeaches.length <= surf.BEACHES.length);
    assert.ok(
      view.rankedBeaches.every(
        (entry, entryIndex, entries) =>
          entryIndex === 0 || entries[entryIndex - 1].scored.score.score >= entry.scored.score.score,
      ),
      `ranked beaches must stay descending for seed ${seed}`,
    );

    for (const entry of view.scoredBeaches) {
      assertScoreResult(entry.scored.score, seed);
      for (const [field, value] of Object.entries(entry.scored.sample)) {
        if (field !== "time") assertFiniteOrNull(value, `${field} seed ${seed}`);
      }
    }
  }
});

test("hourly payload normalization is total for generated API shapes", () => {
  for (let index = 0; index < EXAMPLES; index += 1) {
    const seed = exampleSeed(index);
    const rng = rngFor(seed);
    const beach = randomBeach(rng);
    const length = integer(rng, 1, 24);
    const payload = {
      hourly: {
        time: Array.from({ length }, (_, hour) => `2026-07-02T${String(hour).padStart(2, "0")}:00`),
      },
    };
    const fields = shuffled(rng, surf.WEATHER_HOURLY_FIELDS).slice(0, integer(rng, 0, 3));
    for (const field of fields) {
      payload.hourly[field] = Array.from({ length }, () => hostileCell(rng));
    }

    const normalized = surf.requireHourlyPayload(payload, "Weather", beach, surf.WEATHER_HOURLY_FIELDS);
    assert.equal(normalized.time.length, length);
    for (const field of surf.WEATHER_HOURLY_FIELDS) {
      assert.equal(Array.isArray(normalized[field]), true, `missing normalized array ${field}`);
      assert.equal(normalized[field].length, length, `normalized array length ${field}`);
    }
  }
});

test("radar metadata normalization is sorted and skip-safe", () => {
  for (let index = 0; index < EXAMPLES; index += 1) {
    const seed = exampleSeed(index);
    const rng = rngFor(seed);
    const rawFrames = Array.from({ length: integer(rng, 0, 16) }, (_, frameIndex) => ({
      time: pick(rng, [integer(rng, 0, 9_999), String(integer(rng, 0, 9_999)), "bad", null]),
      path: pick(rng, [`/v2/radar/${seed}-${frameIndex}`, `v2/radar/${frameIndex}`, "", "   ", null]),
    }));
    const metadata = {
      host: pick(rng, [" https://tilecache.rainviewer.com/ ", "", null]),
      radar: {
        past: shuffled(rng, rawFrames.slice(0, Math.floor(rawFrames.length / 2))),
        nowcast: shuffled(rng, rawFrames.slice(Math.floor(rawFrames.length / 2))),
      },
    };
    const normalized = surf.normalizeRadarFrames(metadata);
    assert.equal(normalized.host, typeof metadata.host === "string" ? metadata.host.trim().replace(/\/+$/, "") : "");
    assert.ok(
      normalized.frames.every(
        (frame, frameIndex, frames) =>
          Number.isFinite(frame.time) &&
          frame.path.startsWith("/") &&
          (frameIndex === 0 || frames[frameIndex - 1].time <= frame.time),
      ),
      `radar frames must be finite, absolute, and sorted for seed ${seed}`,
    );
    const url = surf.buildRadarTileUrl(normalized.host, normalized.frames[0]);
    if (url) assert.match(url, /^https?:\/\/.+\/256\/\{z\}\/\{x\}\/\{y\}\/2\/1_1\.png$/);

    const selected = surf.findClosestRadarFrameIndex(normalized.frames, integer(rng, 0, 9_999), 65);
    assert.ok(selected === -1 || (selected >= 0 && selected < normalized.frames.length));
  }
});

test("forecast truth ledger analysis is deterministic over generated entries", () => {
  for (let index = 0; index < EXAMPLES; index += 1) {
    const seed = exampleSeed(index);
    const rng = rngFor(seed);
    const entries = Array.from({ length: integer(rng, 0, 8) }, (_, entryIndex) =>
      generatedLedgerEntry(rng, entryIndex),
    );
    if (rng() < 0.3) {
      entries.splice(integer(rng, 0, entries.length), 0, {
        ...generatedLedgerEntry(rng, 99),
        status: pick(rng, ["template", "example"]),
      });
    }
    const ledger = { schemaVersion: 1, entries };
    const roundTripped = JSON.parse(JSON.stringify(ledger));
    const first = analyzeTruthLedger(ledger);
    const second = analyzeTruthLedger(roundTripped);
    assert.deepEqual(second, first, `ledger analysis must round-trip for seed ${seed}`);
    assert.equal(first.summary.entryCount, entries.filter((entry) => !["template", "example"].includes(entry.status)).length);
    assert.doesNotMatch(formatTruthSummary(first), /\b(undefined|NaN)\b/);
    for (const entry of entries.filter((item) => !["template", "example"].includes(item.status))) {
      assert.deepEqual(compareTruthEntry(entry), compareTruthEntry(JSON.parse(JSON.stringify(entry))));
    }
  }
});

function corruptionsFor(text) {
  const lines = text.split("\n");
  const flipped = text.replace("\"score\": 42", "\"score\": \"not-a-score\"");
  const malformedMiddle = JSON.stringify(
    {
      schemaVersion: 1,
      entries: [
        validLedger().entries[0],
        { id: "malformed-middle", beachId: "joaquina", targetTime: "2026-07-02T08:00:00-03:00" },
        validLedger().entries[1],
      ],
    },
    null,
    2,
  );
  return [
    ["truncated", text.slice(0, Math.max(0, Math.floor(text.length / 2)))],
    ["dropped-line", lines.filter((_, index) => index !== Math.floor(lines.length / 3)).join("\n")],
    ["duplicated-line", [...lines.slice(0, 3), lines[2], ...lines.slice(3)].join("\n")],
    ["reordered-lines", [...lines.slice(0, 2), ...lines.slice(2).reverse()].join("\n")],
    ["flipped-field-byte", flipped],
    ["empty", ""],
    ["nul-bytes", `${text.slice(0, 10)}\u0000${text.slice(10)}`],
    ["bom", `\ufeff${text}`],
    ["crlf", text.replaceAll("\n", "\r\n")],
    ["malformed-middle-record", malformedMiddle],
  ];
}

function validLedger() {
  return {
    schemaVersion: 1,
    entries: [
      {
        id: "valid-one",
        beachId: "matadeiro",
        targetTime: "2026-07-02T08:00:00-03:00",
        forecast: { score: 42, sample: { waveHeightM: 0.86, wavePeriodS: 6.7 } },
        observed: { rating: 3, heightM: 0.8, notes: "small but clean" },
        tags: ["fixture"],
      },
      {
        id: "valid-two",
        beachId: "joaquina",
        targetTime: "2026-07-02T10:00:00-03:00",
        forecast: { score: 68, sample: { waveHeightM: 1.3, wavePeriodS: 10 } },
        observed: { rating: 4, heightM: 1.4, notes: "fun | crowded" },
        tags: ["fixture", "pipe"],
      },
    ],
  };
}

test("forecast truth ledger corruption is caught or rejected cleanly", () => {
  const directory = mkdtempSync(join(tmpdir(), "surf-ledger-fuzz-"));
  try {
    const validText = JSON.stringify(validLedger(), null, 2);
    for (const [name, text] of corruptionsFor(validText)) {
      const path = join(directory, `${name}.json`);
      writeFileSync(path, text, "utf8");
      try {
        const ledger = loadTruthLedgerFromFile(path);
        if (name === "crlf") {
          assert.deepEqual(analyzeTruthLedger(ledger), analyzeTruthLedger(validLedger()));
        } else {
          assert.throws(() => analyzeTruthLedger(ledger), Error, `${name} must not analyze as plausible data`);
        }
      } catch (error) {
        assert.ok(error instanceof Error, `${name} must fail with Error`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
