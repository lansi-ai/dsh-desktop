// 主题资源生成：产出 resources/themes/<id>/ 主题包（theme.json + 图标四件套）。
//
// 每个主题包：
//   theme.json            清单（id/name/color，颜色体系后续扩展）
//   app-icon-light.png    512px（浅色任务栏/Dock）
//   app-icon-dark.png     512px（深色任务栏/Dock）
//   tray-icon-light.png   64px（浅色托盘）
//   tray-icon-dark.png    64px（深色托盘）
//
// 图标造型：主题之间是**不同图案**（形状差异，非仅换色）——
//   default  官方 harness logo（黑/白，无背景，官方原貌）
//   aurora   极光雪花：圆角深青底 + 白色六向雪花（light 深底 / dark 亮底）
//   sunset   落日海浪：圆角橙红底 + 白色太阳与两道波浪（light 深底 / dark 亮底）
//
// 新增/修改主题：编辑 THEMES 表（官方源或自定义 SVG builder）后重跑
// `node scripts/make-theme-assets.cjs`；自定义主题也可直接放入同构 PNG 文件。
const path = require('node:path')
const fs = require('node:fs')
const sharp = require('sharp')

const svgPath = path.join(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg')
const outRoot = path.join(__dirname, '..', 'resources', 'themes')

// 官方 SVG path 填充为 fill="#000"（浅色态）；替换该属性生成彩色/白色变体。
const LIGHT_FILL = 'fill="#000"'

/** 极光雪花 SVG（bg=底色；白色六向雪花，每枝带端部分叉 + 中心圆）。 */
function buildAuroraSvg(bg) {
  const branches = [0, 60, 120, 180, 240, 300]
    .map(
      (deg) =>
        `<g transform="rotate(${deg} 256 256)">` +
        '<line x1="256" y1="100" x2="256" y2="412"/>' +
        '<path d="M256 152 L216 112 M256 152 L296 112"/>' +
        '<path d="M256 360 L216 400 M256 360 L296 400"/>' +
        '</g>',
    )
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="112" fill="${bg}"/>` +
    `<g stroke="#ffffff" stroke-width="26" stroke-linecap="round" fill="none">${branches}</g>` +
    `<circle cx="256" cy="256" r="26" fill="#ffffff"/>` +
    `</svg>`
  )
}

/** 落日海浪 SVG（bg=底色；白色太阳 + 两道波浪）。 */
function buildSunsetSvg(bg) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="112" fill="${bg}"/>` +
    `<circle cx="256" cy="228" r="100" fill="#ffffff"/>` +
    `<g stroke="#ffffff" stroke-width="26" stroke-linecap="round" fill="none">` +
    '<path d="M136 366 q40 -32 80 0 t80 0 t80 0"/>' +
    '<path d="M166 424 q30 -24 60 0 t60 0 t60 0"/>' +
    '</g>' +
    `</svg>`
  )
}

/**
 * 主题定义表：source='official' 用官方 favicon 染色；source='custom' 用独立
 * 图案 SVG builder（bg 为圆角底色，light/dark 两版仅底色深浅不同——白色图案
 * 在自持对比度的色块上两种任务栏底色均清晰）。
 */
const THEMES = [
  { id: 'default', name: '默认', color: '#4d6bfe', source: 'official', light: LIGHT_FILL, dark: 'fill="#fff"' },
  { id: 'aurora', name: '极光', color: '#22d3ee', source: 'custom', build: buildAuroraSvg, light: '#0e7490', dark: '#0891b2' },
  { id: 'sunset', name: '落日', color: '#f97316', source: 'custom', build: buildSunsetSvg, light: '#c2410c', dark: '#ea580c' },
]

async function renderIcon(svgSource, file, size) {
  await sharp(Buffer.from(svgSource)).resize(size, size).png().toFile(file)
}

async function main() {
  const officialSvg = fs.readFileSync(svgPath, 'utf8')
  for (const theme of THEMES) {
    const themeDir = path.join(outRoot, theme.id)
    fs.mkdirSync(themeDir, { recursive: true })
    // 浅色态/深色态两版图标源
    const svgLight = theme.source === 'official' ? officialSvg.replaceAll(LIGHT_FILL, theme.light) : theme.build(theme.light)
    const svgDark = theme.source === 'official' ? officialSvg.replaceAll(LIGHT_FILL, theme.dark) : theme.build(theme.dark)
    await renderIcon(svgLight, path.join(themeDir, 'app-icon-light.png'), 512)
    await renderIcon(svgDark, path.join(themeDir, 'app-icon-dark.png'), 512)
    await renderIcon(svgLight, path.join(themeDir, 'tray-icon-light.png'), 64)
    await renderIcon(svgDark, path.join(themeDir, 'tray-icon-dark.png'), 64)
    // 壳层 UI 图标（renderer 经 dsh-ui://app/theme/<id|current>/icons/<file> 直读）：
    // titlebar-logo.svg = 标题栏品牌 logo（default 用官方 favicon 原文——自带明暗
    // media query 适配；自定义主题用图案 SVG）。官方 UI 内部小图标（设置/文件夹等）
    // 经 ui-overrides.json 映射替换（desktop-ui-icons-client 消费，空表=不激活）。
    const iconsDir = path.join(themeDir, 'icons')
    fs.mkdirSync(iconsDir, { recursive: true })
    const logoSvg = theme.source === 'official' ? officialSvg : theme.build(theme.light)
    fs.writeFileSync(path.join(iconsDir, 'titlebar-logo.svg'), logoSvg, 'utf-8')
    fs.writeFileSync(path.join(iconsDir, 'ui-overrides.json'), JSON.stringify(UI_OVERRIDES[theme.id] ?? [], null, 2) + '\n', 'utf-8')
    const manifest = { id: theme.id, name: theme.name, color: theme.color }
    fs.writeFileSync(path.join(themeDir, 'theme.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
    console.log(`[themes] ${theme.id}（${theme.name}）：图标四件套 + icons/ + theme.json 已生成`)
  }
  console.log(`[themes] 共 ${THEMES.length} 个主题包 → ${outRoot}`)
}

/**
 * 官方 UI 内部图标替换映射（settings/folder 等内联 SVG → 主题图标）。
 * 条目：{ match: 官方 svg path d 前缀特征, icon: 主题 icons/ 内替换文件 }。
 * 空表 = 覆盖层不激活（零开销）；实机探测官方图标 path 后在此登记。
 */
const UI_OVERRIDES = {
  default: [],
  aurora: [],
  sunset: [],
}

main().catch((error) => {
  console.error('[themes] 生成失败:', error)
  process.exit(1)
})
