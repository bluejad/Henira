// JSONL 文件读取与崩溃恢复（session.md §5）：
// 第 1 行 header、第 2 行起事件；半行丢弃并截断；版本闸 + 未知类型 fail-closed；
// seq 必须连续递增（写入路径保证，读取时钉住）。

import { promises as fs } from "node:fs";
import type { SessionEvent, SessionHeader } from "@reins/protocol";
import { validatorFor } from "@reins/protocol";

export class SessionVersionError extends Error {
  constructor(found: unknown) {
    super(`session format version ${String(found)} is not supported (supported: 1)`);
    this.name = "SessionVersionError";
  }
}

export class SessionCorruptError extends Error {
  constructor(detail: string) {
    super(`session file is corrupt: ${detail}`);
    this.name = "SessionCorruptError";
  }
}

/** 未知类型且未标 ignorable → 拒绝重建会话（session.md §3，fail-closed；[dsh] storage-contract.ts:74-80 同构） */
export class UnknownEventTypeError extends Error {
  constructor(
    public readonly type: string,
    public readonly seq: number,
  ) {
    super(
      `event type "${type}" (seq ${seq}) is unknown to this reader and not marked ignorable; ` +
        "refusing to interpret the log — it was likely written by a newer harness",
    );
    this.name = "UnknownEventTypeError";
  }
}

export interface ReadResult {
  header: SessionHeader;
  events: SessionEvent[];
  /** 半行截断后的字节数；未截断为 null */
  truncatedAt: number | null;
}

export async function readSessionFile(filePath: string): Promise<ReadResult> {
  const raw = await fs.readFile(filePath);
  const headerEnd = raw.indexOf(0x0a);
  if (headerEnd < 0) {
    throw new SessionCorruptError("missing header line");
  }
  const header = parseHeader(raw.subarray(0, headerEnd).toString("utf8"));
  const parsed = parseEventLines(raw, headerEnd + 1);
  if (parsed.truncatedAt !== null) {
    await fs.truncate(filePath, parsed.truncatedAt);
  }
  return { header, events: parsed.events, truncatedAt: parsed.truncatedAt };
}

function parseHeader(line: string): SessionHeader {
  let header: SessionHeader;
  try {
    header = JSON.parse(line) as SessionHeader;
  } catch {
    throw new SessionCorruptError("header is not valid JSON");
  }
  if (header?.version !== 1) {
    throw new SessionVersionError(header?.version);
  }
  return header;
}

function parseEventLines(
  raw: Buffer,
  start: number,
): { events: SessionEvent[]; truncatedAt: number | null } {
  const events: SessionEvent[] = [];
  let offset = start;
  let lastSeq = 0;
  while (offset < raw.length) {
    const newline = raw.indexOf(0x0a, offset);
    if (newline < 0) {
      // 半行（崩溃残留）：丢弃，从最后一个完整事件继续
      const remaining = raw.subarray(offset);
      const truncatedAt = remaining.some((b) => b !== 0x20 && b !== 0x0d && b !== 0x09)
        ? offset
        : null;
      return { events, truncatedAt };
    }
    const line = raw.subarray(offset, newline).toString("utf8").trim();
    offset = newline + 1;
    if (line.length === 0) continue;
    let event: SessionEvent;
    try {
      event = JSON.parse(line) as SessionEvent;
    } catch {
      throw new SessionCorruptError(`line at byte ${offset - 1} is not valid JSON`);
    }
    assertEnvelope(event, lastSeq);
    lastSeq = event.seq;
    events.push(event);
  }
  return { events, truncatedAt: null };
}

function assertEnvelope(event: SessionEvent, lastSeq: number): void {
  if (typeof event?.type !== "string" || event.type.length === 0) {
    throw new SessionCorruptError("event without type");
  }
  if (typeof event?.seq !== "number" || event.seq !== lastSeq + 1) {
    throw new SessionCorruptError(`event seq ${String(event?.seq)} is not ${lastSeq + 1}`);
  }
  if (typeof event?.time !== "number") {
    throw new SessionCorruptError(`event seq ${event.seq} without time`);
  }
  if (validatorFor(event.type) === undefined && event.ignorable !== true) {
    throw new UnknownEventTypeError(event.type, event.seq);
  }
}
