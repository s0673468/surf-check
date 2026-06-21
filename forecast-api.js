const WEATHER_HOURLY_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
];
const MARINE_HOURLY_FIELDS = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "secondary_swell_wave_height",
  "secondary_swell_wave_direction",
  "secondary_swell_wave_period",
  "wind_wave_height",
  "wind_wave_direction",
  "wind_wave_period",
  "sea_level_height_msl",
  "sea_surface_temperature",
];

async function fetchBeachForecast(beach) {
  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.search = new URLSearchParams({
    latitude: beach.lat,
    longitude: beach.lon,
    hourly: WEATHER_HOURLY_FIELDS.join(","),
    timezone: TZ,
    forecast_days: "4",
    wind_speed_unit: "kmh",
  });

  const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
  marineUrl.search = new URLSearchParams({
    latitude: beach.lat,
    longitude: beach.lon,
    hourly: MARINE_HOURLY_FIELDS.join(","),
    timezone: TZ,
    forecast_days: "4",
    cell_selection: "sea",
  });

  const [weather, marine] = await Promise.all([
    fetchJson(weatherUrl),
    fetchJson(marineUrl),
  ]);
  const weatherHourly = requireHourlyPayload(weather, "Weather", beach, WEATHER_HOURLY_FIELDS);
  const marineHourly = requireHourlyPayload(marine, "Marine", beach, MARINE_HOURLY_FIELDS);

  return {
    beachId: beach.id,
    weather: weatherHourly,
    marine: marineHourly,
  };
}

function requireHourlyPayload(payload, sourceName, beach, expectedFields = []) {
  const hourly = payload?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
    throw new Error(`${sourceName} forecast missing hourly time series for ${beach.name}`);
  }

  const normalized = { ...hourly };
  for (const field of expectedFields) {
    if (!Array.isArray(normalized[field])) {
      normalized[field] = Array.from({ length: hourly.time.length }, () => null);
    }
  }
  return normalized;
}

async function fetchJson(url) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.retryable = isRetryableHttpStatus(response.status);
        throw error;
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 2 && error.retryable !== false) {
        await delay(300 + attempt * 500); // no dead backoff after the last try
      } else {
        break;
      }
    }
  }

  throw lastError ?? new Error("Forecast request failed");
}

function isRetryableHttpStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
