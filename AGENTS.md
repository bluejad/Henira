# AGENTS.md

给在此仓库写码的 AI 与贡献者的总规矩。细节全在 docs/，本文件只放"忘了就出事"的部分。

## 这是什么

Henira = 开源 Agent Harness：内核只做机制，其余一切皆插件（含 agent 循环与审批本身）。当前状态见 [docs/INDEX.md](docs/INDEX.md)。

## 动码之前先读（按序）

1. [docs/INDEX.md](docs/INDEX.md) —— 总索引
2. [docs/20-architecture/principles.md](docs/20-architecture/principles.md) —— P1–P9 宪法
3. [docs/20-architecture/packages.md](docs/20-architecture/packages.md) —— 包边界与依赖方向
4. [docs/20-architecture/interfaces.md](docs/20-architecture/interfaces.md) 中**你要动的那个包**的小节
5. 该包相关 ADR（[docs/10-decisions.md](docs/10-decisions.md)，只追加）

对应 interfaces 小节未定稿，不写码；写码中发现接口形状问题，停下先改 interfaces.md 再继续。

## 术语

**界面**（永不叫"面板/panel"）；**工具 ≠ 插件**（工具是 ToolDefinition，永远不是插件）；包名 `@henira/*`；宿主 / 槽位 / 装配。全表见 docs。

## 硬红线（违反＝打回）

- 用户创建的插件包（engine/）不把 `@henira/kernel` / `@henira/protocol` 写进依赖表——宿主 import map 注入唯一实例（D-048；装载层拦截，M4 实装）。仓库内官方插件的契约依赖走 `@henira/protocol`，kernel 仅类型引用（devDependencies，packages.md 规则 2）；`pnpm check:deps` 拦插件互相 import 实现。
- 协议只收裸 JSON Schema，不建 zod 转换糖；zod 不进 kernel / protocol——官方事件校验器由 session 包实现（D-044 / D-051）。
- 一切引用可公开对证：来源只用 `[dsh]` / `[zcode]` / `[opencode]` / `[用户]`（词表唯一出处 = principles.md 顶部「来源标注」）；闭源产品仅行为层、不设标签；本地机器路径零出现（D-047）。
- 无特权 API：官方插件也走公共注册路径（P8）。
- 凭据只住 `config/credentials.json`，永不进代码、日志、事件、插件文件（D-030）。
- 新决策不闷头改码：先报项目所有者讨论，拍板后立 ADR；ADR 只追加不改写。

## 总纪律：先文档、再代码；更新亦然

改码必先改文档——五层贯穿：功能（功能文档获批 → 落码 → 改功能先改文档）；包（README 随包诞生 → 改包行为先改 README）；工具（工具 md 随包诞生 → 改工具行为先改它的 md）；接口（interfaces 小节定稿 → 写包）；决策（讨论拍板 → ADR 追加）。落码提交自带文档：新包提交含 README、新工具提交含 `tools/<名字>.md`，修改先改 md 再改码，md 没改的提交不完整（`pnpm check:docs` 机械闸，CI 同跑，D-052）。

## 代码组织

- 文件与函数按职责划界，不按行数：一个文件 = 一个用文件名说得清的职责；两类变化原因或两类知识挤进同一文件才拆（D-054）。
- 命名用领域词，禁 `utils` / `helpers` / `common` / `shared` 垃圾桶名。
- 模块划分照 packages.md 的族边界；每包文件布局随 interfaces.md 小节定稿，不临场发明。
- 依赖方向由 CI 拦，不靠自觉。

## CI 纪律

本地全绿不算数——CI 是唯一诚实的裁判。以下三条是 CI 两次真红、本地三次假绿换来的规矩：

- 构建缓存 / 产物永不入库：`.gitignore` 规则必须赶在首次提交之前立好——tracked 文件绕过 ignore，fresh clone 带着过期缓存必炸（tsbuildinfo 事故；这类雷本地永远看不见）。
- 异步断言禁固定 sleep：等不到的后台过程一律 `vi.waitFor(断言, { timeout, interval })` 轮询；时红时绿且与提交内容无关 = flaky 首要信号（docs-only 提交也红过一次 = 实证）。
- 闸门命令单独跑，不接管道：`a | b` 的退出码只看 `b`，`pnpm test | tail` 红了也显示绿——失败被绿洗（栽过 3 次）；`&&` 链不禁，失败短路传播。

## 文档粒度（跟物种走）

| 物种                | 粒度                                                                                                                             | 时点                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 功能                | **默认一份设计文档**（简单薄写、复杂厚写），先文档获批再落码                                                                     | 落码前                                          |
| 工具                | **一工具一 md**，住工具所在包 `tools/`（内容：用途 / 参数表 / 输出样例 / 截断行为 / 权限类 / 错误情形 / 参考实现出处 file:line） | 随包诞生                                        |
| 包                  | 一包一 README.md（职责一句话 / 槽位与契约出处 → interfaces 小节 / 文件 ↔ 设计映射 / 判据 ↔ 测试映射）                            | 随包诞生（npm 硬要求只是下限，不许欠账，D-052） |
| 设计契约            | 按关注点，docs/                                                                                                                  | 已有，落码前改小节                              |
| 决策                | ADR 追加（docs/10-decisions.md）                                                                                                 | 拍板即记                                        |
| 用户文档 / 升级指南 | 发布后按需长                                                                                                                     | M4 之后                                         |

`inputSchema.description` 是给运行时模型看的现场台词，与工具 md（维护者档案）并存，两个受众两张嘴，各写各的。

## 命令

| 用途         | 命令                                        |
| ------------ | ------------------------------------------- |
| 安装         | `pnpm install`                              |
| 全量校验     | `pnpm typecheck && pnpm test && pnpm build` |
| 单测（迭代） | 进对应包目录跑 vitest                       |
| Lint / 格式  | `pnpm lint` / `pnpm fmt`                    |
| 依赖方向检查 | `pnpm check:deps`（CI 同跑）                |
| 文档闸门     | `pnpm check:docs`（CI 同跑）                |

## 干活顺序

- 工序遵循 Superpowers 工作流（brainstorm → 计划 → worktree → TDD → 评审闸 → 收尾；github.com/obra/superpowers）。未装该 skill 的环境等效执行：先计划获批再动码、测试先行、评审不过不前进。
- 本仓库对接点：其"设计获批"＝对应 interfaces.md 小节（或功能设计文档）改定且项目所有者点头。
- 每包落码前先翻参考实现取 file:line——dsh / OpenCode / ZCode（公开仓库，出处见 [docs/30-research/](docs/30-research/)）；闭源产品（Claude Code）作行为层对照、不引源码路径（D-047）。本文件与任何文档不写本机克隆路径。

## 裁决与验收

- 冲突裁决：**docs ＞ 本文件 ＞ skill 工序**。例：外部架构教条说"先找库别手写"，本仓库 kernel 照自研（D-023）——docs 赢。
- 语义钉子测试（D-023）不许跳过、不许删；里程碑判据勾不满不算完成。
- 验证报告必须带扫描范围（扫了哪个根、剩几处合法命中），不许拿局部冒充全量。
- 修改本文件照 ADR 流程走，不顺手改。
