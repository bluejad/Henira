// plugin-shell-tools：bash / powershell 工具件（interfaces.md §shell / D-065）。
// 纯适配器：能力全部在 shell 服务（D-049）；本件只做 ToolDefinition 形状与结果格式化。
// 非零退出码不是 isError（[exit code: N] 计入内容）；每流截断注记；审批走既有判定链
// （灾难硬拒清单已覆盖 Windows 命令；commandPrefix / commandContains 规则天然适配）。

import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  type FsGate,
  type ShellService,
  type ToolContext,
  type ToolDefinition,
} from "@henira/protocol";

function gateFor(ctx: ToolContext, tool: string, args: unknown): FsGate {
  return {
    tool,
    args,
    signal: ctx.signal,
    requestPermission: ctx.requestPermission,
  };
}

/** 结果渲染：stdout → [stderr] 分节 → [exit code] / [timed out]（dsh render 语义同形） */
export function formatShellRun(r: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  signal?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}): string {
  const parts: string[] = [];
  let stdout = r.stdout.replace(/\r\n/g, "\n");
  let stderr = r.stderr.replace(/\r\n/g, "\n");
  if (r.stdoutTruncated === true) stdout = `(output truncated — kept last 20KB)\n${stdout}`;
  if (stdout !== "") parts.push(stdout);
  if (stderr !== "") {
    if (r.stderrTruncated === true) stderr = `(output truncated — kept last 20KB)\n${stderr}`;
    parts.push(`[stderr]\n${stderr}`);
  }
  if (r.timedOut === true) parts.push(`[timed out after ${r.durationMs}ms]`);
  if (r.exitCode === null) {
    if (r.timedOut !== true) parts.push(`[killed by signal: ${r.signal ?? "unknown"}]`);
  } else if (r.exitCode !== 0) {
    parts.push(`[exit code: ${r.exitCode}]`);
  }
  if (parts.length === 0) return "(no output; exit code 0)";
  return parts.join("\n");
}

function makeShellTool(name: "bash" | "powershell", shell: ShellService): ToolDefinition {
  const displayName = name === "bash" ? "bash" : "PowerShell";
  return {
    description:
      `Run a ${displayName} command in a fresh shell (shell state does not persist between calls). ` +
      "Use this for builds, git, package managers, and other terminal tasks. " +
      "The command runs in the session cwd; output is capped (last 20KB per stream). " +
      "Destructive system commands are hard-blocked; most commands require approval unless a permission rule allows them. " +
      "timeout is clamped to at most 600000ms; a timed-out command is killed (process tree) and partial output is returned.",
    name,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: `The ${displayName} command to run` },
        timeout: {
          type: "integer",
          description: "Optional timeout in ms (default 120000, max 600000)",
        },
      },
      required: ["command"],
    },
    execute: async (args, ctx) => {
      const r = await shell.run(
        {
          command: String(args.command),
          shell: name,
          timeout: typeof args.timeout === "number" ? args.timeout : undefined,
        },
        gateFor(ctx, name, args),
      );
      // 带外元数据（P4 通道）：stdout/stderr 分字段供终端卡分色；content 文本一字不改（模型可见面零变化）
      return {
        content: formatShellRun(r),
        __meta: {
          kind: "shell",
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
          ...(r.timedOut !== undefined ? { timedOut: r.timedOut } : {}),
          ...(r.signal !== undefined ? { signal: r.signal } : {}),
          ...(r.stdoutTruncated !== undefined ? { stdoutTruncated: r.stdoutTruncated } : {}),
          ...(r.stderrTruncated !== undefined ? { stderrTruncated: r.stderrTruncated } : {}),
        },
      };
    },
  };
}

/** 官方 bash / powershell 工具件（不占槽位；inject tools + shell——D-049 工具件形状） */
export function shellToolsPlugin(): ServiceDefinition {
  return {
    inject: ["tools", "shell"],
    start(ctx) {
      const cx = asHeniraContext(ctx);
      const shell = cx.get("shell");
      const tools = cx.get("tools");
      tools.register(makeShellTool("bash", shell));
      tools.register(makeShellTool("powershell", shell));
    },
  };
}
