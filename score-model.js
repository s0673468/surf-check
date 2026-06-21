// ---------------------------------------------------------------------------
// Scoring model - "clean-swell power, then degrade for wind", the shape real
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
// focuses as the wave feels bottom). A gentle +/-~10% across the realistic band.
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
