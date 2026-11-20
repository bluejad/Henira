# glob

- 归属：`@henira/plugin-fs-search`（能力在 `@henira/plugin-fs`，D-065）
- 权限类：**只读**（`isConcurrencySafe: true`）——默认放行层；搜索根在区外 → fs 服务层 floor ask

## 用途

按 glob 模式找文件。返回绝对路径，按修改时间新→旧排序。

## 参数

| 参数      | 类型   | 必填 | 说明                                                          |
| --------- | ------ | ---- | ------------------------------------------------------------- |
| `pattern` | string | ✓    | glob 模式（`**` 跨段 / `*` 段内 / `?` 单字符 / `{a,b}` 展开） |
| `path`    | string |      | 基目录（默认会话 cwd；必须存在且是目录）                      |

## 输出样例

```
D:\proj\src\lib\util.ts
D:\proj\src\a.ts
(Results are truncated: showing 100 of 132. Consider using a more specific path or pattern.)
```

空态：`No files found`。

## 截断行为

- 上限 100 条（mtime 降序取头部）；候选收集帽 2000（超过即停走，total 反映截断事实）；
- 目录行走跳 `.git` / `.hg` / `.svn` / `node_modules` 与 symlink（防环）。

## 错误情形（isError）

| 情形       | 文案要点                                  |
| ---------- | ----------------------------------------- |
| 基目录缺失 | `search path does not exist: "<abs>"`     |
| 非目录     | `search path is not a directory: "<abs>"` |
| 区外未放行 | 同 read（fs 服务层统一文案）              |
