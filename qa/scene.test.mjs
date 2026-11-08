// Uses real Three.js scene objects; only GPU submission and 2D text drawing are stubbed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as THREE from "../vendor/three.module.js";
import * as physics from "../src/physics.mjs";
const require = createRequire(import.meta.url),
  { JSDOM } = require(process.env.JSDOM_PATH || "jsdom");
function scene() {
  const dom = new JSDOM(
      '<canvas id="space"></canvas><div id="world-markers"></div>',
      { runScripts: "outside-only" },
    ),
    w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    fillText() {},
  });
  w.ResizeObserver = class {
    observe() {}
  };
  w.physics = physics;
  w.THREE = {
    ...THREE,
    WebGLRenderer: class {
      setPixelRatio() {}
      setClearColor() {}
      setSize() {}
      render() {}
    },
  };
  const code = fs
    .readFileSync(new URL("../src/view.mjs", import.meta.url), "utf8")
    .replace(
      /import\s*\*\s*as\s*T\s*from\s*["'][^"']+["'];/,
      "const T=window.THREE;",
    )
    .replace(
      /import\s*\{([^}]+)\}\s*from\s*["']\.\/physics.mjs["'];/,
      "const {$1}=window.physics;",
    )
    .replace("export class View", "window.View=class View");
  w.eval(code);
  const canvas = w.document.getElementById("space");
  Object.defineProperty(canvas, "clientWidth", { value: 1440 });
  Object.defineProperty(canvas, "clientHeight", { value: 900 });
  return { dom, view: new w.View(canvas) };
}
test("camera is first person with correct forward vector and no roll", () => {
  const { dom, view } = scene(),
    s = physics.initial();
  s.yaw = 0.6;
  s.pitch = 0.35;
  view.render(s);
  assert.ok(view.camera.position.distanceTo(new THREE.Vector3(...s.p)) < 1e-8);
  assert.ok(
    view.camera
      .getWorldDirection(new THREE.Vector3())
      .distanceTo(new THREE.Vector3(...physics.forward(s.yaw, s.pitch))) < 1e-8,
  );
  assert.equal(view.camera.rotation.z, 0);
  assert.equal(view.arms.parent, view.camera);
  assert.equal(view.meteors.length, 14);
  dom.window.close();
});
test("grabbing, repairing, and pod recovery render finite scene transforms", () => {
  const { dom, view } = scene(),
    s = physics.initial();
  s.anchor = "airlock";
  s.leak = 2;
  s.tape = 1;
  s.repair = 1.7;
  view.render(s);
  assert.equal(view.left.visible, true);
  assert.equal(view.tapeStrip.visible, true);
  s.anchor = null;
  s.captured = true;
  s.arm = { kind: "capture", age: 0.3, target: physics.podPosition(0) };
  view.render(s, { recovery: 0.5 });
  assert.equal(view.cable.visible, true);
  view.scene.traverse((o) => {
    assert.ok(o.position.toArray().every(Number.isFinite));
    assert.ok(o.quaternion.toArray().every(Number.isFinite));
  });
  dom.window.close();
});
