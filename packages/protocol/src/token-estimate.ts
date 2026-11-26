// 估算器（compaction.md §4.2）：纯函数、零依赖。loop（输出封顶 / 余量读数）与压缩插件共用同一份
// 系数——两处各算一套常量，压力线与请求预算就会对不上。
// 系数由真实账本回放定标（2026-11-26，93 份账本 / 934 对相邻可比步）：五类码点分别计价，数字
// 最贵（接近逐位计价）——十六进制转储、ID、表格类比英文散文贵三倍以上。按本组系数回放：估算
// 不低于实际的步占 97.8%，中位高估 21%。留余量是有意的——欠估会让请求发不出去，高估只是压得早。

import type { WireToolSchema } from "./llm.js";
import type { ModelMessage } from "./services.js";

/** 每个码点的 token 数（空白不计价） */
export const ESTIMATE_TOKENS_PER_CHAR = {
  letter: 0.5,
  digit: 1.4,
  punct: 0.2,
  cjk: 1.0,
} as const;

/** 每条消息的固定开销（角色、分隔符；回归给出的每条工具结果约 40） */
export const ESTIMATE_TOKENS_PER_MESSAGE = 40;
/** 每个工具定义在序列化文本之外的固定开销（聊天模板的工具头尾） */
export const ESTIMATE_TOKENS_PER_TOOL = 80;
/** 工具调用在参数文本之外的固定开销（名称、调用标识、分隔符） */
export const ESTIMATE_TOKENS_PER_TOOL_CALL = 20;

const SPACE = /\s/;
const LETTER = /\p{L}/u;
const NUMBER = /\p{N}/u;

/** 中日韩及全角区（汉字、假名、谚文、全角标点与全角字符） */
export function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x20000 && cp <= 0x3ffff) ||
    (cp >= 0x3000 && cp <= 0x303f)
  );
}

/** 文本的 token 估算（按码点分类计价） */
export function estimateText(text: string): number {
  let letters = 0;
  let digits = 0;
  let punct = 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      // ASCII 快速路径：字母 / 数字 / 空白（不计价）/ 其余算标点
      if (code >= 0x30 && code <= 0x39) digits += 1;
      else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) letters += 1;
      else if (
        code !== 0x20 &&
        code !== 0x09 &&
        code !== 0x0a &&
        code !== 0x0d &&
        code !== 0x0b &&
        code !== 0x0c
      ) {
        punct += 1;
      }
      continue;
    }
    const cp = code >= 0xd800 && code <= 0xdbff ? (text.codePointAt(i) ?? code) : code;
    if (cp > 0xffff) i += 1;
    if (isCjkCodePoint(cp)) cjk += 1;
    else {
      const ch = String.fromCodePoint(cp);
      if (SPACE.test(ch)) continue;
      else if (LETTER.test(ch)) letters += 1;
      else if (NUMBER.test(ch)) digits += 1;
      else punct += 1;
    }
  }
  return (
    letters * ESTIMATE_TOKENS_PER_CHAR.letter +
    digits * ESTIMATE_TOKENS_PER_CHAR.digit +
    punct * ESTIMATE_TOKENS_PER_CHAR.punct +
    cjk * ESTIMATE_TOKENS_PER_CHAR.cjk
  );
}

/** 一条引擎消息的 token 估算（含固定开销） */
export function estimateMessage(message: ModelMessage): number {
  switch (message.role) {
    case "system":
    case "user":
      return estimateText(message.content) + ESTIMATE_TOKENS_PER_MESSAGE;
    case "assistant": {
      const calls = message.toolCalls?.reduce(
        (sum, call) =>
          sum +
          estimateText(call.name) +
          estimateText(call.arguments) +
          ESTIMATE_TOKENS_PER_TOOL_CALL,
        0,
      );
      return (
        estimateText(message.content) +
        (message.reasoning === undefined ? 0 : estimateText(message.reasoning)) +
        (calls ?? 0) +
        ESTIMATE_TOKENS_PER_MESSAGE
      );
    }
    case "tool":
      return (
        estimateText(message.name) + estimateText(message.content) + ESTIMATE_TOKENS_PER_MESSAGE
      );
  }
}

export function estimateMessages(messages: readonly ModelMessage[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessage(message);
  return total;
}

/** 工具表（随请求发送的定义）的 token 估算：名称 + 描述 + 入参 schema 序列化文本 + 每个工具的固定开销 */
export function estimateTools(tools: readonly WireToolSchema[]): number {
  let total = 0;
  for (const tool of tools) {
    total +=
      estimateText(tool.name) +
      estimateText(tool.description) +
      estimateText(JSON.stringify(tool.inputSchema)) +
      ESTIMATE_TOKENS_PER_TOOL;
  }
  return total;
}
