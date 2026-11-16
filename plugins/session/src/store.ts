// 会话存储：追加式 JSONL（session.md §5 已定稿）。
// append 语义 = 校验 → 分配 seq → 追加 → fsync（P1 不变量"模型可见 ⟺ 已落日志"的写入半边：
// append 返回时事件已在盘上）。tmp+rename 只用于整体重写的小文件，对追加日志语义错误（§5），
// 本文件对日志只做 append+fsync。
// 崩溃恢复：半行丢弃截断（reader.ts）；开档发现有 turn/start 无 turn/end → 补写 interrupted 收尾。

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SessionEvent, SessionEventInput, SessionHeader } from "@henira/protocol";
import { validatorFor } from "@henira/protocol";
import { acquireSessionLock, type SessionLock } from "./lock.js";
import { readSessionFile } from "./reader.js";
import { overlaps, type ReplaceInterval, readSurfaceOp } from "./surface-op.js";

export const SESSION_LOG_FILE = "session.v1.jsonl";

export class UnregisteredEventTypeError extends Error {
  constructor(type: string) {
    super(
      `event type "${type}" is not registered; register it via the event registry before appending`,
    );
    this.name = "UnregisteredEventTypeError";
  }
}

export class EventDataInvalidError extends Error {
  constructor(
    public readonly type: string,
    detail: string,
  ) {
    super(`event data rejected for "${type}": ${detail}`);
    this.name = "EventDataInvalidError";
  }
}

/** 没有打开的回合不接受审批记录（session.md §1.1 硬规则） */
export class NoOpenTurnError extends Error {
  constructor(type: string) {
    super(`"${type}" requires an open turn (turn/start without turn/end); none is open`);
    this.name = "NoOpenTurnError";
  }
}

export interface CreateSessionOptions {
  /** 会话目录（路径布局归宿主/data-directory，本包只认目录） */
  dir: string;
  id?: string;
  cwd: string;
  parentSession?: string;
  user?: string;
}

export interface CreateSessionResult {
  store: SessionStore;
  /** 本开档是否补写了 interrupted 收尾 */
  synthesizedInterrupted: boolean;
}

export class SessionStore {
  readonly header: SessionHeader;
  private readonly dir: string;
  private readonly lock: SessionLock;
  /** 内存事件账（与磁盘逐字一致）；`events()` 方法返回它——字段改名避免与方法撞名 */
  private log: SessionEvent[] = [];
  private intervals: ReplaceInterval[] = [];
  private openTurn: string | null = null;
  private lastSeq = 0;
  private handle: fs.FileHandle | null = null;
  private closed = false;

  private constructor(
    header: SessionHeader,
    dir: string,
    lock: SessionLock,
    handle: fs.FileHandle,
  ) {
    this.header = header;
    this.dir = dir;
    this.lock = lock;
    this.handle = handle;
  }

