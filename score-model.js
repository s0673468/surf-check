// ---------------------------------------------------------------------------
// Scoring model - "clean-swell power, then degrade for wind", the shape real
// rating engines use (MSW / Surf-Forecast / Surfline LOLA). Each physical input
// enters the core score exactly once:
//   size    -> shelter-attenuated breaking height of the combined sea, soft-knee
//   period  -> periodCurve quality multiplier
//   chop    -> windsea-contamination cleanliness (from the swell partition)
//   angle   -> directionFit (swell vs the beach's window)
//   wind    -> windQualityFactor (multiplicative gate)
//   shelter -> attenuates the breaking height, so sheltered bays read smaller on
//              average (they are "too small" more often) yet survive as the
//              clean-up call on oversized days when open beaches close out.
//
// On top of the power core sits ONE deliberate composite, the clean-fun term: a
// rideable (above the surfable floor), clean, groomed-period, glassy, in-window
// SMALL day is a genuinely good call to paddle out even though it carries little
// power - the pure power engine buries exactly those sessions at "Poor". The term
// is gated on every one of those conditions (so it can never lift a sub-floor,
// choppy, short-period, windy, off-window, or big forecast) and it fades on the
// score's own HEADROOM rather than on size, so it lifts low-scoring small days
// without ever inverting a bigger/cleaner day below a smaller one.
//
// SIZE_REF is the main calibration knob: the breaking height (m) at which the
// size term reaches 0.5. Lower it for a friendlier scale, raise it for stricter.
// CLEAN_FUN_BONUS is how many points a perfect clean-glassy-rideable small day
// can earn back on top of its power core.
// ---------------------------------------------------------------------------
const SIZE_REF = 0.8;
const CLEAN_FUN_BONUS = 64;
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
// focuses as the wave feels bottom). The 0.4 exponent gives a meaningful
// ~+/-18% across the realistic 6-16 s band so genuine long-period groundswell
// reads taller than short windswell of the same deep-water height.
function breakingHeight(height, period) {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const t = Number.isFinite(period) && period > 0 ? period : 9;
  return height * clamp((t / 11) ** 0.4, 0.82, 1.18);
}

function shelterAttenuation(beach) {
  const shelter = clamp(spotDataProfile(beach).shelterIndex ?? 0.35, 0, 1);
  return 1 - SHELTER_ENERGY_LOSS * shelter;
}

