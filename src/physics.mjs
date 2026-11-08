import {
  ANCHORS,
  anchorGrip,
  BOXES,
  PACKS,
  ROCKS,
  METEORS,
  meteorPosition,
  podPosition,
} from "./world.mjs";
export {
  ANCHORS,
  anchorGrip,
  BOXES,
  PACKS,
  ROCKS,
  METEORS,
  meteorPosition,
  podPosition,
};
export const DT = 1 / 120;
export const V = {
  add: (a, b) => a.map((v, i) => v + b[i]),
  sub: (a, b) => a.map((v, i) => v - b[i]),
  mul: (a, n) => a.map((v) => v * n),
  dot: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  len: (a) => Math.hypot(...a),
  dist: (a, b) => Math.hypot(...a.map((v, i) => v - b[i])),
};
V.unit = (a) => (V.len(a) > 1e-9 ? V.mul(a, 1 / V.len(a)) : [0, 0, 0]);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function forward(yaw, pitch) {
  return [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
}
export function lookAt(from, to) {
  const d = V.sub(to, from);
  return {
    yaw: Math.atan2(d[0], -d[2]),
    pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])),
  };
}
export function initial(assist = 0) {
  return {
    p: [0, 0, 4],
    v: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    time: 0,
    oxygen: 100,
    heat: 0,
    overheated: false,
    boosting: false,
    braking: false,
    leak: 0,
    tape: assist >= 2 ? 1 : 0,
    repair: 0,
    anchor: null,
    checkpoint: 0,
    collected: [],
    checkpointItems: [],
    checkpointTape: 0,
    assist,
    hitCooldown: 0,
    arm: { kind: "idle", age: 10, target: null },
    outside: 0,
    exhausted: false,
    captured: false,
    rocks: ROCKS.map((r) => ({ ...r, p: [...r.p], v: [0, 0, 0], cooldown: 0 })),
    pushes: 0,
    repairs: 0,
    impacts: 0,
  };
}
export function restore(s, assist, medical = true) {
  const a = ANCHORS[s.checkpoint],
    oldOxygen = s.oxygen;
  return {
    ...s,
    p: [...a.p],
    v: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    oxygen: medical ? 100 : Math.max(0, oldOxygen - 15),
    heat: 0,
    overheated: false,
    boosting: false,
    braking: false,
    leak: medical ? 0 : s.leak,
    repair: 0,
    anchor: a.id,
    outside: 0,
    exhausted: false,
    hitCooldown: 4,
    assist,
    tape: medical ? Math.max(s.checkpointTape, assist >= 2 ? 1 : 0) : s.tape,
    collected: medical ? [...s.checkpointItems] : [...s.collected],
    rocks: medical
      ? ROCKS.map((r) => ({ ...r, p: [...r.p], v: [0, 0, 0], cooldown: 0 }))
      : s.rocks,
    arm: { kind: "grab", age: 0, target: anchorGrip(a) },
  };
}
// Segment-AABB test keeps interactions from reaching through hulls or debris panels.
export function occluded(from, to) {
  const d = V.sub(to, from);
  return BOXES.some((b) => {
    let lo = 0,
      hi = 1;
    for (let k = 0; k < 3; k++) {
      const min = b.p[k] - b.size[k] / 2,
        max = b.p[k] + b.size[k] / 2;
      if (Math.abs(d[k]) < 1e-9) {
        if (from[k] < min || from[k] > max) return false;
      } else {
        let a = (min - from[k]) / d[k],
          c = (max - from[k]) / d[k];
        if (a > c) [a, c] = [c, a];
        lo = Math.max(lo, a);
        hi = Math.min(hi, c);
        if (lo > hi) return false;
      }
    }
    return lo < 0.98 && hi > 0.01;
  });
}
export function focus(s) {
  const f = forward(s.yaw, s.pitch),
    candidates = [];
  const add = (kind, id, p, name, range) => {
    const d = V.sub(p, s.p),
      distance = V.len(d),
      dot = V.dot(V.unit(d), f);
    if (distance <= range && dot > 0.87 && !occluded(s.p, p))
      candidates.push({
        kind,
        id,
        p,
        name,
        distance,
        score: dot - distance * 0.015,
      });
  };
  for (const a of ANCHORS)
    add("anchor", a.id, anchorGrip(a), a.name, s.assist >= 2 ? 3.5 : 2.8);
  for (const p of PACKS)
    if (!s.collected.includes(p.id)) add("pack", p.id, p.p, p.name, 3);
  for (const r of s.rocks)
    if (r.cooldown <= 0) add("rock", r.id, r.p, "低速陨石 · 反向借力", 3);
  if (!s.captured)
    add(
      "pod",
      "pod",
      podPosition(s.time),
      "氧气花培养舱 · 回收把手",
      s.assist >= 2 ? 4 : 3,
    );
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}
export function interact(s) {
  if (s.exhausted || s.captured) return { type: "none" };
  if (s.anchor) {
    s.anchor = null;
    s.repair = 0;
    s.arm = { kind: "release", age: 0, target: null };
    return { type: "release" };
  }
  const t = focus(s);
  if (!t) return { type: "none" };
  if (t.kind === "anchor") {
    s.anchor = t.id;
    s.v = [0, 0, 0];
    s.arm = { kind: "grab", age: 0, target: t.p };
    const i = ANCHORS.findIndex((a) => a.id === t.id);
    if (i > s.checkpoint) {
      s.checkpoint = i;
      s.checkpointTape = s.tape;
      s.checkpointItems = [...s.collected];
      return { type: "checkpoint", name: t.name };
    }
    return { type: "grab", name: t.name };
  }
  if (t.kind === "pack") {
    const pack = PACKS.find((p) => p.id === t.id);
    s.collected.push(t.id);
    s.oxygen = Math.min(100, s.oxygen + pack.oxygen);
    s.tape = Math.min(5, s.tape + pack.tape);
    s.arm = { kind: "pickup", age: 0, target: t.p };
    return { type: "pickup", name: t.name };
  }
  if (t.kind === "rock") {
    const r = s.rocks.find((r) => r.id === t.id),
      d = V.unit(V.sub(r.p, s.p)),
      impulse = 2.7;
    s.v = V.sub(s.v, V.mul(d, impulse));
    r.v = V.add(r.v, V.mul(d, impulse / r.mass));
    r.cooldown = 1;
    s.arm = { kind: "push", age: 0, target: [...r.p] };
    s.pushes++;
    return { type: "push" };
  }
  if (t.kind === "pod") {
    if (V.len(s.v) > 2.2) return { type: "too-fast" };
    s.captured = true;
    s.v = [0, 0, 0];
    s.arm = { kind: "capture", age: 0, target: t.p };
    return { type: "capture" };
  }
  return { type: "none" };
}
export function collectNearby(s) {
  if (!s.anchor) return { type: "none" };
  const p = PACKS.find(
    (p) =>
      !s.collected.includes(p.id) &&
      V.dist(p.p, s.p) < 3 &&
      !occluded(s.p, p.p),
  );
  if (!p) return { type: "none" };
  s.collected.push(p.id);
  s.oxygen = Math.min(100, s.oxygen + p.oxygen);
  s.tape = Math.min(5, s.tape + p.tape);
  s.checkpointTape = s.tape;
  s.checkpointItems = [...s.collected];
  s.arm = { kind: "pickup", age: 0, target: p.p };
  return { type: "pickup", name: p.name };
}
export function impact(s, normal, strength) {
  if (s.time < 5 || s.hitCooldown > 0 || s.anchor) return false;
  s.v = V.add(s.v, V.mul(normal, Math.min(2.5, strength * 0.35)));
  s.leak = Math.min(3, s.leak + 1);
  s.oxygen = Math.max(0, s.oxygen - (s.assist >= 1 ? 1 : 3));
  s.hitCooldown = s.assist >= 1 ? 4 : 2.5;
  s.repair = 0;
  s.impacts++;
  return true;
}
function moveSphere(b, dt, radius) {
  b.p = V.add(b.p, V.mul(b.v, dt));
  let collision = null;
  for (const box of BOXES) {
    const d = V.sub(b.p, box.p),
      depth = d.map((v, i) => box.size[i] / 2 + radius - Math.abs(v));
    if (depth.every((n) => n > 0)) {
      const k = depth.indexOf(Math.min(...depth)),
        sign = Math.sign(d[k]) || 1,
        normal = [0, 0, 0];
      normal[k] = sign;
      b.p[k] = box.p[k] + sign * (box.size[k] / 2 + radius);
      const speed = Math.abs(b.v[k]);
      if (b.v[k] * sign < 0) b.v[k] *= -0.35;
      if (speed > 1.6) collision = { normal, strength: speed };
    }
  }
  return collision;
}
export function step(s, input = {}, dt = DT) {
  const events = [];
  if (s.exhausted || s.captured) return events;
  s.time += dt;
  s.arm.age += dt;
  s.hitCooldown = Math.max(0, s.hitCooldown - dt);
  s.boosting = false;
  s.braking = !!input.brake;
  if (s.anchor) {
    const a = ANCHORS.find((a) => a.id === s.anchor);
    const fraction = 1 - Math.exp(-10 * dt);
    s.p = V.add(s.p, V.mul(V.sub(a.p, s.p), fraction));
    s.v = [0, 0, 0];
    if (input.repair && s.tape > 0 && s.leak > 0) {
      s.repair += dt;
      if (s.repair >= 3) {
        s.repair = 0;
        s.tape--;
        s.leak = 0;
        s.repairs++;
        s.arm = { kind: "repair-done", age: 0, target: null };
        events.push({ type: "repaired" });
      }
    } else s.repair = 0;
  } else {
    s.repair = 0;
    const f = forward(s.yaw, s.pitch),
      right = [Math.cos(s.yaw), 0, Math.sin(s.yaw)];
    let desired = V.add(
      V.mul(f, input.forward || 0),
      V.add(V.mul(right, input.side || 0), [0, input.up || 0, 0]),
    );
    desired = V.unit(desired);
    const moving = V.len(desired) > 0.01;
    s.boosting = !!input.boost && !s.overheated && moving && !input.brake;
    const acceleration = s.boosting ? 4.8 : 1.25;
    s.v = V.add(s.v, V.mul(desired, acceleration * dt));
    if (input.brake) s.v = V.mul(s.v, Math.exp(-3.4 * dt));
    const speed = V.len(s.v);
    if (speed > 7) s.v = V.mul(s.v, 7 / speed);
    const hit = moveSphere(s, dt, 0.45);
    if (hit && impact(s, hit.normal, hit.strength))
      events.push({ type: "hit" });
  }
  if (s.boosting) {
    s.heat = Math.min(100, s.heat + 27 * dt);
    if (s.heat >= 100) {
      s.overheated = true;
      events.push({ type: "overheat" });
    }
  } else {
    s.heat = Math.max(0, s.heat - (s.anchor ? 27 : 19) * dt);
    if (s.overheated && s.heat <= 35) {
      s.overheated = false;
      events.push({ type: "cooled" });
    }
  }
  for (const rock of s.rocks) {
    rock.cooldown = Math.max(0, rock.cooldown - dt);
    moveSphere(rock, dt, rock.r);
    const delta = V.sub(s.p, rock.p),
      dist = V.len(delta);
    if (!s.anchor && dist < rock.r + 0.45 && dist > 0.01) {
      const n = V.unit(delta),
        relative = V.sub(s.v, rock.v),
        speed = -V.dot(relative, n);
      s.p = V.add(rock.p, V.mul(n, rock.r + 0.46));
      if (speed > 0) {
        s.v = V.add(s.v, V.mul(n, speed * 1.15));
        if (speed > 1.8 && impact(s, n, speed)) events.push({ type: "hit" });
      }
    }
  }
  if (!s.anchor)
    for (const m of METEORS) {
      const p = meteorPosition(m, s.time, s.assist),
        d = V.sub(s.p, p);
      if (
        V.len(d) < m.r + 0.45 &&
        impact(s, V.unit(V.len(d) > 0.01 ? d : [1, 0, 0]), m.speed)
      ) {
        events.push({ type: "hit" });
      }
    }
  const outside =
    Math.abs(s.p[0]) > 25 ||
    Math.abs(s.p[1]) > 20 ||
    s.p[2] > 24 ||
    s.p[2] < -155;
  s.outside = outside ? s.outside + dt : 0;
  if (s.outside > 5) {
    s.outside = 0;
    events.push({ type: "lost" });
  }
  if (s.time > 5)
    s.oxygen = Math.max(
      0,
      s.oxygen - (0.45 + s.leak * 0.65) * (s.assist >= 2 ? 0.55 : 1) * dt,
    );
  if (s.oxygen <= 0) {
    s.exhausted = true;
    events.push({ type: "exhausted" });
  }
  return events;
}
