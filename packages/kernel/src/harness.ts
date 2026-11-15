// 装配内核：静态装配（D-011——不做热加载），use() 只能在 start() 之前。
// 卸载语义对齐 cordis fiber（[dsh] vendor/cordis/src/fiber.ts）：重入卸载合流（:281-295，
// 钉子①）、setup 内注册先挂归属再执行（:517-520，钉子②）、UNLOADING 拒绝注册（:418-422，
// 钉子⑤）、同步启动失败回滚已收归的清理（vendor/README.md 第 6 条）。
// 有意差异：逆序严格串行卸载（cordis 异步 disposer 并发竞跑，我们求确定性）；
// start() 进行中调 dispose() = 启动中止 + 全量回滚（vendor inertia 机器在该场景的轻量等价；
// 在 start 体里 await dispose() 会循环等待，不在支持范围——卸载从 start 外部发起）。

import {
  AssemblyError,
  InactiveEffectError,
  MissingSlotError,
  SlotConflictError,
  SlotNotStartedError,
  UseAfterStartError,
} from "./errors.js";
import { createEvents, EventBusImpl, type FaultReporter, reportToConsole } from "./events.js";
import { analyze, type DefEntry, ownerNameOf, topoOrder } from "./topology.js";
import type { Disposable, Harness, HarnessContext, ServiceDefinition } from "./types.js";

const noop: Disposable = () => {};

interface StartedEntry {
  owner: string;
  def: ServiceDefinition<unknown>;
  svc: unknown;
  disposables: Disposable[];
  unwound: boolean;
}

export function createHarness(opts?: { report?: FaultReporter }): Harness {
  return new HarnessCore(opts?.report ?? reportToConsole);
}

class HarnessCore implements Harness {
  private defs: DefEntry[] = [];
  private slotOwners = new Map<string, string>();
  private services = new Map<string, unknown>();
  private started: StartedEntry[] = [];
  private phase: "idle" | "starting" | "started" | "disposed" = "idle";
  private unwinding = false;
  private readonly bus: EventBusImpl;
  private harnessDisposables: Disposable[] = [];
  private readonly harnessContext: HarnessContext;
  private disposePromise: Promise<void> | null = null;
  private startPromise: Promise<void> | null = null;
  private disposeRequested = false;
  private readonly report: FaultReporter;

  constructor(report: FaultReporter) {
    this.report = report;
    this.bus = new EventBusImpl(report);
    this.harnessContext = this.makeContext("harness", this.harnessDisposables);
  }

  use(def: ServiceDefinition): this {
    if (this.phase !== "idle") {
      throw new UseAfterStartError(def.name ?? "(anonymous)");
    }
    if (def.name !== undefined && this.slotOwners.has(def.name)) {
      throw new SlotConflictError(def.name, def.name, this.slotOwners.get(def.name) ?? "?");
    }
    const owner = ownerNameOf(def, this.defs.length);
    this.defs.push({ def, owner });
    if (def.name !== undefined) this.slotOwners.set(def.name, owner);
    return this;
  }

  async start(): Promise<void> {
    if (this.phase !== "idle") {
      throw new Error(`start() called in phase "${this.phase}"`);
    }
    this.phase = "starting";
    this.startPromise = this.runStart();
    return this.startPromise;
  }

  get context(): HarnessContext {
    return this.harnessContext;
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise; // 钉子①：重入合入同一次卸载
    if (this.phase === "starting" && this.startPromise) {
      this.disposeRequested = true;
      this.disposePromise = this.startPromise.then(
        () => this.runTeardown(),
        () => this.runTeardown(),
      );
    } else {
      this.disposePromise = this.runTeardown();
    }
    return this.disposePromise;
  }

  private async runStart(): Promise<void> {
    try {
      const { missing, cycles } = analyze(this.defs);
      if (missing.length > 0 || cycles.length > 0) {
        throw new AssemblyError(missing, cycles);
      }
      for (const entry of topoOrder(this.defs)) {
        if (this.disposeRequested) {
          throw new Error("harness disposed during start()");
        }
        await this.startOne(entry);
      }
      this.phase = "started";
    } catch (err) {
      this.enterTeardown();
      await this.unwindStarted();
      throw err;
    }
  }

  private async startOne(entry: DefEntry): Promise<void> {
    const started: StartedEntry = {
      owner: entry.owner,
      def: entry.def as ServiceDefinition<unknown>,
      svc: undefined,
      disposables: [],
      unwound: false,
    };
    const ctx = this.makeContext(entry.owner, started.disposables);
    try {
      started.svc = await entry.def.start(ctx);
    } catch (err) {
      // 已注册的随失败回滚（钉子②后半：同步启动失败回滚已收归的清理）
      this.enterTeardown();
      await this.unwindEntry(started);
      throw err;
    }
    this.started.push(started);
    if (entry.def.name !== undefined) this.services.set(entry.def.name, started.svc);
  }

  private async runTeardown(): Promise<void> {
    this.enterTeardown();
    await this.unwindStarted();
    for (const d of [...this.harnessDisposables].reverse()) {
      try {
        d();
      } catch (err) {
        this.report(err, 'dispose effect of "harness"');
      }
    }
    this.harnessDisposables = [];
  }

  private enterTeardown(): void {
    if (this.unwinding) return;
    this.unwinding = true; // 卸载开始（钉子⑤：此刻起注册一律拒绝）
    this.phase = "disposed";
    this.bus.seal();
  }

  private async unwindStarted(): Promise<void> {
    for (const entry of [...this.started].reverse()) {
      await this.unwindEntry(entry);
    }
    this.started = [];
  }

  private async unwindEntry(entry: StartedEntry): Promise<void> {
    if (entry.unwound) return;
    entry.unwound = true;
    // 注册同步撤销（逆序）→ stop() 异步收尾（interfaces.md P7 约定）
    for (const d of [...entry.disposables].reverse()) {
      try {
        d();
      } catch (err) {
        this.report(err, `dispose effect of "${entry.owner}"`);
      }
    }
    try {
      await entry.def.stop?.(entry.svc);
    } catch (err) {
      this.report(err, `stop() of "${entry.owner}"`);
    }
  }

  private makeContext(owner: string, collector: Disposable[]): HarnessContext {
    return {
      get: <T>(slot: string) => this.getService(slot, owner) as T,
      events: createEvents(this.bus, owner, (d) => collector.push(d)),
      effect: (fn) => this.registerEffect(owner, fn, collector),
    };
  }

  private registerEffect(
    owner: string,
    // biome-ignore lint/suspicious/noConfusingVoidType: 对齐 HarnessContext.effect 定稿形状
    fn: () => Disposable | void,
    collector: Disposable[],
  ): Disposable {
    if (this.unwinding) throw new InactiveEffectError(owner);
    const inner = fn();
    if (typeof inner !== "function") return noop;
    collector.push(inner);
    let undone = false;
    return () => {
      if (undone) return;
      undone = true;
      const index = collector.indexOf(inner);
      if (index >= 0) collector.splice(index, 1);
      inner();
    };
  }

  private getService(slot: string, requester: string): unknown {
    if (!this.slotOwners.has(slot)) {
      const available = this.phase === "disposed" ? [] : [...this.slotOwners.keys()];
      throw new MissingSlotError(slot, requester, available);
    }
    if (this.phase === "disposed") {
      throw new MissingSlotError(slot, requester, []);
    }
    if (!this.services.has(slot)) {
      throw new SlotNotStartedError(slot, requester);
    }
    return this.services.get(slot);
  }
}
