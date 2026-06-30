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
    <span>${escapeHtml(formatDayHour(view.dayOffset, view.hour))}</span>
    <strong>${escapeHtml(label)}</strong>
  `;
}

function updateMarkers(view = getForecastView()) {
  for (const beach of BEACHES) {
    const marker = state.markers.get(beach.id);
    const scored = view.scoredByBeachId.get(beach.id);
    const score = scored?.score?.score;
    const label = Number.isFinite(score) ? String(Math.round(score)) : "--";

    if (state.map && marker?.setIcon) {
      // Only rebuild the divIcon when the rounded label (and thus the tier)
      // actually changed — a slider drag otherwise mints 11 fresh icons per step.
      if (marker.__label !== label) {
        marker.setIcon(makeMarkerIcon(score));
        marker.__label = label;
      }
      marker.setZIndexOffset(beach.id === state.selectedBeachId ? 1000 : 0);
    } else if (marker) {
      marker.className = `fallback-pin map-pin ${pinClass(score)}`;
      marker.textContent = label;
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
  const conf = confidenceMeta(scored);
  elements.selectedSummary.innerHTML = `
    <span class="panel-eyebrow">${escapeHtml(t("selectedSpot"))}</span>
    <div class="summary-top">
      <div>
        <h2 class="beach-name">${escapeHtml(beach.name)}</h2>
        <p class="beach-meta">${escapeHtml(formatDayHour(view.dayOffset, view.hour))} · ${escapeHtml(tBeach(beach, "breakType"))}</p>
        <span class="confidence-chip conf-${conf.tier}" title="${escapeHtml(conf.title)}">${escapeHtml(conf.text)}</span>
      </div>
      <div class="score-badge ${badgeClass}">
        <span class="score-number">${score.score}</span>
        <span class="score-label">${escapeHtml(score.label)}</span>
      </div>
    </div>
    <p class="spot-read">${escapeHtml(buildSpotRead(scored))}</p>
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
    <button class="bet-hero tier-${tier}" type="button" aria-current="${beach.id === state.selectedBeachId}" data-beach-id="${beach.id}" aria-label="${escapeHtml(`${beach.name} · ${scored.score.label} · ${compactSessionRead(scored)}`)}">
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
    <button class="beach-row" type="button" aria-current="${beach.id === state.selectedBeachId}" data-beach-id="${beach.id}" aria-label="${escapeHtml(`${beach.name} · ${scored.score.label}`)}">
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

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return NaN;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function valueAt(hourly, key, index) {
  return numericCell(hourly?.[key]?.[index]);
}

function numericCell(value) {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === null || normalized === undefined || normalized === "") return null;
  const numeric = Number(normalized);
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
