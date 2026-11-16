import { describe, expect, it, vi } from "vitest";
import {
  DuplicateToolError,
  defineTool,
  InvalidToolSchemaError,
  ToolRegistry,
} from "./registry.js";

const readTool = defineTool({
  name: "read",
  description: "read a file",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  isConcurrencySafe: true,
  execute: async () => ({ content: "ok" }),
});

describe("ToolRegistry", () => {
  it("注册 + 投影：project 产出 wire 形状", () => {
    const reg = new ToolRegistry();
    reg.register(readTool);
    const wires = reg.project();
    expect(wires).toEqual([
      { name: "read", description: "read a file", inputSchema: readTool.inputSchema },
    ]);
  });

  it("重名注册即抛（DuplicateToolError）", () => {
    const reg = new ToolRegistry();
    reg.register(readTool);
    expect(() => reg.register(readTool)).toThrow(DuplicateToolError);
  });

  it("非法 schema 装载期即抛（InvalidToolSchemaError，D-044：装配层捕获 → 插件跳过 + 告警）", () => {
    const reg = new ToolRegistry();
    expect(() =>
      reg.register({
        ...readTool,
        name: "broken",
        inputSchema: { type: "not-a-json-schema-type" },
      }),
    ).toThrow(InvalidToolSchemaError);
  });

  it("project 过滤：include / exclude（声明式可见性双层之一）", () => {
    const reg = new ToolRegistry();
    reg.register(readTool);
    reg.register({ ...readTool, name: "write", isConcurrencySafe: false });
    expect(reg.project({ include: ["read"] }).map((t) => t.name)).toEqual(["read"]);
    expect(reg.project({ exclude: ["read"] }).map((t) => t.name)).toEqual(["write"]);
  });

  it("Disposable：撤销后 resolve 不到、project 不含", () => {
    const reg = new ToolRegistry();
    const dispose = reg.register(readTool);
    dispose();
    expect(reg.resolve("read")).toBeUndefined();
    expect(reg.project()).toEqual([]);
  });

  it("defineTool 是恒等类型辅助（M2：无转换糖，D-044）", () => {
    expect(defineTool(readTool)).toBe(readTool);
    expect(vi.fn()).toBeDefined(); // vitest 冒烟（本文件工具函数齐备）
  });
});
