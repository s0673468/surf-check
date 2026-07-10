import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHROME_PATH = findChrome();
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
];

test(
  "rendered app preserves its mobile decision flow, accessibility, and failure states",
  {
    timeout: 30_000,
    skip:
      CHROME_PATH || process.env.CI === "true"
        ? false
        : "Chrome or Chromium is not installed",
  },
  async (t) => {
    assert.ok(CHROME_PATH, "Chrome or Chromium is required when the browser gate runs in CI");
    const server = await startStaticServer();
    let browser;
    try {
      browser = await launchChrome(CHROME_PATH);
    } catch (error) {
      await server.close();
      throw error;
    }
    let page;
    try {
      page = await connectPage(browser.debugPort);
    } catch (error) {
      await browser.close();
      await server.close();
      throw error;
    }
    const browserErrors = [];
    let scenario = "complete";

    page.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      browserErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
    });
    page.on("Fetch.requestPaused", async (request) => {
      try {
        await fulfillRequest(page, request, scenario);
      } catch (error) {
        page.fail(error);
      }
    });

    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("Fetch.enable", {
        patterns: [{ urlPattern: "https://*", requestStage: "Request" }],
      });

      async function load(nextScenario = "complete", viewport = VIEWPORTS[1]) {
        scenario = nextScenario;
        browserErrors.length = 0;
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.width <= 720,
        });
        await page.send("Page.navigate", { url: `${server.url}/index.html?browser-smoke=${scenario}` });
        await page.waitFor(
          scenario === "error"
            ? `document.querySelector('[role="alert"] [data-retry]')`
            : `document.querySelector('.bet-hero') && document.querySelector('.dashboard')?.getAttribute('aria-busy') === 'false'`,
        );
        assert.deepEqual(browserErrors, [], `browser errors in ${scenario} scenario`);
      }

      await t.test("puts the recommendation first and expands beyond the top three", async () => {
        await load("complete", VIEWPORTS[1]);
        const initial = await page.evaluate(`(() => {
          const recommendation = document.querySelector('[data-recommendations]');
          const controls = document.querySelector('.control-strip');
          const rows = [...recommendation.querySelectorAll('[data-beach-id]')];
          const expand = document.querySelector('[data-rank-toggle]');
          const visible = (element) => element && !element.hidden && getComputedStyle(element).display !== 'none';
          return {
            firstInMain: recommendation === document.querySelector('main')?.firstElementChild,
            recommendationTop: recommendation?.getBoundingClientRect().top,
            controlsTop: controls?.getBoundingClientRect().top,
            recommendationVisible: visible(recommendation),
            visibleBeachChoices: rows.filter(visible).length,
            totalBeachChoices: rows.length,
            hasExpand: Boolean(expand),
            expanded: expand?.getAttribute('aria-expanded'),
            controlsList: expand?.getAttribute('aria-controls'),
            topGroup: document.querySelector('[data-top-group]')?.textContent.trim() ?? null,
            scope: document.querySelector('[data-recommendation-scope]')?.textContent.trim(),
          };
        })()`);

        assert.equal(initial.firstInMain, true);
        assert.equal(initial.recommendationVisible, true);
        assert.ok(
          initial.recommendationTop < initial.controlsTop,
          `recommendation should precede controls on mobile (${initial.recommendationTop} vs ${initial.controlsTop})`,
        );
        assert.equal(initial.visibleBeachChoices, 3);
        assert.ok(initial.totalBeachChoices > initial.visibleBeachChoices);
        assert.equal(initial.hasExpand, true);
        assert.equal(initial.expanded, "false");
        assert.equal(initial.controlsList, "rankedBeachList");
        assert.ok(initial.topGroup === null || initial.topGroup.length > 0);
        assert.ok(initial.scope.length > 0);

        await page.evaluate(`document.querySelector('[data-rank-toggle]').click()`);
        await page.waitFor(`document.querySelectorAll('[data-recommendations] [data-beach-id]:not([hidden])').length > 3`);
        assert.equal(
          await page.evaluate(`document.querySelector('[data-rank-toggle]').getAttribute('aria-expanded')`),
          "true",
        );
      });

      await t.test("localizes the rendered interface and selection reveals matching detail", async () => {
        await page.evaluate(`document.querySelector('[data-lang="en"]').click()`);
        await page.waitFor(`document.documentElement.lang === 'en'`);
        const localized = await page.evaluate(`({
          title: document.title,
          heading: document.querySelector('.brand h1')?.textContent.trim(),
          controls: document.querySelector('.control-strip')?.getAttribute('aria-label'),
          englishPressed: document.querySelector('[data-lang="en"]')?.getAttribute('aria-pressed'),
        })`);
        assert.match(localized.title, /Surf check/i);
        assert.match(localized.heading, /Surf check/i);
        assert.equal(localized.controls, "Forecast controls");
        assert.equal(localized.englishPressed, "true");

        const picked = await page.evaluate(`(() => {
          const choice = document.querySelectorAll('[data-recommendations] [data-beach-id]')[1];
          const name = choice?.querySelector('.row-name, .bet-hero-name')?.textContent.trim()
            ?? choice?.getAttribute('aria-label')?.split(' · ')[0];
          choice?.click();
          return name;
        })()`);
        assert.ok(picked);
        await page.waitFor(`document.querySelector('#selectedSummary .beach-name')?.textContent.trim() === ${JSON.stringify(picked)}`);
        await page.waitFor(`document.activeElement === document.querySelector('#selectedSummary')`);
        const selection = await page.evaluate(`({
          detail: document.querySelector('#selectedSummary .beach-name')?.textContent.trim(),
          current: document.querySelector('[data-recommendations] [aria-current="true"]')?.getAttribute('data-beach-id'),
          detailHook: Boolean(document.querySelector('[data-selected-detail]')),
          truthExport: Boolean(document.querySelector('[data-truth-export]')),
          focusable: document.querySelector('#selectedSummary')?.getAttribute('tabindex'),
          focused: document.activeElement === document.querySelector('#selectedSummary'),
        })`);
        assert.equal(selection.detail, picked);
        assert.ok(selection.current);
        assert.equal(selection.detailHook, true);
        assert.equal(selection.truthExport, true);
        assert.equal(selection.focusable, "-1");
        assert.equal(selection.focused, true);
      });

      await t.test("labels the map and every marker with a beach, score, and tier", async () => {
        const mapA11y = await page.evaluate(`(() => {
          const panel = document.querySelector('#mapPanel');
          const toggle = document.querySelector('[data-map-toggle]');
          const body = document.querySelector('[data-map-content]');
          const markers = [...document.querySelectorAll('.map-pin')];
          return {
            label: panel?.getAttribute('aria-label'),
            expanded: toggle?.getAttribute('aria-expanded'),
            controls: toggle?.getAttribute('aria-controls'),
            bodyId: body?.id,
            activation: document.querySelector('[data-map-activate]')?.getAttribute('aria-pressed'),
            markerCount: markers.length,
            markerLabels: markers.map((marker) => marker.getAttribute('aria-label') ?? marker.title ?? ''),
          };
        })()`);
        assert.ok(mapA11y.label?.length > 0);
        assert.equal(mapA11y.expanded, "false");
        assert.equal(mapA11y.controls, "mapContent");
        assert.equal(mapA11y.bodyId, "mapContent");
        assert.ok(["false", "true"].includes(mapA11y.activation));
        assert.equal(mapA11y.markerCount, 11);
        for (const label of mapA11y.markerLabels) {
          assert.match(label, /\S+.+\b\d{1,3}\b.+\S+/);
        }
      });

      await t.test("renders partial and total API failure states", async () => {
        await load("partial", VIEWPORTS[1]);
        const partial = await page.evaluate(`({
          status: document.querySelector('#statusText')?.textContent.trim(),
          choices: document.querySelectorAll('[data-recommendations] [data-beach-id]').length,
          missing: document.querySelector('[data-partial-notice]')?.textContent.trim() ?? '',
          missingRole: document.querySelector('[data-partial-notice]')?.getAttribute('role'),
        })`);
        assert.match(partial.status, /10\/11|10 of 11/i);
        assert.equal(partial.choices, 10);
        assert.ok(partial.missing.length > 0, "partial state should identify unavailable beaches");
        assert.equal(partial.missingRole, "status");

        await load("error", VIEWPORTS[1]);
        const failure = await page.evaluate(`({
          alert: document.querySelector('[role="alert"]')?.textContent.trim(),
          retry: document.querySelector('[role="alert"] [data-retry]')?.textContent.trim(),
        })`);
        assert.ok(failure.alert.length > 0);
        assert.ok(failure.retry.length > 0);
      });

      await t.test("never overflows horizontally at supported widths", async () => {
        for (const viewport of VIEWPORTS) {
          await load("complete", viewport);
          const dimensions = await page.evaluate(`({
            client: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
          })`);
          assert.ok(
            dimensions.scroll <= dimensions.client + 1 && dimensions.body <= dimensions.client + 1,
            `${viewport.width}px viewport overflows: ${JSON.stringify(dimensions)}`,
          );
        }
      });
    } finally {
      try {
        await page.send("Browser.close");
      } catch (error) {
        // The browser may close the CDP socket before acknowledging the command.
      }
      await page.close();
      await browser.close();
      await server.close();
    }
  },
);

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find(existsSync) ?? null;
}

