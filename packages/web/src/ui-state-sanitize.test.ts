// ui-state 净化（R188 审查 P2）：data: 图片 tab 是内容不是引用——落盘前剔除，
// 其余 tab（文件 rowId/path、URL 图片）照旧持久化。

import type { SessionUiState } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { sanitizeSessionUiState } from "./ui-state-sanitize.js";

type Tabs = NonNullable<SessionUiState["rightPanel"]>["tabs"];

function doc(tabs: Tabs, active?: string): SessionUiState {
  return { rightPanel: { open: true, active: active ?? null, tabs } };
}

describe("sanitizeSessionUiState", () => {
  it("data: 图片 tab 剔除；URL 图片与文件 tab 保留", () => {
    const input = doc([
      { id: "f1", kind: "preview-file", path: "/a.ts", rowId: "r1" },
      { id: "i1", kind: "preview-image", src: "data:image/png;base64,AAAA" },
      { id: "i2", kind: "preview-image", src: "https://x/y.png", alt: "y" },
    ]);
    const out = sanitizeSessionUiState(input);
    expect(out.rightPanel?.tabs?.map((t) => t.id)).toEqual(["f1", "i2"]);
  });

  it("active 指向被剔 tab → 重指向最后一个剩余 tab；无剩余 = null", () => {
    const input = doc(
      [
        { id: "f1", kind: "preview-file", path: "/a.ts", rowId: "r1" },
        { id: "i1", kind: "preview-image", src: "data:image/png;base64,AAAA" },
      ],
      "i1",
    );
    expect(sanitizeSessionUiState(input).rightPanel?.active).toBe("f1");
    const onlyData = doc([{ id: "i1", kind: "preview-image", src: "data:," }], "i1");
    expect(sanitizeSessionUiState(onlyData).rightPanel?.active).toBeNull();
  });

  it("active 未被剔除则原样保留；其余字段不动", () => {
    const input: SessionUiState = {
      draft: "hello",
      rightPanel: {
        open: true,
        active: "f1",
        tabs: [
          { id: "f1", kind: "preview-file", path: "/a.ts", rowId: "r1" },
          { id: "i1", kind: "preview-image", src: "data:image/png;base64,AAAA" },
        ],
      },
    };
    const out = sanitizeSessionUiState(input);
    expect(out.rightPanel?.active).toBe("f1");
    expect(out.draft).toBe("hello");
  });

  it("无需剔除时返回同一引用（零额外渲染）；空文档同理", () => {
    const clean = doc([{ id: "f1", kind: "preview-file", path: "/a.ts", rowId: "r1" }]);
    expect(sanitizeSessionUiState(clean)).toBe(clean);
    const empty: SessionUiState = {};
    expect(sanitizeSessionUiState(empty)).toBe(empty);
  });
});
