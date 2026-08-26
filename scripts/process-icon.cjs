// 托盘/应用图标处理工具（可复用）：把用户源图裁剪放大主体 + 抠深蓝背景为透明。
// 输出 64x64（托盘 tray-icon.png）+ 256x256（窗口/应用 app-icon.png）。
// 用法：把源图放项目根 lansi.jpg，运行 `node scripts/process-icon.cjs`。
const Jimp = require('jimp')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'lansi.jpg')
const TRAY_OUT = path.join(__dirname, '..', 'src', 'desktop-shell', 'web', 'tray-icon.png')
const APP_OUT = path.join(__dirname, '..', 'src', 'desktop-shell', 'web', 'app-icon.png')

/** 采样图像四角的平均色（作为背景参考色）。 */
function cornerAvg(img) {
  const { width: w, height: h } = img.bitmap
  const n = 0.08 // 取每角 8% 边长的小块均值
  let r = 0; let g = 0; let b = 0; let c = 0
  for (const [ox, oy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const x0 = Math.max(0, Math.floor(ox === 0 ? 0 : w - w * n))
    const y0 = Math.max(0, Math.floor(oy === 0 ? 0 : h - h * n))
    const x1 = Math.min(w, Math.floor(ox === 0 ? w * n : w))
    const y1 = Math.min(h, Math.floor(oy === 0 ? h * n : h))
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        const { r: rr, g: gg, b: bb } = Jimp.intToRGBA(img.getPixelColor(x, y))
        r += rr; g += gg; b += bb; c += 1
      }
    }
  }
  return { r: r / c, g: g / c, b: b / c }
}

/** 处理一份尺寸的输出。 */
async function make(src, size, outPath) {
  let img = src.clone()
  img.autocrop({ tolerance: 0.04, cropOnlyFrames: false })
  const { width: w, height: h } = img.bitmap
  // 以原图四角深蓝为参考抠背景（发光主体保留）
  const bg = cornerAvg(src)
  img.scan(0, 0, w, h, (x, y) => {
    const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y))
    const dist = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b)
    if (dist < 85) img.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 0), x, y)
  })
  // 放到 size 方形画布（缩放并居中，透明背景）
  img = img.contain(size, size, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE, 0x00000000)
  await img.writeAsync(outPath)
  console.log('written', outPath, `${size}x${size}`)
}

async function main() {
  const src = await Jimp.read(SRC)
  await make(src, 64, TRAY_OUT)
  await make(src, 256, APP_OUT)
}
main().catch((e) => { console.error(e); process.exit(1) })
