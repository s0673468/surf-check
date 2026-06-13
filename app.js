const TZ = "America/Sao_Paulo";
const HOUR_MIN = 6;
const HOUR_MAX = 18;
const HOURS = Array.from({ length: HOUR_MAX - HOUR_MIN + 1 }, (_, index) => HOUR_MIN + index);
const SCORE_WEIGHTS = {
  swell: 0.44,
  wind: 0.27,
  coastal: 0.12,
  tide: 0.09,
  weather: 0.08,
};

const DATA_SOURCES = [
  {
    key: "bathymetry",
    label: "Depth profiles",
    source: "GEBCO / NOAA ETOPO",
    priority: "First pass",
    url: "https://www.gebco.net/data-products/gridded-bathymetry-data",
    improves: "Estimate nearshore slope, depth change, and broad swell focusing.",
    use: "Better size and power adjustments for each beach.",
    caveat: "Good for coarse shape; too coarse for exact sandbar calls.",
  },
  {
    key: "coastline",
    label: "Coastline and shelter",
    source: "OpenStreetMap Overpass",
    priority: "First pass",
    url: "https://wiki.openstreetmap.org/wiki/Overpass_API",
    improves: "Compute beach angle, headland shadowing, lagoon mouths, and island shelter.",
    use: "Sharper swell-direction and wind-exposure scoring.",
    caveat: "Needs local cleanup where mapped coastline is generalized.",
  },
  {
    key: "wavePartitions",
    label: "Wave partitions",
    source: "Copernicus Marine",
    priority: "Forecast upgrade",
    url: "https://data.marine.copernicus.eu/product/GLOBAL_ANALYSISFORECAST_WAV_001_027/description",
    improves: "Split primary swell, secondary swell, and wind wave instead of using one blended sea state.",
    use: "Less false optimism when the total wave number hides mixed or crossed swell.",
    caveat: "Requires a backend or prefetch step for reliable app use.",
  },
  {
    key: "tides",
    label: "Local tide data",
    source: "CHM BNDO",
    priority: "Forecast upgrade",
    url: "https://www.marinha.mil.br/chm/bndo/acesso",
    improves: "Use Brazilian tide predictions and observed maregraphic stations where available.",
    use: "Better sandbar depth timing than generic sea-level grid values.",
    caveat: "Nearest station still may not represent each beach pocket exactly.",
  },
  {
    key: "observations",
    label: "Buoy and station checks",
    source: "PNBOIA / CHM",
    priority: "Calibration",
    url: "https://www.marinha.mil.br/chm/dados-do-goos-brasil/pnboia",
    improves: "Compare forecast wind, wave, pressure, and water readings against observations.",
    use: "Detect model bias before it reaches the beach score.",
    caveat: "Offshore buoys help calibration, not exact surf-zone shape.",
  },
  {
    key: "sandbars",
    label: "Sandbar snapshots",
    source: "Sentinel-2",
    priority: "Later",
    url: "https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2",
    improves: "Watch shoreline and shallow-bank changes after storms and large swell.",
    use: "Keep long beachbreak profiles from going stale.",
    caveat: "Clouds, water clarity, and tide timing limit image usefulness.",
  },
];

const SPOT_DATA_PROFILES = {
  "praia-mole": {
    beachAxis: "E/ESE pocket",
    depth: "Steep, short nearshore ramp",
    shelter: "Low shelter",
    depthPower: 0.82,
    shelterIndex: 0.18,
    dataConfidence: 0.62,
    localFeature: "Rocky bookends and short sandbar zones make small changes show quickly.",
    forecastImpact:
      "Depth slope and wave partitions would help separate powerful clean swell from raw, closeout-prone energy.",
    dataNeeds: ["bathymetry", "wavePartitions", "coastline", "sandbars"],
  },
  joaquina: {
    beachAxis: "Open ESE beach",
    depth: "Moderate to steep banks",
    shelter: "Low shelter",
    depthPower: 0.74,
    shelterIndex: 0.2,
    dataConfidence: 0.6,
    localFeature: "Dune-backed beachbreak with bank quality doing a lot of the final work.",
    forecastImpact:
      "Sandbar state and swell partitions would explain why the same open-coast forecast can be excellent one week and ordinary the next.",
    dataNeeds: ["sandbars", "wavePartitions", "bathymetry", "observations"],
  },
  campeche: {
    beachAxis: "Long ESE shoreline",
    depth: "Broad shifting sandbars",
    shelter: "Partial island influence",
    depthPower: 0.58,
    shelterIndex: 0.34,
    dataConfidence: 0.56,
    localFeature: "A long beach plus island-side exposure means different peaks can disagree on the same morning.",
    forecastImpact:
      "Coastline geometry and sandbar snapshots would help score sections instead of treating the full beach as one point.",
    dataNeeds: ["coastline", "sandbars", "bathymetry", "wavePartitions"],
  },
  "barra-da-lagoa": {
    beachAxis: "Filtered ENE/E cove",
    depth: "Channel-influenced sand",
    shelter: "Medium to high shelter",
    depthPower: 0.44,
    shelterIndex: 0.68,
    dataConfidence: 0.58,
    localFeature: "The lagoon channel and tucked coastline filter energy that nearby open beaches receive directly.",
    forecastImpact:
      "Coastline shelter and tide data would improve the fallback call when open beaches are too big or messy.",
    dataNeeds: ["coastline", "tides", "observations", "bathymetry"],
  },
  mocambique: {
    beachAxis: "Very open ENE/E coast",
    depth: "Long exposed sandy shelf",
    shelter: "Low shelter",
    depthPower: 0.62,
    shelterIndex: 0.16,
    dataConfidence: 0.55,
    localFeature: "Long undeveloped beach with many peaks, so exposure is high but consistency varies.",
    forecastImpact:
      "Bathymetry, coastline angle, and wave partitions would help avoid overrating raw wind-sea.",
    dataNeeds: ["bathymetry", "coastline", "wavePartitions", "sandbars"],
  },
  santinho: {
    beachAxis: "ENE/E pocket",
    depth: "Pocket beach with headland effects",
    shelter: "Moderate edge shelter",
    depthPower: 0.66,
    shelterIndex: 0.42,
    dataConfidence: 0.58,
    localFeature: "Morro das Aranhas changes the wind and swell feel compared with nearby north beaches.",
    forecastImpact:
      "Coastline shadowing and depth shape would improve angle-sensitive days.",
    dataNeeds: ["coastline", "bathymetry", "wavePartitions", "sandbars"],
  },
  brava: {
    beachAxis: "NE/E cliff-framed",
    depth: "Short, punchy nearshore zone",
    shelter: "Low shelter",
    depthPower: 0.78,
    shelterIndex: 0.22,
    dataConfidence: 0.57,
    localFeature: "Cliffs frame the beach and can make a modest east swell feel stronger than expected.",
    forecastImpact:
      "Depth slope and observation bias checks would keep the model honest on powerful small-to-medium days.",
    dataNeeds: ["bathymetry", "coastline", "wavePartitions", "observations"],
  },
  ingleses: {
    beachAxis: "Broad north bay",
    depth: "Softer bay sandbars",
    shelter: "Medium shelter",
    depthPower: 0.46,
    shelterIndex: 0.56,
    dataConfidence: 0.55,
    localFeature: "The broad bay shape can soften or miss energy that reaches Brava or Santinho.",
    forecastImpact:
      "Coastline shelter and tide calibration would improve when Ingleses should be scored as a mellow alternative.",
    dataNeeds: ["coastline", "tides", "bathymetry", "observations"],
  },
  matadeiro: {
    beachAxis: "SE/SSE cove",
    depth: "Cove and river-mouth sand",
    shelter: "Moderate shelter",
    depthPower: 0.58,
    shelterIndex: 0.48,
    dataConfidence: 0.54,
    localFeature: "The river and cove shape can open the beach to more energy than Armacao next door.",
    forecastImpact:
      "Tide, coastline, and sandbar data would help explain why one side of the cove turns on first.",
    dataNeeds: ["tides", "coastline", "sandbars", "bathymetry"],
  },
  armacao: {
    beachAxis: "Protected south pocket",
    depth: "Softer protected sand",
    shelter: "High shelter",
    depthPower: 0.4,
    shelterIndex: 0.72,
    dataConfidence: 0.52,
    localFeature: "Protection can make it user-friendly, but it also means some swell angles never really arrive.",
    forecastImpact:
      "Shelter geometry and local tide data would reduce false positives on underpowered mornings.",
    dataNeeds: ["coastline", "tides", "observations", "bathymetry"],
  },
  "lagoinha-do-leste": {
    beachAxis: "Very open SE/ESE cove",
    depth: "Exposed remote beachbreak",
    shelter: "Low shelter",
    depthPower: 0.72,
    shelterIndex: 0.2,
    dataConfidence: 0.48,
    localFeature: "Remote open exposure raises upside and downside: standout when aligned, raw when not.",
    forecastImpact:
      "Bathymetry and wave partitions would help separate high-upside lined-up swell from exposed storm surf.",
    dataNeeds: ["bathymetry", "wavePartitions", "coastline", "sandbars"],
  },
};