  /** 开档：存在即装载（含崩溃恢复），不存在即新建 */
  static async create(opts: CreateSessionOptions): Promise<CreateSessionResult> {
    await fs.mkdir(opts.dir, { recursive: true });
    const lock = await acquireSessionLock(opts.dir);
    try {
      const filePath = path.join(opts.dir, SESSION_LOG_FILE);
      let raw: Buffer | null = null;
      try {
        raw = await fs.readFile(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (raw !== null) {
        return await SessionStore.openExisting(filePath, lock);
      }
      return await SessionStore.createFresh(opts, filePath, lock);
    } catch (err) {
      await lock.release();
      throw err;
    }
  }

  /** fork 专用：前缀事件逐行原样写入（seq/time 保原值；来源已在装载时过门禁） */
  static async importPrefix(
    opts: { dir: string; header: SessionHeader; events: readonly SessionEvent[] },
    lock: SessionLock,
    handle: fs.FileHandle,
  ): Promise<SessionStore> {
    const store = new SessionStore(opts.header, opts.dir, lock, handle);
    await handle.writeFile(`${JSON.stringify(opts.header)}\n`);
    for (const event of opts.events) {
      await handle.writeFile(`${JSON.stringify(event)}\n`);
      store.track(event);
    }
    await handle.sync();
    return store;
  }

  private static async createFresh(
    opts: CreateSessionOptions,
    filePath: string,
    lock: SessionLock,
  ): Promise<CreateSessionResult> {
    const header: SessionHeader = {
      version: 1,
      id: opts.id ?? randomUUID(),
      createdAt: Date.now(),
      cwd: opts.cwd,
      ...(opts.parentSession !== undefined && { parentSession: opts.parentSession }),
      ...(opts.user !== undefined && { user: opts.user }),
    };
    const handle = await fs.open(filePath, "a");
    await handle.writeFile(`${JSON.stringify(header)}\n`);
    await handle.sync();
    return {
      store: new SessionStore(header, path.dirname(filePath), lock, handle),
      synthesizedInterrupted: false,
    };
  }

  private static async openExisting(
    filePath: string,
    lock: SessionLock,
  ): Promise<CreateSessionResult> {
    const { header, events, truncatedAt } = await readSessionFile(filePath);
    void truncatedAt; // 截断已在 reader 内落盘
    const handle = await fs.open(filePath, "a");
    const store = new SessionStore(header, path.dirname(filePath), lock, handle);
    for (const event of events) store.track(event);
    const hadOpenTurn = store.openTurn !== null;
    if (hadOpenTurn) {
      // 崩溃也要有收尾：补写 interrupted（session.md §5）
      await store.append({
        type: "turn/end",
        data: { turn: store.openTurn, reason: "interrupted" },
      });
    }
    return { store, synthesizedInterrupted: hadOpenTurn };
  }

  /** 追加：校验 → 分配 seq → 写行 → fsync → 内存入账 */
  async append(input: SessionEventInput): Promise<SessionEvent> {
    this.assertOpen();
    const validator = validatorFor(input.type);
    if (validator === undefined) throw new UnregisteredEventTypeError(input.type);
    const parsed = validator.safeParse(input.data);
    if (!parsed.success) {
      throw new EventDataInvalidError(input.type, summarize(parsed.error));
    }
    if (input.type.startsWith("approval/") && this.openTurn === null) {
      throw new NoOpenTurnError(input.type);
    }
    const finalInput = this.arbitrateSurfaceOp(input);
    const event: SessionEvent = {
      type: finalInput.type,
      seq: this.lastSeq + 1,
      time: Date.now(),
      data: finalInput.data,
      ...(finalInput.ignorable !== undefined && { ignorable: finalInput.ignorable }),
    };
    await this.handle?.write(`${JSON.stringify(event)}\n`);
    await this.handle?.sync();
    this.track(event);
    return event;
  }

  events(): readonly SessionEvent[] {
    return this.log;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle?.close();
    this.handle = null;
    await this.lock.release();
  }

  get directory(): string {
    return this.dir;
  }

  private assertOpen(): void {
    if (this.closed || this.handle === null) {
      throw new Error("session store is closed");
    }
  }

  /** surfaceOp 重叠裁决（session.md §4）：先写生效，后到的整条忽略、补一条非致命 error */
  private arbitrateSurfaceOp(input: SessionEventInput): SessionEventInput {
    const surfaceOp = readSurfaceOp(input.data);
    if (surfaceOp?.op !== "replace" || !overlaps(this.intervals, surfaceOp)) {
      return input;
    }
    const partial = input.data as { turn?: string; step?: number };
    return {
      type: "error",
      data: {
        ...(partial.turn !== undefined && { turn: partial.turn }),
        ...(partial.step !== undefined && { step: partial.step }),
        code: "surface-op-overlap-ignored",
        message: `replace interval [${surfaceOp.startSeq}, ${surfaceOp.endSeq}] overlaps an accepted interval; record ignored (first-writer-wins)`,
        fatal: false,
      },
    };
  }

  private track(event: SessionEvent): void {
    this.log.push(event);
    this.lastSeq = event.seq;
    if (event.type === "turn/start") {
      this.openTurn = (event.data as { turn?: string }).turn ?? null;
    }
    if (event.type === "turn/end") {
      this.openTurn = null;
    }
    const surfaceOp = readSurfaceOp(event.data);
    if (surfaceOp?.op === "replace" && !overlaps(this.intervals, surfaceOp)) {
      this.intervals.push(surfaceOp);
    }
  }
}

function summarize(error: unknown): string {
  const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? [];
  return issues
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
