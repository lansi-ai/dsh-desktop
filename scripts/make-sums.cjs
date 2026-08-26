// M4-a1：为 release/ 产物生成 SHA256SUMS 校验文件
// 遍历 release 目录下的安装包/便携包（.exe），计算 SHA256 写入 SHA256SUMS
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const RELEASE_DIR = path.join(__dirname, '..', 'release')

if (!fs.existsSync(RELEASE_DIR)) {
  console.error('[make-sums] release/ 目录不存在，请先执行 electron-builder 打包')
  process.exit(1)
}

const artifacts = fs.readdirSync(RELEASE_DIR).filter((name) => name.endsWith('.exe'))
if (artifacts.length === 0) {
  console.error('[make-sums] release/ 下未找到 .exe 产物')
  process.exit(1)
}

const lines = artifacts.map((name) => {
  const filePath = path.join(RELEASE_DIR, name)
  const hash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  console.log(`[make-sums] ${hash}  ${name}`)
  return `${hash}  ${name}`
})

const sumsPath = path.join(RELEASE_DIR, 'SHA256SUMS')
fs.writeFileSync(sumsPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`[make-sums] 已生成 ${sumsPath}（${artifacts.length} 个产物）`)
