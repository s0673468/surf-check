// Session planner.
//
// Pure window search over already-scored forecast cells. This file stays as a
// classic script so the app keeps working from a local file or static server.

const SESSION_WEIGHTS = {
  // Default to the Surfable/Workable score tier for session windows.
  defaultTierLabelIndex: 2,
  // Keep the list short enough to scan while still showing alternatives.
  defaultLimit: 5,
  // A 2 to 3 hour run is materially better than a one-hour spike.
  lengthBonusPerHour: 9,
  // Cap the sustained-window bonus so all-day mediocrity cannot dominate physics.
  lengthBonusCap: 24,
  // Treat small score changes as holding, not a new trend.
  slopeHoldingTolerance: 1.8,
  // Reward a window that is building toward the paddle-out.
  slopeBuildingBonus: 7,
  // Small positive weight for a genuinely steady window.
  slopeHoldingBonus: 2,
  // Penalize fading surf before the session ends.
  slopeFadingPenalty: 9,
  // Extra hit when a window drops through the requested tier before the end.
  blowoutPenalty: 18,
  // Tide can tune a good window but should not outrank core surf quality.
  tideWeight: 12,
  // Dawn and late-afternoon hours are nicer, but not enough to beat physics.
  daylightWeight: 5,
  // Penalize long drives only when the user gives a home point.
  distancePenaltyPerKm: 0.28,
  // Do not let distance erase a clearly better session.
  distancePenaltyCap: 18,
  // Board or intent changes the effective score floor without changing physics.
  intentTierAdjustments: { shortboard: 4, any: 0, longboard: -8 },
  // Stable ordering when utilities tie.
  utilityTiePrecision: 1e-6,
};

function defaultSessionTierFloor() {
  const tier = SCORE_TIERS.find((entry) => entry.labelIndex === SESSION_WEIGHTS.defaultTierLabelIndex);
  return tier?.min ?? SCORE_TIERS[SCORE_TIERS.length - 1].min;
}

function effectiveTierFloor(constraints = {}) {
  const base = Number.isFinite(constraints.tierFloor)
    ? constraints.tierFloor
    : defaultSessionTierFloor();
  const intent = constraints.intent ?? "any";
  const adjustment = SESSION_WEIGHTS.intentTierAdjustments[intent] ?? 0;
  return base + adjustment;
}

function detectWindows(timeline, options = {}) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];

  const tierFloor = Number.isFinite(options.tierFloor) ? options.tierFloor : defaultSessionTierFloor();
  const windows = [];
  let run = [];

  const finishRun = () => {
    if (!run.length) return;
    windows.push(buildWindow(run, tierFloor));
    run = [];
  };

  const entries = timeline
    .filter((entry) => Number.isFinite(entry?.hour) && entry.scored)
    .sort((a, b) => a.hour - b.hour);

  for (const entry of entries) {
    const score = entry.scored?.score?.score;
    const qualifies = Number.isFinite(score) && score >= tierFloor;
    const contiguous = !run.length || entry.hour === run[run.length - 1].hour + 1;
    if (!qualifies || !contiguous) {
      finishRun();
    }
    if (qualifies) run.push(entry);
  }
  finishRun();

  return windows;
}

function buildWindow(entries, tierFloor) {
  const scores = entries.map((entry) => entry.scored.score.score);
  const hours = entries.map((entry) => entry.hour);
  const samples = entries.map((entry) => entry.scored.sample);
  const peakScore = Math.max(...scores);
  const meanScore = mean(scores);
  const slope = classifyWindowSlope(scores, { tierFloor });

  return {
    beach: entries[0]?.scored?.beach,
    startHour: hours[0],
    endHour: hours[hours.length - 1],
    hours,
    lengthHours: hours.length,
    peakScore,
    meanScore,
    samples,
    entries,
    slope,
    tierFloor,
  };
}

