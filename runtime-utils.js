// Shared runtime helpers used across scoring, selectors, prose, and rendering.
//
// This stays as a classic script so the app can run directly from a local file
// or static server without a build step. Keep it loaded after surf-config.js and
// before the feature scripts that call these helpers.

function localeTag() {
  return state.lang === "pt" ? "pt-BR" : "en-US";
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
