# @henira/plugin-shell

shell 服务件（占 `shell` 槽，D-049 / D-065）：命令执行能力——每次新 spawn（无持久会话）、
timeout 默认 120s 上限 600s（四家参照物共识）、超时杀进程树、stdout / stderr 分开捕获
（每流尾部保留 20KB）。本件**不注册任何工具**（工具件在 shell-tools）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) §shell（ShellService / 结果形状 / env 语义）
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-065

## 语义钉子

- **每次新 spawn**：shell 状态（env / 函数 / cwd）不跨调用持久（cwd 持久化挂账——workingDirectory 服务的唯一潜在消费者）
- **超时杀进程树**：win32 `taskkill /T /F`；posix detached 进程组 + 负 pid（TERM → 3s → KILL）；超时结果 `timedOut: true` + 部分输出照返
- **非零退出码不是错误**：`exitCode` 原样返回由模型判读；spawn 级失败（bash / pwsh 不存在）→ 抛错走 isError，文案可行动（Windows 提示装 Git for Windows）
- **env**：父环境 + 输出净化覆盖（`NO_COLOR/TERM/PAGER/GIT_PAGER`）+ `HENIRA_PROJECT_DIR`，spec.env 显式项总赢；**不洗敏感名**——shell 以用户身份跑（审批链是闸），与 MCP stdio 的清洗（防外部 server 侧信道）是两个场景
- **powershell**：探 pwsh 7 → Windows PowerShell 5.1，`-NoLogo -NoProfile -NonInteractive -Command`，UTF-8 输出包装（5.1 默认代码页会乱码）
- **第二实现思想实验（D-049）**：契约零 child_process 类型、env 显式 map、结果纯数据——远程 shell（SSH）实现 `run()` 同形可换

## 用法

```ts
import { shellPlugin } from "@henira/plugin-shell";

createHarness().use(shellPlugin());
const r = await ctx
  .get("shell")
  .run({ command: "npm test", shell: "bash", timeout: 300_000 }, gate);
// { exitCode: 0, stdout, stderr, durationMs, stdoutTruncated?, stderrTruncated? }
```

## 文件 ↔ 设计

| 文件      | 职责                                                             | 设计出处                     |
| --------- | ---------------------------------------------------------------- | ---------------------------- |
| index.ts  | 工厂（占 shell 槽、inject config）+ run 装配（cwd / env / 探测） | D-065 / interfaces.md §shell |
| exec.ts   | spawn / 每流尾 20KB / timeout 竞速 / 进程树杀 / env 净化覆盖     | D-065 决定 4                 |
| shells.ts | bash / powershell 可执行探测（pwsh 7 → 5.1）+ UTF-8 包装         | D-065 决定 5                 |

判据 ↔ 测试：`shell.test.ts`（真实 spawn 9 例：非零退出 / stderr 分流 / 超时杀树 / abort / env / cwd / powershell win32 门控）。
