// @vitest-environment node
// plugin-shell 单测（D-065）：真实 spawn（node 作命令载体跨平台）、非零退出码不是错误、
// stderr 分流、超时杀进程树、env 净化覆盖、cwd 校验；powershell 组 win32 门控。

import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness } from "@henira/kernel";
import { asHeniraContext, type ConfigService, type ShellService } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { clampTimeout, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, ShellError } from "./exec.js";
import { shellPlugin } from "./index.js";

async function serviceWithCwd(cwd: string): Promise<ShellService> {
  const harness = createHarness()
    .use({
      name: "config",
      start: () => ({ cwd }) as unknown as ConfigService,
    })
    .use(shellPlugin());
  await harness.start();
  return asHeniraContext(harness.context).get("shell");
}

async function tmpWorkdir(): Promise<string> {
  return fsp.mkdtemp(path.join(tmpdir(), "henira-shell-test-"));
}

function gate(signal?: AbortSignal) {
  return { tool: "bash", args: {}, signal, requestPermission: async () => "allowed-once" as never };
}

describe("shell 服务（真实 spawn）", () => {
  it("bash：node 命令跑通——stdout 捕获、exit 0、durationMs 有值", async () => {
    const dir = await tmpWorkdir();
    const shell = await serviceWithCwd(dir);
    const r = await shell.run(
      { command: `node -e "console.log('shell-ok')"`, shell: "bash" },
      gate(),
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("shell-ok");
    expect(r.stderr).toBe("");
    expect(r.durationMs).toBeGreaterThan(0);
    expect(r.timedOut).toBeUndefined();
  });

  it("非零退出码不是错误：exitCode 原样返回，stderr 分流捕获", async () => {
    const dir = await tmpWorkdir();
    const shell = await serviceWithCwd(dir);
    const r = await shell.run(
      { command: `node -e "console.error('boom'); process.exit(3)"`, shell: "bash" },
      gate(),
    );
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("boom");
    expect(r.timedOut).toBeUndefined();
  });

  it("超时杀进程树：timedOut true、部分输出照返", async () => {
    const dir = await tmpWorkdir();
    const shell = await serviceWithCwd(dir);
    const r = await shell.run(
      {
        command: `node -e "console.log('partial'); setTimeout(()=>{}, 60000)"`,
        shell: "bash",
        timeout: 400,
      },
      gate(),
    );
    expect(r.timedOut).toBe(true);
    expect(r.stdout).toContain("partial");
  });

  it("env：NO_COLOR/TERM 等净化覆盖在场，HENIRA_PROJECT_DIR = 会话 cwd", async () => {
    const dir = await tmpWorkdir();
    const shell = await serviceWithCwd(dir);
    const r = await shell.run(
      {
        command: `node -e "console.log(process.env.NO_COLOR, process.env.TERM, process.env.HENIRA_PROJECT_DIR === process.cwd())"`,
        shell: "bash",
      },
      gate(),
    );
    expect(r.stdout.trim()).toBe("1 dumb true");
  });

  it("spec.cwd：相对路径按会话 cwd 解析；不存在的目录抛错", async () => {
    const dir = await tmpWorkdir();
    await fsp.mkdir(path.join(dir, "sub"));
    const shell = await serviceWithCwd(dir);
    const r = await shell.run(
      {
        command: `node -e "console.log(process.cwd().endsWith('sub'))"`,
        shell: "bash",
        cwd: "sub",
      },
      gate(),
    );
    expect(r.stdout.trim()).toBe("true");
    await expect(
      shell.run({ command: "node -v", shell: "bash", cwd: "no-such-dir" }, gate()),
    ).rejects.toThrow(/does not exist/);
  });

  it("abort：信号触发杀树，已产出的输出照返", async () => {
    const dir = await tmpWorkdir();
    const shell = await serviceWithCwd(dir);
    const controller = new AbortController();
    const runPromise = shell.run(
      {
        command: `node -e "console.log('started'); setTimeout(()=>{}, 60000)"`,
        shell: "bash",
      },
      gate(controller.signal),
    );
    setTimeout(() => controller.abort(), 500);
    const r = await runPromise;
    expect(r.stdout).toContain("started");
    expect(r.exitCode).not.toBe(0);
  });

  it.skipIf(process.platform !== "win32")(
    "powershell 组（win32 门控）：Write-Output 跑通 + UTF-8 中文不乱码",
    { timeout: 20_000 }, // pwsh 冷启动在慢机可超 vitest 默认 5s
    async () => {
      const dir = await tmpWorkdir();
      const shell = await serviceWithCwd(dir);
      const r = await shell.run(
        { command: `Write-Output 'ps-ok'; Write-Output '中文'`, shell: "powershell" },
        gate(),
      );
      expect(r.stdout).toContain("ps-ok");
      expect(r.stdout).toContain("中文");
    },
  );
});

describe("timeout 钳制", () => {
  it("缺省 120s、上限 600s、非法值回缺省", () => {
    expect(clampTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeout(999_999_999)).toBe(MAX_TIMEOUT_MS);
    expect(clampTimeout(0)).toBe(1);
    expect(clampTimeout(Number.NaN)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeout(500)).toBe(500);
  });

  it("空命令 / 非串命令拒绝", async () => {
    const dir = await tmpWorkdir();
    const shell = await serviceWithCwd(dir);
    await expect(shell.run({ command: "  ", shell: "bash" }, gate())).rejects.toThrow(ShellError);
  });
});
