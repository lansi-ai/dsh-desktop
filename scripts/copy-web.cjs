// 构建后脚本：将 desktop-shell/web/ 静态资源与 resources/ 静态资源复制到 dist
const fs = require('node:fs')
const path = require('node:path')

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDirRecursive(from, to)
    else fs.copyFileSync(from, to)
  }
}

const webSrc = path.join(__dirname, '..', 'src', 'desktop-shell', 'web')
const webDst = path.join(__dirname, '..', 'dist', 'desktop-shell', 'web')
const resourcesSrc = path.join(__dirname, '..', 'resources')
const resourcesDst = path.join(__dirname, '..', 'dist', 'resources')

if (fs.existsSync(webSrc)) {
  fs.mkdirSync(webDst, { recursive: true })
  for (const file of fs.readdirSync(webSrc)) {
    fs.copyFileSync(path.join(webSrc, file), path.join(webDst, file))
  }
  console.log(`[build] 已复制 ${fs.readdirSync(webSrc).length} 个静态文件到 dist/desktop-shell/web/`)
}

// 策略：resources/ 目录（agent-presets 等静态资源）整体复制到 dist/resources/
if (fs.existsSync(resourcesSrc)) {
  copyDirRecursive(resourcesSrc, resourcesDst)
  console.log('[build] 已复制 resources/ 静态资源到 dist/resources/')
}
