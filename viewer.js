// Spine 资源本地预览器（spine-webgl 4.0，匹配游戏 4.0.37 导出数据）
// 拖入 extract_spine.py 导出的 .skel/.atlas/.png 三件套即可播放。
// 资源全部经 File API 本地读取，不走网络，双击 html 即可使用。
import * as spine from "@esotericsoftware/spine-webgl";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const wrap = $("canvas-wrap");
const dropHint = $("drop-hint");
const animSelect = $("anim-select");
const skinSelect = $("skin-select");
const loopCheck = $("loop-check");
const speedRange = $("speed-range");
const speedVal = $("speed-val");
const debugCheck = $("debug-check");
const statusEl = $("status");

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", isErr);
}

// ---------- WebGL 初始化 ----------
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: true,
  premultipliedAlpha: true,
});
if (!gl) {
  setStatus("当前环境不支持 WebGL", true);
  throw new Error("WebGL unavailable");
}
const renderer = new spine.SceneRenderer(canvas, gl);
new spine.CameraController(canvas, renderer.camera); // 内置拖拽平移 + 滚轮缩放

// ---------- 角色搜索与列表 ----------
// 搜索框只负责过滤，下方常驻列表只负责选择，两者职责分离。
// 输入即时按子串过滤（大小写不敏感），回车选中第一个匹配项；
// 点击列表项切换角色，当前已加载角色高亮并带 ✓，重复点击当前项不重新加载。
let charKeys = []; // 全部可用角色 key（已排序）
let selectedKey = ""; // 当前已加载的角色 key
const charSearch = $("char-search");
const charList = $("char-list");

function makeCharEmpty(text) {
  const el = document.createElement("div");
  el.className = "char-empty";
  el.textContent = text;
  return el;
}

function setCharOptions(keys) {
  charKeys = keys.slice().sort();
  selectedKey = "";
  charSearch.value = "";
  if (charKeys.length === 0) {
    charSearch.disabled = true;
    charSearch.placeholder = "未加载资源";
  } else {
    charSearch.disabled = false;
    charSearch.placeholder = "输入关键字搜索角色……";
  }
  renderCharList();
}

function renderCharList() {
  const lower = charSearch.value.trim().toLowerCase();
  const keys = lower
    ? charKeys.filter((k) => k.toLowerCase().includes(lower))
    : charKeys.slice();

  charList.innerHTML = "";
  if (charKeys.length === 0) {
    charList.appendChild(makeCharEmpty("拖入资源后显示角色"));
    return;
  }
  if (keys.length === 0) {
    charList.appendChild(makeCharEmpty("无匹配角色"));
    return;
  }
  for (const key of keys) {
    const item = document.createElement("div");
    item.className = "char-item" + (key === selectedKey ? " selected" : "");
    item.dataset.key = key;
    item.textContent = key;
    charList.appendChild(item);
  }
}

function chooseChar(key) {
  if (!charKeys.includes(key) || key === selectedKey) return;
  selectedKey = key;
  charList.querySelectorAll(".char-item").forEach((el) =>
    el.classList.toggle("selected", el.dataset.key === key),
  );
  return loadGroup(key);
}

charList.addEventListener("click", (e) => {
  const item = e.target.closest(".char-item");
  if (item) chooseChar(item.dataset.key);
});
charSearch.addEventListener("input", renderCharList);
charSearch.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const first = charList.querySelector(".char-item");
  if (first) chooseChar(first.dataset.key);
});

// ---------- 资源分组 ----------
// 组键 = skel/atlas 去掉扩展名的 basename（如 ch_1004006_b）
/** @type {Map<string, {key:string, skelFile?:File, jsonFile?:File, atlasFile?:File}>} */
const groups = new Map();
/** 全局贴图池：小写 basename -> File（atlas page.name 匹配） */
const imagePool = new Map();

function baseName(path) {
  return path.split(/[\\/]/).pop();
}
function stripExt(name, exts) {
  const lower = name.toLowerCase();
  for (const e of exts) {
    if (lower.endsWith(e)) return name.slice(0, name.length - e.length);
  }
  return null;
}

