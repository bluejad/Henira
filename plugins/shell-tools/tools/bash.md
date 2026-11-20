# bash

- 归属：`@henira/plugin-shell-tools`（能力在 `@henira/plugin-shell`，D-065）
- 权限类：**非只读**（默认 ask）——灾难操作硬拒链外生效（`rm -rf /`、`mkfs`、`dd`、fork bomb、`shutdown`、`format X:`、`diskpart`…）；`commandPrefix` / `commandContains` 规则可预放行（permissions.json）

## 用途

跑一条 bash 命令。每次调用都是**新 shell**（shell 状态、函数、export 不跨调用持久；cd 也不持久）。构建、git、包管理器等终端任务用它。

## 参数

| 参数      | 类型    | 必填 | 说明                                      |
| --------- | ------- | ---- | ----------------------------------------- |
| `command` | string  | ✓    | bash 命令串                               |
| `timeout` | integer |      | 超时 ms（默认 120000，上限 600000，钳制） |

## 输出样例

```
42
```
非零退出：

```
node: …
[exit code: 7]
```
带 stderr：

```
stdout 内容
[stderr]
报错内容
[exit code: 1]
```

## 截断行为

- 每流（stdout / stderr）服务层保留**尾部 20KB**，头部丢弃时渲染 `(output truncated — kept last 20KB)`；
- 换行统一为 `\n`。

## 错误情形（isError）

| 情形           | 文案要点                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| bash 不在 PATH | `bash was not found on PATH; install Git for Windows (provides bash.exe) or use the powershell tool`（Windows）/ `bash was not found on PATH`（posix） |
| cwd 不存在     | `cwd does not exist or is not a directory: "<abs>"`                                                                                                    |
| 空命令         | `command must be a non-empty string`                                                                                                                   |

## 语义钉子

- **非零退出码不是 isError**——`[exit code: N]` 计入内容，由模型判读（spawn 级失败才 isError）；
- 超时杀进程树（win32 `taskkill /T /F`；posix TERM → 3s → KILL），`[timed out after Xms]` + 部分输出照返；
- env：父环境 + `NO_COLOR/TERM/PAGER/GIT_PAGER` 输出净化覆盖 + `HENIRA_PROJECT_DIR`；**不洗敏感名**（审批链是闸）。
