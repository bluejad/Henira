# @henira/plugin-compaction

上下文压缩（D-091 / [compaction.md](../../docs/20-architecture/compaction.md)）：占 `compaction` 槽，
inject `["session", "llm", "config", "loop", "tools"]`，进 defaultPreset、属外圈官方件、可停用。
停用后**余量显示与输出封顶照常**（计量器与阈值住 loop/protocol）；带压缩事件的旧账本照常打开
（`compaction/*` 由 session 包注册为基础事件，写时标 `ignorable`）。

## 行为

- **压力触发**：每步 `loop/pre-step`，`used ≥ pressure` 时压缩；历史不足跳过（不算失败/触发）。
- **溢出恢复**：`loop/request-failed` 且错误码 `CONTEXT_OVERFLOW` 时压缩后原步重发；重发仍失败
  走无模型阶梯，仍救不了才上报原始溢出错误。
- **选区**：`(turn,step)` 的 assistant + tool 对为一个单元、user 消息各一个；尾部按 `retain` 保留；
  系统消息永不进区间；在途调用单元不可压；区间只向前推进；滚动摘要把上一份替换记录纳入新区间。
- **摘要请求**：与主循环同形（同模型 / 工具表 / 思考档 / 会话头；整段表面 + 末尾一条用户指令）。
  装不下四档降档：裁尾部 → 工具结果换头尾摘录 → 头部后一半 → 后 35%；先估后发。
  成功判据 = `finish=stop` + 正文非空 + 无工具调用 + 摘要小于被遮蔽量。
- **原子替换**：一条 `user/message{source:"compaction", surfaceOp:{op:"replace"}}`，写后核对返回类型；
  失败/中断落 `compaction/end`，成功落 `compaction/applied`（serial 总线）。
- **无模型阶梯**：工具结果超长的整步单元替换成 `compaction-digest` 摘要（不调模型，每次可见）。
- **熔断**：连续失败 3 次 / 快速回填连续第 3 次 → 总线 `compaction/breaker`（活态横幅）；手动成功解除。
- **手动压缩**：闲时 `m-…` 维护回合立即执行、忙时排队到步边界、在途重复拒绝；说明 ≤2000 码点；
  停止 = `LoopService.interrupt` 广播 `compaction/stop`。

## 文件 ↔ 设计

| 文件          | 职责                                                     | 设计出处                 |
| ------------- | -------------------------------------------------------- | ------------------------ |
| index.ts      | 触发 / 熔断 / 手动服务 / 事件落账 / `compaction/applied` | compaction.md §4.1–§4.10 |
| selection.ts  | 单元划分、尾部保留、系统与在途护栏、滚动摘要起点         | §4.5                     |
| summarizer.ts | 同形摘要请求、四档降档、发送前估算、成功判据             | §4.6                     |
| prompt.ts     | 英文摘要指令（分节 + 防注入 + 旧摘要 + 用户说明）        | §4.6                     |
| digest.ts     | 无模型阶梯：超长步单元替换                               | §4.9                     |

判据 ↔ 测试：`selection.test.ts`（尾部/在途/系统/滚动 4 例）、`summarizer.test.ts`（同形/裁剪/工具调用/
截断/空正文/I-7/中止 6 例）、`compaction.test.ts`（压力全链、溢出重发、熔断、小窗口 digest、手动三态、
停止 7 例）；协议侧 `context-budget.test.ts` / `context-meter.test.ts` / `projection-compaction.test.ts`，
session 侧 `derive-compaction.test.ts`。

## 边界

- 不做日常旧工具结果微压缩（另立默认关闭官方件）、预计算摘要、厂商原生压缩端点、图片卸载；
- `/compact` 文本命令等命令机制定稿；入口 = 余量面板按钮 + REST + SDK；
- 引擎消息恒英文（D-050）。
