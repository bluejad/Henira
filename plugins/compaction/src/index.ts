// plugin-compaction：上下文压缩（compaction.md）。外圈官方件：占 `compaction` 槽，
// 进默认预设，可停用；停用后计量/封顶/余量显示照常（那些住 loop/protocol）。
// 本件只做压缩行为：压力触发（loop/pre-step）/ 溢出恢复（loop/request-failed）→
// 选区 → 同形摘要（四档降档）→ 原子替换 → compaction/* 审计事件；失败走无模型阶梯；
// 连续失败/快速回填有熔断（活态总线，不落账本）。
// 事件一律 ignorable: true（session 包注册为基础事件，I-11：插件不在也能开账本）。

import type { ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  COMPACTION_INSTRUCTIONS_MAX,
  type CompactionService,
  type CompactionTrigger,
  type CompactQueueOutcome,
  contextBudget,
  estimateSurface,
  LLM_ERROR_CONTEXT_OVERFLOW,
  type ModelConfig,
  measureContext,
  type PreStepValue,
  type QueuedPrompt,
  type RequestFailedValue,
  type SessionEvent,
} from "@henira/protocol";
import { digestOversizedUnits } from "./digest.js";
import { buildSummaryInstruction, SUMMARY_MARKER } from "./prompt.js";
import { selectInterval } from "./selection.js";
import { requestSummary } from "./summarizer.js";

/** 压力/溢出阶段失败的可见错误码（F-2 / F-1：非致命时痕迹由压缩行承载） */
export const COMPACTION_FAILED_CODE = "COMPACTION_FAILED";

type CompactStatus = "completed" | "failed" | "interrupted" | "skipped";
type BreakerReason = "failures" | "refill";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

function latestSummary(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "compaction/summary") continue;
    const summary = (event.data as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim() !== "") return summary;
  }
  return undefined;
}

/** 会话最近一次请求解析出的模型 id（手动压缩闲时路径的模型口径：摘要会把整段表面
 * 发给它，不能落到另一家；没有历史或该模型已不可解析才回落全局默认） */
function lastRequestModel(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "request/header") continue;
    const model = (event.data as { model?: unknown }).model;
    if (typeof model === "string" && model.includes("/")) return model;
  }
  return undefined;
}

