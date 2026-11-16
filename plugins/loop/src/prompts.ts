// 基底系统块（session.md §4：基底身份归官方 loop 插件；P9-3 的"零用户可见文案"
// 不禁给模型看的提示词——引擎提示词按 D-050 第 2 款定英文、永不本地化）。

export const BASE_SYSTEM_KEY = "loop/base";

export const BASE_SYSTEM_PROMPT =
  "You are Henira, a coding agent working inside the user's project. " +
  "Use the provided tools to read and modify files when asked, and answer concisely.";
