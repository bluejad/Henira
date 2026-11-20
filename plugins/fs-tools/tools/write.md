# write

- 归属：`@henira/plugin-fs-tools`（能力在 `@henira/plugin-fs`，D-065）
- 权限类：**写**（非只读）——无规则命中走审批链弹卡（permissions.json 规则 / 会话级允许可免）；凭据路径（`.env`、`credentials.json`、`*.pem`…）链外硬拒；区外路径 fs 服务层再加一道 floor ask（两卡为有意设计）

## 用途

创建或覆盖文本文件。父目录不存在自动创建；换行符按给定内容原样写（不改写）。

## 参数

| 参数        | 类型   | 必填 | 说明                     |
| ----------- | ------ | ---- | ------------------------ |
| `file_path` | string | ✓    | 绝对路径，或相对会话 cwd |
| `content`   | string | ✓    | 完整文件内容             |

## 输出样例

```
File created successfully at: <abs>
```
覆盖已有文件：

```
The file <abs> has been updated successfully. (file state is current in your context — no need to Read it back)
```

## 截断行为

无（写入内容不截断；工具结果本身走执行出口统一限量）。

## 错误情形（isError）

| 情形           | 文案要点                                                             |
| -------------- | -------------------------------------------------------------------- |
| 已存在且未读过 | `File has not been read yet. Read it first before writing to it.`    |
| 部分读后覆盖   | `File has not been fully read (the last read was partial). …`        |
| 读后被外部改动 | `File has been modified since read, … Read it again before writing.` |
| 凭据路径       | 判定链链前拒（`[permission:rejected]`，无审批审计对）                |

## 语义钉子

- 自己 write 过的文件读态已刷新 → 连续覆盖合法（refresh-on-write，主流实现同款）；
- 新建免读；写入为原子（tmp+rename）。
