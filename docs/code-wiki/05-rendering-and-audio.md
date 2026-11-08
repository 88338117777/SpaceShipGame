# 05 · 渲染、场景与音效

本文覆盖 [src/view.mjs](file:///home/songyx-15x/Project/treaHackson/src/view.mjs) 与 [src/audio.mjs](file:///home/songyx-15x/Project/treaHackson/src/audio.mjs)。

## 1. View 概览

`View` 是唯一接触 Three.js 的类。它在构造时一次性搭好整个场景，之后每帧只更新少量动态对象。

```js
const view = new View(canvas);
view.hit(state.time);                       // 受击震动
view.render(state, { recovery: 0..1 });     // 每帧
```

| 成员 | 类型 | 作用 |
|---|---|---|
| `renderer` | `WebGLRenderer` | 抗锯齿、像素比上限 1.75、清屏色 `0x030711`、ACES 色调映射（曝光 1.15） |
| `scene` | `Scene` | 根场景 |
| `camera` | `PerspectiveCamera` | FOV 76°，近 0.04，远 2500，`rotation.order = "YXZ"` |
| `world` | `Group` | 所有静态/动态世界对象 |
| `markers` | `Array` | DOM 世界标记（扶手、补给、培养舱） |
| `rocks` | `Map` | 岩石 id → Mesh（懒创建） |
| `packs` | `Map` | 补给 id → Group |
| `meteors` | `Mesh[]` | 14 颗高速陨石 |
| `arms` / `upper` / `lower` / `wrist` / `fingers` | Object3D | 第一人称机械臂 |
| `left` / `chest` / `tapeStrip` / `tapeRoll` | Object3D | 修补动作与胶带 |
| `pod` / `cable` | Group / Line | 培养舱与回收系缆 |
| `hitTime` | number | 最近受击时间，用于镜头震动 |

### 1.1 光照配置

| 光源 | 参数 | 位置 |
|---|---|---|
| `HemisphereLight` | 天空 `0xc6e5ff` / 地面 `0x263449`，强度 1.5 | — |
| `DirectionalLight`（主光） | `0xfff0da`，强度 3.5 | `[50, 80, 40]` |
| `DirectionalLight`（轮廓光） | `0x6cafff`，强度 1.5 | `[-60, -20, -150]` |
| `PointLight`（头灯） | `0xbee9e6`，强度 12，距离 8 | 挂在相机上 |
| `PointLight`（培养舱） | `0x91df84`，强度 3，距离 4 | 培养舱内部 |

### 1.2 调色板

```js
const C = {
  hull: 0x647781,   // 舰体
  dark: 0x1b303c,
  cyan: 0x8ae4da,   // 科技高光
  amber: 0xf1ba79,  // 扶手/警示
  green: 0xc3f285,  // 氧气花
};
```

## 2. 场景构建

### 2.1 `makeSky()` — 星空与地球

- **星空**：固定种子 LCG（`seed = 302`）生成 1700 个点，半径 700~1000，`PointsMaterial` 尺寸 1.2、透明度 0.7。固定种子保证每次外观一致。
- **地球**：半径 250 的球体，位于 `[350, -330, -400]`，使用自定义 `ShaderMaterial`：
  - 顶点着色器传出法线与位置；
  - 片元着色器用多层 `sin` 噪声合成海陆、云层、受光与大气边缘光；
  - 完全程序化，无贴图文件。
- **大气层**：半径 254，`BackSide` + 加法混合 + 透明度 0.08。

### 2.2 `makeStation()` — 空间站

| 对象 | 来源 | 表现 |
|---|---|---|
| 舰体/破损结构/护板 | `BOXES`（跳过 `solar`） | `MeshStandardMaterial` + `EdgesGeometry` 描边 |
| 舰体细节 | `kind === "hull"` | 外侧装甲条、横向肋条、青色发光带、编号牌 `KEPLER / n`、太阳能翼 |
| 破损面板 | `kind === "panel"` | 5 条琥珀色警示条纹 |
| 扶手检查点 | `ANCHORS` | 平台、支撑杆、琥珀色抓杆、青色发光条、顶端小球 |
| 补给包 | `PACKS` | 米色箱体 + 青色十字标记 + 提手，按 id 存入 `packs` |
| 漂浮碎片 | 25 个固定伪随机位置 | 纯装饰小方块，不参与碰撞 |
| 回收系缆 | `Line` | 初始不可见，回收演出时显示 |

> 注意：视觉上看到的“小碎片”与物理中的 `METEORS` 不是同一批对象；真正会造成伤害的是 14 颗较大的移动陨石。

### 2.3 `makeSolar(x, y, z)` — 太阳能翼

支撑杆 + 深蓝面板 + 8 条纵向与 6 条横向栅格线，纯几何，无贴图。

### 2.4 `makeArms()` — 第一人称机械臂

机械臂组 `arms` 直接挂在 `camera` 下，因此永远跟随视角：

| 节点 | 几何 | 说明 |
|---|---|---|
| `upper` / `lower` | 圆柱 | 上臂/前臂，用 `armLink()` 做两点间对齐 |
| `elbow` | 球 | 肘关节 |
| `wrist` | Group | 腕部 + 手部方块 + 青色灯条 |
| `fingers` | 2 个方块 | 抓握时旋转 ±0.32rad |
| `left` | Group | 左手、胶带卷（Torus） |
| `chest` | 方块 | 胸前贴胶带时显示 |
| `tapeStrip` | 薄片 | 修补后期显示胶带条 |

`armLink(mesh, a, b)`：

```js
mesh.position = (a + b) / 2;
mesh.scale.y = |b - a|;
mesh.quaternion.setFromUnitVectors([0,1,0], normalize(b - a));
```

### 2.5 `makePod()` — 氧气花培养舱

- 上下金属端盖 + 半透明圆柱外壳（透明度 0.14）；
- 4 根纵向支撑杆；
- 琥珀色回收把手（三根圆柱）；
- 土壤、茎、8 片发光叶片、5 片花瓣；
- 内部绿色点光源。

### 2.6 `createMarkers()` — DOM 世界标记

清空 `#world-markers` 后，为以下对象创建 DOM：

```text
pod（氧气花培养舱）
ANCHORS（扶手，位置用 anchorGrip）
PACKS（补给，optional 类用于漂浮箱）
```

每个标记结构：

```html
<div class="marker {kind}">
  <div class="diamond"></div>
  <span>名称</span>
  <small>距离</small>
</div>
```

`kind ∈ {pod, anchor, pack, optional}`，CSS 负责颜色与菱形样式。

## 3. 每帧渲染 `render(s, options)`

### 3.1 相机

```js
camera.position.set(...s.p);
camera.rotation.set(s.pitch, -s.yaw, 0, "YXZ");
```

- 位置直接取物理位置（第一人称，无弹簧/插值）；
- `z` 旋转恒为 0，保证**没有侧滚**（场景测试显式断言）。

受击震动：

```js
const shock = max(0, 1 - (s.time - this.hitTime) * 2);   // 0.5 秒内衰减
camera.position.x += sin(s.time * 73) * 0.025 * shock;
camera.position.y += sin(s.time * 58) * 0.018 * shock;
```

### 3.2 动态对象同步

| 对象 | 同步方式 |
|---|---|
| 岩石 | 首次出现时懒创建 `IcosahedronGeometry` + 线框环；每帧设置位置与缓慢自转 |
| 陨石 | `meteorPosition(METEORS[i], s.time, s.assist)` + 自转 |
| 补给 | `visible = !s.collected.includes(id)`；漂浮箱额外绕 Y 旋转 |
| 培养舱 | `podPosition(s.time)` + 轻微摆动 |
| 回收系缆 | `options.recovery` 存在时显示，并用 `setFromPoints` 更新两端 |

### 3.3 回收演出

```js
if (options.recovery) {
  const t = options.recovery;
  const end = new Vector3(1.5, 1, -106);
  pod.position.lerp(end, t*t*(3-2*t));       // smoothstep
  cable.visible = true;
  cable.geometry.setFromPoints([
    new Vector3(1.5, 0.8, -106),
    pod.position.clone(),
  ]);
}
```

培养舱沿 smoothstep 曲线被拉向回收平台，系缆一端固定在 `[1.5, 0.8, -106]`。

### 3.4 机械臂 IK 简化

```text
肩部 shoulder = [0.46, -0.55, -0.08]
待机手部 idle = [0.38, -0.37, -0.85]

若 已抓握 / (push|pickup|capture 且 age<0.9) / (captured 且 age<1.8):
    世界目标 → 相机局部坐标 → clampLength(0, 2.4)
    strength = anchor ? 1
             : captured ? min(1, age*3)
             : sin(min(1, age/0.9) * π)
    hand.lerp(target, strength)

若 repair > 0:
    hand = [0.18 + sin(repair*12)*0.025, -0.48, -0.92]   // 贴胶带抖动

肘部 = lerp([0.65,-0.42,-0.48], hand, 0.3)
armLink(upper, shoulder, elbow)
armLink(lower, elbow, hand)
```

要点：机械臂是**视觉近似**，不参与物理判定；抓取是否成功完全由 `physics.focus()/interact()` 决定。

### 3.5 修补动作

| 条件 | 表现 |
|---|---|
| `state.repair > 0` | 左手出现、胸前出现、位置带正弦抖动 |
| `arm.kind === "repair-done" && age < 1.2` | 左手与胸前保持显示 |
| `state.repair > 1.2` 或修补刚完成 | `tapeStrip` 显示 |

### 3.6 DOM 标记投影

对每个标记：

1. 计算目标位置（培养舱用实时 `pod.position`）；
2. 距离可见性：
   - `pod`：始终可见；
   - `anchor`：< 22m；
   - `pack` / `optional`：< 15m 且未拾取；
   - 回收演出期间全部隐藏。
3. `Vector3.project(camera)` 得到 NDC，判断是否在前方；
4. 若在背后或超出屏幕：
   - 非培养舱 → 隐藏；
   - 培养舱 → 贴边显示，加 `edge` 类与 `↗` 前缀。
5. 写入 `left` / `top` 像素位置与透明度：
   - 培养舱恒为 1；
   - 其他 `min(1, (25 - dist) / 12)`，越远越淡。
6. `small` 显示 `距离 m`。

### 3.7 自适应尺寸 `resize()`

```js
const w = canvas.clientWidth, h = canvas.clientHeight;
if (!w || !h) return;
renderer.setSize(w, h, false);
camera.aspect = w / h;
camera.updateProjectionMatrix();
```

通过 `ResizeObserver` 监听 canvas，窗口/布局变化自动适配。

## 4. `SuitAudio` — 程序化音效

`audio.mjs` 只有 79 行，完全用 WebAudio 合成，无音频文件。

### 4.1 节点图

```text
噪声 BufferSource(2s 白噪声, loop)
   → BiquadFilter(bandpass, 1400Hz)
   → hiss Gain(0)
   → master Gain(0.4) → destination

Oscillator(triangle, 75Hz)
   → thrust Gain(0)
   → master Gain(0.4) → destination
```

`start()` 在首次用户交互后调用（浏览器自动播放策略要求）；`enabled = false` 或环境不支持 `AudioContext` 时静默降级。

### 4.2 `update(s, active)`

| 通道 | 目标增益 | 说明 |
|---|---|---|
| `master` | `enabled ? 0.4 : 0` | 总开关，0.1s 平滑 |
| `hiss` | `active ? leak * 0.08 + 0.012 * (1 + sin(time*1.3)) : 0` | 漏气嘶声，带轻微脉动 |
| `thrust` | `active && (boosting || braking) ? 0.06 : 0` | 推进/制动低频嗡鸣 |

均使用 `setTargetAtTime`，避免爆音。

### 4.3 `tone(kind)`

| kind | 波形 | 频率 | 用途 |
|---|---|---|---|
| `good`（默认） | sine | 700 → 950 Hz | 拾取、抓握、修补、捕获 |
| `warn` | sine | 330 → 240 Hz | 过热、缺氧、越界、速度过高 |
| `hit` | triangle | 120 → 55 Hz | 撞击 |

每次创建一次性振荡器，增益从 0.1 指数衰减到 0.001（0.3s）后停止。

## 5. 性能与包体

| 项目 | 数值/策略 |
|---|---|
| 顶点量 | 星空 1700 点；地球球体 64×48；其余为低多边形盒/柱/二十面体 |
| 像素比 | `min(devicePixelRatio, 1.75)`，避免高分屏过度渲染 |
| 材质 | 大量共用 `MeshStandardMaterial` 参数；只有文字牌使用 CanvasTexture |
| 贴图文件 | 0；文字用 512×128 Canvas 动态生成 |
| 模型文件 | 0；全部 `BoxGeometry` / `CylinderGeometry` / `SphereGeometry` / `IcosahedronGeometry` |
| 阴影 | 未启用阴影贴图 |
| 后处理 | 无（只用 tone mapping） |
| 音效文件 | 0；WebAudio 合成 |

这些策略同时满足“零网络素材”“无版权风险”“ZIP ≤ 12MB”的硬性要求。

## 6. 场景测试

`qa/scene.test.mjs` 使用**真实 Three.js 对象**，只桩掉 `WebGLRenderer` 与 2D Canvas 文本绘制：

1. 相机位置与 `state.p` 一致；世界前向与 `physics.forward(yaw,pitch)` 一致；`rotation.z === 0`；机械臂挂在相机下；陨石 14 颗。
2. 抓握/修补/回收时 `left`、`tapeStrip`、`cable` 可见性正确，场景中所有对象的位置与四元数均为有限值（防止 NaN 传染）。

测试不执行 GPU 渲染，因此不能替代真实 WebGL 画面验收。
