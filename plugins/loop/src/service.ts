// plugin-loop 服务件（packages.md：turn/step 状态机、inbox、中断纪律、16ms 合并、bail 缝）。
// run() = 开新回合（生成器流 LoopEvent；忙时抛 LoopBusyError——忙时投递唯一 = 排队，D-045）；
// send() = 闲时直开回合（后台跑，事件走总线 loop/event）/ 忙时入队持久化；
// steer() = 条目"插话"升格（不打断当前，step 边界进场）；promote() = 抢占式"立即发送"
// （abort 当前 + 等收尾 + 该条开新回合）；interrupt() = 中止当前回合（中断纪律全家桶在 turn.ts）。
// 中断×队列：队列非空时中断 = 冻结不冲刷（paused 标志 + resume() 显式恢复），不把 abort
// 信号传进冲刷循环（否则条目「生而为 abort」——user 行落账、无回复）。
// 会话目录（queue.json 住处）从 session 槽取（SessionService.directory，protocol 定稿字段）。

import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  type LoopEvent,
  type LoopService,
  type PromptOptions,
} from "@henira/protocol";
import { PromptQueue } from "./queue.js";
import { systemPromptHash } from "./step.js";
import { type LoopDeps, runTurnCore, type TurnHandle } from "./turn.js";

export { systemPromptHash };

export class LoopBusyError extends Error {
  constructor() {
    super("a turn is already running; queue it with send() (D-045: busy delivery = queue only)");
    this.name = "LoopBusyError";
  }
}

/** 单消费者事件通道：回合执行（回调）→ 生成器（消费者） */
class EventChannel {
  #buffer: LoopEvent[] = [];
  #waiters: (() => void)[] = [];
  #closed = false;

  push(event: LoopEvent): void {
    this.#buffer.push(event);
    this.#wake();
  }

  close(): void {
    this.#closed = true;
    this.#wake();
  }

  #wake(): void {
    this.#waiters.shift()?.();
  }

  async *stream(): AsyncGenerator<LoopEvent> {
    while (true) {
      if (this.#buffer.length > 0) {
        yield this.#buffer.shift() as LoopEvent;
      } else if (this.#closed) {
        return;
      } else {
        await new Promise<void>((resolve) => this.#waiters.push(resolve));
      }
    }
  }
}

export interface LoopPluginOptions {
  maxStepsPerTurn?: number; // 可选默认不设（D-045）
}

