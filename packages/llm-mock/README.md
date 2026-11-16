# @reins/llm-mock

测试支撑包：llm 槽位的脚本化 mock。不是插件、不占官方件计数；消费者仅 devDependencies（[packages.md](../../docs/20-architecture/packages.md) 规则 2 的测试支撑条款，[50-open.md](../../docs/50-open.md) 归档 2026-11-16）。

- 用法：`mockLlm(script)` —— 脚本条目按调用次序消费（事件数组 / AsyncIterable / 函数（收 `(req, signal)`）/ `"hang"` / `Error`），尾部函数条目兼作兜底应答器；`requests[]` 捕获全部模型请求供断言；造事件辅助 `mockText / mockReasoning / mockToolCall / mockUsage / mockFinish`。
- 契约出处：直接实现 [interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段的 `LlmService`——槽位级 mock，不碰 HTTP（[dsh] 槽位级 MockAdapter 同构）。
- 失败语义（〔dsh packages/test-support/llm-mock-server/README.md "What can go wrong" 同款〕）：脚本耗尽且无兜底函数条目 → 直接报错（测试脚本 bug，非引擎错误）；`"hang"` 挂起只会以 abort 拒绝收场——由测试用 signal 掐停。

## 文件 ↔ 设计

| 文件    | 职责                                                                                                                                                                  | 设计出处                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| mock.ts | 脚本引擎 + 序列自校验——静态数组条目在构造期校验 P3 三不变量（finish 至多一条且居尾 / usage 先于 finish / tool-call 集中在结构事件前），脚本写错 mock 侧就报，不进测试 | interfaces.md protocol 段 P3 / roadmap M2 判据⑥ |

## 测试 ↔ 判据

| 测试         | 锁什么                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- |
| mock.test.ts | 脚本消费次序 / 兜底函数 / hang-abort / Error 条目 / P3 自校验各条（roadmap M2 判据⑥构造侧） |
