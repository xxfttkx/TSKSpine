// 本地开发服务器：esbuild context.serve
// - 静态文件服务当前目录（index.html 等）
// - /viewer.bundle.js 请求实时打包 viewer.js，修改源码自动生效
import * as esbuild from "esbuild";

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
