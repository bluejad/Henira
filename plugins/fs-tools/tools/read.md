# read

- 归属：`@henira/plugin-fs-tools`（能力在 `@henira/plugin-fs`，D-065）
- 权限类：**只读**（`isConcurrencySafe: true`）——无规则命中走默认放行层（D-039）；路径在会话工作区外 → fs 服务层 `floor:"ask"` 弹卡

## 用途

读一个文本文件，带行号分页返回。二进制文件（首段含 NUL）拒绝；目录、越界 offset 报错。

## 参数

| 参数        | 类型    | 必填 | 说明                         |
| ----------- | ------- | ---- | ---------------------------- |
| `file_path` | string  | ✓    | 绝对路径，或相对会话 cwd     |
| `offset`    | integer |      | 1 起始行（默认 1）           |
| `limit`     | integer |      | 行数（默认 2000，上限 2000） |

## 输出样例

```
1\tconst a = 1;
2\t// hello
(Showing lines 1-2 of 40. Use offset=3 to continue.)
```

空文件 → `(<path> — empty file)`。

## 截断行为

- 默认 / 上限 2000 行；单行超 2000 字符就地截尾并注记 `… (line truncated to 2000 chars)`；
- 选区超 50KB → 字节帽截断，尾注变体 `(Output capped. Showing lines X-Y. Use offset=Y+1 to continue.)`；
- 全文件扫描帽 50MB（超过直接报错；流式扫描挂账）。

## 错误情形（isError，恒英文）

| 情形        | 文案要点                                           |
| ----------- | -------------------------------------------------- |
| 文件不存在  | `cannot read "<abs>": not found`                   |
| 目标是目录  | `cannot read "<abs>": is a directory`              |
| 二进制      | `cannot read "<abs>": binary file`                 |
| offset 越界 | `offset N is out of range for "<abs>" (M lines)`   |
| 区外未放行  | `access to "<abs>" was not approved (decision: …)` |

## 语义钉子

- 读成功即登记读态（mtime + 尺寸）；带 offset / limit 的读是**部分读**——不满足 write / edit 的覆盖条件（防未见内容被覆盖）。
