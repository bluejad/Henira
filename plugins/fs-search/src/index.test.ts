// @vitest-environment node
// plugin-fs-search 格式化层单测（D-065）：三模式渲染 + 截断注记判据分开——files 模式按
// **文件数**（totalFiles）、count / content 按命中行数（totalSeen）。审查抓到的「1 文件 3 行命中
// → 假 Truncated 注记」（totalSeen 当文件数）在本文件回归锁。

import type { FsGrepResult } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { formatGrepResult } from "./index.js";

const result = (over: Partial<FsGrepResult>): FsGrepResult => ({
  matches: [],
  totalSeen: 0,
  ...over,
});

const strip = (f: string): string => f.replace("/ws/", "");

describe("formatGrepResult", () => {
  it("files 模式：1 文件多行命中不打截断注记（回归）+ 单复数", () => {
    const out = formatGrepResult(result({ files: ["/ws/a.txt"], totalSeen: 3, totalFiles: 1 }), {
      outputMode: "files_with_matches",
    });
    expect(out).toBe("Found 1 file\n/ws/a.txt");
    expect(out).not.toContain("Truncated");

    const two = formatGrepResult(
      result({ files: ["/ws/a.txt", "/ws/b.txt"], totalSeen: 5, totalFiles: 2 }),
      { outputMode: "files_with_matches" },
      strip,
    );
    expect(two).toBe("Found 2 files\na.txt\nb.txt");
  });

  it("files 模式：真截断注记按文件数（不拿命中行数冒充文件数）", () => {
    const out = formatGrepResult(result({ files: ["/ws/a.txt"], totalSeen: 9, totalFiles: 3 }), {
      outputMode: "files_with_matches",
      headLimit: 1,
    });
    expect(out).toContain("Found 1 file");
    expect(out).toContain("Truncated at head_limit=1; 3 matching files in total");
    expect(out).not.toContain("9");
  });

  it("count 模式：每文件计数 / 总行数与单复数 / 截断注记按命中行数", () => {
    const full = formatGrepResult(
      result({
        counts: [{ file: "/ws/a.txt", count: 2 }],
        totalSeen: 2,
        totalFiles: 1,
      }),
      { outputMode: "count" },
      strip,
    );
    expect(full).toContain("a.txt:2");
    expect(full).toContain("Found 2 total matching lines across 1 file.");

    const truncated = formatGrepResult(
      result({ counts: [{ file: "/ws/a.txt", count: 2 }], totalSeen: 5, totalFiles: 3 }),
      { outputMode: "count", headLimit: 1 },
      strip,
    );
    expect(truncated).toContain("5 matching lines seen in total");
  });

  it("content 模式：path:line:text、截断尾注、空态", () => {
    const out = formatGrepResult(
      result({
        matches: [{ file: "/ws/a.ts", line: 2, text: "// hello" }],
        totalSeen: 2,
      }),
      { outputMode: "content", headLimit: 1 },
      strip,
    );
    expect(out).toContain("a.ts:2:// hello");
    expect(out).toContain("2 matching lines seen in total");

    expect(formatGrepResult(result({ totalSeen: 0 }), { outputMode: "content" })).toBe(
      "No matches found",
    );
    expect(
      formatGrepResult(result({ totalSeen: 0, files: [], totalFiles: 0 }), {
        outputMode: "files_with_matches",
      }),
    ).toBe("No matches found");
  });

  it("content 模式：上下文行（match:false）用 `-` 分隔；-n:false 省略行号", () => {
    const r: FsGrepResult = {
      matches: [
        { file: "/ws/a.ts", line: 1, text: "before", match: false },
        { file: "/ws/a.ts", line: 2, text: "hit", match: true },
        { file: "/ws/a.ts", line: 3, text: "after", match: false },
      ],
      totalSeen: 1,
    };
    const out = formatGrepResult(r, { outputMode: "content" }, strip);
    expect(out).toContain("a.ts-1-before");
    expect(out).toContain("a.ts:2:hit");
    expect(out).toContain("a.ts-3-after");

    const noLine = formatGrepResult(r, { outputMode: "content", lineNumbers: false }, strip);
    expect(noLine).toContain("a.ts-before");
    expect(noLine).toContain("a.ts:hit");
    expect(noLine).not.toContain("a.ts:2:");
  });
});
