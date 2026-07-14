const state = {
  selectedBeachId: null,
  favoriteBeachId: null,
  selectedDayOffset: 0,
  selectedHour: initialSelectedHour(),
  lang: "pt",
  forecasts: new Map(),
  map: null,
  markers: new Map(),
  loading: true,
  error: "",
  failedBeachIds: [],
  rankingsExpanded: false,
  mapExpanded: false,
  mapInteractionActive: false,
  radar: {
    error: "",
    host: "",
    frames: [],
    selectedFrameIndex: -1,
    layer: null,
  },
};

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
  elements.mapPanel = document.querySelector("#mapPanel");
  elements.mapContent = document.querySelector("#mapContent");
  elements.mapToggle = document.querySelector("[data-map-toggle]");
  elements.mapActivate = document.querySelector("[data-map-activate]");
  elements.radarStatus = document.querySelector("[data-radar-status]");

  let stored = null;
  try {
    stored = window.localStorage.getItem("surf-lang");
  } catch (error) {
    /* ignore storage failures */
  }
  if (stored === "pt" || stored === "en") state.lang = stored;
  try {
    const favorite = window.localStorage.getItem("surf-favorite-beach");
    if (BEACHES.some((beach) => beach.id === favorite)) state.favoriteBeachId = favorite;
  } catch (error) {
    /* ignore storage failures */
  }
  document.documentElement.lang = state.lang === "pt" ? "pt-BR" : "en";

  if (elements.langToggle) {
    elements.langToggle.querySelectorAll("button[data-lang]").forEach((button) => {
      button.addEventListener("click", () => setLang(button.dataset.lang));
    });
  }

  installMapDisclosure();

  syncStaticChrome();
  renderControls();
  initializeMap();
  renderLoading();
  loadForecasts();
  installSessionRefresh();
});

// Recover a long-open session. loadForecasts only runs at startup, so a tab left
// open for hours shows a frozen snapshot and — worse — rolls its day labels past
// local midnight while serving the prior day's data. Refetch (which also clears
// the scored-sample cache) when the tab regains focus or the network returns, if
// the local date has rolled over or the snapshot is stale (>30 min).
function installSessionRefresh() {
  let loadedDate = dateKey(0);
  const STALE_MS = 30 * 60 * 1000;
  const refreshIfStale = () => {
    if (state.loading) return;
    const today = dateKey(0);
    const dateRolled = today !== loadedDate;
    const aged = state.lastUpdated && Date.now() - state.lastUpdated.getTime() > STALE_MS;
    if (dateRolled || aged || !state.loadedCount) {
      loadedDate = today;
      loadForecasts();
      loadRadarFrames();
    }
  };
  if (document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshIfStale();
    });
  }
  if (window.addEventListener) {
    window.addEventListener("online", () => loadForecasts());
    window.addEventListener("focus", refreshIfStale);
  }
}

// Updates the static page chrome (title, headings, control labels, footer,
// language toggle state) that lives outside the data-driven render() pass.
function syncStaticChrome() {
  // The HTML ships PT as the no-JS default; sync the tab title + meta description
  // to the active language so an EN visitor (and their bookmarks/link previews)
  // don't see Portuguese in the chrome.
  document.title = t("docTitle");
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) metaDescription.setAttribute("content", t("metaDescription"));

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
  if (elements.rankedList) elements.rankedList.setAttribute("aria-label", t("recommendationsAria"));
  if (elements.mapPanel) elements.mapPanel.setAttribute("aria-label", t("mapAria"));
  if (elements.mapToggle) {
    elements.mapToggle.setAttribute("aria-expanded", String(state.mapExpanded));
    const label = elements.mapToggle.querySelector("[data-map-toggle-label]");
    if (label) label.textContent = state.mapExpanded ? t("hideMap") : t("showMap");
  }
  if (elements.mapActivate) {
    elements.mapActivate.textContent = state.mapInteractionActive ? t("mapZoomActive") : t("activateMapZoom");
    elements.mapActivate.setAttribute("aria-pressed", String(state.mapInteractionActive));
  }
  updateRadarStatus();

  renderLegend();
  updateStatusBar();

  if (elements.langToggle) {
    elements.langToggle.querySelectorAll("button[data-lang]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.lang === state.lang);
    });
  }
}

