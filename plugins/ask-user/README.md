# @henira/plugin-ask-user

ask_user 官方引擎插件（R184）：模型执行中向用户提问的专用工具。机制取外部参考的「普通工具 await 答复、答复即工具结果」形态——与审批通道分离（权限请求是闭合裁决，澄清表单是自由输入）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段 interaction / server 段 QuestionRow
- 设计文档：[plugins.md](../../docs/20-architecture/plugins.md) §4 输入座位 chain 条目与工具卡键
- 审计对：`question/asked` + `question/settled`（经 session 槽落盘）；挂起/收答经 `interaction` 槽（kind `"question"`）
- 取消：用户取消 / 回合 abort / 交互服务缺席 → 工具收 Error 结果，回合继续；无墙钟自动收口，重启由 session repair 补 `question/settled{invalidated}`

## 用法

```ts
import { askUserPlugin } from "@henira/plugin-ask-user";

createHarness().use(askUserPlugin()); // inject: ["session", "tools", "interaction"]
```

工具 `ask_user` 标记 `isConcurrencySafe: true`：无副作用，且必须绕过审批默认链（否则提问前先弹审批卡）。

## 文件 ↔ 设计

| 文件     | 职责                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| index.ts | 工具 schema/运行时唯一性闸 · 挂起→答复→账本对 · 取消三路收口 · 答案归一（选项过滤/custom） |

## 测试 ↔ 判据

| 测试             | 锁什么                                                                            |
| ---------------- | --------------------------------------------------------------------------------- |
| ask-user.test.ts | schema 闸（重复 id/选项、header 长度）· 答复落账 · 取消/abort/缺席 · 无开回合拒绝 |
