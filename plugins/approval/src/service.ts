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
  type PermissionMode,
  type PermissionRequest,
} from "@henira/protocol";
import { argsDigest, isCredentialAccess, isDisasterCommand, matchesRule } from "./chain.js";
import { sessionAllowedTools } from "./session-allow.js";

/** args 全文的尺寸闸（审查 F4，对照 __meta 256KB 同款）：超限/不可序列化 = 丢 args 只留
 * digest（UI 有 digest-only 回落形状；args 全文仍在 tool/call.arguments 可查） */
const ARGS_MAX_BYTES = 256 * 1024;

function withinArgsCap(args: unknown): boolean {
  try {
    return JSON.stringify(args ?? null).length <= ARGS_MAX_BYTES;
  } catch {
    return false;
  }
}

export function approvalPlugin(): ServiceDefinition<ApprovalService> {
  return {
    name: "approval",
    inject: ["session", "tools", "interaction", "config"],
    start(ctx) {
      const cx = asHeniraContext(ctx);
      // 已开回合 + 其权限模式（D-080：mode 随 turn/start 广播，回合内恒定制；缺省 = ask）
      let current: { turn: string; step: number; permissionMode?: PermissionMode } | undefined;
      ctx.events.on("turn/start", (payload: unknown) => {
        const p = payload as { turn: string; permissionMode?: PermissionMode };
        current = {
          turn: p.turn,
          step: 0,
          ...(p.permissionMode !== undefined ? { permissionMode: p.permissionMode } : {}),
        };
      });
      ctx.events.on("step/start", (payload: unknown) => {
        const p = payload as { turn: string; step: number };
        current = {
          turn: p.turn,
          step: p.step,
          // 模式只跟本回合——换回合却没见 turn/start = 丢权威，按 ask 兜底（fail-closed）
          ...(current?.turn === p.turn && current.permissionMode !== undefined
            ? { permissionMode: current.permissionMode }
            : {}),
        };
      });

      const service: ApprovalService = {
        async requestPermission(req: PermissionRequest, opts?: ApprovalOptions): Promise<Decision> {
          const signal = opts?.signal;
          // abort 先于一切（P6 纪律 1 的审批侧对偶：先查 aborted 再谈链）
          if (signal?.aborted) return "cancelled";
          if (current === undefined) return "unavailable"; // 没有打开的回合不接受审批记录（session.md §1.1）
          const { turn, step } = current;
          const permissionMode = current.permissionMode; // 回合内恒定（turn/start 定档）
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
                // args 完整原样（E6，D-046「审计事件对照记全文」落码归位）：挂起卡自足可渲染
                // （断线重连/多窗口重放），per-tool 预览体唯一数据源；digest 保留作关联指纹；
                // 尺寸闸超限丢 args 留 digest（卡回落 digest-only，args 全文在 tool/call 可查）
                ...(req.args !== undefined && withinArgsCap(req.args) ? { args: req.args } : {}),
                ...(req.reason !== undefined ? { reason: req.reason } : {}),
              },
            });
          };
          const decided = async (
            decision: Decision,
            scope?: string,
            mode?: "full",
          ): Promise<void> => {
            await session.append({
              type: "approval/decided",
              data: {
                turn,
                step,
                requestId,
                decision,
                ...(scope ? { scope } : {}),
                ...(mode !== undefined ? { mode } : {}),
              },
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

          // ── 完全访问模式（D-080）：水瀑之后自动放行，只跳过 answerer。硬拒清单 / deny 规则 /
          //    hook deny 均在本层之前裁决——full 不是「关掉审批」，settled 行带 mode:"full"
          //    审计标记（事后可辨「非用户逐次放行」）
          if (permissionMode === "full") {
            await decided("allowed-once", undefined, "full");
            return "allowed-once";
          }

          // ── answerer（InteractionService）────────────────────────
          await asked();
          let answer: Decision;
          let answerScope: "session" | undefined;
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
              (DECISIONS as readonly string[]).includes(result.decision) &&
              (result.scope === undefined || result.scope === "session"); // 不合规 scope = 形状不合规
            if (valid) {
              answer = result.decision;
              answerScope = result.scope;
            } else {
              answer = "unavailable";
            }
          } catch {
            // 缺席 / 抛错 → unavailable；abort 竞速 → cancelled（先答者赢的迟到异常不算）
            answer = signal?.aborted ? "cancelled" : "unavailable";
          }
          // scope 仅在真放行时落账（审查 F5）：rejected/cancelled 带 scope 是语义噪音
          // ——settled 行不该出现「rejected · 本会话」
          await decided(answer, answer === "allowed-once" ? answerScope : undefined);
          return answer;
        },
      };
      return service;
    },
  };
}
