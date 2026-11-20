// 命令执行内核（interfaces.md §shell，D-065）：每次新 spawn、超时杀进程树、
// 每流尾部保留 20KB。timeout 默认 120s / 上限 600s（四仓共识）。

import { type ChildProcess, spawn } from "node:child_process";
import type { ShellRunResult } from "@henira/protocol";

export class ShellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellError";
  }
}

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
/** 服务层每流尾部保留量（渲染截断注记归工具件） */
export const STREAM_TAIL_BYTES = 20_000;
const KILL_GRACE_MS = 3_000;

class StreamTail {
  #tail = Buffer.alloc(0);
  total = 0;

  push(chunk: Buffer): void {
    this.total += chunk.length;
    this.#tail =
      this.#tail.length + chunk.length > STREAM_TAIL_BYTES
        ? Buffer.concat([this.#tail, chunk]).subarray(
            this.#tail.length + chunk.length - STREAM_TAIL_BYTES,
          )
        : Buffer.concat([this.#tail, chunk]);
  }

  text(): string {
    return this.#tail.toString("utf8");
  }

  get truncated(): boolean {
    return this.total > STREAM_TAIL_BYTES;
  }
}

function treeKill(pid: number, force = false): void {
  if (process.platform === "win32") {
    // taskkill /T 杀整棵树（Windows 无进程组语义；dsh 用 Job objects，同效果）
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      /* 已退出 */
    }
  }
}

export interface ExecOptions {
  command: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export function execCommand(opts: ExecOptions): Promise<ShellRunResult> {
  const started = Date.now();
  return new Promise<ShellRunResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(opts.executable, opts.args, {
        cwd: opts.cwd,
        env: opts.env,
        windowsHide: true,
        // posix 用独立进程组（setsid）——负 pid 杀整组；win32 靠 taskkill /T
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        signal: String((err as Error).message),
      });
      return;
    }

    const stdout = new StreamTail();
    const stderr = new StreamTail();
    child.stdout?.on("data", (c: Buffer) => stdout.push(c));
    child.stderr?.on("data", (c: Buffer) => stderr.push(c));

    let timedOut = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (exitCode: number | null, signal: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        stdout: stdout.text(),
        stderr: stderr.text(),
        durationMs: Date.now() - started,
        ...(timedOut ? { timedOut: true } : {}),
        ...(signal ? { signal } : {}),
        ...(stdout.truncated ? { stdoutTruncated: true } : {}),
        ...(stderr.truncated ? { stderrTruncated: true } : {}),
      });
    };

    const onAbort = () => {
      if (settled || child.pid === undefined) return;
      timedOut = false;
      treeKill(child.pid);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutTimer = setTimeout(() => {
      if (settled || child.pid === undefined) return;
      timedOut = true;
      treeKill(child.pid);
      killTimer = setTimeout(() => {
        if (!settled && child.pid !== undefined) treeKill(child.pid, true);
      }, KILL_GRACE_MS);
    }, opts.timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      // spawn 级失败（命令不存在等）→ 立即以错误收场（工具层转 isError）
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: null,
        stdout: stdout.text(),
        stderr: stderr.text(),
        durationMs: Date.now() - started,
        signal: err.code === "ENOENT" ? "spawn-enoent" : String(err.code ?? err.message),
      });
    });

    child.on("close", (code, signal) => {
      finish(code, signal ?? undefined);
    });
  });
}

/** 输出净化覆盖（dsh 行为层同款：关分页 / 关颜色，产出稳定可解析） */
export function baseEnvOverrides(cwd: string): Record<string, string> {
  return {
    NO_COLOR: "1",
    TERM: "dumb",
    PAGER: "cat",
    GIT_PAGER: "cat",
    HENIRA_PROJECT_DIR: cwd,
  };
}

export function clampTimeout(timeout: number | undefined): number {
  const requested =
    typeof timeout === "number" && Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(requested), 1), MAX_TIMEOUT_MS);
}
