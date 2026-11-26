// 计量器（compaction.md §4.2）：纯函数——读数来自账本，重放得同一读数。
// 锚点 = 最近一条 inputTokens 为正的 step/end；锚后只估算增量。估算与
// deriveMessages() 走同一份表面（I-1），所以替换、key 去重、孤儿合成都自动反映。
// k（会话自校正）与观测上限是运行态，由调用方（loop）持有；本文件只给纯计算与单侧更新。

import type { ContextBudget } from "./context-budget.js";
import type { SessionEvent } from "./envelope.js";
import type { TokenUsage, WireToolSchema } from "./llm.js";
import type { SurfaceEntry } from "./services.js";
import { estimateMessage, estimateTools } from "./token-estimate.js";

export interface MeterAnchor {
  /** 该步 request/header 的 seq（原步重发取最后一条） */
  headerSeq: number;
  /** 表面切点：该步 assistant/message 的 seq；被掐的步取 headerSeq */
  cutSeq: number;
  input: number;
  output: number;
  reasoning: number;
  /** 该步是否回传了历史 reasoning（request/header.params.echoReasoning） */
  echo: boolean;
  model: string;
  cacheRead?: number;
}

export interface ContextParts {
  system: number;
  tools: number;
  messages: number;
}

export interface ContextReading {
  used: number;
  /** 上限（= min(字典窗口, 观测上限)）——圆环分母 */
  size: number;
  pressure: number;
  hardLimit: number;
  /** true = 无可用锚点，整面都是估算 */
  estimated: boolean;
  /** 缓存命中率 = cacheRead ÷ input（取不到不带） */
  cacheHitRate?: number;
  /** 按来源分段，恒为估算；三段之和 = used（差额并入 messages） */
  parts: ContextParts;
  /** 截断嫌疑（compaction.md §4.2 / F-13）：厂商读数低于预期——只提示，不学上限；
   *  连续两次嫌疑且读数持平才确认（确认后 size 变成本次读数学出的观测上限） */
  suspicion?: { expected: number; actual: number };
}

export interface MeasureInput {
  events: readonly SessionEvent[];
  /** session.deriveSurface() —— 与 deriveMessages() 同一份折叠，每条形如 { seq, message } */
  surface: readonly SurfaceEntry[];
  tools: readonly WireToolSchema[];
  /** 即将请求的模型（provider/model）；与锚点不同则锚点作废 */
  model: string;
  budget: ContextBudget;
  /** 会话自校正系数（只上调，钳 1.0–1.5） */
  k: number;
}

export interface MeasureResult {
  reading: ContextReading;
  /** 本次可用的锚点（无效或缺席时 undefined） */
  anchor?: MeterAnchor;
  /** 相对锚点的估算增量（used − anchor.input）；k 更新与截断嫌疑都用它 */
  estimateDelta?: number;
  /** 表面代次 = 已接受替换记录数；k 更新与嫌疑判定在代次变化时跳过 */
  surfaceGeneration: number;
}

function stepKey(turn: unknown, step: unknown): string | undefined {
  return typeof turn === "string" && typeof step === "number" ? `${turn}:${step}` : undefined;
}

function usageOf(event: SessionEvent): TokenUsage {
  return (event.data as { usage?: TokenUsage }).usage ?? {};
}

export function measureContext(input: MeasureInput): MeasureResult {
  const { events, surface, tools, model, budget, k } = input;

  const headers = new Map<string, SessionEvent>();
  const assistants = new Map<string, SessionEvent>();
  let lastPositive: { key: string; event: SessionEvent } | undefined;
  let surfaceGeneration = 0;
  let lastReplaceSeq = 0;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    if (event.type === "request/header") {
      const key = stepKey(data.turn, data.step);
      if (key !== undefined) headers.set(key, event);
      continue;
    }
    if (event.type === "assistant/message") {
      const key = stepKey(data.turn, data.step);
      if (key !== undefined) assistants.set(key, event);
      continue;
    }
    if (event.type === "step/end") {
      const key = stepKey(data.turn, data.step);
      if (key === undefined) continue;
      const usage = usageOf(event);
      if ((usage.inputTokens ?? 0) > 0) lastPositive = { key, event };
      continue;
    }
    const op = (data.surfaceOp as { op?: unknown } | undefined)?.op;
    if (op === "replace") {
      surfaceGeneration += 1;
      lastReplaceSeq = Math.max(lastReplaceSeq, event.seq);
    }
  }

  const resolved = resolveAnchor(lastPositive, headers, assistants);
  const anchor =
    resolved !== undefined && resolved.model === model && lastReplaceSeq <= resolved.cutSeq
      ? resolved
      : undefined;

  const full = estimateSurface(surface, tools);
  if (anchor === undefined) {
    return {
      reading: {
        used: full.total,
        size: budget.limit,
        pressure: budget.pressure,
        hardLimit: budget.hardLimit,
        estimated: true,
        parts: { system: full.system, tools: full.tools, messages: full.messages },
      },
      surfaceGeneration,
    };
  }

  const carry = Math.max(0, anchor.output - (anchor.echo ? 0 : anchor.reasoning));
  const tail = surface.reduce(
    (sum, entry) => (entry.seq > anchor.cutSeq ? sum + estimateMessage(entry.message) : sum),
    0,
  );
  const used = anchor.input + carry + k * tail;
  const reading: ContextReading = {
    used,
    size: budget.limit,
    pressure: budget.pressure,
    hardLimit: budget.hardLimit,
    estimated: false,
    ...(anchor.cacheRead !== undefined && anchor.input > 0
      ? { cacheHitRate: anchor.cacheRead / anchor.input }
      : {}),
    parts: scaleParts(full, full.total, used),
  };
  return {
    reading,
    anchor,
    estimateDelta: used - anchor.input,
    surfaceGeneration,
  };
}

