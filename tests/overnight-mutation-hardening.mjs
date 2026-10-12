// Invented provider payloads only; no app initialization or provider calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({
  fetch() {
    throw new Error("unexpected provider request");
  },
}, { codeGeneration: { strings: false, wasm: false } });
for (const file of ["runtime-utils.js", "forecast-api.js"]) {
  vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context,
    { filename: file, timeout: 1000 });
}
vm.runInContext("globalThis.__surfOvernightTest = { requireHourlyPayload, forecastPayloadMetadata }", context,
  { timeout: 1000 });
const { requireHourlyPayload, forecastPayloadMetadata } = context.__surfOvernightTest;

test("hourly normalization fills each requested gap without changing frozen provider input", () => {
  const time = Object.freeze(["2026-10-11T06:00", "2026-10-11T07:00", "2026-10-11T08:00"]);
  const temperature = Object.freeze([21, 22, 23]);
  const hourly = Object.freeze({ time, temperature_2m: temperature, wind_speed_10m: "unavailable" });
  const payload = Object.freeze({ hourly });
  let normalized;
  assert.doesNotThrow(() => {
    normalized = requireHourlyPayload(payload, "Weather", { name: "Invented beach" },
      ["temperature_2m", "cloud_cover", "wind_speed_10m"]);
  });

  assert.notEqual(normalized, hourly);
  assert.equal(normalized.time, time);
  assert.equal(normalized.temperature_2m, temperature);
  assert.deepEqual(Array.from(normalized.cloud_cover), [null, null, null]);
  assert.deepEqual(Array.from(normalized.wind_speed_10m), [null, null, null]);
  assert.equal(Object.hasOwn(hourly, "cloud_cover"), false);
  assert.equal(hourly.wind_speed_10m, "unavailable");
  assert.equal(payload.hourly, hourly);
});

test("forecast metadata retains provider zeros separately from requested beach coordinates", () => {
  const beach = Object.freeze({ lat: -27.61, lon: -48.52 });
  const provider = Object.freeze({
    model: "invented-model", latitude: 0, longitude: 0, elevation: 0,
    utc_offset_seconds: 0, generationtime_ms: 0, timezone: "UTC",
  });
  const metadata = forecastPayloadMetadata(provider, beach);

  assert.equal(metadata.model, "invented-model");
  assert.equal(metadata.requestedLatitude, -27.61);
  assert.equal(metadata.requestedLongitude, -48.52);
  assert.equal(metadata.latitude, 0);
  assert.equal(metadata.longitude, 0);
  assert.equal(metadata.elevation, 0);
  assert.equal(metadata.utcOffsetSeconds, 0);
  assert.equal(metadata.generationTimeMs, 0);
  assert.equal(metadata.timezone, "UTC");

  const invalid = forecastPayloadMetadata({
    latitude: Number.NaN, longitude: Number.POSITIVE_INFINITY,
    elevation: Number.NEGATIVE_INFINITY, utc_offset_seconds: "not-a-number",
    generationtime_ms: Number.NaN,
  }, beach);
  for (const field of ["latitude", "longitude", "elevation", "utcOffsetSeconds", "generationTimeMs"]) {
    assert.equal(invalid[field], null, field);
  }
  assert.equal(invalid.requestedLatitude, beach.lat);
  assert.equal(invalid.requestedLongitude, beach.lon);
});
