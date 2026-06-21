const RADAR_METADATA_URL = "https://api.rainviewer.com/public/weather-maps.json";
const RADAR_FRAME_TOLERANCE_MINUTES = 65;
const RADAR_NATIVE_MAX_ZOOM = 7;
const RADAR_OPACITY = 0.42;

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
  const host =
    typeof metadata?.host === "string" ? metadata.host.trim().replace(/\/+$/, "") : "";
  const past = Array.isArray(metadata?.radar?.past) ? metadata.radar.past : [];
  const nowcast = Array.isArray(metadata?.radar?.nowcast) ? metadata.radar.nowcast : [];
  const frames = [...past, ...nowcast]
    .map((frame) => {
      const rawPath =
        typeof frame?.path === "string" ? frame.path.trim().replace(/^\/+/, "") : "";
      return {
        time: numericCell(frame?.time),
        path: rawPath ? `/${rawPath}` : "",
      };
    })
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
  const base = typeof host === "string" ? host.trim().replace(/\/+$/, "") : "";
  const path =
    typeof frame?.path === "string" ? frame.path.trim().replace(/^\/+/, "") : "";
  if (!base || !path) return "";
  return `${base}/${path}/256/{z}/{x}/{y}/2/1_1.png`;
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
