# @henira/plugin-tools

tools 槽位官方插件：工具注册表 + 五段执行管线 + 统一出口限量。两条缝挂 ctx.events（`tools/pre-execute` / `tools/post-execute`，D-027 命名）；判定链经 ToolContext.requestPermission 消费（ToolContext 由 loop 装配，本包无 inject）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段 tools 部分
- 设计文档：[tools-approval.md](../../docs/20-architecture/tools-approval.md) §1.1 / §2 / §2.1（已定稿）
- 装载期 schema 校验：非法 JSON Schema 即抛（D-044）——装配层捕获后插件跳过 + 告警（D-029）

## 用法

```ts
import { toolsPlugin } from "@henira/plugin-tools";

createHarness().use(toolsPlugin({})); // options 全可省
ctx.get("tools").register(myTool); // start 后注册工具（ToolDefinition）
```

| options            | 缺省                  | 含义                                                     |
| ------------------ | --------------------- | -------------------------------------------------------- |
| `defaultTimeoutMs` | 不设                  | 工具执行超时（ms）——abort 是唯一取消出口，超时是可选加项 |
| `limits`           | 2000 行 / 50KB        | 统一出口限量（tools-approval §1.1）                      |
| `artifactsDir`     | 会话目录 `artifacts/` | 超限完整输出的落盘目录                                   |

判定链经 `ToolContext.requestPermission` 消费（由 loop 装配，本包无 inject）。

## 文件 ↔ 设计

| 文件        | 职责                                                                                                                                                                                                                                                                               | 设计出处                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| registry.ts | 注册查重 + ajv（draft-07）装载期编译——运行期参数校验用同一份编译产物；DuplicateToolError / InvalidToolSchemaError                                                                                                                                                                  | D-044 / tools-approval §2 parseArgs |
| pipeline.ts | 五段管线逐字落地：parseArgs → pre-execute（waterfall，GateVerdict 单调合并 deny > ask > allow）→ 判定链（requestPermission 带真实 callId，抛错 fail-closed）→ execute（abort 竞速：未启动即中止、已启动等自报结果；超时可选）→ post-execute；批执行 cap 10、连续安全并行、顺序回写 | tools-approval §2 / §2.1            |
| limits.ts   | 统一出口限量：默认 2000 行 / 50KB；截断在码点边界（不切代理对）；超限完整输出落盘留**相对会话目录**的路径（`artifacts/<callId>.txt`）+ 头部预览 + 截断尾注（P2 可见 / D-085）                                                                                                      | tools-approval §1.1                 |
| service.ts  | toolsPlugin（占 'tools' 槽，无 inject——判定链由 ToolContext 注入）                                                                                                                                                                                                                 | packages.md / tools-approval §1     |

## 测试 ↔ 判据

| 测试             | 锁什么                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| registry.test.ts | 查重 / 非法 schema 拒绝 / 声明式投影                                         |
| pipeline.test.ts | 五段顺序 / deny 链前拒 / ask 抬下限 / abort 竞速 / 批并行按序 / 超限截断落盘 |
| limits.test.ts   | 出口限量默认值 + UTF-8 代理对安全截断                                        |
