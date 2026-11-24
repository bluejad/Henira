# @henira/config-loader

config 槽位宿主实现：配置装载（settings.json / permissions.json / credentials.json 0600 + `henira.config.ts` 可选装载 + 插件目录发现）+ models.dev 模型参数字典 + 官方默认预设。引擎零网络零厂商表（P9-4）——字典同步只住本层。

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

| 文件           | 职责                                                                                                                                                                                                                                                                    | 设计出处                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| config.ts      | createConfigService：settings（默认模型 / 插件 options）/ permissions（非法行静默跳过；R199 委托 permissions.ts）/ credentials（0600；CredentialMissingError；永不读 env）/ models.json 手写覆盖字典 / validateAttachments 入口校验（20MB / 5MB 图 / 50MB 总 / 100 个） | D-013② / D-030 / D-040 / D-082  |
| permissions.ts | 权限规则文件：三态读取（ok/missing/corrupt + invalidCount、canonical 去重）/ 添加（canonical 幂等、坏文件拒绝）/ 删除（命中全部、未命中不写盘、保留原始条目与顶层字段）/ 唯一 tmp + EPERM 重试 / 项目与全局路径 helpers                                                 | D-081 / D-082                   |
| dictionary.ts  | models.dev 字典：bundled 快照（构建时修剪入库）+ 运行时 refresh + 缓存文件兜底；刷新失败静默回退快照                                                                                                                                                                    | D-040                           |
| preset.ts      | defaultPreset 出厂清单——13 条官方默认件（引擎 5 + fs 3 + shell 2 + breaker + ask-user + mcp；definition 由宿主 / examples 装配时注入运行参数）                                                                                                                          | D-016 / D-058 / D-065           |
| load.ts        | `henira.config.ts` 装载（jiti，CJS/ESM 通吃；缺文件 = 空配置，官方出厂清单照走；只读不装配）                                                                                                                                                                            | D-011 / D-015 / D-016           |
| discovery.ts   | 插件目录发现与引擎模块装载：scanPlugins（纯文件读，不执行）/ loadEngineModule（jiti + alias 唯一实例）/ 清单校验与引擎兼容门；失败跳过不挡启动                                                                                                                          | plugins.md §2 / §3 / §5 / D-048 |
| mcp-expand.ts  | MCP 声明 → 工厂入参的共享展开（server 与 sdk 同函数；凭据由宿主读好传入，展开值不进日志/响应/账本）                                                                                                                                                                     | D-064 / D-030                   |
| ui-assets.ts   | 界面资产扫描：已装插件 locales/_.json + themes/_.css（server 端点与 sdk runtime 共用唯一实现）                                                                                                                                                                          | D-059                           |

## 测试 ↔ 判据

| 测试                | 锁什么                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| config.test.ts      | 三文件装载 / 凭据缺失报错 / 规则行过滤 / 字典查找与覆盖 / 附件校验                                                                                |
| permissions.test.ts | R199 三态读取（ok/missing/corrupt + invalidCount）/ canonical 幂等 / 删除保留其余原始条目与顶层字段 / 未命中不写盘 / 坏文件拒绝（原文件字节不变） |
| preset.test.ts      | 预设 13 条官方默认件形状（引擎 5 + fs 3 + shell 2 + breaker + ask-user + mcp）                                                                    |
| discovery.test.ts   | 插件发现 / 清单校验 / 引擎兼容门 / 装载失败跳过                                                                                                   |
| mcp-expand.test.ts  | MCP 声明展开 / 凭据注入 / 不泄漏                                                                                                                  |
| ui-assets.test.ts   | 语言包/主题包扫描 / 坏名跳过                                                                                                                      |