// What the surfer actually rides is the COMBINED sea, not the dominant swell
// partition. Open-Meteo frequently splits a small day into a short primary swell
// plus a separate longer-period secondary, so the partition alone can read ~40%
// smaller (and shorter) than the real breaking sea - which is what sank a clean
// 0.86 m / 6.7 s morning to "3/100". So SIZE, PERIOD, prose and the surfable-floor
// gate read the combined wave figures (falling back to the swell partition only
// when the combined columns are missing). DIRECTION stays on the swell partition:
// "where is the groundswell from" is the meaningful angle for the beach window,
// and the prose calls it "swell from X". Cleanliness is kept honest separately:
// its clean-swell energy reads the swell partition (see scoreSample), so wind-chop
// still enters as dirt, not as free size.
function effHeight(sample) {
  const candidates = [sample.waveHeight, sample.swellHeight].filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

// Period for SHOALING and the period-quality multiplier. We size on the
// combined sea (effHeight), but the combined wave_period is blended DOWN by any
// windsea, so a clean long-period groundswell hidden under short chop would be
// graded as chop. Take the longer of the combined and swell-partition periods
// so that hidden groundswell keeps its quality. (Height stays the combined sea.)
function effPeriod(sample) {
  const wave = sample.wavePeriod;
  const swell = sample.swellPeriod;
  if (Number.isFinite(wave) && Number.isFinite(swell)) return Math.max(wave, swell);
  return wave ?? swell;
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

// Period-quality multiplier. Short clean swell (5-7 s) is the bread and butter
// of small fun beachbreak days here, so it keeps real value (floor 0.55) rather
// than being treated as garbage; solid groundswell 10-12 s is nearly full,
// premium 15 s+ tops out. The windsea MESS is docked by cleanliness, not here,
// so period only measures swell quality. Smooth (no slope kinks).
function periodCurve(period) {
  if (!Number.isFinite(period)) return 0.4;
  if (period <= 5) return 0.55;
  if (period >= 15) return 1;
  if (period <= 12) {
    const x = (period - 5) / 7; // 0..1 across 5-12 s
    return 0.55 + 0.4 * (x * x * (3 - 2 * x)); // smoothstep 0.55 -> 0.95
  }
  return 0.95 + 0.05 * ((period - 12) / 3); // 0.95 -> 1.00 across 12-15 s
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

// Multiplicative wind gate (0..1). A glassy surface sits at a ~0.9 baseline from
// ANY direction; clean light offshore grooms it up toward 1.0; turning onshore
// degrades it MONOTONICALLY (cross-shore is texture, dead onshore is blown);
// bigger swell shrugs wind off; gusts and very strong wind from any quarter
// taper it toward zero. The degradation is built from `onshoreness` (a single
// quantity monotone in the offshore->onshore angle) so the factor is continuous
// and non-increasing as the wind rotates onshore at any fixed speed - the old
// branch split rated a dead-cross / slightly-onshore wind ABOVE a slightly-
// offshore one (a ~0.1 jump at 90 deg) and let dead-onshore beat oblique onshore.
function windQualityFactor(beach, sample, sizeMag = 0.5) {
  const speed = sample.windSpeed;
  const gusts = sample.windGusts;
  if (!Number.isFinite(speed) || speed <= 0) return 0.9;

  const off = angularDiff(sample.windDirection, beach.offshoreWind); // 0 offshore .. 180 onshore
  const dirComp = Math.cos((off * Math.PI) / 180); // +1 offshore .. -1 onshore
  const onshoreness = (1 - dirComp) / 2; // 0 offshore .. 0.5 cross .. 1 onshore (monotone in off)
  const offshoreness = Math.max(0, dirComp); // 0..1 over the offshore half
  const sizeShield = clamp(1 - 0.4 * sizeMag, 0.6, 1); // bigger swell resists wind
  const dirWeight = smoothstep(speed, 2, 10); // wind angle is irrelevant when near-calm

  // Clean light offshore is the prize: a 0.9 glassy baseline grooms up to 1.0.
  const groom = 0.1 * offshoreness * smoothstep(speed, 0, 10);

  // Degradation grows monotonically as the wind turns onshore. Whitecaps build
  // from ~12 km/h; dead onshore bites the full penalty, cross-shore half of it.
  const severity = clamp((speed - 11) / 24, 0, 1) ** 1.3; // whitecaps ~13+, blown by ~35
  let factor = 0.9 + groom - dirWeight * onshoreness * (0.32 + 0.7 * severity) * sizeShield;

  // Strong offshore over-holds the face (late drops, double-ups). Only on the
  // offshore half and only past ~32 km/h, so it never breaks onshore monotonicity.
  factor -= dirWeight * offshoreness * clamp((speed - 32) / 60, 0, 0.28);

  // Gusts only chop the face once the spread is real AND there is a sustained
  // base wind - a glassy 2 km/h morning with the odd 9 km/h puff stays glassy, so
  // the penalty is gated by base speed (no spurious demotion of a dawn glassoff)
  // and the first ~8 km/h of spread is free.
  const gustSpread = Math.max(0, (Number.isFinite(gusts) ? gusts : speed) - speed);
  factor *= 1 - smoothstep(speed, 3, 10) * clamp(Math.max(0, gustSpread - 8) / 40, 0, 0.6);
  factor *= clamp(1 - Math.max(0, speed - 35) / 45, 0.06, 1); // strong wind, any direction

  return clamp(factor, 0.03, 1);
}

function scoreSample(beach, sample, dayOffset) {
  const swellHeight = effHeight(sample) ?? 0;
  const swellPeriod = effPeriod(sample) ?? 0;
  const swellDirection = effDir(sample);
  const rainKnown = Number.isFinite(sample.precipitationProbability);
  const cloudKnown = Number.isFinite(sample.cloudCover);
  const rain = rainKnown ? sample.precipitationProbability : 0;
  const cloud = cloudKnown ? sample.cloudCover : 0;

  // Clean-swell energy = primary + the secondary swell weighted by its OWN period
  // and direction quality (a long-period in-window secondary is real rideable
  // energy; a short off-window one is just chop). Wind-wave = contamination.
  // This reads the swell PARTITION (not effHeight, which is the combined sea used
  // for size) so the windsea fraction below stays a true cleanliness measure.
  const ePrimary = waveEnergy(sample.swellHeight ?? sample.waveHeight, sample.swellPeriod ?? sample.wavePeriod);
  const eSecondaryRaw = waveEnergy(sample.secondarySwellHeight, sample.secondarySwellPeriod);
  const secondaryWeight = clamp(
    periodCurve(sample.secondarySwellPeriod) *
      directionWindowScore(sample.secondarySwellDirection, beach.swellCenter, beach.swellSpread),
    0.05, // a junk off-window short secondary earns almost nothing, not a guaranteed 15%
    0.85,
  );
  const eSecondary = secondaryWeight * eSecondaryRaw;
  // Wind-wave = contamination, but windsea running WITH the swell (in the beach's
  // window) stacks into rideable size more than it dirties the face. Discount its
  // contamination by how aligned it is - only when we actually know its direction
  // (unknown => treat as full chop, no free pass).
  const windWaveAlignment = Number.isFinite(sample.windWaveDirection)
    ? directionWindowScore(sample.windWaveDirection, beach.swellCenter, beach.swellSpread)
    : 0;
  const eWind = waveEnergy(sample.windWaveHeight, sample.windWavePeriod) * (1 - 0.5 * windWaveAlignment);
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
  // Direction modulates but never zeroes the power core. The floor is exposure-
  // class dependent: open swell magnets keep ~0.45 of their power on an off-window
  // swell (they still get SOMETHING), but sheltered/filtered bays cap harder
  // (~0.25) because a bad angle is a real wall there - the open-water height
  // overstates what wraps in. (See docs/spot-research.md: tighten the angle gate
  // by exposure class.)
  const shelter = clamp(spotDataProfile(beach).shelterIndex ?? 0.35, 0, 1);
  const dirFloor = 0.45 - 0.22 * shelter; // ~0.45 open .. ~0.29 sheltered
  const potential = swellQuality * (dirFloor + (1 - dirFloor) * directionFit);

  // Wind multiplies the clean-swell potential; a blown-out day keeps little of
  // it (wind weighs heavier than the old 0.18/0.82 split - glassy is the prize).
  const windFactor = windQualityFactor(beach, sample, sizeMag);
  const core = potential * (0.12 + 0.88 * windFactor);

  // Clean-fun gates: the conditions that make a small day worth paddling out for.
  // rideableSize is 0 at/below the surfable floor; glassiness wants light wind;
  // notBig keeps this to genuinely small surf (fades out by head-high so a big
  // closeout never qualifies). Reused below for the context gate and the bonus.
  const surfFloor = surfableHeightFloor(beach);
  const rideableSize = smoothstep(swellHeight, surfFloor, surfFloor * 1.4); // 0 at/below floor
  const glassiness = clamp(1 - (sample.windSpeed ?? 0) / 16, 0, 1);
  const notBig = 1 - smoothstep(hb, 1.8, 2.7); // ~1 for small surf, ->0 for big/closeout
  const calmCleanRideable = rideableSize * cleanliness * glassiness;

  // Context (coastal depth fit, tide, weather) is small. It is gated by core so a
  // flat/blown hour cannot borrow from it, but a calm-clean-rideable day lets it
  // through (good tide and a clear sky DO matter when it is actually nice out).
  const tideFit = tideScore(sample.tideState, beach.idealTide, beach.tideSpread);
  const coastalFit = coastalFitScore(beach, sizeMag) / 100;
  // Missing rain AND cloud reads as neutral (~0.7), not a flawless clear sky, so
  // a weather-data gap can't masquerade as perfect conditions.
  const weatherFit =
    rainKnown || cloudKnown ? clamp(1 - rain / 170 - cloud / 500, 0.18, 1) : 0.7;
  const context = 0.55 * coastalFit + 0.28 * tideFit + 0.17 * weatherFit;
  const coreGate = clamp(smoothstep(core, 0.08, 0.5) + 0.9 * calmCleanRideable, 0, 1);
  const baseScore = 0.85 * core + 0.15 * context * coreGate;

  // Clean-fun bonus: rescue points for a rideable + clean + GROOMED-period +
  // glassy-and-not-onshore + in-window + small day. periodFit only feeds the power
  // core, so a separate period gate is needed here or short windsea dumped into the
  // swell columns would earn the bonus. It fades on score HEADROOM (not size), so it
  // lifts low-scoring small days yet can never invert a bigger/cleaner day below a
  // smaller one. notBig keeps it off big closeouts that score low for other reasons.
  const groomedPeriod = smoothstep(swellPeriod, 4, 6.5); // real swell, not 3-5 s chop
  const windNice = glassiness * windFactor; // light AND good-direction, not just calm
  const headroom = clamp(1 - baseScore / 0.82, 0, 1); // only rescues low-scoring days
  const cleanFun =
    rideableSize * cleanliness * groomedPeriod * windNice * directionFit * notBig * headroom;

  const score = Math.round(clamp(100 * baseScore + CLEAN_FUN_BONUS * cleanFun, 0, 100));
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
      cleanFun,
      minSurfHeight: surfableHeightFloor(beach),
      dataConfidence: clamp(spotDataProfile(beach).dataConfidence ?? 0.5, 0, 1),
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
      cleanFun,
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
    cleanFun,
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
  } else if (Number.isFinite(cleanFun) && cleanFun >= 0.1 && score >= 52) {
    reasons.push(
      pt ? "Pequeno mas limpo e glassy — vale a remada" : "Small but clean and glassy — worth the paddle",
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
function tideScore(tideState, ideal, spread) {
  if (!Number.isFinite(tideState) || !Number.isFinite(ideal) || !Number.isFinite(spread) || spread <= 0) {
    return 0.6;
  }
  const diff = Math.abs(tideState - ideal);
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
