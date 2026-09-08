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
const animSelect1 = $("anim-select-1");
const skinSelect1 = $("skin-select-1");
const layerPanel1 = $("layer-panel-1");
const layerTitle0 = $("layer-title-0");
const loopCheck = $("loop-check");
// 按层索引访问的两组下拉：0 = 主层，1 = 叠加层
const animSelects = [animSelect, animSelect1];
const skinSelects = [skinSelect, skinSelect1];
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
// 两种模式（由"叠加模式"开关切换）：
//  - 单选（默认）：列表项无 checkbox，点击整行即互斥切换到该角色，只预览一个；
//  - 叠加：列表项带 checkbox，勾选即加载为图层，最多 2 个，同位置叠加，先勾的为主层。
let charKeys = []; // 全部可用角色 key（已排序）
const MAX_LAYERS = 2;
let layers = []; // [{key, atlas, data, skeleton, state}]，layers[0] 为主层
let loadingKey = ""; // 正在异步加载的 key，防止重复点击
let overlayMode = false; // 叠加模式开关
const charSearch = $("char-search");
const charList = $("char-list");
const overlayCheck = $("overlay-check");

function makeCharEmpty(text) {
  const el = document.createElement("div");
  el.className = "char-empty";
  el.textContent = text;
  return el;
}

function setCharOptions(keys) {
  for (const layer of layers) disposeLayer(layer);
  layers = [];
  loadingKey = "";
  charKeys = keys.slice().sort();
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

function layerIndexOf(key) {
  return layers.findIndex((l) => l.key === key);
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
    const idx = layerIndexOf(key);
    const item = document.createElement("label");
    item.className = "char-item" + (idx !== -1 ? " selected" : "");
    item.dataset.key = key;

    if (overlayMode) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = idx !== -1;
      if (loadingKey && loadingKey !== key) cb.disabled = true;
      item.appendChild(cb);
    }

    const text = document.createElement("span");
    text.className = "char-name";
    text.textContent = key;
    item.appendChild(text);

    if (idx !== -1) {
      const tag = document.createElement("span");
      tag.className = "layer-tag";
      tag.textContent = overlayMode ? (idx === 0 ? "主层" : "叠加") : "当前";
      item.appendChild(tag);
    } else if (loadingKey === key) {
      const tag = document.createElement("span");
      tag.className = "layer-tag";
      tag.textContent = "加载中…";
      item.appendChild(tag);
    }
    charList.appendChild(item);
  }
}

// 勾选/取消一个图层
async function toggleLayer(key) {
  if (loadingKey) return;
  if (layerIndexOf(key) !== -1) {
    const idx = layerIndexOf(key);
    const [removed] = layers.splice(idx, 1);
    disposeLayer(removed);
    afterLayersChanged();
    renderCharList();
    return;
  }
  if (layers.length >= MAX_LAYERS) {
    setStatus(`最多同时叠加 ${MAX_LAYERS} 个角色，请先取消一个图层`, true);
    renderCharList();
    return;
  }
  loadingKey = key;
  renderCharList();
  try {
    const layer = await loadLayer(key);
    if (layer) layers.push(layer);
    afterLayersChanged();
  } catch (e) {
    setStatus(`加载失败: ${e.message ?? e}`, true);
  } finally {
    loadingKey = "";
    renderCharList();
  }
}

// 单选模式：加载目标角色，成功后再释放旧层（加载失败则保留当前角色）
async function selectSingle(key) {
  if (loadingKey) return;
  if (layers.length === 1 && layers[0].key === key) return;
  loadingKey = key;
  renderCharList();
  try {
    const layer = await loadLayer(key);
    if (layer) {
      for (const l of layers) disposeLayer(l);
      layers = [layer];
      afterLayersChanged();
    }
  } catch (e) {
    setStatus(`加载失败: ${e.message ?? e}`, true);
  } finally {
    loadingKey = "";
    renderCharList();
  }
}

