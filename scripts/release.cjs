#!/usr/bin/env node
'use strict';

/**
 * DSH Forge 发版脚本（M4 发布链自动化）
 *
 * 流程：预检 → 质量门禁 → 版本号 bump →（可选）本地打包 → commit + tag →（可选）push 触发 CI
 *
 * 用法：
 *   npm run release -- <version> [--local] [--clean] [--push] [--skip-gates] [--dry-run]
 *
 * 选项：
 *   <version>      目标版本号（显式传，如 0.1.1-alpha.6）
 *   --local        额外执行本地 Windows 打包（npm run dist）+ 产物名对齐 latest.yml path + SHA256SUMS
 *   --clean        打包前清理 release/ 中非目标版本的旧产物（需配合 --local）
 *   --push         真实推送 main 与 v<version> tag（默认只做本地 commit/tag 并打印待推命令）
 *   --skip-gates   跳过 typecheck/lint/test/build 门禁（仅调试用）
 *   --dry-run      只打印将执行的命令，不写文件/不提交/不打包
 *
 * 说明：
 *   1. tag 推送后由 .github/workflows/release-{win,mac}.yml 在云端构建双平台产物并上传 GitHub Release。
 *   2. 推送退出码不可信（沙箱拦 git 凭据库会伪失败，坑 44）→ 一律以 git ls-remote 回验为准。
 *   3. 本地打包需沙箱外运行（release/ 与 AppData 缓存在工作区外，见坑 0/38/42）。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const PACKAGE_LOCK = path.join(ROOT, 'package-lock.json');
const RELEASE_DIR = path.join(ROOT, 'release');
const BRANCH = 'main';
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
const version = argv.find((arg) => !arg.startsWith('--'));
const opts = {
  local: flags.has('--local'),
  clean: flags.has('--clean'),
  push: flags.has('--push'),
  skipGates: flags.has('--skip-gates'),
  dryRun: flags.has('--dry-run'),
};

function log(message) {
  console.log(`[release] ${message}`);
}

function die(message) {
  console.error(`[release] ✗ ${message}`);
  process.exit(1);
}

/** 执行 git 子命令（数组传参，规避 shell 引号与中文编码问题）。 */
function git(args, { capture = false, allowFail = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) {
    die(`git ${args.join(' ')} 执行失败：${result.error.message}`);
  }
  if (!allowFail && result.status !== 0) {
    die(`git ${args.join(' ')} 退出码 ${result.status}`);
  }
  return capture ? (result.stdout || '').trim() : '';
}

/** 执行 npm script（Windows 下 npm 为 .cmd，必须走 shell）。 */
function npmRun(script) {
  const command = `npm run ${script}`;
  if (opts.dryRun) {
    log(`(dry-run) ${command}`);
    return;
  }
  log(`▶ ${command}`);
  const result = spawnSync(command, { cwd: ROOT, shell: true, stdio: 'inherit' });
  if (result.error) {
    die(`${command} 执行失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    die(`${command} 退出码 ${result.status}`);
  }
}

/** 执行 scripts/ 下的本地脚本。 */
function runScript(fileName, extraArgs = []) {
  const scriptPath = path.join(ROOT, 'scripts', fileName);
  if (opts.dryRun) {
    log(`(dry-run) node scripts/${fileName} ${extraArgs.join(' ')}`.trim());
    return;
  }
  log(`▶ node scripts/${fileName}`);
  const result = spawnSync(process.execPath, [scriptPath, ...extraArgs], { cwd: ROOT, stdio: 'inherit' });
  if (result.error) {
    die(`scripts/${fileName} 执行失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    die(`scripts/${fileName} 退出码 ${result.status}`);
  }
}

/** 解析语义化版本号；非法返回 null。 */
function parseVersion(value) {
  const match = VERSION_RE.exec(value);
  if (!match) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** 语义化比较：-1 / 0 / 1（无预发布 > 有预发布，数字标识符 < 字母标识符）。 */
function compareVersions(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1;
    }
  }
  if (left.pre.length === 0 && right.pre.length === 0) {
    return 0;
  }
  if (left.pre.length === 0) {
    return 1;
  }
  if (right.pre.length === 0) {
    return -1;
  }
  const length = Math.max(left.pre.length, right.pre.length);
  for (let index = 0; index < length; index++) {
    const leftToken = left.pre[index];
    const rightToken = right.pre[index];
    if (leftToken === undefined) {
      return -1;
    }
    if (rightToken === undefined) {
      return 1;
    }
    if (leftToken === rightToken) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftToken);
    const rightNumeric = /^\d+$/.test(rightToken);
    if (leftNumeric && rightNumeric) {
      return Number(leftToken) > Number(rightToken) ? 1 : -1;
    }
    if (leftNumeric) {
      return -1;
    }
    if (rightNumeric) {
      return 1;
    }
    return leftToken > rightToken ? 1 : -1;
  }
  return 0;
}

