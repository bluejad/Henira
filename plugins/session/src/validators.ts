// 官方 15 个基础事件的 zod 校验器（session.md §2.2 事件表逐字落地）。
// zod 是本包的实现细节，不进协议词汇（D-051）；注册进 protocol 的开放注册表，
// 插件经 registerPluginEvent 追加自有事件（前缀 = 包名，session.md §2.3）。

import {
  APPROVAL_FEEDBACK_MAX,
  fitsApprovalFeedback,
  PERMISSION_MODES,
  QUESTION_CUSTOM_MAX,
  SessionEventRegistry,
} from "@henira/protocol";
import { z } from "zod";

const surfaceOpSchema = z.union([
  z.literal("append"),
  z.object({
    op: z.literal("replace"),
    startSeq: z.number().int().positive(),
    endSeq: z.number().int().positive(),
  }),
]);

const usageSchema = z.looseObject({ inputTokens: z.number(), outputTokens: z.number() });

const attachmentSchema = z.object({
  path: z.string().min(1),
  mime: z.string().optional(),
  name: z.string().optional(),
});

/** 账本里的允许规则（R198）：只记精确允许（deny 规则住配置文件，不进决策行）。
 *  形状与 protocol PermissionRule 一致，decision 收窄为 allow。 */
const permissionRuleSchema = z.object({
  match: z.object({
    tool: z.string().min(1),
    commandExact: z.string().min(1).optional(),
    commandPrefix: z.string().min(1).optional(),
    commandContains: z.string().min(1).optional(),
    pathExact: z.string().min(1).optional(),
  }),
  decision: z.literal("allow"),
});

const turnReasonSchema = z.enum([
  "completed",
  "aborted",
  "blocked",
  "error",
  "max-tokens",
  "interrupted",
  "forked",
]);

