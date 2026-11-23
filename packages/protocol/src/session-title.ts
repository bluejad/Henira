// 会话标题派生（R188）：左栏/中列 header 的唯一标题真源。
// 服务端列表从账本首条 user/message 取（有界读）、快照从投影行取、SDK 从内存投影取——
// 三处共用本文件的规则，避免「同名会话」「header 恒新对话」两处漂移。
// 只取首条非 breaker 用户消息；空白归一、码点截断（emoji/CJK 不按 UTF-16 劈半）。

import type { Row } from "./server-events.js";

/** 标题上限（码点）：约两行左栏宽度；超长加省略号。 */
export const SESSION_TITLE_MAX = 40;

export function formatSessionTitle(text: string, maxChars = SESSION_TITLE_MAX): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return undefined;
  const chars = [...normalized];
  if (chars.length <= maxChars) return normalized;
  return `${chars.slice(0, maxChars).join("")}…`;
}

/** 从投影行派生标题：首条有文本的非 breaker 用户消息。 */
export function deriveSessionTitle(rows: readonly Row[]): string | undefined {
  for (const row of rows) {
    if (row.kind !== "user") continue;
    if (row.source === "breaker") continue;
    const title = formatSessionTitle(row.text);
    if (title !== undefined) return title;
  }
  return undefined;
}
