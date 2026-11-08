# 03 · 世界模型与物理模拟

本文覆盖 [src/world.mjs](file:///home/songyx-15x/Project/treaHackson/src/world.mjs) 与 [src/physics.mjs](file:///home/songyx-15x/Project/treaHackson/src/physics.mjs)。这两个模块构成游戏的“规则内核”，不依赖 DOM、WebGL 或 Three.js，因此可以在 Node 中完整模拟一条通关路线。

## 1. 坐标系与朝向约定

| 项目 | 约定 |
|---|---|
| 坐标系 | 右手系，`+Y` 向上，空间站沿 `-Z` 方向延伸 |
| 起点 | 气闸外 `[0, 0, 4]` |
| 终点 | 培养舱初始 `[3, 1, -119]`，随时间缓慢漂移 |
| `yaw` | 偏航角，`0` 时朝向 `-Z` |
| `pitch` | 俯仰角，`>0` 抬头，限制在 `±1.42 rad` |
| 前向向量 | `forward(yaw, pitch) = [sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)]` |
| 右向向量 | `[cos(yaw), 0, sin(yaw)]` |
| 相机旋转 | `camera.rotation.set(pitch, -yaw, 0, "YXZ")`，无侧滚 |

## 2. 世界数据（world.mjs）

### 2.1 `ANCHORS` — 扶手检查点（6 个）

| 序号 | id | 位置 `[x,y,z]` | 名称 | 区域 |
|---|---|---|---|---|
| 0 | `airlock` | `[0, 0, 4]` | 气闸扶手 | 气闸外缘 |
| 1 | `rail-1` | `[0, 0, -14]` | 01 · 外壁扶手 | 空间站外壁 |
| 2 | `rail-2` | `[3, 3, -37]` | 02 · 翼板避难点 | 断裂翼板 |
| 3 | `rail-3` | `[2, 2, -60]` | 03 · 中继维护架 | 陨石穿越区 |
| 4 | `rail-4` | `[4, 0, -82]` | 04 · 补给扶手 | 外部作业区 |
| 5 | `rail-5` | `[2, 1, -104]` | 05 · 回收平台 | 培养舱附近 |

**关键约束**：`ANCHORS` 的数组下标就是检查点序号。`interact()` 只在 `findIndex(anchor) > s.checkpoint` 时推进检查点，因此数组必须按路线从前往后排列；插入新扶手会改变后续序号。

`anchorGrip(a) = [a.p[0] - 0.8, a.p[1] - 0.35, a.p[2] - 0.65]`：机械臂实际抓握点（视觉与交互焦点），比扶手中心略向左下后方偏。

### 2.2 `BOXES` — 碰撞盒（AABB）

`BOXES` 由三部分自动生成：

| 来源 | 数量 | 尺寸 | 说明 |
|---|---|---|---|
| 每个 `ANCHOR` 的 `-shield` 护板 | 6 | `[0.18, 2.7, 2.8]`，位于扶手 `x+1.8, y+0.1, z-0.3` | 挡住侧向陨石 |
| 每个 `ANCHOR` 的 `-roof` 顶棚 | 6 | `[3.5, 0.12, 2.8]`，位于扶手 `y+1.7, z-0.3` | 形成“维护架”庇护空间 |
| 太阳能板 `solar-0..5` | 6 | `[9, 0.16, 10]`，`x=5, y=4`，`z=[3,-18,-39,-65,-88,-108]` | 薄板，可碰撞 |
| 舰体 `hull-0..5` | 6 | `[10, 10, 18]`，`x=-9, y=-1`，同 z 列表 | 主碰撞体，也是遮挡体 |
| 破损结构 | 3 | `broken-panel` `[7,4,1.2] @ [0,-2,-32]`、`broken-truss` `[8,3,1] @ [1,4.5,-67]`、`broken-fin` `[5,8,1] @ [-2,-1,-94]` | 路线障碍 |

`kind` 字段只用于渲染配色（`hull` / `panel` / `shelter` / `solar` / `truss`）。

### 2.3 `PACKS` — 补给包（7 个）

| id | 位置 | 氧气 | 胶带 | 备注 |
|---|---|---|---|---|
| `pack-0` 气闸应急包 | `[1.1, -0.15, 1]` | 20 | 1 | 主路保底 |
| `pack-1` 外壁应急包 | `[1.2, -0.15, -14.8]` | 28 | 1 | 01 扶手附近 |
| `pack-2` 翼板维修包 | `[4.2, 2.85, -37.8]` | 28 | 1 | 02 扶手附近 |
| `pack-3` 中继应急包 | `[3.2, 1.85, -60.8]` | 28 | 1 | 03 扶手附近 |
| `pack-4` 回收维修包 | `[5.2, -0.15, -82.8]` | 28 | 1 | 04 扶手附近 |
| `pack-side-1` 漂浮补给箱 | `[9, 5, -23]` | 45 | 2 | `optional: true`，远离主路 |
| `pack-side-2` 漂浮维修箱 | `[10, -4, -72]` | 45 | 2 | `optional: true` |

- 每个包只能拾取一次，记录在 `state.collected`。
- 氧气上限 100，胶带上限 5。
- 抓稳扶手后，`collectNearby()` 会自动拾取 3m 内第一个未拾取的包（按 `PACKS` 顺序查找）。

### 2.4 `ROCKS` — 低速陨石（5 块，可推动）

| id | 位置 | 质量 | 半径 |
|---|---|---|---|
| `rock-0` | `[1.5, 0.4, -8]` | 4 | 0.65 |
| `rock-1` | `[4, 1, -24]` | 5 | 0.8 |
| `rock-2` | `[3, 3, -48]` | 4 | 0.7 |
| `rock-3` | `[4, -1, -76]` | 6 | 0.85 |
| `rock-4` | `[3, 2, -99]` | 4 | 0.6 |

运行时每个 rock 被复制为 `{ ...r, p: [...r.p], v: [0,0,0], cooldown: 0 }`，避免污染静态数据。

### 2.5 `METEORS` — 高速陨石（14 颗）

生成公式（`i = 0..13`）：

```js
{
  id: "meteor-" + i,
  z: -19 - i * 6.2,           // -19 ~ -99.6
  y: [0, 1.5, 3, -1, 2, -0.3, 1][i % 7],
  r: [0.55, 0.8, 0.6, 1, 0.7][i % 5],
  phase: i * 1.73,
  period: 12 + (i % 3),       // 12 / 13 / 14 秒
  speed: 4.5 + (i % 3) * 0.65 // 4.5 / 5.15 / 5.8 m/s
}
```

位置函数：

```js
meteorPosition(m, time, assist) {
  const t = (time * (assist >= 2 ? 0.65 : 1) + m.phase) % m.period;
  return [
    23 - t * m.speed,                              // 从 +X 侧横掠
    m.y + Math.sin(t * 0.35 + m.phase) * 0.5,
    m.z + Math.sin(t * 0.2) * 1.2,
  ];
}
```

`assist >= 2` 时陨石时间流速降为 0.65 倍，即“放水”。

### 2.6 `podPosition` — 培养舱轨迹

```js
podPosition(time) = [
  3 + time * 0.018,                  // 极缓慢右漂
  1 + Math.sin(time * 0.05) * 0.15,  // 轻微上下浮动
  -119 - time * 0.055,               // 以 0.055 m/s 远离空间站
]
```

## 3. 物理状态（`initial` / `restore`）

### 3.1 状态字段

`initial(assist = 0)` 返回的对象字段如下，后续所有模拟都原地修改它：

| 字段 | 类型 | 含义 |
|---|---|---|
| `p` | `[x,y,z]` | 位置，初始 `[0,0,4]` |
| `v` | `[x,y,z]` | 速度，初始 `[0,0,0]` |
| `yaw` / `pitch` | number | 朝向 |
| `time` | number | 本关物理时间（秒），只在 `active` 推进 |
| `oxygen` | 0~100 | 氧气 |
| `heat` | 0~100 | 推进器热量 |
| `overheated` | bool | 是否过热 |
| `boosting` / `braking` | bool | 本帧推进/制动状态 |
| `leak` | 0~3 | 漏气等级 |
| `tape` | 0~5 | 修补胶带数量 |
| `repair` | number | 当前持续修补秒数（满 3 秒生效） |
| `anchor` | `string \| null` | 当前抓握的扶手 id |
| `checkpoint` | number | 最近检查点下标 |
| `collected` | `string[]` | 已拾取补给 id |
| `checkpointItems` | `string[]` | 检查点时的补给快照 |
| `checkpointTape` | number | 检查点时的胶带快照 |
| `assist` | 0/1/2 | 放水档位 |
| `hitCooldown` | number | 撞击无敌时间 |
| `arm` | `{kind, age, target}` | 机械臂动画状态 |
| `outside` | number | 离开作业区累计秒数 |
| `exhausted` | bool | 氧气耗尽 |
| `captured` | bool | 已抓住培养舱 |
| `rocks` | array | 运行时岩石状态 |
| `pushes` / `repairs` / `impacts` | number | 统计计数 |

初始装备：`assist >= 2` 时额外给 1 卷胶带（`tape: 1`）。

### 3.2 救援恢复 `restore(s, assist, medical = true)`

| 字段 | `medical = true`（缺氧） | `medical = false`（越界） |
|---|---|---|
| `p` | 最近检查点 `anchor.p` | 同左 |
| `v` | `[0,0,0]` | 同左 |
| `yaw` / `pitch` | 归零 | 归零 |
| `oxygen` | 100 | `max(0, 旧值 - 15)` |
| `leak` | 0（破口全部封堵） | 保留 |
| `tape` | `max(checkpointTape, assist>=2?1:0)` | 保留 |
| `collected` | 回滚到检查点快照 | 保留 |
| `rocks` | 全部重置 | 保留 |
| `heat` / `overheated` | 归零 / `false` | 同左 |
| `boosting` / `braking` | `false` | 同左 |
| `repair` | 0 | 0 |
| `anchor` | 设为检查点扶手 id（复活后处于抓握状态） | 同左 |
| `outside` / `exhausted` | 0 / `false` | 同左 |
| `hitCooldown` | 4 秒 | 4 秒 |
| `arm` | `{kind:"grab", age:0, target:anchorGrip}` | 同左 |

注意：`time` 不被恢复，世界时间只前进不倒退；`checkpoint` 保留。

## 4. 核心函数参考

### 4.1 向量工具 `V`

| 函数 | 签名 | 说明 |
|---|---|---|
| `V.add(a,b)` | `→ vec3` | 逐分量加 |
| `V.sub(a,b)` | `→ vec3` | 逐分量减 |
| `V.mul(a,n)` | `→ vec3` | 标量乘 |
| `V.dot(a,b)` | `→ number` | 点积 |
| `V.len(a)` | `→ number` | 模长 |
| `V.dist(a,b)` | `→ number` | 距离 |
| `V.unit(a)` | `→ vec3` | 单位化，零向量返回 `[0,0,0]` |

### 4.2 朝向工具

| 函数 | 签名 | 说明 |
|---|---|---|
| `forward(yaw, pitch)` | `→ vec3` | 由角度得到前向单位向量 |
| `lookAt(from, to)` | `→ {yaw, pitch}` | 由两点得到朝向；`yaw = atan2(dx, -dz)` |
| `clamp(n, a, b)` | `→ number` | 数值夹取 |

### 4.3 交互判定

#### `occluded(from, to) → boolean`

用 **线段-AABB 裁剪（slab method）** 检查视线是否穿过任何 `BOXES`：

- 对每个盒子计算线段进入/离开参数 `lo/hi`；
- 返回 `lo < 0.98 && hi > 0.01` 视为遮挡；
- 排除终点附近 1% 的误差带，避免目标贴墙时误判。

作用：防止隔着舰体、太阳能板、破损结构抓取补给/扶手/培养舱。

#### `focus(s) → target | null`

生成当前可交互目标：

1. 取前向 `f = forward(yaw, pitch)`；
2. 对以下候选做筛选：
   - `ANCHORS`：焦点 `anchorGrip(a)`，距离 ≤ `2.8`（`assist>=2` 时 `3.5`）；
   - `PACKS`：未拾取的，距离 ≤ `3`；
   - `s.rocks`：`cooldown <= 0`，距离 ≤ `3`；
   - `pod`：未捕获，距离 ≤ `3`（`assist>=2` 时 `4`）；
3. 条件：`dot(unit(delta), f) > 0.87`（约 29.5° 半角）且 `!occluded(s.p, target)`；
4. 评分 `score = dot - distance * 0.015`，取最高分。

返回结构：`{ kind, id, p, name, distance, score }`，`kind ∈ {anchor, pack, rock, pod}`。

#### `interact(s) → {type, name?}`

按优先级处理：

| 情形 | 行为 | 返回 `type` |
|---|---|---|
| `exhausted` 或 `captured` | 忽略 | `none` |
| 已抓握 `s.anchor` | 松开，清 `repair`，机械臂 `release` | `release` |
| 无目标 | 忽略 | `none` |
| 目标 `anchor` | `anchor=id`、速度归零、机械臂 `grab`；若下标 > `checkpoint` 则更新检查点快照 | `checkpoint` / `grab` |
| 目标 `pack` | 加入 `collected`，加氧加胶带 | `pickup` |
| 目标 `rock` | 施加冲量 `2.7`，岩石获得 `impulse / mass` 反向速度，冷却 1s | `push` |
| 目标 `pod` | 速度 > 2.2 拒绝；否则 `captured=true`，速度归零 | `too-fast` / `capture` |

岩石冲量满足动量守恒：`s.v -= d*2.7`，`r.v += d*2.7/mass`。

#### `collectNearby(s) → {type, name?}`

仅在 `s.anchor` 存在时生效：按 `PACKS` 顺序找第一个未拾取、距离 < 3、未被遮挡的包并拾取；同时刷新 `checkpointTape` 与 `checkpointItems`（便于死亡后仍保留）。

### 4.4 伤害 `impact(s, normal, strength) → boolean`

触发条件（任一不满足则返回 `false`）：

- `s.time >= 5`（开局 5 秒保护）；
- `s.hitCooldown <= 0`；
- 未抓握扶手（抓稳时免疫撞击）。

效果：

| 项 | 数值 |
|---|---|
| 速度反弹 | `v += normal * min(2.5, strength * 0.35)` |
| 漏气 | `+1`，上限 3 |
| 氧气扣减 | `3`（`assist>=1` 时为 `1`） |
| 冷却 | `2.5s`（`assist>=1` 时为 `4s`） |
| 抵消 | `repair = 0`，`impacts++` |

### 4.5 主模拟 `step(s, input = {}, dt = DT) → events[]`

`DT = 1/120`。执行顺序：

```text
1. exhausted / captured → 直接返回 []
2. time += dt; arm.age += dt; hitCooldown -= dt
3. boosting=false; braking=!!input.brake
4. if anchor:
     位置以 1-exp(-10dt) 插值吸向 anchor.p；v=0
     若 input.repair && tape>0 && leak>0 → repair += dt，满 3s 修补成功（tape--、leak=0、事件 repaired）
     否则 repair=0
   else:
     期望方向 = 前向*forward + 右向*side + [0, up, 0]，单位化
     boosting = input.boost && !overheated && 有方向 && !brake
     加速度 = boosting ? 4.8 : 1.25
     v += desired * accel * dt
     if brake: v *= exp(-3.4dt)
     限速 7 m/s
     球体移动 + AABB 碰撞；碰撞速度 > 1.6 触发 impact（事件 hit）
5. 热量：boosting +27/s（到 100 过热）；否则 -19/s（抓握时 -27/s）；过热状态降到 <=35 解除
6. 岩石：冷却递减；球体移动 + AABB 碰撞
     与玩家距离 < r+0.45 且未抓握：
       推出玩家 + 沿法线反弹 speed*1.15
       speed > 1.8 触发 impact（事件 hit）
7. 陨石：距离 < r+0.45 → impact（事件 hit）
8. 越界判定：|x|>25 或 |y|>20 或 z>24 或 z<-155，累计 outside
     outside > 5s → 事件 lost
9. time > 5 后耗氧：
     (0.45 + leak*0.65) * (assist>=2 ? 0.55 : 1) / 秒
     oxygen <= 0 → exhausted=true，事件 exhausted
```

输入对象：

```ts
{
  forward: -1..1;   // W/S
  side: -1..1;      // D/A
  up: -1..1;        // Space / (C | LeftCtrl)
  boost: boolean;   // Shift
  brake: boolean;   // X
  repair: boolean;  // R
}
```

### 4.6 球体碰撞 `moveSphere(b, dt, radius)`（内部函数）

与每个 `BOXES` 做 AABB-球检测：

1. 位置先按速度积分；
2. 若球心到盒子的三轴“穿透深度”全为正，取最小穿透轴；
3. 将球推出到盒面 + 半径；
4. 若速度朝盒内，则该轴速度乘以 `-0.35`（阻尼反弹）；
5. 反弹前速度 > 1.6 时返回 `{normal, strength}`，供 `impact()` 使用。

## 5. 数值平衡速查

| 参数 | 值 | 位置 |
|---|---|---|
| 物理步长 | `1/120 s` | `DT` |
| 普通推进加速度 | `1.25 m/s²` | `step()` |
| 强推加速度 | `4.8 m/s²` | `step()` |
| 最大速度 | `7 m/s` | `step()` |
| 制动衰减 | `e^{-3.4t}` | `step()` |
| 热量上升 | `27/s` | `step()` |
| 热量下降 | `19/s`（抓握 `27/s`） | `step()` |
| 过热解除阈值 | `35` | `step()` |
| 开局保护 | `5 s` | `impact()` / `step()` |
| 基础耗氧 | `0.45/s` | `step()` |
| 每级漏气额外耗氧 | `0.65/s` | `step()` |
| 应急供氧系数 | `0.55`（assist=2） | `step()` |
| 修补耗时 | `3 s` 连续按住 R | `step()` |
| 撞墙判定速度 | `> 1.6 m/s` | `moveSphere()` |
| 推石冲量 | `2.7` | `interact()` |
| 抓取培养舱限速 | `2.2 m/s` | `interact()` |
| 越界宽限 | `5 s` | `step()` |
| 越界惩罚 | 氧气 −15% | `restore(..., medical=false)` |

## 6. 测试覆盖（对应 `qa/physics.test.mjs`）

14 项测试直接针对本模块：

1. 无动力飞行保持三维动量、无阻力；
2. 视角相对推进 + 独立垂直控制；
3. 增压过热、普通推进与制动仍可用、冷却恢复；
4. 推石产生等大反向动量、不是固定落脚点；
5. 开局 5 秒不耗氧、不受伤害；
6. 撞击产生有上限的持续漏气、冷却防叠加；
7. 修补需要抓握、胶带与连续 3 秒；
8. 补给只生效一次；
9. 检查点救援恢复位置与医疗状态、不倒退世界时间；
10. 抓握时免疫撞击、修补时不会漂移；
11. 交互射线不能穿过舰体；
12. 抓取培养舱需要距离、瞄准与可控速度；
13. 缺氧只触发一次、辅助降低耗氧；
14. 正常连续 EVA 路线可在 270 秒内抓住培养舱。
