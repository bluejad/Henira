# @henira/plugin-fs-search

glob / grep 工具件（D-049 / D-065）：**纯适配器**（inject `["tools", "fs"]`——能力全部在 fs 服务）。
grep 为 **JS 引擎**——零外部二进制（v0.1.0 发布面不带平台二进制；ripgrep 加速挂账）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) §fs；工具 md 见本包 `tools/`
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-065

## 语义钉子

- glob：结果上限 100、mtime 降序、绝对路径返回、跳 `.git/.hg/.svn/node_modules`；`**` 跨段 / `*` 段内 / `?` 单字符 / `{a,b}` 展开；`total` 恒为**命中全量**（候选帽 2000 只限制排序取样，不影响计数）；`path` 必须目录
- grep：`output_mode` 三态（默认 files_with_matches，省 token）、head_limit 默认 250、`-i` / `-n`（默认开）/ `-A/-B/-C`（归并为对称窗口）、单行预览 2000 字符、二进制（NUL 探测）与 >10MB 文件跳过；`path` 可为目录或**单个文件**；截断注记按模式分判（files 按文件数 `totalFiles`、count/content 按命中行数 `totalSeen`）；上下文行用 `-` 分隔（`file-13-text`，rg 同形）
- 两个工具均只读标记 → 默认放行层覆盖（D-039）；搜索根在区外 → fs 服务层 floor ask

## 文件 ↔ 设计

| 文件     | 职责                                                                        | 设计出处                  |
| -------- | --------------------------------------------------------------------------- | ------------------------- |
| index.ts | glob / grep 适配器 + 相对路径显示 + 三模式格式化（`formatGrepResult` 导出） | D-065 / interfaces.md §fs |

判据 ↔ 测试：fs 服务 `search.test`（glob/grep 服务语义 7 例）+ 本包 `index.test`（三模式渲染与截断判据 5 例，含「1 文件多行命中不打假截断」回归锁）+ server.test 默认装配（七工具在场）。
