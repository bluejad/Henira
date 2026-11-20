// @vitest-environment jsdom
// 流式增量渲染测试（E2）：纯函数层——切片逐字性（冻结片+尾片拼回=全文）、尾段保留 2 块、
// 冻结 key 跨帧稳定；组件层——冻结块 DOM 节点引用跨帧不变（选区保住的行为层实证）、
// 未闭合围栏留尾渲为代码块（settled grammar is the streaming one）、setext 标题重塑落尾、
// 非前缀重置、流式全程不高亮、流式臂与 settled 臂对完整文本同构。

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { markdownNode } from "./markdown.js";
import { IncrementalMarkdown, splitTail, streamingMarkdownNode } from "./streaming-markdown.js";

afterEach(cleanup);

const frame = (text: string) => createElement(IncrementalMarkdown, { text });

describe("splitTail（尾段切块纯函数）", () => {
  it("冻结片+尾片拼回 = 全文逐字不变", () => {
    const doc = [
      "# 标题",
      "",
      "第一段。",
      "",
      "```js",
      "const a = 1;",
      "```",
      "",
      "第二段。",
      "",
      "## 又一节",
      "",
      "尾段内容。",
    ].join("\n");
    const split = splitTail(doc, 0);
    expect(split).toBeDefined();
    const joined = [...(split?.newlyFrozen.map((b) => b.text) ?? []), split?.tail ?? ""].join("");
    expect(joined).toBe(doc);
    // 6 块冻 4：尾段只剩最后 2 块（h2 + 收尾段）
    expect(split?.newlyFrozen).toHaveLength(4);
    expect(split?.tail).toContain("又一节");
    expect(split?.tail).toContain("尾段内容");
  });

  it("尾段保留最后 2 块：5 块文本冻结 3 块、缝推进到第 3 块尾", () => {
    const doc = "一\n\n二\n\n三\n\n四\n\n五";
    const split = splitTail(doc, 0);
    expect(split?.newlyFrozen).toHaveLength(3);
    expect(split?.newlyFrozen.map((b) => b.text.trim())).toEqual(["一", "二", "三"]);
    expect(doc.slice(split?.seam ?? 0)).toBe("\n\n四\n\n五");
  });

  it("块数 ≤2 → 无冻结、缝不动", () => {
    const split = splitTail("只有一段。", 0);
    expect(split?.newlyFrozen).toHaveLength(0);
    expect(split?.seam).toBe(0);
    expect(split?.tail).toBe("只有一段。");
  });

  it("前缀追加下共同冻结块的 key 跨帧稳定", () => {
    const short = "一\n\n二\n\n三";
    const long = `${short}\n\n四\n\n五`;
    const keysOf = (t: string) => splitTail(t, 0)?.newlyFrozen.map((b) => b.key) ?? [];
    const shortKeys = keysOf(short);
    // short 冻结的是「一」（3 块冻 1）；long 冻结「一」「二」「三」——共同块 key 相等
    expect(shortKeys.length).toBeGreaterThan(0);
    expect(keysOf(long).slice(0, shortKeys.length)).toEqual(shortKeys);
  });
});

