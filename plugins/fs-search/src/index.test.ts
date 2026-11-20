// @vitest-environment node
// plugin-fs-search 格式化层单测（D-065）：三模式渲染 + 截断注记判据分开——files 模式按
// **文件数**（totalFiles）、count / content 按命中行数（totalSeen）。审查抓到的「1 文件 3 行命中
// → 假 Truncated 注记」（totalSeen 当文件数）在本文件回归锁。E5 追加：execute __meta 装配级
// 断言（搜索卡数据源——结构化 matches/文件数进带外通道，content 一字不改）。

import { createHarness } from "@henira/kernel";
import type {
  FsGrepResult,
  FsService,
  ToolContext,
  ToolDefinition,
  ToolsService,
} from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { formatGrepResult, fsSearchPlugin } from "./index.js";

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

describe("glob/grep execute __meta（搜索卡数据源，E5）", () => {
  const toolCtx: ToolContext = {
    signal: new AbortController().signal,
    requestPermission: async () => "allowed-once" as never,
    cwd: "/ws",
    config: { cwd: "/ws" } as never,
  };

  async function toolsWithFs(fs: FsService): Promise<Map<string, ToolDefinition>> {
    const registered = new Map<string, ToolDefinition>();
    const tools: ToolsService = {
      register: (tool) => {
        registered.set(tool.name, tool);
        return () => {};
      },
      project: () => [],
      isConcurrencySafe: () => undefined,
      execute: async () => {
        throw new Error("fake registry");
      },
      run: async () => [],
    };
    const harness = createHarness()
      .use({ name: "config", start: () => ({ cwd: "/ws" }) as never })
      .use({ name: "tools", start: () => tools })
      .use({ name: "fs", start: () => fs })
      .use(fsSearchPlugin());
    await harness.start();
    return registered;
  }

  it("glob：files（显示路径）+total 进 meta", async () => {
    const glob = (
      await toolsWithFs({
        resolve: (p) => ({ absolute: p, inside: true }),
        read: async () => null as never,
        write: async () => null as never,
        edit: async () => null as never,
        glob: async () => ({ files: ["/ws/a.txt", "/ws/b.txt"], total: 2 }),
        grep: async () => null as never,
      })
    ).get("glob");
    if (glob === undefined) throw new Error("glob not registered");
    const r = await glob.execute({ pattern: "*.txt" }, toolCtx);
    expect(r.__meta).toMatchObject({ kind: "glob", files: ["a.txt", "b.txt"], total: 2 });
    expect(r.content).toBe("a.txt\nb.txt");
  });

  it("grep content 模式：结构化 matches（显示路径+match 位）进 meta", async () => {
    const grep = (
      await toolsWithFs({
        resolve: (p) => ({ absolute: p, inside: true }),
        read: async () => null as never,
        write: async () => null as never,
        edit: async () => null as never,
        glob: async () => null as never,
        grep: async () => ({
          matches: [
            { file: "/ws/a.ts", line: 1, text: "before", match: false },
            { file: "/ws/a.ts", line: 2, text: "hit", match: true },
          ],
          totalSeen: 1,
        }),
      })
    ).get("grep");
    if (grep === undefined) throw new Error("grep not registered");
    const r = await grep.execute({ pattern: "hit", output_mode: "content" }, toolCtx);
    expect(r.__meta).toMatchObject({
      kind: "grep",
      mode: "content",
      totalSeen: 1,
      headLimit: 250,
      matches: [
        { file: "a.ts", line: 1, text: "before", match: false },
        { file: "a.ts", line: 2, text: "hit", match: true },
      ],
    });
    expect(r.content).toContain("a.ts:2:hit");
  });
});
