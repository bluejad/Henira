// 无模型兜底（compaction.md §4.9 第 2 步）：把「工具结果超长的整步单元」替换成一条
// 简短摘要（工具名 + 参数开头 + 结果头尾 + 省略字数），不调模型。走同一个替换机制
// （user/message + surfaceOp），source = compaction-digest；每一次替换都上屏（压缩行）。
// 处理顺序按估算量从大到小；在尾部和头部都算——最新一步也能摘，否则一次超大工具输出
// 会让会话永久卡在硬线上。

import {
  type ContextBudget,
  estimateMessage,
  estimateSurface,
  type SessionEvent,
  type SessionService,
  type SurfaceEntry,
  type WireToolSchema,
} from "@henira/protocol";

const HEAD_CHARS = 600;
const TAIL_CHARS = 300;
const ARGS_CHARS = 200;

interface ToolResultRecord {
  name: string;
  args: string;
  content: string;
}

interface StepUnit {
  key: string;
  turn: string;
  step: number;
  firstSeq: number;
  lastSeq: number;
  pendingCalls: Set<string>;
  results: ToolResultRecord[];
  estimate: number;
}

export interface DigestInput {
  session: SessionService;
  events: readonly SessionEvent[];
  surface: readonly SurfaceEntry[];
  budget: ContextBudget;
  tools: readonly WireToolSchema[];
  /** 替换记录落在哪个回合/步（自动压缩 = 当前步；手动 = 维护 id） */
  turn: string;
  step: number;
  trigger: "auto" | "manual";
  before: number;
}

export interface DigestResult {
  applied: boolean;
  units: number;
  after: number;
}

function newId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

function excerpt(text: string): string {
  if (text.length <= HEAD_CHARS + TAIL_CHARS) return text;
  const omitted = text.length - HEAD_CHARS - TAIL_CHARS;
  return `${text.slice(0, HEAD_CHARS)}\n… [omitted ${omitted} chars] …\n${text.slice(-TAIL_CHARS)}`;
}

function unitKey(turn: unknown, step: unknown): string | undefined {
  return typeof turn === "string" && typeof step === "number" ? `${turn}:${step}` : undefined;
}

/** 扫描可见的步单元（assistant + tool/call + tool/result），按表面估算量排序 */
function scanUnits(events: readonly SessionEvent[], surface: readonly SurfaceEntry[]): StepUnit[] {
  const units = new Map<string, StepUnit>();
  const callNames = new Map<string, string>();
  const callArgs = new Map<string, string>();
  const seqToUnit = new Map<number, StepUnit>();
  const systemSeqs = new Set<number>();

  const unitFor = (turn: unknown, step: unknown, seq: number): StepUnit | undefined => {
    const key = unitKey(turn, step);
    if (key === undefined) return undefined;
    let unit = units.get(key);
    if (unit === undefined) {
      unit = {
        key,
        turn: turn as string,
        step: step as number,
        firstSeq: seq,
        lastSeq: seq,
        pendingCalls: new Set(),
        results: [],
        estimate: 0,
      };
      units.set(key, unit);
    }
    unit.firstSeq = Math.min(unit.firstSeq, seq);
    unit.lastSeq = Math.max(unit.lastSeq, seq);
    seqToUnit.set(seq, unit);
    return unit;
  };

  for (const event of events) {
    if (event.ignorable === true) continue;
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case "system/message":
        systemSeqs.add(event.seq);
        break;
      case "assistant/message":
        unitFor(data.turn, data.step, event.seq);
        break;
      case "tool/call": {
        const unit = unitFor(data.turn, data.step, event.seq);
        if (typeof data.callId === "string") {
          unit?.pendingCalls.add(data.callId);
          if (typeof data.name === "string") callNames.set(data.callId, data.name);
          if (typeof data.arguments === "string") callArgs.set(data.callId, data.arguments);
        }
        break;
      }
      case "tool/result": {
        const unit = unitFor(data.turn, data.step, event.seq);
        if (typeof data.callId === "string") unit?.pendingCalls.delete(data.callId);
        if (unit !== undefined) {
          unit.results.push({
            name: callNames.get(String(data.callId)) ?? "tool",
            args: callArgs.get(String(data.callId)) ?? "",
            content: typeof data.content === "string" ? data.content : "",
          });
        }
        break;
      }
      default:
        break;
    }
  }

  for (const entry of surface) {
    const unit = seqToUnit.get(entry.seq);
    if (unit !== undefined) unit.estimate += estimateMessage(entry.message);
  }

  return [...units.values()]
    .filter((unit) => unit.results.length > 0 && unit.pendingCalls.size === 0 && unit.estimate > 0)
    .sort((a, b) => b.estimate - a.estimate)
    .filter((unit) => ![...systemSeqs].some((seq) => seq >= unit.firstSeq && seq <= unit.lastSeq));
}

function contentFor(unit: StepUnit): string {
  const lines = [`[compacted tool step] tools: ${unit.results.map((r) => r.name).join(", ")}`];
  for (const result of unit.results) {
    const args = result.args.length > ARGS_CHARS ? result.args.slice(0, ARGS_CHARS) : result.args;
    lines.push(`- ${result.name}(${args})`);
    lines.push(excerpt(result.content));
  }
  return lines.join("\n");
}

/** 超长 = 该步单元估算量 > max(4K, 上限 × 5%)（compaction.md §4.9） */
export function isOversized(estimate: number, budget: ContextBudget): boolean {
  return estimate > Math.max(4_000, Math.floor(budget.limit * 0.05));
}

export async function digestOversizedUnits(input: DigestInput): Promise<DigestResult> {
  const { session, events, surface, budget } = input;
  const candidates = scanUnits(events, surface).filter((unit) =>
    isOversized(unit.estimate, budget),
  );
  const after = (): number => estimateSurface(session.deriveSurface(), input.tools).total;
  if (candidates.length === 0) return { applied: false, units: 0, after: after() };

  const id = newId();
  await session.append({
    type: "compaction/start",
    data: {
      id,
      trigger: input.trigger,
      turn: input.turn,
      step: input.step,
      before: input.before,
      plan: {
        startSeq: Math.min(...candidates.map((unit) => unit.firstSeq)),
        endSeq: Math.max(...candidates.map((unit) => unit.lastSeq)),
        units: candidates.length,
      },
      digestUnits: candidates.length,
    },
    ignorable: true,
  });

  let applied = 0;
  for (const unit of candidates) {
    const replaced = await session.append({
      type: "user/message",
      data: {
        turn: input.turn,
        step: input.step,
        content: contentFor(unit),
        source: "compaction-digest",
        surfaceOp: { op: "replace", startSeq: unit.firstSeq, endSeq: unit.lastSeq },
      },
    });
    if (replaced.type === "user/message") applied += 1;
  }

  const finalAfter = Math.round(after());
  await session.append({
    type: "compaction/end",
    data: {
      id,
      turn: input.turn,
      step: input.step,
      state: applied > 0 ? "completed" : "failed",
      after: finalAfter,
      ...(applied === 0
        ? { error: { code: "DIGEST_REJECTED", message: "all digest replacements were rejected" } }
        : {}),
    },
    ignorable: true,
  });
  return { applied: applied > 0, units: applied, after: finalAfter };
}
