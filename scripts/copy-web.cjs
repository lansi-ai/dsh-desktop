// 构建后脚本：将 forge-shell/web/ 静态资源与 resources/ 静态资源复制到 dist
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

const webSrc = path.join(__dirname, '..', 'src', 'forge-shell', 'web')
const webDst = path.join(__dirname, '..', 'dist', 'forge-shell', 'web')
const resourcesSrc = path.join(__dirname, '..', 'resources')
const resourcesDst = path.join(__dirname, '..', 'dist', 'resources')

if (fs.existsSync(webSrc)) {
  fs.mkdirSync(webDst, { recursive: true })
  for (const file of fs.readdirSync(webSrc)) {
    fs.copyFileSync(path.join(webSrc, file), path.join(webDst, file))
  }
  console.log(`[build] 已复制 ${fs.readdirSync(webSrc).length} 个静态文件到 dist/forge-shell/web/`)
}

// 策略：resources/ 目录（agent-presets 等静态资源）整体复制到 dist/resources/
if (fs.existsSync(resourcesSrc)) {
  copyDirRecursive(resourcesSrc, resourcesDst)
  console.log('[build] 已复制 resources/ 静态资源到 dist/resources/')
}

// 打包版根锚点 cordis.yml：boot() 将 ctx.baseUrl 设为 configPath 所在目录，
// dsh-agent-presets 的 packageInstalled 以该目录为起点向上查找 node_modules/<pkg>。
// 锚点随 dist/**/* 进 asar 后，baseUrl=<app.asar>/dist/，向上一级即命中 asar 内
// node_modules（Electron 主进程 fs 对 asar 路径的 existsSync 生效）。asar 只读
// 无碍：Include 对已存在文件只读不写。dev 模式不读本文件（仍用项目内 .runtime/
// 锚点，向上可命中项目 node_modules）。
const cordisRootConfig = path.join(__dirname, '..', 'dist', 'cordis.yml')
fs.writeFileSync(cordisRootConfig, '# dsh-forge profile root — 所有配置由 forge-patch.yml overlay 补丁覆盖。\n[]\n')
console.log('[build] 已生成 dist/cordis.yml（打包版根锚点）')
