# 调研：deepseek-harness（dsh）

> 调研日期：2026-11-11。对象：deepseek-harness 官方仓库（DeepSeek 开源，developer preview，MIT）。
> 性质：**设计参考存档**——实现完全独立，此处只沉淀思想与教训。

---

## 概况

- DeepSeek AI 官方开源的 agent harness，核心理念 **"everything-is-a-plugin"**，构建在自 vendored 的 Cordis 微内核上（~2700 行：context / events / fiber / registry / reflect）。
- pnpm monorepo，实际 **约 350 个 package**（348 个 `package.json`；三层 `packages/<组>/<包>` 结构），约 2100 个 TS 源文件，文档极全（60+ 篇）。

## 架构分层（自底向上）

| 层         | 内容                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| 插件微内核 | Cordis：Context、Service、5 种事件分发模式、fiber 生命周期、可逆 effect               |
| 核心 spine | core/session、core/system-prompt、core/tools、core/agent、core/agent-loop、core/scope |
| 能力组     | llm / shell / fs / sandbox / subagent / compaction / interaction / mcp …（每组多包）  |
| 产品组装   | bundle 包（base / web-app / headless / sdk-app …）＝ YAML patch 树                    |
| 入口       | apps/cli（dsh bin）、apps/web、apps/desktop；SDK 走 JSON-RPC 进程边界                 |

## 值得借鉴的 8 条（→ 已吸收进原则的标注）

1. **事件溯源会话日志 = 唯一事实源，模型历史派生而非存储**——13 种核心事件变体；`deriveMessages()`；`request/header` 快照可重建任意请求 → **P1**
2. **微内核刻意做小**（~2700 行后停手，其余全是普通插件，无特权 core）→ **P7**
3. **Capability Seam 三角色纪律**（Service Definition / Provider / Consumer）+ waterfall 事件做策略注入——LLM/沙箱/压缩都能被一个 provider 替换 → **P4/P8**
4. **Merge-extensible 类型**（SessionEventMap 等）：插件 declaration merging 扩词汇 + 封闭联合 assertNever 收尾——开放性与类型安全兼得 → **P1**（我们改用注册表 map 而非 declaration merging，运行时可扩展）
5. **每 agent scoped context**：子 context 的注册随 scope 销毁 unwind——per-agent 工具/提示隔离的优雅解 → v1 砍掉，复杂度不值
6. **审批 fail-closed 词表 + 日志审计对**（`unavailable` 显式存在且必须拒）→ **P5**
7. **如实上报的执行完备度**（sandbox `full | partial`，承认平台差距）→ 沙箱插件时参考
8. **SDK = 进程边界**（JSON-RPC 子进程，宿主语言无关、崩溃隔离）+ **profile/patch 的 row-id 覆盖模型**（配置系统最优雅的部分；**Reins 不采用该 patch 层，见 D-022**）→ v1 SDK 先做进程内 + HTTP，进程边界形态后续评估

## 应该避免的 5 个坑

1. **约 350 包的极端细分与配套机器**——契约/实现/策略/沙箱各自成包（fs 一族 7 包：fs / fs-local / fs-observation-policy / fs-sandbox + 三个工具包），再加生成式 catalog 与文档门禁（坑 2）。税在细过头与机器，**不在按族拆包**：按族拆我们已照抄、三角色分立的理念也已收（槽位进 protocol / 换实现走 D-048 / 策略叠服务外层，D-049）；不抄的只是"一个角色一个 npm 包"——包数跟真实实现数走，出现第二种实现（如沙箱版 fs）再拆包零迁移 → 我们拆到服务件 + 工具件为止、契约与实现同包（packages.md）
2. **流程与文档机器过重**——生成式 catalog + verify 门禁 + 双语文档 + 100% 覆盖率门禁，是大团队配置；小团队照抄会先死于基础设施
3. **会话格式"相邻迁移包链"**（v0→v1→…→v4 五个迁移包）——新项目用"版本检查 + 拒读未来版本"即可
4. **agent-loop 内聚过多精细语义**（705 行：surface node / in-history 更新 / request series / inbox 认领）——MVP 先做"每步全量重建请求"的朴素版本
5. **投机性通用机制**（PTC run_code、agent preset、HMR、动态插件 runner、`!!js` YAML loader）——成熟期产物，全部推迟；waterfall"必须调 next()"的隐式契约易写错，必须显式成文

## 对 Reins 的直接落点

- 事件词表 v0 起自对其 13 个核心事件的吸收，定稿扩为 15 个（session.md §2.2）
- **2026-11-11 重大更新**：Reins 决定采用其"一切可换"形态（D-010）——kernel（我们的精简 Cordis）+ protocol 为唯一不可替换层，官方语义插件（含 loop/approval）与社区插件同权可整包替换；但 **YAML patch 机器不搬**（D-011，TS API + reins.config.ts 替代）
- P7 微内核 = Cordis 概念的精简重写（砍 fiber/scope/HMR，事件模式 5→4：emit/serial/waterfall/bail）
- 审批 `Decision` 词表 = 其 approval.md 词表原样采纳

## 插件机制谱系（2026-11-12 补）

- **界面求值**：dsh `evaluateClientHalf`（`packages/extensions/cordis-client-runner/src/client/evaluator.ts:173-210`）用 `new Function` 求值 client 半，参数 `React/console/styles/host/harness/traps/process/Buffer`；host 门面 = dsh 的 `host.call` + host 半 `harness.handle` 配对压成一个对象。Reins **不取求值路线**（D-021 改 ESM 模块，不 eval）。
- **版本目录**：`<id>/<version>/` = dsh 的 Plugin → 不可变 Package（`cordis-host-runner/src/registry.ts:37-70`）；dsh 在内存、按会话所有，Reins 落盘为版本目录（版本级不可变，D-024）。
- **创建技能**：`plugin-creator` = dsh 的 `cordis-plugin-development` 技能（SKILL.md + `references/` + 可复制 `templates/`，`packages/preset/agent-preset/skills/`）。
- **祖宗自己转向了**：2026-09-16 note（`.agents/notes/implemented/architecture/2026-09-16-creator-persistent-plugin-management.md`）把模型侧 `cordis_define / run / stop / undefine / inspect_self` 全部退役，创造模式改走"AI 写 npm 组合包 + `cordis.patch.yml` → `plugin_manager install_bundle`"；e2e 断言这五个工具不在列表里（`apps/cli/tests/profiles/web/tests/creator-plugin-manager.expected.e2e.ts:76`）。→ Reins 的"AI 写文件、新会话生效"与祖宗演化同向。
- **内容读者不是"插件包里的槽位目录"**：dsh 是服务 + 全局根——skills 六根按 rank 扫（含项目 / 用户 `.agents/skills`，`docs/subsystems/skills.zh.md:66-77`）；MCP 每台服务器一条配置（`mcp.zh.md:24`）；commands 由插件代码注册（`commands.zh.md:29-53`）；hooks 只做 Claude Code / Codex 的桥（`hook-protocol`）。Reins 的"包内 content 目录 + 读者认领"与 dsh 不同，是自己的选择（D-017）。
- **落点**：D-020（技能只读根）、D-021（模块 + slot，不 eval）、D-022（无 patch 层）、D-023（内核自研 + 语义钉子）。
- **落点（2026-11-15 补）**：**D-049 能力服务化** = 借鉴第 3 条"Capability Seam 三角色纪律（Service Definition / Provider / Consumer）"的全量采纳——能力一律服务、工具件是纯消费者、按族分包（fs 契约/实现/策略/工具包的摆法即照此）；全库约 60 个服务的注入清单为此决策的实证底稿。
