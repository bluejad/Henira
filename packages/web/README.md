# @henira/web

React 19 正式宿主（D-038）：会话列表 / 事件流渲染 / 审批卡 / 输入框 / 设置页；**可嵌入**——`createWebApp({ client })` 注入 client（npm 用户 = @henira/sdk + @henira/web 两包组合，web 自身的宿主用法即注入同源 client 的特例，D-037）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) web 段（M3 定稿）+ 插件 UI 宿主门面段（14 方法 M3/M4 标注）
- 渲染架构：**哑渲染器**——行 store 应用 server 投影帧（快照整体替换 + 封闭增量 + 断档不猜），客户端零 reducer（组装逻辑唯一实现处在 server 投影器）
- 界面件来自 [@henira/plugin-web-ui](../../plugins/web-ui/README.md)：正常装载走 UI 模块激活（公共注册路径，判据④正向）；安全模式（双击 Alt / `?ui=safe`）不激活模块、直用编译期出口默认组合（同一零件库两条通道）；槽位级自动回退；未装件槽位收起
- 不 eval 插件源码（模块加载，D-021）
- 文案：全部经 locale 字典（zh 首发，D-050）；判据⑥机械闸 `pnpm check:ui-locale` 扫本包 + web-ui 代码零裸文案

## 用法

```ts
import { createWebApp } from "@henira/web";
import "@henira/plugin-web-ui/tokens.css";

const app = createWebApp({ client, layout: "full" }); // layout: full / center / composer / 自定义挑件
app.mount(el);
await app.dispose();
```

## 构建

- `dist/` = 库面（tsc；createWebApp / RowStore）
- `dist-web/` = 自托管 SPA 产物（vite build，`pnpm --filter @henira/web bundle`）：同源 client 连本机 server，server 静态托管（`henira serve` 自动发现 dist-web 并托管 `/`）
- `public/favicon.svg` = 标签页图标（Horse 品牌标，墨底暖纸色取 token）；`index.html` 以 `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` 引用；vite 原样拷进 dist-web，server 静态托管按扩展名出 `image/svg+xml`

## 文件 ↔ 设计

| 文件                   | 职责                                                                                                                    | 设计出处                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| store.ts               | 行 store：快照整体替换 + 封闭增量应用 + 断档不猜（跳号 / 缺行 → 重拉快照）；版本化视图（useSyncExternalStore 引用稳定） | interfaces.md server 段 SSE          |
| host.ts                | createWebApp：帧流消费 / PluginUiHost 门面 / UI 模块激活与安全模式切换 / 槽位挂根 / 双击 Alt                            | D-043 / 判据④ / packages.md 槽位归属 |
| slot-registry.ts       | 槽位登记簿：registerSlot（list 追加/order）+ replaceSlot（官方顶替/卸载回落）+ chain 登记与选举                         | D-057 / D-048 / D-062 / R182         |
| slot-vocabulary.ts     | 桌面 web 槽位词表与未知槽处置（词表外告警忽略；keyed 前缀识别）                                                         | D-033 / D-057 / D-062 / R186         |
| markdown.ts            | 正文 markdown 渲染（GFM / raw HTML 不渲染；settled 臂单实例一次成型）                                                   | D-057 正文不可插 / R188              |
| streaming-markdown.tsx | 流式增量 markdown：已完成顶层块按源偏移冻结复用，每帧只重渲尾段                                                         | R160 E2 流式增量管线                 |
| streaming-reveal.ts    | 逐词淡入排期纯函数（Intl.Segmenter + EWMA 估速 + 滞后窗）                                                               | E3 生命感 / R165                     |
| resource-pump.ts       | useResource 数据泵：同地址一份泵、2s 共享轮询、引用计数、失败保旧                                                       | D-064 / 判据⑤                        |
| ui-state-sanitize.ts   | 会话 ui-state 落盘前净化（内联 data: URI 图片 tab 剔除，避免 64KB 上限）                                                | D-063 / R188 审查                    |
| main.tsx               | 自托管 SPA 入口（同源 client + 全布局；`?ui=safe` / token 解析）                                                        | D-037 / 判据④                        |

## 测试 ↔ 判据

| 测试                        | 锁什么                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| store.test.ts               | 快照整体替换 / 引用稳定 / 增量四操作 / 断档不猜（跳号丢帧重拉 + 换发后水位重置）/ 缺行重拉  |
| host.test.tsx               | 正常装载三槽位在渲染（判据④正向）/ 安全模式同零件库 + 徽标 / layout=composer 挑件收起其余槽 |
| slot-registry.test.ts       | 官方顶替 / 第三方冲突 / 卸载回落 / chain 选举与置替                                         |
| slot-vocabulary.test.ts     | 词表名识别 / keyed 前缀 / 未知槽告警处置                                                    |
| resource-pump.test.ts       | 同地址共享泵 / 引用计数 / 失败保旧                                                          |
| markdown.test.tsx           | GFM / raw HTML 消毒 / 表格与代码块                                                          |
| streaming-markdown.test.tsx | 冻结块复用 / 尾段重渲 / 未闭合围栏                                                          |
| streaming-reveal.test.ts    | 逐词延迟排期 / EWMA / 回填判定                                                              |
| ui-state-sanitize.test.ts   | 内联图剔除 / 引用字段保留                                                                   |
