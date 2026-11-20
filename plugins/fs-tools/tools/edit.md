# edit

- 归属：`@henira/plugin-fs-tools`（能力在 `@henira/plugin-fs`，D-065）
- 权限类：**写**（非只读）——同 write：默认弹卡、凭据链外硬拒、区外 floor ask

## 用途

在文本文件里做精确字符串替换。文件必须先 read；`old_string` 必须唯一命中（除非 `replace_all`）。

## 参数

| 参数          | 类型    | 必填 | 说明                       |
| ------------- | ------- | ---- | -------------------------- |
| `file_path`   | string  | ✓    | 绝对路径，或相对会话 cwd   |
| `old_string`  | string  | ✓    | 被替换的精确文本（非空）   |
| `new_string`  | string  | ✓    | 替换文本（空串 = 删除）    |
| `replace_all` | boolean |      | 替换全部命中（默认 false） |

## 输出样例

```
The file <abs> has been updated successfully.
```
replace_all 多命中：

```
Replaced 3 occurrences in <abs>.
```

## 截断行为

无。

## 错误情形（isError）

| 情形                  | 文案要点                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| old == new            | `No changes to make: old_string and new_string are exactly the same.`                                    |
| old 为空              | `old_string must be a non-empty string; use write to create or overwrite a file`                         |
| 未命中                | `String to replace not found in "<abs>". It must match exactly, …`（new 已在文中时附「可能已改过」提示） |
| 多命中未 replace_all  | `Found N matches of old_string in "<abs>", but replace_all is false. …`                                  |
| 混合换行 + 多行 old   | `"<abs>" has mixed line endings (CRLF and LF); a multi-line edit cannot preserve them. …`                |
| 未读 / stale / 部分读 | 同 write 三类守卫                                                                                        |

## 语义钉子

- 匹配为 **LF 归一视图**（纯 CRLF 文件把 `\r\n` 归一后匹配），写回还原文件原换行符；
- **混合换行文件**（CRLF 与 LF 混存）只受理**单行**编辑——原样匹配，其余行换行纹丝不动；含换行的 `old_string` 报 `mixed_line_endings`（归一写回会改全文件换行，拒绝优于静默改变）；
- v1 纯精确匹配（模糊匹配阶梯挂账）；成功后刷新读态。
