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
import { ContextMeter } from "./meter.js";
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
      // 余量计量器（compaction.md §4.2）：每步重算并广播读数；停用压缩插件照常成立
      const meter = new ContextMeter((reading) => {
        cx.events.emit("context/changed", { context: reading });
      });

      let current: TurnHandle | undefined;
      let currentController: AbortController | undefined;
      // 冲刷链在跑标志：链 = 一个后台 drainQuietly 驱动的 executeAndDrain 递归生成器
      // （首回合 + 回合末依次冲刷）。回合间存在空窗：上一回合已结算、current 尚未清
      // （清点在链尾 finally），旧链挂在 drainNext 上等新条目——纯回合判定会把空窗
      // 当全闲，第二条链穿透起跑 = 双链并跑、队列互相踩（CI promote 全链两次实锤）。
      // 忙判定（send 入队 / run·resume 拒绝）与 promote 的收尾等待一律以此为准。
      let drainChainAlive = false;
      // promote 武装标志：守卫据此跳过冻结置位。不用 signal.reason 判读——回合收尾
      // 路径的兜底 abort()（无 reason）会覆盖 PROMOTE 标记，慢机上守卫读到被覆盖的
      // reason 就误置冻结（CI 第二次实锤同款时序）。
      let promoteArmed = false;
      // 中断冻结标志（投影源：LoopService.paused()；UI 暂停横幅判据）。只在「中断且队列
      // 非空」时置位；resume()/冲刷成功/send 闲时开跑三处清除——不能由 !busy 推导
      // （回合末 busy 翻 false 与冲刷广播之间有真实窗口，推导会让横幅每对回合间闪烁）。
      let queuePaused = false;
      /** promote 抢占的 abort 标记（标记位见 promoteArmed——reason 会被收尾兜底 abort
       * 覆盖不可作判据；常量保留给 abort 调用本身，语义自文档） */
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
        meter,
        maxStepsPerTurn: options.maxStepsPerTurn,
      });

      /** 一回合 + 回合末队列依次冲刷（D-045）；事件双喂：本生成器 + 总线 loop/event。
       *  queueId = 队列条目 id（D-086：只由冲刷分支传入，落进 user/message 供客户端对账） */
      async function* executeAndDrain(
        prompt: string,
        signal: AbortSignal,
        opts?: PromptOptions,
        queueId?: string,
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
          queueId,
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
          if (queue.pending.length > 0 && !promoteArmed) {
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
          // 链取消落在「回合已结算、下一条已摘」的空隙：已摘条目塞回队头（不丢不乱序），
          // 手动停止在此路径也走守卫同款冻结（promote 武装期间跳过）
          if (signal.aborted) {
            await queue.pushBack(next);
            if (queue.pending.length > 0 && !promoteArmed) {
              queuePaused = true;
            }
            broadcastQueue();
            return;
          }
          yield* executeAndDrain(
            next.text,
            signal,
            {
              modelId: next.modelId,
              reasoningEffort: next.reasoningEffort,
              permissionMode: next.permissionMode,
            },
            next.id,
          );
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

      /** 起后台冲刷链的唯一入口（send / promote / resume 三路共用）：链活标志在此置/清 */
      const startChain = (prompt: string, opts?: PromptOptions): void => {
        drainChainAlive = true;
        const controller = new AbortController();
        currentController = controller;
        const gen = executeAndDrain(prompt, controller.signal, opts);
        void drainQuietly(gen)
          .finally(() => {
            drainChainAlive = false;
            current = undefined;
            currentController = undefined;
          })
          .catch(() => {});
      };

      const service: LoopService = {
        async *run(prompt, signal, opts) {
          if (drainChainAlive) throw new LoopBusyError();
          clearPause(); // 显式开新回合 = 重新上路
          const controller = new AbortController();
          currentController = controller;
          signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
          drainChainAlive = true;
          try {
            yield* executeAndDrain(prompt, controller.signal, opts);
          } finally {
            drainChainAlive = false;
            current = undefined;
            currentController = undefined;
          }
        },

        async send(prompt, opts) {
          if (drainChainAlive) {
            // 链活一律入队（queue.json 持久化；模型/思考覆盖随条目持久化）——回合间
            // 空窗（current 已清、链仍挂 drainNext）也被此判定覆盖，不再穿透起第二链
            const entry = await queue.enqueue(prompt, opts?.steer === true, {
              modelId: opts?.modelId,
              reasoningEffort: opts?.reasoningEffort,
              permissionMode: opts?.permissionMode,
            });
            broadcastQueue();
            return entry;
          }
          // 闲时直开回合：后台跑，事件经总线 loop/event 观察（D-045：无第二种投递语义）
          clearPause(); // 用户主动发新消息 = 重新上路（回合末队列照常自动续冲）
          startChain(prompt, {
            modelId: opts?.modelId,
            reasoningEffort: opts?.reasoningEffort,
            permissionMode: opts?.permissionMode,
          });
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
          if (drainChainAlive) {
            if (current === undefined) {
              // 链活在首回合尚未起跑的微窗（startChain 到 onTurnStart 之间）：没有回合
              // 可打断——条目移到队头，链的下一拍消费它（等效立即发送，零竞态）
              await queue.moveToFront(entryId);
              clearPause();
              broadcastQueue();
              return true;
            }
            // 抢占式立即发送：abort 当前回合 → 等整条链死（不是等 current 清——current
            // 的清点在链尾 finally，链在回合间空窗时 current 仍在册）→ 摘条目 → 开新回合。
            // 此刻才摘条目：等收尾失败（超时）则条目原位不动，无半完成态
            promoteArmed = true;
            currentController?.abort(PROMOTE_ABORT_REASON);
            const deadline = Date.now() + 10_000;
            while (drainChainAlive) {
              if (Date.now() > deadline) {
                promoteArmed = false;
                return false;
              }
              await new Promise((r) => setTimeout(r, 25));
            }
          }
          promoteArmed = false;
          await queue.remove(entryId);
          clearPause(); // 抢占不产生冻结态；原本已冻结则解冻（回合末队列照常自动续冲）
          broadcastQueue();
          startChain(entry.text, {
            modelId: entry.modelId,
            reasoningEffort: entry.reasoningEffort,
            permissionMode: entry.permissionMode,
          });
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

        contextUsage() {
          return meter.reading();
        },

        async restoreContext() {
          // 重启恢复（compaction.md §4.11）：只在没有活态读数时重算（热路径不覆盖）。
          // 模型取账本最近一条 request/header 的模型字符串 `provider/model`（按最后
          // 一次请求的模型查窗口，与按消息归属模型的参照同规）；无 header（从未请求）
          // 或模型配置查不到时不建读数——余量入口保持空，不显示假数字
          if (meter.reading() !== undefined) return;
          const session = cx.get("session");
          const events = session.events();
          let model: string | undefined;
          for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            if (event?.type !== "request/header") continue;
            const value = (event.data as { model?: unknown }).model;
            if (typeof value === "string" && value !== "") {
              model = value;
              break;
            }
          }
          if (model === undefined) return;
          const modelConfig = await cx.get("config").model(model);
          const measured = meter.peek({
            events,
            surface: session.deriveSurface(),
            tools: cx.get("tools").project(),
            modelConfig,
            model,
          });
          meter.setReading(measured.reading);
        },

        isBusy() {
          return drainChainAlive;
        },

        async resume() {
          // 忙时判定从严：链在跑（含回合间空窗）一律拒绝——冻结态下 UI 横幅在场，
          // 点击间隔够不着该窗口；链彻底死透才允许显式恢复
          if (drainChainAlive) return false;
          const next = await queue.drainNext();
          queuePaused = false;
          broadcastQueue();
          if (next === undefined) return false;
          // 开新回合（fresh signal——冻结态本身就是旧 signal 已废的结果）
          startChain(next.text, {
            modelId: next.modelId,
            reasoningEffort: next.reasoningEffort,
            permissionMode: next.permissionMode,
          });
          return true;
        },

        async interrupt() {
          // 在途手动压缩也归停止钮管（compaction.md §4.11）：插件监听总线自行中断
          cx.events.emit("compaction/stop", {});
          currentController?.abort(); // 中止当前回合（中断纪律在 turn.ts 逐条收尾）
        },
      };
      return service;
    },
  };
}
