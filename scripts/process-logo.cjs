#!/usr/bin/env node
'use strict';

/**
 * 品牌 logo 处理（源图 = 项目根 logo.png，按 .gitignore 不入库）
 *
 * 源图形态：正方形金渐变标识 + 近黑实底（当前 2048×2048；处理只依赖亮度与留白裁剪，
 * 与源图具体边长无关）。本脚本按亮度抽取透明通道（金标亮度远高于深色底），并做
 * 「反预乘」去掉边缘深色描边，产出站点、标题栏与应用所需的全部尺寸：
 *
 *   站点    website/public/logo.png（导航/首页）· website/public/favicon.png —— 透明底
 *   品牌标记 brand-mark-{light,dark}.png（256px）—— 透明底，标题栏品牌 logo 专用
 *           （标题栏是自绘 UI 元素，透明底不会与标题栏自身底色叠出方块）
 *   应用    app-icon-{light,dark}.png（512px）—— **黑底**圆角实底 + 金标
 *           （桌面/任务栏/Dock/安装包图标；electron-builder 取 light 版转 .ico/.icns）
 *   托盘    tray-icon-{light,dark}.png（64px）—— **黑底**圆角实底 + 金标
 *           （系统托盘 16px 渲染尺寸下笔画过细，靠方块轮廓保证可辨识）
 *
 * 黑底策略（2026-09-10 用户指定）：应用图标与托盘图标统一「纯黑 #000000 + 约 22% 圆角 +
 * 居中金标」，深浅色版**内容一致**（纯黑底上金色对比度已最高，无需再按任务栏明暗分版）；
 * 两个色版文件仍各自产出，不破坏 ICON_SLOTS / dsh-ui:// 的既有契约。
 * 透明底产物中浅色底变体（*-light）整体压暗：金色在纯白背景上对比度不足，压深以保可读。
 *
 * 落盘位置说明：应用/托盘的**消费真源**是全局目录 `$DSH_HOME/icons/`（由 host 品牌资产
 * 同步写入，见 forge-theme.ts syncGlobalBrandAssets），其回退源 = `src/forge-shell/web/`
 * 下的内置默认图；`resources/themes/default/` 根目录的同名 PNG 是**历史兼容副本**
 * （dsh-ui:// 主题路由仍可命中包根，图标包清单只收 `icons/` 子目录）。
 * 用法：node scripts/process-logo.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'logo.png');

/** 透明底产物尺寸（站点资源 / 标题栏品牌标记；favicon 取 128 由浏览器自行缩放）。 */
const SIZE = 512;
const BRAND_SIZE = 256;
const FAVICON_SIZE = 128;
/** 黑底实底参数：圆角半径比例 / 金标占宽比例 / 底色（应用与托盘共用同一底色）。 */
const TILE_COLOR = '#000000';
const APP_RADIUS_RATIO = 0.22;
const APP_MARK_WIDTH_RATIO = 0.66;
const TRAY_SIZE = 64;
const TRAY_RADIUS_RATIO = 0.22;
const TRAY_MARK_WIDTH_RATIO = 0.8;
/** 亮度阈值（0~255）：≤LO 全透明，≥HI 全不透明。源图深底≈26，金标≈160~222。 */
const LUMA_LOW = 60;
const LUMA_HIGH = 140;
/** 透明底浅色底变体压暗系数（黑底产物不压暗，纯黑底上亮金最清晰）。 */
const LIGHT_FACTOR = 0.72;

/** 读取源图，按亮度抽 alpha + 反预乘，返回 RGBA raw。 */
async function extractMark() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const corners = [
    0,
    (width - 1) * channels,
    (height - 1) * width * channels,
    ((height - 1) * width + width - 1) * channels,
  ];
  const background = [0, 1, 2].map(
    (channel) => corners.reduce((sum, index) => sum + data[index + channel], 0) / corners.length,
  );

  const raw = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const r = data[index * channels];
    const g = data[index * channels + 1];
    const b = data[index * channels + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let alpha = (luma - LUMA_LOW) / (LUMA_HIGH - LUMA_LOW);
    alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    // C = a·F + (1-a)·B → F = (C - (1-a)·B) / a，避免半透明边缘残留深色描边
    const unpremultiply = (value, backdrop) =>
      alpha > 0 ? Math.max(0, Math.min(255, (value - (1 - alpha) * backdrop) / alpha)) : 0;
    raw[index * 4] = unpremultiply(r, background[0]);
    raw[index * 4 + 1] = unpremultiply(g, background[1]);
    raw[index * 4 + 2] = unpremultiply(b, background[2]);
    raw[index * 4 + 3] = Math.round(alpha * 255);
  }
  console.log(`[logo] 源图 ${width}×${height} · 背景采样 rgb(${background.map((v) => Math.round(v)).join(', ')})`);
  return { raw, width, height };
}

