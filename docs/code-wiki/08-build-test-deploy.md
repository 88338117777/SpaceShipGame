# 08 · 构建、测试、打包与部署

所有工程脚本都在 [qa/](file:///home/songyx-15x/Project/treaHackson/qa) 目录，通过 [package.json](file:///home/songyx-15x/Project/treaHackson/package.json) 暴露为 npm scripts。

## 1. npm 脚本

| 命令 | 实际执行 | 作用 |
|---|---|---|
| `npm run dev` | `python3 -m http.server 8080 --bind 127.0.0.1` | 本地静态服务器，访问 `/game/` |
| `npm run build` | `node qa/build.mjs` | `src/main.mjs` → `game/app.js` |
| `npm test` | 依次运行 3 个测试文件 | 23 项 Node 测试 |
| `npm run check` | `node participant-delivery-kit-v3.3.2/tools/check.mjs game game/global-items.json` | 官方交付自检（目录 + 道具声明） |
| `npm run test:browser` | `node qa/run.mjs` | Playwright 真实 Chromium 验收 |
| `npm run pack` | `python3 qa/pack.py` | 构建 + 打 ZIP |
| `npm run deploy` | `node qa/deploy.mjs` | 构建 + 自检 + rsync 上传 |

> `dev` 使用 Python 3；若机器没有 `python3`，可换任意静态服务器（如 `npx serve`），但**不能用 `file://` 打开**，否则 iframe/指针锁定/协议行为与正式环境不一致。

## 2. 构建 `qa/build.mjs`

```js
esbuild.build({
  entryPoints: ["src/main.mjs"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "firefox100", "safari15"],
  outfile: "game/app.js",
  minify: true,
  legalComments: "inline",
});
```

要点：

| 配置 | 原因 |
|---|---|
| `bundle: true` | 把 `view/physics/world/audio` 与 `vendor/three.module.js` 全部内联 |
| `format: "iife"` | 经典脚本，可在无 `allow-same-origin` 的 iframe 中执行 |
| `target: ["chrome100","firefox100","safari15"]` | 覆盖主流桌面浏览器，避免过新语法 |
| `minify: true` + `legalComments: "inline"` | 控制包体，同时保留 Three.js 等许可证注释 |
| 单出口 | 只生成 `game/app.js`，不产生 code-splitting 请求 |

依赖解析支持 `ESBUILD_PATH`：当项目 `node_modules` 缺失或安装受限时，可指向已有的 esbuild 包路径。

```bash
ESBUILD_PATH=/path/to/node_modules/esbuild npm run build
```

构建结束后可看到产物体积（约 525 KB）。如果试玩发现修改未生效，先确认构建成功且 `game/app.js` 时间戳已更新。

## 3. 测试体系

### 3.1 总览

| 文件 | 运行环境 | 用例数 | 关注点 |
|---|---|---|---|
| [qa/physics.test.mjs](file:///home/songyx-15x/Project/treaHackson/qa/physics.test.mjs) | 纯 Node | 14 | 物理、生存、交互、完整路线 |
| [qa/game-flow.test.mjs](file:///home/songyx-15x/Project/treaHackson/qa/game-flow.test.mjs) | JSDOM + 桩 | 7 | 键鼠输入、HUD、存档、协议交接 |
| [qa/scene.test.mjs](file:///home/songyx-15x/Project/treaHackson/qa/scene.test.mjs) | Node + Three.js | 2 | 相机同步、机械臂、回收演出、NaN 防护 |

合计 **23 项**，全部为原生 `node:test` + `node:assert/strict`，无第三方测试框架。

### 3.2 物理测试（14 项）

1. 无动力飞行保持三维动量、无阻力；
2. 视角相对推进，垂直控制独立；
3. 增压过热后普通推进与制动仍可用，冷却后恢复强推；
4. 推石产生等大反向动量，岩石可移动且不是固定落脚点；
5. 开局 5 秒不耗氧、不受伤害；
6. 撞击产生有上限的持续漏气，冷却期间不叠加；
7. 修补需要抓握、胶带与连续 3 秒；
8. 补给只生效一次；
9. 检查点救援恢复位置与医疗状态，世界时间不倒退；
10. 抓握时免疫撞击，修补时不会漂移；
11. 交互射线不能穿过舰体；
12. 抓取培养舱需要距离、瞄准与可控速度；
13. 缺氧只触发一次，辅助档位降低耗氧；
14. 正常连续 EVA 路线可在 270 秒内抓住培养舱。

第 14 项是“可通关性”的回归测试：它用脚本按路线输入，验证 270 秒内能完成，防止调参把关卡改成不可通关。

### 3.3 流程测试（7 项）

使用 JSDOM 加载真实的 `game/index.html` 与 `game/shared/save-protocol.js`，再用 `window.eval` 执行 `src/main.mjs` 源码，仅把以下依赖替换为桩：

- `View` → `window.TestView`（`render()` / `hit()` 空实现）；
- `SuitAudio` → `window.TestAudio`；
- `requestAnimationFrame` → 手动保存回调，用 60fps 时钟步进；
- `performance.now` → 可控递增时间；
- `parent` → 记录 `postMessage` 的宿主桩；
- `localStorage` 等由无 same-origin 的 JSDOM/协议库兜底。

协议、存档归一化、`IW_INIT_SAVE` 消息、游戏主程序都是真实代码。7 个用例：

1. 迟到的存档仍能同步实际 HP、初始装备、辅助档位与上家钩子；
2. 开局 5 秒安全；松开推进键后仍保持惯性运动；
3. 暂停冻结运动与氧气，但任务总计时继续；
4. 正常第一人称输入路线在 1 血、无装备条件下完成，包含回收演出与官方交接；
5. 缺氧使用官方 `WL.respawn()`；连续阵亡解锁两档辅助；
6. 管理员治疗同步实际 HP 与救援位置；
7. 取消认输不交接；确认认输只发送一次官方失败交接。

### 3.4 场景测试（2 项）

- 相机位置/朝向与物理一致、无侧滚、机械臂挂在相机下、14 颗陨石；
- 抓握/修补/回收时可见性正确，所有对象位置与旋转均为有限值。

### 3.5 运行

```bash
npm test

# 或单独运行
node qa/physics.test.mjs
node qa/game-flow.test.mjs
node qa/scene.test.mjs
```

`JSDOM_PATH` 可指定已安装的 jsdom 路径：

```bash
JSDOM_PATH=/path/to/node_modules/jsdom npm test
```

### 3.6 测试的边界

- 不验证真实 WebGL 画面、CSS 布局、字体渲染；
- 不验证指针锁定在真实浏览器中的行为；
- 不验证跨域 iframe 的 `postMessage` 实际投递，只验证调用参数；
- 不验证声音的实际听感。

这些由 `npm run test:browser` 与人工试玩补足。

## 4. 浏览器验收 `qa/run.mjs`

流程：

1. 脚本**自己启动**一个临时静态服务器（端口 0，随机可用端口），无需先运行 `npm run dev`；
2. 启动 Playwright Chromium（headless，参数 `--no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader`，视口 1600×1000）；
3. 打开 `participant-delivery-kit-v3.3.2/mock-runner.html`，填入游戏地址、选择 `game/global-items.json`、使用 `wounded` 预设存档；
4. 启动 iframe，等待 `window.__telemetry.hp === 1`，截图 `output/eva-opening.png`；
5. 通过真实键盘/鼠标事件（`KeyboardEvent`、`MouseEvent`、`movementX/Y`）走完整路线：取补给、逐个抓扶手、修补、抓培养舱；
6. 断言 `phase === "won"`、耗时 <270s、HP 仍为 1、只收到 1 次 `IW_COMPLETE` 且 `acquiredItemIds === []`；
7. 重新启动，执行 Esc → 终止任务 → 确认，断言收到 `IW_FAIL`，且页面无未捕获异常；
8. 写入 [output/browser-result.json](file:///home/songyx-15x/Project/treaHackson/output/browser-result.json)，并保存 `output/eva-rail-2.png`、`output/eva-rail-4.png`、`output/eva-ending.png`。

环境变量：

| 变量 | 用途 |
|---|---|
| `PLAYWRIGHT_PATH` | 指定 playwright 包路径 |
| `CHROME_PATH` | 使用已有 Chromium，而非 Playwright 下载版 |

```bash
npm run test:browser
# 或
CHROME_PATH=/usr/bin/chromium PLAYWRIGHT_PATH=/path/to/playwright npm run test:browser
```

前提：未安装 Chromium 时需先 `npx playwright install chromium`。该脚本要求**指针锁定成功**；若环境不支持指针锁定，需人工验证拖动观察的替代路径。当前 `output/browser-result.json` 记录的是此前环境 `EPERM`（禁止监听端口）导致的失败，不代表最新代码必然失败。

## 5. 打包 `qa/pack.py`

职责（脚本非常精简，没有预检）：

1. 递归遍历 `game/`，保持相对路径，用 `ZIP_DEFLATED, compresslevel=9` 写入 `output/zero-g-hour-nine.zip`；
2. 调用官方 `check.mjs <zip> game/global-items.json` 检查实际压缩包与道具声明；
3. 打印 ZIP 字节数。

因此：`game/` 里多余的临时文件也会被打进 ZIP；打包前应确认目录干净。当前 ZIP 为 6 个运行文件。

产物要求（官方限制）：

| 项目 | 限制 | 当前 |
|---|---|---|
| ZIP 大小 | ≤ 12 MB | 156,093 字节 |
| 解压大小 | ≤ 40 MB | 约 0.6 MB |
| 文件数 | ≤ 250 | 6 |
| 单文件 | ≤ 35 MB | app.js 524,925 字节 |
| 入口 | 根目录 `index.html` | ✅ |

ZIP 内**不包含** `src/`、`qa/`、测试、文档和 `participant-delivery-kit-v3.3.2/`。

## 6. 官方自检 `npm run check`

调用 [check.mjs](file:///home/songyx-15x/Project/treaHackson/participant-delivery-kit-v3.3.2/tools/check.mjs)，对目录或 ZIP 执行静态检查：

| 检查 | 说明 |
|---|---|
| 目录结构 | `index.html`、`app.js`、`style.css`、`global-items.json` 是否存在 |
| 包体限制 | 大小、文件数、单文件大小 |
| 禁用文件 | `.unityweb`、`.glb`、`.gltf`、`.ktx2`、`node_modules` 等 |
| 禁用 API | `alert(`、`confirm(`、`top.location`、`parent.location` |
| 绝对路径 | `src="/..."`、`href="/..."` 等 |
| 协议文件 | `shared/save-protocol.js` 是否存在 |
| 道具声明 | `schema` 字段、`items` 数组、字段合法性 |
| 存档契约 | 是否出现 `localStorage` 直接读写等风险写法 |

`check.mjs` 是**静态扫描**，不能证明游戏可玩；它不能替代 `npm test` 与 `npm run test:browser`。

## 7. 部署 `qa/deploy.mjs`

代码中的默认值（以源码为准）：

```js
const user = process.env.DEPLOY_USER || "root";
const host = "notical.cn";
const port = process.env.DEPLOY_PORT || "22";
const remote = "/www/wwwroot/game.notical.cn";
```

执行顺序：

1. `npm run build`（生成最新 `game/app.js`）；
2. `npm run check`（官方自检）；
3. `rsync -az --delete` 将 `game/` 同步到远端目录。

```bash
npm run deploy
# 或覆盖用户/端口
DEPLOY_USER=deploy DEPLOY_PORT=2222 npm run deploy
```

注意：

- `README.md` 中写的 `root@game.notical.cn` 与代码里的 `notical.cn` 不一致，**以 `qa/deploy.mjs` 为准**；
- `--delete` 会删除远端 `game/` 中多余文件，这是有意的“目录镜像”；
- 部署前确保有 SSH 权限；不要在未确认目标主机时执行。

## 8. 验收清单

发布前建议按顺序执行：

```bash
npm install
npm run build
npm test
npm run check
npm run test:browser
npm run pack
```

人工试玩：

1. `npm run dev` → `http://127.0.0.1:8080/game/`；
2. 开场简报、开始、指针锁定、HUD 是否正常；
3. 走完整路线，确认补给、修补、救援、通关演出；
4. 暂停/继续、声音开关、终止任务；
5. `mock-runner.html` 中确认 `IW_COMPLETE` 与存档卡；
6. 检查 `game/global-items.json` 已单独上传（不是只放进 ZIP）。

## 9. 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 改了 `src/` 但游戏没变化 | 忘记构建 | `npm run build` |
| `npm install` 报 `EPERM`/权限错误 | 依赖目录权限或缓存锁定 | 清理 `node_modules` 后重装；或用 `ESBUILD_PATH`/`JSDOM_PATH`/`PLAYWRIGHT_PATH` 指向已有依赖 |
| `npm run dev` 端口占用 | 8080 已被占用 | `python3 -m http.server 8081` 并调整模拟器 URL |
| 页面黑屏/无 HUD | WebGL 不可用或 `app.js` 加载失败 | 看控制台；游戏会显示 WebGL 错误弹窗 |
| 指针无法锁定 | 浏览器策略或非用户手势 | 点击画布重试；游戏提供“按住左键拖动”降级 |
| 模拟器里读到默认存档 | 存档晚到或未监听事件 | 确认 `iw-save-ready` 处理存在 |
| 通关后大厅无反应 | 独立标签页打开或缺少 `CONFIG.itemManifest` | 通过 mock-runner/大厅 iframe 打开 |
| `test:browser` 启动失败 | 未安装 Chromium 或服务器未启动 | 安装 Chromium；先启动 `npm run dev` |
| 中文显示为方块 | 系统缺少中文字体 | 安装 Noto Sans CJK 等字体；不影响逻辑 |

## 10. 版本与历史

- 当前游戏版本 `0.2.0`（第一人称可玩灰盒）。
- `output/zero-g-planner-legacy.zip` 是旧版“轨道规划”玩法的归档，不属于当前提交。
- 自测记录（[完整流程自测记录.md](file:///home/songyx-15x/Project/treaHackson/完整流程自测记录.md)）显示完整流程约 125 秒，远低于 270 秒上限。
- 仓库根目录的 `.git/` 不是有效的 Git 仓库（无提交记录），版本管理需另行初始化。
