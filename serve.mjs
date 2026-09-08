// 本地开发服务器：esbuild context.serve
// - 静态文件服务当前目录（index.html 等）
// - /viewer.bundle.js 请求实时打包 viewer.js，修改源码自动生效
// - 启动时扫描 test/ 目录生成 .test-manifest.json，供预览器自动加载示例资源
import * as esbuild from "esbuild";
import fs from "node:fs";

const TEST_DIR = "test";
const MANIFEST = ".test-manifest.json";
const ASSET_RE = /\.(skel(\.bytes)?|atlas(\.txt)?|png|jpe?g|webp|json)$/i;

function writeTestManifest() {
  try {
    if (!fs.existsSync(TEST_DIR)) return;
    const files = fs.readdirSync(TEST_DIR).filter((f) => ASSET_RE.test(f));
    fs.writeFileSync(MANIFEST, JSON.stringify({ dir: TEST_DIR, files }, null, 2));
  } catch (e) {
    console.warn("生成 test 清单失败:", e.message);
  }
}

writeTestManifest();
try {
  fs.watch(TEST_DIR, { persistent: false }, writeTestManifest);
} catch {
  /* test 目录不存在时忽略 */
}

const ctx = await esbuild.context({
  entryPoints: ["viewer.js"],
  bundle: true,
  outfile: "viewer.bundle.js",
  format: "iife",
  target: "es2020",
  logLevel: "info",
});

const { host, port } = await ctx.serve({
  port: 8080,
  servedir: ".",
});

console.log(`\n  Spine 预览器已启动:  http://localhost:${port}/\n`);
