// 图标生成：把官方 harness favicon.svg 光栅化为黑白双版 PNG（app 512 + tray 64）。
// 源：node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg（单路径 SVG，
// 默认 fill="#000"，深色态 media query 为 #fff——静态位图取不到 media query，
// 直接字符串替换 fill 生成白色变体）。
// 产物：src/desktop-shell/web/{app-icon, tray-icon}-{light,dark}.png
//   - light 版 = 黑色 logo（浅色任务栏/托盘用）
//   - dark  版 = 白色 logo（深色任务栏/托盘用）
// 运行期由 main.ts / desktop-tray.ts 按 nativeTheme.shouldUseDarkColors 动态选用。
const path = require('node:path')
const fs = require('node:fs')
const sharp = require('sharp')

const svgPath = path.join(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg')
const outDir = path.join(__dirname, '..', 'src', 'desktop-shell', 'web')

const svg = fs.readFileSync(svgPath, 'utf8')
// 官方 SVG 的 path 填充为 fill="#000"（浅色态）；白色变体替换该属性值。
const svgDark = svg.replaceAll('fill="#000"', 'fill="#fff"')

async function render(source, file, size) {
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(path.join(outDir, file))
  console.log(`[icons] ${file} (${size}x${size})`)
}

async function main() {
  await render(svg, 'app-icon-light.png', 512)
  await render(svgDark, 'app-icon-dark.png', 512)
  await render(svg, 'tray-icon-light.png', 64)
  await render(svgDark, 'tray-icon-dark.png', 64)
}

main().catch((error) => {
  console.error('[icons] 生成失败:', error)
  process.exit(1)
})
