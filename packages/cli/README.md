# @henira/cli

命令入口（hosts.md §2：CLI 是命令路由不是界面）：读 config → 装配 → 跑。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) config-loader 段（loadConfig）+ [hosts.md](../../docs/20-architecture/hosts.md) §2 / §3
- 决策：D-018（`henira serve` 保留 v1；黑窗口聊天发布后）、D-037（`run` headless 进程内③，不单列排期随 cli）

## 命令

```sh
henira serve [--port N] [--host H] [--cwd DIR]   # 起 HTTP + SSE 宿主（①）；握手文件 ~/.henira/state/server.json
henira run "prompt" [--cwd DIR]                  # headless 一次性任务（③进程内，经 @henira/sdk）；busy=false 即退出
```

- 项目 `henira.config.ts`（可选，进 git）经 jiti 装载（CJS/ESM 通吃零构建）：`plugins` 清单的 definition 作为**额外引擎插件**追加装配（D-016① 加法）；`model` / `options` 听全局 settings 语义（data-directory §2.3）
- 输出纪律：引擎事件原样打印（英文永不本地化，D-050 第 2 款）；cli 框架行随 TUI / 聊天批进 locale 词表
- `run` 的会话目录落在 `~/.henira/projects/<key>/sessions/<id>/`（data-directory §4），`session.v1.jsonl` 可直接回放

## 文件 ↔ 设计

| 文件     | 职责                                                                                                          | 设计出处                         |
| -------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| index.ts | arg 解析 + 分发：serve（createServer + SIGINT 收尾）/ run（createRuntime + 事件流终端投影 + busy=false 退出） | D-018 / D-037 / hosts.md §2 / §3 |

## 测试 ↔ 判据

| 测试        | 锁什么                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| cli.test.ts | serve 点火车：spawn 真进程 → 握手文件出现 → GET /api/server/info 200 → SIGTERM 收尾握手删除（发现协议全链） |
