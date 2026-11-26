// 上下文阈值与预算（compaction.md §4.3）：纯函数、零依赖。
// loop（输出封顶 / 余量读数）与压缩插件共用同一份常量——两处各算一套，压力线与
// 请求预算就会对不上（zcode compact/policy.ts:6-14 的注释警告的正是这件事）。
// 窗口取自「即将请求的模型」；观测上限把字典窗口拉回实际值（会静默截断的端点）。

/** 窗口未知时的缺省值（compaction.md §8 默认 3）：取大在静默截断端点上没有报错可依赖，
 *  取小只是压得早一点——取 128K */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** 余量比例与上下限：输出 + 估算误差（§4.3） */
export const CONTEXT_RESERVE_RATIO = 0.15;
export const MIN_RESERVE = 8_000;
export const MAX_RESERVE = 64_000;

/** 硬线 = 上限 − 1K（输出余量下限；到达即拒绝发送，§4.3） */
export const HARD_LIMIT_MARGIN = 1_000;

/** 输出基线：模型声明优先，未声明取 32K（§4.3） */
export const DEFAULT_OUTPUT_BASE = 32_000;

/** 摘要输出预算上限与指令预留（§4.3：min(20K, reserve − 2K)） */
export const SUMMARY_OUTPUT_MAX = 20_000;
export const SUMMARY_INSTRUCTION_RESERVE = 2_000;

/** 尾部保留：clamp(floor(上限 × 0.12), 4K, 32K)（§4.5） */
export const RETAIN_RATIO = 0.12;
export const MIN_RETAIN = 4_000;
export const MAX_RETAIN = 32_000;

/** 可压缩头部下限：max(4K, 上限 × 0.05)（§4.5） */
export const HEAD_MIN_RATIO = 0.05;
export const MIN_HEAD = 4_000;

/** 预警窗口：压力线下方 10%（§4.11） */
export const WARNING_WINDOW_RATIO = 0.1;

export interface ContextBudget {
  /** 字典窗口（未声明 = 128K） */
  window: number;
  /** 窗口是否来自模型声明：未知时阈值仍按缺省 128K 算，但输出封顶不介入（§4.3） */
  windowKnown: boolean;
  /** 上限 = min(window, 观测上限) */
  limit: number;
  /** 输出 + 估算误差预留 */
  reserve: number;
  /** 压力线：到达即压缩 */
  pressure: number;
  /** 硬线：到达即拒绝发送 */
  hardLimit: number;
  /** 输出基线 = min(模型声明 ?? 32K, 观测输出上限) */
  outputBase: number;
  /** 摘要输出预算 */
  summaryOut: number;
  /** 尾部保留量 */
  retain: number;
  /** 可压缩头部下限 */
  headMin: number;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** 上限 = min(字典窗口, 观测上限)；观测上限缺省不参与 */
export function contextLimit(window?: number, observedLimit?: number): number {
  const declared = positiveInt(window, DEFAULT_CONTEXT_WINDOW);
  const observed = positiveInt(observedLimit, declared);
  return Math.min(declared, observed);
}

export interface ContextBudgetInput {
  contextWindow?: number;
  /** 进程内学到的实际上限（静默截断端点，§4.2） */
  observedLimit?: number;
  maxOutputTokens?: number;
  /** 进程内学到的实际输出上限（第③类参数错，§4.3） */
  observedOutputLimit?: number;
}

export function contextBudget(input: ContextBudgetInput = {}): ContextBudget {
  const windowKnown =
    input.contextWindow !== undefined &&
    Number.isFinite(input.contextWindow) &&
    input.contextWindow > 0;
  const limit = contextLimit(input.contextWindow, input.observedLimit);
  const reserve = clamp(
    Math.floor(limit * CONTEXT_RESERVE_RATIO),
    Math.min(MIN_RESERVE, Math.floor(limit / 4)),
    MAX_RESERVE,
  );
  const outputBase = Math.min(
    positiveInt(input.maxOutputTokens, DEFAULT_OUTPUT_BASE),
    positiveInt(input.observedOutputLimit, Number.POSITIVE_INFINITY),
  );
  return {
    window: positiveInt(input.contextWindow, DEFAULT_CONTEXT_WINDOW),
    windowKnown,
    limit,
    reserve,
    pressure: limit - reserve,
    hardLimit: limit - HARD_LIMIT_MARGIN,
    outputBase,
    summaryOut: Math.min(SUMMARY_OUTPUT_MAX, Math.max(0, reserve - SUMMARY_INSTRUCTION_RESERVE)),
    retain: clamp(Math.floor(limit * RETAIN_RATIO), MIN_RETAIN, MAX_RETAIN),
    headMin: Math.max(MIN_HEAD, Math.floor(limit * HEAD_MIN_RATIO)),
  };
}

/** 主请求的输出封顶（§4.3）：只在剩余窗口小于基线时带 max_tokens；剩余非正 / 窗口未知不带。
 *  必须取整：估算器是浮点，AI SDK 的 maxOutputTokens 只接受整数（真 key 验收抓到）。 */
export function capOutputTokens(used: number, budget: ContextBudget): number | undefined {
  if (!budget.windowKnown) return undefined;
  const remaining = Math.floor(budget.hardLimit - used);
  if (remaining > 0 && remaining < budget.outputBase) return remaining;
  return undefined;
}

/** 预警线：压力线下方 10% 窗口的起点（§4.11；进入即提示「距自动压缩还差 N%」） */
export function warningThreshold(budget: ContextBudget): number {
  return budget.pressure - Math.floor(budget.limit * WARNING_WINDOW_RATIO);
}

/** 距压力线还差百分之几（§4.11：N = max(0, floor((pressure − used) ÷ size × 100))) */
export function percentUntilPressure(used: number, budget: ContextBudget): number {
  return Math.max(0, Math.floor(((budget.pressure - used) / budget.limit) * 100));
}
