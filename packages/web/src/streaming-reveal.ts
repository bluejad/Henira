// 流式逐词淡入的排期纯函数（E3 生命感；机制与参数照抄参照物实现——file:line 底账在私有记忆
// approval-ui… 同批的四仓机制报告：Intl.Segmenter word + CJK 码点拆字、EWMA 估速、滞后窗
// clamp(80,250)、铺开 interval ≤40ms ≥15ms、回填判定 = 前缀 + 增量 ≤600 字符 + 尾 slack ≤8
// 非词字符）。只产出「每单元淡入延迟」的数据；DOM 包装在 streaming-markdown.tsx 的 rehype
// 插件里（span + data-henira-reveal + CSS 变量延迟；CSS 只动 opacity——首帧占满最终位置，
// 虚拟滚动测高稳定）。简化处诚实标注：参照物的 ceiling 项（总滞后封顶与剩余文长的耦合）
// 以 lag 直接铺开等价实现，视觉意图一致。

/** 排期参数（参照物实现值） */
const MAX_INTERVAL_MS = 40;
const MIN_INTERVAL_MS = 15;
const MIN_LAG_MS = 80;
const MAX_LAG_MS = 250;
const LAG_UNITS = 6;
const LAG_GAP_FACTOR = 1.5;
const PAUSE_MS = 300;
const RATE_ALPHA = 0.3;
const MAX_DELTA_CHARS = 600;

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const FALLBACK_WORD_RE = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** 词段化：word 粒度 + CJK/假名词内按码点拆字（参照物 bugfix：ICU 词典分词会把
 * 「拍板」「决策」合成一块，失去逐字效果）。返回单元 [start, end) 偏移表。 */
export function segmentRevealUnits(text: string): { start: number; end: number }[] {
  const units: { start: number; end: number }[] = [];
  const pushRange = (start: number, word: string): void => {
    if (CJK_RE.test(word)) {
      let cursor = start;
      for (const ch of Array.from(word)) {
        units.push({ start: cursor, end: cursor + ch.length });
        cursor += ch.length;
      }
    } else {
      units.push({ start, end: start + word.length });
    }
  };
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    // 模块级缓存单例？Segmenter 实例按 locale 无状态化使用——此处每次调用复用全局实例
    const segmenter = getSegmenter();
    for (const seg of segmenter.segment(text)) {
      pushRange(seg.index, seg.segment); // seg.index 是全文绝对偏移（不再叠加 cursor）
    }
    return units;
  }
  for (const match of text.matchAll(FALLBACK_WORD_RE)) {
    pushRange(match.index ?? 0, match[0] ?? "");
  }
  return units;
}

let segmenterSingleton: Intl.Segmenter | undefined;
function getSegmenter(): Intl.Segmenter {
  segmenterSingleton ??= new Intl.Segmenter(undefined, { granularity: "word" });
  return segmenterSingleton;
}

export interface RevealState {
  /** EWMA 估速（单元/秒）与间隔（ms）——消息级共享 */
  rate: number;
  gap: number;
  /** 最近一次到达时戳（ms；performance.now 系） */
  arrival: number;
  /** 跨帧浮现时钟（上一批排期末尾） */
  clock: number;
  /** 按 block 记的已排期进度：blockKey → 已排期到（block 内偏移）；cap 防长会话无界 */
  progress: Map<string, number>;
  /** 本帧排期结果：blockKey → 单元 block 内偏移 → 延迟 ms（插件只读） */
  plans: Map<string, Map<number, number>>;
  /** 帧号（advance 每次文本变化 +1；插件凭此去重提交） */
  frame: number;
}

export function createRevealState(): RevealState {
  return {
    rate: 0,
    gap: PAUSE_MS,
    arrival: 0,
    clock: 0,
    progress: new Map(),
    plans: new Map(),
    frame: 0,
  };
}

/** 回填判定（参照物同款）：前缀追加 + 增量 ≤600 字符才算流式增量——挂载/回填/切会话/
 * 模型重写一律整段 settled 不动画（绝不按旧进度裁剪正文）。 */
export function isIncrementalReveal(prev: string, next: string): boolean {
  return (
    next.length > prev.length &&
    next.length - prev.length <= MAX_DELTA_CHARS &&
    next.startsWith(prev)
  );
}

/** 提交一帧：EWMA 更新（消息级）+ 每个尾块排期。tailBlocks = 尾段块界（绝对偏移）；
 * now = 本帧到达时戳。返回新 state（不可变替换 progress/plans 外层——Map 内容按帧重建）。 */
export function commitFrame(
  prev: RevealState,
  prevText: string,
  nextText: string,
  tailBlocks: { start: number; end: number }[],
  now: number,
): RevealState {
  const state: RevealState = {
    rate: prev.rate,
    gap: prev.gap,
    arrival: prev.arrival,
    clock: prev.clock,
    progress: new Map(prev.progress),
    plans: new Map(),
    frame: prev.frame + 1,
  };
  // EWMA：gap ≤ 停顿阈值才更新估速（停顿后首批沿用停顿前速度——参照物同款）
  const delta = nextText.length - prevText.length;
  const gap = now - prev.arrival;
  if (prev.arrival > 0 && gap <= PAUSE_MS && delta > 0) {
    const instant = delta / Math.max(gap, 10);
    state.rate += (instant - state.rate) * RATE_ALPHA;
    state.gap += (gap - state.gap) * RATE_ALPHA;
  }
  state.arrival = now;

  // 每块排期：块内已排期进度之后的单元为本帧 fresh
  let clock = state.clock;
  for (const block of tailBlocks) {
    const key = String(block.start);
    const blockText = nextText.slice(block.start, block.end);
    const units = segmentRevealUnits(blockText);
    const prevRevealed = state.progress.get(key) ?? 0;
    const fresh = units.filter((u) => u.start >= prevRevealed);
    const delays = new Map<number, number>();
    if (fresh.length > 0) {
      const perUnit = state.rate > 0 ? 1 / state.rate : 30;
      const lag = Math.min(
        MAX_LAG_MS,
        Math.max(MIN_LAG_MS, Math.max(LAG_UNITS * perUnit, LAG_GAP_FACTOR * state.gap)),
      );
      // 铺开：lag 窗口均摊到 fresh 单元，interval 夹在 [15, 40]；时钟接上一批末尾
      const interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, lag / fresh.length));
      let start = Math.max(now, clock + interval);
      for (const unit of fresh) {
        delays.set(unit.start, Math.round(start - now));
        start += interval;
      }
      clock = start - interval;
      state.progress.set(key, blockText.length);
    }
    state.plans.set(key, delays);
  }
  // 进度表 cap（参照物同款：只有尾块变化，老块条目裁掉防无界）
  while (state.progress.size > 16) {
    const oldest = state.progress.keys().next().value;
    if (oldest === undefined) break;
    state.progress.delete(oldest);
  }
  state.clock = clock;
  return state;
}

/** 单元判定：block 内偏移是否本帧 fresh（插件包装 span 用） */
export function isFreshUnit(
  state: RevealState,
  blockKey: string,
  unitOffset: number,
): { fresh: boolean; delay?: number } {
  const plan = state.plans.get(blockKey);
  if (plan === undefined) return { fresh: false };
  const delay = plan.get(unitOffset);
  return delay !== undefined ? { fresh: true, delay } : { fresh: false };
}
