const TZ = "America/Sao_Paulo";
const SAO_PAULO_UTC_OFFSET_HOURS = 3; // UTC-3, no DST since 2019
const HOUR_MIN = 6;
const HOUR_MAX = 18;
const HOURS = Array.from({ length: HOUR_MAX - HOUR_MIN + 1 }, (_, index) => HOUR_MIN + index);
const RADAR_METADATA_URL = "https://api.rainviewer.com/public/weather-maps.json";
const RADAR_FRAME_TOLERANCE_MINUTES = 65;
const RADAR_NATIVE_MAX_ZOOM = 7;
const RADAR_OPACITY = 0.42;
// Relative influence of each dimension. The final score combines them
// multiplicatively (see scoreSample); these weights drive the explanatory layer
// (which factor most explains a difference, and the limiting/support factor).
const SCORE_WEIGHTS = {
  swell: 0.45,
  wind: 0.3,
  coastal: 0.1,
  tide: 0.08,
  weather: 0.07,
};

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
    beachAxis: "Open E-to-S beach",
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
    beachAxis: "Long south-facing shoreline",
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
    offshoreWind: 300,
    swellCenter: 128,
    swellSpread: 80,
    idealHeight: [0.7, 1.8],
    maxHeight: 2.8,
    idealTide: 0.4,
    tideSpread: 0.5,
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
    offshoreWind: 315,
    swellCenter: 148,
    swellSpread: 85,
    idealHeight: [0.8, 2.1],
    maxHeight: 3.2,
    idealTide: 0.4,
    tideSpread: 0.6,
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
    offshoreWind: 318,
    swellCenter: 174,
    swellSpread: 70,
    idealHeight: [0.8, 2.0],
    maxHeight: 2.9,
    idealTide: 0.5,
    tideSpread: 0.5,
    note: "Long south-facing beach",
    region: "South-east shore",
    exposure: "Open S/SSE",
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
    offshoreWind: 250,
    swellCenter: 75,
    swellSpread: 60,
    idealHeight: [0.5, 1.4],
    maxHeight: 1.9,
    idealTide: 0.5,
    tideSpread: 0.65,
    note: "Sheltered cove, works all tides",
    region: "East shore",
    exposure: "Filtered ENE/E",
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
    offshoreWind: 312,
    swellCenter: 118,
    swellSpread: 88,
    idealHeight: [0.7, 2.2],
    maxHeight: 3.2,
    idealTide: 0.5,
    tideSpread: 0.6,
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
    swellCenter: 118,
    swellSpread: 72,
    idealHeight: [0.7, 1.9],
    maxHeight: 2.8,
    idealTide: 0.4,
    tideSpread: 0.5,
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
    offshoreWind: 268,
    swellCenter: 88,
    swellSpread: 60,
    idealHeight: [0.6, 1.7],
    maxHeight: 2.5,
    idealTide: 0.4,
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
    offshoreWind: 220,
    swellCenter: 52,
    swellSpread: 62,
    idealHeight: [0.8, 1.7],
    minSurfHeight: 0.7,
    maxHeight: 2.2,
    idealTide: 0.5,
    tideSpread: 0.6,
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
    offshoreWind: 228,
    swellCenter: 125,
    swellSpread: 70,
    idealHeight: [0.6, 1.6],
    maxHeight: 2.4,
    idealTide: 0.35,
    tideSpread: 0.5,
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
    offshoreWind: 238,
    swellCenter: 130,
    swellSpread: 58,
    idealHeight: [0.6, 1.5],
    minSurfHeight: 0.65,
    maxHeight: 2.1,
    idealTide: 0.5,
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
    offshoreWind: 312,
    swellCenter: 135,
    swellSpread: 82,
    idealHeight: [0.8, 2.0],
    maxHeight: 3.0,
    idealTide: 0.5,
    tideSpread: 0.6,
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
  selectedBeachId: "ingleses",
  selectedDayOffset: 0,
  selectedHour: initialSelectedHour(),
  lang: "pt",
  forecasts: new Map(),
  map: null,
  markers: new Map(),
  loading: true,
  error: "",
  radar: {
    error: "",
    host: "",
    frames: [],
    selectedFrameIndex: -1,
    layer: null,
  },
};

// ---------------------------------------------------------------------------
// Internationalization (pt = default, en). state.lang selects the language.
// ---------------------------------------------------------------------------
const UI = {
  pt: {
    h1: "Como tá o surfe",
    loading: "Carregando previsão",
    updated: (time) => `Previsão atualizada às ${time}`,
    unavailable: "Previsão indisponível",
    partial: (n, m) => `${n}/${m} praias atualizadas`,
    regionalTemps: "Temperaturas",
    airWaterEmpty: "Ar -- · Água --",
    airWater: (air, water) => `${air}°C ar · ${water}°C água`,
    day: "Dia",
    hour: "Hora",
    hourAria: "Hora da previsão",
    controlsAria: "Controles da previsão",
    legendAria: "Legenda da pontuação",
    today: "Hoje",
    now: "Agora",
    daySummary: "Resumo do dia",
    bestBets: "Melhores opções",
    topPick: (label) => `Top do dia · ${label}`,
    selectedSpot: "Praia selecionada",
    swell: "Swell",
    wind: "Vento",
    tide: "Maré",
    weather: "Tempo",
    hourByHour: "Hora a hora",
    closestSpots: "Praias próximas",
    tapToCompare: "toque para comparar",
    away: "de distância",
    nearlyTied: "Quase empatadas",
    rain: "chuva",
    cloud: "nuvens",
    water: "água",
    air: "ar",
    gust: "rajada",
    noForecastHour: "Sem previsão para esta praia neste horário.",
    noForecastWindow: "Ainda sem previsão para este dia e horário.",
    errorState: "Previsão indisponível agora. Tente atualizar em um minuto.",
    loadingBeaches: "Carregando praias",
    loadingWindow: "Carregando o dia",
    footer:
      "Previsão do Open-Meteo · pontuação heurística — não substitui dar uma olhada no mar de verdade.",
  },
  en: {
    h1: "Surf check",
    loading: "Loading forecast",
    updated: (time) => `Live forecast updated ${time}`,
    unavailable: "Forecast unavailable",
    partial: (n, m) => `${n}/${m} beaches updated`,
    regionalTemps: "Regional temps",
    airWaterEmpty: "Air -- · Water --",
    airWater: (air, water) => `${air}°C air · ${water}°C water`,
    day: "Day",
    hour: "Hour",
    hourAria: "Forecast hour",
    controlsAria: "Forecast controls",
    legendAria: "Score legend",
    today: "Today",
    now: "Now",
    daySummary: "The day at a glance",
    bestBets: "Best bets",
    topPick: (label) => `Top pick · ${label}`,
    selectedSpot: "Selected spot",
    swell: "Swell",
    wind: "Wind",
    tide: "Tide",
    weather: "Weather",
    hourByHour: "Hour by hour",
    closestSpots: "Closest spots",
    tapToCompare: "tap to compare",
    away: "away",
    nearlyTied: "Nearly tied",
    rain: "rain",
    cloud: "cloud",
    water: "water",
    air: "air",
    gust: "gust",
    noForecastHour: "No forecast for this beach and hour.",
    noForecastWindow: "No forecast for this day and hour yet.",
    errorState: "Forecast data is unavailable right now. Try refreshing in a minute.",
    loadingBeaches: "Loading beaches",
    loadingWindow: "Loading day window",
    footer:
      "Forecast from Open-Meteo · heuristic scoring, not a substitute for a real look at the beach.",
  },
};

const COMPASS = {
  en: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
  pt: ["N", "NNE", "NE", "LNE", "L", "LSE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"],
};

// Portuguese translations for the displayed beach prose. English stays in BEACHES.
const BEACH_PT = {
  "praia-mole": {
    breakType: "Beachbreak de areia íngreme",
    traits: ["Pega swell rápido", "Sensível ao vento", "Pode ficar forte"],
    whyNearby:
      "Mole e Joaquina são pertinho, mas a Mole é mais curta e íngreme, com pontas de pedra, então pequenas mudanças de tamanho, vento ou banco aparecem mais rápido aqui.",
  },
  joaquina: {
    breakType: "Beachbreak de bancos de areia",
    traits: ["Segura mais tamanho", "Depende do banco", "Praia de campeonato"],
    whyNearby:
      "Joaquina e Campeche dividem a mesma costa aberta, mas o pico principal da Joaquina tem bancos e influência de ponta diferentes, então o mesmo swell pode chegar mais focado aqui.",
  },
  campeche: {
    breakType: "Beachbreak longo de bancos",
    traits: ["Praia longa", "Picos que mudam", "Pode dar parede"],
    whyNearby:
      "Campeche é quase contínua com a Joaquina, mas a praia mais longa, os bancos diferentes e a exposição voltada à ilha fazem as linhas de swell quebrarem de jeitos diferentes.",
  },
  "barra-da-lagoa": {
    breakType: "Beachbreak de enseada e canal",
    traits: ["Mais tranquila", "Swell filtrado", "Boa alternativa"],
    whyNearby:
      "A Barra fica junto ao canal da lagoa e se esconde atrás do formato da costa, então praias abertas próximas podem estar maiores enquanto a Barra fica menor e mais limpa.",
  },
  mocambique: {
    breakType: "Beachbreak longo e aberto",
    traits: ["Muito exposta", "Vários picos", "Crua com vento"],
    whyNearby:
      "Moçambique se conecta à Barra, mas é bem menos abrigada, então o mesmo swell pode chegar maior e mais bagunçado aqui, enquanto a Barra fica mais tranquila.",
  },
  santinho: {
    breakType: "Beachbreak de enseada",
    traits: ["Sensível ao ângulo", "Picos definidos", "Exposição nordeste"],
    whyNearby:
      "O Santinho fica ao lado dos Ingleses, mas seu ângulo é mais exposto a swells de leste e menos protegido pelo formato da baía ao norte.",
  },
  brava: {
    breakType: "Beachbreak entre falésias",
    traits: ["Ímã de swell leste", "Picos com força", "Entre falésias"],
    whyNearby:
      "A Brava fica perto dos Ingleses, mas seu ângulo entre falésias encara o swell de frente, então pode ter mais força quando os Ingleses parecem menores.",
  },
  ingleses: {
    breakType: "Beachbreak largo",
    traits: ["Opção mais suave", "Baía aberta", "Menos força"],
    whyNearby:
      "Os Ingleses ficam entre a Brava e o Santinho, mas têm uma baía mais larga e protegida, então praias próximas podem mostrar mais tamanho e força.",
  },
  matadeiro: {
    breakType: "Beachbreak de enseada",
    traits: ["Mais exposta que a Armação", "Boa forma com swell SE", "Acesso a pé"],
    whyNearby:
      "O Matadeiro fica ao lado da Armação, mas o rio e o formato de enseada o expõem a mais energia do mar, então pode estar surfável enquanto a Armação está pequena.",
  },
  armacao: {
    breakType: "Beachbreak protegido",
    traits: ["Protegida", "Precisa de mais swell", "Alternativa suave"],
    whyNearby:
      "A Armação fica ao lado do Matadeiro, mas num canto mais protegido, então o mesmo swell pode perder tamanho e força antes de chegar à praia.",
  },
  "lagoinha-do-leste": {
    breakType: "Beachbreak remoto",
    traits: ["Remota", "Muito exposta", "Alto potencial"],
    whyNearby:
      "A Lagoinha do Leste fica mais no canto sudeste, então as falésias e a exposição aberta podem deixá-la maior ou mais afetada pelo vento do que o Matadeiro ou a Armação.",
  },
};

