// plugin-loop 服务件（packages.md：turn/step 状态机、inbox、中断纪律、16ms 合并、bail 缝）。
// run() = 开新回合（生成器流 LoopEvent；忙时抛 LoopBusyError——忙时投递唯一 = 排队，D-045）；
// send() = 闲时直开回合（后台跑，事件走总线 loop/event）/ 忙时入队持久化；
// steer() = 条目"立即发送"升格；interrupt() = 中止当前回合（中断纪律全家桶在 turn.ts）。
// 会话目录（queue.json 住处）从 session 槽取（SessionService.directory，protocol 定稿字段）。

import type { ServiceDefinition } from "@reins/kernel";
import {
  asReinsContext,
  type LoopEvent,
  type LoopService,
  type QueuedPrompt,
  type SessionService,
} from "@reins/protocol";
import { PromptQueue } from "./queue.js";
import { type LoopDeps, runTurnCore, systemPromptHash, type TurnHandle } from "./turn.js";

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
      const cx = asReinsContext(ctx);
      const session = cx.get("session");
      const queue = new PromptQueue((session as SessionService & { directory: string }).directory);
      await queue.load(); // 重启恢复（D-045）

      let current: TurnHandle | undefined;

      const makeDeps = (): LoopDeps => ({
        ctx: cx,
        session,
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
        );
        const settled = core.then(
          () => channel.close(),
          () => channel.close(), // 错误已落盘为事件（纪律 5）；通道照常收尾
        );
        yield* channel.stream();
        await settled;
        // 回合末冲刷：队列头部依次自动开新回合（D-045）
        let next = await queue.drainNext();
        while (next !== undefined) {
          yield* executeAndDrain(next.text, signal);
          next = await queue.drainNext();
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
        async *run(prompt, signal) {
          if (current !== undefined && !current.signal.aborted) throw new LoopBusyError();
          const controller = new AbortController();
          signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
          try {
            yield* executeAndDrain(prompt, controller.signal);
          } finally {
            current = undefined;
          }
        },

        async send(prompt, opts) {
          if (current !== undefined && !current.signal.aborted) {
            return queue.enqueue(prompt, opts?.steer === true); // 忙时入队（queue.json 持久化）
          }
          // 闲时直开回合：后台跑，事件经总线 loop/event 观察（D-045：无第二种投递语义）
          const controller = new AbortController();
          const gen = executeAndDrain(prompt, controller.signal);
          void drainQuietly(gen).catch(() => {});
          return { id: "", text: prompt, steer: false }; // id 空 = 未排队（直接开跑）
        },

        async steer(entryId) {
          return queue.steer(entryId);
        },

        async interrupt() {
          current?.signal.abort();
        },
      };
      return service;
    },
  };
}

export type { QueuedPrompt, SessionService };
