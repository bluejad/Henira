// plugin-approval 服务件（packages.md：权限判定链、审计事件、凭据硬拒清单、fail-closed）。
// 审计对写经 session 槽（turn/step 由 loop 在总线上广播：turn/start + step/start——approval
// 监听跟踪；没有打开回合 → fail-closed unavailable，与 store 的 NoOpenTurnError 双保险）。
// 挂起与收答经 interaction 槽（宿主实现，P5：断线重放同卡）；规则经 config 槽读（D-013②）。
// fail-closed 矩阵 [dsh] 同构：缺席 / 抛错 / 不合规 → unavailable，必须拒。

import { randomUUID } from "node:crypto";
import type { ServiceDefinition } from "@henira/kernel";
import {
  type ApprovalOptions,
  type ApprovalService,
  asHeniraContext,
  DECISIONS,
  type Decision,
  type GateVerdict,
  type PermissionRequest,
} from "@henira/protocol";
import { argsDigest, isCredentialAccess, isDisasterCommand, matchesRule } from "./chain.js";
import { sessionAllowedTools } from "./session-allow.js";

export function approvalPlugin(): ServiceDefinition<ApprovalService> {
  return {
    name: "approval",
    inject: ["session", "tools", "interaction", "config"],
    start(ctx) {
      const cx = asHeniraContext(ctx);
      let current: { turn: string; step: number } | undefined;
      ctx.events.on("turn/start", (payload: unknown) => {
        current = { turn: (payload as { turn: string }).turn, step: 0 };
      });
      ctx.events.on("step/start", (payload: unknown) => {
        const p = payload as { turn: string; step: number };
        current = { turn: p.turn, step: p.step };
      });

      const service: ApprovalService = {
        async requestPermission(req: PermissionRequest, opts?: ApprovalOptions): Promise<Decision> {
          const signal = opts?.signal;
          // abort 先于一切（P6 纪律 1 的审批侧对偶：先查 aborted 再谈链）
          if (signal?.aborted) return "cancelled";
          if (current === undefined) return "unavailable"; // 没有打开的回合不接受审批记录（session.md §1.1）
          const { turn, step } = current;
          const session = cx.get("session");
          const tools = cx.get("tools");
          const requestId = randomUUID();
          const asked = async (): Promise<void> => {
            await session.append({
              type: "approval/asked",
              data: {
                turn,
                step,
                requestId,
                callId: requestId,
                tool: req.tool,
                argsDigest: argsDigest(req.args),
              },
            });
          };
          const decided = async (decision: Decision, scope?: string): Promise<void> => {
            await session.append({
              type: "approval/decided",
              data: { turn, step, requestId, decision, ...(scope ? { scope } : {}) },
            });
          };

          // ── 链外硬拒（无审计：清单前拒，D-039；任何规则都放不了行）──────────
          if (isCredentialAccess(req)) return "rejected";
          if (isDisasterCommand(req)) return "rejected";

          // ── 规则层（经 config 读 permissions.json；deny 压倒一切——先扫全表 deny 再扫 allow）──
          const rules = await cx.get("config").permissionRules();
          const matching = rules.filter((rule) => matchesRule(req, rule));
          if (matching.some((rule) => rule.decision === "deny")) return "rejected";
          if (matching.some((rule) => rule.decision === "allow")) {
            await decided("allowed-once");
            return "allowed-once";
          }

          // ── 会话内允许集（日志折叠，§3.1——已有原始 decided 在案，不重复审计）──
          if (sessionAllowedTools(session.events()).has(req.tool)) return "allowed-once";

          // ── 默认放行层（D-039：只读标记自动放行 + 落 decided 审计；floor=ask 抬高下限）──
          if (tools.isConcurrencySafe(req.tool) === true && opts?.floor !== "ask") {
            await decided("allowed-once");
            return "allowed-once";
          }

          // ── approval/request 缝（waterfall；D-027：规则链全未命中、answerer 之前）──
          const initial: GateVerdict = { tool: req.tool, args: req.args, verdict: "ask" };
          const seam = await ctx.events.waterfall<GateVerdict>("approval/request", initial);
          if (seam.verdict === "deny") {
            await decided("rejected");
            return "rejected";
          }
          if (seam.verdict === "allow") {
            await decided("allowed-once");
            return "allowed-once";
          }

          // ── answerer（InteractionService）────────────────────────
          await asked();
          let answer: Decision;
          try {
            const interaction = cx.get("interaction");
            const result = await interaction.ask(
              {
                kind: "approval",
                requestId,
                toolName: req.tool,
                args: req.args,
                reason: req.reason,
              },
              signal,
            );
            const valid =
              result.kind === "approval" &&
              result.requestId === requestId &&
              (DECISIONS as readonly string[]).includes(result.decision);
            answer = valid ? result.decision : "unavailable";
          } catch {
            // 缺席 / 抛错 → unavailable；abort 竞速 → cancelled（先答者赢的迟到异常不算）
            answer = signal?.aborted ? "cancelled" : "unavailable";
          }
          await decided(answer);
          return answer;
        },
      };
      return service;
    },
  };
}
