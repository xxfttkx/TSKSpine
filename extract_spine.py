# -*- coding: utf-8 -*-
"""
从 Addressables 缓存 / StreamingAssets 的 AssetBundle 中提取 Spine 动画资源。

背景：
  Twinkle Star Knights 的热更资源落在
  %USERPROFILE%\\AppData\\LocalLow\\Unity\\FANZAGAMES_twinkle_starknightsX
  布局为 <hash>/<hash>/__data（bundle 本体，UnityFS 无加密）+ __info。
  文件名全是 hash，无法肉眼分辨。本脚本按【内容特征】识别 Spine 三件套：
    - atlas 文本：含 spine atlas 格式特征行 "size: W,H" + "filter:"
    - skeleton JSON：以 { 开头且含 "bones" / "slots" 键
    - skeleton 二进制：varint(hash长度) + hash + varint(版本长度) + 版本号
  命中 Spine 资源的 bundle 才导出其 Texture2D（图集贴图），
  其余 bundle（UI、shader 等）完全不解析，绕开 AssetStudio 的 shader 兼容问题。

依赖：pip install UnityPy
用法：
  python tools/extract_spine.py                 # 全量扫描两个默认根
  python tools/extract_spine.py --limit 50      # 只扫前 50 个 bundle（试跑）
  python tools/extract_spine.py --out spine_dump
"""

import argparse
import csv
import re
import sys
from pathlib import Path

import UnityPy

# 默认扫描根：LocalLow 热更缓存 + 随包 StreamingAssets
LOCALLOW_ROOT = Path(
    r"C:\Users\MR\AppData\LocalLow\Unity\FANZAGAMES_twinkle_starknightsX"
)
STREAMING_ROOT = Path(
    r"F:\Games\DMM\Twinkle_StarKnightsX\twinkle_starknightsX_Data"
    r"\StreamingAssets\aa\StandaloneWindows64"
)

ATLAS_SIZE_RE = re.compile(rb"(?m)^size:\s*\d+\s*,\s*\d+\s*$")
ATLAS_FILTER_RE = re.compile(rb"(?m)^filter:\s*(Linear|Nearest)")
# spine 版本号（3.8.x / 4.0.x / 4.1.x / 4.2.x），binary skel 头部明文存放
SPINE_VERSION_RE = re.compile(rb"(?<![\d.])([34]\.\d+\.\d{1,2})(?![\d])")

KIND_SKEL_BIN = "skel_binary"
KIND_SKEL_JSON = "skel_json"
KIND_ATLAS = "atlas"


def detect_spine_binary(data: bytes):
    """从 skel 二进制头部提取 spine 版本号（如 4.0.37）。

    标准 spine-cpp 二进制格式：hash/version 均为字符串，版本号明文存放；
    字符串编码为 modified UTF-8（长度字段 = 字节数 + 1，含末尾 null），
    故不依赖 varint 顺序解析，直接在前 64 字节搜版本号明文即可。
    """
    m = SPINE_VERSION_RE.search(data[:64])
    return m.group(1).decode("ascii") if m else None


def classify_textasset(name: str, raw: bytes):
    """返回 (kind, version_or_None)；非 spine 资源返回 None。
    优先按文件名后缀（spine-unity 导入要求 .skel/.atlas 命名），内容特征兜底"""
    lower = name.lower()
    if lower.endswith(".skel") or lower.endswith(".skel.bytes"):
        return KIND_SKEL_BIN, detect_spine_binary(raw)
    if lower.endswith(".atlas") or lower.endswith(".atlas.txt"):
        return KIND_ATLAS, None
    # 文本类：atlas / json
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        ver = detect_spine_binary(raw)
        return (KIND_SKEL_BIN, ver) if ver else None
    if ATLAS_SIZE_RE.search(raw) and ATLAS_FILTER_RE.search(raw):
        return KIND_ATLAS, None
    stripped = text.lstrip()
    if stripped.startswith("{") and '"bones"' in text and '"slots"' in text:
        m = re.search(r'"spine"\s*:\s*"([\d.]+)"', text)
        return KIND_SKEL_JSON, m.group(1) if m else None
    ver = detect_spine_binary(raw)
    return (KIND_SKEL_BIN, ver) if ver else None


def safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip() or "unnamed"


