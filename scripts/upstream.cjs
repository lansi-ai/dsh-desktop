#!/usr/bin/env node
'use strict';

/**
 * dsh 上游基座版本自动检查与升级工具（sync-upstream 自动化 · ADR-005）
 *
 * 版本权威源 = GitHub releases（上游先打 `dsh-v*` tag，npm 发行常有滞后）：
 *   - check 以 release 清单判定「上游是否出了新版」，不能因为 npm 没有就说无新版本
 *   - npm 仅用于「该版本是否可安装」的发行校验，不再充当新版判据
 *
 * 子命令：
 *   check                只读：查 GitHub releases 相对基线的新版，并标注每个新版的 npm 发行状态
 *   assess <version>     只读：评估目标版本破坏性（拴合面 diff + roster 存在性 + 官方 roster 包集）
 *   upgrade <version>    评估通过(safe)则自动升级（bump + install + typecheck/lint/build + 迁移登记）
 *   auto                 check → assess → 非破坏则 upgrade 全自动
 *
 * 选项：
 *   --dry-run                 只打印将执行的动作，不写文件/不安装
 *   --commit                  升级成功后自动创建 git commit（默认只输出命令）
 *
 * 判定（对齐 docs/upstream-contracts.md §7.4 升级 SOP）：
 *   blocked = roster 引用的官方包在目标版本不存在（如 alpha.4 的 tool-subagent-report 漏发）
 *   review  = S1/S2/S3/S3b 拴合面或 ui-* 槽位契约有差异（需人工对照 diff 适配）
 *   safe    = 拴合面 + ui-* 契约零差异且 roster 包全部存在（可自动升级）
 *   pending = GitHub release 已发布但 npm 尚未发行（不可安装 → 只报告不升级，转人工关注）
 */

const https = require('node:https');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'deepseek-ai/deepseek-harness';
const REPO_URL = `https://api.github.com/repos/${REPO}`;
const REGISTRY = 'https://registry.npmjs.org';
// 上游 release tag 前缀：tag `dsh-v<x.y.z-prerelease>` 去掉前缀即 npm 版本号
const RELEASE_TAG_PREFIX = 'dsh-v';

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const BOOT_TS = path.join(ROOT, 'src/forge-host/boot.ts');
const PATCH_YML = path.join(ROOT, 'src/forge-host/forge-patch.yml');
const MIGRATIONS_DOC = path.join(ROOT, 'docs/upstream-migrations.md');

// 跟踪的上游关键包（dist-tag 对齐面）
const TRACKED_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-web-frontend',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-app-boot',
];

// 拴合面文件（相对上游仓库根；S1 装载协议 / S2 IPC 载波 / S3 装配 profile / S3b roster-manifest）
const COUPLING_SURFACES = {
  'S1 · 装载协议面': [
    'packages/client/web/src/boot.ts',
    'packages/client/web/src/seed.ts',
  ],
  'S2 · IPC 载波面': [
    'packages/client/connection/src/index.ts',
    'packages/client/connection/src/rpc.ts',
    'packages/client/connection/src/rpc-schema.ts',
    'packages/client/connection/src/rpc-host.ts',
    'packages/client/connection/src/client/index.ts',
    'packages/client/connection/src/client/connection.ts',
    'packages/client/connection/src/client/rpc.ts',
    'packages/client/connection/src/client/api.ts',
  ],
  'S3 · 装配 profile 面': [
    'packages/boot/app-boot/src/index.ts',
    'packages/boot/app-boot/src/profile.ts',
  ],
  'S3b · roster/manifest 面': [
    'packages/client/modules/src/index.ts',
    'packages/client/modules/src/client/index.ts',
    'packages/client/modules/src/client/manifest.ts',
    'packages/client/modules/src/client/system.ts',
    'packages/client/store/src/index.ts',
    'packages/client/store/src/contract.ts',
  ],
};

// 自有插件消费的官方 ui-* 槽位契约目录（目录级 diff）
const UI_CONTRACT_DIRS = [
  'packages/client/ui-slots/src',
  'packages/client/ui-layout/src',
  'packages/client/ui-sidebar/src',
  'packages/client/ui-renderer/src',
  'packages/client/ui-primitives/src',
  'packages/client/ui-conversation/src',
  'packages/client/ui-settings-general/src',
  'packages/client/ui-theme/src',
  'packages/client/ui-chat/src',
  'packages/client/ui-locale/src',
];

