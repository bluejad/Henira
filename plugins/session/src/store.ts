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

export interface AppendOptions {
  /** 修理通道专用：覆盖默认 Date.now()——补写定格账本最后真实事件时间（不发明死亡→重启的
   * 空洞时长，dsh repair「never invents a future time」同思想） */
  time?: number;
  /** 修理通道专用：跳过 approval/* 回合包裹闸（老账本回合已被旧代码收口而审批仍挂） */
  repair?: boolean;
}

export interface CreateSessionResult {
  store: SessionStore;
  /** 本开档是否补写了 interrupted 收尾 */
  synthesizedInterrupted: boolean;
  /** 本开档是否做过 seq 外科重排（写者竞态历史伤——repairLedgerFile） */
  resequenced: boolean;
  /** 本开档补写了 approval/invalidated 的孤儿审批数（R175 重启收口） */
  invalidatedApprovals: number;
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
  /** 未决审批表（装载/追加时跟踪；开档收口用）——requestId → asked 上下文 */
  private readonly pendingApprovals = new Map<string, { turn: string; step: number }>();
  /** append 串行化链：seq 分配与落盘必须原子（历史伤教训——并发连发各自算 lastSeq+1，
   * 多事件共享同一 seq，严格读闸判整份账本死刑；普查实锤 13 份账本全是 decided 连发抢 seq） */
  #tail: Promise<unknown> = Promise.resolve();

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
        const resequenced = await repairLedgerFile(filePath);
        return await SessionStore.openExisting(filePath, lock, resequenced);
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
      resequenced: false,
      invalidatedApprovals: 0,
    };
  }

  private static async openExisting(
    filePath: string,
    lock: SessionLock,
    resequenced: boolean,
  ): Promise<CreateSessionResult> {
    const { header, events, truncatedAt } = await readSessionFile(filePath);
    void truncatedAt; // 截断已在 reader 内落盘
    const handle = await fs.open(filePath, "a");
    const store = new SessionStore(header, path.dirname(filePath), lock, handle);
    for (const event of events) store.track(event);
    // R175 重启收口：孤儿挂起审批补写 approval/invalidated（修理通道绕回合包裹闸——老账本
    // 可能回合已被旧代码收口而审批仍挂）。先审批后回合，保持账本叙事单调。
    // 补写 time = 账本最后真实事件时间：轮耗时定格在死亡时刻，不显示死亡→重启的空洞时长。
    const repairTime = events.length > 0 ? events[events.length - 1].time : Date.now();
    let invalidatedApprovals = 0;
    for (const [requestId, asked] of store.pendingApprovals) {
      await store.append(
        {
          type: "approval/invalidated",
          data: { turn: asked.turn, step: asked.step, requestId },
          ignorable: true, // 旧读者不认识本类型时透明跳过（fail-closed 闸的豁免通道）
        },
        { repair: true, time: repairTime },
      );
      invalidatedApprovals += 1;
    }
    const hadOpenTurn = store.openTurn !== null;
    if (hadOpenTurn) {
      // 崩溃也要有收尾：补写 interrupted（session.md §5）
      await store.append(
        {
          type: "turn/end",
          data: { turn: store.openTurn, reason: "interrupted" },
        },
        { time: repairTime },
      );
    }
    return { store, synthesizedInterrupted: hadOpenTurn, resequenced, invalidatedApprovals };
  }

  /** 追加：校验 → 分配 seq → 写行 → fsync → 内存入账。调用间串行（#tail 链）——seq 分配
   * 与落盘原子，失败不断链（下一次追加照常进行） */
  async append(input: SessionEventInput, opts?: AppendOptions): Promise<SessionEvent> {
    const run = this.#tail.then(() => this.#appendNow(input, opts));
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #appendNow(input: SessionEventInput, opts?: AppendOptions): Promise<SessionEvent> {
    this.assertOpen();
    const validator = validatorFor(input.type);
    if (validator === undefined) throw new UnregisteredEventTypeError(input.type);
    const parsed = validator.safeParse(input.data);
    if (!parsed.success) {
      throw new EventDataInvalidError(input.type, summarize(parsed.error));
    }
    if (input.type.startsWith("approval/") && this.openTurn === null && opts?.repair !== true) {
      throw new NoOpenTurnError(input.type);
    }
    const finalInput = this.arbitrateSurfaceOp(input);
    const event: SessionEvent = {
      type: finalInput.type,
      seq: this.lastSeq + 1,
      time: opts?.time ?? Date.now(),
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
    if (event.type === "approval/asked") {
      const data = event.data as { requestId?: string; turn?: string; step?: number };
      if (data.requestId !== undefined) {
        this.pendingApprovals.set(data.requestId, {
          turn: data.turn ?? "",
          step: data.step ?? 0,
        });
      }
    }
    if (event.type === "approval/decided" || event.type === "approval/invalidated") {
      const data = event.data as { requestId?: string };
      if (data.requestId !== undefined) this.pendingApprovals.delete(data.requestId);
    }
    const surfaceOp = readSurfaceOp(event.data);
    if (surfaceOp?.op === "replace" && !overlaps(this.intervals, surfaceOp)) {
      this.intervals.push(surfaceOp);
    }
  }
}

/** seq 外科重排（R175）：保行序保事件、只重assign seq 为 1..N；非必要零改写（幂等）。
 * 动机：append 串行化之前写者竞态让并发连发共享同一 seq（普查 13/79 份账本全是
 * approval/decided 连发），严格读闸判整份账本死刑 → 会话永久打不开（attach 必 500）。
 * 不删行——删掉 decided 会让对应审批在重放中永远挂起；文件行序 = 真实写入序，重排不丢事实。 */
export async function repairLedgerFile(filePath: string): Promise<boolean> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  if (lines.length === 0) return false;
  const out: string[] = [lines[0]]; // header 原样
  let expected = 1;
  let needs = false;
  let lastIndexNonEmpty = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() !== "") lastIndexNonEmpty = i;
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    let event: { seq?: unknown; type?: unknown } | undefined;
    try {
      event = JSON.parse(line) as { seq?: unknown; type?: unknown };
    } catch {
      if (i !== lastIndexNonEmpty) return false; // 文件中部坏行不归本修理管（reader 判 corrupt）
      continue; // 末行半行（崩溃残留）——reader 本会截断，重写时丢弃
    }
    if (typeof event.type !== "string" || event.type === "") return false; // 结构伤不归本修理管
    if (event.seq !== expected) {
      needs = true;
      event.seq = expected;
    }
    expected += 1;
    out.push(JSON.stringify(event));
  }
  if (!needs) return false;
  const tmp = `${filePath}.repair-tmp`;
  await fs.writeFile(tmp, `${out.join("\n")}\n`, "utf8");
  // Windows 下目标被并发读者（ledgerEvents 快照/翻页路径）短暂握持时 rename 报 EPERM——退避重试
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rename(tmp, filePath);
      return true;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await fs.rm(tmp, { force: true }).catch(() => {});
  throw lastError;
}

function summarize(error: unknown): string {
  const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? [];
  return issues
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