// 叠加模式：checkbox 勾选/取消
charList.addEventListener("change", (e) => {
  if (!overlayMode) return;
  if (e.target.matches('input[type="checkbox"]')) {
    const item = e.target.closest(".char-item");
    if (item) toggleLayer(item.dataset.key);
  }
});
// 单选模式：点击整行即切换
charList.addEventListener("click", (e) => {
  if (overlayMode) return;
  const item = e.target.closest(".char-item");
  if (item) selectSingle(item.dataset.key);
});
// 叠加模式开关：切回单选时只保留主层、释放叠加层；主层未变故不重置动画
overlayCheck.addEventListener("change", () => {
  overlayMode = overlayCheck.checked;
  if (!overlayMode && layers.length > 1) {
    for (const l of layers.slice(1)) disposeLayer(l);
    layers = layers.slice(0, 1);
  }
  syncLayerControls();
  if (layers.length > 0) updateLayerStatus();
  renderCharList();
});
charSearch.addEventListener("input", renderCharList);
charSearch.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const first = charList.querySelector(".char-item");
  if (!first) return;
  const key = first.dataset.key;
  // 叠加模式回车=勾选第一个未加载项；单选模式回车=切换到第一个匹配项
  if (overlayMode) {
    if (layerIndexOf(key) === -1) toggleLayer(key);
  } else {
    selectSingle(key);
  }
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

// label：资源来源描述（如 "test/"），用于状态栏提示；手动拖入时留空
async function ingestFiles(fileList, label = "") {
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
    `${label ? `已从 ${label} 自动加载 ` : "已加载 "}${usable.length} 个角色、${imagePool.size} 张贴图` +
      (incomplete ? `（${incomplete} 组不完整已跳过）` : ""),
  );
  dropHint.style.display = "none";
  if (overlayMode) await toggleLayer(usable[0].key);
  else await selectSingle(usable[0].key);
}

// ---------- 图层加载与渲染状态 ----------
let debugDraw = false;
let speed = 1;

function disposeLayer(layer) {
  // TextureAtlas.dispose() 会连带 dispose 各 page 的 GLTexture
  try { layer.atlas.dispose(); } catch { /* ignore */ }
}

