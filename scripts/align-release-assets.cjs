#!/usr/bin/env node
'use strict';

/**
 * 发布产物名对齐工具（坑 41 根治 · 本地发版与 CI 共用）
 *
 * 背景：electron-builder 的 nsis.artifactName 用 ${productName}（含空格，如 "DSH Forge"），
 * 磁盘产物名形如 `DSH Forge-0.1.1-alpha.6-setup.exe`；而它自己写出的 latest.yml / latest-mac.yml
 * 的 path 字段会把空格规范成连字符（`DSH-Forge-...`）。CI 用 `--publish never` + `gh release upload`
 * 绕过了 electron-builder 的发布协调，GitHub 又把上传文件名里的空格存成点号 → path 与资产名脱节，
 * electron-updater 按 path 拼下载 URL 直接 404（坑 41）。
 *
 * 本工具把 release/ 下的磁盘产物重命名为与描述符声明 path 完全一致的名字（同名 .blockmap 一并改名），
 * 使「本地产物 / CI 上传资产 / latest.yml path」三者逐字节一致。
 *
 * 用法：node scripts/align-release-assets.cjs [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');

const RELEASE_DIR = path.join(__dirname, '..', 'release');
const DRY_RUN = process.argv.includes('--dry-run');
// electron-builder 生成的更新描述符（win = latest.yml，mac = latest-mac.yml）
const MANIFESTS = ['latest.yml', 'latest-mac.yml'];

/** electron-builder 写 path 时的规范化规则：空格 → 连字符。 */
function normalize(name) {
  return name.replace(/ /g, '-');
}

/** 从描述符中提取声明的产物名（path 行 + files[].url 行，排除 http 绝对地址）。 */
function declaredNames(manifestPath) {
  const names = new Set();
  for (const line of fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:path|url):\s*['"]?(.+?)['"]?\s*$/.exec(line);
    if (match && match[1] && !/^https?:\/\//.test(match[1])) {
      names.add(match[1]);
    }
  }
  return names;
}

function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.error('[align] release/ 目录不存在，请先执行打包');
    process.exit(1);
  }

  const diskNames = fs.readdirSync(RELEASE_DIR);
  const targets = new Set();
  for (const manifest of MANIFESTS) {
    const manifestPath = path.join(RELEASE_DIR, manifest);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    for (const name of declaredNames(manifestPath)) {
      targets.add(name);
    }
  }
  if (targets.size === 0) {
    console.log('[align] 未发现 latest*.yml 描述符，跳过对齐');
    return;
  }

  let renamed = 0;
  let aligned = 0;
  let missing = 0;
  for (const target of targets) {
    if (fs.existsSync(path.join(RELEASE_DIR, target))) {
      aligned++;
      continue;
    }
    // 磁盘名与声明名只差「空格 ↔ 连字符」时视为同一产物
    const source = diskNames.find((name) => normalize(name) === target);
    if (!source) {
      console.warn(`[align] 缺失：${target}（磁盘无对应产物，跳过）`);
      missing++;
      continue;
    }
    // 产物本体 + 同名 .blockmap 成对改名
    for (const [from, to] of [
      [source, target],
      [`${source}.blockmap`, `${target}.blockmap`],
    ]) {
      const fromPath = path.join(RELEASE_DIR, from);
      if (!fs.existsSync(fromPath)) {
        continue;
      }
      if (DRY_RUN) {
        console.log(`[align] (dry-run) ${from} → ${to}`);
      } else {
        fs.renameSync(fromPath, path.join(RELEASE_DIR, to));
        console.log(`[align] ${from} → ${to}`);
      }
    }
    renamed++;
  }

  // 兜底：未被描述符声明的产物（如便携包）也去掉空格，避免 GitHub 上传时被规范成点号
  for (const name of fs.readdirSync(RELEASE_DIR)) {
    const normalized = normalize(name);
    if (normalized === name) {
      continue;
    }
    if (DRY_RUN) {
      console.log(`[align] (dry-run) ${name} → ${normalized}`);
    } else {
      fs.renameSync(path.join(RELEASE_DIR, name), path.join(RELEASE_DIR, normalized));
      console.log(`[align] ${name} → ${normalized}`);
    }
    renamed++;
  }

  console.log(`[align] 完成：改名 ${renamed} · 已对齐 ${aligned} · 缺失 ${missing}`);
}

main();
