# @henira/plugin-fs

fs 服务件（占 `fs` 槽，D-049 / D-065）：文件能力（read / write / edit / glob / grep）+ **路径围栏**——
围栏跟着能力走（D-049 修订 D-039），注入者（官方工具件 / 第三方引擎件）一律经同一份守卫；
读态守卫（read-before-mutate）同层持有。本件**不注册任何工具**（工具件在 fs-tools / fs-search）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) §fs（FsService / 围栏语义 / 读态守卫 / 第二实现思想实验）
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-065；安全语义 D-039 / D-049

## 语义钉子

- **围栏强制点唯一在服务层**：区内直行（判定链照常——凭据 / 灾难硬拒不受影响）；区外 → 经 `gate.requestPermission(floor:"ask")` 走判定链弹卡；区外 write / edit 会见两张卡（链卡 + 区外卡），有意为之（fail-closed 显式二次确认）
- **词法围栏**：相对路径按会话 cwd 解析、win32 大小写不敏感、`~` 展开到 home；是给模型的护栏不是对抗恶意进程的沙箱（审批链才是闸；symlink 真实归属检查挂账）
- **读态守卫**：write / edit 已存在的文件必须先 read；读后被外部改动（mtime 变）→ 拒并提示重读；部分读（offset / limit 或字节帽截断）不满足覆盖条件；write / edit 成功后刷新读态（refresh-on-write，无需回读）
- **edit 唯一性**：old_string 必须唯一命中（未 replaceAll 且多命中 → 报错带计数）；LF 归一匹配、保留文件原换行符；空 new = 删除
- **帽**：read 默认/上限 2000 行、每行 2000 字符、选区 50KB；glob 上限 100（mtime 降序）；grep head_limit 默认 250、跳二进制与 >10MB 文件
- **第二实现思想实验（D-049）**：进出全为字符串 / 结构化数据、零 Node 句柄零流——沙箱 fs 同槽替换时围栏从「区外问」变硬 containment，工具件与注入者零改动

## 用法

```ts
import { fsPlugin } from "@henira/plugin-fs";

// 围栏根 = 会话 cwd（inject config）；工具件与第三方件注入同一份服务
createHarness().use(fsPlugin());
const fs = ctx.get("fs");
const { absolute, inside } = fs.resolve("src/a.ts");
await fs.read("src/a.ts", gate, { offset: 1, limit: 100 });
```

## 文件 ↔ 设计

| 文件            | 职责                                              | 设计出处                         |
| --------------- | ------------------------------------------------- | -------------------------------- |
| index.ts        | 工厂（占 fs 槽、inject config）+ 服务组装         | D-065 / interfaces.md §fs        |
| fence.ts        | 词法围栏（resolve / 区内外 / tilde / 区外放行口） | D-065 决定 1 / D-039             |
| capabilities.ts | read / write / edit + 会话读态（三类守卫）        | D-065 决定 2 / tools-approval §3 |
| search.ts       | glob / grep（JS 引擎）+ 目录行走共享器            | D-065 决定 3                     |

判据 ↔ 测试：`fs.test.ts`（围栏 5 + 读写改守卫 6）与 `search.test.ts`（glob/grep 6）——停用本服务 → fs 工具全体缺席（server.test「能力服务装载强制」，M4 判据③）。