/** 按压暗系数生成 RGBA 缓冲（不改动原图）。 */
function withFactor(mark, factor) {
  const rgba = Buffer.from(mark.raw);
  if (factor === 1) {
    return rgba;
  }
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = Math.round(rgba[index] * factor);
    rgba[index + 1] = Math.round(rgba[index + 1] * factor);
    rgba[index + 2] = Math.round(rgba[index + 2] * factor);
  }
  return rgba;
}

/** 统一日志。 */
function report(relativePath, size) {
  const { size: bytes } = fs.statSync(path.join(ROOT, relativePath));
  console.log(`[logo] ${relativePath} → ${size}px · ${(bytes / 1024).toFixed(1)} KB`);
}

/** 金标 PNG 缓冲（裁四周透明外边距 + 缩放到指定宽度）。 */
async function renderMarkPng(mark, factor, targetWidth) {
  return sharp(withFactor(mark, factor), { raw: { width: mark.width, height: mark.height, channels: 4 } })
    // 裁掉标识四周的透明外边距（源图留白很大，不裁则导航栏 24px 下几乎不可见）
    .trim({ threshold: 1 })
    .resize({ width: targetWidth, fit: 'inside' })
    .png()
    .toBuffer();
}

/** 透明底输出（站点资源 / 标题栏品牌标记）。 */
async function renderTransparent(mark, size, factor, relativePath) {
  const outPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(withFactor(mark, factor), { raw: { width: mark.width, height: mark.height, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  report(relativePath, size);
}

/** 黑底输出：圆角实底 + 居中金标（应用图标 / 托盘图标）。 */
async function renderTile(mark, factor, size, radiusRatio, markWidthRatio, relativePath) {
  const outPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const markPng = await renderMarkPng(mark, factor, Math.round(size * markWidthRatio));
  const radius = Math.round(size * radiusRatio);
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${TILE_COLOR}"/>` +
      '</svg>',
  );
  await sharp(tile)
    .composite([{ input: markPng, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  report(relativePath, size);
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('[logo] 缺少源图 logo.png（项目根目录），请放入后重跑');
    process.exit(1);
  }
  const mark = await extractMark();

  // 透明底：站点导航/首页 logo、favicon、标题栏品牌标记（浅色底版压暗保可读）
  const transparent = [
    ['website/public/logo.png', SIZE, 1],
    ['website/public/favicon.png', FAVICON_SIZE, 1],
    ['src/forge-shell/web/brand-mark-dark.png', BRAND_SIZE, 1],
    ['src/forge-shell/web/brand-mark-light.png', BRAND_SIZE, LIGHT_FACTOR],
    ['resources/themes/default/brand-mark-dark.png', BRAND_SIZE, 1],
    ['resources/themes/default/brand-mark-light.png', BRAND_SIZE, LIGHT_FACTOR],
  ];
  for (const [relativePath, size, factor] of transparent) {
    await renderTransparent(mark, size, factor, relativePath);
  }

  // 黑底应用图标（512px）：桌面/任务栏/Dock/安装包；浅深两版同为黑底（金标已足对比）
  const apps = [
    'src/forge-shell/web/app-icon-light.png',
    'src/forge-shell/web/app-icon-dark.png',
    'resources/themes/default/app-icon-light.png',
    'resources/themes/default/app-icon-dark.png',
  ];
  for (const relativePath of apps) {
    await renderTile(mark, 1, SIZE, APP_RADIUS_RATIO, APP_MARK_WIDTH_RATIO, relativePath);
  }

  // 黑底托盘图标（64px）：16px 渲染尺寸下靠方块轮廓保证可辨识
  const trays = [
    'src/forge-shell/web/tray-icon-light.png',
    'src/forge-shell/web/tray-icon-dark.png',
    'resources/themes/default/tray-icon-light.png',
    'resources/themes/default/tray-icon-dark.png',
  ];
  for (const relativePath of trays) {
    await renderTile(mark, 1, TRAY_SIZE, TRAY_RADIUS_RATIO, TRAY_MARK_WIDTH_RATIO, relativePath);
  }

  console.log(`[logo] 完成（透明底 ${transparent.length} + 黑底应用 ${apps.length} + 黑底托盘 ${trays.length} 个产物）`);
}

main().catch((error) => {
  console.error('[logo] 失败：', error);
  process.exit(1);
});
