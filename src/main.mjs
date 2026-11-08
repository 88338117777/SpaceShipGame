import { View } from "./view.mjs";
import { SuitAudio } from "./audio.mjs";
import {
  DT,
  V,
  clamp,
  initial,
  restore,
  step,
  focus,
  interact,
  collectNearby,
  ANCHORS,
  podPosition,
  lookAt,
} from "./physics.mjs";
const $ = (id) => document.getElementById(id),
  WL = window.WL,
  canvas = $("space");
let save = window.GameProtocol.read(),
  state = initial(WL.assist(save)),
  phase = "intro",
  keys = new Set(),
  startedAt = 0,
  finishedAt = 0,
  previousFrame = performance.now(),
  accumulator = 0,
  modalAction = null,
  modalBack = null,
  suppressUnlock = false,
  handoffSent = false,
  recoveryTime = 0,
  rescueTime = 0,
  lastHUD = 0,
  toastUntil = 0,
  flashUntil = 0,
  drag = null,
  lockRequested = false;
const audio = new SuitAudio();
let view = null;
function tell(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  toastUntil = performance.now() + 4600;
}
function modal(
  kicker,
  title,
  body,
  label,
  action,
  secondary = null,
  back = null,
) {
  $("modal-kicker").textContent = kicker;
  $("modal-title").textContent = title;
  $("modal-body").textContent = body;
  $("modal-primary").textContent = label;
  $("modal-primary").disabled = false;
  $("modal-secondary").hidden = !secondary;
  $("modal-secondary").textContent = secondary || "";
  $("briefing").hidden = true;
  $("abort-button").hidden = true;
  $("overlay").hidden = false;
  modalAction = action;
  modalBack = back;
  document.body.classList.add("paused");
}
function closeModal() {
  $("overlay").hidden = true;
  document.body.classList.remove("paused");
}
function unlock() {
  suppressUnlock = true;
  if (document.pointerLockElement === canvas) document.exitPointerLock?.();
  keys.clear();
  drag = null;
  setTimeout(() => {
    suppressUnlock = false;
  }, 100);
}
function requestLook() {
  if (
    phase !== "active" ||
    lockRequested ||
    document.pointerLockElement === canvas
  )
    return;
  try {
    if (!canvas.requestPointerLock) {
      tell("鼠标锁定不可用：按住左键拖动观察，E 进行交互。");
      return;
    }
    lockRequested = true;
    const p = canvas.requestPointerLock();
    p?.catch(() => {
      tell("按住左键拖动观察，E 进行交互。");
    }).finally(() => {
      lockRequested = false;
    });
    if (!p) lockRequested = false;
  } catch {
    lockRequested = false;
    tell("按住左键拖动观察，E 进行交互。");
  }
}
function start() {
  if (!view) return;
  audio.enabled = $("sound-enabled").checked;
  audio.start();
  phase = "active";
  startedAt = performance.now();
  closeModal();
  keys.clear();
  accumulator = 0;
  requestLook();
  tell("气闸保护 5 秒。WASD 推进，X 制动。附近的应急包内有修补胶带。");
}
function pause() {
  if (phase !== "active") return;
  phase = "paused";
  keys.clear();
  unlock();
  modal(
    "EVA / 航服待命",
    "暂时停靠",
    "移动与氧气消耗已暂停，任务总计时继续。WASD 推进，Space / C 升降，Shift 增压，X 制动。对准目标按 E；抓稳后按住 R 使用胶带修补。",
    "继续行动",
    resume,
    "声音：" + (audio.enabled ? "开" : "关"),
    () => {
      audio.enabled = !audio.enabled;
      $("modal-secondary").textContent =
        "声音：" + (audio.enabled ? "开" : "关");
      if (audio.enabled) audio.start();
    },
  );
  $("abort-button").hidden = false;
}
function resume() {
  closeModal();
  phase = "active";
  keys.clear();
  accumulator = 0;
  requestLook();
}
function abortPrompt() {
  if (phase === "active") pause();
  if (phase !== "paused") return;
  modal(
    "EVA / 撤离程序",
    "终止回收任务？",
    "撤离信标将接管航服。本次任务到此结束，培养舱将继续漂流。",
    "确认撤离",
    () => finish(false),
    "继续回收",
    resume,
  );
}
function adopt(incoming, admin = false) {
  const before = state.assist;
  save = incoming;
  state.assist = WL.assist(save);
  if (before < 2 && state.assist >= 2) {
    state.tape = Math.min(5, state.tape + 1);
  }
  if (phase === "intro")
    $("previous").textContent = save.exit_hook
      ? "前路的回声 · " + save.exit_hook
      : "舱载记录 · 主制氧回路离线，培养舱生命信号稳定。";
  if (admin && !["won", "failed", "recover"].includes(phase)) {
    state = restore(state, state.assist, true);
    keys.clear();
    tell("医疗链路已同步。航服恢复至最近扶手。");
  }
  updateHUD();
}
window.addEventListener("iw-save-ready", (e) => adopt(e.detail));
window.addEventListener("iw-admin", (e) => {
  if (e.detail.save) adopt(e.detail.save, true);
  if (e.detail.command === "audio") {
    audio.enabled = !audio.enabled;
    if (audio.enabled) audio.start();
  }
});
function rescue(medical) {
  keys.clear();
  if (medical) {
    WL.setPlayer(save, { hp: Math.max(0, save.player.hp - 1) });
    if (save.player.hp <= 0) save = WL.respawn();
  }
  state = restore(state, WL.assist(save), medical);
  phase = "rescue";
  rescueTime = 0;
  closeModal();
  tell(
    medical
      ? "救援牵引已接回最近扶手。破口已封堵，供氧恢复。"
      : "离开作业区，安全牵引已接回最近扶手。消耗氧气 15%。",
  );
  audio.tone("warn");
}
function dispatch(event) {
  if (!event || event.type === "none") return;
  switch (event.type) {
    case "hit":
      view?.hit(state.time);
      flashUntil = performance.now() + 300;
      tell("航服受损，正在漏气！寻找胶带，抓稳扶手后按住 R 修补。");
      audio.tone("hit");
      break;
    case "checkpoint":
      tell(
        event.name +
          "已固定，救援位置更新。对准附近补给按 E 取用；再按 E 松开。",
      );
      audio.tone();
      break;
    case "grab":
      tell(
        "机械臂已固定。按住 R 修补；对准补给按 E 取用，或移开视线按 E 松开。",
      );
      audio.tone();
      break;
    case "release":
      tell("已松开扶手。Shift 增压，X 制动。");
      break;
    case "pickup":
      tell(event.name + "已取用：氧气补充，胶带已收纳。");
      audio.tone();
      break;
    case "push":
      tell("已推出陨石，航服获得反向动量。");
      audio.tone();
      break;
    case "overheat":
      tell("推进器过热，强推暂时关闭。小幅推进与 X 制动仍可用。");
      audio.tone("warn");
      break;
    case "cooled":
      tell("推进器已冷却，可再次增压。");
      break;
    case "repaired":
      tell("胶带已封住全部破口，氧气消耗恢复正常。");
      audio.tone();
      break;
    case "too-fast":
      tell("接近速度过高。按住 X 制动后再抓取培养舱。");
      audio.tone("warn");
      break;
    case "capture":
      phase = "recover";
      recoveryTime = 0;
      keys.clear();
      unlock();
      tell("机械臂已扣住回收把手，系缆连接完成。");
      audio.tone();
      break;
    case "lost":
      rescue(false);
      break;
    case "exhausted":
      rescue(true);
      break;
  }
}
function useArm() {
  if (phase !== "active") return;
  const target = focus(state);
  if (state.anchor && target?.kind === "pack") dispatch(collectNearby(state));
  else dispatch(interact(state));
}
function finish(win) {
  if (handoffSent) return;
  phase = win ? "won" : "failed";
  finishedAt = performance.now();
  unlock();
  const heading = win ? "呼吸，重新开始。" : "撤离信标已点亮";
  const body = win
    ? "氧气花已接入主制氧回路。培养舱的运输记录亮起：它的目的地，是一座早已注销的空间站。"
    : "回收任务终止。航服已将生命记录与随身遗物交给接续者。";
  modal(
    win ? "LIFE SUPPORT / RESTORED" : "RECOVERY / ABORTED",
    heading,
    body,
    win ? "回收完成" : "撤离完成",
    () => {},
  );
  $("modal-primary").disabled = true;
  try {
    let result;
    if (win) {
      if (window.parent !== window)
        result = window.GameProtocol.complete(save, {
          acquiredItemIds: [],
          exitHook:
            "供氧恢复后，培养舱的运输记录亮起：它的目的地，是一座早已注销的空间站。",
        });
    } else
      result = WL.failLevel(
        "舱外回收任务终止，氧气花培养舱未能接回",
        save,
        window.CONFIG || {},
      );
    if (result === null) throw Error("交接未被接受");
    handoffSent = true;
  } catch (error) {
    $("modal-primary").disabled = false;
    $("modal-primary").textContent = "重试交接";
    modalAction = () => finish(win);
    $("modal-body").textContent = body + " 交接链路暂未确认，请重试。";
    console.error(error);
  }
}
function input() {
  return {
    forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
    side: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    up:
      (keys.has("Space") ? 1 : 0) -
      (keys.has("KeyC") || keys.has("ControlLeft") ? 1 : 0),
    boost: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    brake: keys.has("KeyX"),
    repair: keys.has("KeyR"),
  };
}
function updateHUD() {
  const rate = (0.45 + state.leak * 0.65) * (state.assist >= 2 ? 0.55 : 1),
    reserve = Math.floor(state.oxygen / rate);
  $("oxygen").textContent = Math.ceil(state.oxygen);
  $("oxygen-bar").style.width = state.oxygen + "%";
  $("oxygen-bar").style.background =
    state.oxygen < 25 ? "var(--orange)" : "var(--cyan)";
  $("reserve").textContent =
    "剩余约 " +
    String(Math.floor(reserve / 60)).padStart(2, "0") +
    ":" +
    String(reserve % 60).padStart(2, "0");
  $("oxygen-status").textContent =
    state.time < 5 ? "气闸保护" : state.leak ? "持续漏气" : "循环正常";
  $("oxygen-status").classList.toggle("warm", state.leak > 0);
  $("leak").textContent = ["完好", "轻度破损", "多处破损", "严重破损"][
    state.leak
  ];
  $("hp").textContent = save.player.hp + "/" + save.player.max_hp;
  $("tape").textContent = state.tape;
  $("heat").textContent = Math.round(state.heat) + "%";
  $("heat-bar").style.width = state.heat + "%";
  $("heat-bar").style.background = state.overheated
    ? "var(--orange)"
    : "var(--ice)";
  $("heat-label").textContent = state.overheated
    ? "冷却中"
    : state.boosting
      ? "增压中"
      : state.braking
        ? "反推制动"
        : "待机";
  $("heat-label").classList.toggle("warm", state.overheated);
  $("speed").textContent = V.len(state.v).toFixed(1);
  $("movement-state").textContent =
    phase === "recover"
      ? "系缆回收"
      : state.anchor
        ? "已固定身体"
        : state.braking
          ? "主动制动"
          : state.boosting
            ? "强力推进"
            : "惯性漂浮";
  $("grip-status").textContent = state.anchor
    ? "机械臂 / 已锁定扶手"
    : "机械臂 / 待命";
  $("assist").textContent = [
    "惯性导航",
    "救援辅助 I · 碰撞保护增强",
    "救援辅助 II · 应急供氧",
  ][state.assist];
  $("compass").textContent =
    String(
      Math.round(((((state.yaw * 180) / Math.PI) % 360) + 360) % 360),
    ).padStart(3, "0") + "°";
  const elapsed = startedAt
    ? Math.max(0, ((finishedAt || performance.now()) - startedAt) / 1000)
    : 0;
  $("elapsed").textContent =
    String(Math.floor(elapsed / 60)).padStart(2, "0") +
    ":" +
    String(Math.floor(elapsed % 60)).padStart(2, "0");
  const near = ANCHORS.reduce((a, b) =>
    Math.abs(b.p[2] - state.p[2]) < Math.abs(a.p[2] - state.p[2]) ? b : a,
  );
  $("sector").textContent = near.sector;
  $("objective").textContent = state.captured
    ? "系缆已接通，等待培养舱接驳。"
    : V.dist(state.p, podPosition(state.time)) < 18
      ? "接近培养舱，按 X 制动，对准回收把手按 E。"
      : "沿外壁穿过碎片带，接近绿色回收信标。";
  const target = focus(state);
  $("reticle").classList.toggle("active", !!target);
  const visible = phase === "active" && (target || state.anchor);
  $("interact").classList.toggle("show", !!visible);
  if (visible) {
    let title = "",
      detail = "",
      key = "E";
    if (state.anchor && target?.kind !== "pack") {
      title = "松开扶手";
      detail = state.leak
        ? state.tape
          ? "按住 R 贴胶带修补"
          : "需要胶带：附近补给包内可以找到"
        : "已固定身体 · 等待推进器冷却";
    } else if (target) {
      title =
        target.kind === "anchor"
          ? "抓住扶手"
          : target.kind === "pack"
            ? "取用 " + target.name
            : target.kind === "rock"
              ? "推开陨石"
              : "抓住培养舱";
      detail =
        target.kind === "rock"
          ? "身体将向相反方向移动"
          : target.kind === "pod"
            ? V.len(state.v) > 2.2
              ? "速度过高，按 X 制动"
              : "扣住把手并连接回收系缆"
            : target.kind === "pack"
              ? "补充氧气与修补胶带"
              : target.name;
    }
    $("interact-key").textContent = key;
    $("interact-title").textContent = title;
    $("interact-detail").textContent = detail;
  }
  $("repair").hidden = state.repair <= 0;
  $("repair-bar").style.width = (state.repair / 3) * 100 + "%";
  document.body.classList.toggle("leaking", state.leak > 0);
  const warning =
    state.outside > 0
      ? "outside"
      : state.leak > 0
        ? "leak"
        : state.oxygen < 25
          ? "oxygen"
          : null;
  $("alert").hidden = !warning || phase !== "active";
  if (warning) {
    $("alert-title").textContent =
      warning === "outside"
        ? "正在离开作业区"
        : warning === "leak"
          ? "航服气密性受损"
          : "氧气储量偏低";
    $("alert-detail").textContent =
      warning === "outside"
        ? "转向空间站。安全牵引即将启动。"
        : warning === "leak"
          ? state.tape
            ? "抓稳扶手，按住 R 贴胶带修补。"
            : "寻找带十字标记的补给包，取得胶带。"
          : "附近维护架和漂浮补给箱可补充氧气。";
  }
}
const handled = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "Space",
  "KeyC",
  "ControlLeft",
  "ShiftLeft",
  "ShiftRight",
  "KeyX",
  "KeyE",
  "KeyR",
  "KeyM",
]);
document.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (phase === "active") pause();
    return;
  }
  if (phase !== "active") return;
  if (handled.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyE") useArm();
  if (e.code === "KeyM") {
    audio.enabled = !audio.enabled;
    if (audio.enabled) audio.start();
    tell("航服声音反馈已" + (audio.enabled ? "开启" : "关闭"));
  }
  if (e.code === "KeyR" && !state.anchor)
    tell("先对准扶手按 E 固定身体，再进行修补。");
  else if (e.code === "KeyR" && state.tape <= 0)
    tell("没有修补胶带，寻找附近补给包。");
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
function look(dx, dy) {
  if (phase !== "active") return;
  state.yaw += clamp(dx, -250, 250) * 0.0022;
  state.pitch = clamp(state.pitch - clamp(dy, -250, 250) * 0.0022, -1.42, 1.42);
}
document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
});
canvas.addEventListener("pointerdown", (e) => {
  if (phase !== "active" || e.button !== 0) return;
  if (document.pointerLockElement === canvas) {
    useArm();
    return;
  }
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag || document.pointerLockElement === canvas) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  look(dx, dy);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener("pointerup", () => {
  if (drag && drag.moved < 5) requestLook();
  drag = null;
});
canvas.addEventListener("pointercancel", () => (drag = null));
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerlockchange", () => {
  lockRequested = false;
  if (!document.pointerLockElement && !suppressUnlock && phase === "active")
    pause();
});
document.addEventListener("pointerlockerror", () => {
  lockRequested = false;
  tell("按住左键拖动观察，E 进行交互。");
});
window.addEventListener("blur", () => {
  keys.clear();
  if (phase === "active") pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "active") pause();
});
$("menu-button").onclick = pause;
$("abort-button").onclick = abortPrompt;
$("modal-primary").onclick = () => modalAction?.();
$("modal-secondary").onclick = () => modalBack?.();
try {
  view = new View(canvas);
} catch (error) {
  modal(
    "NAVIGATION / DISPLAY ERROR",
    "航服显示未启动",
    "当前浏览器无法启动 WebGL。请使用支持硬件加速的桌面浏览器重新打开。",
    "等待显示恢复",
    () => {},
  );
  $("modal-primary").disabled = true;
  console.error(error);
}
function frame(now) {
  const wall = Math.max(0, (now - previousFrame) / 1000);
  previousFrame = now;
  const dt = Math.min(wall, 0.1);
  if (phase === "active") {
    accumulator += dt;
    while (accumulator >= DT && phase === "active") {
      const events = step(state, input(), DT);
      accumulator -= DT;
      for (const e of events) {
        dispatch(e);
        if (phase !== "active") break;
      }
    }
  } else accumulator = 0;
  if (phase === "rescue") {
    rescueTime += dt;
    if (rescueTime >= 1.5) {
      phase = "active";
    }
  }
  if (phase === "recover") {
    recoveryTime += dt;
    state.arm.age += dt;
    const t = clamp(recoveryTime / 6.5, 0, 1);
    state.oxygen = 100 * t + (1 - t) * state.oxygen;
    const a = lookAt(
      state.p,
      V.add(V.mul(podPosition(state.time), 1 - t), V.mul([1.5, 1, -106], t)),
    );
    state.yaw += (a.yaw - state.yaw) * dt * 2;
    state.pitch += (a.pitch - state.pitch) * dt * 2;
    if (recoveryTime >= 6.5) finish(true);
  }
  if (now - lastHUD > 70) {
    updateHUD();
    lastHUD = now;
  }
  if (now > toastUntil) $("toast").classList.remove("show");
  $("hit-flash").classList.toggle("on", now < flashUntil);
  audio.update(state, phase === "active");
  view?.render(state, {
    recovery:
      phase === "recover"
        ? clamp(recoveryTime / 6.5, 0, 1)
        : phase === "won"
          ? 1
          : 0,
  });
  requestAnimationFrame(frame);
}
adopt(save);
modalAction = start;
requestAnimationFrame(frame);
// Read-only acceptance telemetry. Gameplay is controlled exclusively through normal inputs.
Object.defineProperty(window, "__telemetry", {
  get: () => ({
    phase,
    state: structuredClone(state),
    hp: save.player.hp,
    deaths: save.player.deaths,
    assist: state.assist,
    elapsed: startedAt
      ? ((finishedAt || performance.now()) - startedAt) / 1000
      : 0,
    handoffSent,
  }),
});
