// 排队持久化（D-045）：会话目录 queue.json，tmp+rename 原子重写（同 plugins/session 的
// atomicWriteFile 语义——十行小函数就地复制，M4 若再现第三处使用则抽支撑包，P9-5 不两处手抄清单只禁清单）。
// 队列状态不进事件账本（P9-1：队列不是对话事实）；重启恢复 = start 时装载。

import { promises as fs } from "node:fs";
import type { PromptOptions, QueuedPrompt } from "@henira/protocol";

export interface QueueEntry extends QueuedPrompt {
  queuedAt: number;
}

const QUEUE_FILE = "queue.json";

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

  constructor(sessionDir: string) {
    this.#file = `${sessionDir}/${QUEUE_FILE}`;
  }

  /** 装载（重启恢复）；文件缺失 / 损坏 → 空队列（队列不是事实源，丢了不致命） */
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.#file, "utf8");
      const parsed = JSON.parse(raw) as { entries?: QueueEntry[] };
      this.#entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch {
      this.#entries = [];
    }
  }

  get pending(): readonly QueueEntry[] {
    return this.#entries;
  }

  async enqueue(text: string, steer: boolean, opts?: PromptOptions): Promise<QueueEntry> {
    const entry: QueueEntry = {
      id: `q${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text,
      steer,
      modelId: opts?.modelId,
      reasoningEffort: opts?.reasoningEffort,
      queuedAt: Date.now(),
    };
    this.#entries.push(entry);
    await this.#save();
    return entry;
  }

  /** 条目"立即发送"（D-045）：steer 升格；条目不存在返回 false */
  async steer(entryId: string): Promise<boolean> {
    const entry = this.#entries.find((e) => e.id === entryId);
    if (!entry) return false;
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

  /** claim：取走全部插话条目（step 边界进场，[zcode] turn-guide-drain.ts:9-31 同槽位） */
  async claimSteers(): Promise<QueueEntry[]> {
    const steers = this.#entries.filter((e) => e.steer);
    if (steers.length > 0) {
      this.#entries = this.#entries.filter((e) => !e.steer);
      await this.#save();
    }
    return steers;
  }

  /** drain：回合末依次冲刷（队头先进新回合，D-045） */
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

  async #save(): Promise<void> {
    await atomicWrite(this.#file, JSON.stringify({ version: 1, entries: this.#entries }, null, 2));
  }
}