const BEACHES = [
  {
    id: "praia-mole",
    name: "Praia Mole",
    lat: -27.6031328,
    lon: -48.4333337,
    offshoreWind: 285,
    swellCenter: 115,
    swellSpread: 78,
    idealHeight: [0.7, 1.8],
    maxHeight: 2.8,
    idealTide: 0.22,
    tideSpread: 0.55,
    note: "Exposed east beach",
    region: "East shore",
    exposure: "Open E/ESE",
    breakType: "Steep sand beachbreak",
    profile:
      "Short, open beachbreak that gets punchy fast. It likes organized east to southeast swell and cleans up with west to northwest wind, but it loses shape quickly when the wind turns onshore.",
    whyNearby:
      "Mole and Joaquina are close, but Mole is shorter and steeper with rocky ends, so small changes in size, wind, or sandbar shape show up faster here.",
    traits: ["Picks up swell quickly", "Wind sensitive", "Can get powerful"],
  },
  {
    id: "joaquina",
    name: "Joaquina",
    lat: -27.6343625,
    lon: -48.4542951,
    offshoreWind: 285,
    swellCenter: 118,
    swellSpread: 82,
    idealHeight: [0.8, 2.1],
    maxHeight: 3.0,
    idealTide: 0.05,
    tideSpread: 0.52,
    note: "Open east-southeast exposure",
    region: "East shore",
    exposure: "Open ESE",
    breakType: "Sandbar beachbreak",
    profile:
      "Classic ocean-facing Floripa beachbreak by the dunes. It can hold a little more size than Mole and tends to reward organized east-southeast swell with offshore west to northwest wind.",
    whyNearby:
      "Joaquina and Campeche share the same open coast, but the main Joaquina peak has different banks and headland influence, so the same swell can feel more focused here.",
    traits: ["Holds more size", "Bank dependent", "Competition beach"],
  },
  {
    id: "campeche",
    name: "Campeche",
    lat: -27.6859258,
    lon: -48.4803787,
    offshoreWind: 292,
    swellCenter: 124,
    swellSpread: 78,
    idealHeight: [0.7, 1.9],
    maxHeight: 2.8,
    idealTide: 0.18,
    tideSpread: 0.55,
    note: "Long east-facing beach",
    region: "South-east shore",
    exposure: "Open E/ESE",
    breakType: "Long sandbar beachbreak",
    profile:
      "Long, exposed beach with shifting banks and room for different peaks. It can produce longer right-hand sections around the known banks, but one end can work while another is soft or bumpy.",
    whyNearby:
      "Campeche is nearly continuous with Joaquina, but the longer beach, different banks, and island-side exposure mean swell lines do not always break the same way.",
    traits: ["Long beach", "Shifting peaks", "Can offer runners"],
  },
  {
    id: "barra-da-lagoa",
    name: "Barra da Lagoa",
    lat: -27.5712235,
    lon: -48.4270278,
    offshoreWind: 282,
    swellCenter: 108,
    swellSpread: 65,
    idealHeight: [0.5, 1.4],
    maxHeight: 2.1,
    idealTide: 0.18,
    tideSpread: 0.5,
    note: "Sheltered east beach",
    region: "East shore",
    exposure: "Filtered E/ENE",
    breakType: "Cove and channel beachbreak",
    profile:
      "More protected than the open east beaches, with a softer channel-side feel. It is often more approachable when Mole or Mocambique are too raw.",
    whyNearby:
      "Barra sits by the lagoon channel and tucks behind coastal shape, so nearby open beaches can be bigger while Barra stays smaller and cleaner.",
    traits: ["More forgiving", "Swell filtered", "Good fallback"],
  },
  {
    id: "mocambique",
    name: "Mocambique",
    lat: -27.524143,
    lon: -48.4172118,
    offshoreWind: 285,
    swellCenter: 105,
    swellSpread: 82,
    idealHeight: [0.7, 2.0],
    maxHeight: 3.0,
    idealTide: 0.0,
    tideSpread: 0.58,
    note: "Broad exposed beach",
    region: "East/north-east shore",
    exposure: "Very open E/ENE",
    breakType: "Long open beachbreak",
    profile:
      "Long, undeveloped open coast that catches swell early. The tradeoff is variability: wind and sandbar quality can change a lot along the beach.",
    whyNearby:
      "Mocambique connects toward Barra, but it is much less sheltered, so the same swell can be larger and less organized here while Barra remains mellower.",
    traits: ["Very exposed", "Many peaks", "Raw when windy"],
  },
  {
    id: "santinho",
    name: "Santinho",
    lat: -27.4583612,
    lon: -48.3750063,
    offshoreWind: 292,
    swellCenter: 112,
    swellSpread: 72,
    idealHeight: [0.7, 1.8],
    maxHeight: 2.7,
    idealTide: 0.12,
    tideSpread: 0.52,
    note: "Northeast island exposure",
    region: "North-east shore",
    exposure: "Open ENE/E",
    breakType: "Pocket beachbreak",
    profile:
      "North-east angled beach under Morro das Aranhas. It responds differently from the east coast because it sees more east to northeast energy and a slightly different wind angle.",
    whyNearby:
      "Santinho is beside Ingleses, but its beach angle is more exposed to east-facing swell and less protected by the northern bay shape.",
    traits: ["Angle sensitive", "Can be peaky", "North-east exposure"],
  },
  {
    id: "brava",
    name: "Brava",
    lat: -27.3992523,
    lon: -48.4137268,
    offshoreWind: 250,
    swellCenter: 75,
    swellSpread: 64,
    idealHeight: [0.6, 1.6],
    maxHeight: 2.5,
    idealTide: 0.28,
    tideSpread: 0.5,
    note: "North shore angle",
    region: "North shore",
    exposure: "Open ENE/E",
    breakType: "Cliff-framed beachbreak",
    profile:
      "North-shore beach framed by cliffs. It likes east and east-northeast energy more than the south-east beaches do, and it can feel powerful for its size.",
    whyNearby:
      "Brava is close to Ingleses, but its cliff-framed angle faces incoming swell more directly, so it can have more push when Ingleses looks smaller.",
    traits: ["East swell magnet", "Powerful peaks", "Cliff framed"],
  },
  {
    id: "ingleses",
    name: "Praia dos Ingleses",
    lat: -27.4294468,
    lon: -48.3965338,
    offshoreWind: 245,
    swellCenter: 70,
    swellSpread: 70,
    idealHeight: [0.5, 1.6],
    maxHeight: 2.5,
    idealTide: 0.25,
    tideSpread: 0.5,
    note: "North-east beach near Ingleses",
    region: "North shore",
    exposure: "Partly open NE/E",
    breakType: "Broad beachbreak",
    profile:
      "Wide north-side beach that is often softer than Brava or Santinho. It can be useful when you want a more approachable session, but it may miss some swell angles.",
    whyNearby:
      "Ingleses sits between Brava and Santinho but has a broader, more protected bay feel, so close-by beaches can show more size and power.",
    traits: ["Softer option", "Broad bay feel", "Less powerful"],
  },
  {
    id: "matadeiro",
    name: "Matadeiro",
    lat: -27.7543668,
    lon: -48.4989504,
    offshoreWind: 318,
    swellCenter: 145,
    swellSpread: 76,
    idealHeight: [0.7, 1.8],
    maxHeight: 2.7,
    idealTide: 0.2,
    tideSpread: 0.55,
    note: "South island cove",
    region: "South shore",
    exposure: "Open SE/SSE",
    breakType: "Cove beachbreak",
    profile:
      "South island cove with more open Atlantic energy than Armacao. It usually wants south-east to south-south-east swell with northwest wind to keep the faces clean.",
    whyNearby:
      "Matadeiro is next to Armacao, but the river and cove shape expose it to more ocean energy, so it can be surfable while Armacao is small.",
    traits: ["More exposed than Armacao", "Good shape with SE swell", "Foot access"],
  },
  {
    id: "armacao",
    name: "Armacao",
    lat: -27.7360351,
    lon: -48.5079032,
    offshoreWind: 318,
    swellCenter: 145,
    swellSpread: 72,
    idealHeight: [0.6, 1.5],
    maxHeight: 2.4,
    idealTide: 0.25,
    tideSpread: 0.5,
    note: "Protected south beach",
    region: "South shore",
    exposure: "Protected SE/S",
    breakType: "Protected beachbreak",
    profile:
      "More sheltered south-side beach. It can be a useful softer option when Matadeiro or Lagoinha do Leste are too raw, but it may need more swell to wake up.",
    whyNearby:
      "Armacao is beside Matadeiro, but it sits in a more protected pocket, so the same swell can lose size and power before it reaches the beach.",
    traits: ["Protected", "Needs more swell", "Softer fallback"],
  },
  {
    id: "lagoinha-do-leste",
    name: "Lagoinha do Leste",
    lat: -27.7740217,
    lon: -48.4868801,
    offshoreWind: 315,
    swellCenter: 138,
    swellSpread: 76,
    idealHeight: [0.7, 1.9],
    maxHeight: 2.8,
    idealTide: 0.12,
    tideSpread: 0.55,
    note: "Remote south-east exposure",
    region: "South-east shore",
    exposure: "Very open SE/ESE",
    breakType: "Remote beachbreak",
    profile:
      "Remote, exposed beach with few shelter options. When swell and wind line up it can be a standout, but it can also turn raw quickly.",
    whyNearby:
      "Lagoinha do Leste is deeper on the south-east corner, so cliffs and open exposure can make it larger or more wind-affected than Matadeiro or Armacao.",
    traits: ["Remote", "Very exposed", "High upside"],
  },
];

