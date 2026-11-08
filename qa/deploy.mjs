import { spawnSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(`用法：npm run deploy [-- --dry-run]

构建并检查游戏，再同步 game/ 的内容到：
  root@game.notical.cn:/www/wwwroot/game.notical.cn/

--dry-run  构建并检查，连接服务器预览文件变化，不写入远端。
DEPLOY_USER 可覆盖 SSH 用户（默认 root）。
DEPLOY_PORT 可覆盖 SSH 端口（默认 22）。
使用已有 SSH 密钥及配置，不删除远端文件。`);
  process.exit(0);
}
if (args.some((arg) => arg !== "--dry-run")) {
  console.error("不支持的参数。使用 npm run deploy -- --help 查看用法。");
  process.exit(1);
}

const user = process.env.DEPLOY_USER || "root";
const port = process.env.DEPLOY_PORT || "22";
if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(user)) {
  console.error("DEPLOY_USER 必须是有效的 SSH 用户名。");
  process.exit(1);
}
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error("DEPLOY_PORT 必须是 1–65535 的整数。");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const destination = `${user}@notical.cn:/www/wwwroot/game.notical.cn/`;
const dryRun = args.includes("--dry-run");
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`无法执行 ${command}：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

run("npm", ["run", "build"]);
run("npm", ["run", "check"]);
console.log(`${dryRun ? "预览同步" : "部署"} → ${destination}`);
run("rsync", [
  "-az",
  "--delay-updates",
  "--itemize-changes",
  "--human-readable",
  "--chmod=D755,F644",
  "--exclude=.*",
  ...(dryRun ? ["--dry-run"] : []),
  "-e",
  `ssh -o BatchMode=yes -o ConnectTimeout=15 -p ${port}`,
  `${path.join(root, "game")}/`,
  destination,
]);
console.log(
  dryRun
    ? "预览完成，未修改远端文件。"
    : "部署完成：https://game.notical.cn/",
);
