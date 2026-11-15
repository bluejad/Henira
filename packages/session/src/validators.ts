// 官方 15 个基础事件的 zod 校验器（session.md §2.2 事件表逐字落地）。
// zod 是本包的实现细节，不进协议词汇（D-051）；注册进 protocol 的开放注册表，
// 插件经 registerPluginEvent 追加自有事件（前缀 = 包名，session.md §2.3）。

import { SessionEventRegistry } from "@reins/protocol";
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
  "turn/start": z.object({ turn: z.string().min(1) }),
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
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
  "approval/asked": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    callId: z.string().min(1),
    tool: z.string().min(1),
    argsDigest: z.string(),
  }),
  "approval/decided": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    decision: z.enum(["allowed-once", "rejected", "cancelled", "unavailable"]),
    scope: z.string().optional(),
  }),
  "approval/revoked": z.object({
    turn: z.string().min(1),
    step: z.number().int().nonnegative(),
    scope: z.string().min(1),
    tool: z.string().optional(),
  }),
  error: z.looseObject({
    turn: z.string().min(1).optional(),
    step: z.number().int().nonnegative().optional(),
    code: z.string().min(1),
    message: z.string().min(1),
    fatal: z.boolean().optional(),
  }),
};

/** 官方基础变体进注册表：核心包直接写 map（保留域，D-051 备注） */
for (const [type, schema] of Object.entries(schemas)) {
  SessionEventRegistry.set(type, schema);
}
