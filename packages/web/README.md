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

- `dist/` = 库面（tsc；createWebApp / RowStore / Shell）
- `dist-web/` = 自托管 SPA 产物（vite build，`pnpm --filter @henira/web bundle`）：同源 client 连本机 server，server 静态托管（`henira serve` 自动发现 dist-web 并托管 `/`）

## 文件 ↔ 设计

| 文件      | 职责                                                                                                                    | 设计出处                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| store.ts  | 行 store：快照整体替换 + 封闭增量应用 + 断档不猜（跳号 / 缺行 → 重拉快照）；版本化视图（useSyncExternalStore 引用稳定） | interfaces.md server 段 SSE          |
| host.ts   | createWebApp：帧流消费 / PluginUiHost 门面（M3 实装子集 + M4 占位）/ UI 模块激活与安全模式切换 / 双击 Alt               | D-043 / 判据④ / packages.md 槽位归属 |
| shell.tsx | React 组装：槽位渲染 / 选中态 / 设置浮层（判据③：模型 / 主题 / 密钥）/ 主题接线                                         | D-050 / 判据③                        |

## 测试 ↔ 判据

| 测试          | 锁什么                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------- |
| store.test.ts | 快照整体替换 / 引用稳定 / 增量四操作 / 断档不猜（跳号丢帧重拉 + 换发后水位重置）/ 缺行重拉  |
| host.test.tsx | 正常装载三槽位在渲染（判据④正向）/ 安全模式同零件库 + 徽标 / layout=composer 挑件收起其余槽 |