function classifyWindowSlope(seriesOrWindow, options = {}) {
  const scores = Array.isArray(seriesOrWindow)
    ? seriesOrWindow
    : seriesOrWindow?.entries?.map((entry) => entry.scored.score.score) ?? [];
  const numeric = scores.filter(Number.isFinite);
  if (!numeric.length) {
    return { tag: "holding", slope: 0, blowout: false };
  }

  const first = numeric[0];
  const last = numeric[numeric.length - 1];
  const slope = numeric.length === 1 ? 0 : (last - first) / (numeric.length - 1);
  const tolerance = options.holdingTolerance ?? SESSION_WEIGHTS.slopeHoldingTolerance;
  const tierFloor = Number.isFinite(options.tierFloor) ? options.tierFloor : defaultSessionTierFloor();
  const peakIndex = numeric.indexOf(Math.max(...numeric));
  const endsBelowFloor = numeric.length > 1 && numeric[numeric.length - 1] < tierFloor;
  const dropsHardAfterPeak =
    peakIndex < numeric.length - 1 &&
    Math.max(...numeric.slice(peakIndex + 1).map((score) => numeric[peakIndex] - score)) >=
      Math.max(tolerance * 2, 6);
  const blowout = endsBelowFloor || dropsHardAfterPeak;

  let tag = "holding";
  if (blowout || slope < -tolerance) tag = "fading";
  else if (slope > tolerance) tag = "building";

  return { tag, slope, blowout };
}

function summarizeTideProgression(window, beach) {
  const states = (window?.samples ?? [])
    .map((sample) => sample?.tideState)
    .filter(Number.isFinite);
  if (!states.length) {
    return { key: "midSteady", trend: "steady", fit: 0.6, start: null, end: null };
  }

  const start = states[0];
  const end = states[states.length - 1];
  const averageTide = mean(states);
  const fit = tideScore(averageTide, beach?.idealTide, beach?.tideSpread);
  const delta = end - start;
  let trend = "steady";
  if (delta >= 0.05) trend = "incoming";
  else if (delta <= -0.05) trend = "draining";

  let phase = "mid";
  if (averageTide <= 0.32) phase = "low";
  else if (averageTide >= 0.68) phase = "high";

  return {
    key: `${phase}${capitalizePlannerKey(trend)}`,
    trend,
    phase,
    fit,
    start,
    end,
    average: averageTide,
  };
}

function scoreWindow(window, beach, constraints = {}) {
  if (!window || !beach) return -Infinity;
  const slope = window.slope ?? classifyWindowSlope(window, { tierFloor: window.tierFloor });
  const tide = summarizeTideProgression(window, beach);
  const distance = sessionDistanceKm(beach, constraints.homePoint);
  const meanScore = Number.isFinite(window.meanScore) ? window.meanScore : 0;
  const peakScore = Number.isFinite(window.peakScore) ? window.peakScore : meanScore;
  const sustainedBase = meanScore * 0.78 + peakScore * 0.22;
  const lengthBonus = Math.min(
    SESSION_WEIGHTS.lengthBonusCap,
    Math.max(0, (window.lengthHours - 1) * SESSION_WEIGHTS.lengthBonusPerHour),
  );
  const slopeTerm =
    slope.tag === "building"
      ? SESSION_WEIGHTS.slopeBuildingBonus
      : slope.tag === "holding"
        ? SESSION_WEIGHTS.slopeHoldingBonus
        : -SESSION_WEIGHTS.slopeFadingPenalty;
  const blowoutTerm = slope.blowout ? -SESSION_WEIGHTS.blowoutPenalty : 0;
  const tideTerm = (tide.fit - 0.6) * SESSION_WEIGHTS.tideWeight;
  const lightTerm = daylightAffinity(window.hours) * SESSION_WEIGHTS.daylightWeight;
  const distanceTerm = Number.isFinite(distance)
    ? -Math.min(SESSION_WEIGHTS.distancePenaltyCap, distance * SESSION_WEIGHTS.distancePenaltyPerKm)
    : 0;

  return sustainedBase + lengthBonus + slopeTerm + blowoutTerm + tideTerm + lightTerm + distanceTerm;
}

function planSessions(gridOrBeaches, constraints = {}) {
  const grid = normalizeSessionGrid(gridOrBeaches, constraints);
  if (!grid.length) return { windows: [], bestHour: null };

  const tierFloor = effectiveTierFloor(constraints);
  const windows = [];
  let bestHour = null;

  for (const row of grid) {
    const { beach, dayOffset } = row;
    if (!beach || !passesDistanceGate(beach, constraints)) continue;
    const timeline = trimTimeline(row.timeline, constraints);

    for (const entry of timeline) {
      const scored = entry.scored;
      if (!scored) continue;
      const score = scored.score?.score;
      if (!Number.isFinite(score)) continue;
      const utility = scoreSingleHour(entry, beach, dayOffset, constraints);
      const candidate = {
        beach,
        dayOffset,
        hour: entry.hour,
        score,
        scored,
        utility,
        distanceKm: sessionDistanceKm(beach, constraints.homePoint),
      };
      if (!bestHour || compareBestHour(candidate, bestHour) < 0) bestHour = candidate;
    }

    for (const window of detectWindows(timeline, { tierFloor })) {
      const tide = summarizeTideProgression(window, beach);
      const utility = scoreWindow(window, beach, constraints);
      windows.push({
        ...window,
        beach,
        dayOffset,
        tide,
        utility,
        distanceKm: sessionDistanceKm(beach, constraints.homePoint),
      });
    }
  }

  windows.sort(compareSessionWindows);
  return {
    windows: windows.slice(0, constraints.limit ?? SESSION_WEIGHTS.defaultLimit),
    bestHour,
  };
}

