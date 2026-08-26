// 构建后脚本：将 desktop-shell/web/ 静态资源复制到 dist
const fs = require('node:fs')
const path = require('node:path')

const src = path.join(__dirname, '..', 'src', 'desktop-shell', 'web')
const dst = path.join(__dirname, '..', 'dist', 'desktop-shell', 'web')

if (fs.existsSync(src)) {
  fs.mkdirSync(dst, { recursive: true })
  for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(dst, file))
  }
  console.log(`[build] 已复制 ${fs.readdirSync(src).length} 个静态文件到 dist/desktop-shell/web/`)
}