const OFFICIAL_ROSTER = 'packages/bundle/web-app/cordis.patch.yml';

// ── HTTP 基础 ────────────────────────────────────────────────────────────────

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'dsh-forge-upstream', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`timeout GET ${url}`)));
  });
}

async function httpsGetJson(url, headers) {
  const { status, body } = await httpsGet(url, headers);
  if (status >= 400) throw new Error(`HTTP ${status} GET ${url}`);
  return JSON.parse(body);
}

async function httpsGetStatus(url, headers) {
  const { status } = await httpsGet(url, headers);
  return status;
}

function ghGet(pathname) {
  return httpsGetJson(`${REPO_URL}${pathname}`, { Accept: 'application/vnd.github+json' });
}

// ── 版本比较（x.y.z[-prerelease]）───────────────────────────────────────────

function parseVersion(v) {
  const [core, pre] = String(v).split('-');
  return { nums: core.split('.').map(Number), pre: pre ? pre.split('.') : [] };
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const x = pa.nums[i] || 0;
    const y = pb.nums[i] || 0;
    if (x !== y) return x - y;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// ── 项目内事实读取 ───────────────────────────────────────────────────────────

function readPackageJson() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
}

function getBaselineVersion(pkg) {
  return pkg.dependencies['@deepseek-ai/dsh'];
}

// 从 boot.ts + forge-patch.yml 提取 roster 引用的官方基础包名（去子路径）
function extractRosterPackages() {
  const set = new Set();
  const re = /name:\s*'(@deepseek-ai\/[^']+)'/g;
  for (const file of [BOOT_TS, PATCH_YML]) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      set.add(m[1].split('/').slice(0, 2).join('/'));
    }
  }
  return [...set].sort();
}

// ── npm registry ────────────────────────────────────────────────────────────

async function getDistTags(pkg) {
  return httpsGetJson(`${REGISTRY}/-/package/${encodeURIComponent(pkg)}/dist-tags`);
}

async function packageExistsAt(pkg, version) {
  const status = await httpsGetStatus(`${REGISTRY}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`);
  return status === 200;
}

async function packageExistsAny(pkg) {
  const status = await httpsGetStatus(`${REGISTRY}/${encodeURIComponent(pkg)}`);
  return status === 200;
}

// ── GitHub 上游快照 ──────────────────────────────────────────────────────────

async function tagToSha(tag) {
  const ref = await ghGet(`/git/refs/tags/${encodeURIComponent(tag)}`);
  let sha = ref.object.sha;
  if (ref.object.type === 'tag') {
    const tagObj = await ghGet(`/git/tags/${sha}`);
    sha = tagObj.object.sha;
  }
  return sha;
}

async function getTree(sha) {
  const t = await ghGet(`/git/trees/${sha}?recursive=1`);
  return t.tree;
}

function treeToMap(tree) {
  const m = new Map();
  for (const e of tree) {
    if (e.type === 'blob') m.set(e.path, e.sha);
  }
  return m;
}

async function getFileContent(tag, filePath) {
  const j = await ghGet(`/contents/${filePath}?ref=${encodeURIComponent(tag)}`);
  if (j.encoding === 'base64') return Buffer.from(j.content, 'base64').toString('utf8');
  return String(j.content ?? '');
}