async function launchChrome(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), "surf-browser-smoke-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-sync",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const portFile = join(profile, "DevToolsActivePort");
  let debugPort;
  try {
    debugPort = await waitForValue(() => {
      if (!existsSync(portFile)) return null;
      return Number(readFileSync(portFile, "utf8").split("\n")[0]) || null;
    }, 10_000, "Chrome did not expose a DevTools port");
  } catch (error) {
    await stopChildProcess(child);
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }

  return {
    debugPort,
    async close() {
      await stopChildProcess(child);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

async function connectPage(debugPort) {
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
    signal: AbortSignal.timeout(5_000),
  }).then((response) => response.json());
  const target = targets.find((candidate) => candidate.type === "page");
  assert.ok(target?.webSocketDebuggerUrl, "Chrome page target is unavailable");
  return CdpSession.connect(target.webSocketDebuggerUrl);
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.failure = null;
    socket.addEventListener("message", (event) => this.receive(JSON.parse(event.data)));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await Promise.race([
      new Promise((resolvePromise, rejectPromise) => {
        socket.addEventListener("open", resolvePromise, { once: true });
        socket.addEventListener("error", rejectPromise, { once: true });
      }),
      new Promise((_, rejectPromise) =>
        setTimeout(() => rejectPromise(new Error("Timed out connecting to Chrome DevTools")), 5_000),
      ),
    ]);
    return new CdpSession(socket);
  }

  receive(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    for (const handler of this.handlers.get(message.method) ?? []) {
      Promise.resolve(handler(message.params)).catch((error) => this.fail(error));
    }
  }

  send(method, params = {}) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Timed out waiting for Chrome DevTools method ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectPromise(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  fail(error) {
    this.failure ??= error;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 10_000) {
    return waitForValue(async () => {
      if (this.failure) throw this.failure;
      return (await this.evaluate(`Boolean(${expression})`)) || null;
    }, timeoutMs, `Timed out waiting for: ${expression}`);
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise((resolvePromise) =>
      this.socket.addEventListener("close", resolvePromise, { once: true }),
    );
    this.socket.close();
    await Promise.race([
      closed,
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
    ]);
  }
}

