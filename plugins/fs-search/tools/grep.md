# grep

- 归属：`@henira/plugin-fs-search`（能力在 `@henira/plugin-fs`，D-065）
- 权限类：**只读**（`isConcurrencySafe: true`）——默认放行层；搜索根在区外 → fs 服务层 floor ask

## 用途

按正则在文件内容里逐行搜索（JavaScript regex；JS 引擎零外部二进制——rg 加速挂账）。

## 参数

| 参数               | 类型    | 必填 | 说明                                              |
| ------------------ | ------- | ---- | ------------------------------------------------- |
| `pattern`          | string  | ✓    | 正则表达式                                        |
| `path`             | string  |      | 基目录或单个文件（默认会话 cwd）                  |
| `glob`             | string  |      | 文件名过滤（如 `*.ts`；单正向 glob）              |
| `output_mode`      | string  |      | `files_with_matches`（默认）/ `content` / `count` |
| `-i`               | boolean |      | 忽略大小写（默认 false）                          |
| `-n`               | boolean |      | content 模式行号（默认 true）                     |
| `-A` / `-B` / `-C` | integer |      | 上下文行数（0–10；归并为对称窗口——不对称挂账）    |
| `head_limit`       | integer |      | 结果上限（默认 250）                              |

## 输出样例

files 模式：

```
Found 2 files
src/a.ts
src/b.md
```
content 模式（区内相对路径显示）：

```
src/a.ts:2:// hello
```

上下文行（`-A` / `-B` / `-C` 展开）用 `-` 分隔（`src/a.ts-3-neighbor`，rg 同形）；`-n:false` 省略行号（`src/a.ts:// hello`）。
count 模式：

```
src/a.ts:1
src/b.md:1
Found 2 total matching lines across 2 files.
```

## 截断行为

- head_limit 截断时尾注给 `totalSeen`（`Truncated at head_limit=N; M matching lines seen in total. …`）；
- 单行预览 2000 字符；跳二进制（NUL 探测）与 >10MB 文件；跳 `.git/.hg/.svn/node_modules` 与 symlink。

## 错误情形（isError）

| 情形       | 文案要点                             |
| ---------- | ------------------------------------ |
| 非法正则   | `Invalid regex pattern: <原因>`      |
| 空模式     | `pattern must be a non-empty string` |
| 区外未放行 | 同 read（fs 服务层统一文案）         |

空态：`No matches found`。
