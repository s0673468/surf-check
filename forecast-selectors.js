// Forecast selectors and scored-sample extraction.
//
// This file stays as a classic script so the app can still run directly from a
// local file or static server without a build step.

function getForecastView(dayOffset = state.selectedDayOffset, hour = state.selectedHour) {
  const beach = selectedBeach();
  const scoredBeaches = getScoredBeachEntries(dayOffset, hour);
  const scoredByBeachId = new Map(scoredBeaches.map((entry) => [entry.beach.id, entry.scored]));

  return {
    dayOffset,
    hour,
    selectedBeach: beach,
    selectedScored: scoredByBeachId.get(beach.id) ?? null,
    scoredBeaches,
    rankedBeaches: [...scoredBeaches].sort(compareScoredEntries),
    scoredByBeachId,
  };
}

function getScoredBeachEntries(dayOffset, hour, beaches = BEACHES) {
  return beaches
    .map((beach) => ({
      beach,
      scored: getScoredSample(beach, dayOffset, hour),
    }))
    .filter((entry) => entry.scored);
}

function getScoredTimeline(beach, dayOffset) {
  return HOURS.map((hour) => ({
    hour,
    scored: getScoredSample(beach, dayOffset, hour),
  })).filter((entry) => entry.scored);
}

function getNearbyScoredBeachEntries(beach, dayOffset, hour, limit = 3) {
  return getScoredBeachEntries(
    dayOffset,
    hour,
    BEACHES.filter((other) => other.id !== beach.id),
  )
    .map((entry) => ({
      ...entry,
      distance: distanceKm(beach, entry.beach),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function bestScoredEntry(entries) {
  if (!entries.length) return null;
  return entries.reduce((best, entry) =>
    entry.scored.score.score > best.scored.score.score ? entry : best,
  );
}

function groupScoredEntries(entries, keyFn) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyFn(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

function compareScoredEntries(a, b) {
  return b.scored.score.score - a.scored.score.score;
}

// Descending comparator for flat `{ score }` entries (the prose layer's per-beach
// and per-hour peak summaries).
function compareByScoreDesc(a, b) {
  return b.score - a.score;
}

// Scored samples are pure given (beach, day, hour, language) and the loaded
// forecast set, so memoize them: a single slider drag re-reads ~156 beach x hour
// cells per step, and describeDay/timeline re-score the same cells again.
const scoredSampleCache = new Map();

function getScoredSample(beach, dayOffset, hour) {
  // Key on the ABSOLUTE date, not the relative dayOffset: dateKey() resolves
  // against new Date() at call time, so a cache keyed on the offset alone would
  // serve yesterday's scores under today's labels if the tab is left open across
  // local midnight. Encoding the resolved date makes stale entries simply miss.
  const key = `${state.lang}:${beach.id}:${dateKey(dayOffset)}:${hour}`;
  if (scoredSampleCache.has(key)) return scoredSampleCache.get(key);
  const result = computeScoredSample(beach, dayOffset, hour);
  scoredSampleCache.set(key, result);
  return result;
}

function computeScoredSample(beach, dayOffset, hour) {
  const forecast = state.forecasts.get(beach.id);
  if (!forecast) return null;

  const target = `${dateKey(dayOffset)}T${String(hour).padStart(2, "0")}:00`;
  const weatherIndex = forecast.weather.time.indexOf(target);
  const marineIndex = forecast.marine.time.indexOf(target);

  if (weatherIndex < 0 || marineIndex < 0) return null;

  const sample = {
    time: target,
    temperature: valueAt(forecast.weather, "temperature_2m", weatherIndex),
    precipitationProbability: valueAt(
      forecast.weather,
      "precipitation_probability",
      weatherIndex,
    ),
    cloudCover: valueAt(forecast.weather, "cloud_cover", weatherIndex),
    windSpeed: valueAt(forecast.weather, "wind_speed_10m", weatherIndex),
    windDirection: valueAt(forecast.weather, "wind_direction_10m", weatherIndex),
    windGusts: valueAt(forecast.weather, "wind_gusts_10m", weatherIndex),
    waveHeight: valueAt(forecast.marine, "wave_height", marineIndex),
    waveDirection: valueAt(forecast.marine, "wave_direction", marineIndex),
    wavePeriod: valueAt(forecast.marine, "wave_period", marineIndex),
    swellHeight: valueAt(forecast.marine, "swell_wave_height", marineIndex),
    swellDirection: valueAt(forecast.marine, "swell_wave_direction", marineIndex),
    swellPeriod: valueAt(forecast.marine, "swell_wave_period", marineIndex),
    secondarySwellHeight: valueAt(forecast.marine, "secondary_swell_wave_height", marineIndex),
    secondarySwellDirection: valueAt(forecast.marine, "secondary_swell_wave_direction", marineIndex),
    secondarySwellPeriod: valueAt(forecast.marine, "secondary_swell_wave_period", marineIndex),
    windWaveHeight: valueAt(forecast.marine, "wind_wave_height", marineIndex),
    windWaveDirection: valueAt(forecast.marine, "wind_wave_direction", marineIndex),
    windWavePeriod: valueAt(forecast.marine, "wind_wave_period", marineIndex),
    seaLevel: valueAt(forecast.marine, "sea_level_height_msl", marineIndex),
    seaTemperature: valueAt(forecast.marine, "sea_surface_temperature", marineIndex),
  };

  const nextMarineIndex = Math.min(marineIndex + 1, forecast.marine.time.length - 1);
  sample.nextSeaLevel = valueAt(forecast.marine, "sea_level_height_msl", nextMarineIndex);
  sample.tideState = tideStateAt(forecast.marine, marineIndex);

  return {
    beach,
    sample,
    score: scoreSample(beach, sample, dayOffset),
  };
}

// Normalize the sea-level reading to a 0 (low) .. 1 (high) tide state within the
// local tidal range. Open-Meteo's sea_level_height_msl is referenced to the
// global MSL datum (not the local chart datum) and carries a surge/pressure
// residual, so the absolute metre value is not a reliable tide phase, but its
// position inside the surrounding +/-18 h min/max window is.
function tideStateAt(marine, index) {
  const levels = marine?.sea_level_height_msl;
  if (!Array.isArray(levels)) return 0.5;
  const here = numericCell(levels[index]);
  if (!Number.isFinite(here)) return 0.5;

  const lo = Math.max(0, index - 18);
  const hi = Math.min(levels.length - 1, index + 18);
  let min = Infinity;
  let max = -Infinity;
  for (let i = lo; i <= hi; i += 1) {
    const value = numericCell(levels[i]);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || max - min < 0.1) return 0.5; // flat / no usable range
  return clamp((here - min) / (max - min), 0, 1);
}