async function fulfillRequest(page, { requestId, request }, scenario) {
  const url = new URL(request.url);
  if (url.hostname === "api.rainviewer.com") {
    await page.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Access-Control-Allow-Origin", value: "*" },
      ],
      body: Buffer.from(JSON.stringify(rainViewerFixture())).toString("base64"),
    });
    return;
  }
  if (url.hostname === "api.open-meteo.com" || url.hostname === "marine-api.open-meteo.com") {
    const latitude = url.searchParams.get("latitude");
    if (scenario === "error" || (scenario === "partial" && latitude === "-27.6031328")) {
      await page.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 400,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from('{"error":true}').toString("base64"),
      });
      return;
    }
    const payload = url.hostname === "api.open-meteo.com"
      ? weatherFixture(latitude)
      : marineFixture(latitude);
    await page.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Access-Control-Allow-Origin", value: "*" },
      ],
      body: Buffer.from(JSON.stringify(payload)).toString("base64"),
    });
    return;
  }

  const contentType = url.pathname.endsWith(".css") ? "text/css" : "application/javascript";
  await page.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: "Content-Type", value: contentType },
      { name: "Access-Control-Allow-Origin", value: "*" },
    ],
    body: "",
  });
}

function fixtureTimes() {
  const values = [];
  for (let offset = 0; offset < 4; offset += 1) {
    const target = new Date(Date.now() + offset * 86_400_000);
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(target);
    for (let hour = 0; hour < 24; hour += 1) {
      values.push(`${date}T${String(hour).padStart(2, "0")}:00`);
    }
  }
  return values;
}

