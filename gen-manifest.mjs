// 扫描 test/ 目录生成 test-manifest.json（提交进仓库）。
// 预览器启动时 fetch 该清单自动加载示例角色；
// 本地由 serve.mjs 监听目录变化实时更新，GitHub Pages 等纯静态环境直接读仓库内文件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(root, "test");
const MANIFEST = path.join(root, "test-manifest.json");
const ASSET_RE = /\.(skel(\.bytes)?|atlas(\.txt)?|png|jpe?g|webp|json)$/i;

export function writeTestManifest() {
  try {
    if (!fs.existsSync(TEST_DIR)) return;
    const files = fs.readdirSync(TEST_DIR).filter((f) => ASSET_RE.test(f)).sort();
    fs.writeFileSync(MANIFEST, JSON.stringify({ dir: "test", files }, null, 2) + "\n");
    console.log(`已生成 test-manifest.json（${files.length} 个文件）`);
  } catch (e) {
    console.warn("生成 test 清单失败:", e.message);
  }
}

// 直接运行时执行一次
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeTestManifest();
}
