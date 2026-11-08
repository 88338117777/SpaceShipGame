import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/physics.mjs";
const close = (a, b, t = 1e-7) =>
  assert.ok(P.V.dist(a, b) < t, `${a} differs from ${b}`);
const tick = (s, seconds, input = {}) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds / P.DT); i++)
    events.push(...P.step(s, input));
  return events;
};
function openSpace() {
  const s = P.initial();
  s.p = [15, 12, 0];
  return s;
}
function pointAt(s, p) {
  Object.assign(s, P.lookAt(s.p, p));
}
test("unpowered flight retains 3D momentum without drag", () => {
  const s = openSpace();
  s.v = [0.5, 0.2, -0.7];
  tick(s, 2);
  close(s.p, [16, 12.4, -1.4]);
  close(s.v, [0.5, 0.2, -0.7]);
});
test("camera-relative propulsion and separate vertical control act in three dimensions", () => {
  const s = openSpace();
  s.yaw = 0.7;
  s.pitch = 0.4;
  tick(s, 1, { forward: 1 });
  assert.ok(s.v[0] > 0.3 && s.v[1] > 0.3 && s.v[2] < -0.3);
  const before = s.v[1];
  tick(s, 1, { up: 1 });
  assert.ok(s.v[1] > before + 1);
});
test("boost overheats, normal thrust and emergency braking remain available", () => {
  const s = openSpace();
  const events = tick(s, 4, { forward: 1, boost: true });
  assert.ok(events.some((e) => e.type === "overheat"));
  assert.ok(s.overheated);
  const speed = P.V.len(s.v);
  tick(s, 0.6, { brake: true });
  assert.ok(P.V.len(s.v) < speed * 0.2);
  assert.ok(s.overheated);
  tick(s, 0.4, { side: 1 });
  assert.ok(s.v[0] > 0.3);
  tick(s, 4);
  assert.equal(s.overheated, false);
});
test("pushing a free rock gives equal opposite momentum and is not a fixed foothold", () => {
  const s = P.initial(),
    rock = s.rocks[0];
  s.p = P.V.add(rock.p, [0, 0, 2]);
  pointAt(s, rock.p);
  assert.equal(P.focus(s)?.kind, "rock");
  assert.equal(P.interact(s).type, "push");
  close(P.V.add(s.v, P.V.mul(rock.v, rock.mass)), [0, 0, 0]);
  assert.ok(P.V.len(rock.v) > 0);
  assert.equal(s.pushes, 1);
});
test("first five seconds do not drain oxygen or permit damaging impacts", () => {
  const s = P.initial();
  assert.equal(P.impact(s, [1, 0, 0], 5), false);
  tick(s, 4.9);
  assert.equal(s.oxygen, 100);
  assert.equal(s.leak, 0);
  tick(s, 0.2);
  assert.ok(s.oxygen < 100);
});
test("impacts create persistent capped leaks and cooldown prevents rapid stacking", () => {
  const s = openSpace();
  s.time = 10;
  assert.ok(P.impact(s, [1, 0, 0], 4));
  assert.equal(s.leak, 1);
  assert.equal(P.impact(s, [1, 0, 0], 4), false);
  const before = s.oxygen;
  tick(s, 2);
  assert.ok(before - s.oxygen > 2);
  for (let i = 0; i < 5; i++) {
    s.hitCooldown = 0;
    P.impact(s, [1, 0, 0], 4);
  }
  assert.equal(s.leak, 3);
});
test("repair requires anchoring, tape, and uninterrupted three second hold", () => {
  const s = P.initial();
  s.leak = 2;
  s.tape = 1;
  tick(s, 3.2, { repair: true });
  assert.equal(s.leak, 2);
  pointAt(s, P.anchorGrip(P.ANCHORS[0]));
  assert.equal(P.interact(s).type, "grab");
  tick(s, 1, { repair: true });
  tick(s, 0.1);
  assert.equal(s.repair, 0);
  assert.equal(s.tape, 1);
  tick(s, 3.1, { repair: true });
  assert.equal(s.leak, 0);
  assert.equal(s.tape, 0);
  assert.equal(s.repairs, 1);
});
test("supplies refill oxygen and tape only once", () => {
  const s = P.initial();
  const pack = P.PACKS[0];
  s.p = P.V.add(pack.p, [0, 0, 1]);
  pointAt(s, pack.p);
  s.oxygen = 30;
  assert.equal(P.interact(s).type, "pickup");
  assert.equal(s.oxygen, 50);
  assert.equal(s.tape, 1);
  P.interact(s);
  assert.equal(s.oxygen, 50);
  assert.equal(s.collected.length, 1);
});
test("checkpoint rescue restores nearby position and medical state, not world time", () => {
  const s = P.initial();
  const a = P.ANCHORS[2];
  s.p = P.V.add(P.anchorGrip(a), [0, 0, 1.2]);
  pointAt(s, P.anchorGrip(a));
  assert.equal(P.interact(s).type, "checkpoint");
  P.collectNearby(s);
  s.time = 81;
  s.leak = 3;
  s.oxygen = 0;
  const r = P.restore(s, 2, true);
  close(r.p, a.p);
  assert.equal(r.time, 81);
  assert.equal(r.oxygen, 100);
  assert.equal(r.leak, 0);
  assert.ok(r.tape >= 1);
  assert.ok(r.collected.includes("pack-2"));
});
test("anchored suit is sheltered from impacts and cannot drift while repairing", () => {
  const s = P.initial();
  s.time = 20;
  s.anchor = "airlock";
  s.v = [3, 3, 3];
  assert.equal(P.impact(s, [1, 0, 0], 10), false);
  tick(s, 0.5, { forward: 1, boost: true });
  close(s.p, P.ANCHORS[0].p);
  close(s.v, [0, 0, 0]);
});
test("interaction rays cannot reach through station hull", () => {
  assert.ok(P.occluded([0, 0, 3], [-15, 0, 3]));
  assert.equal(P.occluded([0, 0, 3], [1, 0, 1]), false);
});
test("capture needs proximity, aim and manageable relative approach speed", () => {
  const s = P.initial();
  s.time = 20;
  const pod = P.podPosition(s.time);
  s.p = P.V.add(pod, [0, 0, 2]);
  pointAt(s, pod);
  s.v = [0, 0, -5];
  assert.equal(P.interact(s).type, "too-fast");
  s.v = [0, 0, 0];
  assert.equal(P.interact(s).type, "capture");
  assert.ok(s.captured);
  const t = s.time;
  tick(s, 2);
  assert.equal(s.time, t);
});
test("exhaustion emits once and assistance reduces oxygen use", () => {
  const s = openSpace();
  s.time = 6;
  s.oxygen = 0.01;
  const events = tick(s, 1);
  assert.equal(events.filter((e) => e.type === "exhausted").length, 1);
  assert.ok(s.exhausted);
  const a = openSpace(),
    b = openSpace();
  a.time = b.time = 6;
  b.assist = 2;
  tick(a, 10);
  tick(b, 10);
  assert.ok(Math.abs((100 - b.oxygen) / (100 - a.oxygen) - 0.55) < 0.001);
});
test("normal continuous EVA route can capture the pod under 270 seconds, without damage to HP", () => {
  const s = P.initial();
  const events = [];
  function fly(p) {
    for (let n = 0; n < 35 / P.DT; n++) {
      pointAt(s, p);
      const distance = P.V.dist(s.p, p),
        speed = P.V.len(s.v);
      if (distance < 1.6 && speed < 1.5) return;
      events.push(
        ...P.step(s, {
          forward: distance > 1.4 ? 1 : 0,
          boost: distance > 9,
          brake: distance < 4 + speed * 0.5,
        }),
      );
      assert.equal(s.exhausted, false);
    }
    assert.fail("Route stalled");
  }
  fly(P.PACKS[0].p);
  P.interact(s);
  for (const a of P.ANCHORS.slice(1)) {
    if (a.id === "rail-2") fly([3, 3, -27]);
    if (a.id === "rail-3") fly([2, 1, -56]);
    if (a.id === "rail-4") fly([4, 0, -65]);
    fly(P.anchorGrip(a));
    assert.equal(P.interact(s).type, "checkpoint");
    tick(s, 0.5);
    P.collectNearby(s);
    if (s.leak && s.tape) tick(s, 3.05, { repair: true });
    P.interact(s);
  }
  fly(P.podPosition(s.time));
  assert.equal(P.interact(s).type, "capture");
  assert.ok(s.time + 6.5 < 270);
  assert.ok(s.oxygen > 0);
  assert.ok(events.some((e) => e.type === "hit"));
  console.log(
    `Physics EVA route: ${s.time.toFixed(2)}s + 6.5s recovery; ${s.impacts} impacts, ${s.repairs} repairs. Not browser timing.`,
  );
});
