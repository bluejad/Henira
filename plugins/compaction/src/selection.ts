// 区间选择（compaction.md §4.5）：单元 = 同一 (turn, step) 的 assistant + tool/call +
// tool/result；每条 user/message 自成一个单元。尾部按 retain 从最新往前留，最新单元
// 无论多大都保留；头部估算不足 headMin 判「可压缩的历史不足」。
// 三条护栏：系统消息永不进区间（I-3）；有在途调用的单元不可压缩（I-2）；
// 区间只向前推进、不与已接受区间重叠。滚动摘要：新区间把上一次替换记录自身的 seq
// 纳入区间（不重叠旧区间），派生规则据此让旧摘要退出表面。

import {
  type ContextBudget,
  estimateMessage,
  type SessionEvent,
  type SurfaceEntry,
} from "@henira/protocol";

export interface IntervalPlan {
  startSeq: number;
  endSeq: number;
  /** 头部消息（摘要请求的转写；按表面顺序） */
  head: SurfaceEntry[];
  /** 被遮蔽的估算量（I-7 比较基准） */
  maskedTokens: number;
  units: number;
}

interface Unit {
  id: string;
  kind: "user" | "assistant";
  firstSeq: number;
  lastSeq: number;
  eligible: boolean;
  calls: Set<string>;
}

export interface SelectionInput {
  events: readonly SessionEvent[];
  surface: readonly SurfaceEntry[];
  budget: ContextBudget;
}

export function selectInterval(input: SelectionInput): IntervalPlan | undefined {
  const { events, surface, budget } = input;
  const units = new Map<string, Unit>();
  const unitBySeq = new Map<number, Unit>();
  const systemSeqs: number[] = [];
  const anchorToRecord = new Map<number, number>();
  let previousEnd = 0;
  let latestRecordSeq = 0;

  const getUnit = (id: string, kind: Unit["kind"], order: number): Unit => {
    const existing = units.get(id);
    if (existing !== undefined) return existing;
    const unit: Unit = {
      id,
      kind,
      firstSeq: order,
      lastSeq: order,
      eligible: true,
      calls: new Set(),
    };
    units.set(id, unit);
    return unit;
  };
  const addSeq = (unit: Unit, seq: number): void => {
    unit.firstSeq = Math.min(unit.firstSeq, seq);
    unit.lastSeq = Math.max(unit.lastSeq, seq);
    unitBySeq.set(seq, unit);
  };

  for (const event of events) {
    if (event.ignorable === true) continue;
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case "system/message":
        systemSeqs.push(event.seq);
        break;
      case "user/message": {
        const unit = getUnit(`u:${event.seq}`, "user", event.seq);
        addSeq(unit, event.seq);
        const op = (data.surfaceOp as { op?: unknown } | undefined)?.op;
        if (op === "replace") {
          const startSeq = (data.surfaceOp as { startSeq: number }).startSeq;
          const endSeq = (data.surfaceOp as { endSeq: number }).endSeq;
          anchorToRecord.set(startSeq, event.seq);
          previousEnd = Math.max(previousEnd, endSeq);
          latestRecordSeq = Math.max(latestRecordSeq, event.seq);
        }
        break;
      }
      case "assistant/message": {
        const unit = getUnit(`a:${String(data.turn)}:${String(data.step)}`, "assistant", event.seq);
        addSeq(unit, event.seq);
        break;
      }
      case "tool/call": {
        const unit = getUnit(`a:${String(data.turn)}:${String(data.step)}`, "assistant", event.seq);
        addSeq(unit, event.seq);
        if (typeof data.callId === "string") unit.calls.add(data.callId);
        break;
      }
      case "tool/result": {
        const unit = getUnit(`a:${String(data.turn)}:${String(data.step)}`, "assistant", event.seq);
        addSeq(unit, event.seq);
        if (typeof data.callId === "string") unit.calls.delete(data.callId);
        break;
      }
      default:
        break;
    }
  }
  for (const unit of units.values()) {
    if (unit.calls.size > 0) unit.eligible = false;
  }

  // 表面 → 单元：摘要锚点（seq = 旧区间起点）归到替换记录自己的单元，旧区间因此不再「可见」
  const visible = new Map<string, number>();
  const headCandidate = new Map<number, Unit>();
  for (const entry of surface) {
    const mappedSeq = anchorToRecord.get(entry.seq) ?? entry.seq;
    const unit = unitBySeq.get(mappedSeq);
    if (unit === undefined) continue; // system / 无单元（孤儿）
    visible.set(unit.id, (visible.get(unit.id) ?? 0) + estimateMessage(entry.message));
    headCandidate.set(entry.seq, unit);
  }

  const visibleUnits = [...units.values()]
    .filter((unit) => visible.has(unit.id))
    .sort((a, b) => a.firstSeq - b.firstSeq);
  if (visibleUnits.length === 0) return undefined;

  // 尾部：从最新往前收，累计到 retain（最新单元无论多大都保留）
  let tailStart = 0;
  let accumulated = 0;
  for (let index = visibleUnits.length - 1; index >= 0; index -= 1) {
    accumulated += visible.get(visibleUnits[index].id) ?? 0;
    if (accumulated >= budget.retain) {
      tailStart = index;
      break;
    }
  }
  const headUnits = visibleUnits.slice(0, tailStart);
  if (headUnits.length === 0) return undefined;
  if (headUnits.some((unit) => !unit.eligible)) return undefined; // I-2：有在途调用的步整段不可压

  let startSeq = Math.min(...headUnits.map((unit) => unit.firstSeq));
  const endSeq = Math.max(...headUnits.map((unit) => unit.lastSeq));
  if (startSeq <= previousEnd) return undefined; // 只向前推进（session.md §4）

  // 滚动摘要：把上一次替换记录自身的 seq 纳入新区间（记录在旧区间之后，因此不重叠）
  if (latestRecordSeq > previousEnd && latestRecordSeq < startSeq) {
    const blocked = systemSeqs.some((seq) => seq >= latestRecordSeq && seq <= startSeq);
    if (!blocked) startSeq = latestRecordSeq;
  }

  // I-3：区间内出现系统消息 → 截到该系统消息之前；截不出头部则放弃
  const systemInside = systemSeqs
    .filter((seq) => seq >= startSeq && seq <= endSeq)
    .sort((a, b) => a - b);
  if (systemInside.length > 0) {
    const cutoff = systemInside[0];
    const kept = headUnits.filter((unit) => unit.lastSeq < cutoff);
    if (kept.length === 0) return undefined;
    return finish(kept);
  }

  return finish(headUnits, startSeq);

  /** 组装计划；startAt = 滚动摘要下探到替换记录 seq 的起点（不传则取选中单元的最小 seq） */
  function finish(chosen: Unit[], startAt?: number): IntervalPlan | undefined {
    const chosenIds = new Set(chosen.map((unit) => unit.id));
    const head = surface.filter((entry) => {
      const unit = headCandidate.get(entry.seq);
      return unit !== undefined && chosenIds.has(unit.id);
    });
    const maskedTokens = head.reduce((sum, entry) => sum + estimateMessage(entry.message), 0);
    if (maskedTokens < budget.headMin) return undefined;
    const first = Math.min(...chosen.map((unit) => unit.firstSeq));
    const start = startAt === undefined ? first : Math.min(startAt, first);
    return {
      startSeq: start,
      endSeq: Math.max(...chosen.map((unit) => unit.lastSeq)),
      head,
      maskedTokens,
      units: chosen.length,
    };
  }
}
