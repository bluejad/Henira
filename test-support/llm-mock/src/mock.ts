// @henira/llm-mock —— llm 槽位的脚本化 mock（50-open 归档 2026-11-16）。
// 直接实现 protocol 的 LlmService 契约（槽位级，不碰 HTTP）：脚本按调用次序消费，
// 尾部函数条目兼作兜底应答器；请求全量捕获供断言；'hang' / Error 条目演练失败路径。
// 序列自校验把 P3 三不变量变成 mock 侧错误——脚本写错在构造期就报，不进测试。

import type {
  FinishReason,
  LlmRequest,
  LlmService,
  StreamEvent,
  TokenUsage,
} from "@henira/protocol";
import { LlmError } from "@henira/protocol";

/** 单次模型调用的应答：事件序列 / 异步流，或按请求动态生成（兜底应答器也用函数形态；
 * 函数收 (req, signal)——流形态条目靠 signal 自己实现 hang / 中途失败，如 dsh hangAfter） */
export type MockTurn =
  | readonly StreamEvent[]
  | AsyncIterable<StreamEvent>
  | ((
      req: LlmRequest,
      signal: AbortSignal,
    ) =>
      | readonly StreamEvent[]
      | AsyncIterable<StreamEvent>
      | Promise<readonly StreamEvent[] | AsyncIterable<StreamEvent>>);

/** 脚本条目：应答 | 'hang'（挂起直至 abort）| Error（流以此拒绝） */
export type MockEntry = MockTurn | "hang" | Error;

export interface MockLlm {
  service: LlmService;
  /** 捕获的全部模型请求（断言用） */
  readonly requests: readonly LlmRequest[];
}

// ── 造事件辅助（原子级；组合即数组）──────────────────────────────

export const mockText = (text: string): StreamEvent => ({ type: "text-delta", text });
export const mockReasoning = (text: string): StreamEvent => ({ type: "reasoning-delta", text });
export const mockToolCall = (callId: string, name: string, argsText: string): StreamEvent => ({
  type: "tool-call",
  callId,
  name,
  argsText,
});
export const mockUsage = (usage: TokenUsage): StreamEvent => ({ type: "usage", usage });
export const mockFinish = (reason: FinishReason = "stop"): StreamEvent => ({
  type: "finish",
  reason,
});

// ── 序列自校验（P3 三不变量的 mock 侧执行）────────────────────────

function validateSequence(events: readonly StreamEvent[], where: string): void {
  const finishCount = events.filter((e) => e.type === "finish").length;
  if (finishCount > 1) throw new Error(`${where}: finish 至多一条`);
  const finishIndex = events.findIndex((e) => e.type === "finish");
  if (finishIndex >= 0 && finishIndex !== events.length - 1) {
    throw new Error(`${where}: finish 之后不得还有事件（不变量②③）`);
  }
  const usageCount = events.filter((e) => e.type === "usage").length;
  if (usageCount > 1) throw new Error(`${where}: usage 至多一条`);
  if (usageCount === 1 && finishIndex >= 0) {
    const usageIndex = events.findIndex((e) => e.type === "usage");
    if (usageIndex > finishIndex) throw new Error(`${where}: usage 必须先于 finish（不变量②）`);
  }
  const structural = events.findIndex((e) => e.type === "usage" || e.type === "finish");
  if (structural >= 0 && events.some((e, i) => i > structural && e.type === "tool-call")) {
    throw new Error(`${where}: tool-call 必须集中在 usage / finish 之前（不变量③）`);
  }
}

// ── 脚本引擎 ─────────────────────────────────────────────────────

export function mockLlm(script: readonly MockEntry[]): MockLlm {
  script.forEach((entry, i) => {
    if (Array.isArray(entry)) validateSequence(entry, `脚本条目 ${i}`);
  });

  const requests: LlmRequest[] = [];
  let cursor = 0;
  const last = script[script.length - 1];
  const fallback: MockTurn | undefined = typeof last === "function" ? last : undefined;

  function takeEntry(): MockEntry {
    if (cursor < script.length) {
      const entry = script[cursor];
      cursor += 1;
      return entry;
    }
    if (fallback) return fallback;
    throw new Error("mock 脚本耗尽且无兜底函数条目——脚本长度不足（测试脚本 bug，非引擎错误）");
  }

  const service: LlmService = {
    stream(req, signal) {
      requests.push(req);
      return consume(takeEntry(), req, signal);
    },
  };
  return { service, requests };
}

async function* consume(
  entry: MockEntry,
  req: LlmRequest,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  if (entry === "hang") {
    // 挂起只会以 abort 拒绝收场——测试用 signal 掐停（loop 中断纪律 1 的演练入口）
    await new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(abortOf());
        return;
      }
      signal.addEventListener("abort", () => reject(abortOf()), { once: true });
    });
    return;
  }
  if (entry instanceof Error) throw entry;
  const events = typeof entry === "function" ? await entry(req, signal) : entry;
  if (!Array.isArray(events)) {
    // 流形态（generator 条目）：透传不整体校验——这类条目演练挂起 / 中断，
    // "finish 之后不得有事件"由消费方（loop 纪律 1）与静态数组条目的构造期校验负责
    yield* events;
    return;
  }
  validateSequence(events, "函数条目响应");
  yield* events;
}

function abortOf(): LlmError {
  return new LlmError("ABORTED", "mock stream aborted by signal");
}
