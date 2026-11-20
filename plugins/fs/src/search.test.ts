// @vitest-environment node
// plugin-fs glob / grep 单测（D-065）：跳目录规则、mtime 排序、大括号展开、三种 output_mode、
// 大小写、include 过滤、二进制与大文件跳过、非法 regex。tmpdir 夹具。

import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FsGate } from "@henira/protocol";
import { describe, expect, it, vi } from "vitest";
import { createFence } from "./fence.js";
import { createSearch, globToRegExp } from "./search.js";

function gate(): FsGate {
  return {
    tool: "glob",
    args: {},
    requestPermission: vi.fn(async () => "allowed-once" as never),
  };
}

async function tmpTree(): Promise<string> {
  const base = await fsp.mkdtemp(path.join(tmpdir(), "henira-search-test-"));
  await fsp.mkdir(path.join(base, "src"), { recursive: true });
  await fsp.mkdir(path.join(base, "node_modules", "pkg"), { recursive: true });
  await fsp.mkdir(path.join(base, ".git"), { recursive: true });
  await fsp.writeFile(path.join(base, "src", "a.ts"), "const a = 1;\n// hello\n", "utf8");
  await fsp.writeFile(path.join(base, "src", "b.md"), "# hello doc\n", "utf8");
  await fsp.writeFile(path.join(base, "root.ts"), "export const root = true;\n", "utf8");
  await fsp.writeFile(
    path.join(base, "node_modules", "pkg", "x.ts"),
    "const hidden = 1;\n",
    "utf8",
  );
  await fsp.writeFile(path.join(base, ".git", "y.ts"), "const git = 1;\n", "utf8");
  return base;
}

describe("globToRegExp", () => {
  it("** 跨段、* 段内、? 单字符、{a,b} 展开、字面量转义", () => {
    expect(globToRegExp("src/**/*.ts").test("src/lib/x.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/x.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/lib/x.ts")).toBe(false);
    expect(globToRegExp("?.md").test("a.md")).toBe(true);
    expect(globToRegExp("?.md").test("ab.md")).toBe(false);
    const brace = globToRegExp("{a,b}1.txt");
    expect(brace.test("a1.txt")).toBe(true);
    expect(brace.test("b1.txt")).toBe(true);
    expect(brace.test("c1.txt")).toBe(false);
    expect(globToRegExp("a+b.ts").test("a+b.ts")).toBe(true);
  });
});

describe("glob", () => {
  it("命中 + 跳 .git/.hg/.svn/node_modules + 绝对路径 + 空态", async () => {
    const base = await tmpTree();
    const search = createSearch({ fence: createFence(base) });
    const r = await search.glob("**/*.ts", gate());
    const names = r.files.map((f) => path.relative(base, f).replaceAll("\\", "/"));
    expect(names).toContain("src/a.ts");
    expect(names).toContain("root.ts");
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    expect(names.some((n) => n.startsWith(".git"))).toBe(false);
    expect(path.isAbsolute(r.files[0] ?? "")).toBe(true);
    expect(await search.glob("nope-*.zzz", gate())).toMatchObject({ files: [], total: 0 });
  });

  it("mtime 降序（新→旧）与 total 截断事实；path 参数换根；区外 base 走 floor ask", async () => {
    const base = await tmpTree();
    const search = createSearch({ fence: createFence(base) });
    // 把 root.ts 的 mtime 拨到未来 → 应排最前
    await fsp.utimes(path.join(base, "root.ts"), new Date(), new Date(Date.now() + 60_000));
    const r = await search.glob("**/*.ts", gate());
    expect(r.files[0]?.endsWith("root.ts")).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(2);

    const srcOnly = await search.glob("*.ts", gate(), { path: "src" });
    expect(srcOnly.files).toHaveLength(1);

    // glob 的 path 语义是基目录：指向文件直接报错（grep 才收单文件）
    await expect(search.glob("*.ts", gate(), { path: "root.ts" })).rejects.toThrow(
      /must be a directory/,
    );

    const outside = await fsp.mkdtemp(path.join(tmpdir(), "henira-search-out-"));
    const g = gate();
    await search.glob("**/*", g, { path: outside });
    expect(g.requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("grep", () => {
  it("默认 files_with_matches；content 模式行号；count 模式；totalSeen 截断事实", async () => {
    const base = await tmpTree();
    const search = createSearch({ fence: createFence(base) });

    const files = await search.grep("hello", gate());
    expect(files.totalSeen).toBe(2);
    expect(files.files?.map((f) => path.relative(base, f).replaceAll("\\", "/")).sort()).toEqual([
      "src/a.ts",
      "src/b.md",
    ]);

    const content = await search.grep("hello", gate(), { outputMode: "content" });
    expect(content.matches).toHaveLength(2);
    const a = content.matches.find((m) => m.file.endsWith("a.ts"));
    expect(a).toMatchObject({ line: 2, text: "// hello" });

    const count = await search.grep("const", gate(), { outputMode: "count" });
    expect(count.counts?.length).toBeGreaterThanOrEqual(2);
    const sum = (count.counts ?? []).reduce((s, c) => s + c.count, 0);
    expect(sum).toBe(count.totalSeen);
  });

  it("-i 大小写、include 过滤、head_limit 截断、非法 regex", async () => {
    const base = await tmpTree();
    const search = createSearch({ fence: createFence(base) });

    const ci = await search.grep("HELLO", gate(), { outputMode: "content", ignoreCase: true });
    expect(ci.matches).toHaveLength(2);

    const tsOnly = await search.grep("hello", gate(), { include: "*.ts" });
    expect(tsOnly.files).toHaveLength(1);

    const limited = await search.grep("hello", gate(), { outputMode: "content", headLimit: 1 });
    expect(limited.matches).toHaveLength(1);
    expect(limited.totalSeen).toBe(2);

    await expect(search.grep("([unclosed", gate())).rejects.toThrow(/Invalid regex/);
  });

  it("path 指向单文件：只扫该文件（include 按 basename 判）；totalFiles 反映文件数", async () => {
    const base = await tmpTree();
    const search = createSearch({ fence: createFence(base) });

    const single = await search.grep("hello", gate(), { path: "src/a.ts" });
    expect(single.totalFiles).toBe(1);
    expect(single.totalSeen).toBe(1);
    expect(single.files?.[0]?.endsWith("a.ts")).toBe(true);

    const filtered = await search.grep("hello", gate(), { path: "src/a.ts", include: "*.md" });
    expect(filtered.totalSeen).toBe(0);
    expect(filtered.totalFiles).toBe(0);

    await expect(search.grep("x", gate(), { path: "no-such-file.ts" })).rejects.toThrow(
      /does not exist/,
    );
  });

  it("跳二进制文件；二进制探测窗口内含 NUL 即不产出", async () => {
    const base = await tmpTree();
    await fsp.writeFile(path.join(base, "blob.ts"), Buffer.from([0x41, 0x00, 0x42]));
    const search = createSearch({ fence: createFence(base) });
    const r = await search.grep(".", gate(), { outputMode: "content" });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => !m.file.endsWith("blob.ts"))).toBe(true);
  });
});
