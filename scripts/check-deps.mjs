#!/usr/bin/env node
// 依赖方向检查（docs/20-architecture/packages.md 规则；D-048）。
// 规则一：plugins/* 与 examples/* 下的包，依赖表禁止出现 @reins/kernel 与 @reins/protocol
//         ——宿主经 import map 注入唯一实例，任何依赖段（dependencies / devDependencies / peerDependencies）都算违反。
// 规则二：@reins/* 内部依赖不得成环。
// 空工作区（无任何包）时全部通过；包随里程碑落地后此检查逐步生效。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages", "plugins", "examples"];
const KERNEL_SEAMS = ["@reins/kernel", "@reins/protocol"];
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];

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
          // 身份按位置定：plugins/ 与 examples/ 下的一律按插件纪律管
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

  if (location === "plugins" || location === "examples") {
    for (const banned of KERNEL_SEAMS) {
      if (deps[banned]) {
        failures.push(
          `${pkg.name}: ${banned} 出现在 ${deps[banned]}（D-048：宿主 import map 注入，不进依赖表）`,
        );
      }
    }
  }

  for (const dep of Object.keys(deps)) {
    if (dep.startsWith("@reins/") && !byName.has(dep)) {
      failures.push(`${pkg.name}: 依赖的 ${dep} 不在本工作区内`);
    }
  }
}

// 环检测：只看 @reins/* 内部边
const graph = new Map();
for (const { manifest: pkg } of packages) {
  const edges = [];
  for (const section of DEP_SECTIONS) {
    for (const dep of Object.keys(pkg[section] ?? {})) {
      if (dep.startsWith("@reins/") && byName.has(dep)) edges.push(dep);
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

if (failures.length > 0) {
  console.error("依赖方向检查未通过：");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`依赖方向检查通过（扫描 ${packages.length} 个包）。`);