const state = {
  selectedBeachId: "praia-mole",
  selectedDayOffset: 1,
  selectedHour: 8,
  forecasts: new Map(),
  map: null,
  markers: new Map(),
  loading: true,
  error: "",
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  elements.statusPill = document.querySelector("#statusPill");
  elements.statusText = document.querySelector("#statusText");
  elements.tempStrip = document.querySelector("#tempStrip");
  elements.dayControls = document.querySelector("#dayControls");
  elements.hourControls = document.querySelector("#hourControls");
  elements.selectedSummary = document.querySelector("#selectedSummary");
  elements.metricGrid = document.querySelector("#metricGrid");
  elements.scoreBreakdown = document.querySelector("#scoreBreakdown");
  elements.rankedList = document.querySelector("#rankedList");
  elements.timelinePanel = document.querySelector("#timelinePanel");
  elements.dataPanel = document.querySelector("#dataPanel");
  elements.map = document.querySelector("#map");
  elements.fallbackMap = document.querySelector("#fallbackMap");

  renderControls();
  initializeMap();
  renderLoading();
  loadForecasts();
});

function renderControls() {
  const days = [
    { label: "Today", offset: 0 },
    { label: "Tomorrow", offset: 1 },
    { label: "+2 days", offset: 2 },
    { label: "+3 days", offset: 3 },
  ];

  elements.dayControls.innerHTML = "";
  for (const day of days) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = day.label;
    button.setAttribute("aria-pressed", day.offset === state.selectedDayOffset);
    button.addEventListener("click", () => {
      state.selectedDayOffset = day.offset;
      render();
    });
    elements.dayControls.append(button);
  }

  elements.hourControls.innerHTML = "";
  elements.hourControls.innerHTML = `
    <div class="hour-slider-shell">
      <div class="hour-slider-top">
        <output>${escapeHtml(formatHour(state.selectedHour))}</output>
        <span>${escapeHtml(formatHour(HOUR_MIN))}-${escapeHtml(formatHour(HOUR_MAX))}</span>
      </div>
      <input
        type="range"
        min="${HOUR_MIN}"
        max="${HOUR_MAX}"
        step="1"
        value="${state.selectedHour}"
        aria-label="Forecast hour"
      />
      <div class="hour-ticks" aria-hidden="true">
        <span>06</span>
        <span>09</span>
        <span>12</span>
        <span>15</span>
        <span>18</span>
      </div>
    </div>
  `;

  const slider = elements.hourControls.querySelector('input[type="range"]');
  slider.addEventListener("input", () => {
    state.selectedHour = Number(slider.value);
    render();
  });
}

