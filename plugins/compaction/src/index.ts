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
  contextBudget,
  estimateSurface,
  LLM_ERROR_CONTEXT_OVERFLOW,
  measureContext,
  type PreStepValue,
  type RequestFailedValue,
  type SessionEvent,
} from "@henira/protocol";
import { digestOversizedUnits } from "./digest.js";
import { buildSummaryInstruction, SUMMARY_MARKER } from "./prompt.js";
import { selectInterval } from "./selection.js";
import { requestSummary } from "./summarizer.js";

/** 压力/溢出阶段失败的可见错误码（F-2 / F-1：非致命时痕迹由压缩行承载） */
export const COMPACTION_FAILED_CODE = "COMPACTION_FAILED";

type CompactStatus = "completed" | "failed" | "skipped";
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

export function compactionPlugin(): ServiceDefinition<CompactionService> {
  return {
    name: "compaction",
    inject: ["session", "llm", "config", "loop", "tools"],
    async start(ctx) {
      const cx = asHeniraContext(ctx);
      const session = cx.get("session");
      const llm = cx.get("llm");

      let active: Promise<void> | undefined;
      /** 忙时手动请求排到下一个步边界（I-8：同一会话一次只有一个压缩） */
      let queued: { instructions?: string } | undefined;
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
      const noteSuccess = (): void => {
        failures = 0;
        refillStreak = 0;
        stepsSinceSuccess = 0;
        setBreaker(undefined);
      };

      // 停止入口（输入栏停止钮 → LoopService.interrupt 广播）：中断在途的手动压缩
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
        const plan = selectInterval({ events: session.events(), surface, budget: value.budget });
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
          return "failed";
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

      /** 无模型阶梯（§4.9 第 2 步）：替换工具结果超长的整步单元 */
      const digest = async (value: PreStepValue): Promise<boolean> => {
        return withActive("auto", async () => {
          const result = await digestOversizedUnits({
            session,
            events: session.events(),
            surface: session.deriveSurface(),
            budget: value.budget,
            tools: value.tools,
            turn: value.turn,
            step: value.step,
            trigger: "auto",
            before: value.context.used,
          });
          if (!result.applied) return false;
          try {
            await cx.events.serial("compaction/applied", {
              trigger: "auto",
              before: value.context.used,
              after: result.after,
            });
          } catch {
            // 同 compact：监听器异常不回灌
          }
          return true;
        });
      };

      /** 压力路径的一次自动压缩尝试（熔断/快速回填/小窗口都在这里收口） */
      const autoOnce = async (value: PreStepValue): Promise<boolean> => {
        if (breaker !== undefined) return false;
        stepsSinceSuccess += 1;
        if (value.budget.limit < 32_000) return digest(value); // 小窗口不做模型摘要（§4.6）

        if (stepsSinceSuccess < 3) {
          refillStreak += 1;
          if (refillStreak >= 3) {
            setBreaker("refill"); // F-8：连续第 3 次快速回填
            return false;
          }
        } else {
          refillStreak = 0;
        }

        const status = await withActive("auto", () => compact(value, "auto"));
        if (status === "completed") {
          noteSuccess();
          // 压完仍高于压力线 → 无模型阶梯（§4.9）
          const after = estimateSurface(session.deriveSurface(), value.tools).total;
          if (after >= value.budget.pressure) await digest(value);
          return true;
        }
        if (status === "failed") noteFailure();
        if (await digest(value)) {
          noteSuccess();
          return true;
        }
        return false;
      };

      cx.events.onWaterfall("loop/pre-step", async (raw, next) => {
        const value = raw as PreStepValue;
        if (active !== undefined) {
          // I-8：手动压缩在途 → 回合在步边界等它结束，再按新表面派生
          await active.catch(() => {});
          return next({ ...value, messages: session.deriveMessages() });
        }
        if (queued !== undefined) {
          // 忙时排队的压缩：到步边界执行（触发因记 manual）
          const pending = queued;
          queued = undefined;
          await withActive("manual", () => compact(value, "manual", pending.instructions));
          return next({ ...value, messages: session.deriveMessages() });
        }
        if (value.signal.aborted || value.context.used < value.context.pressure) {
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
        if (value.budget.limit >= 32_000) {
          const status = await withActive("auto", () =>
            compact(pre, "auto", undefined, {
              code: value.error.code,
              message: value.error.message,
            }),
          );
          progressed = status === "completed";
          if (status === "failed") noteFailure();
        }
        if (!progressed) progressed = await digest(pre);
        if (progressed) {
          noteSuccess();
          return next({ ...value, retry: true });
        }
        return next(value);
      });

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
          if (active !== undefined || queued !== undefined) {
            return { state: "rejected", reason: "compaction-in-progress" };
          }
          if (cx.get("loop").isBusy()) {
            // 忙时投递唯一 = 排队（D-045 同规）；到下一个步边界执行
            queued = { ...(instructions !== undefined ? { instructions } : {}) };
            return { state: "queued" };
          }

          // 闲时立即执行：维护回合（m-…），界面不挂回合头
          const controller = new AbortController();
          manualController = controller;
          let value: PreStepValue;
          try {
            const modelConfig = await cx.get("config").model();
            const tools = cx.get("tools").project();
            const surface = session.deriveSurface();
            const budget = contextBudget({
              ...(modelConfig.contextWindow !== undefined
                ? { contextWindow: modelConfig.contextWindow }
                : {}),
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
            value = {
              messages: surface.map((entry) => entry.message),
              tools,
              model: modelConfig,
              sessionId: session.header().id,
              turn: `m-${Date.now().toString(36)}`,
              step: 0,
              context: reading,
              budget,
              signal: controller.signal,
            };
          } catch {
            manualController = undefined;
            return { state: "rejected", reason: "no-model" };
          }

          try {
            const status = await withActive("manual", () => compact(value, "manual", instructions));
            if (status === "completed") {
              noteSuccess();
              return { state: "accepted" };
            }
            if (status === "skipped") {
              return { state: "skipped", reason: "history-insufficient" };
            }
            if (controller.signal.aborted) {
              return { state: "rejected", reason: "interrupted" };
            }
            return { state: "rejected", reason: "compaction-failed" };
          } finally {
            manualController = undefined;
          }
        },
      };
      return service;
    },
  };
}
