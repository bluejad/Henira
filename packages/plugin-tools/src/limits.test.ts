import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyExitLimits, DEFAULT_EXIT_LIMITS } from "./limits.js";

describe("applyExitLimits（统一出口限量 §1.1）", () => {
  it("限内原样返回", async () => {
    const out = await applyExitLimits("a\nb\nc");
    expect(out).toEqual({ content: "a\nb\nc" });
    expect(out.truncated).toBeUndefined();
  });

  it("超行数：保留头部 + 尾注可见（截断事实 + 行数字节）", async () => {
    const text = Array.from({ length: 3000 }, (_, i) => `L${i}`).join("\n");
    const out = await applyExitLimits(text, { maxLines: 2000, maxBytes: 1_000_000 });
    expect(out.content).toContain("[truncated]");
    expect(out.content).toContain("3000 行");
    expect(out.content.split("\n").length).toBe(2001); // 2000 行 + 尾注
    expect(out.content).toContain("L1999");
    expect(out.content).not.toContain("L2500");
  });

  it("超字节：无落盘目录 → 尾注明示未保留；truncated 缺省", async () => {
    const out = await applyExitLimits("x".repeat(60_000), DEFAULT_EXIT_LIMITS);
    expect(out.content).toContain("完整输出未保留");
    expect(out.truncated).toBeUndefined();
  });

  it("超字节 + 落盘目录：完整输出写盘，truncated = {path, preview}", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "reins-limits-"));
    const text = "y".repeat(60_000);
    const out = await applyExitLimits(text, DEFAULT_EXIT_LIMITS, {
      spillDir: dir,
      spillName: "c1.txt",
    });
    expect(out.truncated).toBeDefined();
    const spillPath = out.truncated?.path;
    expect(spillPath).toBe(path.join(dir, "c1.txt"));
    expect(out.truncated?.preview.length).toBeLessThanOrEqual(2000);
    const spilled = await fs.readFile(spillPath ?? "", "utf8");
    expect(spilled).toBe(text); // 完整原文落盘
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("UTF-8 边界：超字节单行 CJK 在码点收口（不切代理对、不留半个字符）", async () => {
    // 每个"汉"字 3 字节；预算 10 字节 = 3 个整字 + 1 字节余量 → 3 字整收
    const text = "汉".repeat(100);
    const out = await applyExitLimits(text, { maxLines: 100, maxBytes: 10 });
    const head = out.content.split("\n")[0];
    expect(head).toBe("汉".repeat(3));
    expect(Buffer.byteLength(head, "utf8")).toBeLessThanOrEqual(10);
    // 代理对（emoji U+1F600 = 4 字节 = 高低代理对）：预算 3 字节 → 整码点收口，不留悬空代理
    const emoji = "😀".repeat(10);
    const out2 = await applyExitLimits(emoji, { maxLines: 10, maxBytes: 3 });
    const head2 = out2.content.split("\n")[0];
    expect([...head2].every((ch) => ch === "😀" || ch === "\n")).toBe(true);
  });
});