function normalizeSessionGrid(gridOrBeaches, constraints = {}) {
  if (Array.isArray(gridOrBeaches) && gridOrBeaches.length === 0) return [];

  if (Array.isArray(gridOrBeaches) && gridOrBeaches.length && gridOrBeaches[0]?.timeline) {
    return gridOrBeaches
      .map((row) => ({
        beach: row.beach,
        dayOffset: Number.isFinite(row.dayOffset) ? row.dayOffset : 0,
        timeline: Array.isArray(row.timeline) ? row.timeline : [],
      }))
      .filter((row) => row.beach);
  }

  const beaches = Array.isArray(gridOrBeaches) && gridOrBeaches.length ? gridOrBeaches : BEACHES;
  const dayOffsets = Array.isArray(constraints.dayOffsets) ? constraints.dayOffsets : [0, 1, 2, 3];
  return beaches.flatMap((beach) =>
    dayOffsets.map((dayOffset) => ({
      beach,
      dayOffset,
      timeline: getScoredTimeline(beach, dayOffset),
    })),
  );
}

function trimTimeline(timeline, constraints = {}) {
  const earliest = Number.isFinite(constraints.earliestHour) ? constraints.earliestHour : -Infinity;
  const latest = Number.isFinite(constraints.latestHour) ? constraints.latestHour : Infinity;
  return (timeline ?? []).filter((entry) => entry.hour >= earliest && entry.hour <= latest);
}

function passesDistanceGate(beach, constraints = {}) {
  if (!constraints.homePoint || !Number.isFinite(constraints.maxDistanceKm)) return true;
  const distance = sessionDistanceKm(beach, constraints.homePoint);
  return Number.isFinite(distance) && distance <= constraints.maxDistanceKm;
}

function scoreSingleHour(entry, beach, dayOffset, constraints) {
  const score = entry.scored.score.score;
  const window = buildWindow([entry], effectiveTierFloor(constraints));
  return scoreWindow({ ...window, dayOffset }, beach, constraints) + dayOffsetRecency(dayOffset);
}

function compareSessionWindows(a, b) {
  const utilityDelta = b.utility - a.utility;
  if (Math.abs(utilityDelta) > SESSION_WEIGHTS.utilityTiePrecision) return utilityDelta;
  if (a.dayOffset !== b.dayOffset) return a.dayOffset - b.dayOffset;
  if (a.startHour !== b.startHour) return a.startHour - b.startHour;
  return String(a.beach?.id ?? "").localeCompare(String(b.beach?.id ?? ""));
}

function compareBestHour(a, b) {
  const utilityDelta = b.utility - a.utility;
  if (Math.abs(utilityDelta) > SESSION_WEIGHTS.utilityTiePrecision) return utilityDelta;
  if (a.dayOffset !== b.dayOffset) return a.dayOffset - b.dayOffset;
  if (a.hour !== b.hour) return a.hour - b.hour;
  return String(a.beach?.id ?? "").localeCompare(String(b.beach?.id ?? ""));
}

function daylightAffinity(hours) {
  if (!Array.isArray(hours) || !hours.length) return 0;
  return mean(hours.map((hour) => {
    if (hour <= 8) return 1;
    if (hour >= 16) return 0.75;
    if (hour <= 10) return 0.45;
    if (hour >= 14) return 0.35;
    return 0.15;
  }));
}

function dayOffsetRecency(dayOffset) {
  return Number.isFinite(dayOffset) ? -dayOffset * 0.6 : 0;
}

function sessionDistanceKm(beach, homePoint) {
  if (!homePoint || !Number.isFinite(homePoint.lat) || !Number.isFinite(homePoint.lon)) return null;
  return distanceKm(homePoint, beach);
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return NaN;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function capitalizePlannerKey(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}