// 加载一个角色组为独立图层（各自持有 atlas/skeleton/state，纹理互不共享）
async function loadLayer(key) {
  const g = groups.get(key);
  if (!g) return null;
  setStatus(`正在加载 ${key} ……`);

  const atlasText = await g.atlasFile.text();
  const atlas = new spine.TextureAtlas(atlasText);
  for (const page of atlas.pages) {
    const pageBase = baseName(page.name).toLowerCase();
    const file = imagePool.get(pageBase);
    if (!file) {
      try { atlas.dispose(); } catch { /* ignore */ }
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

  const skeleton = new spine.Skeleton(data);
  const state = new spine.AnimationState(new spine.AnimationStateData(data));
  state.timeScale = speed;
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform();
  return { key, atlas, data, skeleton, state };
}

// 每组控件当前已填充的 layer key，未变化则不重填（避免打断正在播放的动画）
const ctrlKey = ["", ""];

function afterLayersChanged() {
  syncLayerControls();
  if (layers.length === 0) {
    setStatus("未选择角色");
    return;
  }
  fitCamera();
  updateLayerStatus();
}

// 按当前 layers 与模式刷新两组动画/皮肤控件的显隐与内容
function syncLayerControls() {
  const showOverlay = overlayMode && layers.length >= 2;
  layerPanel1.hidden = !showOverlay; // 叠加层面板只在叠加模式且有第 2 层时出现
  layerTitle0.hidden = !overlayMode; // 单选时不显示"主层"标题

  for (let i = 0; i < 2; i++) {
    const layer = layers[i];
    const animSel = animSelects[i];
    const skinSel = skinSelects[i];
    const active = !!layer && (i === 0 || showOverlay);
    if (!active) {
      ctrlKey[i] = "";
      animSel.innerHTML = "<option>—</option>";
      skinSel.innerHTML = "<option>—</option>";
      animSel.disabled = true;
      skinSel.disabled = true;
      continue;
    }
    // 该槽位的角色变了才重新填充（新层播默认动画）；没变则保留用户选择
    if (ctrlKey[i] !== layer.key) {
      ctrlKey[i] = layer.key;
      fillAnimations(animSel, layer);
      fillSkins(skinSel, layer);
    }
  }
}

function fillAnimations(sel, layer) {
  sel.innerHTML = "";
  const names = layer.data.animations.map((a) => a.name).sort();
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.disabled = names.length === 0;
  // 默认优先 wait/idle，否则第一个
  const preferred = names.find((n) => /wait|idle/i.test(n)) ?? names[0];
  if (preferred) {
    sel.value = preferred;
    playLayerAnim(layer, preferred);
  }
}

function fillSkins(sel, layer) {
  sel.innerHTML = "";
  const names = layer.data.skins.map((s) => s.name);
  if (!names.includes("default")) {
    const opt = document.createElement("option");
    opt.value = "__none__";
    opt.textContent = "default";
    sel.appendChild(opt);
  }
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.disabled = false;
  sel.value = names.includes("default") ? "default" : "__none__";
}

// 播放指定层的某个动画；该层无此动画则清空 track（停在 setup pose）
function playLayerAnim(layer, name) {
  if (!layer || !name) return;
  if (layer.data.animations.some((a) => a.name === name)) {
    layer.state.setAnimation(0, name, loopCheck.checked);
  } else {
    layer.state.setEmptyAnimation(0, 0);
  }
}

// 切换指定层的皮肤
function setLayerSkin(layer, name) {
  if (!layer) return;
  if (name === "__none__") layer.skeleton.setSkin(null);
  else layer.skeleton.setSkinByName(name);
  layer.skeleton.setSlotsToSetupPose();
  layer.state.apply(layer.skeleton);
}

function updateLayerStatus() {
  if (!overlayMode) {
    const l = layers[0];
    const d = l.data;
    setStatus(
      `${l.key}\nbones=${d.bones.length} slots=${d.slots.length} ` +
        `anims=${d.animations.length} skins=${d.skins.length}`,
    );
    return;
  }
  const desc = layers
    .map((l, i) => {
      const d = l.data;
      const tag = i === 0 ? "主层" : "叠加";
      return `${tag} ${l.key} bones=${d.bones.length} anims=${d.animations.length}`;
    })
    .join("\n");
  setStatus(`已叠加 ${layers.length}/${MAX_LAYERS} 层\n${desc}`);
}

function fitCamera() {
  if (layers.length === 0) return;
  const skeleton = layers[0].skeleton;
  const state = layers[0].state;
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

  if (layers.length > 0) {
    for (const layer of layers) {
      layer.state.update(dt * speed);
      layer.state.apply(layer.skeleton);
      layer.skeleton.updateWorldTransform();
    }
    renderer.begin();
    for (const layer of layers) {
      renderer.drawSkeleton(layer.skeleton, true); // spine 导出贴图为预乘 alpha
      if (debugDraw) renderer.drawSkeletonDebug(layer.skeleton, true);
    }
    renderer.end();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- UI 事件 ----------
// 两组动画/皮肤下拉各自只控制对应层
animSelect.addEventListener("change", () => playLayerAnim(layers[0], animSelect.value));
animSelect1.addEventListener("change", () => playLayerAnim(layers[1], animSelect1.value));
skinSelect.addEventListener("change", () => setLayerSkin(layers[0], skinSelect.value));
skinSelect1.addEventListener("change", () => setLayerSkin(layers[1], skinSelect1.value));
// 循环对所有层生效：用各组下拉当前动画重新播放
loopCheck.addEventListener("change", () => {
  animSelects.forEach((sel, i) => {
    if (layers[i] && sel.value && sel.value !== "—") {
      playLayerAnim(layers[i], sel.value);
    }
  });
});
speedRange.addEventListener("input", () => {
  speed = parseFloat(speedRange.value);
  speedVal.textContent = speed.toFixed(2) + "x";
  for (const layer of layers) layer.state.timeScale = speed;
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

// ---------- 启动时自动加载 test/ 示例资源 ----------
// 清单 test-manifest.json 由 gen-manifest.mjs 扫描 test/ 生成并提交进仓库，
// 因此本地服务器与 GitHub Pages 等纯静态环境都能读取；
// 通过 file:// 直接打开页面或清单不存在时静默跳过，仍可手动拖入。
async function autoLoadTest() {
  try {
    const r = await fetch("./test-manifest.json", { cache: "no-store" });
    if (!r.ok) return;
    const { dir, files } = await r.json();
    const loaded = [];
    for (const name of files) {
      const resp = await fetch(`${dir}/${name}`);
      if (!resp.ok) continue;
      loaded.push(new File([await resp.blob()], name));
    }
    if (loaded.length > 0) await ingestFiles(loaded, `${dir}/`);
  } catch {
    /* 非 HTTP 环境或无 test 目录，忽略 */
  }
}
autoLoadTest();
