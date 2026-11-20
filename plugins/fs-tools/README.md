# @henira/plugin-fs-tools

read / write / edit 工具件（D-049 / D-065）：**纯适配器**——能力与守卫全部在 fs 服务
（inject `["tools", "fs"]`），本件只做 ToolDefinition 形状与结果格式化，不自带任何文件实现。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) §fs；工具 md 见本包 `tools/`（D-052 一工具一 md）
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-065

## 语义钉子

- `read` 只读标记（isConcurrencySafe）→ 无规则命中走默认放行层（D-039）；`write` / `edit` 非只读 → 审批链弹卡
- read 输出 `N\t` 行号（cat -n），尾注带 `offset` 续读提示；空文件 / 二进制 / 越界 offset 有固定英文文案
- 工具关掉 / fs 服务不在场 → 本件不装载 + 告警（D-049 装配层预检，宿主侧对官方 preset 条目同样生效）

## 文件 ↔ 设计

| 文件     | 职责                                                    | 设计出处                  |
| -------- | ------------------------------------------------------- | ------------------------- |
| index.ts | 三个 ToolDefinition 适配器 + read 格式化（行号 / 尾注） | D-065 / interfaces.md §fs |

判据 ↔ 测试：examples/mock e2e「fs+shell 工具流」（write → read → edit 全链，roadmap M4 判据②）+ server.test「read 工具全链」。
