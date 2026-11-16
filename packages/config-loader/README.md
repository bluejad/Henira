# @henira/config-loader

config 槽位宿主实现：三文件装载（settings.json / permissions.json / credentials.json 0600）+ models.dev 模型参数字典 + 官方默认预设。引擎零网络零厂商表（P9-4）——字典同步只住本层。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) protocol 段 config 部分（model / get 异步，文件 backing）
- 设计出处：D-013②（宿主实现，llm / approval 不直接读 env 或文件）· D-040（字典：bundled 快照兜底 + 运行时拉取 + 本地缓存 + 手写覆盖）· [data-directory.md](../../docs/20-architecture/data-directory.md)（三文件位置与形状）

## 用法

```ts
import { createConfigService } from "@henira/config-loader";

const config = createConfigService({ cwd, globalDir }); // globalDir 缺省 ~/.henira/config；测试注入临时目录
createHarness().use({ name: "config", start: () => config }); // 宿主装配的常见形态（examples 同款）

const model = await config.model(); // settings.json 默认模型 → ModelConfig（字典预填参数）
const key = await config.credential(provider); // credentials.json；缺 → CredentialMissingError
```

| options      | 含义                                                |
| ------------ | --------------------------------------------------- |
| `cwd`        | 项目 cwd（会话工作区）                              |
| `globalDir`  | 全局配置目录（缺省 `~/.henira/config`）             |
| `fetchImpl?` | 测试注入 fetch；undefined = 不拉取，快照 / 缓存兜底 |

## 文件 ↔ 设计

| 文件          | 职责                                                                                                                                                                                                                                          | 设计出处               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| config.ts     | createConfigService：settings（默认模型 / 插件 options）/ permissions（非法行静默跳过）/ credentials（0600；CredentialMissingError；永不读 env）/ models.json 手写覆盖字典 / validateAttachments 入口校验（20MB / 5MB 图 / 50MB 总 / 100 个） | D-013② / D-030 / D-040 |
| dictionary.ts | models.dev 字典：bundled 快照（构建时修剪入库）+ 运行时 refresh + 缓存文件兜底；刷新失败静默回退快照                                                                                                                                          | D-040                  |
| preset.ts     | defaultPreset 出厂清单——M2 = 引擎 5 条 id-only（definition 由宿主 / examples 装配时注入运行参数）                                                                                                                                             | D-016                  |

## 测试 ↔ 判据

| 测试           | 锁什么                                                             |
| -------------- | ------------------------------------------------------------------ |
| config.test.ts | 三文件装载 / 凭据缺失报错 / 规则行过滤 / 字典查找与覆盖 / 附件校验 |
| preset.test.ts | 预设 5 条 id-only 形状                                             |
