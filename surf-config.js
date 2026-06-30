// Surf-region configuration and static text dictionaries.
//
// This stays as a classic script so the app can run directly from a local file
// or static server without a build step. Load it before the runtime helpers.

const TZ = "America/Sao_Paulo";
const SAO_PAULO_UTC_OFFSET_HOURS = 3; // UTC-3, no DST since 2019
const HOUR_MIN = 6;
const HOUR_MAX = 18;
const HOURS = Array.from({ length: HOUR_MAX - HOUR_MIN + 1 }, (_, index) => HOUR_MIN + index);
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
  },
  joaquina: {
    beachAxis: "Open E-to-S beach",
    depth: "Moderate to steep banks",
    shelter: "Low shelter",
    depthPower: 0.74,
    shelterIndex: 0.2,
    dataConfidence: 0.6,
  },
  campeche: {
    beachAxis: "Long south-facing shoreline",
    depth: "Broad shifting sandbars",
    shelter: "Partial island influence",
    depthPower: 0.58,
    shelterIndex: 0.34,
    dataConfidence: 0.56,
  },
  "barra-da-lagoa": {
    beachAxis: "Filtered ENE/E cove",
    depth: "Channel-influenced sand",
    shelter: "Medium to high shelter",
    depthPower: 0.44,
    shelterIndex: 0.68,
    dataConfidence: 0.58,
  },
  mocambique: {
    beachAxis: "Very open ENE/E coast",
    depth: "Long exposed sandy shelf",
    shelter: "Low shelter",
    depthPower: 0.62,
    shelterIndex: 0.16,
    dataConfidence: 0.55,
  },
  santinho: {
    beachAxis: "ENE/E pocket",
    depth: "Pocket beach with headland effects",
    shelter: "Moderate edge shelter",
    depthPower: 0.66,
    shelterIndex: 0.42,
    dataConfidence: 0.58,
  },
  brava: {
    beachAxis: "NE/E cliff-framed",
    depth: "Short, punchy nearshore zone",
    shelter: "Low shelter",
    depthPower: 0.78,
    shelterIndex: 0.22,
    dataConfidence: 0.57,
  },
  ingleses: {
    beachAxis: "Broad north bay",
    depth: "Softer bay sandbars",
    shelter: "Medium shelter",
    depthPower: 0.46,
    shelterIndex: 0.56,
    dataConfidence: 0.55,
  },
  matadeiro: {
    beachAxis: "SE/SSE cove",
    depth: "Cove and river-mouth sand",
    shelter: "Moderate shelter",
    depthPower: 0.58,
    shelterIndex: 0.48,
    dataConfidence: 0.54,
  },
  armacao: {
    beachAxis: "Protected south pocket",
    depth: "Softer protected sand",
    shelter: "High shelter",
    depthPower: 0.4,
    shelterIndex: 0.72,
    dataConfidence: 0.52,
  },
  "lagoinha-do-leste": {
    beachAxis: "Very open SE/ESE cove",
    depth: "Exposed remote beachbreak",
    shelter: "Low shelter",
    depthPower: 0.72,
    shelterIndex: 0.2,
    dataConfidence: 0.48,
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
  },
];

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
    toneWord: (tone) =>
      ({ good: "bom", watch: "atenção", poor: "fraco" })[tone] ?? tone,
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
    errorState: "Previsão indisponível agora.",
    retry: "Tentar de novo",
    confHigh: "Confiança alta",
    confMid: "Confiança média",
    confLow: "Confiança baixa",
    loadingBeaches: "Carregando praias",
    loadingWindow: "Carregando o dia",
    docTitle: "Surfe em Floripa",
    metaDescription: "Como o surfe está se formando nas praias de Florianópolis.",
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
    toneWord: (tone) =>
      ({ good: "good", watch: "watch", poor: "poor" })[tone] ?? tone,
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
    errorState: "Forecast data is unavailable right now.",
    retry: "Try again",
    confHigh: "High confidence",
    confMid: "Medium confidence",
    confLow: "Low confidence",
    loadingBeaches: "Loading beaches",
    loadingWindow: "Loading day window",
    docTitle: "Surf check · Floripa",
    metaDescription: "How the surf is shaping up across the beaches of Florianópolis.",
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
    whyNearby:
      "Mole e Joaquina são pertinho, mas a Mole é mais curta e íngreme, com pontas de pedra, então pequenas mudanças de tamanho, vento ou banco aparecem mais rápido aqui.",
  },
  joaquina: {
    breakType: "Beachbreak de bancos de areia",
    whyNearby:
      "Joaquina e Campeche dividem a mesma costa aberta, mas o pico principal da Joaquina tem bancos e influência de ponta diferentes, então o mesmo swell pode chegar mais focado aqui.",
  },
  campeche: {
    breakType: "Beachbreak longo de bancos",
    whyNearby:
      "Campeche é quase contínua com a Joaquina, mas a praia mais longa, os bancos diferentes e a exposição voltada à ilha fazem as linhas de swell quebrarem de jeitos diferentes.",
  },
  "barra-da-lagoa": {
    breakType: "Beachbreak de enseada e canal",
    whyNearby:
      "A Barra fica junto ao canal da lagoa e se esconde atrás do formato da costa, então praias abertas próximas podem estar maiores enquanto a Barra fica menor e mais limpa.",
  },
  mocambique: {
    breakType: "Beachbreak longo e aberto",
    whyNearby:
      "Moçambique se conecta à Barra, mas é bem menos abrigada, então o mesmo swell pode chegar maior e mais bagunçado aqui, enquanto a Barra fica mais tranquila.",
  },
  santinho: {
    breakType: "Beachbreak de enseada",
    whyNearby:
      "O Santinho fica ao lado dos Ingleses, mas seu ângulo é mais exposto a swells de leste e menos protegido pelo formato da baía ao norte.",
  },
  brava: {
    breakType: "Beachbreak entre falésias",
    whyNearby:
      "A Brava fica perto dos Ingleses, mas seu ângulo entre falésias encara o swell de frente, então pode ter mais força quando os Ingleses parecem menores.",
  },
  ingleses: {
    breakType: "Beachbreak largo",
    whyNearby:
      "Os Ingleses ficam entre a Brava e o Santinho, mas têm uma baía mais larga e protegida, então praias próximas podem mostrar mais tamanho e força.",
  },
  matadeiro: {
    breakType: "Beachbreak de enseada",
    whyNearby:
      "O Matadeiro fica ao lado da Armação, mas o rio e o formato de enseada o expõem a mais energia do mar, então pode estar surfável enquanto a Armação está pequena.",
  },
  armacao: {
    breakType: "Beachbreak protegido",
    whyNearby:
      "A Armação fica ao lado do Matadeiro, mas num canto mais protegido, então o mesmo swell pode perder tamanho e força antes de chegar à praia.",
  },
  "lagoinha-do-leste": {
    breakType: "Beachbreak remoto",
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

function spotDataProfile(beach) {
  return (
    SPOT_DATA_PROFILES[beach.id] ?? {
      beachAxis: beach.exposure,
      depth: "Unknown nearshore profile",
      shelter: "Unknown shelter",
      depthPower: 0.58,
      shelterIndex: 0.35,
      dataConfidence: 0.45,
    }
  );
}