function ingestFile(file) {
  const rel = file.webkitRelativePath || file.name;
  const base = baseName(rel);
  const lower = base.toLowerCase();

  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    imagePool.set(lower, file);
    return null;
  }
  if (lower.endsWith(".skel.bytes")) {
    const key = stripExt(base, [".skel.bytes"]);
    const g = groups.get(key) ?? { key };
    g.skelFile = file;
    groups.set(key, g);
    return key;
  }
  if (lower.endsWith(".skel")) {
    const key = stripExt(base, [".skel"]);
    const g = groups.get(key) ?? { key };
    g.skelFile = file;
    groups.set(key, g);
    return key;
  }
  if (lower.endsWith(".atlas.txt")) {
    const key = stripExt(base, [".atlas.txt"]);
    const g = groups.get(key) ?? { key };
    g.atlasFile = file;
    groups.set(key, g);
    return key;
  }
  if (lower.endsWith(".atlas")) {
    const key = stripExt(base, [".atlas"]);
    const g = groups.get(key) ?? { key };
    g.atlasFile = file;
    groups.set(key, g);
    return key;
  }
  if (lower.endsWith(".json")) {
    // spine json 与普通 json 同后缀：加载时才解析验证，先按组登记
    const key = stripExt(base, [".json"]);
    const g = groups.get(key) ?? { key };
    g.jsonFile = file;
    groups.set(key, g);
    return key;
  }
  return null;
}

async function ingestFiles(fileList) {
  groups.clear();
  imagePool.clear();
  let touched = 0;
  for (const f of fileList) {
    if (ingestFile(f) !== null) touched++;
  }
  // 完整组：atlas 必需，且有 skel 或 json
  const usable = [...groups.values()].filter(
    (g) => g.atlasFile && (g.skelFile || g.jsonFile),
  );
  const incomplete = groups.size - usable.length;

  if (usable.length === 0) {
    setCharOptions([]);
    setStatus(
      `扫描 ${touched} 个资源文件，未找到完整三件套。\n需要同名 .skel/.json + .atlas + .png`,
      true,
    );
    dropHint.style.display = "";
    return;
  }
  setCharOptions(usable.map((g) => g.key));
  setStatus(
    `已加载 ${usable.length} 个角色、${imagePool.size} 张贴图` +
      (incomplete ? `（${incomplete} 组不完整已跳过）` : ""),
  );
  dropHint.style.display = "none";
  await chooseChar(usable[0].key);
}

// ---------- 角色加载与渲染状态 ----------
let currentAtlas = null;
let skeleton = null;
let state = null;
let debugDraw = false;
let speed = 1;

function disposeCurrent() {
  // TextureAtlas.dispose() 会连带 dispose 各 page 的 GLTexture
  if (currentAtlas) {
    try { currentAtlas.dispose(); } catch { /* ignore */ }
    currentAtlas = null;
  }
  skeleton = null;
  state = null;
}

async function loadGroup(key) {
  const g = groups.get(key);
  if (!g) return;
  setStatus(`正在加载 ${key} ……`);
  try {
    disposeCurrent();

    const atlasText = await g.atlasFile.text();
    const atlas = new spine.TextureAtlas(atlasText);
    for (const page of atlas.pages) {
      const pageBase = baseName(page.name).toLowerCase();
      const file = imagePool.get(pageBase);
      if (!file) {
        throw new Error(`缺少贴图 ${page.name}，请把对应 png 一起拖入`);
      }
      const bmp = await createImageBitmap(file);
      page.setTexture(new spine.GLTexture(gl, bmp, false));
    }

    // SkeletonBinary/Json 接受 AttachmentLoader，需用 AtlasAttachmentLoader 包装 TextureAtlas
    const attachmentLoader = new spine.AtlasAttachmentLoader(atlas);
    let data;
    if (g.skelFile) {
      const bytes = new Uint8Array(await g.skelFile.arrayBuffer());
      data = new spine.SkeletonBinary(attachmentLoader).readSkeletonData(bytes);
    } else {
      const json = JSON.parse(await g.jsonFile.text());
      data = new spine.SkeletonJson(attachmentLoader).readSkeletonData(json);
    }

    currentAtlas = atlas;
    skeleton = new spine.Skeleton(data);
    state = new spine.AnimationState(new spine.AnimationStateData(data));
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform();

    populateAnimations(data);
    populateSkins(data);
    fitCamera();
    setStatus(
      `${key}\nbones=${data.bones.length} slots=${data.slots.length} ` +
        `anims=${data.animations.length} skins=${data.skins.length}` +
        (g.skelFile ? `\n格式: 二进制 ${data.version ?? ""}` : "\n格式: JSON"),
    );
  } catch (e) {
    setStatus(`加载失败: ${e.message ?? e}`, true);
  }
}

