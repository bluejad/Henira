// 排队持久化（D-045 / D-092）：会话目录 queue.json，tmp+rename 原子重写（同 plugins/session 的
// atomicWriteFile 语义——十行小函数就地复制，M4 若再现第三处使用则抽支撑包，P9-5 不两处手抄清单只禁清单）。
// 队列状态不进事件账本（P9-1：队列不是对话事实）；重启恢复 = start 时装载。
// v2：条目分型 kind = prompt | compact（手动压缩与消息同一条 FIFO）；v1 文件按 prompt 读（D-092）。

import { promises as fs } from "node:fs";
import {
  COMPACT_COMMAND,
  type PromptOptions,
  type QueuedKind,
  type QueuedPrompt,
} from "@henira/protocol";

export interface QueueEntry extends QueuedPrompt {
  queuedAt: number;
}

const QUEUE_FILE = "queue.json";
/** 写入版本（读兼容 1：旧条目没有 kind，按 prompt 处理） */
const QUEUE_VERSION = 2;

async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
  try {
    const handle = await fs.open(tmp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export class PromptQueue {
  #entries: QueueEntry[] = [];
  readonly #file: string;
  /** 落盘写链（见 #save）：前一次写结算后才开始下一次 */
  #writes: Promise<void> = Promise.resolve();

  constructor(sessionDir: string) {
    this.#file = `${sessionDir}/${QUEUE_FILE}`;
  }

  /** 装载（重启恢复）；文件缺失 / 损坏 → 空队列（队列不是事实源，丢了不致命）。
   *  v1 兼容：缺 kind 的条目按 prompt 读；compact 项保留 instructions。 */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.#file, "utf8");
      const parsed = JSON.parse(raw) as { entries?: unknown };
      if (!Array.isArray(parsed.entries)) {
        this.#entries = [];
        return;
      }
      this.#entries = parsed.entries.flatMap((value) => {
        const entry = normalizeEntry(value);
        return entry === undefined ? [] : [entry];
      });
    } catch {
      this.#entries = [];
    }
  }

  get pending(): readonly QueueEntry[] {
    return this.#entries;
  }

  async enqueue(text: string, steer: boolean, opts?: PromptOptions): Promise<QueueEntry> {
    return this.#push({
      id: newId(),
      kind: "prompt",
      text,
      steer,
      ...(opts?.modelId !== undefined ? { modelId: opts.modelId } : {}),
      ...(opts?.reasoningEffort !== undefined ? { reasoningEffort: opts.reasoningEffort } : {}),
      ...(opts?.permissionMode !== undefined ? { permissionMode: opts.permissionMode } : {}),
      queuedAt: Date.now(),
    });
  }

  /** 手动压缩作为队列意图追加队尾（D-092）：text 固定为 "/compact" 供排队卡一行显示，
   *  说明单独持久化（消费时并入摘要指令）。 */
  async enqueueCompact(instructions?: string): Promise<QueueEntry> {
    return this.#push({
      id: newId(),
      kind: "compact",
      text: COMPACT_COMMAND,
      steer: false,
      ...(instructions !== undefined ? { instructions } : {}),
      queuedAt: Date.now(),
    });
  }

  /** 条目"立即发送"（D-045）：steer 升格；条目不存在或不是 prompt 返回 false */
  async steer(entryId: string): Promise<boolean> {
    const entry = this.#entries.find((e) => e.id === entryId);
    if (entry?.kind !== "prompt") return false;
    entry.steer = true;
    await this.#save();
    return true;
  }

  /** 删除排队条目（排队卡 UI 的行级删除）；条目不存在返回 false */
  async remove(entryId: string): Promise<boolean> {
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((e) => e.id !== entryId);
    if (this.#entries.length === before) return false;
    await this.#save();
    return true;
  }

  /** claim：取走全部插话条目（step 边界进场，[zcode] turn-guide-drain.ts:9-31 同槽位）；
   *  compact 项不是插话（维护意图只按 FIFO 消费） */
  async claimSteers(): Promise<QueueEntry[]> {
    const steers = this.#entries.filter((e) => e.steer && e.kind === "prompt");
    if (steers.length > 0) {
      this.#entries = this.#entries.filter((e) => !(e.steer && e.kind === "prompt"));
      await this.#save();
    }
    return steers;
  }

  /** drain：回合末 / 冲刷链依次取队头（先进先出，D-045 / D-092） */
  async drainNext(): Promise<QueueEntry | undefined> {
    const [next] = this.#entries.splice(0, 1);
    if (next) await this.#save();
    return next;
  }

  /** 已摘条目回队头：冲刷链被取消（promote 武装 / 手动停止）落在「下一条已摘、
   * 未进回合」的空隙时回收——条目不丢、顺序保持（链取消回收，2026-11-20） */
  async pushBack(entry: QueueEntry): Promise<void> {
    this.#entries.unshift(entry);
    await this.#save();
  }

  /** 条目移到队头：promote 在链空窗（无回合可打断）时的等效插队——旧链下一拍消费 */
  async moveToFront(entryId: string): Promise<boolean> {
    const idx = this.#entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return false;
    const [entry] = this.#entries.splice(idx, 1);
    this.#entries.unshift(entry);
    await this.#save();
    return true;
  }

  async #push(entry: QueueEntry): Promise<QueueEntry> {
    this.#entries.push(entry);
    await this.#save();
    return entry;
  }

  /** 落盘串行化（D-092 决定 6）：冲刷链摘条目的落盘与并发入队的落盘会交错——tmp+rename
   *  各写各的，Windows 上后到的 rename 撞前一个的替换窗口（EPERM/ENOENT），落盘内容还可能
   *  是旧快照（丢更新）。每次写排进同一条链，轮到自己时才序列化 entries（最新态）；单次
   *  失败照常抛给当次调用方，但不中断写链。 */
  #save(): Promise<void> {
    const write = this.#writes.then(() =>
      atomicWrite(
        this.#file,
        JSON.stringify({ version: QUEUE_VERSION, entries: this.#entries }, null, 2),
      ),
    );
    this.#writes = write.catch(() => {});
    return write;
  }
}

function newId(): string {
  return `q${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/** 装载归一：v1 无 kind → prompt；字段类型不对的条目丢弃（损坏的队列项不能带病消费） */
function normalizeEntry(value: unknown): QueueEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || typeof entry.text !== "string") return undefined;
  const kind: QueuedKind = entry.kind === "compact" ? "compact" : "prompt";
  return {
    id: entry.id,
    kind,
    text: entry.text,
    steer: kind === "prompt" ? entry.steer === true : false,
    ...(typeof entry.modelId === "string" ? { modelId: entry.modelId } : {}),
    ...(typeof entry.reasoningEffort === "string"
      ? { reasoningEffort: entry.reasoningEffort as QueueEntry["reasoningEffort"] }
      : {}),
    ...(typeof entry.permissionMode === "string"
      ? { permissionMode: entry.permissionMode as QueueEntry["permissionMode"] }
      : {}),
    ...(kind === "compact" && typeof entry.instructions === "string"
      ? { instructions: entry.instructions }
      : {}),
    queuedAt: typeof entry.queuedAt === "number" ? entry.queuedAt : Date.now(),
  };
}