const schemas: Record<string, z.ZodType> = {
  // 权限模式随回合开场落账（D-080：按每次提问绑定；缺省 = ask，旧账本无此字段同义）
  "turn/start": z.object({
    turn: z.string().min(1),
    permissionMode: z.enum(PERMISSION_MODES).optional(),
  }),
  "turn/end": z
    .object({
      turn: z.string().min(1),
      reason: turnReasonSchema,
      usage: usageSchema.optional(),
      error: z.looseObject({ code: z.string(), message: z.string() }).optional(),
      cause: z.enum(["user", "parent", "hook", "disposed"]).optional(),
    })
    .check((ctx) => {
      if (ctx.value.reason === "aborted" && !ctx.value.cause) {
        ctx.issues.push({ code: "custom", message: "aborted requires cause", input: ctx.value });
      }
    }),
  "step/start": z.object({ turn: z.string().min(1), step: z.number().int().positive() }),
  "step/end": z.object({
    turn: z.string().min(1),
    step: z.number().int().positive(),
    usage: usageSchema,
    interrupted: z.boolean().optional(),
  }),
  "request/header": z.looseObject({
    turn: z.string().min(1),
    step: z.number().int().positive(),
    model: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    toolNames: z.array(z.string()),
    systemPromptHash: z.string(),
  }),
  "user/message": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    content: z.string(),
    attachments: z.array(attachmentSchema).max(100).optional(),
    source: z.string().min(1),
    surfaceOp: surfaceOpSchema.optional(),
    // D-086：队列冲刷产生的回合带排队条目 id（客户端把排队回执对回回合；直接发送/插话不带）
    queueId: z.string().min(1).optional(),
  }),
  "system/message": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    content: z.string(),
    key: z.string().min(1).optional(),
    surfaceOp: surfaceOpSchema.optional(),
  }),
  "assistant/message": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    content: z.string(),
    reasoning: z.string().optional(),
    model: z.string().min(1),
    finishReason: z.string().min(1),
    surfaceOp: surfaceOpSchema.optional(),
  }),
  "assistant/attempt": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    content: z.string().optional(),
    error: z.looseObject({ code: z.string(), message: z.string() }),
  }),
  "tool/call": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    callId: z.string().min(1),
    name: z.string().min(1),
    /** 恒为模型原始 JSON 文本（P3-1 对偶）；执行前由引擎解析校验 */
    arguments: z.string(),
    origin: z.looseObject({ kind: z.literal("subagent"), id: z.string() }).optional(),
  }),
  "tool/result": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    callId: z.string().min(1),
    isError: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
    durationMs: z.number().nonnegative(),
    /** 输出超限截断（tools 管线结算原样透传；preview 头部 + path 落盘文件） */
    truncated: z.object({ path: z.string().min(1), preview: z.string().min(1) }).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
  "approval/asked": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    callId: z.string().min(1),
    tool: z.string().min(1),
    argsDigest: z.string(),
    /** 审批载荷 args 完整原样（E6，D-046「审计事件对照记全文」落码归位——挂起卡自足可渲染；
     * 凭据经架构保证不进 args，approval/* 不进 derive） */
    args: z.unknown().optional(),
    /** 引擎判定链解释原样（围栏区外访问等；仅呈现不转述） */
    reason: z.string().optional(),
  }),
  "approval/decided": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    decision: z.enum(["allowed-once", "rejected", "cancelled", "unavailable"]),
    scope: z.string().optional(),
    /** 审计标记（D-080）：mode:"full" = 由完全访问模式自动放行（非用户逐次点允许） */
    mode: z.literal("full").optional(),
    /** 允许时落下的精确规则（R198/D-087）：scope:"session" 由折叠消费；scope:"project" 已写
     *  permissions.json，本字段只作审计对照 */
    rule: permissionRuleSchema.optional(),
    /** 用户拒绝说明（D-087）：只在 rejected 且用户填写时在场；码点计长，与 UI/REST/引擎同源 */
    feedback: z
      .string()
      .refine(fitsApprovalFeedback, {
        message: `feedback must be at most ${APPROVAL_FEEDBACK_MAX} characters`,
      })
      .optional(),
  }),
  "approval/revoked": z.object({
    // 撤销是设置动作不是审批记录（R198）：可发生在回合之外，turn/step 因此可缺省
    turn: z.string().min(1).optional(),
    step: z.number().int().nonnegative().optional(),
    scope: z.string().min(1),
    /** 缺 tool/rule = 清空该 scope 全部允许 */
    tool: z.string().optional(),
    rule: permissionRuleSchema.optional(),
  }),
  // 修理专用（R175 重启收口）：只由 session 开档/启动扫描补写产生，loop 与客户端都不发
  // （turn/end reason "interrupted"/"forked" 的修理词汇同模式）。事件自带 ignorable——
  // 旧读者 fail-closed 闸透明跳过，回滚兼容。
  "approval/invalidated": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    requestId: z.string().min(1),
  }),
  // 提问（R184）：请求与收口配对。callId 记 requestId 关联（同一约定）；settled 三态：
  // answered（answers 在场）/ cancelled / invalidated（修理专用）。
  "question/asked": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    callId: z.string().min(1),
    questions: z
      .array(
        z.object({
          id: z.string().min(1),
          question: z.string().min(1),
          // 按码点计长（与工具运行时 / JSON Schema maxLength 同口径；zod .max 数 UTF-16
          // 单元，emoji header 会过模型闸栽在账本闸——R185 审查）
          header: z
            .string()
            .min(1)
            .refine((value) => [...value].length <= 12, "header must be at most 12 characters")
            .optional(),
          options: z
            .array(
              z.object({
                label: z.string().min(1),
                description: z.string().optional(),
              }),
            )
            .min(2)
            .max(4)
            .optional(),
          multiSelect: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
  "question/settled": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    outcome: z.enum(["answered", "cancelled", "invalidated"]),
    answers: z
      .array(
        z.object({
          id: z.string().min(1),
          selected: z.array(z.string()),
          // 码点计长（与工具归一/REST/UI 同上限；zod .max 数 UTF-16 单元）
          custom: z
            .string()
            .refine((value) => [...value].length <= QUESTION_CUSTOM_MAX, {
              message: `custom answer must be at most ${QUESTION_CUSTOM_MAX} characters`,
            })
            .optional(),
        }),
      )
      .optional(),
  }),
  error: z.looseObject({
    turn: z.string().min(1).optional(),
    step: z.number().int().nonnegative().optional(),
    code: z.string().min(1),
    message: z.string().min(1),
    fatal: z.boolean().optional(),
    status: z.number().int().optional(),
    limit: z.number().int().positive().optional(),
    actual: z.number().int().positive().optional(),
  }),
  // 压缩三事件（compaction.md §4.7）：session 包注册为基础事件（I-11——停用压缩插件后
  // 带压缩事件的账本照常打开）。只承载观测值与界面状态，审计事实（失败）另落 error；
  // 写入方一律带 ignorable: true（旧读者 fail-closed 闸的豁免通道）。
  "compaction/start": z.object({
    id: z.string().min(1),
    trigger: z.enum(["auto", "manual"]),
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    before: z.number().nonnegative(),
    plan: z.looseObject({
      startSeq: z.number().int().positive(),
      endSeq: z.number().int().positive(),
      units: z.number().int().nonnegative(),
    }),
    omittedTurns: z.number().int().nonnegative().optional(),
    digestUnits: z.number().int().nonnegative().optional(),
    cause: z.looseObject({ code: z.string(), message: z.string() }).optional(),
  }),
  "compaction/summary": z.object({
    id: z.string().min(1),
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    model: z.string().min(1),
    usage: usageSchema,
    summary: z.string(),
    maskedTokens: z.number().nonnegative(),
  }),
  "compaction/end": z.object({
    id: z.string().min(1),
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    state: z.enum(["completed", "failed", "interrupted"]),
    after: z.number().nonnegative().optional(),
    omittedTurns: z.number().int().nonnegative().optional(),
    error: z.looseObject({ code: z.string(), message: z.string() }).optional(),
  }),
};

/** 官方基础变体进注册表：核心包直接写 map（保留域，D-051 备注） */
for (const [type, schema] of Object.entries(schemas)) {
  SessionEventRegistry.set(type, schema);
}