def add_ext(name: str, kind: str) -> str:
    """按资源类型补扩展名（m_Name 通常不带扩展名）"""
    lower = name.lower()
    if kind == KIND_ATLAS and not lower.endswith((".atlas", ".txt")):
        return name + ".atlas.txt"
    if kind == KIND_SKEL_JSON and not lower.endswith(".json"):
        return name + ".json"
    if kind == KIND_SKEL_BIN and not lower.endswith((".skel", ".bytes")):
        return name + ".skel"
    return name


def collect_bundles(roots):
    """LocalLow 布局取 __data；StreamingAssets 取 *.bundle"""
    bundles = []
    for root in roots:
        if not root.exists():
            print(f"[warn] 根目录不存在，跳过: {root}")
            continue
        if root.name == "FANZAGAMES_twinkle_starknightsX" or (root / "__info").exists():
            for data in root.rglob("__data"):
                bundles.append((data.parent.parent.name, data))
        else:
            for f in root.glob("*.bundle"):
                bundles.append((f.stem, f))
    return bundles


def extract(bundle_path: Path, bundle_id: str, out_dir: Path, manifest):
    """扫描单个 bundle；命中 spine 资源则导出，返回命中数"""
    try:
        env = UnityPy.load(str(bundle_path))
    except Exception as e:
        print(f"[skip] {bundle_id}: 加载失败 {e}")
        return 0

    spine_hits = []  # (obj, kind, version)
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        try:
            d = obj.read()
            raw = d.m_Script
            if isinstance(raw, str):
                raw = raw.encode("utf-8", "surrogateescape")
            result = classify_textasset(d.m_Name, raw)
            if result:
                spine_hits.append((d, result[0], result[1], raw))
        except Exception:
            continue

    if not spine_hits:
        return 0

    target = out_dir / safe_name(bundle_id)
    target.mkdir(parents=True, exist_ok=True)

    for d, kind, version, raw in spine_hits:
        fname = add_ext(safe_name(d.m_Name), kind)
        (target / fname).write_bytes(raw)
        manifest.writerow(
            [bundle_id, str(bundle_path), kind, d.m_Name, fname, version or ""]
        )
        print(f"[ok] {bundle_id} {kind:11s} {d.m_Name}"
              + (f"  (spine {version})" if version else ""))

    # 命中 spine 的 bundle：导出图集贴图（同一 bundle 内的 Texture2D）
    for obj in env.objects:
        if obj.type.name != "Texture2D":
            continue
        try:
            d = obj.read()
            img = d.image
            fname = safe_name(d.m_Name) + ".png"
            img.save(target / fname)
            manifest.writerow(
                [bundle_id, str(bundle_path), "texture", d.m_Name, fname, ""]
            )
        except Exception as e:
            print(f"[warn] {bundle_id} 贴图 {getattr(obj, 'm_Name', '?')} 导出失败: {e}")

    return len(spine_hits)


def main():
    ap = argparse.ArgumentParser(description="提取 Addressables bundle 中的 Spine 资源")
    ap.add_argument("--out", default="spine_dump", help="输出目录")
    ap.add_argument("--limit", type=int, default=0, help="只扫前 N 个 bundle（试跑）")
    ap.add_argument("--no-streaming", action="store_true", help="不扫 StreamingAssets")
    ap.add_argument("--roots", nargs="*", help="自定义扫描根目录（覆盖默认）")
    args = ap.parse_args()

    if args.roots:
        roots = [Path(r) for r in args.roots]
    else:
        roots = [LOCALLOW_ROOT]
        if not args.no_streaming:
            roots.append(STREAMING_ROOT)

    bundles = collect_bundles(roots)
    if args.limit:
        bundles = bundles[: args.limit]
    print(f"共 {len(bundles)} 个 bundle 待扫描，输出目录: {args.out}")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_f = (out_dir / "manifest.csv").open("w", newline="", encoding="utf-8-sig")
    manifest = csv.writer(manifest_f)
    manifest.writerow(["bundle_id", "bundle_path", "kind", "asset_name", "out_file", "spine_version"])

    hit_bundles = 0
    hit_assets = 0
    for i, (bid, path) in enumerate(bundles, 1):
        n = extract(path, bid, out_dir, manifest)
        if n:
            hit_bundles += 1
            hit_assets += n
        if i % 500 == 0:
            print(f"--- 进度 {i}/{len(bundles)}，命中 {hit_assets} 个 spine 资源 ---")

    manifest_f.close()
    print(f"\n完成：{hit_bundles} 个 bundle 含 Spine 资源，共 {hit_assets} 个 skel/atlas")
    print(f"输出: {out_dir.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
