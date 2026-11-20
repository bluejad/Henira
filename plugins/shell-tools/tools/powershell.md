# powershell

- 归属：`@henira/plugin-shell-tools`（能力在 `@henira/plugin-shell`，D-065）
- 权限类：**非只读**（默认 ask）——同 bash（灾难硬拒清单含 Windows 命令：`format X:` / `diskpart` / `del /f C:\`…）

## 用途

跑一条 PowerShell 命令（Windows 场景首选）。每次调用都是新 shell；执行参数
`-NoLogo -NoProfile -NonInteractive -Command`（无 profile、非交互——产出稳定可解析）。

## 参数

| 参数      | 类型    | 必填 | 说明                                      |
| --------- | ------- | ---- | ----------------------------------------- |
| `command` | string  | ✓    | PowerShell 命令串                         |
| `timeout` | integer |      | 超时 ms（默认 120000，上限 600000，钳制） |

## 输出样例

```
ps-ok
中文
```

## 截断行为

同 bash：每流尾部 20KB + 截断注记；`[exit code: N]` / `[timed out after Xms]` 同款。

## 错误情形（isError）

| 情形                   | 文案要点                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| pwsh / powershell 都缺 | `neither pwsh nor powershell was found on PATH; install PowerShell or use the bash tool` |
| cwd 不存在 / 空命令    | 同 bash                                                                                  |

## 语义钉子

- 可执行探测：pwsh 7+ 优先，回落 Windows PowerShell 5.1（结果进程级缓存）；
- **UTF-8 输出包装**：命令前注入 `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; `——5.1 默认控制台代码页会让中文输出乱码；
- 非零退出码不是 isError、env / 超时 / 杀树语义与 bash 完全一致（同一服务实现）。