function weatherFixture(latitude) {
  const time = fixtureTimes();
  const beachDelta = Math.abs(Math.round(Number(latitude) * 10_000)) % 6;
  const series = (callback) => time.map((_, index) => callback(index));
  return {
    hourly: {
      time,
      temperature_2m: series((index) => 22 + (index % 8) * 0.3),
      apparent_temperature: series((index) => 23 + (index % 8) * 0.3),
      precipitation_probability: series((index) => (index % 24 > 15 ? 35 : 12)),
      cloud_cover: series((index) => 25 + (index % 5) * 8),
      wind_speed_10m: series((index) => 4 + beachDelta + (index % 4)),
      wind_direction_10m: series(() => 285),
      wind_gusts_10m: series((index) => 8 + beachDelta + (index % 4)),
    },
  };
}

function marineFixture(latitude) {
  const time = fixtureTimes();
  const beachDelta = (Math.abs(Math.round(Number(latitude) * 10_000)) % 7) * 0.05;
  const series = (callback) => time.map((_, index) => callback(index));
  return {
    hourly: {
      time,
      wave_height: series((index) => 1.05 + beachDelta + (index % 4) * 0.04),
      wave_direction: series(() => 120),
      wave_period: series((index) => 9 + (index % 3) * 0.4),
      swell_wave_height: series(() => 0.9 + beachDelta),
      swell_wave_direction: series(() => 120),
      swell_wave_period: series(() => 10),
      secondary_swell_wave_height: series(() => 0.25),
      secondary_swell_wave_direction: series(() => 95),
      secondary_swell_wave_period: series(() => 12),
      wind_wave_height: series(() => 0.2),
      wind_wave_direction: series(() => 130),
      wind_wave_period: series(() => 4.5),
      sea_level_height_msl: series((index) => 0.25 + Math.sin(index / 2) * 0.45),
      sea_surface_temperature: series(() => 22),
    },
  };
}

function rainViewerFixture() {
  const now = Math.floor(Date.now() / 1000);
  return {
    host: "https://mock-radar.invalid",
    radar: {
      past: [{ time: now - 600, path: "/browser-smoke/past" }],
      nowcast: [{ time: now, path: "/browser-smoke/now" }],
    },
  };
}

async function startStaticServer() {
  const mime = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  const server = createServer((request, response) => {
    const requested = new URL(request.url, "http://localhost").pathname;
    const relative = normalize(decodeURIComponent(requested)).replace(/^[/\\]+/, "");
    const path = resolve(PROJECT_ROOT, relative || "index.html");
    if (!path.startsWith(`${PROJECT_ROOT}/`) || !existsSync(path)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mime[extname(path)] ?? "application/octet-stream",
    });
    response.end(readFileSync(path));
  });
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise) => {
      for (const socket of sockets) socket.destroy();
      server.close(resolvePromise);
    }),
  };
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 2_000)),
  ]);
  if (exited || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGKILL");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
  ]);
}

async function waitForValue(callback, timeoutMs, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await callback();
    if (value) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(message);
}