function populateAnimations(data) {
  animSelect.innerHTML = "";
  const names = data.animations.map((a) => a.name).sort();
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    animSelect.appendChild(opt);
  }
  animSelect.disabled = names.length === 0;
  // 默认优先 wait/idle，否则第一个
  const preferred = names.find((n) => /wait|idle/i.test(n)) ?? names[0];
  if (preferred) {
    animSelect.value = preferred;
    playAnimation(preferred);
  }
}

function populateSkins(data) {
  skinSelect.innerHTML = "";
  const names = data.skins.map((s) => s.name);
  if (!names.includes("default")) {
    const opt = document.createElement("option");
    opt.value = "__none__";
    opt.textContent = "default";
    skinSelect.appendChild(opt);
  }
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    skinSelect.appendChild(opt);
  }
  skinSelect.disabled = false;
  skinSelect.value = names.includes("default") ? "default" : "__none__";
}

function playAnimation(name) {
  if (!state || !name) return;
  state.setAnimation(0, name, loopCheck.checked);
}

function fitCamera() {
  if (!skeleton) return;
  skeleton.setToSetupPose();
  state?.apply(skeleton);
  skeleton.updateWorldTransform();
  const offset = new spine.Vector2();
  const size = new spine.Vector2();
  skeleton.getBounds(offset, size, []);
  if (size.x === 0 || size.y === 0) return;
  const cam = renderer.camera;
  cam.position.set(offset.x + size.x / 2, offset.y + size.y / 2, 0);
  // zoom = 世界单位/像素；取包围盒适配后留 15% 边距
  cam.zoom =
    Math.max(size.x / canvas.clientWidth, size.y / canvas.clientHeight) * 1.15;
  cam.update();
}

// ---------- 渲染循环 ----------
let lastTime = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(now - lastTime, 0.1);
  lastTime = now;

  renderer.resize(spine.ResizeMode.Expand);
  gl.clearColor(0.118, 0.118, 0.133, 1);
  renderer.camera.update();

  if (skeleton && state) {
    state.update(dt * speed);
    state.apply(skeleton);
    skeleton.updateWorldTransform();
    renderer.begin();
    renderer.drawSkeleton(skeleton, true); // spine 导出贴图为预乘 alpha
    if (debugDraw) renderer.drawSkeletonDebug(skeleton, true);
    renderer.end();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- UI 事件 ----------
animSelect.addEventListener("change", () => playAnimation(animSelect.value));
loopCheck.addEventListener("change", () => {
  if (state && animSelect.value) playAnimation(animSelect.value);
});
skinSelect.addEventListener("change", () => {
  if (!skeleton) return;
  if (skinSelect.value === "__none__") skeleton.setSkin(null);
  else skeleton.setSkinByName(skinSelect.value);
  skeleton.setSlotsToSetupPose();
  state?.apply(skeleton);
});
speedRange.addEventListener("input", () => {
  speed = parseFloat(speedRange.value);
  speedVal.textContent = speed.toFixed(2) + "x";
  if (state) state.timeScale = speed;
});
debugCheck.addEventListener("change", () => {
  debugDraw = debugCheck.checked;
});
$("btn-reset").addEventListener("click", fitCamera);
canvas.addEventListener("dblclick", fitCamera);

$("btn-files").addEventListener("click", () => $("file-input").click());
$("btn-folder").addEventListener("click", () => $("folder-input").click());
$("file-input").addEventListener("change", (e) => ingestFiles(e.target.files));
$("folder-input").addEventListener("change", (e) => ingestFiles(e.target.files));

// 整窗拖放
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  wrap.classList.add("dragover");
});
window.addEventListener("dragleave", (e) => {
  if (e.target === document.documentElement) wrap.classList.remove("dragover");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  wrap.classList.remove("dragover");
  if (e.dataTransfer?.files?.length) ingestFiles(e.dataTransfer.files);
});
