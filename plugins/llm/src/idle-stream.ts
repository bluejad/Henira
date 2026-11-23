// 流空闲看门狗（R193）：provider 静默 = 引擎事实，不交给界面猜。
// 每一次「等下一个 part」都设上限：超时先掐底层请求（fused AbortController），再抛
// LlmError(LLM_STREAM_IDLE_TIMEOUT_CODE) → loop 落 ErrorRow；慢思考只要还在吐 part 就不触发。
// 与传输层看门狗分层：这里量「模型活性」，客户端量「链路有没有字节」（sdk client）。

import {
  DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS,
  LLM_STREAM_IDLE_TIMEOUT_CODE,
  LlmError,
} from "@henira/protocol";

export interface IdleStreamOptions {
  /** 单次等待 part 的上限（毫秒） */
  idleTimeoutMs: number;
  /** 超时先掐底层请求（AI SDK abortSignal 的 fused controller） */
  abort: () => void;
}

/** settings.json plugins."plugin-llm".options.streamIdleTimeoutMs 的解释口——
 *  非正数 / 非数值 = 缺省（不把 0 当「关闭」：静默无上限正是本批要消灭的形态） */
export function resolveIdleTimeoutMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_LLM_STREAM_IDLE_TIMEOUT_MS;
}

export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  opts: IdleStreamOptions,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const pending = iterator.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), opts.idleTimeoutMs);
      });
      let result: IteratorResult<T> | "timeout";
      try {
        // race 已给 pending 挂上处理器：超时放弃时其后续 rejection 不会成为未处理拒绝
        result = await Promise.race([pending, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (result === "timeout") {
        opts.abort();
        throw new LlmError(
          LLM_STREAM_IDLE_TIMEOUT_CODE,
          `llm stream idle timeout: no output for ${opts.idleTimeoutMs}ms`,
        );
      }
      if (result.done === true) return;
      yield result.value;
    }
  } finally {
    // 消费者提前退出（用户中断 / 超时）→ 关底层迭代器。**不 await**：底层若不响应 abort，
    // await return 会把「超时已触发」也挂住——看门狗的意义就没了；关流失败不遮障
    try {
      const closing = iterator.return?.();
      if (closing !== undefined) void closing.catch(() => {});
    } catch {
      // 已结束 / 正在 abort——忽略
    }
  }
}