/** 文本级替换版本号（保持文件原有格式，避免整文件重排产生巨大 diff）。 */
function bumpVersionField(filePath, oldVersion, newVersion, expectedCount) {
  const fileName = path.basename(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  const escaped = oldVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`"version":\\s*"${escaped}"`, 'g');
  const hits = text.match(pattern) || [];
  if (hits.length !== expectedCount) {
    die(`${fileName} 中版本号 "${oldVersion}" 出现 ${hits.length} 次（预期 ${expectedCount} 次）`);
  }
  if (opts.dryRun) {
    log(`(dry-run) ${fileName}: ${oldVersion} → ${newVersion}`);
    return;
  }
  fs.writeFileSync(filePath, text.replace(pattern, `"version": "${newVersion}"`), 'utf8');
  log(`${fileName}: ${oldVersion} → ${newVersion}`);
}

/** 预检：工作区、分支、tag 唯一性、远程同步。 */
function preflight() {
  const dirty = git(['status', '--porcelain'], { capture: true });
  if (dirty) {
    die(`工作区不干净，请先提交或暂存以下改动：\n${dirty}`);
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true });
  if (branch !== BRANCH) {
    die(`当前分支为 ${branch}，发版必须在 ${BRANCH} 上进行`);
  }

  if (git(['rev-parse', '-q', '--verify', `refs/tags/v${version}`], { capture: true, allowFail: true })) {
    die(`tag v${version} 已存在（本地）`);
  }

  log('同步远程…');
  git(['fetch', 'origin', BRANCH]);
  // 允许本地领先（未推的功能提交随发版一并推送），但落后/分叉必须先对齐
  const behind = git(['rev-list', '--count', `HEAD..origin/${BRANCH}`], { capture: true });
  if (Number(behind) > 0) {
    die(`本地 ${BRANCH} 落后 origin/${BRANCH} ${behind} 个提交，请先 pull 对齐`);
  }

  const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/v${version}`], { capture: true });
  if (remoteTag) {
    die(`tag v${version} 已存在（远程）`);
  }
}

/** 质量门禁：typecheck / lint / test / build，任一失败即中止。 */
function gates() {
  if (opts.skipGates) {
    log('⚠ 已跳过质量门禁（--skip-gates）');
    return;
  }
  for (const script of ['typecheck', 'lint', 'test', 'build']) {
    npmRun(script);
  }
  log('✓ 质量门禁通过（typecheck / lint / test / build）');
}

/** 清理 release/ 中非目标版本的旧产物（仅 --clean 显式开启）。 */
function cleanStaleArtifacts() {
  if (!fs.existsSync(RELEASE_DIR)) {
    return;
  }
  const stale = fs.readdirSync(RELEASE_DIR).filter(
    (name) => /\.(exe|blockmap|dmg|zip)$/.test(name) && !name.includes(version),
  );
  if (stale.length === 0) {
    log('release/ 无旧版本产物需清理');
    return;
  }
  for (const name of stale) {
    if (opts.dryRun) {
      log(`(dry-run) 删除 release/${name}`);
      continue;
    }
    fs.rmSync(path.join(RELEASE_DIR, name), { force: true });
    log(`已清理旧产物 release/${name}`);
  }
}

/** 本地打包：electron-builder 出包 → 产物名对齐 latest.yml path → 生成 SHA256SUMS。 */
function packageLocal() {
  cleanStaleArtifacts();
  npmRun('dist');
  runScript('align-release-assets.cjs');
  runScript('make-sums.cjs');
  log('✓ 本地打包完成（release/ 产物名已与 latest.yml path 对齐）');
}

/** 提交版本号并打 tag。 */
function commitAndTag() {
  const message = `chore(release): 版本号升至 ${version}`;
  if (opts.dryRun) {
    log('(dry-run) git add package.json package-lock.json');
    log(`(dry-run) git commit -m "${message}"`);
    log(`(dry-run) git tag v${version}`);
    return;
  }
  git(['add', 'package.json', 'package-lock.json']);
  git(['commit', '-m', message]);
  git(['tag', `v${version}`]);
  log(`✓ 已提交并打 tag v${version}`);
}

/** 推送 main 与 tag（默认只打印待推命令）；推送后以 ls-remote 回验（坑 44）。 */
function push() {
  const tag = `v${version}`;
  if (!opts.push) {
    log('未指定 --push，本地 commit/tag 已完成。待推命令：');
    console.log(`  git push origin ${BRANCH}`);
    console.log(`  git push origin ${tag}`);
    log('推送后 CI 自动构建 win+mac 并上传 GitHub Release（预发布）');
    return;
  }
  if (opts.dryRun) {
    log(`(dry-run) git push origin ${BRANCH}`);
    log(`(dry-run) git push origin ${tag}`);
    return;
  }

  // 坑 44：沙箱拦 git 凭据库会让 push 报非 0，但推送实际可能已成功 → 不据此判定失败
  for (const ref of [BRANCH, tag]) {
    git(['push', 'origin', ref], { allowFail: true });
  }

  const localHead = git(['rev-parse', 'HEAD'], { capture: true });
  const remoteHead = git(['ls-remote', 'origin', `refs/heads/${BRANCH}`], { capture: true });
  const remoteTag = git(['ls-remote', 'origin', `refs/tags/${tag}`], { capture: true });
  if (!remoteHead.startsWith(localHead)) {
    die(`回验失败：origin/${BRANCH} 未指向 ${localHead.slice(0, 7)}`);
  }
  if (!remoteTag.startsWith(localHead)) {
    die(`回验失败：origin tag ${tag} 未指向 ${localHead.slice(0, 7)}`);
  }
  log(`✓ 推送并回验通过：origin/${BRANCH} 与 ${tag} → ${localHead.slice(0, 7)}`);
  log('CI 已触发：release-win + release-mac 将构建并上传 GitHub Release');
}

function main() {
  if (!version) {
    die('用法：npm run release -- <version> [--local] [--clean] [--push] [--skip-gates] [--dry-run]');
  }
  const target = parseVersion(version);
  if (!target) {
    die(`版本号格式非法：${version}（期望 x.y.z 或 x.y.z-<prerelease>）`);
  }
  if (opts.clean && !opts.local) {
    die('--clean 需配合 --local 使用');
  }

  const currentVersion = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
  const current = parseVersion(currentVersion);
  if (!current) {
    die(`package.json 中的版本号无法解析：${currentVersion}`);
  }
  if (compareVersions(target, current) <= 0) {
    die(`目标版本 ${version} 必须高于当前版本 ${currentVersion}`);
  }

  const plan = [opts.local ? '本地打包' : null, opts.push ? '推送触发 CI' : '仅本地'].filter(Boolean).join(' · ');
  log(`发版计划：${currentVersion} → ${version}（${plan}）`);

  preflight();
  gates();
  bumpVersionField(PACKAGE_JSON, currentVersion, version, 1);
  bumpVersionField(PACKAGE_LOCK, currentVersion, version, 2);
  if (opts.local) {
    packageLocal();
  }
  commitAndTag();
  push();
  if (!opts.local) {
    log('提示：未指定 --local，本次未生成本地安装包（release/ 无本版产物）；需要本地包请下次加 --local');
  }
  log('✓ 发版流程完成');
}

main();
