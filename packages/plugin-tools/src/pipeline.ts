// 五段执行管线（tools-approval §2 顺序逐字落地）+ 批执行。
//   parseArgs → pre-execute（waterfall，GateVerdict 单调合并）→ 判定链（经 ToolContext.
//   requestPermission——§1 依赖注入；§2.1 管线先查闸、判定链管终审）→ execute（abort 竞速 +
//   可选超时）→ post-execute（waterfall）→ 出口限量 → 权威结果。
// 失败一律结构化 error 结果回模型（拒执行不抛穿——错误也是权威结果，P8 替换者清单）。

import type { EventBus } from "@reins/kernel";
import type {
  ApprovalOptions,
  Decision,
  GateVerdict,
  PostExecuteValue,
  ToolCall,
  ToolContext,
  ToolOutcome,
} from "@reins/protocol";
import { mergeGateVerdict } from "@reins/protocol";
import { applyExitLimits, DEFAULT_EXIT_LIMITS, type ExitLimits } from "./limits.js";
import type { ToolRegistry } from "./registry.js";

export interface PipelineOptions {
  limits?: Partial<ExitLimits>;
  /** 超限完整输出落盘目录（会话目录 artifacts/） */
  artifactsDir?: string;
  /** 工具执行超时（ms）；缺省不设超时（abort 是唯一取消出口） */
  timeoutMs?: number;
}

export interface PipelineDeps extends PipelineOptions {
  registry: ToolRegistry;
  events: EventBus;
}

function errorOutcome(content: string): ToolOutcome {
  return { result: { content, isError: true } };
}

/** 段1 parseArgs：JSON 解析 + schema 校验，失败 → 结构化错误回模型重发 */
function parseArgs(
  call: ToolCall,
  validate: (args: unknown) => boolean,
): { args?: Record<string, unknown>; error?: ToolOutcome } {
  let args: unknown;
  try {
    args = call.argsText.trim() === "" ? {} : JSON.parse(call.argsText);
  } catch (err) {
    return {
      error: errorOutcome(
        `[input] arguments are not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
  const ok = validate(args);
  if (!ok) return { error: errorOutcome("[input] arguments failed inputSchema validation") };
  return { args: args as Record<string, unknown> };
}

/** 段2 pre-execute + 段3 判定链；未获准 → 错误结果（deny = 链前拒，无审计对） */
async function gateAndPermission(
  call: ToolCall,
  args: unknown,
  ctx: ToolContext,
  deps: PipelineDeps,
): Promise<ToolOutcome | undefined> {
  const initial: GateVerdict = { tool: call.name, args, verdict: "allow" };
  const merged = await deps.events.waterfall<GateVerdict>("tools/pre-execute", initial);
  if (merged.verdict === "deny") {
    // 链前拒：不进判定链、无审批审计对；tool/call + tool/result 由 loop 照记
    return errorOutcome(`[denied] ${merged.by ?? "gate"}: ${merged.reason ?? "pre-execute deny"}`);
  }
  const opts: ApprovalOptions = {
    signal: ctx.signal,
    floor: merged.verdict === "ask" ? "ask" : undefined,
  };
  let decision: Decision;
  try {
    decision = await ctx.requestPermission({ tool: call.name, args, reason: merged.reason }, opts);
  } catch (err) {
    // fail-closed（P5）：判定链缺席 / 抛错一律 unavailable——缺失即放行不存在
    return errorOutcome(
      `[unavailable] approval chain failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (decision !== "allowed-once") {
    return errorOutcome(`[permission:${decision}] tool "${call.name}" was not permitted`);
  }
  return undefined;
}

/** 段4 execute：未启动即中止 → ABORTED_BEFORE_DISPATCH；已启动等工具自行结束并保留自报错误 */
async function executeTool(
  ctx: ToolContext,
  deps: PipelineDeps,
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome["result"]>,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (ctx.signal.aborted)
    return errorOutcome("[aborted-before-dispatch] tool was aborted before it started");
  const running = execute(args, ctx);
  const timeoutMs = deps.timeoutMs;
  try {
    const result =
      timeoutMs === undefined
        ? await running
        : await Promise.race([
            running,
            new Promise<never>((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error(`timeout after ${timeoutMs}ms`)),
                timeoutMs,
              );
              timer.unref?.();
            }),
          ]);
    return { result };
  } catch (err) {
    // 自报错误保留原样（工具自己的错误信息是给模型看的事实）；超时 / 抛错同为 isError 结果
    const message = err instanceof Error ? err.message : String(err);
    return errorOutcome(`[error] ${message}`);
  }
}

/** 单调用五段管线（权威结果 = 出口限量已应用） */
export async function runOne(
  call: ToolCall,
  ctx: ToolContext,
  deps: PipelineDeps,
): Promise<ToolOutcome> {
  const tool = deps.registry.resolve(call.name);
  if (!tool) return errorOutcome(`[input] unknown tool "${call.name}"`);

  const parsed = parseArgs(call, tool.validate);
  if (parsed.error) return parsed.error;

  const denied = await gateAndPermission(call, parsed.args, ctx, deps);
  if (denied) return denied;

  let outcome = await executeTool(
    ctx,
    deps,
    tool.def.execute,
    parsed.args as Record<string, unknown>,
  );

  const post = await deps.events.waterfall<PostExecuteValue>("tools/post-execute", {
    call,
    outcome,
  });
  outcome = post.outcome;

  const limits: ExitLimits = { ...DEFAULT_EXIT_LIMITS, ...deps.limits };
  const limited = await applyExitLimits(outcome.result.content, limits, {
    spillDir: deps.artifactsDir,
    spillName: `${call.callId}.txt`,
  });
  return {
    result: { ...outcome.result, content: limited.content },
    truncated: limited.truncated ?? outcome.truncated,
  };
}

/** 批执行：连续 isConcurrencySafe 并行（上限 10），其余串行；结果按原顺序回写（tools-approval §2） */
export async function runBatch(
  calls: readonly ToolCall[],
  ctx: ToolContext,
  deps: PipelineDeps,
  concurrency = 10,
): Promise<ToolOutcome[]> {
  const outcomes: ToolOutcome[] = new Array<ToolOutcome>(calls.length);
  let i = 0;
  while (i < calls.length) {
    const safe = deps.registry.resolve(calls[i].name)?.def.isConcurrencySafe === true;
    if (!safe) {
      outcomes[i] = await runOne(calls[i], ctx, deps);
      i += 1;
      continue;
    }
    const batch: number[] = [];
    while (
      batch.length < concurrency &&
      i + batch.length < calls.length &&
      deps.registry.resolve(calls[i + batch.length].name)?.def.isConcurrencySafe === true
    ) {
      batch.push(i + batch.length);
    }
    const results = await Promise.all(batch.map((k) => runOne(calls[k], ctx, deps)));
    batch.forEach((k, idx) => {
      outcomes[k] = results[idx];
    });
    i += batch.length;
  }
  return outcomes;
}
