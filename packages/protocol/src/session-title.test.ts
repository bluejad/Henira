import { describe, expect, it } from "vitest";
import type { Row } from "./server-events.js";
import { deriveSessionTitle, formatSessionTitle, SESSION_TITLE_MAX } from "./session-title.js";

const userRow = (text: string, source = "send"): Row => ({
  kind: "user",
  rowId: `u:${text}`,
  rowSeq: 1,
  turn: "t-1",
  text,
  source,
});

describe("formatSessionTitle", () => {
  it("空白归一 + 去首尾空白", () => {
    expect(formatSessionTitle("  写一个\n\n关于\t缓存 的方案  ")).toBe("写一个 关于 缓存 的方案");
  });

  it("空/纯空白返回 undefined", () => {
    expect(formatSessionTitle("")).toBeUndefined();
    expect(formatSessionTitle(" \n\t ")).toBeUndefined();
  });

  it("按码点截断（emoji/CJK 不劈半）并加省略号", () => {
    const title = formatSessionTitle("🧠".repeat(SESSION_TITLE_MAX + 1));
    expect([...(title ?? "")].length).toBe(SESSION_TITLE_MAX + 1); // 40 码点 + 省略号
    expect(title?.endsWith("…")).toBe(true);
  });
});

describe("deriveSessionTitle", () => {
  it("取首条有文本的非 breaker 用户消息", () => {
    const rows = [
      userRow("Circuit breaker: repeated calls", "breaker"),
      userRow("   "),
      userRow("先把左栏会话标题补上"),
    ];
    expect(deriveSessionTitle(rows)).toBe("先把左栏会话标题补上");
  });

  it("没有用户消息返回 undefined", () => {
    expect(deriveSessionTitle([])).toBeUndefined();
  });
});
