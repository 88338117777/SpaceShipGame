import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_PATH || "esbuild");
await build({
  entryPoints: ["src/main.mjs"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "firefox100", "safari15"],
  outfile: "game/app.js",
  minify: true,
  legalComments: "inline",
});
console.log("Built game/app.js (classic script for opaque-origin iframes).");