export function compactionPlugin(): ServiceDefinition<CompactionService> {
  return {
    name: "compaction",
    inject: ["session", "llm", "config", "loop", "tools"],
    async start(ctx) {
      const cx = asHeniraContext(ctx);
      const session = cx.get("session");
      const llm = cx.get("llm");

      let active: Promise<void> | undefined;
      /** 手动压缩受理中的去重闸（两次并发 request 不能各入一条队列项；D-092） */
      let admissionPending = false;
      let manualController: AbortController | undefined;
      let failures = 0;
      let refillStreak = 0;
      let stepsSinceSuccess = Number.POSITIVE_INFINITY;
      let breaker: BreakerReason | undefined;

      /** 熔断活态（SessionState.compactionBreaker 的数据源；不落账本） */
      const setBreaker = (reason: BreakerReason | undefined): void => {
        if (breaker === reason) return;
        breaker = reason;
        cx.events.emit("compaction/breaker", { reason: reason ?? null });
      };

      /** 压缩期间对外活态（SessionState.compacting；可停止活动） */
      const withActive = async <T>(
        trigger: CompactionTrigger,
        fn: () => Promise<T>,
      ): Promise<T> => {
        let release!: () => void;
        active = new Promise<void>((resolve) => {
          release = resolve;
        });
        cx.events.emit("compaction/active", { active: true, trigger });
        try {
          return await fn();
        } finally {
          cx.events.emit("compaction/active", { active: false, trigger });
          active = undefined;
          release();
        }
      };

      const noteFailure = (): void => {
        failures += 1;
        if (failures >= 3) setBreaker("failures");
      };
      /** 自动压缩取得进展（摘要或阶梯）：清失败计数与步距，但保留连续快速回填计数
       *  （F-8：成功不重置连续计数，只有「距上次成功 ≥3 步」的那次尝试才归零） */
      const noteAutoProgress = (): void => {
        failures = 0;
        stepsSinceSuccess = 0;
        setBreaker(undefined);
      };
      /** 手动压缩成功：用户主动介入——失败、步距与快速回填计数一起清零（§4.8/§4.10） */
      const noteManualSuccess = (): void => {
        failures = 0;
        refillStreak = 0;
        stepsSinceSuccess = 0;
        setBreaker(undefined);
      };

      // 停止入口（输入栏停止钮 → LoopService.interrupt 广播）：只中断在途的手动压缩。
      // 队列里的条目是用户意图，原样保留并冻结（D-092；停止 ≠ 撤销排队）
      cx.events.on("compaction/stop", () => {
        manualController?.abort();
      });

      const appendEnd = async (
        id: string,
        turn: string,
        step: number,
        state: "completed" | "failed" | "interrupted",
        extra: {
          after?: number;
          omittedTurns?: number;
          error?: { code: string; message: string };
        },
      ): Promise<void> => {
        await session.append({
          type: "compaction/end",
          data: {
            id,
            turn,
            step,
            state,
            ...(extra.after !== undefined ? { after: extra.after } : {}),
            ...(extra.omittedTurns !== undefined ? { omittedTurns: extra.omittedTurns } : {}),
            ...(extra.error !== undefined ? { error: extra.error } : {}),
          },
          ignorable: true,
        });
      };

      const appendFailure = async (
        id: string,
        turn: string,
        step: number,
        error: { code: string; message: string },
        interrupted: boolean,
      ): Promise<void> => {
        await appendEnd(id, turn, step, interrupted ? "interrupted" : "failed", { error });
        if (!interrupted) {
          // F-2：压力阶段失败不致命——主请求照发；可见警告走 error 行（非致命），
          // 回合正文不显示（痕迹由压缩行承载）
          await session.append({
            type: "error",
            data: {
              turn,
              step,
              code: COMPACTION_FAILED_CODE,
              message: `${error.code}: ${error.message}`,
              fatal: false,
            },
          });
        }
      };

      /** 一次模型摘要压缩；返回是否真的改写了表面 */
      const compact = async (
        value: PreStepValue,
        trigger: CompactionTrigger,
        instructions?: string,
        cause?: { code: string; message: string },
      ): Promise<CompactStatus> => {
        const surface = session.deriveSurface();
        const plan = selectInterval({
          events: session.events(),
          surface,
          budget: value.budget,
          currentTurn: value.turn,
        });
        if (plan === undefined) return "skipped"; // 历史不足：不计失败、不计触发（F-8）

        const id = newId("c");
        const modelId = `${value.model.provider}/${value.model.model}`;
        await session.append({
          type: "compaction/start",
          data: {
            id,
            trigger,
            turn: value.turn,
            step: value.step,
            before: Math.round(value.context.used),
            plan: {
              startSeq: plan.startSeq,
              endSeq: plan.endSeq,
              units: plan.units,
              maskedTokens: Math.round(plan.maskedTokens),
            },
            ...(cause !== undefined ? { cause } : {}),
          },
          ignorable: true,
        });

        const previous = latestSummary(session.events());
        const instruction = buildSummaryInstruction({
          ...(previous !== undefined ? { oldSummary: previous } : {}),
          ...(instructions !== undefined && instructions.trim() !== "" ? { instructions } : {}),
        });
        // I-4：摘要请求 = 主请求前缀（整段表面；系统提示在最前）。装得下就带尾部，
        // 装不下第 1 档先裁尾部（trimLimit），头部留给第 3/4 档
        const headSeqs = new Set(plan.head.map((entry) => entry.seq));
        const trimLimit = surface.filter(
          (entry) => !headSeqs.has(entry.seq) && entry.message.role !== "system",
        ).length;
        const transcript = surface.map((entry) => entry.message);
        const result = await requestSummary({
          llm,
          model: value.model,
          tools: value.tools,
          ...(value.reasoningEffort !== undefined
            ? { reasoningEffort: value.reasoningEffort }
            : {}),
          sessionId: value.sessionId,
          messages: transcript,
          instruction,
          hardLimit: value.budget.hardLimit,
          summaryOut: value.budget.summaryOut,
          trimLimit,
          maskedTokens: plan.maskedTokens,
          signal: value.signal,
        });

        if (!result.ok) {
          await appendFailure(
            id,
            value.turn,
            value.step,
            { code: result.code, message: result.message },
            result.interrupted === true,
          );
          // 中断不是失败（F-7）：不记失败计数，也不进阶梯（调用方据状态跳过 digest）
          return result.interrupted === true ? "interrupted" : "failed";
        }

        await session.append({
          type: "compaction/summary",
          data: {
            id,
            turn: value.turn,
            step: value.step,
            model: modelId,
            usage: result.usage,
            summary: result.text,
            maskedTokens: plan.maskedTokens,
          },
          ignorable: true,
        });

        const replaced = await session.append({
          type: "user/message",
          data: {
            turn: value.turn,
            step: value.step,
            content: `${SUMMARY_MARKER}\n\n${result.text}`,
            source: "compaction",
            surfaceOp: { op: "replace", startSeq: plan.startSeq, endSeq: plan.endSeq },
          },
        });
        if (replaced.type !== "user/message") {
          // I-10：写后核对——重叠裁决可能把它改写成非致命 error 而不抛错
          await appendFailure(
            id,
            value.turn,
            value.step,
            { code: "SURFACE_REPLACE_REJECTED", message: `record became ${replaced.type}` },
            false,
          );
          return "failed";
        }

        const after = Math.round(estimateSurface(session.deriveSurface(), value.tools).total);
        await appendEnd(id, value.turn, value.step, "completed", {
          after,
          ...(result.omittedTurns !== undefined ? { omittedTurns: result.omittedTurns } : {}),
        });
        try {
          await cx.events.serial("compaction/applied", {
            id,
            trigger,
            before: value.context.used,
            after,
          });
        } catch (err) {
          // 监听器异常不回灌：替换与 end 都已落账，压缩已经成立（§4.7）
          await session.append({
            type: "error",
            data: {
              turn: value.turn,
              step: value.step,
              code: "COMPACTION_LISTENER",
              message: err instanceof Error ? err.message : String(err),
              fatal: false,
            },
          });
        }
        return "completed";
      };

      /** 无模型阶梯（§4.9 第 2 步）：替换工具结果超长的整步单元。返回是否落账与是否被停止 */
      const digest = async (
        value: PreStepValue,
        trigger: "auto" | "manual" = "auto",
      ): Promise<{ applied: boolean; interrupted: boolean }> => {
        return withActive(trigger, async () => {
          if (value.signal.aborted) return { applied: false, interrupted: true };
          const result = await digestOversizedUnits({
            session,
            events: session.events(),
            surface: session.deriveSurface(),
            budget: value.budget,
            tools: value.tools,
            turn: value.turn,
            step: value.step,
            trigger,
            before: value.context.used,
            currentTurn: value.turn,
            signal: value.signal,
          });
          if (!result.applied) {
            return { applied: false, interrupted: result.interrupted === true };
          }
          try {
            await cx.events.serial("compaction/applied", {
              trigger,
              before: value.context.used,
              after: result.after,
            });
          } catch {
            // 同 compact：监听器异常不回灌
          }
          return { applied: true, interrupted: result.interrupted === true };
        });
      };

      /** 压力路径的一次自动压缩尝试（熔断/快速回填/小窗口都在这里收口） */
      const autoOnce = async (value: PreStepValue): Promise<boolean> => {
        if (breaker !== undefined) return false;
        // F-8：距上次成功不足 3 步 = 快速回填，连续第 3 次熔断。连续计数按「尝试」提交
        //（跳过/中断不提交），成功也不清零——只有「距上次成功 ≥3 步」的那次尝试才归零
        const rapid = stepsSinceSuccess < 3;
        const nextRefill = rapid ? refillStreak + 1 : 0;
        if (rapid && nextRefill >= 3) {
          setBreaker("refill");
          return false;
        }

        if (value.budget.limit < 32_000) {
          // 小窗口不做模型摘要（§4.6）；无模型阶梯落地同样算进展（清熔断与计数）
          const stepped = await digest(value);
          if (!stepped.applied) return false;
          refillStreak = nextRefill;
          noteAutoProgress();
          return true;
        }

        const status = await withActive("auto", () => compact(value, "auto"));
        if (status === "completed" || status === "failed") refillStreak = nextRefill;
        if (status === "completed") {
          noteAutoProgress();
          // 压完仍高于压力线 → 无模型阶梯（§4.9）；读数用压后的实际值，不陈回压缩前
          const after = estimateSurface(session.deriveSurface(), value.tools).total;
          if (after >= value.budget.pressure) {
            await digest({ ...value, context: { ...value.context, used: after } });
          }
          return true;
        }
        if (status === "failed") noteFailure();
        if (status === "interrupted") return false; // 用户中断：不记失败、不进阶梯、不改写表面
        const stepped = await digest(value);
        if (stepped.applied) {
          if (status === "skipped") refillStreak = nextRefill;
          noteAutoProgress();
          return true;
        }
        return false;
      };

      cx.events.onWaterfall("loop/pre-step", async (raw, next) => {
        const value = raw as PreStepValue;
        stepsSinceSuccess += 1; // F-8 的距离按步算（不按尝试次数）：每步都走这里
        if (value.signal.aborted) return next(value); // 已停止：不压缩、不改表面
        if (active !== undefined) {
          // D-092：手动压缩作为队列意图在冲刷链上执行，正常不会与回合交错；防御性保留
          // （自定义 loop / 未来的并发路径）——回合在步边界等它结束，再按新表面派生
          await active.catch(() => {});
          return next({ ...value, messages: session.deriveMessages() });
        }
        if (value.context.used < value.context.pressure) {
          return next(value);
        }
        const ok = await autoOnce(value);
        return next({ ...value, messages: ok ? session.deriveMessages() : value.messages });
      });

      cx.events.onWaterfall("loop/request-failed", async (raw, next) => {
        const value = raw as RequestFailedValue;
        if (value.error.code !== LLM_ERROR_CONTEXT_OVERFLOW || breaker !== undefined) {
          return next(value);
        }
        const pre: PreStepValue = {
          messages: value.messages,
          tools: value.tools,
          model: value.model,
          ...(value.reasoningEffort !== undefined
            ? { reasoningEffort: value.reasoningEffort }
            : {}),
          sessionId: value.sessionId,
          turn: value.turn,
          step: value.step,
          context: value.context,
          budget: value.budget,
          signal: value.signal,
        };
        let progressed = false;
        // §16：模型摘要一次 + 无模型阶梯一次——第二次溢出起不再跑模型摘要
        if (value.budget.limit >= 32_000 && value.retries === 0) {
          const status = await withActive("auto", () =>
            compact(pre, "auto", undefined, {
              code: value.error.code,
              message: value.error.message,
            }),
          );
          progressed = status === "completed";
          if (status === "failed") noteFailure();
          if (status === "interrupted") return next(value); // 停止后不重发
        }
        if (!progressed) {
          const stepped = await digest(pre);
          progressed = stepped.applied;
          if (stepped.interrupted) return next(value);
        }
        if (progressed) {
          noteAutoProgress();
          return next({ ...value, retry: true });
        }
        return next(value);
      });

      /** 手动压缩的请求面（维护回合 m-…，界面不挂回合头）：模型口径跟随会话最近一次
       *  请求，预算取声明窗口与计量器观测上限的较小值（§4.2/§4.10）。 */
      const buildManualValue = async (signal: AbortSignal): Promise<PreStepValue> => {
        const configService = cx.get("config");
        const lastModel = lastRequestModel(session.events());
        let modelConfig: ModelConfig;
        try {
          modelConfig = await configService.model(lastModel);
        } catch (err) {
          if (lastModel === undefined) throw err;
          modelConfig = await configService.model();
        }
        const tools = cx.get("tools").project();
        const surface = session.deriveSurface();
        // 计量器已学到的观测上限一并带进来：静默截断端点上，手动摘要不能按声明
        // 窗口硬发（§4.2；contextUsage().size = min(声明窗口, 观测上限)）
        const observedSize = cx.get("loop").contextUsage()?.size;
        const budget = contextBudget({
          ...(modelConfig.contextWindow !== undefined
            ? { contextWindow: modelConfig.contextWindow }
            : {}),
          ...(observedSize !== undefined ? { observedLimit: observedSize } : {}),
          ...(modelConfig.maxOutputTokens !== undefined
            ? { maxOutputTokens: modelConfig.maxOutputTokens }
            : {}),
        });
        const modelId = `${modelConfig.provider}/${modelConfig.model}`;
        const reading = measureContext({
          events: session.events(),
          surface,
          tools,
          model: modelId,
          budget,
          k: 1,
        }).reading;
        return {
          messages: surface.map((entry) => entry.message),
          tools,
          model: modelConfig,
          sessionId: session.header().id,
          turn: `m-${Date.now().toString(36)}`,
          step: 0,
          context: reading,
          budget,
          signal,
        };
      };

      /** 手动压缩被跳过（历史不足）：不留压缩行、不占队列。结果经活态告诉界面——受理响应
       *  早已返回（只有 accepted/queued/rejected），消费时才知道的结果不能走它（D-092 修订）。 */
      const noteManualOutcome = (outcome: CompactQueueOutcome): CompactQueueOutcome => {
        if (outcome === "skipped") {
          cx.events.emit("compaction/skipped", {
            id: newId("n"),
            reason: "history-insufficient",
          });
        }
        return outcome;
      };

      /** 队列里的手动压缩项执行（D-092）：由 loop 冲刷链在队头调用，与回合串行。
       *  completed/skipped → 队列继续；failed/interrupted → 剩余条目冻结。 */
      const runManualEntry = async (entry: QueuedPrompt): Promise<CompactQueueOutcome> => {
        if (active !== undefined || manualController !== undefined) {
          // 队列串行下不应发生；真发生就当失败，把后续队列冻结（宁可停，不交错）
          return "failed";
        }
        const controller = new AbortController();
        manualController = controller;
        try {
          let value: PreStepValue;
          try {
            value = await buildManualValue(controller.signal);
          } catch (err) {
            // 模型不可解析等起步失败：落一条非致命 error 上屏（旧实现用受理响应报 no-model，
            // D-092 起消费在后台，响应已经先回了）——然后按失败冻结后续队列
            await session
              .append({
                type: "error",
                data: {
                  turn: `m-${Date.now().toString(36)}`,
                  step: 0,
                  code: COMPACTION_FAILED_CODE,
                  message: err instanceof Error ? err.message : String(err),
                  fatal: false,
                },
              })
              .catch(() => {});
            return "failed";
          }
          // 小窗口（<32K）不做模型摘要（§4.6）：直接走无模型阶梯，不发必败的摘要请求
          if (value.budget.limit < 32_000) {
            const stepped = await digest(value, "manual");
            if (stepped.applied) {
              noteManualSuccess();
              return "completed";
            }
            return noteManualOutcome(stepped.interrupted ? "interrupted" : "skipped");
          }
          const status = await withActive("manual", () =>
            compact(value, "manual", entry.instructions),
          );
          if (status === "completed") noteManualSuccess();
          return noteManualOutcome(status);
        } finally {
          manualController = undefined;
        }
      };
      cx.get("loop").registerCompactWorker?.(runManualEntry);

      const service: CompactionService = {
        async request(req) {
          const raw = req?.instructions?.trim();
          const instructions = raw === undefined || raw === "" ? undefined : raw;
          if (
            instructions !== undefined &&
            [...instructions].length > COMPACTION_INSTRUCTIONS_MAX
          ) {
            return { state: "rejected", reason: "instructions-too-long" };
          }
          const loop = cx.get("loop");
          if (loop.enqueueCompact === undefined || loop.registerCompactWorker === undefined) {
            // 自定义 loop 未实现队列压缩（D-092）：能力缺失显性拒绝，不假装受理
            return { state: "rejected", reason: "compaction-unavailable" };
          }
          // 重复检查：在途压缩（含起步窗：manualController 已占位）或队列里已有 compact 项
          if (
            active !== undefined ||
            manualController !== undefined ||
            admissionPending ||
            loop.pending().some((entry) => entry.kind === "compact")
          ) {
            return { state: "rejected", reason: "compaction-in-progress" };
          }
          admissionPending = true;
          try {
            // 受理前先判「会不会马上执行」：队列空、链不在跑、也没冻结 → accepted；
            // 否则声明为 queued（条目先排着，等前面的工作收口）
            const startsNow = !loop.isBusy() && loop.pending().length === 0 && !loop.paused();
            await loop.enqueueCompact(instructions);
            return { state: startsNow ? "accepted" : "queued" };
          } finally {
            admissionPending = false;
          }
        },
      };
      return service;
    },
  };
}
