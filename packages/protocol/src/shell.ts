// shell 槽位契约（interfaces.md §shell，D-065）：命令执行能力。
// 契约零 child_process 类型、env 显式 map、结果纯数据——远程 shell（SSH）同形可换
// （第二实现思想实验，D-065）；后台任务 / 持久会话属实现细节，不进 v1 契约。

import type { FsGate } from "./fs.js";

export interface ShellRunSpec {
  command: string;
  shell: "bash" | "powershell";
  /** 缺省 = 会话 cwd；目录不存在 → 抛错 */
  cwd?: string;
  /** ms；默认 120_000、上限 600_000（钳制） */
  timeout?: number;
  /** 显式覆盖（本地实现合并父环境之上；远程实现原样传递）；spec.env 显式项总赢 */
  env?: Record<string, string>;
}

export interface ShellRunResult {
  /** null = 被信号杀死 */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  signal?: string;
  /** 服务层每流尾部保留 20KB——丢弃头部时置位（渲染截断注记归工具件） */
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

/** shell 槽位契约（interfaces.md §shell，D-065）：每次新 spawn（无持久会话）；
 *  stdout / stderr 分开捕获；超时杀进程树；非零退出码不是错误（内容计入，模型判读） */
export interface ShellService {
  run(spec: ShellRunSpec, gate: FsGate): Promise<ShellRunResult>;
}