// Portuguese for the spot-profile phrases that surface in reasons / contrast text.
const PROFILE_PT = {
  "praia-mole": { depth: "Rampa curta e íngreme perto da praia", shelter: "Pouco abrigo", beachAxis: "Enseada L/LSE" },
  joaquina: { depth: "Bancos de moderados a íngremes", shelter: "Pouco abrigo", beachAxis: "Praia aberta de L a S" },
  campeche: { depth: "Bancos largos e instáveis", shelter: "Influência parcial da ilha", beachAxis: "Litoral longo voltado ao sul" },
  "barra-da-lagoa": { depth: "Areia influenciada pelo canal", shelter: "Abrigo médio a alto", beachAxis: "Enseada filtrada LNE/L" },
  mocambique: { depth: "Plataforma de areia longa e exposta", shelter: "Pouco abrigo", beachAxis: "Costa muito aberta LNE/L" },
  santinho: { depth: "Enseada com efeito das pontas", shelter: "Abrigo moderado nas pontas", beachAxis: "Enseada LNE/L" },
  brava: { depth: "Zona curta e com força perto da praia", shelter: "Pouco abrigo", beachAxis: "Entre falésias NE/L" },
  ingleses: { depth: "Bancos de areia mais suaves de baía", shelter: "Abrigo médio", beachAxis: "Baía ampla ao norte" },
  matadeiro: { depth: "Areia de enseada e foz de rio", shelter: "Abrigo moderado", beachAxis: "Enseada SE/SSE" },
  armacao: { depth: "Areia protegida e mais suave", shelter: "Bastante abrigo", beachAxis: "Canto sul protegido" },
  "lagoinha-do-leste": { depth: "Beachbreak remoto e exposto", shelter: "Pouco abrigo", beachAxis: "Enseada muito aberta SE/LSE" },
};

function localeTag() {
  return state.lang === "pt" ? "pt-BR" : "en-US";
}

function t(key, ...args) {
  const dict = UI[state.lang] ?? UI.pt;
  const value = dict[key] ?? UI.pt[key] ?? key;
  return typeof value === "function" ? value(...args) : value;
}

// Beach prose with PT override, English fallback from the BEACHES record.
function tBeach(beach, field) {
  if (state.lang === "pt") {
    const pt = BEACH_PT[beach.id];
    if (pt && pt[field] != null) return pt[field];
  }
  return beach[field];
}

// Spot-profile prose (depth / shelter / beachAxis) with PT override.
function tProfile(beach, field) {
  if (state.lang === "pt") {
    const pt = PROFILE_PT[beach.id];
    if (pt && pt[field] != null) return pt[field];
  }
  return spotDataProfile(beach)[field];
}

function setLang(lang) {
  if (lang !== "pt" && lang !== "en") return;
  state.lang = lang;
  try {
    window.localStorage.setItem("surf-lang", lang);
  } catch (error) {
    /* ignore storage failures */
  }
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
  syncStaticChrome();
  render();
}

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  elements.statusPill = document.querySelector("#statusPill");
  elements.statusText = document.querySelector("#statusText");
  elements.tempStrip = document.querySelector("#tempStrip");
  elements.dayControls = document.querySelector("#dayControls");
  elements.hourControls = document.querySelector("#hourControls");
  elements.selectedSummary = document.querySelector("#selectedSummary");
  elements.metricGrid = document.querySelector("#metricGrid");
  elements.rankedList = document.querySelector("#rankedList");
  elements.dayOverview = document.querySelector("#dayOverview");
  elements.timelinePanel = document.querySelector("#timelinePanel");
  elements.map = document.querySelector("#map");
  elements.fallbackMap = document.querySelector("#fallbackMap");
  elements.langToggle = document.querySelector("#langToggle");

  let stored = null;
  try {
    stored = window.localStorage.getItem("surf-lang");
  } catch (error) {
    /* ignore storage failures */
  }
  if (stored === "pt" || stored === "en") state.lang = stored;
  document.documentElement.lang = state.lang === "pt" ? "pt-BR" : "en";

  if (elements.langToggle) {
    elements.langToggle.querySelectorAll("button[data-lang]").forEach((button) => {
      button.addEventListener("click", () => setLang(button.dataset.lang));
    });
  }

  syncStaticChrome();
  renderControls();
  initializeMap();
  renderLoading();
  loadForecasts();
});

// Updates the static page chrome (title, headings, control labels, footer,
// language toggle state) that lives outside the data-driven render() pass.
function syncStaticChrome() {
  const h1 = document.querySelector(".brand h1");
  if (h1) h1.textContent = t("h1");

  const labels = document.querySelectorAll(".control-label");
  if (labels[0]) labels[0].textContent = t("day");
  if (labels[1]) labels[1].textContent = t("hour");

  const footer = document.querySelector(".app-footer span");
  if (footer) footer.textContent = t("footer");

  const controlStrip = document.querySelector(".control-strip");
  if (controlStrip) controlStrip.setAttribute("aria-label", t("controlsAria"));
  const legend = document.querySelector(".map-legend");
  if (legend) legend.setAttribute("aria-label", t("legendAria"));

  renderLegend();
  updateStatusBar();

  if (elements.langToggle) {
    elements.langToggle.querySelectorAll("button[data-lang]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.lang === state.lang);
    });
  }
}

function renderControls() {
  const days = [
    { label: t("today"), offset: 0 },
    { label: formatWeekday(1), offset: 1 },
    { label: formatWeekday(2), offset: 2 },
    { label: formatWeekday(3), offset: 3 },
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

  const nowHour = initialSelectedHour();
  const isNow = state.selectedDayOffset === 0 && state.selectedHour === nowHour;
  elements.hourControls.innerHTML = `
    <div class="hour-slider-shell">
      <div class="hour-slider-top">
        <output>${escapeHtml(formatHour(state.selectedHour))}</output>
        <button type="button" class="now-chip" data-now aria-pressed="${isNow}">${escapeHtml(t("now"))}</button>
      </div>
      <input
        type="range"
        min="${HOUR_MIN}"
        max="${HOUR_MAX}"
        step="1"
        value="${state.selectedHour}"
        aria-label="${escapeHtml(t("hourAria"))}"
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
  const output = elements.hourControls.querySelector(".hour-slider-top output");
  slider.addEventListener("input", () => {
    state.selectedHour = Number(slider.value);
    if (output) output.textContent = formatHour(state.selectedHour); // instant readout
    renderData(); // skip renderControls so the slider survives the drag
  });

  const nowButton = elements.hourControls.querySelector("[data-now]");
  if (nowButton) {
    nowButton.addEventListener("click", () => {
      state.selectedDayOffset = 0;
      state.selectedHour = initialSelectedHour();
      render();
    });
  }
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

  loadRadarFrames();
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

async function loadRadarFrames() {
  if (!state.map) return;

  state.radar.error = "";

  try {
    const metadata = await fetchJson(new URL(RADAR_METADATA_URL));
    const { host, frames } = normalizeRadarFrames(metadata);
    if (!host || !frames.length) {
      throw new Error("Radar frames unavailable");
    }

    state.radar.host = host;
    state.radar.frames = frames;
    syncRadarToSelection();
    state.radar.error = "";
  } catch (error) {
    console.warn("RainViewer radar unavailable", error);
    state.radar.host = "";
    state.radar.frames = [];
    state.radar.selectedFrameIndex = -1;
    state.radar.error = "unavailable";
    removeRadarLayer();
  } finally {
    updateRadarLayer();
  }
}

function normalizeRadarFrames(metadata) {
  const host = typeof metadata?.host === "string" ? metadata.host : "";
  const past = Array.isArray(metadata?.radar?.past) ? metadata.radar.past : [];
  const nowcast = Array.isArray(metadata?.radar?.nowcast) ? metadata.radar.nowcast : [];
  const frames = [...past, ...nowcast]
    .map((frame) => ({
      time: Number(frame?.time),
      path: typeof frame?.path === "string" ? frame.path : "",
    }))
    .filter((frame) => Number.isFinite(frame.time) && frame.path)
    .sort((a, b) => a.time - b.time);

  return { host, frames };
}

function selectedRadarFrame() {
  return state.radar.frames[state.radar.selectedFrameIndex] ?? null;
}

function syncRadarToSelection() {
  state.radar.selectedFrameIndex = findClosestRadarFrameIndex(
    state.radar.frames,
    selectedForecastTimestampSeconds(),
    RADAR_FRAME_TOLERANCE_MINUTES,
  );
}

function findClosestRadarFrameIndex(frames, targetTimestampSeconds, toleranceMinutes) {
  if (!Array.isArray(frames) || !frames.length || !Number.isFinite(targetTimestampSeconds)) {
    return -1;
  }

  let bestIndex = -1;
  let bestDiff = Infinity;
  frames.forEach((frame, index) => {
    const diff = Math.abs(frame.time - targetTimestampSeconds);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });

  return bestDiff <= toleranceMinutes * 60 ? bestIndex : -1;
}

function buildRadarTileUrl(host, frame) {
  if (!host || !frame?.path) return "";
  return `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}

function updateRadarLayer() {
  if (!state.map) return;
  const frame = selectedRadarFrame();
  const url = buildRadarTileUrl(state.radar.host, frame);

  if (!url || state.radar.error) {
    removeRadarLayer();
    return;
  }

  if (state.radar.layer?.setUrl) {
    state.radar.layer.setUrl(url);
    return;
  }

  state.radar.layer = L.tileLayer(url, {
    attribution: "Radar &copy; RainViewer",
    maxNativeZoom: RADAR_NATIVE_MAX_ZOOM,
    opacity: RADAR_OPACITY,
    zIndex: 350,
  }).addTo(state.map);
}

function removeRadarLayer() {
  if (!state.radar.layer) return;
  if (state.map?.removeLayer) {
    state.map.removeLayer(state.radar.layer);
  }
  state.radar.layer = null;
}

async function loadForecasts() {
  updateStatus("loading", t("loading"));
  state.loading = true;
  state.error = "";

  const results = await Promise.allSettled(BEACHES.map(fetchBeachForecast));
  const fulfilled = results.filter((result) => result.status === "fulfilled");

  state.forecasts.clear();
  scoredSampleCache.clear();
  for (const result of fulfilled) {
    state.forecasts.set(result.value.beachId, result.value);
  }

  state.loading = false;
  state.lastUpdated = fulfilled.length ? new Date() : null;
  state.loadedCount = fulfilled.length;
  updateStatusBar();
  render();
}

// Renders the live-status pill in the current language (re-callable on toggle).
function updateStatusBar() {
  if (state.loading) {
    updateStatus("loading", t("loading"));
    return;
  }
  if (!state.loadedCount) {
    state.error = "unavailable";
    updateStatus("error", t("unavailable"));
  } else if (state.loadedCount < BEACHES.length) {
    updateStatus("error", t("partial", state.loadedCount, BEACHES.length));
  } else {
    updateStatus("ready", t("updated", formatClock(state.lastUpdated)));
  }
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
      "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_level_height_msl,sea_surface_temperature",
    timezone: TZ,
    forecast_days: "4",
    cell_selection: "sea",
  });

  const [weather, marine] = await Promise.all([
    fetchJson(weatherUrl),
    fetchJson(marineUrl),
  ]);
  const weatherHourly = requireHourlyPayload(weather, "Weather", beach);
  const marineHourly = requireHourlyPayload(marine, "Marine", beach);

  return {
    beachId: beach.id,
    weather: weatherHourly,
    marine: marineHourly,
  };
}

