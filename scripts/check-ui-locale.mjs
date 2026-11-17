#!/usr/bin/env node
// 判据⑥机械闸（D-050 / roadmap M3）：界面源码**代码**零裸文案——用户可见中文只许出现在
// plugins/web-ui/src/locales/ 字典文件。扫描 packages/web/src 与 plugins/web-ui/src 的
// .ts/.tsx（排除 locales/ 与 *.test.*），剥离注释后命中 CJK 即红（注释是维护者文档，
// 不属于"用户可见文案"——D-050 管的是界面呈现给用户的字）。
// 引擎消息英文不受此闸约束（D-050 第 2 款）；纯符号（✕ 等）非语言文字不在扫描范围。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages/web/src", "plugins/web-ui/src"];
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const SOURCE = /\.(ts|tsx)$/;

const failures = [];

/** 剥离一行中的注释（块注释状态跨行）；粗粒度但保守——字符串含 "//" 会多剥，只会更严不会漏 */
function stripComments(line, state) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (state.inBlock) {
      const end = line.indexOf("*/", i);
      if (end === -1) return out;
      i = end + 2;
      state.inBlock = false;
      continue;
    }
    if (line[i] === "/" && line[i + 1] === "*") {
      state.inBlock = true;
      i += 2;
      continue;
    }
    if (line[i] === "/" && line[i + 1] === "/") return out;
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      out += line[i];
      i += 1;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === "\\") i += 1; // 跳过转义
        out += line[i] ?? "";
        i += 1;
      }
      out += line[i] ?? "";
      i += 1;
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "locales") continue; // 字典文件是唯一 CJK 允许地
      scan(full);
      continue;
    }
    if (!SOURCE.test(entry)) continue;
    if (entry.includes(".test.")) continue; // 测试里造中文输入数据是数据不是文案
    const state = { inBlock: false };
    const lines = readFileSync(full, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (CJK.test(stripComments(lines[i], state))) {
        failures.push(
          `${full}:${i + 1} 代码含 CJK 字符（用户可见文案必须经 locale 字典取字，D-050）`,
        );
      }
    }
  }
}

for (const root of ROOTS) scan(root);

if (failures.length > 0) {
  console.error("界面 locale 闸未通过：");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`界面 locale 闸通过（代码零裸文案；扫描 ${ROOTS.join(" + ")}）。`);