function isMobileLayout() {
  return Boolean(window.matchMedia?.("(max-width: 720px)").matches);
}

function installMapDisclosure() {
  const media = window.matchMedia?.("(max-width: 720px)");
  const syncForViewport = (mobile) => {
    state.mapExpanded = !mobile;
    if (elements.mapContent) elements.mapContent.hidden = !state.mapExpanded;
    elements.mapToggle?.setAttribute("aria-expanded", String(state.mapExpanded));
    const label = elements.mapToggle?.querySelector("[data-map-toggle-label]");
    if (label) label.textContent = state.mapExpanded ? t("hideMap") : t("showMap");
    if (state.mapExpanded) window.requestAnimationFrame?.(() => state.map?.invalidateSize?.());
  };
  syncForViewport(Boolean(media?.matches));
  media?.addEventListener?.("change", (event) => syncForViewport(event.matches));

  elements.mapToggle?.addEventListener("click", () => {
    state.mapExpanded = !state.mapExpanded;
    if (elements.mapContent) elements.mapContent.hidden = !state.mapExpanded;
    elements.mapToggle.setAttribute("aria-expanded", String(state.mapExpanded));
    const label = elements.mapToggle.querySelector("[data-map-toggle-label]");
    if (label) label.textContent = state.mapExpanded ? t("hideMap") : t("showMap");
    if (state.mapExpanded) {
      window.requestAnimationFrame?.(() => state.map?.invalidateSize?.());
    }
  });

  elements.mapActivate?.addEventListener("click", () => {
    state.mapInteractionActive = !state.mapInteractionActive;
    if (state.map?.scrollWheelZoom) {
      if (state.mapInteractionActive) state.map.scrollWheelZoom.enable();
      else state.map.scrollWheelZoom.disable();
    }
    elements.mapActivate.setAttribute("aria-pressed", String(state.mapInteractionActive));
    elements.mapActivate.textContent = state.mapInteractionActive ? t("mapZoomActive") : t("activateMapZoom");
  });
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
        aria-valuetext="${String(state.selectedHour).padStart(2, "0")}:00"
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
    slider.setAttribute("aria-valuetext", `${String(state.selectedHour).padStart(2, "0")}:00`);
    // Coalesce the heavier panel/marker rebuild to one paint per frame so a fast
    // drag stays smooth (the instant readout above already gives live feedback).
    scheduleRenderData();
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
  if (!window.L || window.__leafletFailed) {
    initializeFallbackMap();
    return;
  }

  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([-27.59, -48.46], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(state.map);

  for (const beach of BEACHES) {
    const marker = L.marker([beach.lat, beach.lon], {
      icon: makeMarkerIcon(null, beach, false),
      title: beach.name,
      alt: t("mapMarkerEmpty", beach.name),
    })
      .addTo(state.map)
      .bindTooltip(beach.name, {
        className: "beach-tooltip",
        direction: "top",
        offset: [0, -18],
      })
      .on("click", () => {
        selectBeach(beach.id);
      });
    state.markers.set(beach.id, marker);
  }

  updateRadarStatus();
  loadRadarFrames();
}

function initializeFallbackMap() {
  elements.map.hidden = true;
  elements.fallbackMap.hidden = false;
  if (elements.mapActivate) elements.mapActivate.hidden = true;
  if (elements.radarStatus) elements.radarStatus.textContent = t("mapFallback");
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
    button.setAttribute("aria-label", t("mapMarkerEmpty", beach.name));
    button.style.left = `${((beach.lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * 100}%`;
    button.style.top = `${(1 - (beach.lat - bounds.latMin) / (bounds.latMax - bounds.latMin)) * 100}%`;
    button.addEventListener("click", () => {
      selectBeach(beach.id);
    });
    elements.fallbackMap.append(button);
    state.markers.set(beach.id, button);
  }
}