function requireHourlyPayload(payload, sourceName, beach) {
  const hourly = payload?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
    throw new Error(`${sourceName} forecast missing hourly time series for ${beach.name}`);
  }
  return hourly;
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
      if (attempt < 2) await delay(300 + attempt * 500); // no dead backoff after the last try
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
  renderData();
}

// Everything that reacts to the selected day/hour/beach, WITHOUT rebuilding the
// controls — so dragging the hour slider stays smooth (the slider element is not
// torn down mid-drag). Scoring is memoized, so this stays cheap to call live.
function renderData() {
  const view = getForecastView();

  const dashboard = document.querySelector(".dashboard");
  if (dashboard) dashboard.setAttribute("aria-busy", String(Boolean(state.loading)));

  renderTemperatureStrip(view);
  syncRadarToSelection();
  updateRadarLayer();

  if (state.loading) {
    renderLoading();
    return;
  }

  if (state.error && state.forecasts.size === 0) {
    renderError();
    updateMarkers();
    return;
  }

  updateMarkers(view);
  renderDayOverview();
  renderRankedList(view);
  renderSelectedSummary(view);
  renderTimeline(view);
}

function renderLoading() {
  elements.rankedList.innerHTML = `<div class="empty-state">${escapeHtml(t("loadingBeaches"))}</div>`;
  elements.selectedSummary.innerHTML = `<div class="empty-state">${escapeHtml(t("loading"))}</div>`;
  elements.metricGrid.innerHTML = "";
  elements.timelinePanel.innerHTML = `<div class="empty-state">${escapeHtml(t("loadingWindow"))}</div>`;
}

function renderError() {
  elements.rankedList.innerHTML = `<div class="empty-state" role="alert">${escapeHtml(t("errorState"))}</div>`;
  elements.selectedSummary.innerHTML = "";
  elements.metricGrid.innerHTML = "";
  elements.timelinePanel.innerHTML = "";
}

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

function renderTemperatureStrip(view = getForecastView()) {
  const samples = view.scoredBeaches.map((entry) => entry.scored);
  const air = average(samples.map((item) => item.sample.temperature));
  const water = average(samples.map((item) => item.sample.seaTemperature));
  const label = samples.length
    ? t("airWater", formatNumber(air, 0), formatNumber(water, 0))
    : t("airWaterEmpty");

  elements.tempStrip.innerHTML = `
    <span>${escapeHtml(formatDayHour(view.dayOffset, view.hour))}</span>
    <strong>${escapeHtml(label)}</strong>
  `;
}

function updateMarkers(view = getForecastView()) {
  for (const beach of BEACHES) {
    const marker = state.markers.get(beach.id);
    const scored = view.scoredByBeachId.get(beach.id);
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

function renderSelectedSummary(view = getForecastView()) {
  const beach = view.selectedBeach;
  const scored = view.selectedScored;

  if (!scored) {
    elements.selectedSummary.innerHTML = `<div class="empty-state">${escapeHtml(t("noForecastHour"))}</div>`;
    elements.metricGrid.innerHTML = "";
    return;
  }

  const score = scored.score;
  const badgeClass = pinClass(score.score);
  elements.selectedSummary.innerHTML = `
    <span class="panel-eyebrow">${escapeHtml(t("selectedSpot"))}</span>
    <div class="summary-top">
      <div>
        <h2 class="beach-name">${escapeHtml(beach.name)}</h2>
        <p class="beach-meta">${escapeHtml(formatDayHour(view.dayOffset, view.hour))} · ${escapeHtml(tBeach(beach, "breakType"))}</p>
      </div>
      <div class="score-badge ${badgeClass}">
        <span class="score-number">${score.score}</span>
        <span class="score-label">${escapeHtml(score.label)}</span>
      </div>
    </div>
    <p class="spot-read">${escapeHtml(buildSpotRead(scored))}</p>
    <div class="trait-list">
      ${tBeach(beach, "traits").map((trait) => `<span>${escapeHtml(trait)}</span>`).join("")}
    </div>
    <ul class="reason-list">
      ${score.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
    </ul>
  `;

  renderMetrics(scored);
}

function renderMetrics(scored) {
  const { sample, score } = scored;
  const beach = scored.beach;
  const swellRead = describeSwell(beach, sample);
  const windRead = describeWind(beach, sample);
  const tideRead = describeTide(beach, sample, score);
  const weatherRead = describeWeather(sample);
  const metrics = [
    {
      icon: "waves",
      label: t("swell"),
      value: `${formatNumber(effHeight(sample), 1)} m · ${formatNumber(effPeriod(sample), 1)} s`,
      sub: `${degToCompass(effDir(sample))} ${formatDegrees(effDir(sample))}`,
      detail: swellRead.detail,
      tone: partTone(score.parts.swell),
    },
    {
      icon: "air",
      label: t("wind"),
      value: `${degToCompass(sample.windDirection)} ${formatNumber(sample.windSpeed, 0)} km/h`,
      sub: `${score.windQuality} · ${t("gust")} ${formatNumber(sample.windGusts, 0)} km/h`,
      detail: windRead.detail,
      tone: partTone(score.parts.wind),
    },
    {
      icon: "water",
      label: t("tide"),
      value: `${formatSigned(sample.seaLevel)} m`,
      sub: `${score.tideTrend} · ${score.tideQuality}`,
      detail: tideRead.detail,
      tone: partTone(score.parts.tide),
    },
    {
      icon: "wb_sunny",
      label: t("weather"),
      value: `${formatNumber(sample.temperature, 0)}°C · ${formatNumber(sample.precipitationProbability, 0)}% ${t("rain")}`,
      sub: `${formatNumber(sample.cloudCover, 0)}% ${t("cloud")} · ${formatNumber(sample.seaTemperature, 0)}°C ${t("water")}`,
      detail: weatherRead.detail,
      tone: partTone(score.parts.weather),
    },
  ];

  elements.metricGrid.innerHTML = metrics
    .map(
      (metric) => `
        <div class="metric metric-${escapeHtml(metric.tone)}">
          <span class="metric-label"><span class="material-symbols-rounded" aria-hidden="true">${escapeHtml(metric.icon)}</span>${escapeHtml(metric.label)}</span>
          <span class="metric-value">${escapeHtml(metric.value)}</span>
          <span class="metric-sub">${escapeHtml(metric.sub)}</span>
          <span class="metric-detail">${escapeHtml(metric.detail)}</span>
        </div>
      `,
    )
    .join("");
}

function renderRankedList(view = getForecastView()) {
  const scoredBeaches = view.rankedBeaches;

  if (!scoredBeaches.length) {
    elements.rankedList.innerHTML = `<div class="empty-state">${escapeHtml(t("noForecastWindow"))}</div>`;
    return;
  }

  const title = formatDayHour(view.dayOffset, view.hour);
  const [top, ...rest] = scoredBeaches;

  elements.rankedList.innerHTML = `
    <div class="section-head">
      <h2><span class="head-icon material-symbols-rounded" aria-hidden="true">surfing</span>${escapeHtml(t("bestBets"))}</h2>
      <span>${escapeHtml(title)}</span>
    </div>
    ${renderTopBet(top)}
    <div class="beach-list">
      ${rest.map(renderBeachRow).join("")}
    </div>
  `;

  elements.rankedList.querySelectorAll("[data-beach-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedBeachId = row.dataset.beachId;
      render();
    });
  });
}

function renderTopBet({ beach, scored }) {
  const sample = scored.sample;
  const score = scored.score.score;
  const tier = pinClass(score).replace("pin-", "");
  return `
    <button class="bet-hero tier-${tier}" type="button" aria-current="${beach.id === state.selectedBeachId}" data-beach-id="${beach.id}">
      <span class="bet-hero-score ${pinClass(score)}">${score}</span>
      <span class="bet-hero-body">
        <span class="bet-hero-tag">${escapeHtml(t("topPick", scored.score.label))}</span>
        <span class="bet-hero-name">${escapeHtml(beach.name)}</span>
        <span class="bet-hero-read">${escapeHtml(compactSessionRead(scored))}</span>
        <span class="bet-hero-stats">
          <span class="stat"><span class="material-symbols-rounded" aria-hidden="true">waves</span><span class="mono">${formatSwellStat(sample)}</span></span>
          <span class="stat"><span class="material-symbols-rounded" aria-hidden="true">air</span><span class="mono">${degToCompass(sample.windDirection)} ${formatNumber(sample.windSpeed, 0)} km/h</span></span>
        </span>
      </span>
    </button>
  `;
}

function renderBeachRow({ beach, scored }) {
  const sample = scored.sample;
  const score = scored.score.score;
  return `
    <button class="beach-row" type="button" aria-current="${beach.id === state.selectedBeachId}" data-beach-id="${beach.id}">
      <span class="row-score ${pinClass(score)}">${score}</span>
      <span class="row-copy">
        <span class="row-name">${escapeHtml(beach.name)}</span>
        <span class="row-data mono">${formatSwellStat(sample)}</span>
      </span>
      <span class="row-wind mono">${degToCompass(sample.windDirection)} ${formatNumber(sample.windSpeed, 0)}<small> km/h</small></span>
    </button>
  `;
}

