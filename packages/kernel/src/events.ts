// 事件总线：四种派发模式（D-012①）。派发语义对齐 cordis（[dsh] vendor/cordis/src/events.ts）：
// 快照派发（:165-175）、emit 忽略返回值与 Promise（:194-196）、waterfall 闭包链（:234-243）。
// 有意差异：double-next 抛错（上游有、dsh fork 无，采上游）；emit 监听器异常隔离上报；
// 卸载封闸（钉子⑤，对应 fiber.ts:418-422 的 UNLOADING 拒绝注册）。

import { DoubleNextError, InactiveEffectError } from "./errors.js";
import type { Disposable, EventBus, Veto } from "./types.js";

type EmitFn = (payload: unknown) => void;
type SerialFn = (payload: unknown) => void | Promise<void>;
type WaterfallFn = (value: unknown, next: (v: unknown) => Promise<unknown>) => unknown;
type BailFn = (value: unknown) => Veto | undefined | Promise<Veto | undefined>;

type Listener =
  | { mode: "emit"; fn: EmitFn; owner: string; removed: boolean }
  | { mode: "serial"; fn: SerialFn; owner: string; removed: boolean }
  | { mode: "waterfall"; fn: WaterfallFn; owner: string; removed: boolean }
  | { mode: "bail"; fn: BailFn; owner: string; removed: boolean };

/** 派发与卸载过程中的异常上报口（kernel 无 logger 服务，v1 用 console.error） */
export type FaultReporter = (err: unknown, where: string) => void;

export function reportToConsole(err: unknown, where: string): void {
  console.error(`[reins:kernel] ${where}:`, err);
}

export class EventBusImpl {
  private hooks = new Map<string, Listener[]>();
  private open = true;

  constructor(private readonly report: FaultReporter) {}

  /** 卸载封闸（钉子⑤）：封闸后一切注册抛 InactiveEffectError */
  seal(): void {
    this.open = false;
  }

  register(mode: Listener["mode"], type: string, owner: string, fn: unknown): Disposable {
    if (!this.open) throw new InactiveEffectError(owner);
    const listener = { mode, fn, owner, removed: false } as Listener;
    const list = this.hooks.get(type);
    if (list) {
      list.push(listener);
    } else {
      this.hooks.set(type, [listener]);
    }
    let disposed = false;
    return () => {
      if (disposed) return; // 幂等（interfaces.md：注册撤销同步、幂等）
      disposed = true;
      listener.removed = true;
      const current = this.hooks.get(type);
      const index = current ? current.indexOf(listener) : -1;
      if (index >= 0) current?.splice(index, 1);
    };
  }

  private snapshot(type: string, mode: Listener["mode"]): Listener[] {
    const list = this.hooks.get(type);
    if (!list) return [];
    // 快照派发（cordis events.ts:165-175）：派发中注册的本轮不触发，移除的本轮仍触发
    return list.filter((l) => l.mode === mode && !l.removed);
  }

  emit(type: string, payload: unknown): void {
    for (const l of this.snapshot(type, "emit")) {
      const fn = l.fn as EmitFn;
      try {
        fn(payload);
      } catch (err) {
        this.report(err, `emit(${type}) listener by ${l.owner}`);
      }
    }
  }

  async serial(type: string, payload: unknown): Promise<void> {
    for (const l of this.snapshot(type, "serial")) {
      const fn = l.fn as SerialFn;
      await fn(payload); // 异常向上抛，剩余监听器不再执行（interfaces.md serial 语义）
    }
  }

  async waterfall<T>(type: string, value: T): Promise<T> {
    const listeners = this.snapshot(type, "waterfall");
    const run = (index: number, current: unknown): Promise<unknown> => {
      if (index >= listeners.length) return Promise.resolve(current);
      let advanced = false;
      const next = (v: unknown): Promise<unknown> => {
        if (advanced) throw new DoubleNextError(type);
        advanced = true;
        return run(index + 1, v);
      };
      // 不调 next() 直接返回 = 否决下游，返回值成为最终结果（钉子④）
      const fn = listeners[index].fn as WaterfallFn;
      return Promise.resolve(fn(current, next));
    };
    // 首层也过微任务：监听器同步抛错统一变为 Promise 拒绝
    return Promise.resolve().then(() => run(0, value)) as Promise<T>;
  }

  async bail<T>(type: string, value: T): Promise<Veto | undefined> {
    for (const l of this.snapshot(type, "bail")) {
      const fn = l.fn as BailFn;
      const result = await fn(value);
      if (result !== undefined) return result; // Veto 是显式对象；undefined = 不否决
    }
    return undefined;
  }
}

/** 每插件事件门面：注册路由进本插件 effect 收集器（随生命周期自动撤销），owner 绑定插件名 */
export function createEvents(
  bus: EventBusImpl,
  owner: string,
  collect: (d: Disposable) => void,
): EventBus {
  return {
    on: (type, fn) => {
      const d = bus.register("emit", type, owner, fn);
      collect(d);
      return d;
    },
    onSerial: (type, fn) => {
      const d = bus.register("serial", type, owner, fn);
      collect(d);
      return d;
    },
    onWaterfall: (type, fn) => {
      const d = bus.register("waterfall", type, owner, fn);
      collect(d);
      return d;
    },
    onBail: (type, fn) => {
      const d = bus.register("bail", type, owner, fn);
      collect(d);
      return d;
    },
    emit: (type, payload) => bus.emit(type, payload),
    serial: (type, payload) => bus.serial(type, payload),
    waterfall: (type, value) => bus.waterfall(type, value),
    bail: (type, value) => bus.bail(type, value),
  };
}
