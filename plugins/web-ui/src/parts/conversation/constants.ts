// 对话滚动/翻页常量（R177 拆分）。

/** 离底容差（落点距底 <48px 视为贴底——参照实现 BOTTOM_ANCHOR_EPSILON_PX 同档） */
const BOTTOM_EPSILON_PX = 48;
/** 滚顶翻页触发距离（参照实现 LOAD_OLDER_TRIGGER_PX 同档） */
const LOAD_OLDER_TRIGGER_PX = 64;
/** 翻页单页行数（参照实现 snapshotTailWindowRows 同档；服务端钳 200） */
const PAGE_SIZE = 60;
/** jsdom 等无 ResizeObserver 环境降级全量渲染（组件测试不依赖布局） */
const VIRTUAL = typeof ResizeObserver !== "undefined";

export { BOTTOM_EPSILON_PX, LOAD_OLDER_TRIGGER_PX, PAGE_SIZE, VIRTUAL };
