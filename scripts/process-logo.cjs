#!/usr/bin/env node
'use strict';

/**
 * 品牌 logo 处理（源图 = 项目根 logo.png，按 .gitignore 不入库）
 *
 * 源图形态：1024×1024 金渐变标识 + 近黑实底。本脚本按亮度抽取透明通道（金标亮度远高于
 * 深色底），并做「反预乘」去掉边缘深色描边，产出站点与应用所需的全部尺寸：
 *
 *   站点    website/public/logo.png（导航/首页）· website/public/favicon.png
 *   应用    src/desktop-shell/web/app-icon-{light,dark}.png（内置回退，标题栏品牌 logo 复用）
 *           resources/themes/default/app-icon-{light,dark}.png（默认图标包副本）
 *
 * 浅色底变体（app-icon-light）整体压暗：金色在纯白背景上对比度不足，压深以保可读。
 * 用法：node scripts/process-logo.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'logo.png');

/** 输出尺寸（app-icon 槽位声明 512；favicon 取 128 由浏览器自行缩放）。 */
const SIZE = 512;
const FAVICON_SIZE = 128;
/** 亮度阈值（0~255）：≤LO 全透明，≥HI 全不透明。源图深底≈26，金标≈160~222。 */
const LUMA_LOW = 60;
const LUMA_HIGH = 140;
/** 浅色底变体压暗系数。 */
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

/** 按尺寸与压暗系数落盘。 */
async function render(mark, size, factor, relativePath) {
  const rgba = Buffer.from(mark.raw);
  if (factor !== 1) {
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = Math.round(rgba[index] * factor);
      rgba[index + 1] = Math.round(rgba[index + 1] * factor);
      rgba[index + 2] = Math.round(rgba[index + 2] * factor);
    }
  }
  const outPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(rgba, { raw: { width: mark.width, height: mark.height, channels: 4 } })
    // 裁掉标识四周的透明外边距（源图留白很大，不裁则导航栏 24px 下几乎不可见）
    .trim({ threshold: 1 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  const { size: bytes } = fs.statSync(outPath);
  console.log(`[logo] ${relativePath} → ${size}px · ${(bytes / 1024).toFixed(1)} KB`);
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('[logo] 缺少源图 logo.png（项目根目录），请放入后重跑');
    process.exit(1);
  }
  const mark = await extractMark();
  const outputs = [
    ['website/public/logo.png', SIZE, 1],
    ['website/public/favicon.png', FAVICON_SIZE, 1],
    ['src/desktop-shell/web/app-icon-dark.png', SIZE, 1],
    ['src/desktop-shell/web/app-icon-light.png', SIZE, LIGHT_FACTOR],
    ['resources/themes/default/app-icon-dark.png', SIZE, 1],
    ['resources/themes/default/app-icon-light.png', SIZE, LIGHT_FACTOR],
  ];
  for (const [relativePath, size, factor] of outputs) {
    await render(mark, size, factor, relativePath);
  }
  console.log(`[logo] 完成（${outputs.length} 个产物）`);
}

main().catch((error) => {
  console.error('[logo] 失败：', error);
  process.exit(1);
});