function makeMarkerIcon(score, beach, selected = false) {
  const className = `map-pin ${pinClass(score)}${selected ? " is-selected" : ""}`;
  const label = Number.isFinite(score) ? String(Math.round(score)) : "--";
  return L.divIcon({
    className: "",
    html: `<div class="${className}" aria-hidden="true">${label}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
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
  state.failedBeachIds = results.flatMap((result, index) =>
    result.status === "rejected" ? [BEACHES[index].id] : [],
  );
  updateStatusBar();
  render();
}

// Renders the live-status pill in the current language (re-callable on toggle).
function updateStatusBar() {
  if (state.loading) {
    elements.statusPill?.removeAttribute("title");
    updateStatus("loading", t("loading"));
    return;
  }
  if (!state.loadedCount) {
    state.error = "unavailable";
    elements.statusPill?.removeAttribute("title");
    updateStatus("error", t("unavailable"));
  } else if (state.loadedCount < BEACHES.length) {
    const failed = state.failedBeachIds
      .map((id) => BEACHES.find((beach) => beach.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    elements.statusPill?.setAttribute("title", t("partialDetails", failed));
    updateStatus("error", t("partial", state.loadedCount, BEACHES.length));
  } else {
    elements.statusPill?.setAttribute("title", t("fetchTimeHelp"));
    updateStatus("ready", t("fetched", formatClock(state.lastUpdated)));
  }
}

function render() {
  renderControls();
  renderData();
}

// Coalesce rapid renderData calls (hour-slider drag) into one per animation frame.
let renderDataScheduled = false;
function scheduleRenderData() {
  const raf =
    typeof window !== "undefined" && window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : (cb) => cb();
  if (renderDataScheduled) return;
  renderDataScheduled = true;
  raf(() => {
    renderDataScheduled = false;
    renderData();
  });
}

// Everything that reacts to the selected day/hour/beach, WITHOUT rebuilding the
// controls — so dragging the hour slider stays smooth (the slider element is not
// torn down mid-drag). Scoring is memoized, so this stays cheap to call live.
function renderData() {
  ensureSelectedBeach();
  const view = getForecastView();

  const dashboard = document.querySelector(".dashboard");
  if (dashboard) dashboard.setAttribute("aria-busy", String(Boolean(state.loading)));

  renderTemperatureStrip(view);
  syncRadarToSelection();
  updateRadarLayer();
  updateRadarStatus();

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

function updateRadarStatus() {
  if (!elements.radarStatus) return;
  if (!state.map) {
    elements.radarStatus.textContent = t("mapFallback");
    return;
  }
  if (state.radar.error) {
    elements.radarStatus.textContent = t("radarUnavailable");
    return;
  }
  const frame = selectedRadarFrame();
  if (frame) {
    elements.radarStatus.textContent = t(
      "radarAt",
      new Intl.DateTimeFormat(localeTag(), {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(frame.time * 1000)),
    );
    return;
  }
  elements.radarStatus.textContent = state.radar.frames.length
    ? t("radarNoMatch")
    : t("radarLoading");
}

function ensureSelectedBeach() {
  const entries = getScoredBeachEntries(state.selectedDayOffset, state.selectedHour);
  if (!entries.length) return;
  if (entries.some((entry) => entry.beach.id === state.selectedBeachId)) return;

  const favorite = entries.find((entry) => entry.beach.id === state.favoriteBeachId);
  const ranked = [...entries].sort(compareScoredEntries);
  state.selectedBeachId = (favorite ?? ranked[0]).beach.id;
}

function renderLoading() {
  elements.rankedList.innerHTML = `<div class="empty-state">${escapeHtml(t("loadingBeaches"))}</div>`;
  elements.selectedSummary.innerHTML = `<div class="empty-state">${escapeHtml(t("loading"))}</div>`;
  elements.metricGrid.innerHTML = "";
  elements.timelinePanel.innerHTML = `<div class="empty-state">${escapeHtml(t("loadingWindow"))}</div>`;
}

function renderError() {
  elements.rankedList.innerHTML = `
    <div class="empty-state" role="alert">
      <span>${escapeHtml(t("errorState"))}</span>
      <button type="button" class="retry-btn" data-retry>${escapeHtml(t("retry"))}</button>
    </div>`;
  const retry = elements.rankedList.querySelector("[data-retry]");
  if (retry) retry.addEventListener("click", () => loadForecasts());
  elements.selectedSummary.innerHTML = "";
  elements.metricGrid.innerHTML = "";
  elements.timelinePanel.innerHTML = "";
}

function renderTemperatureStrip(view = getForecastView()) {
  const samples = view.scoredBeaches.map((entry) => entry.scored);
  const air = average(samples.map((item) => item.sample.temperature));
  const water = average(samples.map((item) => item.sample.seaTemperature));
  const label = samples.length
    ? t("airWater", formatNumber(air, 0), formatNumber(water, 0))
    : t("airWaterEmpty");

  elements.tempStrip.innerHTML = `
    <span>${escapeHtml(t("regionalTempsAt", formatDayHour(view.dayOffset, view.hour)))}</span>
    <strong>${escapeHtml(label)}</strong>
  `;
}

function updateMarkers(view = getForecastView()) {
  for (const beach of BEACHES) {
    const marker = state.markers.get(beach.id);
    const scored = view.scoredByBeachId.get(beach.id);
    const score = scored?.score?.score;
    const label = Number.isFinite(score) ? String(Math.round(score)) : "--";
    const selected = beach.id === state.selectedBeachId;
    const markerLabel = Number.isFinite(score)
      ? t("mapMarker", beach.name, label, scored.score.label, selected)
      : t("mapMarkerEmpty", beach.name);

    if (state.map && marker?.setIcon) {
      // Only rebuild the divIcon when the rounded label (and thus the tier)
      // actually changed — a slider drag otherwise mints 11 fresh icons per step.
      const viewKey = `${label}:${selected}`;
      if (marker.__viewKey !== viewKey) {
        marker.setIcon(makeMarkerIcon(score, beach, selected));
        marker.__viewKey = viewKey;
      }
      marker.setZIndexOffset(selected ? 1000 : 0);
      marker.getElement?.()?.setAttribute("aria-label", markerLabel);
      marker.getElement?.()?.setAttribute("aria-current", String(selected));
    } else if (marker) {
      marker.className = `fallback-pin map-pin ${pinClass(score)}${selected ? " is-selected" : ""}`;
      marker.textContent = label;
      marker.setAttribute("aria-label", markerLabel);
      marker.setAttribute("aria-current", String(selected));
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
  const quality = confidenceMeta(scored);
  const favorite = beach.id === state.favoriteBeachId;
  elements.selectedSummary.innerHTML = `
    <div class="selected-kicker">
      <span class="panel-eyebrow">${escapeHtml(t("selectedSpotAt", formatDayHour(view.dayOffset, view.hour)))}</span>
      <span class="selected-actions">
        <button class="selected-action" type="button" data-truth-export aria-label="${escapeHtml(t("downloadTruth", beach.name))}" title="${escapeHtml(t("downloadTruthHelp"))}">
          <span class="material-symbols-rounded" aria-hidden="true">download</span>
        </button>
        <button class="selected-action favorite-toggle" type="button" data-favorite-toggle aria-pressed="${favorite}" aria-label="${escapeHtml(favorite ? t("removeFavorite", beach.name) : t("saveFavorite", beach.name))}">
          <span class="material-symbols-rounded" aria-hidden="true">${favorite ? "star" : "star_outline"}</span>
        </button>
      </span>
    </div>
    <div class="summary-top">
      <div>
        <h2 class="beach-name">${escapeHtml(beach.name)}</h2>
        <p class="beach-meta">${escapeHtml(formatDayHour(view.dayOffset, view.hour))} · ${escapeHtml(tBeach(beach, "breakType"))}</p>
        <span class="confidence-chip conf-${quality.tier}" title="${escapeHtml(quality.title)}">${escapeHtml(quality.text)}</span>
      </div>
      <div class="score-badge ${badgeClass}">
        <span class="score-number">${score.score}</span>
        <span class="score-label">${escapeHtml(score.label)}</span>
      </div>
    </div>
    <p class="spot-read">${escapeHtml(buildSpotRead(scored))}</p>
  `;

  elements.selectedSummary.querySelector("[data-favorite-toggle]")?.addEventListener("click", () => {
    toggleFavorite(beach.id);
  });
  elements.selectedSummary.querySelector("[data-truth-export]")?.addEventListener("click", (event) => {
    exportForecastTruthTemplate(scored, event.currentTarget);
  });

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
      value: `${tideStateWord(sample.tideState, state.lang === "pt")} · ${score.tideTrend}`,
      sub: `${score.tideQuality} · ${t("mslReading", formatSigned(sample.seaLevel))}`,
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
        <div class="metric metric-${escapeHtml(metric.tone)}" aria-label="${escapeHtml(`${metric.label} — ${t("toneWord", metric.tone)}`)}">
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
  const topGroup = view.topGroup?.length
    ? view.topGroup
    : typeof nearTiedEntries === "function"
      ? nearTiedEntries(scoredBeaches, 3)
      : scoredBeaches.filter(
          (entry) => Math.abs(entry.scored.score.score - top.scored.score.score) <= 3,
        );
  const missingBeachNames = state.failedBeachIds
    .map((id) => BEACHES.find((beach) => beach.id === id)?.name)
    .filter(Boolean);
  const visibleRestCount = 2;

  elements.rankedList.innerHTML = `
    <div class="section-head">
      <h2><span class="head-icon material-symbols-rounded" aria-hidden="true">surfing</span>${escapeHtml(t("bestBets"))}</h2>
      <span data-recommendation-scope>${escapeHtml(t("selectedHourScope", title))}</span>
    </div>
    ${missingBeachNames.length ? `<p class="partial-notice" data-partial-notice role="status">${escapeHtml(t("partialDetails", missingBeachNames.join(", ")))}</p>` : ""}
    ${renderTopBet(top, topGroup)}
    <div class="beach-list" id="rankedBeachList" data-rank-list>
      ${rest
        .map((entry, index) => renderBeachRow(entry, !state.rankingsExpanded && index >= visibleRestCount))
        .join("")}
    </div>
    ${rest.length > visibleRestCount ? `<button class="rank-toggle" type="button" data-rank-toggle aria-expanded="${state.rankingsExpanded}" aria-controls="rankedBeachList">${escapeHtml(state.rankingsExpanded ? t("showFewer") : t("showAllBeaches", scoredBeaches.length))}<span class="material-symbols-rounded" aria-hidden="true">${state.rankingsExpanded ? "expand_less" : "expand_more"}</span></button>` : ""}
  `;

  elements.rankedList.querySelectorAll("[data-beach-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectBeach(row.dataset.beachId);
    });
  });
  elements.rankedList.querySelector("[data-rank-toggle]")?.addEventListener("click", () => {
    state.rankingsExpanded = !state.rankingsExpanded;
    renderRankedList(view);
  });
}

function renderTopBet({ beach, scored }, topGroup = []) {
  const sample = scored.sample;
  const score = scored.score.score;
  const tier = pinClass(score).replace("pin-", "");
  const quality = confidenceMeta(scored);
  const support = supportFactor(scored.score.parts);
  const limiting = limitingFactor(scored.score.parts);
  const tiedNames = topGroup.map((entry) => entry.beach.name);
  return `
    <button class="bet-hero tier-${tier}" type="button" aria-current="${beach.id === state.selectedBeachId}" data-beach-id="${beach.id}" aria-label="${escapeHtml(`${beach.name} · ${scored.score.label} · ${compactSessionRead(scored)}`)}">
      <span class="bet-hero-decision">
        <span class="bet-hero-score ${pinClass(score)}">${score}</span>
        <span class="bet-hero-body">
          <span class="bet-hero-tag">${escapeHtml(t("topPickAt", scored.score.label, formatHour(state.selectedHour)))}</span>
          <span class="bet-hero-name">${escapeHtml(beach.name)}</span>
          <span class="bet-hero-read">${escapeHtml(compactSessionRead(scored))}</span>
          ${topGroup.length > 1 ? `<span class="top-group-summary" data-top-group>${escapeHtml(t("topGroup", tiedNames.join(" · ")))}</span>` : ""}
          <span class="decision-signals">
            <span class="confidence-chip conf-${quality.tier}" title="${escapeHtml(quality.title)}">${escapeHtml(quality.text)}</span>
            <span>${escapeHtml(t("supportDriver", support.label))}</span>
            <span>${escapeHtml(t("watchDriver", limiting.label))}</span>
          </span>
          <span class="bet-hero-stats">
            <span class="stat"><span class="material-symbols-rounded" aria-hidden="true">waves</span><span class="mono">${formatSwellStat(sample)}</span></span>
            <span class="stat"><span class="material-symbols-rounded" aria-hidden="true">air</span><span class="mono">${degToCompass(sample.windDirection)} ${formatNumber(sample.windSpeed, 0)} km/h</span></span>
          </span>
        </span>
      </span>
      ${renderHeroWindow(beach)}
    </button>
  `;
}

function renderHeroWindow(beach) {
  const timeline = getScoredTimeline(beach, state.selectedDayOffset);
  if (!timeline.length) return "";

  const width = 300;
  const height = 92;
  const insetX = 8;
  const insetY = 10;
  const chartHeight = height - insetY * 2;
  const step = timeline.length > 1 ? (width - insetX * 2) / (timeline.length - 1) : 0;
  const points = timeline.map(({ hour, scored }, index) => {
    const score = scored.score.score;
    const x = insetX + index * step;
    const y = insetY + ((100 - score) / 100) * chartHeight;
    return { hour, score, x, y };
  });
  const line = points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M ${line.replaceAll(" ", " L ")} L ${(width - insetX).toFixed(1)} ${height - insetY} L ${insetX} ${height - insetY} Z`;

  return `
    <span class="bet-hero-window" data-hero-window aria-hidden="true">
      <span class="hero-window-head">
        <span>${escapeHtml(t("hourByHour"))}</span>
        <span class="mono">${String(points[0].hour).padStart(2, "0")}–${String(points.at(-1).hour).padStart(2, "0")}</span>
      </span>
      <svg class="hero-window-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <path class="hero-window-area" d="${area}"></path>
        <polyline class="hero-window-line" points="${line}"></polyline>
        ${points
          .map(
            ({ hour, x, y }) =>
              `<circle class="hero-window-point${hour === state.selectedHour ? " is-current" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${hour === state.selectedHour ? 4 : 2.5}"></circle>`,
          )
          .join("")}
      </svg>
      <span class="hero-window-axis mono"><span>${String(points[0].hour).padStart(2, "0")}</span><span>${String(points[Math.floor(points.length / 2)].hour).padStart(2, "0")}</span><span>${String(points.at(-1).hour).padStart(2, "0")}</span></span>
    </span>
  `;
}

function renderBeachRow({ beach, scored }, hidden = false) {
  const sample = scored.sample;
  const score = scored.score.score;
  return `
    <button class="beach-row" type="button" aria-current="${beach.id === state.selectedBeachId}" data-beach-id="${beach.id}" data-rank-option aria-label="${escapeHtml(`${beach.name} · ${scored.score.label}`)}"${hidden ? " hidden" : ""}>
      <span class="row-score ${pinClass(score)}">${score}</span>
      <span class="row-copy">
        <span class="row-name">${escapeHtml(beach.name)}</span>
        <span class="row-data mono">${formatSwellStat(sample)}</span>
      </span>
      <span class="row-wind mono">${degToCompass(sample.windDirection)} ${formatNumber(sample.windSpeed, 0)}<small> km/h</small></span>
    </button>
  `;
}

function selectBeach(beachId, { revealOnMobile = true } = {}) {
  if (!BEACHES.some((beach) => beach.id === beachId)) return;
  state.selectedBeachId = beachId;
  render();

  if (!revealOnMobile || !isMobileLayout()) return;
  const detail = document.querySelector("#selectedDetail");
  const focusTarget = elements.selectedSummary;
  window.requestAnimationFrame?.(() => {
    focusTarget?.focus?.({ preventScroll: true });
    detail?.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  });
}

function toggleFavorite(beachId) {
  state.favoriteBeachId = state.favoriteBeachId === beachId ? null : beachId;
  try {
    if (state.favoriteBeachId) {
      window.localStorage.setItem("surf-favorite-beach", state.favoriteBeachId);
    } else {
      window.localStorage.removeItem("surf-favorite-beach");
    }
  } catch (error) {
    /* ignore storage failures */
  }
  renderSelectedSummary();
}

function buildForecastTruthTemplate(scored, capturedAt = scored.forecastMetadata?.fetchedAt ?? new Date().toISOString()) {
  const sample = scored.sample;
  const metadata = scored.forecastMetadata ?? {};
  const target = forecastLocalTimeToDate(sample.time);
  const captured = new Date(capturedAt);
  const leadHours = Number.isFinite(target?.getTime()) && Number.isFinite(captured.getTime())
    ? Math.round(((target.getTime() - captured.getTime()) / 3_600_000) * 100) / 100
    : null;
  const timeSlug = sample.time?.slice(11, 16).replace(":", "") ?? "time";
  return {
    id: `${sample.time?.slice(0, 10) ?? "date"}-${scored.beach.id}-${timeSlug}`,
    status: "template",
    beachId: scored.beach.id,
    capturedAt: Number.isFinite(captured.getTime()) ? captured.toISOString() : capturedAt,
    targetTime: target?.toISOString() ?? sample.time,
    forecast: {
      score: scored.score.score,
      rawScore: scored.score.rawScore,
      breakingHeightM: scored.score.detail?.breakingHeight ?? null,
      label: scored.score.label,
      algorithmVersion: scored.score.algorithmVersion,
      leadHours,
      dataQuality: scored.score.dataQuality,
      model: {
        provider: metadata.provider ?? "unknown",
        weatherModel: metadata.weather?.model ?? null,
        marineModel: metadata.marine?.model ?? null,
        weatherGrid: metadata.weather ?? null,
        marineGrid: metadata.marine ?? null,
      },
      rawInputs: {
        waveHeight: sample.waveHeight,
        wavePeriod: sample.wavePeriod,
        waveDirection: sample.waveDirection,
        swellHeight: sample.swellHeight,
        swellPeriod: sample.swellPeriod,
        swellDirection: sample.swellDirection,
        secondarySwellHeight: sample.secondarySwellHeight,
        secondarySwellPeriod: sample.secondarySwellPeriod,
        secondarySwellDirection: sample.secondarySwellDirection,
        windWaveHeight: sample.windWaveHeight,
        windWavePeriod: sample.windWavePeriod,
        windWaveDirection: sample.windWaveDirection,
        windSpeed: sample.windSpeed,
        windDirection: sample.windDirection,
        windGusts: sample.windGusts,
        tideState: sample.tideState,
        precipitationProbability: sample.precipitationProbability,
        cloudCover: sample.cloudCover,
      },
    },
    observed: {
      rating: null,
      heightM: null,
      cleanliness: "",
      board: "",
      rater: "",
      crowd: null,
      accessNotes: "",
      notes: "",
    },
    tags: [],
  };
}

function forecastLocalTimeToDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour + SAO_PAULO_UTC_OFFSET_HOURS, minute));
}