/** 锚点解析：step/end + 同一步的 request/header（模型 / 回传声明 / 切点） */
function resolveAnchor(
  lastPositive: { key: string; event: SessionEvent } | undefined,
  headers: Map<string, SessionEvent>,
  assistants: Map<string, SessionEvent>,
): MeterAnchor | undefined {
  if (lastPositive === undefined) return undefined;
  const header = headers.get(lastPositive.key);
  if (header === undefined) return undefined;
  const headerData = header.data as {
    model?: unknown;
    params?: { echoReasoning?: unknown };
  };
  if (typeof headerData.model !== "string" || headerData.model === "") return undefined;
  const usage = usageOf(lastPositive.event);
  const assistant = assistants.get(lastPositive.key);
  // 锚点步没有落 assistant/message（被掐）→ 携带量记 0（§4.2）：那一步的输出不在表面里，
  // 锚后只从 request/header 起算增量
  const landed = assistant !== undefined;
  return {
    headerSeq: header.seq,
    cutSeq: assistant?.seq ?? header.seq,
    input: usage.inputTokens ?? 0,
    output: landed ? (usage.outputTokens ?? 0) : 0,
    reasoning: landed ? (usage.reasoningTokens ?? 0) : 0,
    echo: headerData.params?.echoReasoning === true,
    model: headerData.model,
    ...(usage.cacheReadTokens !== undefined ? { cacheRead: usage.cacheReadTokens } : {}),
  };
}

interface SurfaceEstimate {
  system: number;
  tools: number;
  messages: number;
  total: number;
}

/** 整面估算：系统提示 / 工具表 / 消息三段（无锚点时 used 就是它） */
export function estimateSurface(
  surface: readonly SurfaceEntry[],
  tools: readonly WireToolSchema[],
): SurfaceEstimate {
  let system = 0;
  let messages = 0;
  for (const entry of surface) {
    if (entry.message.role === "system") system += estimateMessage(entry.message);
    else messages += estimateMessage(entry.message);
  }
  const toolTokens = estimateTools(tools);
  return { system, tools: toolTokens, messages, total: system + toolTokens + messages };
}

/** 按整面占比把三段折算到 used；差额并入 messages，任一段不为负（§4.11） */
export function scaleParts(full: SurfaceEstimate, total: number, used: number): ContextParts {
  if (total <= 0) return { system: 0, tools: 0, messages: Math.max(0, used) };
  const factor = used / total;
  const system = Math.max(0, Math.round(full.system * factor));
  const tools = Math.max(0, Math.round(full.tools * factor));
  return { system, tools, messages: Math.max(0, used - system - tools) };
}

/** 会话自校正（§4.2）：只在估低时纳入，指数滑动权重 0.3，钳 1.0–1.5、只上调。
 *  actualDelta / estimatedDelta 来自「本步锚点 input − 上一步锚点 input」与「上一步请求前的估算增量」；
 *  estimatedDelta < 500 时样本太小，不更新。 */
export function nextK(k: number, actualDelta: number, estimatedDelta: number): number | undefined {
  if (estimatedDelta < 500 || actualDelta <= 0) return undefined;
  const ratio = actualDelta / estimatedDelta;
  if (ratio <= 1) return undefined; // 估高了不下调
  const smoothed = k + 0.3 * (ratio - k);
  const next = Math.min(1.5, Math.max(1, smoothed));
  return next > k + 1e-9 ? next : undefined;
}
