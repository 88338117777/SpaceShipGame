// Actual keyboard/mouse gameplay + official protocol; WebGL and sound are stubbed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as physics from "../src/physics.mjs";
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_PATH || "jsdom");
const source = fs
  .readFileSync(new URL("../src/main.mjs", import.meta.url), "utf8")
  .replace(
    /import\s*\{\s*View\s*\}\s*from\s*["']\.\/view\.mjs["'];/,
    "const View=window.TestView;",
  )
  .replace(
    /import\s*\{\s*SuitAudio\s*\}\s*from\s*["']\.\/audio\.mjs["'];/,
    "const SuitAudio=window.TestAudio;",
  )
  .replace(
    /import\s*\{([^}]+)\}\s*from\s*["']\.\/physics\.mjs["'];/,
    "const {$1}=window.physics;",
  );
function setup({ hp = 1, deaths = 0 } = {}) {
  const dom = new JSDOM(
      fs.readFileSync(new URL("../game/index.html", import.meta.url), "utf8"),
      { url: "https://local.test/game/", runScripts: "outside-only" },
    ),
    w = dom.window;
  let now = 1000,
    raf = null,
    locked = null;
  const messages = [],
    held = new Set();
  const host = { postMessage: (m) => messages.push(m) };
  Object.defineProperty(w, "parent", { value: host });
  Object.defineProperty(w.performance, "now", { value: () => now });
  Object.defineProperty(w.document, "pointerLockElement", {
    get: () => locked,
  });
  w.document.getElementById("space").requestPointerLock = () => {
    locked = w.document.getElementById("space");
    w.document.dispatchEvent(new w.Event("pointerlockchange"));
  };
  w.document.exitPointerLock = () => {
    locked = null;
    w.document.dispatchEvent(new w.Event("pointerlockchange"));
  };
  w.requestAnimationFrame = (f) => {
    raf = f;
  };
  w.setTimeout = (f) => {
    f();
    return 0;
  };
  w.structuredClone = structuredClone;
  w.physics = physics;
  w.TestView = class {
    render() {}
    hit() {}
  };
  w.TestAudio = class {
    constructor() {
      this.enabled = true;
    }
    start() {}
    tone() {}
    update() {}
  };
  w.eval(
    fs.readFileSync(
      new URL("../game/shared/save-protocol.js", import.meta.url),
      "utf8",
    ),
  );
  w.GameProtocol = {
    read: () => w.WL.readSave(),
    complete: (save, options) =>
      w.WL.completeLevel(w.CONFIG || {}, save, options),
  };
  w.eval(source);
  const seed = JSON.parse(
    fs.readFileSync(
      new URL(
        "../participant-delivery-kit-v3.3.2/seed-card.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  seed.player.hp = hp;
  seed.player.deaths = deaths;
  seed.items = [];
  seed.exit_hook = "前路的真实回声";
  const send = (data) =>
    w.dispatchEvent(new w.MessageEvent("message", { source: host, data }));
  send({
    type: "IW_INIT_SAVE",
    save: seed,
    config: {
      world: "失重第九小时",
      itemManifest: { schema: "iw-global-items-v1", items: [] },
      exitHook: "下一站坐标",
    },
  });
  const advance = (seconds) => {
    for (let i = 0; i < Math.ceil(seconds * 60); i++) {
      now += 1000 / 60;
      const fn = raf;
      raf = null;
      fn(now);
    }
  };
  const state = () => w.__telemetry;
  const click = (id) => {
    w.document.getElementById(id).click();
    advance(0.02);
  };
  const key = (code, down) => {
    if (down === held.has(code)) return;
    w.document.dispatchEvent(
      new w.KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true }),
    );
    if (down) held.add(code);
    else held.delete(code);
  };
  const press = (code) => {
    key(code, true);
    key(code, false);
    advance(0.02);
  };
  const aim = (p) => {
    for (let i = 0; i < 15; i++) {
      const s = state().state,
        a = physics.lookAt(s.p, p);
      let dyaw = a.yaw - s.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const e = new w.MouseEvent("mousemove", { bubbles: true });
      Object.defineProperty(e, "movementX", { value: dyaw / 0.0022 });
      Object.defineProperty(e, "movementY", {
        value: -(a.pitch - s.pitch) / 0.0022,
      });
      w.document.dispatchEvent(e);
    }
  };
  const release = () => {
    for (const code of [...held]) key(code, false);
  };
  const fly = (p) => {
    for (let i = 0; i < 500; i++) {
      const s = state().state;
      assert.equal(state().phase, "active");
      aim(p);
      const d = physics.V.dist(s.p, p),
        v = physics.V.len(s.v);
      if (d < 1.5 && v < 1.4) {
        release();
        return;
      }
      key("KeyW", d > 1.3);
      key("ShiftLeft", d > 9);
      key("KeyX", d < 4 + v * 0.5);
      advance(0.1);
    }
    assert.fail("Flight stalled " + state().state.p + " -> " + p);
  };
  advance(0.02);
  return {
    w,
    send,
    messages,
    state,
    advance,
    click,
    key,
    press,
    aim,
    fly,
    release,
    close: () => dom.window.close(),
  };
}
test("late save updates actual HP, initial equipment, assistance and incoming narrative", () => {
  const h = setup({ hp: 1, deaths: 3 });
  assert.equal(h.state().hp, 1);
  assert.equal(h.state().assist, 2);
  assert.equal(h.state().state.tape, 1);
  assert.match(h.w.document.getElementById("previous").textContent, /真实回声/);
  assert.equal(h.w.document.getElementById("execute"), null);
  h.close();
});
test("first five seconds safe; live movement continues after thrust key release", () => {
  const h = setup();
  h.click("modal-primary");
  h.key("KeyW", true);
  h.advance(1);
  h.release();
  const before = h.state().state.p[2];
  h.advance(1);
  assert.ok(h.state().state.p[2] < before - 0.5);
  assert.equal(h.state().state.oxygen, 100);
  h.advance(3.2);
  assert.ok(h.state().state.oxygen < 100);
  assert.equal(h.state().hp, 1);
  h.close();
});
test("pause freezes motion and oxygen but wall-clock mission time continues", () => {
  const h = setup();
  h.click("modal-primary");
  h.advance(6);
  h.click("menu-button");
  const before = h.state();
  h.advance(5);
  assert.equal(h.state().state.oxygen, before.state.oxygen);
  assert.deepEqual(h.state().state.p, before.state.p);
  assert.ok(h.state().elapsed > before.elapsed + 4);
  h.click("modal-primary");
  assert.equal(h.state().phase, "active");
  h.close();
});
test("normal first-person input route completes at 1 HP, including recovery and official handoff", () => {
  const h = setup();
  h.click("modal-primary");
  h.fly(physics.PACKS[0].p);
  h.aim(physics.PACKS[0].p);
  h.press("KeyE");
  assert.equal(h.state().state.tape, 1);
  for (const a of physics.ANCHORS.slice(1)) {
    if (a.id === "rail-2") h.fly([3, 3, -27]);
    if (a.id === "rail-3") h.fly([2, 1, -56]);
    if (a.id === "rail-4") h.fly([4, 0, -65]);
    h.fly(physics.anchorGrip(a));
    h.aim(physics.anchorGrip(a));
    h.press("KeyE");
    assert.equal(h.state().state.anchor, a.id);
    h.advance(0.5);
    const pack = physics.PACKS.find((p) => physics.V.dist(p.p, a.p) < 3);
    if (pack) {
      h.aim(pack.p);
      h.press("KeyE");
      assert.ok(h.state().state.collected.includes(pack.id));
    }
    if (h.state().state.leak && h.state().state.tape) {
      h.key("KeyR", true);
      h.advance(3.1);
      h.release();
      assert.equal(h.state().state.leak, 0);
    }
    h.aim([a.p[0], a.p[1], a.p[2] - 10]);
    h.press("KeyE");
    assert.equal(h.state().state.anchor, null);
  }
  h.fly(physics.podPosition(h.state().state.time));
  h.aim(physics.podPosition(h.state().state.time));
  h.press("KeyE");
  assert.equal(h.state().phase, "recover");
  h.advance(6.7);
  assert.equal(h.state().phase, "won");
  assert.equal(h.state().hp, 1);
  assert.ok(h.state().elapsed < 270);
  const wins = h.messages.filter((m) => m.type === "IW_COMPLETE");
  assert.equal(wins.length, 1);
  assert.equal(wins[0].acquiredItemIds.length, 0);
  h.advance(1);
  assert.equal(h.messages.filter((m) => m.type === "IW_COMPLETE").length, 1);
  console.log(
    `DOM keyboard/mouse route ${h.state().elapsed.toFixed(2)}s; WebGL stubbed, not browser timing.`,
  );
  h.close();
});
test("oxygen exhaustion uses official respawn; repeated deaths unlock both assistance tiers", () => {
  const h = setup();
  h.click("modal-primary");
  h.advance(230);
  assert.equal(h.state().deaths, 1);
  assert.equal(h.state().hp, 1);
  assert.equal(h.state().state.anchor, "airlock");
  h.advance(224);
  assert.equal(h.state().deaths, 2);
  assert.equal(h.state().assist, 1);
  h.advance(225);
  assert.equal(h.state().deaths, 3);
  assert.equal(h.state().assist, 2);
  assert.ok(h.state().state.tape >= 1);
  const before = h.state().state.oxygen;
  h.advance(10);
  assert.ok(Math.abs(before - h.state().state.oxygen - 2.475) < 0.05);
  h.close();
});
test("admin heal synchronizes actual HP and rescue location", () => {
  const h = setup({ hp: 2 });
  h.click("modal-primary");
  h.advance(230);
  assert.equal(h.state().hp, 1);
  assert.equal(h.state().deaths, 0);
  h.send({ type: "IW_ADMIN_COMMAND", command: "heal" });
  assert.equal(h.state().hp, 3);
  assert.equal(h.state().state.oxygen, 100);
  assert.equal(h.state().state.leak, 0);
  h.close();
});
test("surrender cancellation does not hand off; confirmation sends one official failure", () => {
  const h = setup();
  h.click("modal-primary");
  h.click("menu-button");
  h.click("abort-button");
  h.click("modal-secondary");
  assert.equal(h.state().phase, "active");
  assert.equal(h.messages.filter((m) => m.type === "IW_FAIL").length, 0);
  h.click("menu-button");
  h.click("abort-button");
  h.click("modal-primary");
  assert.equal(h.state().phase, "failed");
  assert.equal(h.messages.filter((m) => m.type === "IW_FAIL").length, 1);
  h.close();
});
