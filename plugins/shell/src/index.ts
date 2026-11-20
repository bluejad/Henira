// plugin-shell：shell 服务件（interfaces.md §shell 契约小节 / D-065）。
// 命令执行能力：每次新 spawn（无持久会话）、timeout 默认 120s 上限 600s、超时杀进程树、
// stdout/stderr 分开捕获（每流尾部 20KB）；不注册任何工具（工具件在 shell-tools）。
// 非零退出码不是错误（内容计入由模型判读）；spawn 级失败（命令不存在）→ 抛错走 isError。
// 第二实现（远程 shell）对契约的要求：零 child_process 类型泄漏、env 显式 map、结果纯数据。

import { promises as fsp } from "node:fs";
import path from "node:path";
import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  type FsGate,
  type ShellRunResult,
  type ShellRunSpec,
  type ShellService,
} from "@henira/protocol";
import { baseEnvOverrides, clampTimeout, execCommand, ShellError } from "./exec.js";
import { POWERSHELL_UTF8_PREFIX, resolveBash, resolvePowershell } from "./shells.js";

export { ShellError } from "./exec.js";

/** 官方 plugin-shell 工厂（占 'shell' 槽；inject config 取会话 cwd 为缺省执行目录） */
export function shellPlugin(): ServiceDefinition<ShellService> {
  return {
    name: "shell",
    inject: ["config"],
    start(ctx) {
      const config = asHeniraContext(ctx).get("config");

      const service: ShellService = {
        async run(spec: ShellRunSpec, gate: FsGate): Promise<ShellRunResult> {
          if (typeof spec.command !== "string" || spec.command.trim() === "") {
            throw new ShellError("command must be a non-empty string");
          }
          // 相对 cwd 相对会话 cwd 解析（与 fs resolve 同语义）；绝对路径原样
          const cwd = path.resolve(config.cwd, spec.cwd ?? ".");
          const st = await fsp.stat(cwd).catch(() => null);
          if (st === null || !st.isDirectory()) {
            throw new ShellError(`cwd does not exist or is not a directory: "${cwd}"`);
          }
          const timeoutMs = clampTimeout(spec.timeout);
          const env = {
            ...process.env,
            ...baseEnvOverrides(cwd),
            ...(spec.env ?? {}),
          } as Record<string, string>;

          const executable = spec.shell === "powershell" ? resolvePowershell() : resolveBash();
          const args =
            spec.shell === "powershell"
              ? [
                  "-NoLogo",
                  "-NoProfile",
                  "-NonInteractive",
                  "-Command",
                  `${POWERSHELL_UTF8_PREFIX}${spec.command}`,
                ]
              : ["-c", spec.command];

          const result = await execCommand({
            command: spec.command,
            executable,
            args,
            cwd,
            env,
            timeoutMs,
            signal: gate.signal,
          });
          if (result.signal === "spawn-enoent") {
            throw new ShellError(
              `failed to spawn ${spec.shell} (executable disappeared from PATH?)`,
            );
          }
          return result;
        },
      };
      return service;
    },
  };
}
