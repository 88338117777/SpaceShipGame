// Browser acceptance through the official opaque-origin iframe. No state mutation or skips.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { ANCHORS, anchorGrip, PACKS, podPosition, V } from "../src/physics.mjs";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = path.resolve(import.meta.dirname, "..");
const server = http.createServer(async (req, res) => {
  try {
    let file = path.resolve(
      root,
      "." + decodeURIComponent(req.url.split("?")[0]),
    );
    if (!file.startsWith(root + path.sep)) throw Error("path");
    if ((await fs.stat(file)).isDirectory())
      file = path.join(file, "index.html");
    const bytes = await fs.readFile(file);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[path.extname(file)] || "application/octet-stream",
    );
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
let browser;
const errors = [];
try {
  await fs.mkdir(path.join(root, "output"), { recursive: true });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/participant-delivery-kit-v3.3.2/mock-runner.html`,
  );
  await page
    .locator("#gameUrl")
    .fill(`http://127.0.0.1:${server.address().port}/game/`);
  await page
    .locator("#manifestPicker")
    .setInputFiles(path.join(root, "game/global-items.json"));
  await page.locator("#presetSelect").selectOption("wounded");
  const save = JSON.parse(await page.locator("#saveJson").inputValue());
  save.items = [];
  await page.locator("#saveJson").fill(JSON.stringify(save));
  await page.waitForFunction(() =>
    document.getElementById("logBox").textContent.includes("0 件"),
  );
  await page.evaluate(() => {
    window.received = [];
    window.addEventListener("message", (e) => window.received.push(e.data));
  });
  await page.locator("#btnLaunch").click();
  let frame = await (
    await page.locator("#gameFrame").elementHandle()
  ).contentFrame();
  await frame.waitForFunction(() => window.__telemetry?.hp === 1);
  await page.screenshot({ path: path.join(root, "output/eva-opening.png") });
  await frame.locator("#sound-enabled").uncheck();
  await frame.locator("#modal-primary").click();
  const start = Date.now();
  const telemetry = () => frame.evaluate(() => window.__telemetry);
  // Drive the same input handlers as a mouse and keyboard, never mutate game state.
  await frame.waitForFunction(
    () => document.pointerLockElement === document.getElementById("space"),
    null,
    { timeout: 5000 },
  );
  async function input(keys) {
    await frame.evaluate((keys) => {
      window.testKeys ??= [];
      for (const code of new Set([...window.testKeys, ...keys])) {
        const down = keys.includes(code);
        if (down !== window.testKeys.includes(code))
          document.dispatchEvent(
            new KeyboardEvent(down ? "keydown" : "keyup", {
              code,
              bubbles: true,
            }),
          );
      }
      window.testKeys = keys;
    }, keys);
  }
  async function press(code) {
    await frame.evaluate((code) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code, bubbles: true }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keyup", { code, bubbles: true }),
      );
    }, code);
  }
  async function aim(p) {
    await frame.evaluate((p) => {
      for (let i = 0; i < 15; i++) {
        const s = window.__telemetry.state,
          d = p.map((n, i) => n - s.p[i]);
        const yaw = Math.atan2(d[0], -d[2]),
          pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
        const dyaw = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw));
        const e = new MouseEvent("mousemove", { bubbles: true });
        Object.defineProperty(e, "movementX", { value: dyaw / 0.0022 });
        Object.defineProperty(e, "movementY", {
          value: -(pitch - s.pitch) / 0.0022,
        });
        document.dispatchEvent(e);
      }
    }, p);
  }
  async function fly(p) {
    for (let i = 0; i < 500; i++) {
      const t = await telemetry();
      assert.equal(t.phase, "active");
      await aim(p);
      const d = V.dist(t.state.p, p),
        speed = V.len(t.state.v);
      if (d < 1.5 && speed < 1.4) {
        await input([]);
        return;
      }
      const keys = [];
      if (d > 1.3) keys.push("KeyW");
      if (d > 9) keys.push("ShiftLeft");
      if (d < 4 + speed * 0.5) keys.push("KeyX");
      await input(keys);
      await page.waitForTimeout(100);
    }
    throw Error("Flight stalled before " + p);
  }
  await fly(PACKS[0].p);
  await aim(PACKS[0].p);
  await press("KeyE");
  for (const a of ANCHORS.slice(1)) {
    if (a.id === "rail-2") await fly([3, 3, -27]);
    if (a.id === "rail-3") await fly([2, 1, -56]);
    if (a.id === "rail-4") await fly([4, 0, -65]);
    await fly(anchorGrip(a));
    await aim(anchorGrip(a));
    await press("KeyE");
    await frame.waitForFunction(
      (id) => window.__telemetry.state.anchor === id,
      a.id,
    );
    await page.waitForTimeout(550);
    const pack = PACKS.find((p) => V.dist(p.p, a.p) < 3);
    if (pack) {
      await aim(pack.p);
      await press("KeyE");
    }
    if ((await telemetry()).state.leak) {
      await input(["KeyR"]);
      await page.waitForTimeout(3100);
      await input([]);
    }
    if (a.id === "rail-2" || a.id === "rail-4")
      await page.screenshot({
        path: path.join(root, `output/eva-${a.id}.png`),
      });
    await aim([a.p[0], a.p[1], a.p[2] - 10]);
    await press("KeyE");
  }
  await fly(podPosition((await telemetry()).state.time));
  await aim(podPosition((await telemetry()).state.time));
  await press("KeyE");
  await frame.waitForFunction(() => window.__telemetry.phase === "won", null, {
    timeout: 15000,
  });
  const elapsed = (Date.now() - start) / 1000;
  assert.ok(elapsed < 270);
  assert.equal((await telemetry()).hp, 1);
  await page.screenshot({ path: path.join(root, "output/eva-ending.png") });
  const wins = await page.evaluate(() =>
    window.received.filter((e) => e.type === "IW_COMPLETE"),
  );
  assert.equal(wins.length, 1);
  assert.deepEqual(wins[0].acquiredItemIds, []);
  await page.locator("#btnLaunch").click();
  frame = await (
    await page.locator("#gameFrame").elementHandle()
  ).contentFrame();
  await frame.waitForFunction(() => window.__telemetry?.phase === "intro");
  await frame.locator("#modal-primary").click();
  await press("Escape");
  await frame.locator("#abort-button").click();
  await frame.locator("#modal-primary").click();
  await page.waitForFunction(() =>
    window.received.some((e) => e.type === "IW_FAIL"),
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "output/browser-result.json"),
    JSON.stringify(
      {
        version: "first-person-eva",
        date: new Date().toISOString(),
        elapsed,
        passed: true,
        errors,
        browser: await browser.version(),
        note: "Automated normal inputs; human playtest still required.",
      },
      null,
      2,
    ),
  );
  console.log(`Browser route passed in ${elapsed.toFixed(2)} seconds.`);
} catch (error) {
  await fs.mkdir(path.join(root, "output"), { recursive: true });
  await fs.writeFile(
    path.join(root, "output/browser-result.json"),
    JSON.stringify(
      {
        version: "first-person-eva",
        date: new Date().toISOString(),
        passed: false,
        error: String(error),
        errors,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  server.close();
}
