// 计量器（compaction.md §4.2）：纯函数——读数来自账本，重放得同一读数。
// 锚点 = 最近一条 inputTokens 为正的 step/end；锚后只估算增量。估算与
// deriveMessages() 走同一份表面（I-1），所以替换、key 去重、孤儿合成都自动反映。
// k（会话自校正）与观测上限是运行态，由调用方（loop）持有；本文件只给纯计算与单侧更新。

import { type ContextBudget, contextBudget } from "./context-budget.js";
import type { SessionEvent } from "./envelope.js";
import type { ModelConfig, TokenUsage, WireToolSchema } from "./llm.js";
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
  /** 有效输出上限 = ContextBudget.outputBase（min(声明, 观测输出上限)）——摘要请求的
   *  maxTokens 与主循环封顶同源取它（compaction.md §4.3/§4.6）；恢复读数缺工具表时也带 */
  outputBase?: number;
  /** true = 无可用锚点，整面都是估算 */
  estimated: boolean;
  /** 缓存命中率 = cacheRead ÷ input（取不到不带） */
  cacheHitRate?: number;
  /** 按来源分段，恒为估算；三段之和 = used（差额并入 messages） */
  parts: ContextParts;
  /** 截断嫌疑（compaction.md §4.2 / F-13）：厂商读数低于预期——只提示，不学上限；
   *  连续两次嫌疑且读数持平才确认（确认后 size 变成本次读数学出的观测上限） */
  suspicion?: { expected: number; actual: number };
  /** true = 三段拆分不可得（磁盘快照恢复：只有账本、没有工具表，总量有锚点）。
   *  UI 隐藏分段明细，只显示总量与剩余（§4.11 重启恢复） */
  partial?: boolean;
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
  /** 锚点因「其后有替换记录」作废且模型一致（唯一作废原因是压缩）：重启恢复据此从
   *  压缩基线 `compaction/end.after` 重新起算（§4.11）；换模型等其它作废原因不带此标记 */
  anchorStaleByReplace?: boolean;
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
  const modelMatched = resolved !== undefined && resolved.model === model;
  const replacedAfterCut = resolved !== undefined && lastReplaceSeq > resolved.cutSeq;
  const anchor = modelMatched && !replacedAfterCut ? resolved : undefined;
  // 同模型、仅因替换记录作废：恢复路径可从压缩基线重起算（§4.11）
  const anchorStaleByReplace = modelMatched && replacedAfterCut;

  const full = estimateSurface(surface, tools);
  if (anchor === undefined) {
    return {
      reading: {
        used: full.total,
        size: budget.limit,
        pressure: budget.pressure,
        hardLimit: budget.hardLimit,
        outputBase: budget.outputBase,
        estimated: true,
        parts: { system: full.system, tools: full.tools, messages: full.messages },
      },
      surfaceGeneration,
      ...(anchorStaleByReplace ? { anchorStaleByReplace: true } : {}),
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
    outputBase: budget.outputBase,
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

export interface RestoreContextInput {
  events: readonly SessionEvent[];
  surface: readonly SurfaceEntry[];
  /** 账本最近一条 request/header 的模型（`provider/model`，锚点比对用） */
  model: string;
  /** 该模型的窗口/输出声明（取不到 = 缺省 128K 且不封顶——与 loop 同规） */
  modelConfig?: Pick<ModelConfig, "contextWindow" | "maxOutputTokens">;
}

/** 压缩基线（§4.11）：最近一次成功压缩的 `compaction/end.after`——压缩后整面估算，
 *  含当时的真实工具表。替换记录把锚点作废后，重启恢复从这里起算；替换之后没有带
 *  `after` 的 end（崩溃窗口）返回 undefined——不猜。 */
function compactionBaseline(
  events: readonly SessionEvent[],
): { base: number; cutSeq: number } | undefined {
  let replaceSeq: number | undefined;
  let base: number | undefined;
  for (const event of events) {
    const op = (event.data as { surfaceOp?: { op?: unknown } }).surfaceOp?.op;
    if (op === "replace") {
      replaceSeq = event.seq;
      base = undefined; // 新替换让旧基线作废；只有其后的 end 才能重新确立
      continue;
    }
    if (replaceSeq === undefined || event.type !== "compaction/end") continue;
    const data = event.data as { after?: unknown };
    if (typeof data.after === "number" && data.after > 0) base = data.after;
  }
  return replaceSeq !== undefined && base !== undefined ? { base, cutSeq: replaceSeq } : undefined;
}

/** 磁盘快照的轻量恢复（compaction.md §4.11）：宿主重启后打开历史会话、运行体尚未装配——
 *  只有账本可用，没有工具表。锚点 input 已是完整请求上下文（系统+工具+消息），所以
 *  **总量可信**（锚点 + 锚后估算），三段里工具表体积用差值反推；无锚点（从未请求过 /
 *  首步失败）返回 undefined——不猜。
 *  partial = true 告知 UI 拆分不可得（隐藏明细，只显示总量与剩余）。 */
export function restoreContextReading(input: RestoreContextInput): ContextReading | undefined {
  const budget = contextBudget({
    ...(input.modelConfig?.contextWindow !== undefined
      ? { contextWindow: input.modelConfig.contextWindow }
      : {}),
    ...(input.modelConfig?.maxOutputTokens !== undefined
      ? { maxOutputTokens: input.modelConfig.maxOutputTokens }
      : {}),
  });
  const measured = measureContext({
    events: input.events,
    surface: input.surface,
    tools: [],
    model: input.model,
    budget,
    k: 1,
  });
  const anchor = measured.anchor;
  if (anchor === undefined) {
    // 空闲手动压缩后重启（§4.11）：锚点被替换记录作废、模型一致——从最近一次成功压缩的
    // `after`（压缩后整面估算，含真实工具表）重新起算，再叠加替换后新增表面的估算。
    // 换模型等其它作废原因不适用（基线只描述压缩改了表面的那一种），照旧 undefined。
    const baseline =
      measured.anchorStaleByReplace === true ? compactionBaseline(input.events) : undefined;
    if (baseline === undefined) return undefined;
    const atBaseline = estimateSurface(
      input.surface.filter((entry) => entry.seq <= baseline.cutSeq),
      [],
    );
    const system = atBaseline.system;
    // after 里含工具表体积（压缩时按真实工具表算的整面），扣掉系统/消息反推
    const tools = Math.max(0, Math.round(baseline.base) - system - atBaseline.messages);
    const extra = input.surface.reduce(
      (sum, entry) => (entry.seq > baseline.cutSeq ? sum + estimateMessage(entry.message) : sum),
      0,
    );
    const used = Math.round(baseline.base) + extra;
    return {
      used,
      size: measured.reading.size,
      pressure: measured.reading.pressure,
      hardLimit: measured.reading.hardLimit,
      ...(measured.reading.outputBase !== undefined
        ? { outputBase: measured.reading.outputBase }
        : {}),
      estimated: true,
      partial: true,
      parts: { system, tools, messages: Math.max(0, used - system - tools) },
    };
  }
  // 拆分：系统/消息按账本表面估算（锚点切点前），工具表 = 锚点 input 里扣掉两者
  const atAnchor = estimateSurface(
    input.surface.filter((entry) => entry.seq <= anchor.cutSeq),
    [],
  );
  const system = atAnchor.system;
  const tools = Math.max(0, anchor.input - system - atAnchor.messages);
  const messages = Math.max(0, measured.reading.used - system - tools);
  return {
    ...measured.reading,
    partial: true,
    parts: { system, tools, messages },
  };
}
