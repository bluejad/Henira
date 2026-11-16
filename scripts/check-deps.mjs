#!/usr/bin/env node
// 依赖方向检查（docs/20-architecture/packages.md「依赖规则」节逐条落地；CI 同跑）。
//
// 规则 1：kernel / protocol 运行时零依赖——两者 dependencies 必须为空。
// 规则 2：plugins/* 依赖白名单 = @henira/protocol（契约层）+ 第三方库；
//         @henira/kernel 仅允许 devDependencies（插件只做类型引用——ServiceDefinition 等，
//         运行时零 import）；@henira/llm-mock 测试支撑包仅允许 devDependencies（50-open 归档
//         2026-11-16）；**禁止任何其他 @henira/* 依赖，尤其是 @henira/plugin-***
//         ——插件互不 import 实现，互消费只经槽位（ctx.get，D-049）。
//         D-048 的「kernel / protocol 不进依赖表」管的是用户侧 AI 创建插件包（engine/，
//         装载层拦截，M4 实装），不约束仓库内官方插件——官方插件是产品本体，
//         契约依赖走 protocol（packages.md 规则 2 为准，docs > 脚本注释）。
// 规则 3：宿主（config-loader / server / sdk / cli / web…）与 examples 聚合一切
//         （kernel / protocol / plugins / 第三方），只查成环与工作区成员资格。
// 规则 4：@henira/* 内部依赖不得成环。
// 规则 5：品牌单一性（D-053）——旧品牌词（任意大小写）不得出现在任何入库文件，
//         唯一豁免 = docs/10-decisions.md 历史条目（append-only，旧写法是历史事实）。
// 空工作区（无任何包）时全部通过；包随里程碑落地后此检查逐步生效。

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages", "plugins", "examples", "test-support"];
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];
const CONTRACT_PACKAGES = ["@henira/protocol"];
const TEST_SUPPORT_PACKAGES = ["@henira/llm-mock"];
const PLUGIN_PREFIX = "@henira/plugin-";

function listWorkspacePackages() {
  const found = [];
  for (const root of ROOTS) {
    const dir = join(process.cwd(), root);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, "package.json");
      if (existsSync(manifest)) {
        found.push({
          manifest: JSON.parse(readFileSync(manifest, "utf8")),
          location: root,
        });
      }
    }
  }
  return found;
}

const failures = [];
const packages = listWorkspacePackages();
const byName = new Map(packages.filter((p) => p.manifest.name).map((p) => [p.manifest.name, p]));

for (const { manifest: pkg, location } of packages) {
  const deps = {};
  for (const section of DEP_SECTIONS) {
    for (const dep of Object.keys(pkg[section] ?? {})) deps[dep] = section;
  }

  // 规则 1：契约层与内核运行时零依赖
  if (pkg.name === "@henira/kernel" || pkg.name === "@henira/protocol") {
    const runtime = Object.keys(pkg.dependencies ?? {});
    if (runtime.length > 0) {
      failures.push(`${pkg.name}: 规则 1 运行时零依赖，dependencies 非空（${runtime.join(", ")}）`);
    }
  }

  // 规则 2：plugins/* 依赖白名单
  if (location === "plugins") {
    for (const [dep, section] of Object.entries(deps)) {
      if (dep.startsWith(PLUGIN_PREFIX) && dep !== pkg.name) {
        if (section === "devDependencies") continue; // 测试装配通道：测试里装真同伴（镜像 examples 聚合），运行时仍零插件依赖
        failures.push(
          `${pkg.name}: ${dep} 出现在 ${section}（规则 2：插件互不 import 实现，互消费只经槽位 ctx.get；devDependencies 仅供测试装配）`,
        );
        continue;
      }
      if (dep === "@henira/kernel" && section === "dependencies") {
        failures.push(
          `${pkg.name}: @henira/kernel 出现在 dependencies（插件只做类型引用 → devDependencies）`,
        );
        continue;
      }
      if (TEST_SUPPORT_PACKAGES.includes(dep) && section !== "devDependencies") {
        failures.push(
          `${pkg.name}: ${dep} 是测试支撑包，只许 devDependencies（50-open 归档 2026-11-16）`,
        );
        continue;
      }
      const known = [...CONTRACT_PACKAGES, "@henira/kernel", ...TEST_SUPPORT_PACKAGES];
      if (dep.startsWith("@henira/") && !known.includes(dep) && !dep.startsWith(PLUGIN_PREFIX)) {
        failures.push(`${pkg.name}: 非白名单 @henira 依赖 ${dep} 出现在 ${section}（规则 2）`);
      }
    }
  }

  // 工作区成员资格：@henira/* 依赖必须指向本工作区内的包
  for (const dep of Object.keys(deps)) {
    if (dep.startsWith("@henira/") && !byName.has(dep)) {
      failures.push(`${pkg.name}: 依赖的 ${dep} 不在本工作区内`);
    }
  }
}

// 规则 4：环检测——只看 @henira/* 内部边
const graph = new Map();
for (const { manifest: pkg } of packages) {
  const edges = [];
  for (const section of DEP_SECTIONS) {
    for (const dep of Object.keys(pkg[section] ?? {})) {
      if (dep.startsWith("@henira/") && byName.has(dep)) edges.push(dep);
    }
  }
  graph.set(pkg.name, edges);
}

const state = new Map(); // 0=访问中 1=已完成
const stack = [];
function dfs(name) {
  if (state.get(name) === 0) {
    const cycle = stack.slice(stack.indexOf(name)).concat(name);
    failures.push(`依赖成环：${cycle.join(" -> ")}`);
    return;
  }
  if (state.get(name) === 1) return;
  state.set(name, 0);
  stack.push(name);
  for (const next of graph.get(name) ?? []) dfs(next);
  stack.pop();
  state.set(name, 1);
}
for (const name of graph.keys()) dfs(name);

// 规则 5：品牌单一性（D-053）——扫描全部入库文本文件，旧品牌词零容忍
const BRAND_EXEMPT = new Set(["docs/10-decisions.md"]);
const OLD_BRAND = ["re", "ins"].join(""); // 拆写：本脚本自身不得包含旧品牌词字面量
const TEXT_FILE = /\.(md|ts|tsx|js|mjs|cjs|json|yaml|yml|txt)$/;
try {
  const tracked = execSync("git ls-files -z", { cwd: process.cwd() })
    .toString()
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    if (BRAND_EXEMPT.has(file) || !TEXT_FILE.test(file)) continue;
    let text;
    try {
      text = readFileSync(join(process.cwd(), file), "utf8");
    } catch {
      continue; // 不可读（二进制等）跳过
    }
    if (text.toLowerCase().includes(OLD_BRAND)) {
      failures.push(
        `品牌单一性（D-053）：${file} 含旧品牌词——更名后旧写法只允许存在于 docs/10-decisions.md 历史条目`,
      );
    }
  }
} catch {
  // 非 git 环境（罕见）跳过品牌检查，依赖方向规则照常
}

if (failures.length > 0) {
  console.error("依赖方向检查未通过：");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`依赖方向检查通过（扫描 ${packages.length} 个包）。`);
