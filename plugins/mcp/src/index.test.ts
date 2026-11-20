// mcpToolResult 单测（审查 F12）：execute 包装的纯函数面——isError 键等价性、__meta
// 精确形状（原始名进带外通道）、content 直传。

import { describe, expect, it } from "vitest";
import { mcpToolResult } from "./index.js";

describe("mcpToolResult（execute 包装纯函数）", () => {
  it("isError=true → 键在且值 true", () => {
    const r = mcpToolResult({ content: "boom", isError: true }, "office", "read_doc");
    expect(Object.hasOwn(r, "isError")).toBe(true);
    expect(r.isError).toBe(true);
  });

  it("isError 缺省 → 结果无 isError 键（JSON 序列化字节面与直返等价）", () => {
    const r = mcpToolResult({ content: "ok" }, "office", "read_doc");
    expect(Object.hasOwn(r, "isError")).toBe(false);
  });

  it("__meta 精确形状 { kind:'mcp', server, tool }（原始名——wire 名截断+哈希后反拆不可靠）", () => {
    const r = mcpToolResult({ content: "x" }, "office", "read_doc");
    expect(r.__meta).toEqual({ kind: "mcp", server: "office", tool: "read_doc" });
  });

  it("content 直传不变", () => {
    const r = mcpToolResult({ content: "plain", isError: undefined }, "s", "t");
    expect(r.content).toBe("plain");
  });
});
