// tools 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// 五段管线与 pre-execute×判定链组合语义见 tools-approval.md §2 / §2.1。

import type { Disposable } from "@reins/kernel";
import type { ApprovalOptions, Decision, PermissionRequest } from "./approval.js";
import type { ConfigService } from "./config.js";
import type { JsonSchema, WireToolSchema } from "./llm.js";

/** 引擎侧工具调用（与 StreamEvent 同源）；日志侧对偶 = ToolCallDraft.arguments（P3-1） */
export interface ToolCall {
  callId: string;
  name: string;
  /** 恒为原始 JSON 文本；执行前由管线 parseArgs 段解析校验 */
  argsText: string;
}

export interface ToolDefinition {
  /** 全局唯一，注册时查重 */
  name: string;
  /** 给模型看 */
  description: string;
  /** 裸 JSON Schema（D-044）；装载期校验，非法 → 插件跳过 + 告警（接 D-029） */
  inputSchema: JsonSchema;
  /** 只读标记：默认放行层（D-039）与并行调度共用 */
  isConcurrencySafe?: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  /** 判定链唯一入口（tools-approval §2.1：管线先查闸、判定链管终审；floor 语义见 ApprovalOptions） */
  requestPermission(req: PermissionRequest, opts?: ApprovalOptions): Promise<Decision>;
  config: ConfigService;
}

export interface ToolResult {
  /** 模型可见文本（出口限量已应用，tools-approval §1.1） */
  content: string;
  isError?: boolean;
  /** 带外通道（P4）：检查点/引用/图片元数据，loop 分流，不进模型上下文 */
  __meta?: Record<string, unknown>;
}

export interface ToolOutcome {
  result: ToolResult;
  /** 超限落盘留路径（tools-approval §1.1：头部预览 + 完整输出路径） */
  truncated?: { path: string; preview: string };
}

export interface ToolFilter {
  include?: readonly string[];
  exclude?: readonly string[];
}

export interface ToolsService {
  register(tool: ToolDefinition): Disposable;
  /** 模型可见清单（声明式过滤） */
  project(filter?: ToolFilter): WireToolSchema[];
  /** D-039 默认放行层查询：只读标记；未注册工具返回 undefined */
  isConcurrencySafe(name: string): boolean | undefined;
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolOutcome>;
  /** 批执行（loop 每步调用入口）：连续 isConcurrencySafe 并行（上限 10），其余串行；结果按原顺序回写 */
  run(calls: readonly ToolCall[], ctx: ToolContext): Promise<ToolOutcome[]>;
}

/** `tools/pre-execute` waterfall 值：监听者经 mergeGateVerdict 合并表态（deny > ask > allow，单调） */
export interface GateVerdict {
  tool: string;
  args: unknown;
  verdict: "allow" | "deny" | "ask";
  /** 谁表的态（排查用） */
  by?: string;
  reason?: string;
}

/** 单调合并：deny > ask > allow；后注册者不得放宽先注册者的表态（tools-approval §2.1） */
export function mergeGateVerdict(
  prev: GateVerdict,
  next: Pick<GateVerdict, "verdict"> & Partial<Pick<GateVerdict, "by" | "reason">>,
): GateVerdict {
  const rank = { allow: 0, ask: 1, deny: 2 } as const;
  const verdict = rank[next.verdict] >= rank[prev.verdict] ? next.verdict : prev.verdict;
  return {
    tool: prev.tool,
    args: prev.args,
    verdict,
    by: verdict === next.verdict ? (next.by ?? prev.by) : prev.by,
    reason: verdict === next.verdict ? (next.reason ?? prev.reason) : prev.reason,
  };
}

/** `tools/post-execute` waterfall 值：监听者可检视/替换结果（附加上下文） */
export interface PostExecuteValue {
  call: ToolCall;
  outcome: ToolOutcome;
}
