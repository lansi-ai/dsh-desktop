// 托盘图标处理工具（可复用）：把用户源图裁剪放大主体 + 抠深蓝背景为透明，输出 64x64 PNG。
// 用法：把源图放项目根 lansi.jpg，运行 `node scripts/process-icon.cjs`，产物写入 src/desktop-shell/web/tray-icon.png。
const Jimp = require('jimp')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'lansi.jpg')
const OUT = path.join(__dirname, '..', 'src', 'desktop-shell', 'web', 'tray-icon.png')

async function main() {
  let img = await Jimp.read(SRC)
  // 1) 裁掉边缘近似背景色（聚焦鲸鱼主体）
  img.autocrop({ tolerance: 0.04, cropOnlyFrames: false })
  // 2) 放到 64x64 方形画布（缩放并居中，背景透明）
  img = img.contain(64, 64, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE, 0x00000000)
  const { width: w, height: h } = img.bitmap
  // 3) 抠背景：参考边缘像素均值，色差小于阈值转透明
  let br = 0; let bg = 0; let bb = 0; let n = 0
  const sample = (x, y) => {
    const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y))
    br += r; bg += g; bb += b; n += 1
  }
  for (let i = 0; i < w; i++) { sample(i, 0); sample(i, h - 1) }
  for (let j = 0; j < h; j++) { sample(0, j); sample(w - 1, j) }
  br /= n; bg /= n; bb /= n
  img.scan(0, 0, w, h, (x, y) => {
    const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y))
    const dist = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)
    if (dist < 85) img.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 0), x, y)
  })
  await img.writeAsync(OUT)
  console.log('written', OUT, `${w}x${h}`, 'bg', Math.round(br), Math.round(bg), Math.round(bb))
}
main().catch((e) => { console.error(e); process.exit(1) })