function exportForecastTruthTemplate(scored, button) {
  const entry = buildForecastTruthTemplate(scored);
  const text = `${JSON.stringify(entry, null, 2)}\n`;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${entry.id}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  button.setAttribute("aria-label", t("truthDownloaded", scored.beach.name));
  button.title = t("truthDownloaded", scored.beach.name);
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
      selectBeach(item.dataset.beachId);
    });
  });
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
  const dayBest = bestScoredEntry(getDayScan(state.selectedDayOffset));
  const peakScope = dayBest
    ? t("dayPeakScope", dayBest.beach.name, formatHour(dayBest.hour))
    : t("daySummary");
  elements.dayOverview.innerHTML = `
    <div class="day-overview-score ${pinClass(day.peakScore)}">
      <span class="day-overview-number">${day.peakScore}</span>
      <span class="day-overview-tier">${escapeHtml(day.peakLabel)}</span>
    </div>
    <div class="day-overview-body">
      <span class="panel-eyebrow"><span class="material-symbols-rounded" aria-hidden="true">today</span>${escapeHtml(`${day.eyebrow} · ${peakScope}`)}</span>
      <p class="day-overview-text">${escapeHtml(day.text)}</p>
    </div>
  `;
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

function renderLegend() {
  const legend = document.querySelector(".map-legend");
  if (!legend) return;
  legend.innerHTML = SCORE_TIERS.map((tier) => {
    const range = tier.min === 0 ? "&lt;38" : `${tier.min}+`;
    return `<span><i class="legend-swatch ${tier.swatch}"></i><b>${range}</b> ${escapeHtml(scoreLabel(tier.min))}</span>`;
  }).join("");
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
