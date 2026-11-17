// data-directory §4 项目 key 命名（--<slug60>-<hash8>--，平台感知：Windows 小写化哈希；
// 目录名只给人看，查找不靠它——唯一性由 projects.json 的 id 保证）。两宿主共用一份，
// 规则 3（禁宿主互依）的正确解：共享知识下沉引擎层，不在 server/sdk 各自复制。

import { createHash } from "node:crypto";

export function projectKey(cwd: string): string {
  const canonical = cwd
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/[:*"<>|?]/g, "_");
  const slug =
    canonical
      .replace(/\//g, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || "root";
  const hashSource = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const hash8 = createHash("sha256").update(hashSource).digest("hex").slice(0, 8);
  return `--${slug}-${hash8}--`;
}
