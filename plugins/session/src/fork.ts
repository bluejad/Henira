// fork 语义（session.md §6 已定稿）：任意 seq 前缀复制到新目录（新 id、parentSession 指源），
// 切点落在半回合时补写 turn/end{forked}；整目录复制（附件/计划/任务随走，相对路径原样有效）；
// 复制而非引用——源会话不动。嵌套侧问 header 改写随侧问目录格式定稿（M5）补齐，M1 原样复制。

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SessionEvent, SessionHeader } from "@reins/protocol";
import { acquireSessionLock } from "./lock.js";
import { SessionStore } from "./store.js";

const LOG_FILE = "session.v1.jsonl";
const LOCK_FILE = "session.lock";

export class ForkCutOutOfRangeError extends Error {
  constructor(cut: number, lastSeq: number) {
    super(`fork cut seq ${cut} is out of range [0, ${lastSeq}]`);
    this.name = "ForkCutOutOfRangeError";
  }
}

export interface ForkOptions {
  sourceDir: string;
  sourceHeader: SessionHeader;
  sourceEvents: readonly SessionEvent[];
  /** 缺省 = 复制到最新 */
  atSeq?: number;
}

export async function forkSession(opts: ForkOptions): Promise<SessionStore> {
  const lastSeq =
    opts.sourceEvents.length > 0 ? opts.sourceEvents[opts.sourceEvents.length - 1].seq : 0;
  const cut = opts.atSeq ?? lastSeq;
  if (cut < 0 || cut > lastSeq) throw new ForkCutOutOfRangeError(cut, lastSeq);
  const prefix = opts.sourceEvents.filter((event) => event.seq <= cut);

  const newId = randomUUID();
  const newDir = path.join(path.dirname(opts.sourceDir), newId);
  await fs.mkdir(newDir, { recursive: true });
  // 整目录复制（排除日志与锁文件；日志按前缀重写）
  await fs.cp(opts.sourceDir, newDir, {
    recursive: true,
    filter: (src) => !SKIP.has(path.basename(src)),
  });

  const header: SessionHeader = {
    version: 1,
    id: newId,
    createdAt: Date.now(),
    cwd: opts.sourceHeader.cwd,
    parentSession: opts.sourceHeader.id,
    ...(opts.sourceHeader.user !== undefined && { user: opts.sourceHeader.user }),
  };

  const lock = await acquireSessionLock(newDir);
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(path.join(newDir, LOG_FILE), "a");
    const store = await SessionStore.importPrefix(
      { dir: newDir, header, events: prefix },
      lock,
      handle,
    );
    // 半回合切点：前缀有 turn/start 无 turn/end → 为复制出的前缀补写收尾（session.md §6）
    const open = openTurnOf(prefix);
    if (open !== null) {
      await store.append({ type: "turn/end", data: { turn: open, reason: "forked" } });
    }
    return store;
  } catch (err) {
    await handle?.close();
    await lock.release();
    throw err;
  }
}

const SKIP = new Set([LOG_FILE, LOCK_FILE]);

function openTurnOf(events: readonly SessionEvent[]): string | null {
  let open: string | null = null;
  for (const event of events) {
    if (event.type === "turn/start") {
      open = (event.data as { turn?: string }).turn ?? null;
    }
    if (event.type === "turn/end") {
      open = null;
    }
  }
  return open;
}
