#!/usr/bin/env node
// 文档闸门（D-052；CI 同跑）：
// 规则 1：每个 workspace 包目录必须有 README.md——随包诞生，npm 硬要求只是下限。
// 规则 2：src 里声明的每个工具必须有同名 tools/<名字>.md（一工具一 md，
//         AGENTS.md 文档粒度表）。识别口径 = 非测试 src 文件中 inputSchema 出现行
//         邻域（±3 行）内的 name: "<id>" 字面量——工具对象的 name 与 inputSchema
//         相邻，ServiceDefinition 的槽位名远离 inputSchema，借邻域滤掉假亲；
//         闸门是兜底不是穷举，新形状照旧随包写 md。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages", "plugins", "examples"];
const TOOL_NAME_RE = /name:\s*"([a-z][a-z0-9_-]*)"/g;
const NEIGHBORHOOD = 3; // inputSchema 出现行的上下各 3 行

function declaredTools(packageDir) {
  const src = join(packageDir, "src");
  if (!existsSync(src)) return new Set();
  const names = new Set();
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(full);
      }
    }
  })(src);
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes("inputSchema")) continue;
      const from = Math.max(0, i - NEIGHBORHOOD);
      const window = lines.slice(from, i + NEIGHBORHOOD + 1).join("\n");
      for (const m of window.matchAll(TOOL_NAME_RE)) names.add(m[1]);
    }
  }
  return names;
}

const failures = [];
let packages = 0;
for (const root of ROOTS) {
  const dir = join(process.cwd(), root);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(dir, entry.name);
    if (!existsSync(join(packageDir, "package.json"))) continue;
    packages += 1;
    if (!existsSync(join(packageDir, "README.md"))) {
      failures.push(`${root}/${entry.name}: 缺 README.md（D-052：包 README 随包诞生）`);
    }
    for (const name of declaredTools(packageDir)) {
      if (!existsSync(join(packageDir, "tools", `${name}.md`))) {
        failures.push(
          `${root}/${entry.name}: 工具 ${name} 缺 tools/${name}.md（一工具一 md，D-052）`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("文档闸门未通过：");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`文档闸门通过（扫描 ${packages} 个包）。`);
