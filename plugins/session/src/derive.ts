// deriveMessages 派生规则（session.md §4 已定稿）：纯函数、永不改日志。
// 顺序：key 去重（先于 surfaceOp）→ surfaceOp replace（先写生效、区间内跳过、
// 摘要消息插在区间起点）→ callId 配对（孤儿 tool/call 合成错误结果，防 400）→
// 审批问答对 / 审计事件跳过 → reasoning 不回灌模型。

import type {
  ModelMessage,
  SessionAttachment,
  SessionEvent,
  ToolCallDraft,
} from "@henira/protocol";
import { overlaps, type ReplaceInterval, readSurfaceOp } from "./surface-op.js";

const MESSAGE_TYPES = new Set(["user/message", "system/message", "assistant/message"]);
const CALL_TYPES = new Set(["tool/call", "tool/result"]);
const ORPHAN_RESULT = "[no tool result recorded: the call was interrupted]";

interface CallEntry {
  draft: ToolCallDraft;
  seq: number;
}

interface Anchor {
  seq: number;
  order: number;
  message: ModelMessage;
}

export function deriveMessages(events: readonly SessionEvent[]): ModelMessage[] {
  const latestByKey = latestKeySeqs(events);
  const { intervals, acceptedByRecordSeq } = collectAcceptedIntervals(events);
  const isReplaced = (seq: number): boolean =>
    intervals.some((interval) => seq >= interval.startSeq && seq <= interval.endSeq);

  const anchors: Anchor[] = [];
  const pendingCalls = new Map<string, CallEntry>();
  let currentAssistant: Extract<ModelMessage, { role: "assistant" }> | null = null;

  for (const event of events) {
    if (event.ignorable === true) continue; // 不认识/声明可跳过 → 透明跳过（opaque）
    if (!MESSAGE_TYPES.has(event.type) && !CALL_TYPES.has(event.type)) continue;
    const key = readKey(event.data);
    if (key !== undefined && latestByKey.get(key) !== event.seq) continue; // 同名 key 旧条目

    const surfaceOp = readSurfaceOp(event.data);
    if (surfaceOp !== null) {
      const interval = acceptedByRecordSeq.get(event.seq);
      if (interval === undefined) continue; // 重叠败者：整条忽略（与写入裁决一致）
      // 替换：区间内全部事件被跳过（isReplaced），摘要消息插在区间起点
      currentAssistant = null;
      anchors.push({ seq: interval.startSeq, order: anchors.length, message: toMessage(event) });
      continue;
    }
    if (isReplaced(event.seq)) continue;

    if (event.type === "tool/call") {
      const data = event.data as ToolCallEventData;
      const entry: CallEntry = {
        draft: { callId: data.callId, name: data.name, arguments: data.arguments },
        seq: event.seq,
      };
      pendingCalls.set(data.callId, entry);
      if (currentAssistant !== null) {
        if (currentAssistant.toolCalls === undefined) currentAssistant.toolCalls = [];
        currentAssistant.toolCalls.push(entry.draft);
      }
      continue;
    }
    if (event.type === "tool/result") {
      const data = event.data as ToolResultEventData;
      const entry = pendingCalls.get(data.callId);
      if (entry === undefined) continue; // 孤儿 result：审计事实，不进模型历史
      pendingCalls.delete(data.callId);
      anchors.push({
        seq: event.seq,
        order: anchors.length,
        message: {
          role: "tool",
          callId: data.callId,
          name: entry.draft.name,
          content: data.content,
          isError: data.isError,
        },
      });
      continue;
    }

    const message = toMessage(event);
    anchors.push({ seq: event.seq, order: anchors.length, message });
    currentAssistant = message.role === "assistant" ? message : null;
  }

  // 孤儿 tool/call（无 result）→ 派生时合成错误结果，锚在 call 位置（紧跟 assistant）
  for (const [callId, entry] of pendingCalls) {
    anchors.push({
      seq: entry.seq,
      order: anchors.length,
      message: {
        role: "tool",
        callId,
        name: entry.draft.name,
        content: ORPHAN_RESULT,
        isError: true,
      },
    });
  }

  anchors.sort((a, b) => a.seq - b.seq || a.order - b.order);
  return anchors.map((anchor) => anchor.message);
}

interface ToolCallEventData {
  callId: string;
  name: string;
  arguments: string;
}

interface ToolResultEventData {
  callId: string;
  content: string;
  isError: boolean;
}

function toMessage(event: SessionEvent): ModelMessage {
  const data = event.data as { content: string; attachments?: SessionAttachment[] };
  switch (event.type) {
    case "user/message":
      return {
        role: "user",
        content: data.content,
        ...(data.attachments !== undefined && { attachments: data.attachments }),
      };
    case "system/message":
      return { role: "system", content: data.content };
    case "assistant/message":
      return { role: "assistant", content: data.content }; // reasoning 保留给 UI，不回灌模型
    default:
      throw new Error(`not a message event: ${event.type}`);
  }
}

/** key 去重候选：同名 key 取 seq 最大者（日志按 seq 升序，取最后即可） */
function latestKeySeqs(events: readonly SessionEvent[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const event of events) {
    const key = readKey(event.data);
    if (key !== undefined) latest.set(key, event.seq);
  }
  return latest;
}

function readKey(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const key = (data as { key?: unknown }).key;
  return typeof key === "string" ? key : undefined;
}

/** 已接受的替换区间（seq 升序、先写生效）；返回区间表 + 记录 seq → 区间映射 */
function collectAcceptedIntervals(events: readonly SessionEvent[]): {
  intervals: ReplaceInterval[];
  acceptedByRecordSeq: Map<number, ReplaceInterval>;
} {
  const intervals: ReplaceInterval[] = [];
  const acceptedByRecordSeq = new Map<number, ReplaceInterval>();
  for (const event of events) {
    const surfaceOp = readSurfaceOp(event.data);
    if (surfaceOp === null) continue;
    if (overlaps(intervals, surfaceOp)) continue; // 败者
    intervals.push(surfaceOp);
    acceptedByRecordSeq.set(event.seq, surfaceOp);
  }
  return { intervals, acceptedByRecordSeq };
}
