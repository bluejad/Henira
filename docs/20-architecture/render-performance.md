# 对话渲染性能（当前事实）

> 渲染边界与更新隔离的底账（D-061，2026-11-18 批 A' 落地）。照 ZCode
> docs/chat/message-render-performance.md 的文档先例，自家写法——长会话不卡是发布品质的一部分，
> 不是可选优化。

## 渲染链

```text
快照（尾窗 60）/ SSE 增量帧
  → RowStore（行引用不可变：未变行同引用、变化行新对象）
  → buildTurnUnits（按 turn 分组，O(n) 轻循环——history/tail 分区缓存挂账实测）
  → react-virtual（虚拟单位 = 轮；只挂可视窗 ± overscan 2）
  → TurnBlock → RowView（memo：row + t + host + slots 稳定子集比较）
```

- **数据面**：快照尾窗 60 + `GET /rows` 翻页（before = rowSeq 排他、页不切轮、服务端钳 200）；
  `totalRows` 客户端自持、`hasOlder` 派生 `totalRows > rows.length`（快照帧只发一次——派生化防过期）。
- **DOM 面**：只挂可视窗 ± overscan 2 的轮块（absolute + translateY + measureElement 回写实高；
  estimateSize 一屏兜底）。几百轮会话 DOM 节点数恒定在几十。
- **提交面**：行引用契约让 memo 跳过未变行——流式帧只有最后一行重渲。
  ctx 本体每渲染都是新对象（宿主 spread），memo 比较函数必须拆稳定子集（row + t + host + slots）。

## 更新隔离契约

- **bottom-follow**：解除只由明确上滚手势触发（wheel deltaY<0 / touchmove 手指下移 / ArrowUp、
  PageUp、Home——capture 阶段先于 scroll）；恢复只看落点距底 <48px；回底按钮 =
  `!following && rows > 0`。程序化写入（贴底、补位、回底）永不误解除。
- **翻页补位**：前插发生在 layout effect 判首块 key 变化时 `scrollTop += scrollHeight 差值`——
  正在看的内容不跳。跟随中的贴底语义优先（真实用户滚顶必先有上滚手势解除跟随）。
- **会话切换**：内层时间线以 sessionId 为 React key 整体重挂——测高缓存换代（turnId 跨会话
  可重复，缓存串号会错位）；跟随重置贴底。
- **jsdom 降级**：无 ResizeObserver → 全量渲染（组件测试不依赖布局）；真浏览器行为由 e2e
  锁定（用例④：尾窗 / 挂载块数 / 翻页块内容 / 位置稳定 / 回底）。
- **不破坏的底线**（同 ZCode 红线）：不合并 seq、不丢 row action、不让 store 出现第二份消息数组、
  不以「看起来没卡」代替帧内断言。

## 环境差异实证（坑册）

- React 19 的 `onScroll` 合成事件对**非冒泡 scroll 委托失效**——真浏览器才暴露（jsdom
  fireEvent 直走 React 事件系统测不出，「jsdom 不替代」第三次实证）。滚动裁决用原生
  `addEventListener("scroll", { capture, passive })` + ref 转发最新闭包。
- web 包从 plugin-web-ui 的 **dist** 消费：改 web-ui 后必须 `pnpm build`（tsc）再
  `pnpm --filter @henira/web bundle` 再跑 e2e——否则 bundle 吃旧代码（诊断三轮白跑的根因）。

## 挂账（触发即做，不预建）

- history/tail 分区缓存（ZCode WeakMap 先例）：流式帧派生成本实测疼了再做——当前 O(n) 分组循环
  微秒级。
- 侧栏阈值虚拟化（ZCode >80 行先例）：折叠组天然不渲染子行 + 行 memo 已覆盖；触发信号 =
  几百会话场景或实测卡顿。
- JSONL 倒序窗口读：磁盘会话翻页暂全读重建（每页一次 IO）——大日志实测慢了再做。
- 数值档位全部取 ZCode（尾窗 60 / 页 60 / 钳 200 / overscan 2 / 离底 48px / 触发 64px），
  出处见 D-061。
