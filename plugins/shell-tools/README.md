# @henira/plugin-shell-tools

bash / powershell 工具件（D-049 / D-065）：**纯适配器**（inject `["tools", "shell"]`），
能力全部在 shell 服务；本件只做 ToolDefinition 形状与结果格式化。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) §shell；工具 md 见本包 `tools/`
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-065

## 语义钉子

- 非零退出码**不是 isError**——`[exit code: N]` / `[killed by signal: X]` / `[timed out after Xms]` 计入内容由模型判读（spawn 级失败才 isError）
- 渲染分节：stdout → `[stderr]` 分节 → 状态行；每流超 20KB 头部丢弃 + 截断注记（服务层保留尾部）
- 审批走既有判定链（fail-closed 默认 ask）：灾难操作硬拒清单已覆盖 Windows 命令（format / diskpart / del / shutdown…）；`commandPrefix` / `commandContains` 规则天然适配 shell 工具（permissions.json）
- 两个工具均非只读标记 → 无规则命中必弹卡（D-039 判定链不变，无 shell 特例）

## 文件 ↔ 设计

| 文件     | 职责                                               | 设计出处                     |
| -------- | -------------------------------------------------- | ---------------------------- |
| index.ts | bash / powershell 适配器 + formatShellRun 分节渲染 | D-065 / interfaces.md §shell |

判据 ↔ 测试：本包 `index.test.ts`（3 例：stdout/stderr/exitCode 分字段进 `__meta` / 截断标记透传 / powershell 同构）+ server.test「bash 工具全链」（42 / exit 7 / .env 链前拒）+ facade.test 双形态（审批卡收答 → bash 照常）。
