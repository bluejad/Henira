# 调研：2025–26 开源 Agent Harness 格局

> 调研日期：2026-11-11。性质：市场事实存档。
> **项目定位声明（用户定论）：目的不是占生态位，而是做自己的**——本调研不驱动差异化设计，仅作背景事实。

---

## 生态位地图

| 生态位            | 占领者                                                                                                                                           | 要点                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Coding agent 产品 | Claude Code / Codex（闭源标杆）；OpenCode（开源多 provider，~226k★）；pi（极简可定制，~121k★）；Letta Code（记忆优先，~25k★）；Goose（中立治理） | 产品形态竞争激烈                                     |
| 循环原语 / SDK    | Vercel AI SDK（TS 事实标准）；OpenAI Agents SDK JS                                                                                               | 只给 loop+tool，其余自理                             |
| 全家桶框架        | Mastra（~29.5k★）；VoltAgent（~10.9k★）                                                                                                          | 社区普遍抱怨"重、耦合深、文档跟不上"                 |
| 图编排 / 持久执行 | LangGraph.js                                                                                                                                     | durable state 强但样板重；"简单循环用它是杀鸡用牛刀" |
| 云运行时          | Cloudflare Agents（Durable Object 即 agent）；Vercel eve（文件约定 + 审批 + channels）                                                           | 绑定各自平台                                         |
| 厂商 SDK          | Claude Agent SDK（锁定抱怨重灾区："规则一夜变更"）；DeepSeek Harness（极端插件制，2026-08 预览）                                                 | —                                                    |
| 协议互操作        | MCP（工具）、ACP（编辑器↔agent）、A2A（agent↔agent）                                                                                             | 正成为 harness 的"USB 接口"                          |
| 配套层            | Langfuse / Promptfoo / E2B（可观测/评测/沙箱）                                                                                                   | 基本都在 harness 之外独立成层                        |

## 有证据的未被满足需求

1. **会话持久化 / 回放 / 可移植**——OpenCode 大 codebase 上下文退化 + resume 粗糙是高频抱怨；各家 thread 模型互不兼容（openai/codex#6402 社区自发提案统一 headless coder SDK，官方无人认领）
2. **治理层**——winder.ai 判断"压缩类功能会随模型进步消解，治理层（权限/沙箱/预算/审计）会长期存在"；pi 明确不做权限（故意留白）；OpenCode 默认放行风格被点名批评
3. **人机协同审批统一状态机**——各家 suspend/resume 语义各异、与会话持久化脱节
4. **评测内建**——"agent 项目最常缺的就是评测套件"（改 harness 全靠感觉）
5. **稳定性本身**——Manus 六个月重写五次 harness、LangChain 一年重构三次；"承诺稳定核心语义 + 增量演进"有信任空间
6. **Letta 在 Terminal-Bench 2.0 用 Anthropic 自家模型击败 Claude Code**——"harness 比模型更重要"的最强实证

## 对 Reins 的意义（背景参考，非设计驱动）

- 我们的"事件溯源内核 + fail-closed 治理"路线恰好落在 1/2/3 号空位的交集上——这是**顺带**的结果，不是出发点；
- AI SDK 做默认适配（D-007）与其"循环原语"位互补：它管 provider，我们管会话/治理/循环语义；
- 插件化哲学与 dsh/pi 同向，但我们是"内核最小化 + 官方插件同权、一切可换是产品承诺（D-010 / D-048）"，而非 pi 的"什么都不带"或 dsh 的"整机焊死出厂、替换走 bundle 补丁"。
