// Forecast explanation and comparison prose.
//
// This stays as a classic script so the app can run directly from a local file
// or static server without a build step. It is pure presentation logic: scoring
// stays in score-model.js, selectors stay in forecast-selectors.js, and DOM
// writes stay in app.js.

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
  // A clean-fun rescued day scores well DESPITE low swell power, so the raw
  // limiting factor (always swell on these days) would contradict the call.
  // Surface the clean-fun read instead so the one-liner matches the score.
  if ((scored.score.detail?.cleanFun ?? 0) >= 0.1) {
    return state.lang === "pt"
      ? `${scored.score.label}: pequeno mas limpo e glassy — vale a remada.`
      : `${scored.score.label}: small but clean and glassy — worth the paddle.`;
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

// Representative size + cleanliness at the day's best hour. Returns the prose
// keys consumed by describeDay's conditions sentence.
function summarizeConditions(scan, best, dayPeak) {
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

  return { sizeKey, cleanKey };
}

// Best window + morning-vs-afternoon trend across the day. Returns the prose
// keys plus the window hours describeDay needs for the rain watch-out.
function summarizeTiming(hourBest, best, dayPeak) {
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

  return { windowHours, windowKey, allDay, trend };
}

// Best score per beach across the day, sorted descending → which spots to call
// out in the prose layer.
function pickTopBeaches(entriesByBeach) {
  return BEACHES.map((beach) => {
    const beachEntries = entriesByBeach.get(beach.id) ?? [];
    return beachEntries.length ? { beach, score: bestScoredEntry(beachEntries).scored.score.score } : null;
  })
    .filter(Boolean)
    .sort(compareByScoreDesc);
}

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
  const beachPeak = pickTopBeaches(entriesByBeach);

  // --- Conditions: representative size + cleanliness at the day's best hour ---
  const { sizeKey, cleanKey } = summarizeConditions(scan, best, dayPeak);

  // --- Timing: best window + morning vs afternoon trend ---
  const { windowHours, windowKey, allDay, trend } = summarizeTiming(hourBest, best, dayPeak);

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

// How much to trust this read, blending forecast HORIZON confidence (further-out
// days are softer) with the spot's source DATA confidence (places like Brava and
// Matadeiro rest on thin/contested priors — see docs/spot-research.md). Surfaced
// as a small chip so a low-confidence spot reads as an estimate, not a measurement.
function confidenceMeta(scored) {
  const horizon = clamp((scored.score.confidence ?? 60) / 100, 0, 1);
  const data = clamp(scored.score.detail?.dataConfidence ?? 0.5, 0, 1);
  const combined = clamp(horizon * (0.65 + 0.35 * data), 0, 1);
  const pct = Math.round(combined * 100);
  const pt = state.lang === "pt";
  const title = pt ? `Confiança ~${pct}% (horizonte + dados do pico)` : `~${pct}% confidence (horizon + spot data)`;
  if (combined >= 0.72) return { tier: "high", text: t("confHigh"), title };
  if (combined >= 0.5) return { tier: "mid", text: t("confMid"), title };
  return { tier: "low", text: t("confLow"), title };
}

