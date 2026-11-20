// @vitest-environment node
// plugin-fs-tools 带外元数据单测（E5）：read/write/edit 各自 __meta 供读取卡/diff 卡/新建卡；
// content 文本一字不改（模型可见面零变化）。fake fs 服务隔离真实文件系统。

import { createHarness } from "@henira/kernel";
import type { FsService, ToolContext, ToolDefinition, ToolsService } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { fsToolsPlugin } from "./index.js";

/** fake fs：read 返回分页事实；write/edit 返回服务形状（fs.test 覆盖真实行为，这里只喂形状） */
function fakeFs(): FsService {
  return {
    resolve: (p) => ({ absolute: p.startsWith("/") ? p : `/ws/${p}`, inside: true }),
    read: async () => ({
      content: "alpha\nbeta\ngamma",
      startLine: 3,
      endLine: 5,
      totalLines: 9,
    }),
    write: async () => ({ created: true, path: "/ws/demo.txt" }),
    edit: async () => ({ replacements: 1, path: "/ws/demo.txt" }),
    glob: async () => ({ files: [], total: 0 }),
    grep: async () => ({ matches: [], totalSeen: 0 }),
  };
}

async function toolsWithFs(): Promise<Map<string, ToolDefinition>> {
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
    .use({ name: "tools", start: () => tools })
    .use({ name: "fs", start: () => fakeFs() })
    .use(fsToolsPlugin());
  await harness.start();
  return registered;
}

const toolCtx: ToolContext = {
  signal: new AbortController().signal,
  requestPermission: async () => "allowed-once" as never,
  cwd: "/ws",
  config: { cwd: "/ws" } as never,
};

describe("fs-tools execute __meta（读取卡/新建卡/diff 卡数据源）", () => {
  it("read：分页事实进 meta（path/startLine/endLine/totalLines）", async () => {
    const read = (await toolsWithFs()).get("read");
    if (read === undefined) throw new Error("read not registered");
    const r = await read.execute({ file_path: "demo.txt" }, toolCtx);
    expect(r.__meta).toMatchObject({
      kind: "read",
      path: "/ws/demo.txt",
      startLine: 3,
      endLine: 5,
      totalLines: 9,
    });
    // content 保持 `N\t` 行号格式（读取卡 UI 拆 gutter 的数据源）
    expect(r.content).toContain("3\talpha");
  });

  it("write：path + created 进 meta", async () => {
    const write = (await toolsWithFs()).get("write");
    if (write === undefined) throw new Error("write not registered");
    const r = await write.execute({ file_path: "demo.txt", content: "hello" }, toolCtx);
    expect(r.__meta).toMatchObject({ kind: "write", path: "/ws/demo.txt", created: true });
  });

  it("edit：path + replacements 进 meta（old/new 在行 input JSON，UI 自算 hunk）", async () => {
    const edit = (await toolsWithFs()).get("edit");
    if (edit === undefined) throw new Error("edit not registered");
    const r = await edit.execute(
      { file_path: "demo.txt", old_string: "hello", new_string: "henira" },
      toolCtx,
    );
    expect(r.__meta).toMatchObject({ kind: "edit", path: "/ws/demo.txt", replacements: 1 });
  });
});
