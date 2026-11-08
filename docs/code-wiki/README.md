# 失重第九小时 · Code Wiki

> 面向开发者的项目文档索引。目标：在不阅读全部源码的前提下，理解这个仓库做了什么、如何组织、如何运行、如何验证、如何与其他关卡接力。

## 1. 项目一句话

**《失重第九小时》是一个运行在浏览器中的第一人称舱外（EVA）动作冒险小游戏**：玩家穿着航服在空间站外壁飞行，躲避高速陨石、推动低速陨石借力、抓握扶手修补漏气，最终抓住装有「氧气花」的培养舱并完成系缆回收。它是「无限世界游戏接力黑客松」A 轨（ZIP）参赛作品，遵循 SAVE_STATE v3 存档接力协议。

- 版本：`0.2.0`（第一人称可玩灰盒）
- 技术栈：原生 ES Modules + Three.js r165 + Canvas/WebAudio，esbuild 打包为单文件经典脚本
- 运行时零网络依赖、零 CDN、零图片/模型素材（全部程序化生成）
- 入口：[game/index.html](file:///home/songyx-15x/Project/treaHackson/game/index.html)

## 2. 文档目录

| 文档 | 内容 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 整体架构、分层、运行时形态、数据流、游戏状态机 |
| [02-directory-and-dependencies.md](./02-directory-and-dependencies.md) | 目录结构、模块依赖图、外部依赖与版本约束 |
| [03-world-and-physics.md](./03-world-and-physics.md) | 世界数据表、物理/生存模拟、关键函数与数值参数 |
| [04-main-loop-and-input.md](./04-main-loop-and-input.md) | 主循环、输入映射、HUD、救援与回收流程、事件分发 |
| [05-rendering-and-audio.md](./05-rendering-and-audio.md) | Three.js 场景构建、第一人称相机、机械臂动画、程序化音效 |
| [06-protocol-integration.md](./06-protocol-integration.md) | SAVE_STATE v3 协议、WL API、iframe 握手、A/B 轨接法 |
| [07-ui-and-gameplay.md](./07-ui-and-gameplay.md) | HTML/CSS HUD 结构、操作键位、玩法规则与节奏 |
| [08-build-test-deploy.md](./08-build-test-deploy.md) | 构建、测试、浏览器验收、打包、云端部署、故障排查 |

## 3. 快速开始

### 3.1 直接试玩（无需安装依赖）

```bash
npm run dev
# 打开 http://127.0.0.1:8080/game/
```

仓库中已提交构建产物 `game/app.js`，因此不执行 `npm install` 也能运行。

### 3.2 接力模拟器试玩

打开 `http://127.0.0.1:8080/participant-delivery-kit-v3.3.2/mock-runner.html`：

1. 入口填写 `http://127.0.0.1:8080/game/`
2. 选择 `game/global-items.json`
3. 选择入场存档预设并启动

> 正式验收必须通过 HTTP + 隔离 iframe，不能用双击文件替代。

### 3.3 修改源码后的开发命令

```bash
npm install        # Node.js >= 22
npm run build      # src/main.mjs -> game/app.js（esbuild，IIFE，压缩）
npm test           # 23 项 Node 测试
npm run check      # 官方交付自检
npm run pack       # 构建 + 打包 output/zero-g-hour-nine.zip
npm run test:browser  # Playwright 真实浏览器验收（需 chromium）
npm run deploy     # 构建 + 检查 + rsync 部署
```

## 4. 核心术语

| 术语 | 含义 |
|---|---|
| `WL` | 官方接力协议库 `shared/save-protocol.js` 暴露的全局对象 |
| `save` | SAVE_STATE v3 存档对象（生命、理智、道具、线索、结尾钩子等） |
| `assist` | 连续阵亡放水档位：0 正常 / 1 连死两次 / 2 连死三次以上 |
| `exit_hook` | 本关结尾写给下一关的一句话 |
| `acquiredItemIds` | 本关实际获得的跨关道具 ID 数组（本项目恒为 `[]`） |
| `A 轨` | ZIP 交付，使用 `WL.readSave()` / `WL.completeLevel()` |
| `B 轨` | 外链交付，使用官方 SDK 的 `await WL.ready()` / `WL.complete()` / `WL.fail()` |
| `anchor` | 空间站外壁扶手检查点，抓稳后可修补并更新复活点 |
| `pod` | 装有氧气花的培养舱，最终回收目标 |
| `leak` | 航服漏气等级 0~3，数值越高耗氧越快 |

## 5. 关键文件速查

| 文件 | 职责 |
|---|---|
| [src/main.mjs](file:///home/songyx-15x/Project/treaHackson/src/main.mjs) | 应用入口：状态机、输入、HUD、救援/回收、协议交接 |
| [src/physics.mjs](file:///home/songyx-15x/Project/treaHackson/src/physics.mjs) | 120Hz 固定步长模拟：惯性、碰撞、抓握、热量、漏气、修补、救援 |
| [src/world.mjs](file:///home/songyx-15x/Project/treaHackson/src/world.mjs) | 纯数据世界定义：扶手、碰撞盒、补给、陨石、培养舱轨迹 |
| [src/view.mjs](file:///home/songyx-15x/Project/treaHackson/src/view.mjs) | Three.js 表现层：场景、相机、机械臂、标记、回收演出 |
| [src/audio.mjs](file:///home/songyx-15x/Project/treaHackson/src/audio.mjs) | WebAudio 程序化音效：漏气嘶声、推进器、提示音 |
| [game/index.html](file:///home/songyx-15x/Project/treaHackson/game/index.html) | 运行入口与 HUD DOM |
| [game/style.css](file:///home/songyx-15x/Project/treaHackson/game/style.css) | 头盔面罩、HUD、弹窗、标记样式 |
| [game/shared/save-protocol.js](file:///home/songyx-15x/Project/treaHackson/game/shared/save-protocol.js) | 官方 SAVE_STATE v3 协议库（不可修改） |
| [game/global-items.json](file:///home/songyx-15x/Project/treaHackson/game/global-items.json) | 跨关道具声明（本项目为空声明） |
| [qa/](file:///home/songyx-15x/Project/treaHackson/qa) | 构建、测试、打包、浏览器验收、部署脚本 |
| [vendor/three.module.js](file:///home/songyx-15x/Project/treaHackson/vendor/three.module.js) | 本地 Three.js r165（MIT） |
| [participant-delivery-kit-v3.3.2/](file:///home/songyx-15x/Project/treaHackson/participant-delivery-kit-v3.3.2) | 官方参赛交付工具包（协议、检查器、模拟器、示例） |
