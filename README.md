# TSKSpine · Twinkle Star Knights Spine 资源提取与预览

从游戏 Unity AssetBundle 中提取 Spine 动画资源（`.skel` / `.atlas` / `.png`），并在浏览器中本地预览播放。资源全部经 File API 本地读取，不走网络上传。

工具链分两部分：

- **提取**（[extract_spine.py](./extract_spine.py)）：Python + UnityPy，扫描 Addressables 缓存与 StreamingAssets，按内容特征识别 Spine 三件套并导出贴图。
- **预览**（[viewer.js](./viewer.js) + [index.html](./index.html)）：纯前端页面，spine-webgl 4.3 渲染，esbuild 打包。拖入导出的资源即可播放动画。

## 功能

- 自动从热更缓存（LocalLow）和随包 StreamingAssets 中识别 Spine 资源，无需肉眼分辨 hash 文件名
- 只解析命中 Spine 的 bundle，绕开 AssetStudio 的 shader 兼容问题
- 导出 `manifest.csv` 清单，记录 bundle、资源类型、文件名与 spine 版本号
- 预览器支持：
  - 拖入文件 / 整个文件夹，自动按文件名分组配对
  - 角色选择为**独立搜索框 + 常驻列表**：搜索框只负责关键字过滤（大小写不敏感），回车选中第一个匹配项
  - 默认为**单选模式**：点击列表项即互斥切换角色，只预览一个；勾选"叠加模式"开关后变为多选
  - **双图层叠加**（叠加模式）：最多勾选 2 个角色在同一坐标叠加渲染（先勾的为主层，第二个为叠加层），适合查看角色 + 部件/特效的组合效果；关闭开关即释放叠加层回到单个；取消主层后叠加层自动递补
  - 叠加时侧边栏出现**"主层""叠加层"两组动画 / 皮肤下拉**，选项按各自角色分别列出，可独立设置、互不影响（两层动画名、皮肤名往往不同）
  - 循环播放、0.1x–2x 变速对所有层生效
  - 滚轮缩放、拖拽平移、双击重置视角
  - 骨骼调试线显示
  - 二进制 `.skel` 与 JSON 两种格式都支持

## 环境要求

| 工具 | 版本 | 用途 |
|---|---|---|
| Python | 3.9+ | 运行提取脚本 |
| UnityPy | 最新版 | 解析 AssetBundle（`pip install UnityPy`） |
| Node.js | 18+（推荐 20/22） | 打包与运行预览器 |
| npm | 随 Node 安装 | 安装前端依赖 |

## 快速开始

### 1. 提取 Spine 资源

```bash
pip install UnityPy

# 全量扫描默认的两个根目录（LocalLow 热更缓存 + StreamingAssets）
python extract_spine.py

# 先试跑前 50 个 bundle
python extract_spine.py --limit 50

# 指定输出目录
python extract_spine.py --out spine_dump

# 自定义扫描根目录
python extract_spine.py --roots "D:\path\to\cache" "E:\path\to\bundles"
```

脚本内默认扫描根写在 [extract_spine.py](./extract_spine.py) 顶部的 `LOCALLOW_ROOT` / `STREAMING_ROOT` 常量，路径与本机不一致时直接改这两个常量，或用 `--roots` 覆盖。

输出布局：

```text
spine_dump/
├── manifest.csv                  # 全部导出资源清单
└── <bundle_hash>/                # 每个命中 Spine 的 bundle 一个目录
    ├── <角色名>.skel             # 或 .json（skeleton 数据）
    ├── <角色名>.atlas.txt        # 图集描述
    └── *.png                     # 图集贴图
```

### 2. 启动预览器

```bash
# 安装前端依赖（spine-webgl 4.0 + esbuild）
npm install

# 启动本地服务器（含实时打包，改 viewer.js 刷新即生效）
npm start
```

打开 http://localhost:8080/ ，把 `spine_dump` 里的角色目录**整个拖进页面**（或点"选择文件夹"），即可自动分组播放。

也可以只构建不启动服务器：

```bash
npm run build      # 产物为 viewer.bundle.js
```

## 预览器操作说明

| 操作 | 方式 |
|---|---|
| 加载资源 | 拖入 `.skel`/`.json` + `.atlas` + `.png`，或点"选择文件 / 选择文件夹" |
| 选择角色 | 默认单选模式：搜索过滤后点击列表项即切换（互斥，只预览一个） |
| 叠加两个角色 | 勾选"叠加模式"开关，列表项出现 checkbox，勾选最多 2 个同位置叠加（先勾的为主层）；关闭开关即回到单个 |
| 分别设置两层动画/皮肤 | 叠加模式下侧边栏出现"主层""叠加层"两组动画、皮肤下拉，各自独立选择即可；循环与变速对两层同时生效 |
| 切换动画 / 皮肤 | 对应下拉框选择；默认优先播放 idle / wait 动画 |
| 缩放 / 平移 | 鼠标滚轮缩放，左键拖拽平移 |
| 重置视角 | 双击画布或点"重置视角"按钮 |
| 调试骨骼 | 勾选"显示骨骼调试线" |

资源配对规则：skel/atlas 去掉扩展名后的 basename 相同即为一组；贴图按 atlas 内 page 文件名在拖入的所有图片中匹配。

## 常见问题

**拖入后提示"未找到完整三件套"**
同一角色的 `.skel`/`.json` 与 `.atlas` 必须 basename 相同，且对应 `.png` 要一起拖入。检查 `spine_dump/<hash>/` 目录内文件是否齐全。

**提示"缺少贴图 xxx.png"**
atlas 引用的贴图没有一起加载。把对应 png 与 skel/atlas 放在同一批拖入即可（贴图池是全局的，跨目录也能匹配）。

**加载 skel 报 "Bone name must not be null" / "String in string table must not be null"**
这是 Spine 运行时版本与 skel 导出版本不匹配。Spine 二进制格式跨大版本不兼容（4.2 起引入字符串表机制），运行时大版本必须与资源导出版本一致，**不是**越高越好。本游戏资源全部为 Spine **4.0.37** 导出（见 `manifest.csv` 的 `spine_version` 列），因此 [package.json](./package.json) 锁定 `@esotericsoftware/spine-webgl` 为 `~4.0.31`，请勿随意升级大版本。若日后游戏更新改用其它 Spine 版本导出，需把依赖换成对应大版本（如 `~4.2.x`），并按新版 API 调整 [viewer.js](./viewer.js) 后重新 `npm install`、`npm run build`。

**贴图颜色发暗 / 边缘发黑**
渲染按预乘 alpha（pma）处理，与 Spine 导出贴图的常规设置一致。若个别资源显示异常，可检查 atlas 文件头部是否声明了 `pma: false`。

## 技术栈

- 提取：Python、[UnityPy](https://github.com/K0lb3/UnityPy)
- 预览：原生 JS、[spine-webgl](https://github.com/EsotericSoftware/spine-runtimes) 4.0（与游戏 4.0.37 导出数据匹配）、WebGL
- 构建：[esbuild](https://esbuild.dev/)（打包 + 本地静态服务器）

## 目录结构

```text
TSKSpine/
├── extract_spine.py      # Spine 资源提取脚本
├── index.html            # 预览器页面
├── viewer.js             # 预览器源码（esbuild 入口）
├── viewer.bundle.js      # 打包产物（由 npm run build 生成）
├── serve.mjs             # esbuild 本地服务器脚本
├── package.json
└── spine_dump/           # 提取输出目录（运行脚本后生成）
```