export function loopPlugin(options: LoopPluginOptions = {}): ServiceDefinition<LoopService> {
  return {
    name: "loop",
    inject: ["session", "llm", "tools", "approval", "config"],
    async start(ctx) {
      const cx = asHeniraContext(ctx);
      const queue = new PromptQueue(cx.get("session").directory); // directory 是 SessionService 定稿字段
      await queue.load(); // 重启恢复（D-045）

      let current: TurnHandle | undefined;
      let currentController: AbortController | undefined;
      // 中断冻结标志（投影源：LoopService.paused()；UI 暂停横幅判据）。只在「中断且队列
      // 非空」时置位；resume()/冲刷成功/send 闲时开跑三处清除——不能由 !busy 推导
      // （回合末 busy 翻 false 与冲刷广播之间有真实窗口，推导会让横幅每对回合间闪烁）。
      let queuePaused = false;
      /** promote 抢占的 abort 标记（守卫据此跳过冻结置位——抢占不产生暂停横幅，
       * 照参照物 preserveQueueAutoDrainOnCancel 语义；普通 interrupt 无 reason 照常冻结） */
      const PROMOTE_ABORT_REASON = "queue-promote";

      /** 队列变更总线广播（排队卡 UI 的观察口，同 user/steer 模式）：载荷 = 当前条目快照 */
      const broadcastQueue = (): void => {
        cx.events.emit("queue/changed", { queue: queue.pending.map((e) => ({ ...e })) });
      };

      /** 解除中断冻结（显式开新回合 = 重新上路；回合末队列照常自动续冲） */
      const clearPause = (): void => {
        if (!queuePaused) return;
        queuePaused = false;
        broadcastQueue();
      };

      const makeDeps = (): LoopDeps => ({
        ctx: cx,
        session: cx.get("session"),
        llm: cx.get("llm"),
        tools: cx.get("tools"),
        approval: cx.get("approval"),
        config: cx.get("config"),
        queue,
        maxStepsPerTurn: options.maxStepsPerTurn,
      });

      /** 一回合 + 回合末队列依次冲刷（D-045）；事件双喂：本生成器 + 总线 loop/event */
      async function* executeAndDrain(
        prompt: string,
        signal: AbortSignal,
        opts?: PromptOptions,
      ): AsyncGenerator<LoopEvent> {
        const channel = new EventChannel();
        const core = runTurnCore(
          prompt,
          makeDeps(),
          {
            onEvent: (event) => {
              channel.push(event);
              cx.events.emit("loop/event", event); // send() 路径的唯一观察口（M3 SSE 同源）
            },
            onTurnStart: (handle) => {
              current = handle;
            },
          },
          signal,
          opts,
        );
        const settled = core.then(
          () => channel.close(),
          () => channel.close(), // 错误已落盘为事件（纪律 5）；通道照常收尾
        );
        yield* channel.stream();
        await settled;
        // 中断冻结：abort 后不冲刷（信号已废，冲出的条目只会生而为 abort）——队列原地
        // 留守，等 resume() 显式恢复；队列空则无事可冻。promote 抢占的 abort 不置冻结
        // （剩余队列在其新回合结束后照常自动续冲）
        if (signal.aborted) {
          if (queue.pending.length > 0 && signal.reason !== PROMOTE_ABORT_REASON) {
            queuePaused = true;
            broadcastQueue();
          }
          return;
        }
        // 回合末冲刷：队列头部依次自动开新回合（D-045；条目自带的模型/思考覆盖随行）
        let next = await queue.drainNext();
        queuePaused = false; // 自动续冲 = 冻结态解除（广播由下方统一发）
        broadcastQueue();
        while (next !== undefined) {
          yield* executeAndDrain(next.text, signal, {
            modelId: next.modelId,
            reasoningEffort: next.reasoningEffort,
          });
          next = await queue.drainNext();
          broadcastQueue();
        }
      }

      async function drainQuietly(gen: AsyncGenerator<LoopEvent>): Promise<void> {
        let count = 0;
        for await (const event of gen) {
          void event;
          count += 1;
        }
        void count;
      }

      const service: LoopService = {
        async *run(prompt, signal, opts) {
          if (current !== undefined && !current.signal.aborted) throw new LoopBusyError();
          clearPause(); // 显式开新回合 = 重新上路
          const controller = new AbortController();
          currentController = controller;
          signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
          try {
            yield* executeAndDrain(prompt, controller.signal, opts);
          } finally {
            current = undefined;
            currentController = undefined;
          }
        },

        async send(prompt, opts) {
          if (current !== undefined && !current.signal.aborted) {
            // 忙时入队（queue.json 持久化；模型/思考覆盖随条目持久化）
            const entry = await queue.enqueue(prompt, opts?.steer === true, {
              modelId: opts?.modelId,
              reasoningEffort: opts?.reasoningEffort,
            });
            broadcastQueue();
            return entry;
          }
          // 闲时直开回合：后台跑，事件经总线 loop/event 观察（D-045：无第二种投递语义）
          clearPause(); // 用户主动发新消息 = 重新上路（回合末队列照常自动续冲）
          const controller = new AbortController();
          currentController = controller;
          const gen = executeAndDrain(prompt, controller.signal, {
            modelId: opts?.modelId,
            reasoningEffort: opts?.reasoningEffort,
          });
          void drainQuietly(gen)
            .finally(() => {
              current = undefined;
              currentController = undefined;
            })
            .catch(() => {});
          return { id: "", text: prompt, steer: false }; // id 空 = 未排队（直接开跑）
        },

        async steer(entryId) {
          const ok = await queue.steer(entryId);
          if (ok) broadcastQueue();
          return ok;
        },

        async promote(entryId) {
          // 先查条目：不存在直接 false（不 abort 任何东西——否则运行中的提升回合会被
          // 二次点击/重复 promote 误杀）
          const entry = queue.pending.find((e) => e.id === entryId);
          if (entry === undefined) return false;
          // 抢占式立即发送：abort 当前 → 等旧链完全收尾（照参照物 stop-barrier——
          // 立刻重发会撞忙判定）→ 摘条目 → 开新回合。此刻才摘条目：等收尾失败
          // （超时）则条目原位不动，无半完成态
          if (current !== undefined) {
            currentController?.abort(PROMOTE_ABORT_REASON);
            const deadline = Date.now() + 10_000;
            while (current !== undefined) {
              if (Date.now() > deadline) return false;
              await new Promise((r) => setTimeout(r, 25));
            }
          }
          await queue.remove(entryId);
          clearPause(); // 抢占不产生冻结态；原本已冻结则解冻（回合末队列照常自动续冲）
          broadcastQueue();
          const controller = new AbortController();
          currentController = controller;
          const gen = executeAndDrain(entry.text, controller.signal, {
            modelId: entry.modelId,
            reasoningEffort: entry.reasoningEffort,
          });
          void drainQuietly(gen)
            .finally(() => {
              current = undefined;
              currentController = undefined;
            })
            .catch(() => {});
          return true;
        },

        pending() {
          return queue.pending.map((e) => ({ ...e })); // 快照副本——调用方改动不回灌
        },

        async remove(entryId) {
          const ok = await queue.remove(entryId);
          if (ok) broadcastQueue();
          return ok;
        },

        paused() {
          return queuePaused;
        },

        async resume() {
          // 忙时判定从严：旧中断链的 finally 清 current 是异步的，!aborted 放行会有
          // 双链并跑竞态——current 在册一律拒绝（冻结态下 UI 横幅在场，点击间隔够不着该窗口）
          if (current !== undefined) return false;
          const next = await queue.drainNext();
          queuePaused = false;
          broadcastQueue();
          if (next === undefined) return false;
          // 开新回合（fresh signal——冻结态本身就是旧 signal 已废的结果）
          const controller = new AbortController();
          currentController = controller;
          const gen = executeAndDrain(next.text, controller.signal, {
            modelId: next.modelId,
            reasoningEffort: next.reasoningEffort,
          });
          void drainQuietly(gen)
            .finally(() => {
              current = undefined;
              currentController = undefined;
            })
            .catch(() => {});
          return true;
        },

        async interrupt() {
          currentController?.abort(); // 中止当前回合（中断纪律在 turn.ts 逐条收尾）
        },
      };
      return service;
    },
  };
}