function initializeMap() {
  if (!window.L) {
    initializeFallbackMap();
    return;
  }

  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([-27.59, -48.46], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(state.map);

  for (const beach of BEACHES) {
    const marker = L.marker([beach.lat, beach.lon], {
      icon: makeMarkerIcon(null),
      title: beach.name,
    })
      .addTo(state.map)
      .bindTooltip(beach.name, {
        className: "beach-tooltip",
        direction: "top",
        offset: [0, -18],
      })
      .on("click", () => {
        state.selectedBeachId = beach.id;
        render();
      });
    state.markers.set(beach.id, marker);
  }
}

function initializeFallbackMap() {
  elements.map.hidden = true;
  elements.fallbackMap.hidden = false;
  elements.fallbackMap.innerHTML = '<div class="fallback-island"></div>';

  const bounds = {
    latMin: -27.8,
    latMax: -27.36,
    lonMin: -48.56,
    lonMax: -48.34,
  };

  for (const beach of BEACHES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fallback-pin map-pin pin-empty";
    button.textContent = "--";
    button.title = beach.name;
    button.style.left = `${((beach.lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * 100}%`;
    button.style.top = `${(1 - (beach.lat - bounds.latMin) / (bounds.latMax - bounds.latMin)) * 100}%`;
    button.addEventListener("click", () => {
      state.selectedBeachId = beach.id;
      render();
    });
    elements.fallbackMap.append(button);
    state.markers.set(beach.id, button);
  }
}

function makeMarkerIcon(score) {
  const className = `map-pin ${pinClass(score)}`;
  const label = Number.isFinite(score) ? String(Math.round(score)) : "--";
  return L.divIcon({
    className: "",
    html: `<div class="${className}">${label}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

async function loadForecasts() {
  updateStatus("loading", "Loading live forecast");
  state.loading = true;
  state.error = "";

  const results = await Promise.allSettled(BEACHES.map(fetchBeachForecast));
  const fulfilled = results.filter((result) => result.status === "fulfilled");

  state.forecasts.clear();
  for (const result of fulfilled) {
    state.forecasts.set(result.value.beachId, result.value);
  }

  state.loading = false;

  if (!fulfilled.length) {
    state.error = "Forecast unavailable";
    updateStatus("error", "Forecast unavailable");
  } else if (fulfilled.length < BEACHES.length) {
    updateStatus("error", `${fulfilled.length}/${BEACHES.length} beaches updated`);
  } else {
    updateStatus("ready", `Live forecast updated ${formatClock(new Date())}`);
  }

  render();
}

async function fetchBeachForecast(beach) {
  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.search = new URLSearchParams({
    latitude: beach.lat,
    longitude: beach.lon,
    hourly:
      "temperature_2m,apparent_temperature,precipitation_probability,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    timezone: TZ,
    forecast_days: "4",
    wind_speed_unit: "kmh",
  });

  const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
  marineUrl.search = new URLSearchParams({
    latitude: beach.lat,
    longitude: beach.lon,
    hourly:
      "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_level_height_msl,sea_surface_temperature",
    timezone: TZ,
    forecast_days: "4",
    cell_selection: "sea",
  });

  const [weather, marine] = await Promise.all([
    fetchJson(weatherUrl),
    fetchJson(marineUrl),
  ]);

  return {
    beachId: beach.id,
    weather: weather.hourly,
    marine: marine.hourly,
  };
}

async function fetchJson(url) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      await delay(300 + attempt * 500);
    }
  }

  throw lastError ?? new Error("Forecast request failed");
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function render() {
  renderControls();
  renderTemperatureStrip();

  if (state.loading) {
    renderLoading();
    return;
  }

  if (state.error && state.forecasts.size === 0) {
    renderError();
    updateMarkers();
    return;
  }

  updateMarkers();
  renderSelectedSummary();
  renderRankedList();
  renderTimeline();
  renderDataPanel();
}

function renderLoading() {
  elements.selectedSummary.innerHTML = '<div class="empty-state">Loading forecast</div>';
  elements.metricGrid.innerHTML = "";
  elements.scoreBreakdown.innerHTML = "";
  elements.rankedList.innerHTML = '<div class="empty-state">Loading beaches</div>';
  elements.timelinePanel.innerHTML = '<div class="empty-state">Loading day window</div>';
  elements.dataPanel.innerHTML = '<div class="empty-state">Loading data roadmap</div>';
}

function renderError() {
  elements.selectedSummary.innerHTML =
    '<div class="empty-state">Forecast data is unavailable right now.</div>';
  elements.metricGrid.innerHTML = "";
  elements.scoreBreakdown.innerHTML = "";
  elements.rankedList.innerHTML = "";
  elements.timelinePanel.innerHTML = "";
  elements.dataPanel.innerHTML = "";
}

function renderTemperatureStrip() {
  const samples = BEACHES.map((beach) =>
    getScoredSample(beach, state.selectedDayOffset, state.selectedHour),
  ).filter(Boolean);
  const air = average(samples.map((item) => item.sample.temperature));
  const water = average(samples.map((item) => item.sample.seaTemperature));
  const label = samples.length
    ? `${formatNumber(air, 0)}°C air · ${formatNumber(water, 0)}°C water`
    : "Air -- · Water --";

  elements.tempStrip.innerHTML = `
    <span>${escapeHtml(formatDayHour(state.selectedDayOffset, state.selectedHour))}</span>
    <strong>${escapeHtml(label)}</strong>
  `;
}

function updateMarkers() {
  for (const beach of BEACHES) {
    const marker = state.markers.get(beach.id);
    const scored = getScoredSample(beach, state.selectedDayOffset, state.selectedHour);
    const score = scored?.score?.score;

    if (state.map && marker?.setIcon) {
      marker.setIcon(makeMarkerIcon(score));
      marker.setZIndexOffset(beach.id === state.selectedBeachId ? 1000 : 0);
    } else if (marker) {
      marker.className = `fallback-pin map-pin ${pinClass(score)}`;
      marker.textContent = Number.isFinite(score) ? String(Math.round(score)) : "--";
    }
  }
}

function renderSelectedSummary() {
  const beach = selectedBeach();
  const scored = getScoredSample(beach, state.selectedDayOffset, state.selectedHour);

  if (!scored) {
    elements.selectedSummary.innerHTML =
      '<div class="empty-state">No forecast for this beach and hour.</div>';
    elements.metricGrid.innerHTML = "";
    elements.scoreBreakdown.innerHTML = "";
    return;
  }

  const score = scored.score;
  const badgeClass = pinClass(score.score);
  elements.selectedSummary.innerHTML = `
    <div class="summary-top">
      <div>
        <h2 class="beach-name">${escapeHtml(beach.name)}</h2>
        <p class="beach-meta">${escapeHtml(formatDayHour(state.selectedDayOffset, state.selectedHour))} · ${escapeHtml(beach.note)}</p>
      </div>
      <div class="score-badge ${badgeClass}">
        <span class="score-number">${score.score}</span>
        <span class="score-label">${escapeHtml(score.label)}</span>
      </div>
    </div>
    <p class="spot-read">${escapeHtml(buildSpotRead(scored))}</p>
    <div class="spot-profile">
      <div>
        <span class="profile-label">Spot type</span>
        <strong>${escapeHtml(beach.breakType)}</strong>
        <span>${escapeHtml(beach.profile)}</span>
      </div>
      <div>
        <span class="profile-label">Why nearby beaches differ</span>
        <strong>${escapeHtml(beach.exposure)} exposure</strong>
        <span>${escapeHtml(beach.whyNearby)}</span>
      </div>
    </div>
    ${renderCoastalCues(beach)}
    <div class="trait-list">
      ${beach.traits.map((trait) => `<span>${escapeHtml(trait)}</span>`).join("")}
    </div>
    <ul class="reason-list">
      ${score.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
    </ul>
  `;

  renderMetrics(scored);
  renderBreakdown(score);
}

function renderMetrics(scored) {
  const { sample, score } = scored;
  const beach = scored.beach;
  const swellRead = describeSwell(beach, sample);
  const windRead = describeWind(beach, sample);
  const coastalRead = describeCoastalFit(beach, sample, score.parts.coastal);
  const tideRead = describeTide(beach, sample, score);
  const weatherRead = describeWeather(sample);
  const metrics = [
    {
      label: "Swell",
      value: `${formatNumber(sample.swellHeight ?? sample.waveHeight, 1)} m · ${formatNumber(sample.swellPeriod ?? sample.wavePeriod, 1)} s`,
      sub: `${degToCompass(sample.swellDirection ?? sample.waveDirection)} ${formatDegrees(sample.swellDirection ?? sample.waveDirection)}`,
      detail: swellRead.detail,
      tone: partTone(score.parts.swell),
    },
    {
      label: "Wind",
      value: `${degToCompass(sample.windDirection)} ${formatNumber(sample.windSpeed, 0)} km/h`,
      sub: `${score.windQuality} · gust ${formatNumber(sample.windGusts, 0)} km/h`,
      detail: windRead.detail,
      tone: partTone(score.parts.wind),
    },
    {
      label: "Coastal fit",
      value: `${Math.round(score.parts.coastal)}%`,
      sub: `${spotDataProfile(beach).depth} · ${spotDataProfile(beach).shelter}`,
      detail: coastalRead.detail,
      tone: partTone(score.parts.coastal),
    },
    {
      label: "Tide",
      value: `${formatSigned(sample.seaLevel)} m`,
      sub: `${score.tideTrend} · ${score.tideQuality}`,
      detail: tideRead.detail,
      tone: partTone(score.parts.tide),
    },
    {
      label: "Weather",
      value: `${formatNumber(sample.temperature, 0)}°C · ${formatNumber(sample.precipitationProbability, 0)}% rain`,
      sub: `${formatNumber(sample.cloudCover, 0)}% cloud · ${formatNumber(sample.seaTemperature, 0)}°C water`,
      detail: weatherRead.detail,
      tone: partTone(score.parts.weather),
    },
    {
      label: "This beach wants",
      value: `${compassWindow(beach.swellCenter, beach.swellSpread)} swell`,
      sub: `${degToCompass(beach.offshoreWind)} wind · ${formatSigned(beach.idealTide)} m tide`,
      detail: `${formatNumber(beach.idealHeight[0], 1)}-${formatNumber(beach.idealHeight[1], 1)} m is the preferred size range for this spot in the prototype model.`,
      tone: "neutral",
    },
  ];

  elements.metricGrid.innerHTML = metrics
    .map(
      (metric) => `
        <div class="metric metric-${escapeHtml(metric.tone)}">
          <span class="metric-label">${escapeHtml(metric.label)}</span>
          <span class="metric-value">${escapeHtml(metric.value)}</span>
          <span class="metric-sub">${escapeHtml(metric.sub)}</span>
          <span class="metric-detail">${escapeHtml(metric.detail)}</span>
        </div>
      `,
    )
    .join("");
}

function renderBreakdown(score) {
  const rows = [
    {
      label: "Swell",
      value: score.parts.swell,
      copy: "The largest part of the score. Size, period, and direction decide whether the beach is actually receiving useful wave energy.",
    },
    {
      label: "Wind",
      value: score.parts.wind,
      copy: "Offshore or cross-offshore wind usually cleans the wave face. Onshore wind adds chop even if the swell is good.",
    },
    {
      label: "Coastal fit",
      value: score.parts.coastal,
      copy: "Beach angle, shelter, and coarse depth profile now adjust how much of the offshore forecast should matter at this spot.",
    },
    {
      label: "Tide",
      value: score.parts.tide,
      copy: "Small but spot-specific. The same tide can help one sandbar stand up and make another section too deep or too shallow.",
    },
    {
      label: "Weather",
      value: score.parts.weather,
      copy: "Mostly comfort and visibility. Rain and cloud matter less than swell and wind, but they affect how pleasant the window feels.",
    },
    {
      label: "Confidence",
      value: score.confidence,
      copy: "Forecast trust falls farther out in time. Treat lower confidence as a reason to recheck before leaving.",
    },
  ];

  elements.scoreBreakdown.innerHTML = rows
    .map(
      ({ label, value, copy }) => `
        <div class="breakdown-row">
          <div class="breakdown-line">
            <span>${escapeHtml(label)}</span>
            <span>${Math.round(value)}%</span>
          </div>
          <div class="track"><div class="bar" style="width: ${clamp(value, 0, 100)}%"></div></div>
          <p class="breakdown-copy">${escapeHtml(copy)}</p>
        </div>
      `,
    )
    .join("");
}

function renderRankedList() {
  const scoredBeaches = BEACHES.map((beach) => ({
    beach,
    scored: getScoredSample(beach, state.selectedDayOffset, state.selectedHour),
  }))
    .filter((item) => item.scored)
    .sort((a, b) => b.scored.score.score - a.scored.score.score);

  const title = formatDayHour(state.selectedDayOffset, state.selectedHour);
  elements.rankedList.innerHTML = `
    <div class="section-head">
      <h2>Best nearby calls</h2>
      <span>${escapeHtml(title)}</span>
    </div>
    <div class="beach-list">
      ${scoredBeaches
        .map(({ beach, scored }) => {
          const sample = scored.sample;
          const score = scored.score.score;
          const rowRead = compactSessionRead(scored);
          return `
            <button class="beach-row" type="button" aria-current="${beach.id === state.selectedBeachId}" data-beach-id="${beach.id}">
              <span class="row-score ${pinClass(score)}">${score}</span>
              <span class="row-copy">
                <span class="row-name">${escapeHtml(beach.name)}</span>
                <span class="row-meta">${escapeHtml(rowRead)}</span>
                <span class="row-data">${formatNumber(sample.swellHeight ?? sample.waveHeight, 1)} m @ ${formatNumber(sample.swellPeriod ?? sample.wavePeriod, 1)} s from ${degToCompass(sample.swellDirection ?? sample.waveDirection)}</span>
              </span>
              <span class="row-wind">${degToCompass(sample.windDirection)} ${formatNumber(sample.windSpeed, 0)} km/h</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  elements.rankedList.querySelectorAll(".beach-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedBeachId = row.dataset.beachId;
      render();
    });
  });
}

function renderTimeline() {
  const beach = selectedBeach();
  const selectedScored = getScoredSample(beach, state.selectedDayOffset, state.selectedHour);
  const bars = HOURS.map((hour) => ({
    hour,
    scored: getScoredSample(beach, state.selectedDayOffset, hour),
  })).filter((item) => item.scored);

  elements.timelinePanel.innerHTML = `
    <div class="section-head">
      <h2>${escapeHtml(beach.name)} day window</h2>
      <span>${escapeHtml(formatDay(state.selectedDayOffset))}</span>
    </div>
    <div class="timeline">
      ${bars
        .map(({ hour, scored }) => {
          const score = scored.score.score;
          return `
            <button class="time-bar" type="button" aria-current="${hour === state.selectedHour}" data-hour="${hour}">
              <span class="bar-column">
                <span class="bar-fill ${pinClass(score)}" style="height: ${Math.max(10, score * 1.34)}px"></span>
              </span>
              <span class="time-score">${score}</span>
              <span class="time-label">${String(hour).padStart(2, "0")}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    ${selectedScored ? renderNearbyContrast(beach, selectedScored) : ""}
  `;

  elements.timelinePanel.querySelectorAll(".time-bar").forEach((bar) => {
    bar.addEventListener("click", () => {
      state.selectedHour = Number(bar.dataset.hour);
      render();
    });
  });
}

function renderCoastalCues(beach) {
  const profile = spotDataProfile(beach);
  const needs = profile.dataNeeds.map(sourceByKey).filter(Boolean).slice(0, 4);

  return `
    <div class="coastal-cues">
      <span class="profile-label">Coastal cues</span>
      <div class="cue-grid">
        <div class="cue-card">
          <span>Beach axis</span>
          <strong>${escapeHtml(profile.beachAxis)}</strong>
        </div>
        <div class="cue-card">
          <span>Depth feel</span>
          <strong>${escapeHtml(profile.depth)}</strong>
        </div>
        <div class="cue-card">
          <span>Shelter</span>
          <strong>${escapeHtml(profile.shelter)}</strong>
        </div>
      </div>
      <p>${escapeHtml(profile.localFeature)}</p>
      <div class="data-need-list" aria-label="Useful open data for this beach">
        ${needs.map((source) => `<span>${escapeHtml(source.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderDataPanel() {
  const beach = selectedBeach();
  const profile = spotDataProfile(beach);
  const prioritySources = profile.dataNeeds.map(sourceByKey).filter(Boolean);

  elements.dataPanel.innerHTML = `
    <div class="section-head data-panel-head">
      <div>
        <h2>Open data upgrades</h2>
        <p>Coastal profiles now affect the score. These public layers are the next path to replace hand-tuned proxies with derived data.</p>
      </div>
      <span>active proxy layer</span>
    </div>
    <div class="data-layout">
      <div class="priority-box">
        <span class="profile-label">For ${escapeHtml(beach.name)}</span>
        <h3>Active coastal proxy</h3>
        <p>${escapeHtml(profile.forecastImpact)}</p>
        <div class="priority-list">
          ${prioritySources
            .map(
              (source, index) => `
                <div class="priority-item">
                  <span>${index + 1}</span>
                  <div>
                    <strong>${escapeHtml(source.label)}</strong>
                    <p>${escapeHtml(source.use)}</p>
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
      <div class="source-grid">
        ${DATA_SOURCES.map((source) => renderSourceCard(source, profile.dataNeeds.includes(source.key))).join("")}
      </div>
    </div>
  `;
}

function renderSourceCard(source, isRelevant) {
  return `
    <article class="source-card${isRelevant ? " is-relevant" : ""}">
      <div class="source-top">
        <span class="source-label">${escapeHtml(source.label)}</span>
        <span class="source-priority">${escapeHtml(source.priority)}</span>
      </div>
      <h3>${escapeHtml(source.source)}</h3>
      <p>${escapeHtml(source.improves)}</p>
      <p class="source-use">${escapeHtml(source.use)}</p>
      <span class="source-caveat">${escapeHtml(source.caveat)}</span>
      <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Source</a>
    </article>
  `;
}

function buildSpotRead(scored) {
  const swellRead = describeSwell(scored.beach, scored.sample);
  const windRead = describeWind(scored.beach, scored.sample);
  const coastalRead = describeCoastalFit(scored.beach, scored.sample, scored.score.parts.coastal);
  const tideRead = describeTide(scored.beach, scored.sample, scored.score);

  if (scored.score.score >= 80) {
    return `Strong call: ${swellRead.short}. ${windRead.short}. ${coastalRead.short}.`;
  }
  if (scored.score.score >= 66) {
    return `Worth checking: ${swellRead.short}. ${windRead.short}. ${coastalRead.short}.`;
  }
  if (scored.score.score >= 52) {
    return `Possible but selective: ${swellRead.short}. ${windRead.short}. ${tideRead.short}.`;
  }
  return `Probably a compromised session: ${swellRead.short}. ${windRead.short}. ${tideRead.short}.`;
}

function compactSessionRead(scored) {
  const limiting = limitingFactor(scored.score.parts);
  const support = supportFactor(scored.score.parts);
  const reads = {
    swell: describeSwell(scored.beach, scored.sample).short,
    wind: describeWind(scored.beach, scored.sample).short,
    coastal: describeCoastalFit(scored.beach, scored.sample, scored.score.parts.coastal).short,
    tide: describeTide(scored.beach, scored.sample, scored.score).short,
    weather: describeWeather(scored.sample).short,
  };

  if (scored.score.score >= 66) {
    return `${scored.score.label}: ${reads[support.key]}. Watch ${limiting.label.toLowerCase()}.`;
  }

  return `${scored.score.label}: ${reads[limiting.key]}.`;
}

function describeSwell(beach, sample) {
  const height = sample.swellHeight ?? sample.waveHeight;
  const period = sample.swellPeriod ?? sample.wavePeriod;
  const direction = sample.swellDirection ?? sample.waveDirection;
  const directionDiff = angularDiff(direction, beach.swellCenter);

  let heightText = "size data is missing";
  if (Number.isFinite(height)) {
    if (height < beach.idealHeight[0] * 0.65) {
      heightText = "small for this beach";
    } else if (height < beach.idealHeight[0]) {
      heightText = "a little under this beach's preferred size";
    } else if (height <= beach.idealHeight[1]) {
      heightText = "inside this beach's preferred size";
    } else if (height < beach.maxHeight) {
      heightText = "above ideal but still within range";
    } else {
      heightText = "bigger than this spot usually handles well";
    }
  }

  let periodText = "period data is missing";
  if (Number.isFinite(period)) {
    if (period < 8) {
      periodText = "short-period and less organized";
    } else if (period <= 14) {
      periodText = "organized enough for clean lines";
    } else {
      periodText = "long-period with extra push and wrap";
    }
  }

  let directionText = "direction data is missing";
  if (Number.isFinite(direction)) {
    if (directionDiff <= beach.swellSpread * 0.35) {
      directionText = "well aimed at this beach";
    } else if (directionDiff <= beach.swellSpread * 0.75) {
      directionText = "usable but not perfect for this beach";
    } else {
      directionText = "mostly outside this beach's best angle";
    }
  }

  return {
    short: `${heightText}; ${periodText}; ${directionText}`,
    detail: `The swell is ${heightText}. The period is ${periodText}. The direction is ${directionText} against a ${compassWindow(
      beach.swellCenter,
      beach.swellSpread,
    )} target window.`,
  };
}

function describeWind(beach, sample) {
  const speed = sample.windSpeed;
  const gusts = sample.windGusts;
  const directionDiff = angularDiff(sample.windDirection, beach.offshoreWind);

  let angleText = "wind angle is unclear";
  if (Number.isFinite(sample.windDirection)) {
    if (directionDiff <= 45) {
      angleText = "offshore here, so it should groom the wave face";
    } else if (directionDiff <= 95) {
      angleText = "cross-offshore here, still generally helpful";
    } else if (directionDiff <= 135) {
      angleText = "cross-onshore here, so expect some texture";
    } else {
      angleText = "onshore here, so chop is the main concern";
    }
  }

  let speedText = "wind strength is unclear";
  if (Number.isFinite(speed)) {
    if (speed <= 7) {
      speedText = "light";
    } else if (speed <= 15) {
      speedText = "moderate";
    } else if (speed <= 26) {
      speedText = "noticeable";
    } else {
      speedText = "strong";
    }
  }

  const gustText =
    Number.isFinite(gusts) && Number.isFinite(speed) && gusts - speed >= 12
      ? " Gusts are meaningfully above the base wind, so the surface may pulse."
      : "";

  return {
    short: `${speedText} ${angleText}`,
    detail: `${degToCompass(sample.windDirection)} wind is ${angleText}. The speed is ${speedText} for surfing.${gustText}`,
  };
}

function describeCoastalFit(beach, sample, coastalScore) {
  const profile = spotDataProfile(beach);
  const height = sample.swellHeight ?? sample.waveHeight;
  const period = sample.swellPeriod ?? sample.wavePeriod;
  const direction = sample.swellDirection ?? sample.waveDirection;
  const angleFit = directionWindowScore(direction, beach.swellCenter, beach.swellSpread);
  const energy = swellEnergy(height, period);

  let scoreText = "coastal fit is uncertain";
  if (Number.isFinite(coastalScore)) {
    if (coastalScore >= 76) {
      scoreText = "coastal shape supports the forecast";
    } else if (coastalScore >= 52) {
      scoreText = "coastal shape is workable but selective";
    } else {
      scoreText = "coastal shape is filtering or distorting the forecast";
    }
  }

  const shelterText =
    profile.shelterIndex >= 0.62
      ? "This beach is sheltered, so it needs better alignment or more energy."
      : profile.shelterIndex <= 0.25
        ? "This beach is exposed, so raw swell and wind show up quickly."
        : "This beach has partial shelter, so one corner can differ from another.";

  return {
    short: `${scoreText} for this beach's ${profile.depth.toLowerCase()}`,
    detail: `${scoreText}. Energy is ${energy >= 0.68 ? "high" : energy >= 0.38 ? "moderate" : "low"} and angle fit is ${Math.round(
      angleFit * 100,
    )}%. ${shelterText}`,
  };
}

function describeTide(beach, sample, score) {
  const tideDiff = Math.abs((sample.seaLevel ?? 0) - beach.idealTide);
  let fitText = "tide fit is unclear";

  if (Number.isFinite(sample.seaLevel)) {
    if (tideDiff <= beach.tideSpread * 0.25) {
      fitText = "very close to this beach's preferred tide";
    } else if (tideDiff <= beach.tideSpread * 0.55) {
      fitText = "close enough to this beach's preferred tide";
    } else if (tideDiff <= beach.tideSpread) {
      fitText = "on the edge of this beach's preferred tide";
    } else {
      fitText = "outside this beach's preferred tide";
    }
  }

  return {
    short: `${score.tideTrend.toLowerCase()} tide is ${fitText}`,
    detail: `The model target here is around ${formatSigned(beach.idealTide)} m. Current sea level is ${formatSigned(
      sample.seaLevel,
    )} m, ${score.tideTrend.toLowerCase()}, and ${fitText}.`,
  };
}

function describeWeather(sample) {
  const rain = sample.precipitationProbability ?? 0;
  const cloud = sample.cloudCover ?? 0;
  const rainText =
    rain >= 60
      ? "rain is likely"
      : rain >= 35
        ? "showers are possible"
        : "rain is not a major concern";
  const cloudText =
    cloud >= 75
      ? "mostly cloudy"
      : cloud >= 40
        ? "partly cloudy"
        : "bright enough";

  return {
    short: `${rainText}; ${cloudText}`,
    detail: `Weather mostly changes comfort, visibility, and wind confidence. For this hour, ${rainText} and it looks ${cloudText}.`,
  };
}

function renderNearbyContrast(beach, selectedScored) {
  const nearby = BEACHES.filter((other) => other.id !== beach.id)
    .map((other) => ({
      beach: other,
      distance: distanceKm(beach, other),
      scored: getScoredSample(other, state.selectedDayOffset, state.selectedHour),
    }))
    .filter((item) => item.scored)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  if (!nearby.length) return "";

  return `
    <div class="nearby-contrast">
      <div class="section-head contrast-head">
        <h3>Nearby contrast</h3>
        <span>why close spots split</span>
      </div>
      <div class="contrast-list">
        ${nearby
          .map(({ beach: otherBeach, distance, scored }) => {
            const delta = selectedScored.score.score - scored.score.score;
            const deltaText =
              Math.abs(delta) <= 2
                ? "Nearly tied"
                : delta > 0
                  ? `${selectedScored.beach.name} +${Math.abs(delta)}`
                  : `${otherBeach.name} +${Math.abs(delta)}`;

            return `
              <div class="contrast-item">
                <span class="contrast-score ${pinClass(scored.score.score)}">${scored.score.score}</span>
                <div class="contrast-copy">
                  <div>
                    <strong>${escapeHtml(otherBeach.name)}</strong>
                    <span>${escapeHtml(formatDistance(distance))} away · ${escapeHtml(deltaText)}</span>
                  </div>
                  <p>${escapeHtml(contrastReason(selectedScored, scored))}</p>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function contrastReason(selectedScored, otherScored) {
  const selectedParts = selectedScored.score.parts;
  const otherParts = otherScored.score.parts;
  const factor = ["swell", "wind", "coastal", "tide", "weather"]
    .map((key) => ({
      key,
      impact: Math.abs(selectedParts[key] - otherParts[key]) * SCORE_WEIGHTS[key],
    }))
    .sort((a, b) => b.impact - a.impact)[0];

  if (!factor || factor.impact < 1.5) {
    return selectedScored.beach.whyNearby;
  }

  if (factor.key === "swell") {
    return swellContrastReason(selectedScored, otherScored);
  }
  if (factor.key === "wind") {
    return windContrastReason(selectedScored, otherScored);
  }
  if (factor.key === "coastal") {
    return coastalContrastReason(selectedScored, otherScored);
  }
  if (factor.key === "tide") {
    return tideContrastReason(selectedScored, otherScored);
  }
  return "The weather grid is slightly different here, but swell and wind still matter more than rain or cloud.";
}

function swellContrastReason(selectedScored, otherScored) {
  const selectedDirection = selectedScored.sample.swellDirection ?? selectedScored.sample.waveDirection;
  const otherDirection = otherScored.sample.swellDirection ?? otherScored.sample.waveDirection;
  const selectedDiff = angularDiff(selectedDirection, selectedScored.beach.swellCenter);
  const otherDiff = angularDiff(otherDirection, otherScored.beach.swellCenter);

  if (Math.abs(selectedDiff - otherDiff) >= 10) {
    const better = selectedDiff < otherDiff ? selectedScored : otherScored;
    const worse = selectedDiff < otherDiff ? otherScored : selectedScored;
    return `Swell angle fits ${better.beach.name} better: about ${Math.round(
      Math.min(selectedDiff, otherDiff),
    )}° off its target versus ${Math.round(Math.max(selectedDiff, otherDiff))}° at ${worse.beach.name}.`;
  }

  const selectedHeight = selectedScored.sample.swellHeight ?? selectedScored.sample.waveHeight;
  const otherHeight = otherScored.sample.swellHeight ?? otherScored.sample.waveHeight;
  if (Number.isFinite(selectedHeight) && Number.isFinite(otherHeight) && Math.abs(selectedHeight - otherHeight) >= 0.15) {
    const bigger = selectedHeight > otherHeight ? selectedScored : otherScored;
    return `The marine grid shows more swell reaching ${bigger.beach.name}, which can happen when nearby beaches face the same swell at different angles.`;
  }

  return "The main split is swell fit: each beach has a different preferred direction and sandbar exposure.";
}

function windContrastReason(selectedScored, otherScored) {
  const selectedDiff = angularDiff(selectedScored.sample.windDirection, selectedScored.beach.offshoreWind);
  const otherDiff = angularDiff(otherScored.sample.windDirection, otherScored.beach.offshoreWind);
  const better = selectedDiff < otherDiff ? selectedScored : otherScored;
  const worse = selectedDiff < otherDiff ? otherScored : selectedScored;

  return `Wind is closer to offshore at ${better.beach.name}; it is about ${Math.round(
    Math.min(selectedDiff, otherDiff),
  )}° off there versus ${Math.round(Math.max(selectedDiff, otherDiff))}° at ${worse.beach.name}.`;
}

function coastalContrastReason(selectedScored, otherScored) {
  const selectedProfile = spotDataProfile(selectedScored.beach);
  const otherProfile = spotDataProfile(otherScored.beach);
  const better =
    selectedScored.score.parts.coastal >= otherScored.score.parts.coastal
      ? selectedScored
      : otherScored;
  const betterProfile = spotDataProfile(better.beach);

  return `${better.beach.name} has the better coastal fit here: ${betterProfile.depth.toLowerCase()}, ${betterProfile.shelter.toLowerCase()}, and its angle handles this swell more cleanly than ${selectedProfile.beachAxis === otherProfile.beachAxis ? "the nearby profile" : "the other beach axis"}.`;
}

function tideContrastReason(selectedScored, otherScored) {
  const selectedDiff = Math.abs((selectedScored.sample.seaLevel ?? 0) - selectedScored.beach.idealTide);
  const otherDiff = Math.abs((otherScored.sample.seaLevel ?? 0) - otherScored.beach.idealTide);
  const better = selectedDiff < otherDiff ? selectedScored : otherScored;

  return `The tide is closer to ${better.beach.name}'s rough target. Nearby beaches can prefer different water depth over their sandbars.`;
}

function limitingFactor(parts) {
  return weightedFactors(parts)
    .map((factor) => ({
      ...factor,
      drag: (100 - factor.value) * factor.weight,
    }))
    .sort((a, b) => b.drag - a.drag)[0];
}

function supportFactor(parts) {
  return weightedFactors(parts)
    .map((factor) => ({
      ...factor,
      support: factor.value * factor.weight,
    }))
    .sort((a, b) => b.support - a.support)[0];
}

function weightedFactors(parts) {
  return [
    { key: "swell", label: "swell fit", value: parts.swell, weight: SCORE_WEIGHTS.swell },
    { key: "wind", label: "wind", value: parts.wind, weight: SCORE_WEIGHTS.wind },
    { key: "coastal", label: "coastal fit", value: parts.coastal, weight: SCORE_WEIGHTS.coastal },
    { key: "tide", label: "tide", value: parts.tide, weight: SCORE_WEIGHTS.tide },
    { key: "weather", label: "weather", value: parts.weather, weight: SCORE_WEIGHTS.weather },
  ];
}

function partTone(value) {
  if (value >= 76) return "good";
  if (value >= 52) return "watch";
  return "poor";
}

function compassWindow(center, spread) {
  const halfWindow = spread * 0.42;
  const left = degToCompass(center - halfWindow);
  const right = degToCompass(center + halfWindow);
  return left === right ? left : `${left}-${right}`;
}

function distanceKm(a, b) {
  const earthRadiusKm = 6371;
  const latDelta = toRadians(b.lat - a.lat);
  const lonDelta = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const value =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function getScoredSample(beach, dayOffset, hour) {
  const forecast = state.forecasts.get(beach.id);
  if (!forecast) return null;

  const target = `${dateKey(dayOffset)}T${String(hour).padStart(2, "0")}:00`;
  const weatherIndex = forecast.weather.time.indexOf(target);
  const marineIndex = forecast.marine.time.indexOf(target);

  if (weatherIndex < 0 || marineIndex < 0) return null;

  const sample = {
    time: target,
    temperature: valueAt(forecast.weather, "temperature_2m", weatherIndex),
    apparentTemperature: valueAt(forecast.weather, "apparent_temperature", weatherIndex),
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
    seaLevel: valueAt(forecast.marine, "sea_level_height_msl", marineIndex),
    seaTemperature: valueAt(forecast.marine, "sea_surface_temperature", marineIndex),
  };

  const nextMarineIndex = Math.min(marineIndex + 1, forecast.marine.time.length - 1);
  sample.nextSeaLevel = valueAt(forecast.marine, "sea_level_height_msl", nextMarineIndex);

  return {
    beach,
    sample,
    score: scoreSample(beach, sample, dayOffset),
  };
}

function scoreSample(beach, sample, dayOffset) {
  const height = sample.swellHeight ?? sample.waveHeight ?? 0;
  const period = sample.swellPeriod ?? sample.wavePeriod ?? 0;
  const swellDirection = sample.swellDirection ?? sample.waveDirection;
  const windSpeed = sample.windSpeed ?? 0;
  const gusts = sample.windGusts ?? windSpeed;
  const rain = sample.precipitationProbability ?? 0;
  const cloud = sample.cloudCover ?? 0;

  const heightScore = heightRangeScore(
    height,
    beach.idealHeight[0],
    beach.idealHeight[1],
    beach.maxHeight,
  );
  const periodScore = periodRangeScore(period);
  const directionScoreValue = directionWindowScore(
    swellDirection,
    beach.swellCenter,
    beach.swellSpread,
  );
  const swell = 100 * (heightScore * 0.44 + periodScore * 0.34 + directionScoreValue * 0.22);

  const windDiff = angularDiff(sample.windDirection, beach.offshoreWind);
  const windDirectionScore = windDirectionQuality(windDiff);
  const speedScore = windSpeedScore(windSpeed);
  const gustPenalty = clamp((gusts - windSpeed - 10) / 25, 0, 0.28);
  const wind = 100 * clamp(windDirectionScore * (0.62 + 0.38 * speedScore) - gustPenalty, 0, 1);

  const tideScoreValue = tideScore(sample.seaLevel, beach.idealTide, beach.tideSpread);
  const tide = tideScoreValue * 100;
  const coastal = coastalFitScore(beach, sample);
  const weather = 100 * clamp(1 - rain / 170 - cloud / 500, 0.18, 1);
  const confidence = [94, 87, 76, 64][dayOffset] ?? 60;

  const weighted =
    swell * SCORE_WEIGHTS.swell +
    wind * SCORE_WEIGHTS.wind +
    coastal * SCORE_WEIGHTS.coastal +
    tide * SCORE_WEIGHTS.tide +
    weather * SCORE_WEIGHTS.weather;
  const score = Math.round(clamp(weighted, 0, 100));
  const tideTrend = tideTrendText(sample.seaLevel, sample.nextSeaLevel);
  const windQuality = windQualityText(windDiff, windSpeed);

  return {
    score,
    label: scoreLabel(score),
    confidence,
    parts: {
      swell,
      wind,
      coastal,
      tide,
      weather,
    },
    windQuality,
    tideTrend,
    tideQuality: tideQualityText(tideScoreValue),
    reasons: buildReasons({
      sample,
      height,
      period,
      swellDirection,
      coastal,
      beach,
      windQuality,
      tideTrend,
      tideQuality: tideQualityText(tideScoreValue),
      score,
    }),
  };
}

function buildReasons(context) {
  const {
    sample,
    height,
    period,
    swellDirection,
    coastal,
    beach,
    windQuality,
    tideTrend,
    tideQuality,
    score,
  } = context;
  const reasons = [];

  reasons.push(
    `${formatNumber(height, 1)} m @ ${formatNumber(period, 1)} s swell from ${degToCompass(swellDirection)}`,
  );
  reasons.push(
    `${windQuality} ${degToCompass(sample.windDirection)} wind at ${formatNumber(sample.windSpeed, 0)} km/h`,
  );
  reasons.push(`${tideTrend} ${tideQuality.toLowerCase()} tide at ${formatSigned(sample.seaLevel)} m`);

  if (coastal < 48) {
    reasons.push(`Coastal fit is filtering the forecast at ${beach.name}`);
  } else if (coastal >= 74) {
    reasons.push(`Coastal fit supports ${spotDataProfile(beach).beachAxis}`);
  } else if ((sample.precipitationProbability ?? 0) >= 45) {
    reasons.push(`${formatNumber(sample.precipitationProbability, 0)}% rain risk`);
  }

  if (reasons.length < 4 && (sample.precipitationProbability ?? 0) >= 45) {
    reasons.push(`${formatNumber(sample.precipitationProbability, 0)}% rain risk`);
  } else if (reasons.length < 4 && score >= 70) {
    reasons.push("Clean enough weather window");
  }

  return reasons.slice(0, 4);
}

function heightRangeScore(height, idealMin, idealMax, maxHeight) {
  if (!Number.isFinite(height)) return 0.45;
  const minSurf = Math.max(0.25, idealMin * 0.48);
  if (height <= minSurf) return scale(height, 0, minSurf, 0.08, 0.22);
  if (height < idealMin) return scale(height, minSurf, idealMin, 0.22, 1);
  if (height <= idealMax) return 1;
  if (height < maxHeight) return scale(height, idealMax, maxHeight, 1, 0.32);
  return 0.22;
}

function periodRangeScore(period) {
  if (!Number.isFinite(period)) return 0.45;
  if (period < 5) return scale(period, 0, 5, 0.12, 0.32);
  if (period < 8) return scale(period, 5, 8, 0.32, 0.9);
  if (period <= 14) return 1;
  if (period <= 18) return scale(period, 14, 18, 0.95, 0.76);
  return 0.66;
}

function directionWindowScore(direction, center, spread) {
  if (!Number.isFinite(direction)) return 0.5;
  const diff = angularDiff(direction, center);
  if (diff >= spread) return 0.08;
  const normalized = diff / spread;
  return clamp(1 - normalized ** 1.55, 0.08, 1);
}

function windDirectionQuality(diff) {
  if (!Number.isFinite(diff)) return 0.55;
  if (diff <= 35) return 1;
  if (diff <= 70) return 0.84;
  if (diff <= 105) return 0.58;
  if (diff <= 145) return 0.31;
  return 0.12;
}

function windSpeedScore(speed) {
  if (!Number.isFinite(speed)) return 0.6;
  if (speed <= 5) return 1;
  if (speed <= 12) return scale(speed, 5, 12, 0.96, 0.78);
  if (speed <= 22) return scale(speed, 12, 22, 0.78, 0.46);
  if (speed <= 34) return scale(speed, 22, 34, 0.46, 0.2);
  return 0.12;
}

function tideScore(level, ideal, spread) {
  if (!Number.isFinite(level)) return 0.5;
  const diff = Math.abs(level - ideal);
  if (diff >= spread) return 0.24;
  return clamp(1 - (diff / spread) ** 1.4, 0.24, 1);
}

function coastalFitScore(beach, sample) {
  const profile = spotDataProfile(beach);
  const height = sample.swellHeight ?? sample.waveHeight;
  const period = sample.swellPeriod ?? sample.wavePeriod;
  const direction = sample.swellDirection ?? sample.waveDirection;
  const angleFit = directionWindowScore(direction, beach.swellCenter, beach.swellSpread);
  const energy = swellEnergy(height, period);
  const depthPower = Number.isFinite(profile.depthPower) ? profile.depthPower : 0.58;
  const shelter = Number.isFinite(profile.shelterIndex) ? profile.shelterIndex : 0.35;
  const confidence = Number.isFinite(profile.dataConfidence) ? profile.dataConfidence : 0.5;

  const depthFit = clamp(1 - Math.abs(energy - depthPower) * 0.95, 0.18, 1);
  const shelterFit =
    shelter >= 0.62
      ? clamp(angleFit * 0.62 + energy * 0.18 + (1 - shelter) * 0.2, 0.12, 1)
      : shelter <= 0.25
        ? clamp(angleFit * 0.45 + depthFit * 0.32 + (1 - Math.abs(energy - 0.58)) * 0.23, 0.12, 1)
        : clamp(angleFit * 0.48 + depthFit * 0.34 + (1 - shelter * 0.35) * 0.18, 0.12, 1);
  const raw = angleFit * 0.42 + depthFit * 0.34 + shelterFit * 0.24;
  const confidenceFloor = 0.44 + confidence * 0.18;

  return 100 * clamp(raw * confidence + confidenceFloor * (1 - confidence), 0.08, 1);
}

function swellEnergy(height, period) {
  if (!Number.isFinite(height) || !Number.isFinite(period)) return 0.45;
  return clamp((height * Math.max(period, 5)) / 21, 0, 1);
}

function tideTrendText(level, nextLevel) {
  if (!Number.isFinite(level) || !Number.isFinite(nextLevel)) return "Steady";
  const delta = nextLevel - level;
  if (Math.abs(delta) < 0.025) return "Steady";
  return delta > 0 ? "Rising" : "Dropping";
}

function tideQualityText(score) {
  if (score >= 0.82) return "Prime";
  if (score >= 0.58) return "Usable";
  if (score >= 0.35) return "Tricky";
  return "Poor";
}

function windQualityText(diff, speed) {
  const strength = speed >= 26 ? "strong" : speed >= 15 ? "moderate" : "light";
  if (diff <= 45) return `${strength} offshore`;
  if (diff <= 95) return `${strength} cross-offshore`;
  if (diff <= 135) return `${strength} cross-onshore`;
  return `${strength} onshore`;
}

function scoreLabel(score) {
  if (score >= 80) return "Excellent";
  if (score >= 66) return "Good";
  if (score >= 52) return "Workable";
  if (score >= 38) return "Marginal";
  return "Poor";
}

function pinClass(score) {
  if (!Number.isFinite(score)) return "pin-empty";
  if (score >= 80) return "pin-excellent";
  if (score >= 66) return "pin-good";
  if (score >= 52) return "pin-fair";
  if (score >= 38) return "pin-poor";
  return "pin-bad";
}

function selectedBeach() {
  return BEACHES.find((beach) => beach.id === state.selectedBeachId) ?? BEACHES[0];
}

function spotDataProfile(beach) {
  return (
    SPOT_DATA_PROFILES[beach.id] ?? {
      beachAxis: beach.exposure,
      depth: "Unknown nearshore profile",
      shelter: "Unknown shelter",
      depthPower: 0.58,
      shelterIndex: 0.35,
      dataConfidence: 0.45,
      localFeature: beach.whyNearby,
      forecastImpact: "Coastline and bathymetry data would improve this spot's local calibration.",
      dataNeeds: ["coastline", "bathymetry", "wavePartitions"],
    }
  );
}

function sourceByKey(key) {
  return DATA_SOURCES.find((source) => source.key === key) ?? null;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return NaN;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function valueAt(hourly, key, index) {
  const value = hourly?.[key]?.[index];
  return value === null || value === undefined ? null : Number(value);
}

function dateKey(offset) {
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
}

function formatDay(offset) {
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + offset);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(target);
}

function formatDayHour(offset, hour) {
  return `${formatDay(offset)} ${formatHour(hour)}`;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatClock(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatDegrees(value) {
  if (!Number.isFinite(value)) return "";
  return `${Math.round(value)}°`;
}

function degToCompass(degrees) {
  if (!Number.isFinite(degrees)) return "--";
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return directions[index];
}

function angularDiff(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 180;
  const diff = Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);
  return diff;
}

function scale(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const ratio = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * ratio;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateStatus(kind, text) {
  elements.statusPill.classList.remove("ready", "error");
  if (kind === "ready") elements.statusPill.classList.add("ready");
  if (kind === "error") elements.statusPill.classList.add("error");
  elements.statusText.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
