// UI 门面订阅队列（D-042 / D-085）：行帧过滤 + 每订阅者一条有界队列。
// - types = Row.kind 白名单（只看行帧；snapshot 行同滤；state.updated / sessions.changed 不受影响）
// - turnId = 行帧按 row.turn；state.updated 仅在 lastTurnId 匹配时投递
// - 队列 cap 256，满则先同步冲刷；16ms 攒批；连续 row.delta 同 rowId+field 合并（增量可并）
// - 结构 / 状态 / 快照帧必达（不丢）；回调抛错只记日志，不拖死帧消费循环

import type { Row, ServerFrame } from "@henira/protocol";

export interface FrameFilter {
  sessionId?: string;
  types?: Row["kind"][];
  turnId?: string;
}

export interface FrameSubscription {
  push(frame: ServerFrame): void;
  dispose(): void;
}

export interface FrameQueueOptions {
  /** 每订阅者队列上限；满则先同步冲刷（不丢帧） */
  cap?: number;
  /** 攒批窗口（16ms = 一帧间隔，P6 同款） */
  flushMs?: number;
  /** 行查找（row.delta 无行体，需按 rowId 取 kind/turn） */
  lookupRow?: (sessionId: string, rowId: string) => Row | undefined;
  /** 投递回调（宿主已绑定插件 id 与 try/catch 语义；这里再兜一层） */
  deliver(frame: ServerFrame): void;
}

const DEFAULT_CAP = 256;
const DEFAULT_FLUSH_MS = 16;

/** 过滤一帧；undefined = 该订阅者不收 */
export function filterFrame(
  frame: ServerFrame,
  filter: FrameFilter,
  lookupRow?: (sessionId: string, rowId: string) => Row | undefined,
): ServerFrame | undefined {
  if (frame.kind === "connected") return undefined;
  if (filter.sessionId !== undefined) {
    if (frame.kind === "sessions.changed") return undefined;
    if (frame.sessionId !== filter.sessionId) return undefined;
  }
  if (filter.turnId !== undefined && frame.kind === "sessions.changed") return undefined;

  if (frame.kind === "snapshot") {
    const rows = filterSnapshotRows(frame.snapshot.rows, filter);
    return rows === frame.snapshot.rows
      ? frame
      : {
          ...frame,
          snapshot: {
            ...frame.snapshot,
            rows: [...rows],
            totalRows: rows.length,
            hasOlder: false,
          },
        };
  }

  if (frame.kind === "sessions.changed") return frame;

  const delta = frame.delta;
  if (delta.op === "state.updated") {
    if (filter.turnId !== undefined && delta.state.lastTurnId !== filter.turnId) return undefined;
    return frame;
  }
  const row =
    delta.op === "row.delta" ? lookupRow?.(frame.sessionId, delta.rowId) : (delta.row as Row);
  if (row === undefined) return frame; // 分类不可得时不丢帧（fail-open；正常路径 store 已有行）
  if (filter.turnId !== undefined && row.turn !== filter.turnId) return undefined;
  if (filter.types !== undefined && !filter.types.includes(row.kind)) return undefined;
  return frame;
}

function filterSnapshotRows(rows: readonly Row[], filter: FrameFilter): readonly Row[] {
  if (filter.types === undefined && filter.turnId === undefined) return rows;
  return rows.filter(
    (row) =>
      (filter.turnId === undefined || row.turn === filter.turnId) &&
      (filter.types === undefined || filter.types.includes(row.kind)),
  );
}

/** 连续 row.delta 同 rowId+field 合并（增量可并；不跨结构帧合并） */
function coalesce(frames: readonly ServerFrame[]): ServerFrame[] {
  const out: ServerFrame[] = [];
  for (const frame of frames) {
    const last = out[out.length - 1];
    if (
      frame.kind === "delta" &&
      frame.delta.op === "row.delta" &&
      last?.kind === "delta" &&
      last.delta.op === "row.delta" &&
      last.sessionId === frame.sessionId &&
      last.delta.rowId === frame.delta.rowId &&
      last.delta.field === frame.delta.field
    ) {
      out[out.length - 1] = {
        ...last,
        seq: frame.seq,
        delta: { ...last.delta, text: last.delta.text + frame.delta.text },
      };
      continue;
    }
    out.push(frame);
  }
  return out;
}

export function createFrameSubscription(
  filter: FrameFilter,
  opts: FrameQueueOptions,
): FrameSubscription {
  const cap = opts.cap ?? DEFAULT_CAP;
  const flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS;
  let queue: ServerFrame[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let flushing = false;

  const flushNow = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (disposed || flushing) return;
    const batch = queue;
    queue = [];
    if (batch.length === 0) return;
    flushing = true;
    try {
      for (const frame of coalesce(batch)) {
        try {
          opts.deliver(frame);
        } catch (err) {
          console.warn("[henira] UI subscription callback failed:", err);
        }
      }
    } finally {
      flushing = false;
      if (queue.length > 0 && timer === undefined && !disposed) {
        timer = setTimeout(flushNow, flushMs);
      }
    }
  };

  return {
    push(frame) {
      if (disposed) return;
      const filtered = filterFrame(frame, filter, opts.lookupRow);
      if (filtered === undefined) return;
      if (queue.length >= cap) flushNow(); // 满 = 先同步冲刷，不丢终局
      queue.push(filtered);
      if (timer === undefined) timer = setTimeout(flushNow, flushMs);
    },
    dispose() {
      disposed = true;
      queue = [];
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
