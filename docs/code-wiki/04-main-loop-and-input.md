# 04 · 主循环、输入与 HUD

本文覆盖 [src/main.mjs](file:///home/songyx-15x/Project/treaHackson/src/main.mjs)。它是唯一持有可变游戏状态、DOM 事件和协议调用的模块。

## 1. 模块级状态

| 变量 | 初始值 | 作用 |
|---|---|---|
| `save` | `window.GameProtocol.read()` | 当前接力存档（由协议库提供） |
| `state` | `initial(WL.assist(save))` | 物理/生存状态 |
| `phase` | `"intro"` | 状态机阶段 |
| `keys` | `Set` | 当前按下的 `KeyboardEvent.code` |
| `startedAt` / `finishedAt` | `0` | 任务计时（毫秒） |
| `previousFrame` | `performance.now()` | 上一帧时间 |
| `accumulator` | `0` | 固定步长累加器 |
| `modalAction` / `modalBack` | `null` | 当前弹窗主/次按钮回调 |
| `suppressUnlock` | `false` | 主动解锁指针时抑制“自动暂停” |
| `handoffSent` | `false` | 防止重复交接 |
| `recoveryTime` / `rescueTime` | `0` | 演出计时 |
| `lastHUD` | `0` | HUD 节流（70ms） |
| `toastUntil` / `flashUntil` | `0` | 提示/受击闪光结束时间 |
| `drag` | `null` | 无指针锁定时的拖拽观察状态 |
| `lockRequested` | `false` | 防止重复请求指针锁 |
| `audio` | `new SuitAudio()` | 音效实例 |
| `view` | `null` → `new View(canvas)` | Three.js 表现层 |

`state` 的字段定义见 [03-world-and-physics.md](./03-world-and-physics.md#31-状态字段)。

## 2. 启动流程

```text
1. 解析 DOM 元素、window.WL、canvas
2. save = GameProtocol.read()         // WL.readSave()
3. state = initial(WL.assist(save))   // 根据连续死亡次数给放水档位
4. 注册事件监听（键盘/鼠标/指针锁/窗口失焦/可见性/按钮）
5. try { view = new View(canvas) } catch → WebGL 错误弹窗（按钮禁用）
6. adopt(save)                        // 更新 HUD 与“前情提要”
7. modalAction = start
8. requestAnimationFrame(frame)
```

### 2.1 WebGL 失败降级

`new View(canvas)` 抛错时显示：

> 当前浏览器无法启动 WebGL。请使用支持硬件加速的桌面浏览器重新打开。

主按钮被禁用且无回调，游戏不能进入 `active`；但页面本身不崩溃。

## 3. 状态机与流程函数

| 函数 | 触发 | 行为 |
|---|---|---|
| `start()` | 开场“打开气闸，开始行动” | 读取声音开关 → `audio.start()` → `phase="active"` → 计时开始 → 关闭弹窗 → 请求指针锁 → 提示 5 秒保护 |
| `pause()` | Esc、菜单按钮、失焦、指针解锁、页面隐藏 | `phase="paused"` → 清空按键 → 解锁 → 弹窗（含声音开关） |
| `resume()` | “继续行动” | 关闭弹窗 → `active` → 重新请求指针锁 |
| `abortPrompt()` | “终止回收任务” | 先暂停，再弹二次确认；确认 → `finish(false)` |
| `rescue(medical)` | `lost` / `exhausted` 事件 | 见 [§6](#6-救援与回收) |
| `finish(win)` | 撤回 / 回收完成 | 见 [§7](#7-结局与协议交接) |
| `adopt(incoming, admin)` | `iw-save-ready` / `iw-admin` | 更新 save、assist，必要时回血、同步 HUD |

### 3.1 指针锁定与降级

```text
requestLook():
  - 仅在 active
  - canvas 支持 requestPointerLock → 请求锁定
  - 失败/不支持 → tell("按住左键拖动观察，E 进行交互。")

pointerlockchange:
  - 非主动解锁且 phase === "active" → pause()

canvas.pointerdown(左键):
  - 已锁定 → useArm()
  - 未锁定 → 进入拖拽观察

canvas.pointerup:
  - 拖拽位移 < 5px → 视为点击，requestLook()
```

`look(dx, dy)`：

```js
state.yaw += clamp(dx, -250, 250) * 0.0022;
state.pitch = clamp(state.pitch - clamp(dy, -250, 250) * 0.0022, -1.42, 1.42);
```

鼠标灵敏度 `0.0022 rad/px`，单次事件位移上限 250px，俯仰限制 ±1.42rad（约 ±81°）。

## 4. 输入映射

### 4.1 键位表

| 键（`code`） | 输入字段 | 行为 |
|---|---|---|
| `KeyW` / `KeyS` | `forward: ±1` | 沿视线前后推进 |
| `KeyD` / `KeyA` | `side: ±1` | 相对视线左右平移 |
| `Space` | `up: +1` | 上升 |
| `KeyC` / `ControlLeft` | `up: -1` | 下降 |
| `ShiftLeft` / `ShiftRight` | `boost` | 强力推进（会过热） |
| `KeyX` | `brake` | 主动反推制动（过热时仍可用） |
| `KeyR` | `repair` | 抓住扶手时修补（持续 3 秒） |
| `KeyE` | — | 机械臂交互（按下瞬间触发一次） |
| `KeyM` | — | 开关航服声音 |
| `Escape` | — | `active → paused` |

以下是“受管按键”，按下会 `preventDefault()`，避免页面滚动/浏览器快捷键干扰：

```js
handled = [KeyW, KeyA, KeyS, KeyD, Space, KeyC, ControlLeft,
           ShiftLeft, ShiftRight, KeyX, KeyE, KeyR, KeyM]
```

### 4.2 键盘事件细节

- `keydown`：非 `active` 直接返回；`e.repeat` 时不重复触发 `E`/`M`/`R` 逻辑。
- `R` 的提示分支：
  - 未抓握 → “先对准扶手按 E 固定身体，再进行修补。”
  - 没有胶带 → “没有修补胶带，寻找附近补给包。”
- `keyup`：从 `keys` 删除。
- 窗口 `blur`、`document.visibilitychange`：清空按键并暂停，防止“松键丢失导致一直推进”。

### 4.3 `useArm()`：E 键的两种语义

```js
const target = focus(state);
if (state.anchor && target?.kind === "pack")
  dispatch(collectNearby(state));   // 抓稳时 E 优先取附近补给
else
  dispatch(interact(state));        // 否则抓取/松开/推石/抓舱
```

### 4.4 `input()`：按键集合 → 物理输入

```js
{
  forward: W - S,
  side: D - A,
  up: Space - (C || CtrlLeft),
  boost: ShiftLeft || ShiftRight,
  brake: X,
  repair: R,
}
```

## 5. 事件分发表

`dispatch(event)` 忽略 `null` / `none`，其余事件映射如下：

| 事件 `type` | 副作用 | 提示文本（要点） | 音效 |
|---|---|---|---|
| `hit` | `view.hit(time)`；受击闪光 300ms | 航服受损、正在漏气，寻找胶带 | `hit` |
| `checkpoint` | — | 已固定，救援位置更新 | `good` |
| `grab` | — | 机械臂已固定；R 修补；E 取补给/松开 | `good` |
| `release` | — | 已松开扶手；Shift 增压，X 制动 | — |
| `pickup` | — | 补给已取用：补氧 + 收纳胶带 | `good` |
| `push` | — | 已推出陨石，获得反向动量 | `good` |
| `overheat` | — | 推进器过热，强推关闭；小幅推进与 X 仍可用 | `warn` |
| `cooled` | — | 推进器已冷却 | — |
| `repaired` | — | 胶带封住全部破口，耗氧恢复 | `good` |
| `too-fast` | — | 接近速度过高，按 X 制动后再抓 | `warn` |
| `capture` | `phase="recover"`；`recoveryTime=0`；清键；解锁指针 | 机械臂扣住把手，系缆连接完成 | `good` |
| `lost` | `rescue(false)` | 见 §6 | `warn` |
| `exhausted` | `rescue(true)` | 见 §6 | `warn` |

`tell(text)` 显示 toast 4.6 秒（`toastUntil = now + 4600`）。

## 6. 救援与回收

### 6.1 `rescue(medical)`

```text
keys.clear()
if medical:
    WL.setPlayer(save, { hp: max(0, hp - 1) })
    if hp <= 0 → save = WL.respawn()   // 恢复到本关进入时快照，deaths+1
state = restore(state, WL.assist(save), medical)
phase = "rescue"; rescueTime = 0
closeModal(); tell(...); audio.tone("warn")
```

- `medical = true`（氧气耗尽）：扣 1 血；恢复满氧、封堵漏气、回滚到检查点补给，并给胶带（assist=2 时至少 1 卷）。
- `medical = false`（越界 5 秒）：不扣血，氧气 −15%，保留漏气，回到检查点。

救援演出持续 **1.5 秒**，期间不推进物理。

### 6.2 `recover` 回收演出

`capture` 事件进入 `recover`，主循环执行：

```js
recoveryTime += dt;
state.arm.age += dt;
const t = clamp(recoveryTime / 6.5, 0, 1);
state.oxygen = 100 * t + (1 - t) * state.oxygen;      // 氧气插值回满
const target = podPosition(state.time) * (1 - t) + [1.5, 1, -106] * t;
const a = lookAt(state.p, target);
state.yaw += (a.yaw - state.yaw) * dt * 2;            // 平滑转向回收点
state.pitch += (a.pitch - state.pitch) * dt * 2;
if (recoveryTime >= 6.5) finish(true);
```

同时 `view.render(state, { recovery: t })` 让培养舱沿平滑曲线移到回收平台并显示系缆。

## 7. 结局与协议交接

### 7.1 `finish(win)`

```text
if handoffSent → return
phase = "won" | "failed"; finishedAt = now; unlock()
显示结局弹窗（标题/正文）
禁用主按钮
try:
  win  → 若在 iframe 内：GameProtocol.complete(save, {
            acquiredItemIds: [],
            exitHook: "供氧恢复后，培养舱的运输记录亮起：……"
         })
         独立打开：result 保持 undefined（弹窗仍显示结局）
  fail → WL.failLevel("舱外回收任务终止，氧气花培养舱未能接回", save, CONFIG||{})
  if result === null → 抛错“交接未被接受”
  handoffSent = true
catch:
  重新启用按钮，文案改为“重试交接”，正文追加“交接链路暂未确认，请重试。”
```

设计细节：

- **成功时 `acquiredItemIds` 恒为 `[]`**：氧气、胶带、陨石都是关内机制，氧气花留在空间站，不产生跨关道具。
- `finish` 用 `handoffSent` 保证只发一次 `IW_COMPLETE` / `IW_FAIL`；测试也验证了重复调用不会重复发送。
- 主按钮在成功后禁用，避免误触重试。

### 7.2 对接 `index.html`

```html
<script src="shared/save-protocol.js"></script>
<script>
  window.GameProtocol = {
    read: () => WL.readSave(),
    complete: (save, options) => WL.completeLevel(window.CONFIG || {}, save, options),
  };
</script>
<script src="app.js"></script>
```

`main.mjs` 只依赖 `GameProtocol.read` / `GameProtocol.complete`，不直接依赖 `CONFIG` 结构。

## 8. HUD 更新 `updateHUD()`

每 **70ms** 至少刷新一次，此外在 `adopt()` 后立即刷新。字段对应关系：

| DOM id | 内容 | 数据来源 |
|---|---|---|
| `oxygen` | 氧气百分比（向上取整） | `state.oxygen` |
| `oxygen-bar` | 宽度 / 颜色（<25% 橙色） | `state.oxygen` |
| `reserve` | 预计剩余时间 `mm:ss` | `floor(oxygen / rate)`，`rate = (0.45 + leak*0.65) * (assist>=2?0.55:1)` |
| `oxygen-status` | 气闸保护 / 持续漏气 / 循环正常 | `time < 5`、`leak` |
| `leak` | 完好 / 轻度破损 / 多处破损 / 严重破损 | `state.leak` 0~3 |
| `hp` | `当前/上限` | `save.player` |
| `tape` | 胶带数 | `state.tape` |
| `heat` / `heat-bar` | 热量百分比（过热橙色） | `state.heat` |
| `heat-label` | 冷却中 / 增压中 / 反推制动 / 待机 | `overheated/boosting/braking` |
| `speed` | `m/s`，一位小数 | `V.len(state.v)` |
| `movement-state` | 系缆回收 / 已固定身体 / 主动制动 / 强力推进 / 惯性漂浮 | `phase` 与 state |
| `grip-status` | 机械臂 / 已锁定扶手 或 待命 | `state.anchor` |
| `assist` | 惯性导航 / 救援辅助 I / 救援辅助 II | `state.assist` |
| `compass` | `000°`~`359°` | `yaw` 归一化 |
| `elapsed` | 任务用时 `mm:ss` | `startedAt` / `finishedAt` / `now` |
| `sector` | 最近扶手区域名 | 按 `|anchor.z - p.z|` 最近 |
| `objective` | 当前目标提示 | `captured` / 距培养舱 <18 / 默认 |
| `reticle` | `.active` 表示有焦点目标 | `focus(state)` |
| `interact` | 是否显示交互条 | `phase==="active" && (target || anchor)` |
| `interact-key/title/detail` | E 提示文案 | 目标类型 + 速度 + 漏气/胶带 |
| `repair` / `repair-bar` | 修补进度条 | `state.repair / 3` |
| `alert` | 警告卡片 | 越界 > 漏气 > 低氧 优先级 |
| `body.leaking` | CSS 类，漏气面罩效果 | `state.leak > 0` |

交互提示文案分支（`interact`）：

| 条件 | 标题 | 详情 |
|---|---|---|
| 已抓握且目标不是补给 | 松开扶手 | 有漏气时提示 R/需要胶带；否则“等待推进器冷却” |
| 目标 `anchor` | 抓住扶手 | 扶手名称 |
| 目标 `pack` | 取用 `名称` | 补充氧气与修补胶带 |
| 目标 `rock` | 推开陨石 | 身体将向相反方向移动 |
| 目标 `pod` | 抓住培养舱 | 速度 >2.2 提示制动；否则“扣住把手并连接回收系缆” |

## 9. 主循环 `frame(now)`

```js
const wall = max(0, (now - previousFrame) / 1000);
const dt = min(wall, 0.1);                 // 防止切后台后爆炸
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

if (phase === "rescue") { rescueTime += dt; if (>=1.5) phase = "active"; }
if (phase === "recover") { ...见 §6.2... }

if (now - lastHUD > 70) { updateHUD(); lastHUD = now; }
if (now > toastUntil) toast.classList.remove("show");
hitFlash.classList.toggle("on", now < flashUntil);
audio.update(state, phase === "active");
view?.render(state, { recovery: ... });
requestAnimationFrame(frame);
```

特点：

- 物理固定 120Hz，单帧最多补 12 步（`dt` 上限 0.1s）。
- 事件处理中若 `capture` 改变 `phase`，`while` 与内层 `for` 都会立刻停止，避免演出期间继续模拟。
- `phase !== active` 时清空累加器，防止恢复后一次性补算大量物理步。

## 10. 只读遥测 `window.__telemetry`

供浏览器验收脚本读取，不可写：

```js
Object.defineProperty(window, "__telemetry", {
  get: () => ({
    phase,
    state: structuredClone(state),
    hp: save.player.hp,
    deaths: save.player.deaths,
    assist: state.assist,
    elapsed: startedAt ? ((finishedAt || performance.now()) - startedAt) / 1000 : 0,
    handoffSent,
  }),
});
```

`qa/run.mjs` 通过它判断 `phase`、`hp`、`anchor`，但**不通过它修改状态**，所有操作都用真实键鼠事件。

## 11. 暂停语义

| 项目 | 暂停时 |
|---|---|
| 物理（位置、速度、氧气、热量） | 冻结 |
| 任务总计时 `elapsed` | **继续** |
| 音频 | 静音（`audio.update(state, false)`） |
| 按键 | 清空 |
| 指针锁定 | 主动释放 |
| 页面可见性 | 隐藏即暂停 |

暂停弹窗的次要按钮可切换声音开关，并即时更新按钮文案。

## 12. 上家存档的接入

```js
window.addEventListener("iw-save-ready", (e) => adopt(e.detail));
window.addEventListener("iw-admin", (e) => {
  if (e.detail.save) adopt(e.detail.save, true);
  if (e.detail.command === "audio") { /* 切换声音 */ }
});
```

`adopt(incoming, admin)`：

1. `save = incoming`，`state.assist = WL.assist(save)`；
2. 若 assist 从 <2 升到 >=2，补 1 卷胶带；
3. `intro` 阶段把 `save.exit_hook` 写进开场 `#previous`；
4. 管理员治疗（`admin`）时执行 `restore(state, assist, true)` 并提示“医疗链路已同步”；
5. 刷新 HUD。

这样即使存档在页面加载后才通过 `postMessage` 到达，游戏面板、辅助档位和开场叙事都会同步更新。