function renderTimeline(view = getForecastView()) {
  const beach = view.selectedBeach;
  const selectedScored = view.selectedScored;
  const bars = getScoredTimeline(beach, view.dayOffset);

  elements.timelinePanel.innerHTML = `
    <div class="section-head">
      <h2><span class="head-icon material-symbols-rounded" aria-hidden="true">schedule</span>${escapeHtml(t("hourByHour"))}</h2>
      <span>${escapeHtml(beach.name)} · ${escapeHtml(formatDay(view.dayOffset))}</span>
    </div>
    <div class="timeline">
      ${bars
        .map(({ hour, scored }) => {
          const score = scored.score.score;
          return `
            <button class="time-bar" type="button" aria-current="${hour === view.hour}" data-hour="${hour}" aria-label="${String(hour).padStart(2, "0")}:00 · ${score} ${escapeHtml(scored.score.label)}">
              <span class="bar-column">
                <span class="bar-fill ${pinClass(score)}" style="height: ${Math.max(12, score * 1.34)}px"></span>
              </span>
              <span class="time-score ${pinClass(score)}">${score}</span>
              <span class="time-label">${String(hour).padStart(2, "0")}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    ${selectedScored ? renderNearbyContrast(beach, selectedScored, view) : ""}
  `;

  elements.timelinePanel.querySelectorAll(".time-bar").forEach((bar) => {
    bar.addEventListener("click", () => {
      state.selectedHour = Number(bar.dataset.hour);
      render();
    });
  });

  elements.timelinePanel.querySelectorAll(".contrast-item[data-beach-id]").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedBeachId = item.dataset.beachId;
      render();
    });
  });
}

function buildSpotRead(scored) {
  const swell = describeSwell(scored.beach, scored.sample).short;
  const wind = describeWind(scored.beach, scored.sample).short;
  const coastal = describeCoastalFit(scored.beach, scored.sample, scored.score.parts.coastal).short;
  const tide = describeTide(scored.beach, scored.sample, scored.score).short;
  const score = scored.score.score;
  const pt = state.lang === "pt";

  if (score >= 80) {
    return pt
      ? `Pode ir: ${swell}. ${wind}. ${coastal}.`
      : `Strong call: ${swell}. ${wind}. ${coastal}.`;
  }
  if (score >= 66) {
    return pt
      ? `Vale conferir: ${swell}. ${wind}. ${coastal}.`
      : `Worth checking: ${swell}. ${wind}. ${coastal}.`;
  }
  if (score >= 52) {
    return pt
      ? `Dá pra surfar, mas seletivo: ${swell}. ${wind}. ${tide}.`
      : `Possible but selective: ${swell}. ${wind}. ${tide}.`;
  }
  return pt
    ? `Sessão provavelmente comprometida: ${swell}. ${wind}. ${tide}.`
    : `Probably a compromised session: ${swell}. ${wind}. ${tide}.`;
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
    return state.lang === "pt"
      ? `${scored.score.label}: ${reads[support.key]}. Fique de olho: ${limiting.label}.`
      : `${scored.score.label}: ${reads[support.key]}. Watch ${limiting.label}.`;
  }
  return `${scored.score.label}: ${reads[limiting.key]}.`;
}

// ---------------------------------------------------------------------------
// Day-at-a-glance overview. A plain-language, whole-region read of the selected
// day: overall size + cleanliness, the best time window, the top one or two
// beaches, and a single watch-out. Built entirely from the same scored samples
// that drive every other panel — no extra data, just zoomed all the way out.
// ---------------------------------------------------------------------------

// Every beach × every forecast hour for the day, scored. The raw material the
// day summary reasons over.
function getDayScan(dayOffset) {
  return BEACHES.flatMap((beach) =>
    getScoredTimeline(beach, dayOffset).map(({ hour, scored }) => ({
      beach,
      hour,
      scored,
    })),
  );
}

const DAY_PROSE = {
  en: {
    size: { flat: "pretty much flat", small: "small", fun: "fun-sized", solid: "solid", big: "big and powerful" },
    clean: { clean: "clean", mixed: "a touch textured", messy: "wind-blown" },
    window: { early: "early morning", morning: "mid-morning", midday: "around midday", afternoon: "the afternoon", late: "late afternoon" },
  },
  pt: {
    size: { flat: "praticamente flat", small: "pequeno", fun: "tamanho bom", solid: "bom tamanho", big: "grande e com força" },
    clean: { clean: "limpo", mixed: "com textura", messy: "ventado" },
    window: { early: "de manhã cedo", morning: "no meio da manhã", midday: "por volta do meio-dia", afternoon: "à tarde", late: "no fim da tarde" },
  },
};

function describeDay(dayOffset) {
  const scan = getDayScan(dayOffset);
  if (!scan.length) return null;

  const pt = state.lang === "pt";
  const f = DAY_PROSE[pt ? "pt" : "en"];
  const entriesByHour = groupScoredEntries(scan, (entry) => entry.hour);
  const entriesByBeach = groupScoredEntries(scan, (entry) => entry.beach.id);

  // Single best (beach, hour) of the day — drives the headline score.
  const best = bestScoredEntry(scan);
  const dayPeak = best.scored.score.score;

  // Best score per hour across all beaches → tells us when the day is good.
  const hourBest = HOURS.map((hour) => {
    const hourEntries = entriesByHour.get(hour) ?? [];
    return hourEntries.length ? { hour, score: bestScoredEntry(hourEntries).scored.score.score } : null;
  }).filter(Boolean);

  // Best score per beach across the day → which spots to call out.
  const beachPeak = BEACHES.map((beach) => {
    const beachEntries = entriesByBeach.get(beach.id) ?? [];
    return beachEntries.length ? { beach, score: bestScoredEntry(beachEntries).scored.score.score } : null;
  })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // --- Conditions: representative size + cleanliness at the day's best hour ---
  const peakHourEntries = scan.filter((e) => e.hour === best.hour);
  const repHeight = average(
    peakHourEntries.map((e) => effHeight(e.scored.sample)),
  );
  const windQuality = average(peakHourEntries.map((e) => e.scored.score.parts.wind));

  let sizeKey = "small";
  if (Number.isFinite(repHeight)) {
    if (repHeight < 0.6) sizeKey = "flat";
    else if (repHeight < 1.0) sizeKey = "small";
    else if (repHeight < 1.6) sizeKey = "fun";
    else if (repHeight < 2.2) sizeKey = "solid";
    else sizeKey = "big";
  }
  if (dayPeak < 30) sizeKey = "flat"; // nothing surfable anywhere → call it flat

  let cleanKey = "mixed";
  if (Number.isFinite(windQuality)) {
    cleanKey = windQuality >= 72 ? "clean" : windQuality >= 48 ? "mixed" : "messy";
  }

  // --- Timing: best window + morning vs afternoon trend ---
  const goodThreshold = Math.max(50, dayPeak - 10);
  const goodHours = hourBest.filter((h) => h.score >= goodThreshold).map((h) => h.hour);
  const windowHours = goodHours.length ? goodHours : [best.hour];
  const windowCenter = average(windowHours);

  let windowKey = "midday";
  if (windowCenter <= 9) windowKey = "early";
  else if (windowCenter <= 11.5) windowKey = "morning";
  else if (windowCenter <= 14) windowKey = "midday";
  else if (windowCenter <= 16) windowKey = "afternoon";
  else windowKey = "late";

  const allDay = windowHours.length >= Math.ceil(HOURS.length * 0.7);

  const mAvg = average(hourBest.filter((h) => h.hour <= 10).map((h) => h.score));
  const aAvg = average(hourBest.filter((h) => h.hour >= 14).map((h) => h.score));
  let trend = "steady";
  if (Number.isFinite(mAvg) && Number.isFinite(aAvg)) {
    if (mAvg - aAvg >= 10) trend = "fadesPM";
    else if (aAvg - mAvg >= 10) trend = "buildsPM";
  }

  // --- Watch-out: rain over the good window at the top beach ---
  const topId = beachPeak[0]?.beach.id;
  const rainMax = Math.max(
    0,
    ...scan
      .filter((e) => e.beach.id === topId && windowHours.includes(e.hour))
      .map((e) => e.scored.sample.precipitationProbability ?? 0),
  );

  // --- Assemble the sentences ---
  const sentences = [];

  // 1. Conditions
  if (sizeKey === "flat") {
    sentences.push(pt ? "Praticamente flat." : "Pretty much flat.");
  } else {
    sentences.push(`${capitalize(f.size[sizeKey])}, ${f.clean[cleanKey]}.`);
  }

  // 2. Timing / worth-it
  if (dayPeak < 45) {
    sentences.push(pt ? "Não vale muito a pena." : "Not really worth a session.");
  } else if (trend === "fadesPM") {
    sentences.push(pt ? "Melhor cedo, antes do vento entrar." : "Best early, before the wind comes up.");
  } else if (trend === "buildsPM") {
    sentences.push(pt ? "Melhora à tarde." : "It picks up through the afternoon.");
  } else if (allDay) {
    sentences.push(pt ? "Fica parecido o dia todo." : "Holds pretty steady all day.");
  } else {
    sentences.push(pt ? `Melhor ${f.window[windowKey]}.` : `Best ${f.window[windowKey]}.`);
  }

  // 3. Spots
  const top = beachPeak[0];
  const second = beachPeak[1];
  const useTwo = second && second.score >= 50 && second.score >= top.score - 7;
  if (top) {
    const name1 = top.beach.name;
    const name2 = useTwo ? second.beach.name : null;
    if (dayPeak >= 52) {
      sentences.push(
        name2
          ? pt
            ? `${name1} e ${name2} são as melhores opções.`
            : `${name1} and ${name2} are your best bets.`
          : pt
            ? `${name1} é a melhor opção.`
            : `${name1} is your best bet.`,
      );
    } else {
      sentences.push(pt ? `${name1} é a opção menos ruim.` : `${name1} is the least-bad call.`);
    }
  }

  // 4. Watch-out (rain only; wind is already implied by the timing line)
  if (rainMax >= 55) {
    sentences.push(
      pt
        ? `De olho na chuva — ${formatNumber(rainMax, 0)}% de chance.`
        : `Heads up — ${formatNumber(rainMax, 0)}% chance of rain.`,
    );
  }

  return {
    text: sentences.join(" "),
    eyebrow: `${t("daySummary")} · ${formatDay(dayOffset)}`,
    peakScore: dayPeak,
    peakLabel: best.scored.score.label,
  };
}

function renderDayOverview() {
  if (!elements.dayOverview) return;

  const day =
    state.loading || (state.error && state.forecasts.size === 0)
      ? null
      : describeDay(state.selectedDayOffset);

  if (!day) {
    elements.dayOverview.hidden = true;
    elements.dayOverview.innerHTML = "";
    return;
  }

  elements.dayOverview.hidden = false;
  elements.dayOverview.innerHTML = `
    <div class="day-overview-score ${pinClass(day.peakScore)}">
      <span class="day-overview-number">${day.peakScore}</span>
      <span class="day-overview-tier">${escapeHtml(day.peakLabel)}</span>
    </div>
    <div class="day-overview-body">
      <span class="panel-eyebrow"><span class="material-symbols-rounded" aria-hidden="true">today</span>${escapeHtml(day.eyebrow)}</span>
      <p class="day-overview-text">${escapeHtml(day.text)}</p>
    </div>
  `;
}

const SWELL_PROSE = {
  en: {
    height: {
      missing: "size data is missing",
      small: "small for this beach",
      under: "a little under this beach's preferred size",
      inRange: "inside this beach's preferred size",
      above: "above ideal but still within range",
      big: "bigger than this spot usually handles well",
    },
    period: {
      missing: "period unavailable",
      short: "short-period and less organized",
      mid: "organized enough for clean lines",
      long: "long-period with extra push and wrap",
    },
    dir: {
      missing: "direction unavailable",
      well: "well aimed at this beach",
      usable: "usable but not perfect for this beach",
      outside: "mostly outside this beach's best angle",
    },
  },
  pt: {
    height: {
      missing: "sem leitura de tamanho",
      small: "pequeno para esta praia",
      under: "um pouco abaixo do tamanho ideal daqui",
      inRange: "no tamanho ideal daqui",
      above: "acima do ideal, mas ainda na faixa",
      big: "maior do que esta praia costuma segurar bem",
    },
    period: {
      missing: "indisponível",
      short: "curto e menos organizado",
      mid: "bom o bastante para linhas limpas",
      long: "longo, com mais força e encaixe",
    },
    dir: {
      missing: "indisponível",
      well: "bem direcionado para esta praia",
      usable: "aproveitável, mas não perfeito para esta praia",
      outside: "fora do melhor ângulo desta praia",
    },
  },
};

function describeSwell(beach, sample) {
  const height = effHeight(sample);
  const period = effPeriod(sample);
  const direction = effDir(sample);
  const directionDiff = angularDiff(direction, beach.swellCenter);
  const f = SWELL_PROSE[state.lang] ?? SWELL_PROSE.pt;

  let heightKey = "missing";
  if (Number.isFinite(height)) {
    if (height < beach.idealHeight[0] * 0.65) heightKey = "small";
    else if (height < beach.idealHeight[0]) heightKey = "under";
    else if (height <= beach.idealHeight[1]) heightKey = "inRange";
    else if (height < beach.maxHeight) heightKey = "above";
    else heightKey = "big";
  }

  let periodKey = "missing";
  if (Number.isFinite(period)) {
    periodKey = period < 8 ? "short" : period <= 14 ? "mid" : "long";
  }

  let dirKey = "missing";
  if (Number.isFinite(direction)) {
    if (directionDiff <= beach.swellSpread * 0.35) dirKey = "well";
    else if (directionDiff <= beach.swellSpread * 0.75) dirKey = "usable";
    else dirKey = "outside";
  }

  const h = f.height[heightKey];
  const p = f.period[periodKey];
  const d = f.dir[dirKey];
  const window = compassWindow(beach.swellCenter, beach.swellSpread);

  return {
    short: `${h}; ${p}; ${d}`,
    detail:
      state.lang === "pt"
        ? `O swell está ${h}. O período está ${p}. A direção está ${d}, considerando a janela ideal de ${window}.`
        : `The swell is ${h}. The period is ${p}. The direction is ${d} against a ${window} target window.`,
  };
}

const WIND_PROSE = {
  en: {
    angle: {
      unclear: "wind angle is unclear",
      offshore: "offshore here, so it should groom the wave face",
      crossoff: "cross-offshore here, still generally helpful",
      crosson: "cross-onshore here, so expect some texture",
      onshore: "onshore here, so chop is the main concern",
    },
    speed: { unclear: "unclear", light: "light", moderate: "moderate", noticeable: "noticeable", strong: "strong" },
    gust: " Gusts run well above the base wind, so the surface may pulse.",
  },
  pt: {
    angle: {
      unclear: "ângulo do vento indefinido",
      offshore: "terral aqui, deve alisar a parede da onda",
      crossoff: "terral lateral aqui, ainda costuma ajudar",
      crosson: "maral lateral aqui, espere um pouco de textura",
      onshore: "maral aqui, então a bagunça é a preocupação",
    },
    speed: { unclear: "indefinido", light: "fraco", moderate: "moderado", noticeable: "perceptível", strong: "forte" },
    gust: " As rajadas estão bem acima do vento médio, então a superfície pode pulsar.",
  },
};

function describeWind(beach, sample) {
  const speed = sample.windSpeed;
  const gusts = sample.windGusts;
  const directionDiff = angularDiff(sample.windDirection, beach.offshoreWind);
  const f = WIND_PROSE[state.lang] ?? WIND_PROSE.pt;

  let angleKey = "unclear";
  if (Number.isFinite(sample.windDirection)) {
    if (directionDiff <= 45) angleKey = "offshore";
    else if (directionDiff <= 95) angleKey = "crossoff";
    else if (directionDiff <= 135) angleKey = "crosson";
    else angleKey = "onshore";
  }

  let speedKey = "unclear";
  if (Number.isFinite(speed)) {
    speedKey = speed <= 7 ? "light" : speed <= 15 ? "moderate" : speed <= 26 ? "noticeable" : "strong";
  }

  const angleText = f.angle[angleKey];
  const speedText = f.speed[speedKey];
  const gustText =
    Number.isFinite(gusts) && Number.isFinite(speed) && gusts - speed >= 12 ? f.gust : "";
  const compass = degToCompass(sample.windDirection);

  return {
    short: state.lang === "pt" ? `vento ${speedText}, ${angleText}` : `${speedText} ${angleText}`,
    detail:
      state.lang === "pt"
        ? `Vento de ${compass}, ${angleText}. O vento está ${speedText} para o surfe.${gustText}`
        : `${compass} wind is ${angleText}. The speed is ${speedText} for surfing.${gustText}`,
  };
}

function describeCoastalFit(beach, sample, coastalScore) {
  const profile = spotDataProfile(beach);
  const direction = effDir(sample);
  const angleFit = directionWindowScore(direction, beach.swellCenter, beach.swellSpread);
  const energy = sizeMagnitude(
    effectiveBreakingHeight(beach, effHeight(sample), effPeriod(sample)),
  );
  const pt = state.lang === "pt";

  let scoreKey = "uncertain";
  if (Number.isFinite(coastalScore)) {
    scoreKey = coastalScore >= 76 ? "supports" : coastalScore >= 52 ? "workable" : "filtering";
  }
  const scoreText = pt
    ? {
        uncertain: "encaixe da costa incerto",
        supports: "o formato da costa favorece a previsão",
        workable: "o formato da costa dá, mas é seletivo",
        filtering: "o formato da costa filtra ou distorce a previsão",
      }[scoreKey]
    : {
        uncertain: "coastal fit is uncertain",
        supports: "coastal shape supports the forecast",
        workable: "coastal shape is workable but selective",
        filtering: "coastal shape is filtering or distorting the forecast",
      }[scoreKey];

  const shelterKey =
    profile.shelterIndex >= 0.62 ? "sheltered" : profile.shelterIndex <= 0.25 ? "exposed" : "partial";
  const shelterText = pt
    ? {
        sheltered: "Esta praia é abrigada, então precisa de mais alinhamento ou energia.",
        exposed: "Esta praia é exposta, então swell cru e vento aparecem rápido.",
        partial: "Esta praia tem abrigo parcial, então um canto pode diferir do outro.",
      }[shelterKey]
    : {
        sheltered: "This beach is sheltered, so it needs better alignment or more energy.",
        exposed: "This beach is exposed, so raw swell and wind show up quickly.",
        partial: "This beach has partial shelter, so one corner can differ from another.",
      }[shelterKey];

  const energyWord = pt
    ? energy >= 0.68
      ? "alta"
      : energy >= 0.38
        ? "moderada"
        : "baixa"
    : energy >= 0.68
      ? "high"
      : energy >= 0.38
        ? "moderate"
        : "low";

  return {
    short: scoreText,
    detail: pt
      ? `${scoreText}. A energia está ${energyWord} e o encaixe de ângulo é ${Math.round(angleFit * 100)}%. ${shelterText}`
      : `${scoreText}. Energy is ${energyWord} and angle fit is ${Math.round(angleFit * 100)}%. ${shelterText}`,
  };
}

function tideStateWord(state01, pt) {
  if (!Number.isFinite(state01)) return pt ? "média" : "mid";
  if (state01 <= 0.34) return pt ? "baixa" : "low";
  if (state01 >= 0.66) return pt ? "cheia" : "high";
  return pt ? "média" : "mid";
}

function describeTide(beach, sample, score) {
  const pt = state.lang === "pt";
  const state01 = sample.tideState;
  const tideDiff = Number.isFinite(state01) ? Math.abs(state01 - beach.idealTide) : NaN;

  let fitKey = "unclear";
  if (Number.isFinite(tideDiff) && Number.isFinite(beach.tideSpread)) {
    if (tideDiff <= beach.tideSpread * 0.25) fitKey = "veryClose";
    else if (tideDiff <= beach.tideSpread * 0.55) fitKey = "close";
    else if (tideDiff <= beach.tideSpread) fitKey = "edge";
    else fitKey = "outside";
  }
  const fitText = pt
    ? {
        unclear: "encaixe de maré incerto",
        veryClose: "bem perto da maré ideal daqui",
        close: "perto o bastante da maré ideal daqui",
        edge: "no limite da maré ideal daqui",
        outside: "fora da maré ideal daqui",
      }[fitKey]
    : {
        unclear: "tide fit is unclear",
        veryClose: "very close to this beach's preferred tide",
        close: "close enough to this beach's preferred tide",
        edge: "on the edge of this beach's preferred tide",
        outside: "outside this beach's preferred tide",
      }[fitKey];

  const trend = score.tideTrend.toLowerCase();
  const nowWord = tideStateWord(state01, pt);
  const prefWord = tideStateWord(beach.idealTide, pt);

  return {
    short: pt ? `maré ${trend}, ${fitText}` : `${trend} tide is ${fitText}`,
    detail: pt
      ? `Esta praia costuma preferir maré ${prefWord}. Agora está ${nowWord} (${formatSigned(sample.seaLevel)} m), ${trend}, e ${fitText}.`
      : `This beach tends to prefer a ${prefWord} tide. Right now it is ${nowWord} (${formatSigned(sample.seaLevel)} m), ${trend}, and ${fitText}.`,
  };
}

function describeWeather(sample) {
  const rain = sample.precipitationProbability ?? 0;
  const cloud = sample.cloudCover ?? 0;
  const pt = state.lang === "pt";

  const rainText = pt
    ? rain >= 60
      ? "chuva provável"
      : rain >= 35
        ? "pancadas possíveis"
        : "chuva não é grande preocupação"
    : rain >= 60
      ? "rain is likely"
      : rain >= 35
        ? "showers are possible"
        : "rain is not a major concern";

  const cloudText = pt
    ? cloud >= 75
      ? "bastante nublado"
      : cloud >= 40
        ? "parcialmente nublado"
        : "bem claro"
    : cloud >= 75
      ? "mostly cloudy"
      : cloud >= 40
        ? "partly cloudy"
        : "bright enough";

  return {
    short: `${rainText}; ${cloudText}`,
    detail: pt
      ? `O tempo afeta mais o conforto, a visibilidade e a confiança no vento. Neste horário, ${rainText} e o céu está ${cloudText}.`
      : `Weather mostly changes comfort, visibility, and wind confidence. For this hour, ${rainText} and it looks ${cloudText}.`,
  };
}

function renderNearbyContrast(beach, selectedScored, view = getForecastView()) {
  const nearby = getNearbyScoredBeachEntries(beach, view.dayOffset, view.hour);

  if (!nearby.length) return "";

  return `
    <div class="nearby-contrast">
      <div class="section-head contrast-head">
        <h3><span class="head-icon material-symbols-rounded" aria-hidden="true">near_me</span>${escapeHtml(t("closestSpots"))}</h3>
        <span>${escapeHtml(t("tapToCompare"))}</span>
      </div>
      <div class="contrast-list">
        ${nearby
          .map(({ beach: otherBeach, distance, scored }) => {
            const delta = selectedScored.score.score - scored.score.score;
            const deltaText =
              Math.abs(delta) <= 2
                ? t("nearlyTied")
                : delta > 0
                  ? `${selectedScored.beach.name} +${Math.abs(delta)}`
                  : `${otherBeach.name} +${Math.abs(delta)}`;

            return `
              <button class="contrast-item" type="button" data-beach-id="${otherBeach.id}">
                <span class="contrast-score ${pinClass(scored.score.score)}">${scored.score.score}</span>
                <div class="contrast-copy">
                  <div>
                    <strong>${escapeHtml(otherBeach.name)}</strong>
                    <span>${escapeHtml(formatDistance(distance))} ${escapeHtml(t("away"))} · ${escapeHtml(deltaText)}</span>
                  </div>
                  <p>${escapeHtml(contrastReason(selectedScored, scored))}</p>
                </div>
              </button>
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
    return tBeach(selectedScored.beach, "whyNearby");
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
  return state.lang === "pt"
    ? "O tempo varia um pouco aqui, mas swell e vento ainda pesam mais que chuva ou nuvem."
    : "The weather grid is slightly different here, but swell and wind still matter more than rain or cloud.";
}

function swellContrastReason(selectedScored, otherScored) {
  const selectedDirection = effDir(selectedScored.sample);
  const otherDirection = effDir(otherScored.sample);
  const selectedDiff = angularDiff(selectedDirection, selectedScored.beach.swellCenter);
  const otherDiff = angularDiff(otherDirection, otherScored.beach.swellCenter);
  const pt = state.lang === "pt";

  if (Math.abs(selectedDiff - otherDiff) >= 10) {
    const better = selectedDiff < otherDiff ? selectedScored : otherScored;
    const worse = selectedDiff < otherDiff ? otherScored : selectedScored;
    const min = Math.round(Math.min(selectedDiff, otherDiff));
    const max = Math.round(Math.max(selectedDiff, otherDiff));
    return pt
      ? `O ângulo do swell encaixa melhor em ${better.beach.name}: cerca de ${min}° fora do alvo, contra ${max}° em ${worse.beach.name}.`
      : `Swell angle fits ${better.beach.name} better: about ${min}° off its target versus ${max}° at ${worse.beach.name}.`;
  }

  const selectedHeight = effHeight(selectedScored.sample);
  const otherHeight = effHeight(otherScored.sample);
  if (Number.isFinite(selectedHeight) && Number.isFinite(otherHeight) && Math.abs(selectedHeight - otherHeight) >= 0.15) {
    const bigger = selectedHeight > otherHeight ? selectedScored : otherScored;
    return pt
      ? `O modelo mostra mais swell chegando em ${bigger.beach.name}, o que acontece quando praias próximas pegam o mesmo swell em ângulos diferentes.`
      : `The marine grid shows more swell reaching ${bigger.beach.name}, which can happen when nearby beaches face the same swell at different angles.`;
  }

  return pt
    ? "A diferença principal é o encaixe do swell: cada praia tem direção preferida e exposição de banco diferentes."
    : "The main split is swell fit: each beach has a different preferred direction and sandbar exposure.";
}

function windContrastReason(selectedScored, otherScored) {
  const selectedDiff = angularDiff(selectedScored.sample.windDirection, selectedScored.beach.offshoreWind);
  const otherDiff = angularDiff(otherScored.sample.windDirection, otherScored.beach.offshoreWind);
  const better = selectedDiff < otherDiff ? selectedScored : otherScored;
  const worse = selectedDiff < otherDiff ? otherScored : selectedScored;
  const min = Math.round(Math.min(selectedDiff, otherDiff));
  const max = Math.round(Math.max(selectedDiff, otherDiff));

  return state.lang === "pt"
    ? `O vento está mais terral em ${better.beach.name}: cerca de ${min}° fora lá, contra ${max}° em ${worse.beach.name}.`
    : `Wind is closer to offshore at ${better.beach.name}; it is about ${min}° off there versus ${max}° at ${worse.beach.name}.`;
}

function coastalContrastReason(selectedScored, otherScored) {
  const selectedProfile = spotDataProfile(selectedScored.beach);
  const otherProfile = spotDataProfile(otherScored.beach);
  const better =
    selectedScored.score.parts.coastal >= otherScored.score.parts.coastal
      ? selectedScored
      : otherScored;
  const depth = tProfile(better.beach, "depth").toLowerCase();
  const shelter = tProfile(better.beach, "shelter").toLowerCase();
  const sameAxis = selectedProfile.beachAxis === otherProfile.beachAxis;

  return state.lang === "pt"
    ? `${better.beach.name} tem o melhor encaixe de costa aqui: ${depth}, ${shelter}, e seu ângulo segura este swell melhor que ${sameAxis ? "o perfil vizinho" : "o outro eixo de praia"}.`
    : `${better.beach.name} has the better coastal fit here: ${depth}, ${shelter}, and its angle handles this swell more cleanly than ${sameAxis ? "the nearby profile" : "the other beach axis"}.`;
}

function tideContrastReason(selectedScored, otherScored) {
  const selectedDiff = Math.abs((selectedScored.sample.tideState ?? 0.5) - selectedScored.beach.idealTide);
  const otherDiff = Math.abs((otherScored.sample.tideState ?? 0.5) - otherScored.beach.idealTide);
  const better = selectedDiff < otherDiff ? selectedScored : otherScored;

  return state.lang === "pt"
    ? `A maré está mais perto do alvo de ${better.beach.name}. Praias próximas podem preferir profundidades diferentes sobre seus bancos.`
    : `The tide is closer to ${better.beach.name}'s rough target. Nearby beaches can prefer different water depth over their sandbars.`;
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
  const labels =
    state.lang === "pt"
      ? { swell: "o swell", wind: "o vento", coastal: "o encaixe da costa", tide: "a maré", weather: "o tempo" }
      : { swell: "swell fit", wind: "wind", coastal: "coastal fit", tide: "tide", weather: "weather" };
  return [
    { key: "swell", label: labels.swell, value: parts.swell, weight: SCORE_WEIGHTS.swell },
    { key: "wind", label: labels.wind, value: parts.wind, weight: SCORE_WEIGHTS.wind },
    { key: "coastal", label: labels.coastal, value: parts.coastal, weight: SCORE_WEIGHTS.coastal },
    { key: "tide", label: labels.tide, value: parts.tide, weight: SCORE_WEIGHTS.tide },
    { key: "weather", label: labels.weather, value: parts.weather, weight: SCORE_WEIGHTS.weather },
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

// Scored samples are pure given (beach, day, hour, language) and the loaded
// forecast set, so memoize them: a single slider drag re-reads ~156 beach×hour
// cells per step, and describeDay/timeline re-score the same cells again.
const scoredSampleCache = new Map();

function getScoredSample(beach, dayOffset, hour) {
  const key = `${state.lang}:${beach.id}:${dayOffset}:${hour}`;
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
// residual, so the absolute metre value is not a reliable tide phase — but its
// position inside the surrounding ±18 h min/max window is.
function tideStateAt(marine, index) {
  const levels = marine?.sea_level_height_msl;
  if (!Array.isArray(levels)) return 0.5;
  const here = Number(levels[index]);
  if (!Number.isFinite(here)) return 0.5;

  const lo = Math.max(0, index - 18);
  const hi = Math.min(levels.length - 1, index + 18);
  let min = Infinity;
  let max = -Infinity;
  for (let i = lo; i <= hi; i += 1) {
    const value = Number(levels[i]);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || max - min < 0.1) return 0.5; // flat / no usable range
  return clamp((here - min) / (max - min), 0, 1);
}

// ---------------------------------------------------------------------------
// Scoring model — "clean-swell power, then degrade for wind", the shape real
// rating engines use (MSW / Surf-Forecast / Surfline LOLA). Each physical input
// enters the score exactly once:
//   size    -> shelter-attenuated breaking height, soft-knee saturated
//   period  -> periodCurve quality multiplier
//   chop    -> windsea-contamination cleanliness
//   angle   -> directionFit (swell vs the beach's window)
//   wind    -> windQualityFactor (multiplicative gate)
//   shelter -> attenuates the breaking height, so sheltered bays read smaller on
//              average (they are "too small" more often) yet survive as the
//              clean-up call on oversized days when open beaches close out.
// SIZE_REF is the main calibration knob: the breaking height (m) at which the
// size term reaches 0.5. Lower it for a friendlier scale, raise it for stricter.
// ---------------------------------------------------------------------------
const SIZE_REF = 0.9;
const DEFAULT_MIN_SURF_HEIGHT = 0.6;
const DEFAULT_FULL_SURF_HEIGHT = 0.95;
const SHELTER_ENERGY_LOSS = 0.4; // a fully sheltered bay sheds ~40% of the open-coast breaking height

function waveEnergy(height, period) {
  if (!Number.isFinite(height) || !Number.isFinite(period) || height <= 0 || period <= 0) {
    return 0;
  }
  return height * height * period;
}

// Deep-water swell shoals into a taller breaker the longer its period (energy
// focuses as the wave feels bottom). A gentle ±~10% across the realistic band.
function breakingHeight(height, period) {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const t = Number.isFinite(period) && period > 0 ? period : 9;
  return height * clamp((t / 11) ** 0.25, 0.82, 1.18);
}

function shelterAttenuation(beach) {
  const shelter = clamp(spotDataProfile(beach).shelterIndex ?? 0.35, 0, 1);
  return 1 - SHELTER_ENERGY_LOSS * shelter;
}

// Primary-swell value with a wind-wave fallback. The marine feed sometimes omits
// the partitioned swell columns, so the prose/score layers read the combined
// wave figures when the swell partition is missing.
function effHeight(sample) {
  return sample.swellHeight ?? sample.waveHeight;
}

function effPeriod(sample) {
  return sample.swellPeriod ?? sample.wavePeriod;
}

function effDir(sample) {
  return sample.swellDirection ?? sample.waveDirection;
}

// Compact "H m @ T s DIR" swell stat line shared by the top-bet hero and the
// beach-row list.
function formatSwellStat(sample) {
  return `${formatNumber(effHeight(sample), 1)} m @ ${formatNumber(effPeriod(sample), 1)} s ${degToCompass(effDir(sample))}`;
}

// Effective breaking height at the beach (after shelter loss). One size scale,
// reused by the score, the size-aware wind shield, and the prose layer.
function effectiveBreakingHeight(beach, height, period) {
  return breakingHeight(height, period) * shelterAttenuation(beach);
}

// Soft-knee size term (0..1): diminishing returns with no early saturation, so
// the whole 0.6-3.5 m breaking-height range stays separable.
function sizeMagnitude(hb) {
  if (!Number.isFinite(hb) || hb <= 0) return 0;
  return (hb * hb) / (hb * hb + SIZE_REF * SIZE_REF);
}

// Period-quality multiplier: windsea ~6 s heavily docked, solid groundswell
// 10-13 s nearly full, premium 14 s+ topped out. Smooth (no slope kinks).
function periodCurve(period) {
  if (!Number.isFinite(period)) return 0.35;
  if (period <= 6) return 0.4;
  if (period >= 16) return 1;
  if (period <= 13) {
    const x = (period - 6) / 7; // 0..1 across 6-13 s
    return 0.4 + 0.55 * (x * x * (3 - 2 * x)); // smoothstep 0.40 -> 0.95
  }
  return 0.95 + 0.05 * ((period - 13) / 3); // 0.95 -> 1.00 across 13-16 s
}

function surfableHeightFloor(beach) {
  return Number.isFinite(beach.minSurfHeight) ? beach.minSurfHeight : DEFAULT_MIN_SURF_HEIGHT;
}

function fullySurfableHeight(beach) {
  const floor = surfableHeightFloor(beach);
  if (Number.isFinite(beach.fullSurfHeight) && beach.fullSurfHeight > floor) {
    return beach.fullSurfHeight;
  }
  return Math.max(DEFAULT_FULL_SURF_HEIGHT, floor + 0.3);
}

// Surfable-floor gate (0..1), continuous at the floor (both branches meet at
// 0.9): well below the floor the spot is barely breaking; at/above it is ready.
function surfableHeightFactor(height, beach) {
  if (!Number.isFinite(height)) return 0.85;

  const floor = surfableHeightFloor(beach);
  if (height < floor) {
    const ratio = clamp(height / floor, 0, 1);
    return clamp(0.3 + 0.6 * ratio ** 1.3, 0.3, 0.9);
  }

  const full = fullySurfableHeight(beach);
  const ratio = clamp((height - floor) / (full - floor), 0, 1);
  return clamp(0.9 + 0.1 * ratio ** 0.75, 0.9, 1);
}

// Multiplicative wind gate (0..1). Glassy is good and clean light-offshore is
// ideal (and never scores below glassy); cross-shore adds chop; onshore degrades
// from the ~13 km/h whitecap threshold; bigger swell shrugs wind off; gusts and
// very strong wind from any quarter taper it toward zero. Continuous throughout.
function windQualityFactor(beach, sample, sizeMag = 0.5) {
  const speed = sample.windSpeed;
  const gusts = sample.windGusts;
  if (!Number.isFinite(speed) || speed <= 0) return 0.9;

  const off = angularDiff(sample.windDirection, beach.offshoreWind); // 0 offshore .. 180 onshore
  const rad = (off * Math.PI) / 180;
  const dirComp = Math.cos(rad); // +1 offshore .. -1 onshore
  const crossComp = Math.abs(Math.sin(rad)); // 0 aligned .. 1 dead cross
  const sizeShield = clamp(1 - 0.4 * sizeMag, 0.6, 1); // bigger swell resists wind
  const dirWeight = smoothstep(speed, 0, 6); // wind angle barely matters when near-calm

  let factor;
  if (dirComp >= 0) {
    // Offshore-ish: base 0.9, building to 1.0 with clean light offshore.
    factor = 0.9 + 0.1 * dirComp * smoothstep(speed, 0, 10);
    factor -= dirWeight * dirComp * clamp((speed - 32) / 60, 0, 0.28); // strong offshore over-holds faces
  } else {
    const onshore = -dirComp; // 0..1
    const severity = clamp((speed - 11) / 24, 0, 1) ** 1.3; // whitecaps ~13+, blown by ~35
    factor = 1 - dirWeight * onshore * (0.28 + 0.72 * severity) * sizeShield;
  }

  // Cross-shore chop bites even when nominally offshore.
  factor -= crossComp * clamp((speed - 13) / 32, 0, 1) * 0.32 * sizeShield;

  const gustSpread = Math.max(0, (Number.isFinite(gusts) ? gusts : speed) - speed);
  factor *= clamp(1 - gustSpread / 45, 0.4, 1);
  factor *= clamp(1 - Math.max(0, speed - 35) / 45, 0.06, 1); // strong wind, any direction

  return clamp(factor, 0.03, 1);
}

function scoreSample(beach, sample, dayOffset) {
  const swellHeight = effHeight(sample) ?? 0;
  const swellPeriod = effPeriod(sample) ?? 0;
  const swellDirection = effDir(sample);
  const rain = sample.precipitationProbability ?? 0;
  const cloud = sample.cloudCover ?? 0;

  // Clean-swell energy = primary + the secondary swell weighted by its OWN period
  // and direction quality (a long-period in-window secondary is real rideable
  // energy; a short off-window one is just chop). Wind-wave = contamination.
  const ePrimary = waveEnergy(swellHeight, swellPeriod);
  const eSecondaryRaw = waveEnergy(sample.secondarySwellHeight, sample.secondarySwellPeriod);
  const secondaryWeight = clamp(
    periodCurve(sample.secondarySwellPeriod) *
      directionWindowScore(sample.secondarySwellDirection, beach.swellCenter, beach.swellSpread),
    0.15,
    0.85,
  );
  const eSecondary = secondaryWeight * eSecondaryRaw;
  const eWind = waveEnergy(sample.windWaveHeight, sample.windWavePeriod);
  const eSwell = ePrimary + eSecondary;

  // Size from the shelter-attenuated breaking height (one size scale everywhere).
  const hb = effectiveBreakingHeight(beach, swellHeight, swellPeriod);
  const sizeMag = sizeMagnitude(hb);
  const periodFit = periodCurve(swellPeriod);
  const sizeReadiness = surfableHeightFactor(swellHeight, beach);

  // Chop = windsea share of (windsea + clean swell), on a shared energy basis.
  const windseaFrac = eWind + eSwell > 0 ? clamp(eWind / (eWind + eSwell), 0, 1) : 0;
  const cleanliness = clamp(1 - 0.95 * windseaFrac, 0, 1);

  // Closeout: period-aware (long groundswell holds bigger), smooth toward ~0.15.
  const closeoutHeight =
    Number.isFinite(beach.maxHeight) && beach.maxHeight > 0
      ? beach.maxHeight * clamp((swellPeriod / 11) ** 0.3, 0.85, 1.25)
      : Infinity;
  const oversize =
    Number.isFinite(swellHeight) && swellHeight > closeoutHeight
      ? clamp(1 - 0.85 * ((swellHeight - closeoutHeight) / (0.5 * beach.maxHeight)), 0.15, 1)
      : 1;

  const swellQuality = clamp(sizeMag * periodFit * cleanliness * oversize * sizeReadiness, 0, 1);
  const directionFit = directionWindowScore(swellDirection, beach.swellCenter, beach.swellSpread);
  const potential = swellQuality * (0.45 + 0.55 * directionFit); // direction modulates, never zeroes

  // Wind multiplies the clean-swell potential; a blown-out day keeps little of it.
  const windFactor = windQualityFactor(beach, sample, sizeMag);
  const core = potential * (0.18 + 0.82 * windFactor);

  // Context (coastal depth fit, tide, weather) is small and gated by core so it
  // cannot lift a flat or blown-out hour. Direction and shelter already live in core.
  const tideFit = tideScore(sample.tideState, beach.idealTide, beach.tideSpread);
  const coastalFit = coastalFitScore(beach, sizeMag) / 100;
  const weatherFit = clamp(1 - rain / 170 - cloud / 500, 0.18, 1);
  const context = 0.55 * coastalFit + 0.28 * tideFit + 0.17 * weatherFit;
  const coreGate = smoothstep(core, 0.08, 0.5);

  const score = Math.round(clamp(100 * (0.85 * core + 0.15 * context * coreGate), 0, 100));
  const confidence = [94, 87, 76, 64][dayOffset] ?? 60;

  const windDiff = angularDiff(sample.windDirection, beach.offshoreWind);
  const windQuality = windQualityText(windDiff, sample.windSpeed ?? 0);
  const tideTrend = tideTrendText(sample.seaLevel, sample.nextSeaLevel);
  const tideQuality = tideQualityText(tideFit);

  return {
    score,
    label: scoreLabel(score),
    confidence,
    parts: {
      swell: 100 * potential,
      wind: 100 * windFactor,
      coastal: 100 * coastalFit,
      tide: 100 * tideFit,
      weather: 100 * weatherFit,
    },
    detail: {
      energy: 0.49 * eSwell, // approx kW/m of clean swell, for the prose layer
      breakingHeight: hb,
      windseaFrac,
      sizeMag,
      sizeReadiness,
      periodFit,
      directionFit,
      windFactor,
      cleanliness,
      oversize,
      minSurfHeight: surfableHeightFloor(beach),
    },
    windQuality,
    tideTrend,
    tideQuality,
    reasons: buildReasons({
      sample,
      height: swellHeight,
      period: swellPeriod,
      swellDirection,
      coastal: 100 * coastalFit,
      windseaFrac,
      energy: 0.49 * eSwell,
      beach,
      minSurfHeight: surfableHeightFloor(beach),
      windQuality,
      tideTrend,
      tideQuality,
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
    windseaFrac,
    beach,
    minSurfHeight,
    windQuality,
    tideTrend,
    tideQuality,
    score,
  } = context;
  const pt = state.lang === "pt";
  const rain = sample.precipitationProbability ?? 0;
  const reasons = [];

  const swellLine = `${formatNumber(height, 1)} m @ ${formatNumber(period, 1)} s`;
  reasons.push(
    pt
      ? `Swell de ${swellLine} de ${degToCompass(swellDirection)}`
      : `${swellLine} swell from ${degToCompass(swellDirection)}`,
  );
  reasons.push(
    pt
      ? `Vento ${windQuality} de ${degToCompass(sample.windDirection)} a ${formatNumber(sample.windSpeed, 0)} km/h`
      : `${windQuality} ${degToCompass(sample.windDirection)} wind at ${formatNumber(sample.windSpeed, 0)} km/h`,
  );
  reasons.push(
    pt
      ? `Maré ${tideTrend.toLowerCase()}, ${tideQuality.toLowerCase()}, em ${formatSigned(sample.seaLevel)} m`
      : `${tideTrend} ${tideQuality.toLowerCase()} tide at ${formatSigned(sample.seaLevel)} m`,
  );

  // Fourth reason: prioritize hard surfability blockers, then contamination / fit.
  if (Number.isFinite(height) && Number.isFinite(minSurfHeight) && height < minSurfHeight) {
    reasons.push(
      pt
        ? `Altura abaixo do piso surfável de ${formatNumber(minSurfHeight, 1)} m`
        : `Height below the ${formatNumber(minSurfHeight, 1)} m surfable floor`,
    );
  } else if (Number.isFinite(windseaFrac) && windseaFrac >= 0.45) {
    reasons.push(pt ? "Mar de vento bagunçando o swell" : "Wind-sea is contaminating the swell");
  } else if (coastal < 48) {
    reasons.push(
      pt ? `Encaixe da costa filtra a previsão na ${beach.name}` : `Coastal fit is filtering the forecast at ${beach.name}`,
    );
  } else if (coastal >= 74) {
    reasons.push(
      pt
        ? `Encaixe da costa favorece ${tProfile(beach, "beachAxis")}`
        : `Coastal fit supports ${spotDataProfile(beach).beachAxis}`,
    );
  } else if (rain >= 45) {
    reasons.push(pt ? `${formatNumber(rain, 0)}% de risco de chuva` : `${formatNumber(rain, 0)}% rain risk`);
  } else if (score >= 70) {
    reasons.push(pt ? "Janela de tempo limpa o bastante" : "Clean enough weather window");
  }

  return reasons.slice(0, 4);
}

function directionWindowScore(direction, center, spread) {
  if (!Number.isFinite(direction) || !Number.isFinite(center) || !Number.isFinite(spread) || spread <= 0) {
    return 0.5;
  }
  const diff = angularDiff(direction, center);
  if (diff >= spread) return 0.06;
  const normalized = diff / spread;
  // Gentle exponent so the configured spread is the real window (the floor is
  // only reached near diff == spread, not at ~0.95 of it).
  return clamp(1 - normalized ** 1.15, 0.06, 1);
}

// Tide fit on a normalized 0 (low) .. 1 (high) state vs the beach's preference.
// We compare a daily-normalized state, not absolute MSL metres: Open-Meteo's
// sea_level_height_msl is referenced to the global datum and carries a
// surge/pressure residual, so absolute height is not a reliable tide phase.
function tideScore(state, ideal, spread) {
  if (!Number.isFinite(state) || !Number.isFinite(ideal) || !Number.isFinite(spread) || spread <= 0) {
    return 0.6;
  }
  const diff = Math.abs(state - ideal);
  if (diff >= spread) return 0.3;
  return clamp(1 - (diff / spread) ** 1.4, 0.3, 1);
}

// Coastal/bathymetry fit (0..100) for the CONTEXT layer only. Swell direction
// and shelter-driven size already live in the core, so this carries just the new
// information: does the beach's nearshore shape suit the swell's energy? Open,
// steep beaches reward more energy; soft, sheltered bays prefer moderation.
function coastalFitScore(beach, sizeMag) {
  const profile = spotDataProfile(beach);
  const shelter = clamp(Number.isFinite(profile.shelterIndex) ? profile.shelterIndex : 0.35, 0, 1);
  const depthPower = clamp(Number.isFinite(profile.depthPower) ? profile.depthPower : 0.58, 0, 1);
  const confidence = clamp(Number.isFinite(profile.dataConfidence) ? profile.dataConfidence : 0.5, 0, 1);
  const energy = Number.isFinite(sizeMag) ? sizeMag : 0.4;

  const openness = 1 - shelter;
  const idealEnergy = clamp(0.3 + 0.35 * openness + 0.1 * (depthPower - 0.5), 0.2, 0.85);
  const fit = clamp(1 - 1.15 * Math.abs(energy - idealEnergy), 0.12, 1);

  // Blend toward a neutral floor where local data is thin.
  return 100 * clamp(fit * confidence + 0.5 * (1 - confidence), 0.12, 1);
}

function tideTrendText(level, nextLevel) {
  const steady = state.lang === "pt" ? "Parada" : "Steady";
  if (!Number.isFinite(level) || !Number.isFinite(nextLevel)) return steady;
  const delta = nextLevel - level;
  if (Math.abs(delta) < 0.025) return steady;
  if (state.lang === "pt") return delta > 0 ? "Enchendo" : "Vazando";
  return delta > 0 ? "Rising" : "Dropping";
}

function tideQualityText(score) {
  const labels =
    state.lang === "pt"
      ? ["Ótima", "Boa", "Difícil", "Ruim"]
      : ["Prime", "Usable", "Tricky", "Poor"];
  if (score >= 0.82) return labels[0];
  if (score >= 0.58) return labels[1];
  if (score >= 0.35) return labels[2];
  return labels[3];
}

function windQualityText(diff, speed) {
  if (state.lang === "pt") {
    const strength = speed >= 26 ? "forte" : speed >= 15 ? "moderado" : "leve";
    if (diff <= 45) return `terral ${strength}`;
    if (diff <= 95) return `terral lateral ${strength}`;
    if (diff <= 135) return `maral lateral ${strength}`;
    return `maral ${strength}`;
  }
  const strength = speed >= 26 ? "strong" : speed >= 15 ? "moderate" : "light";
  if (diff <= 45) return `${strength} offshore`;
  if (diff <= 95) return `${strength} cross-offshore`;
  if (diff <= 135) return `${strength} cross-onshore`;
  return `${strength} onshore`;
}

// Single source of truth for the five score tiers. labelIndex points into the
// localized label arrays in scoreLabel so the map legend, pins, badges, and
// labels can never drift apart.
const SCORE_TIERS = [
  { min: 80, pin: "pin-excellent", swatch: "excellent", labelIndex: 0 },
  { min: 66, pin: "pin-good", swatch: "good", labelIndex: 1 },
  { min: 52, pin: "pin-fair", swatch: "fair", labelIndex: 2 },
  { min: 38, pin: "pin-poor", swatch: "poor", labelIndex: 3 },
  { min: 0, pin: "pin-bad", swatch: "bad", labelIndex: 4 },
];

function scoreLabel(score) {
  const labels =
    state.lang === "pt"
      ? ["Excelente", "Bom", "Surfável", "Fraco", "Ruim"]
      : ["Excellent", "Good", "Workable", "Marginal", "Poor"];
  const tier = SCORE_TIERS.find((entry) => score >= entry.min) ?? SCORE_TIERS[SCORE_TIERS.length - 1];
  return labels[tier.labelIndex];
}

function pinClass(score) {
  if (!Number.isFinite(score)) return "pin-empty";
  return (SCORE_TIERS.find((entry) => score >= entry.min) ?? SCORE_TIERS[SCORE_TIERS.length - 1]).pin;
}

// Render the map legend from SCORE_TIERS so its colors, thresholds, and words
// always match pinClass/scoreLabel (and localize with the language toggle).
function renderLegend() {
  const legend = document.querySelector(".map-legend");
  if (!legend) return;
  legend.innerHTML = SCORE_TIERS.map((tier) => {
    const range = tier.min === 0 ? "&lt;38" : `${tier.min}+`;
    return `<span><i class="legend-swatch ${tier.swatch}"></i><b>${range}</b> ${escapeHtml(scoreLabel(tier.min))}</span>`;
  }).join("");
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

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return NaN;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function valueAt(hourly, key, index) {
  const value = hourly?.[key]?.[index];
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function initialSelectedHour() {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  return clamp(Number.isFinite(hour) ? hour : 8, HOUR_MIN, HOUR_MAX);
}

function selectedForecastTimestampSeconds(
  dayOffset = state.selectedDayOffset,
  hour = state.selectedHour,
) {
  const [year, month, day] = dateKey(dayOffset).split("-").map(Number);
  if (![year, month, day, hour].every(Number.isFinite)) return null;
  // America/Sao_Paulo is UTC-3 year-round (Brazil dropped DST in 2019), so a
  // local wall-clock hour maps to UTC by adding 3. Revisit if DST returns.
  return Date.UTC(year, month - 1, day, hour + SAO_PAULO_UTC_OFFSET_HOURS, 0, 0) / 1000;
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
  return capitalize(
    new Intl.DateTimeFormat(localeTag(), {
      timeZone: TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(target),
  );
}

function formatWeekday(offset) {
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + offset);
  const label = new Intl.DateTimeFormat(localeTag(), {
    timeZone: TZ,
    weekday: "short",
  }).format(target);
  return capitalize(label.replace(/\.$/, ""));
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function formatDayHour(offset, hour) {
  return `${formatDay(offset)} ${formatHour(hour)}`;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatClock(date) {
  return new Intl.DateTimeFormat(localeTag(), {
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
  const directions = COMPASS[state.lang] ?? COMPASS.en;
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return directions[index];
}

function angularDiff(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 180;
  const diff = Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);
  return diff;
}

// Hermite smoothstep: 0 below edge0, 1 above edge1, eased in between.
function smoothstep(value, edge0, edge1) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
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