// 官方 web-app cordis.patch.yml 引用的 @deepseek-ai 包集
async function getOfficialRosterPackages(tag) {
  const content = await getFileContent(tag, OFFICIAL_ROSTER);
  const re = /name:\s*['"]?(@deepseek-ai\/[^'",}\s]+)/g;
  const set = new Set();
  let m;
  while ((m = re.exec(content))) set.add(m[1].split('/').slice(0, 2).join('/'));
  return set;
}

// 上游 release 清单（版本权威源）：`dsh-v*` tag → 版本号，按版本降序
async function getUpstreamReleases(perPage = 30) {
  const list = await ghGet(`/releases?per_page=${perPage}`);
  return list
    .filter((r) => !r.draft && typeof r.tag_name === 'string' && r.tag_name.startsWith(RELEASE_TAG_PREFIX))
    .map((r) => ({
      version: r.tag_name.slice(RELEASE_TAG_PREFIX.length),
      url: r.html_url,
      publishedAt: r.published_at || r.created_at || '',
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

// 日期一律北京时间显示（台账同规则，避免 UTC 跨日）
function beijingStamp(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const date = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const time = d.toLocaleTimeString('sv-SE', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

// ── 评估 ─────────────────────────────────────────────────────────────────────

async function assess(version) {
  const pkg = readPackageJson();
  const baseline = getBaselineVersion(pkg);
  const currentTag = `dsh-v${baseline}`;
  const targetTag = `dsh-v${version}`;

  const result = {
    baseline,
    target: version,
    verdict: 'safe',
    reasons: [],
    watch: [],
    coupling: [],
    ui: [],
    rosterMissing: [],
    officialAdded: [],
    officialRemoved: [],
    rosterCount: 0,
  };

  // 1. roster 包存在性（blocked 判据）
  // 版本对齐包（package.json 中版本 === 基线）须在目标版本存在；
  // 独立版本包（cordis-plugin-* 等自持版本线）只须在 npm 存在。
  const pkgJson = readPackageJson();
  const aligned = new Set();
  for (const [name, ver] of Object.entries(pkgJson.dependencies)) {
    if (ver === baseline) aligned.add(name);
  }
  const roster = extractRosterPackages();
  result.rosterCount = roster.length;
  for (const p of roster) {
    const ok = aligned.has(p) ? await packageExistsAt(p, version) : await packageExistsAny(p);
    if (!ok) result.rosterMissing.push(p);
  }
  if (result.rosterMissing.length) {
    result.verdict = 'blocked';
    result.reasons.push(`roster 引用的 ${result.rosterMissing.length} 个官方包在 ${version} 不存在: ${result.rosterMissing.join(', ')}`);
  }

  // 2. 拴合面 + ui-* 契约 diff（review 判据）
  const currentSha = await tagToSha(currentTag);
  const targetSha = await tagToSha(targetTag);
  const cur = treeToMap(await getTree(currentSha));
  const tgt = treeToMap(await getTree(targetSha));

  for (const [name, files] of Object.entries(COUPLING_SURFACES)) {
    const changed = files.filter((f) => cur.get(f) !== tgt.get(f));
    if (changed.length) {
      result.coupling.push({ name, changed });
      result.reasons.push(`拴合面「${name}」有差异: ${changed.join(', ')}`);
    }
  }

  for (const dir of UI_CONTRACT_DIRS) {
    const prefix = `${dir}/`;
    const curFiles = [...cur.keys()].filter((p) => p.startsWith(prefix));
    const tgtFiles = [...tgt.keys()].filter((p) => p.startsWith(prefix));
    const added = tgtFiles.filter((p) => !cur.has(p));
    const removed = curFiles.filter((p) => !tgt.has(p));
    const modified = tgtFiles.filter((p) => cur.has(p) && cur.get(p) !== tgt.get(p));
    if (added.length || removed.length || modified.length) {
      result.ui.push({ dir, added, removed, modified });
      result.reasons.push(`ui-* 契约「${dir}」有差异（+${added.length}/-${removed.length}/~${modified.length}）`);
    }
  }

  // 3. 官方 web-app roster 包集 diff（watch 判据）
  const curOfficial = await getOfficialRosterPackages(currentTag);
  const tgtOfficial = await getOfficialRosterPackages(targetTag);
  result.officialAdded = [...tgtOfficial].filter((p) => !curOfficial.has(p)).sort();
  result.officialRemoved = [...curOfficial].filter((p) => !tgtOfficial.has(p)).sort();
  if (result.officialAdded.length) {
    result.watch.push(`官方 web-app roster 新增包: ${result.officialAdded.join(', ')}（桌面 roster 未自动追加，需人工判断是否装载）`);
  }
  if (result.officialRemoved.length) {
    result.watch.push(`官方 web-app roster 移除包: ${result.officialRemoved.join(', ')}（桌面若引用需同步移除）`);
  }

  if (result.verdict === 'safe' && (result.coupling.length || result.ui.length)) {
    result.verdict = 'review';
  }

  return result;
}

function printAssessment(a) {
  console.log(`\n── 评估结果 ──────────────────────────────`);
  console.log(`基线: ${a.baseline}  →  目标: ${a.target}`);
  console.log(`判定: ${a.verdict.toUpperCase()}`);
  if (a.reasons.length) {
    console.log(`原因:`);
    for (const r of a.reasons) console.log(`  - ${r}`);
  }
  if (a.coupling.length) {
    console.log(`拴合面差异:`);
    for (const c of a.coupling) console.log(`  - ${c.name}: ${c.changed.join(', ')}`);
  } else {
    console.log(`拴合面差异: 无（S1/S2/S3/S3b 零差异）`);
  }
  if (a.ui.length) {
    console.log(`ui-* 契约差异:`);
    for (const u of a.ui) {
      console.log(`  - ${u.dir}`);
      if (u.added.length) console.log(`      + ${u.added.join(', ')}`);
      if (u.removed.length) console.log(`      - ${u.removed.join(', ')}`);
      if (u.modified.length) console.log(`      ~ ${u.modified.join(', ')}`);
    }
  } else {
    console.log(`ui-* 契约差异: 无`);
  }
  console.log(`roster 包存在性: ${a.rosterMissing.length ? `缺失 ${a.rosterMissing.join(', ')}` : `${a.rosterCount} 包全部存在`}`);
  console.log(`官方 roster 包集: 新增 ${a.officialAdded.length} / 移除 ${a.officialRemoved.length}`);
  if (a.watch.length) {
    console.log(`关注项:`);
    for (const w of a.watch) console.log(`  - ${w}`);
  }
  console.log(`──────────────────────────────────────────`);
}

// ── check ───────────────────────────────────────────────────────────────────

/**
 * 新版判定以 GitHub releases 为权威源，npm 只作「是否可发行可装」校验。
 * 返回 { newer, best, pending }：
 *   best    = 最新的「GitHub 已发布 + npm 已发行」可安装候选
 *   pending = 上游已 release 但 npm 未发行（不可装 → 只报告不升级）
 */
async function cmdCheck() {
  const pkg = readPackageJson();
  const baseline = getBaselineVersion(pkg);
  console.log(`[dsh-upstream] 当前基线: ${baseline}`);
  console.log(`[dsh-upstream] 权威源: GitHub releases（${REPO}）；npm 仅判「是否可安装」`);

  const releases = await getUpstreamReleases();
  const newer = releases.filter((r) => compareVersions(r.version, baseline) > 0);
  if (!newer.length) {
    console.log(`[dsh-upstream] 结论: 无新版本（GitHub 最新 ${releases[0] ? releases[0].version : '未知'} ≤ 基线 ${baseline}）`);
    return { newer: false };
  }

  for (const p of TRACKED_PACKAGES) {
    const t = await getDistTags(p);
    console.log(`  ${p.padEnd(34)} alpha=${t.alpha ?? '-'}  latest=${t.latest ?? '-'}  next=${t.next ?? '-'}（npm 发行参考）`);
  }
  console.log(`[dsh-upstream] 上游已发布、新于基线的版本:`);
  const status = [];
  for (const r of newer) {
    const onNpm = await packageExistsAt('@deepseek-ai/dsh', r.version);
    status.push({ ...r, onNpm });
    console.log(`  - ${r.version.padEnd(18)} ${beijingStamp(r.publishedAt)} 北京时间  npm ${onNpm ? '已发行 ✓' : '未发行 ✗（不可安装）'}`);
  }

  const installable = status.find((s) => s.onNpm);
  if (!installable) {
    console.log(`[dsh-upstream] 结论: pending —— 上游已发布 ${status[0].version}，npm 尚未发行，不升级、不改任何文件`);
    console.log(`  release notes: ${status[0].url}`);
    console.log(`  待 npm 发行后重跑: node scripts/upstream.cjs auto`);
    return { newer: true, best: null, pending: status[0].version };
  }
  console.log(`[dsh-upstream] 结论: 有新版本 ${installable.version}（npm 可安装）→ 评估: node scripts/upstream.cjs assess ${installable.version}`);
  return { newer: true, best: installable.version };
}

// ── upgrade ─────────────────────────────────────────────────────────────────

function run(cmd, args) {
  console.log(`[run] ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', cwd: ROOT });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 失败（exit ${r.status}）`);
  }
}

function bumpPackageJson(version) {
  const pkg = readPackageJson();
  const baseline = getBaselineVersion(pkg);
  let changed = 0;
  for (const [name, ver] of Object.entries(pkg.dependencies)) {
    if (ver === baseline) {
      pkg.dependencies[name] = version;
      changed++;
    }
  }
  fs.writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`);
  return changed;
}

// 台账日期一律取北京时间（避免 toISOString 的 UTC 截断导致跨日少一天）
function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function nextMigrationSection() {
  const text = fs.readFileSync(MIGRATIONS_DOC, 'utf8');
  const re = /### C-(\d+)/g;
  let max = 0;
  let m;
  while ((m = re.exec(text))) max = Math.max(max, Number(m[1]));
  return max + 1;
}

function appendMigrationDoc(a) {
  const n = nextMigrationSection();
  const today = todayStr();
  const couplingRows = Object.keys(COUPLING_SURFACES).map((name) => {
    const hit = a.coupling.find((c) => c.name === name);
    const detail = hit ? `有差异（${hit.changed.join(', ')}）` : '零差异';
    const risk = hit ? '🟡 中（需人工核对）' : '🟢 低';
    return `| ${name} | ${detail} | ${hit ? '待适配' : '无'} | ${risk} |`;
  });
  const uiRow = a.ui.length
    ? `| ui-* 槽位契约 | 有差异（${a.ui.map((u) => u.dir).join('; ')}） | 待适配 | 🟡 中 |`
    : '| ui-* 槽位契约 | 零差异 | 无 | 🟢 低 |';
  const rosterRow = a.rosterMissing.length
    ? `| roster 包存在性（${a.rosterCount} 包） | 缺失 ${a.rosterMissing.join(', ')} | 阻断 | 🔴 高 |`
    : `| roster 包存在性（${a.rosterCount} 包） | 全部存在 | 无 | 🟢 低 |`;
  const officialRow = a.officialAdded.length || a.officialRemoved.length
    ? `| 官方 web-app roster 包集 | 新增 ${a.officialAdded.join(', ')} / 移除 ${a.officialRemoved.join(', ')} | 关注 | 🟡 中 |`
    : '| 官方 web-app roster 包集 | 无新增/删除 | 无 | 🟢 低 |';

  const section = `
### C-${n} 升级核查：\`${a.baseline}\` → \`${a.target}\`（${today} ${a.verdict === 'safe' ? '自动执行 · 无破坏性变更' : '自动工具评估'}）

> **结论：${a.verdict === 'safe' ? '桌面零适配直接升级' : `判定 ${a.verdict}，未自动升级`}**（\`scripts/upstream.cjs\` 自动评估）。${a.reasons.length ? `原因：${a.reasons.join('；')}。` : ''}${a.watch.length ? `关注项：${a.watch.join('；')}。` : ''}

| 拴合面 | ${a.baseline} → ${a.target} diff 结论 | 桌面影响 | 迁移风险 |
| --- | --- | --- | --- |
${couplingRows.join('\n')}
${uiRow}
${rosterRow}
${officialRow}

**验证记录（${today}）**：${a.verdict === 'safe' ? '`npm install` 成功；`npm run typecheck` 零错误；`npm run lint` 零告警；`npm run build` 成功。' : '未执行升级验证。'}
`;
  // 追加前规范空行：原文件若不以空行结尾，标题会被 Markdown 吞进上一节的列表
  const raw = fs.readFileSync(MIGRATIONS_DOC, 'utf8');
  const sep = raw.endsWith('\n\n') ? '' : raw.endsWith('\n') ? '\n' : '\n\n';
  fs.appendFileSync(MIGRATIONS_DOC, `${sep}${section.trimStart()}\n`);
  return n;
}

async function cmdUpgrade(version, opts) {
  const pkg = readPackageJson();
  const baseline = getBaselineVersion(pkg);
  if (compareVersions(version, baseline) <= 0) {
    console.error(`[ABORT] ${version} 不新于当前基线 ${baseline}`);
    process.exit(1);
  }

  // 发行前置校验：GitHub release 会先于 npm 出现，未发行则装了必失败
  if (!(await packageExistsAt('@deepseek-ai/dsh', version))) {
    console.error(`[ABORT] ${version} 在 npm 尚未发行（GitHub 已 release）→ 不可安装，待发行后重跑 auto。`);
    process.exit(1);
  }

  console.log(`[dsh-upstream] 评估 ${baseline} → ${version}`);
  const a = await assess(version);
  printAssessment(a);

  if (a.verdict !== 'safe') {
    console.error(`[ABORT] 判定 ${a.verdict}，不自动升级。请人工对照 diff 适配后手动升级（build(upstream) SOP）。`);
    process.exit(1);
  }

  if (opts['dry-run']) {
    console.log(`[DRY-RUN] 将执行：bump ${baseline}→${version}（${Object.keys(pkg.dependencies).filter((n) => pkg.dependencies[n] === baseline).length} 个依赖）+ npm install + typecheck/lint/build + 迁移登记 C-${nextMigrationSection()}`);
    return;
  }

  // 工作区脏检查（仅提示）
  const st = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const dirty = (st.stdout || '').trim().split('\n').filter(Boolean);
  if (dirty.length) {
    console.log(`[WARN] git 工作区非干净（${dirty.length} 项），升级产物将与现有改动混在一起，提交时请按文件区分。`);
  }

  const changed = bumpPackageJson(version);
  console.log(`[OK] package.json 已更新 ${changed} 个依赖 → ${version}`);

  run('npm', ['install']);
  run('npm', ['run', 'typecheck']);
  run('npm', ['run', 'lint']);
  run('npm', ['run', 'build']);

  const n = appendMigrationDoc(a);
  console.log(`[OK] 迁移登记 docs/upstream-migrations.md 已追加 C-${n}`);

  // 脚本只落迁移登记表，规则链台账需按 workflow.md 场景 D 人工同步（易漏项，显式提醒）
  console.log(`\n[TODO] 台账待人工同步（脚本不改这些文件）:`);
  console.log(`  - docs/upstream-migrations.md 表头「基线版本」`);
  console.log(`  - docs/upstream-contracts.md 标题 + 复核标注行`);
  console.log(`  - docs/12-references.md 版本时点`);
  console.log(`  - .trae/rules/active-context.md（M4-d 标题 + 新升级条目 + D-4）+ docs/active-context.html 对应四处`);

  const commitCmd = `git add package.json package-lock.json docs/upstream-migrations.md && git commit -m "build(upstream): 基线升至 ${version}（自动工具判定 safe）"`;
  console.log(`\n[OK] 升级完成。建议提交:`);
  console.log(`  ${commitCmd}`);
  if (opts.commit) {
    run('git', ['add', 'package.json', 'package-lock.json', 'docs/upstream-migrations.md']);
    run('git', ['commit', '-m', `build(upstream): 基线升至 ${version}（自动工具判定 safe）`]);
    console.log('[OK] 已自动创建 commit');
  }
}

// ── auto ────────────────────────────────────────────────────────────────────

async function cmdAuto(opts) {
  const { newer, best, pending } = await cmdCheck();
  if (!newer) return;
  if (!best) {
    console.log(`[dsh-upstream] auto 停止：GitHub 已发布 ${pending} 但 npm 未发行 → 不改文件、不登记台账，转人工关注。`);
    return;
  }
  if (opts['dry-run']) {
    console.log(`[DRY-RUN] 将评估并升级 ${best}`);
    return;
  }
  await cmdUpgrade(best, opts);
}

// ── 入口 ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rest = args.slice(1);
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
      opts[key] = val;
    } else {
      positional.push(a);
    }
  }

  try {
    if (cmd === 'check') {
      await cmdCheck();
    } else if (cmd === 'assess') {
      const version = positional[0];
      if (!version) throw new Error('assess 需要 <version> 参数');
      printAssessment(await assess(version));
    } else if (cmd === 'upgrade') {
      const version = positional[0];
      if (!version) throw new Error('upgrade 需要 <version> 参数');
      await cmdUpgrade(version, opts);
    } else if (cmd === 'auto') {
      await cmdAuto(opts);
    } else {
      console.log(`用法:
  node scripts/upstream.cjs check
  node scripts/upstream.cjs assess <version>
  node scripts/upstream.cjs upgrade <version> [--dry-run] [--commit]
  node scripts/upstream.cjs auto [--dry-run] [--commit]`);
      process.exit(cmd ? 1 : 0);
    }
  } catch (e) {
    console.error(`[ERR] ${e.message}`);
    process.exit(1);
  }
}

main();
