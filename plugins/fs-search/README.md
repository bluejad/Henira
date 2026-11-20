# @henira/plugin-fs-search

glob / grep 工具件（D-049 / D-065）：**纯适配器**（inject `["tools", "grep 能力"]` 同 fs 服务）。
grep 为 **JS 引擎**——零外部二进制（v0.1.0 发布面不带平台二进制；ripgrep 加速挂账）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) §fs；工具 md 见本包 `tools/`
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-065

## 语义钉子

- glob：上限 100、mtime 降序、绝对路径返回、跳 `.git/.hg/.svn/node_modules`；`**` 跨段 / `*` 段内 / `?` 单字符 / `{a,b}` 展开
- grep：`output_mode` 三态（默认 files_with_matches，省 token）、head_limit 默认 250、`-i` / `-n` / `-A/-B/-C`（归并为对称窗口）、单行预览 2000 字符、二进制（NUL 探测）与 >10MB 文件跳过
- 两个工具均只读标记 → 默认放行层覆盖（D-039）；搜索根在区外 → fs 服务层 floor ask

## 文件 ↔ 设计

| 文件     | 职责                                         | 设计出处                  |
| -------- | -------------------------------------------- | ------------------------- |
| index.ts | glob / grep 适配器 + 相对路径显示 + 截断尾注 | D-065 / interfaces.md §fs |

判据 ↔ 测试：fs 服务 search.test（glob/grep 全语义）+ server.test 默认装配（七工具在场）。
