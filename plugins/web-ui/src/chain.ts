// chain 槽选举（R182，dsh SlotKind 行为层）：条目按 priority 升序（同值保注册序），
// select 首个非 null 者当选；全部让位 = null（消费件渲染 fallback）。
// 只做纯选举，不碰 React——消费件负责 fallback 挂载与 overlay 隐藏。

import type { ChainEntry } from "./types.js";

/** 官方/第三方条目类型保真入口：注册面按 ChainEntry<unknown, unknown> 存，
 * 定义面保留 owner/matched 具体类型（select 的参数逆变不丢检查）。 */
export function defineChainEntry<Owner, Matched>(entry: ChainEntry<Owner, Matched>): ChainEntry {
  return entry as unknown as ChainEntry;
}

/** 选举：升序尝试，first non-null wins；返回条目与 matched（消费件按 matched 类型收窄） */
export function electChain<Matched>(
  entries: readonly ChainEntry[] | undefined,
  owner: unknown,
): { entry: ChainEntry<unknown, Matched>; matched: Matched } | null {
  const sorted = [...(entries ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const entry of sorted) {
    const matched = entry.select(owner) as Matched | null;
    if (matched !== null) return { entry: entry as ChainEntry<unknown, Matched>, matched };
  }
  return null;
}
