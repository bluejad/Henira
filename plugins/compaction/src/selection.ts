// 区间选择（compaction.md §4.5）：单元 = 同一 (turn, step) 的 assistant + tool/call +
// tool/result；每条 user/message 自成一个单元。尾部按 retain 从最新往前留，最新单元
// 无论多大都保留；头部估算不足 headMin 判「可压缩的历史不足」。
// 三条护栏：系统消息永不进区间（I-3）；有在途调用的单元不可压缩（I-2）；
// 区间只向前推进、不与已接受区间重叠。滚动摘要：新区间把上一次替换记录自身的 seq
// 纳入区间（不重叠旧区间），派生规则据此让旧摘要退出表面。
// 前沿与分段：上次模型摘要终点之前的可见单元是残留碎片，不进区间也不参与起点；
// 截断点（系统消息 / 无模型区间）把窗口切成连续段，最早一段不足 headMin 时取下一段——
// 只从后往前截会让中段一次无模型摘要留下的短碎片把后面的历史永久挡死（§17）。

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
  /** assistant 单元所属回合（孤儿调用的在途判定按回合归属，不按事件时序） */
  turn?: string;
  firstSeq: number;
  lastSeq: number;
  eligible: boolean;
  calls: Set<string>;
}

export interface SelectionInput {
  events: readonly SessionEvent[];
  surface: readonly SurfaceEntry[];
  budget: ContextBudget;
  /** 当前仍在跑的回合（压缩跟着 pre-step 的 value.turn 传）：只有它的未闭合调用算「在途」。
   *  更早回合的孤儿调用是崩溃遗留（结果永远不会来，派生已合成错误结果），遮蔽安全——
   *  否则一次中途崩溃就让选区永久判「不可压」 */
  currentTurn?: string;
}

export function selectInterval(input: SelectionInput): IntervalPlan | undefined {
  const { events, surface, budget, currentTurn } = input;
  const units = new Map<string, Unit>();
  const unitBySeq = new Map<number, Unit>();
  const systemSeqs: number[] = [];
  const anchorToRecord = new Map<number, number>();
  /** 无模型摘要的替换区间：与模型摘要同在表面，但不参与前推/滚动记账——只当截断点 */
  const digestIntervals: Array<{ startSeq: number; endSeq: number }> = [];
  let previousEnd = 0;
  let latestRecordSeq = 0;

  const getUnit = (id: string, kind: Unit["kind"], order: number, turn?: string): Unit => {
    const existing = units.get(id);
    if (existing !== undefined) return existing;
    const unit: Unit = {
      id,
      kind,
      ...(turn !== undefined ? { turn } : {}),
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
          if (data.source === "compaction-digest") {
            // 无模型摘要（§4.9）不推进模型摘要的起点、不做滚动锚点：它可能落在尾部
            // （最新一步），若计入前推判据，此后每次选区都会被「只向前」挡死
            digestIntervals.push({ startSeq, endSeq });
          } else {
            previousEnd = Math.max(previousEnd, endSeq);
            latestRecordSeq = Math.max(latestRecordSeq, event.seq);
          }
        }
        break;
      }
      case "assistant/message": {
        const unit = getUnit(
          `a:${String(data.turn)}:${String(data.step)}`,
          "assistant",
          event.seq,
          typeof data.turn === "string" ? data.turn : undefined,
        );
        addSeq(unit, event.seq);
        break;
      }
      case "tool/call": {
        const unit = getUnit(
          `a:${String(data.turn)}:${String(data.step)}`,
          "assistant",
          event.seq,
          typeof data.turn === "string" ? data.turn : undefined,
        );
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
    // I-2：只有当前回合里未闭合的调用才算「在途」；更早回合的孤儿调用按已结算处理
    //（结果永远不会来，派生已合成错误结果，遮蔽安全）。没有已知的活回合 = 无在途
    if (unit.calls.size > 0 && currentTurn !== undefined && unit.turn === currentTurn) {
      unit.eligible = false;
    }
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

  // 前沿：上一次模型摘要终点之前的可见单元是「残留碎片」——被系统消息 / 无模型区间截下来的
  // 老历史，不能再进新区间（会与旧区间重叠），但也不能挡住它后面的单元
  const windowUnits = headUnits.filter((unit) => unit.firstSeq > previousEnd);
  if (windowUnits.length === 0) return undefined;

  // 截断点（系统消息 / 无模型摘要区间）把窗口切成若干连续段。优先取最早一段（先压老历史）；
  // 该段不足 headMin 时取下一段——否则中段一次无模型摘要留下的短碎片就能让模型摘要
  // 永久判「历史不足」，会话一路走到硬线（P1，2026-11-26 复审）
  const runs: Unit[][] = [];
  let run: Unit[] = [];
  for (const unit of windowUnits) {
    const previous = run[run.length - 1];
    if (previous !== undefined && splitsBetween(previous, unit)) {
      runs.push(run);
      run = [];
    }
    run.push(unit);
  }
  if (run.length > 0) runs.push(run);

  for (let index = 0; index < runs.length; index += 1) {
    const chosen = runs[index] as Unit[];
    if (chosen.some((unit) => !unit.eligible)) continue; // I-2：有在途调用的步整段不可压
    // 滚动摘要：只对最早一段下探（段前有截断点时不行——下探区间会把它罩进来）
    const first = chosen[0] as Unit;
    const rolling =
      index === 0 &&
      latestRecordSeq > previousEnd &&
      latestRecordSeq < first.firstSeq &&
      !blockedInRange(latestRecordSeq, first.firstSeq)
        ? latestRecordSeq
        : undefined;
    const plan = finish(chosen, rolling);
    if (plan !== undefined) return plan;
  }
  return undefined;

  /** 两个相邻可见单元之间是否隔着截断点（系统消息或已接受的无模型区间） */
  function splitsBetween(left: Unit, right: Unit): boolean {
    if (systemSeqs.some((seq) => seq > left.lastSeq && seq < right.firstSeq)) return true;
    return digestIntervals.some(
      (interval) => interval.endSeq > left.lastSeq && interval.startSeq < right.firstSeq,
    );
  }

  /** [from..to] 内含截断点（滚动摘要下探前检查） */
  function blockedInRange(from: number, to: number): boolean {
    if (systemSeqs.some((seq) => seq >= from && seq <= to)) return true;
    return digestIntervals.some((interval) => interval.endSeq >= from && interval.startSeq <= to);
  }

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