describe("IncrementalMarkdown（流式臂组件）", () => {
  it("冻结块 DOM 节点引用跨帧不变（逐帧追加；选区保住的行为层实证）", () => {
    const step1 = "第一段。\n\n第二段。";
    const step2 = `${step1}\n\n第三段。`; // 第 3 块出现 → 第 1 块冻结（冻结帧节点新建）
    const step3 = `${step2}\n\n第四段。`;
    const step4 = `${step3}\n\n第五段。`;
    const view = render(frame(step1));
    expect(view.container.querySelectorAll("p")).toHaveLength(2);

    view.rerender(frame(step2));
    expect(view.container.querySelectorAll("p")).toHaveLength(3);
    const frozenP = view.container.querySelectorAll("p")[0];
    expect(frozenP?.textContent).toBe("第一段。");

    view.rerender(frame(step3));
    expect(view.container.querySelectorAll("p")).toHaveLength(4);
    expect(view.container.querySelectorAll("p")[0]).toBe(frozenP); // 冻结后跨帧不动

    view.rerender(frame(step4));
    expect(view.container.querySelectorAll("p")).toHaveLength(5);
    expect(view.container.querySelectorAll("p")[0]).toBe(frozenP);
    expect(view.container.textContent).toContain("第五段。");
  });

  it("未闭合围栏留尾渲为代码块；围栏闭合后冻结块仍为 code", () => {
    const step1 = "先说话\n\n```js\nconsole.log(";
    const step2 = `${step1}1);\n\`\`\`\n\n收尾段。`;
    const view = render(frame(step1));
    expect(view.container.querySelector("pre code")).not.toBeNull();

    view.rerender(frame(step2));
    const code = view.container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("console.log(1);");
    // 冻结的「先说话」节点不受围栏闭合影响
    expect(view.container.querySelectorAll("p")[0]?.textContent).toBe("先说话");
  });

  it("setext 标题重塑落尾：段落接 === 变 h1 且冻结后不受扰", () => {
    const step1 = "第一段。\n\n待定标题";
    const step2 = `${step1}\n===`; // 尾段重解析：段落 → h1
    const step3 = `${step2}\n\n新段落。`; // 3 块 → 第 1 块冻结
    const step4 = `${step3}\n\n再补一段。`;
    const view = render(frame(step1));
    view.rerender(frame(step2));
    expect(view.container.querySelector("h1")?.textContent).toBe("待定标题");

    view.rerender(frame(step3));
    expect(view.container.querySelector("h1")?.textContent).toBe("待定标题");
    const frozenP = view.container.querySelectorAll("p")[0];
    expect(frozenP?.textContent).toBe("第一段。");

    view.rerender(frame(step4));
    expect(view.container.querySelectorAll("p")[0]).toBe(frozenP);
    expect(view.container.textContent).toContain("再补一段。");
  });

  it("非前缀输入（换消息/编辑）整体重置：旧文不残留、新文整渲", () => {
    const view = render(frame("原文第一段。\n\n原文第二段。"));
    view.rerender(frame("# 换了标题\n\n全新内容。"));
    expect(view.container.textContent).not.toContain("原文");
    expect(view.container.querySelector("h1")?.textContent).toBe("换了标题");
    // 重置后前缀追加继续正常
    view.rerender(frame("# 换了标题\n\n全新内容。\n\n再追加一段。"));
    expect(view.container.textContent).toContain("再追加一段。");
  });

  it("流式全程不高亮：冻结的代码块也无 token 着色（settle 后一次成型）", () => {
    const doc = "```js\nconst a = 1;\n```\n\n中段。\n\n收尾段。";
    const view = render(frame(doc));
    expect(view.container.querySelector(".henira-code-lang")?.textContent).toBe("js");
    expect(view.container.querySelector("code span[style]")).toBeNull();
    expect(view.container.querySelector("pre code")?.textContent).toContain("const a = 1;");
  });

  it("流式臂与 settled 臂对同一完整文本渲染出相同 DOM（.henira-md 平铺块结构一致）", () => {
    const doc = "## 小标题\n\n正文一段。\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const streaming = render(streamingMarkdownNode(doc, { streaming: true }));
    const settled = render(markdownNode(doc));
    expect(streaming.container.querySelector(".henira-md")).not.toBeNull();
    expect(streaming.container.querySelector("h2")?.textContent).toBe(
      settled.container.querySelector("h2")?.textContent,
    );
    expect(streaming.container.querySelectorAll("p,table")).toHaveLength(
      settled.container.querySelectorAll("p,table").length,
    );
    expect(streaming.container.querySelector("table")).not.toBeNull();
  });
});
