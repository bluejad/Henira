// @vitest-environment node
// plugin-shell-tools 带外元数据单测（E5）：execute 返回 __meta 供终端卡分色/退出码徽章；
// content 文本一字不改（模型可见面零变化——meta 是 P4 带外通道）。fake shell 服务隔离 spawn。

import { createHarness } from "@henira/kernel";
import type { ShellService, ToolContext, ToolDefinition, ToolsService } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { shellToolsPlugin } from "./index.js";

async function toolsWithShell(shell: ShellService): Promise<Map<string, ToolDefinition>> {
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
    .use({ name: "shell", start: () => shell })
    .use(shellToolsPlugin());
  await harness.start();
  return registered;
}

const toolCtx: ToolContext = {
  signal: new AbortController().signal,
  requestPermission: async () => "allowed-once" as never,
  cwd: "/ws",
  config: { cwd: "/ws" } as never,
};

describe("shell-tools execute __meta（终端卡数据源）", () => {
  it("bash：stdout/stderr/exitCode 分字段进 meta；content 与 meta 分离（原文本不变）", async () => {
    const bash = (
      await toolsWithShell({
        run: async () => ({ exitCode: 2, stdout: "line1\nline2", stderr: "oops", durationMs: 12 }),
      })
    ).get("bash");
    if (bash === undefined) throw new Error("bash not registered");
    const r = await bash.execute({ command: "x" }, toolCtx);
    expect(r.content).toBe("line1\nline2\n[stderr]\noops\n[exit code: 2]");
    expect(r.__meta).toMatchObject({
      kind: "shell",
      exitCode: 2,
      stdout: "line1\nline2",
      stderr: "oops",
    });
  });

  it("timedOut / signal / 截断标记可选透传", async () => {
    const bash = (
      await toolsWithShell({
        run: async () => ({
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: 600,
          timedOut: true,
          stdoutTruncated: true,
        }),
      })
    ).get("bash");
    if (bash === undefined) throw new Error("bash not registered");
    const r = await bash.execute({ command: "x" }, toolCtx);
    expect(r.__meta).toMatchObject({
      kind: "shell",
      exitCode: null,
      timedOut: true,
      stdoutTruncated: true,
    });
    expect(r.__meta).not.toHaveProperty("signal");
  });

  it("powershell 同构带 meta", async () => {
    const pwsh = (
      await toolsWithShell({
        run: async () => ({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 }),
      })
    ).get("powershell");
    if (pwsh === undefined) throw new Error("powershell not registered");
    const r = await pwsh.execute({ command: "x" }, toolCtx);
    expect(r.__meta).toMatchObject({ kind: "shell", exitCode: 0, stdout: "ok" });
  });
});
