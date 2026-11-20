// @vitest-environment jsdom
// markdown 渲染测试（M4 批 A 提交 2）：markdownNode 的行为矩阵——标题/代码块/GFM 表格/
// 链接/内联图渲染；raw HTML 不渲染（消毒默认）；未闭合围栏=代码块（settled grammar
// is the streaming one）；根容器 .henira-md（样式挂点，嵌入方零依赖）。

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { markdownChildren, markdownNode } from "./markdown.js";

afterEach(cleanup);

describe("markdownNode（host.renderMarkdown 实现体）", () => {
  it("根容器 .henira-md；标题分级渲染", () => {
    const { container } = render(markdownNode("# 大标题\n\n## 小标题"));
    expect(container.querySelector(".henira-md")).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("大标题");
    expect(container.querySelector("h2")?.textContent).toBe("小标题");
  });

  it("闭合代码围栏 → pre>code，语言类落在 code 上", () => {
    const { container } = render(markdownNode("```js\nconsole.log(1);\n```"));
    expect(container.querySelector("pre code")).not.toBeNull();
  });

  it("预装语言代码块 shiki 高亮（头部条 + token 着色 span 在场）", () => {
    const { container } = render(markdownNode("```python\ndef f():\n    return 1\n```"));
    expect(container.querySelector(".henira-code")).not.toBeNull();
    expect(container.querySelector(".henira-code-lang")?.textContent).toBe("python");
    expect(container.querySelector("code span[style]")).not.toBeNull();
  });

  it("streaming 标志抑制代码高亮（增量臂经 markdownChildren 消费的活机制；markdownNode 生产入口恒 settled——审查 P3-1）", () => {
    const { container } = render(markdownChildren("```python\nprint(1)\n```", { streaming: true }));
    expect(container.querySelector(".henira-code-lang")?.textContent).toBe("python");
    expect(container.querySelector("code span[style]")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain("print(1)");
  });

  it("未闭合围栏 = 代码块渲染（settled 臂语法容错——settled grammar is the streaming one；流式臂同语义另有增量臂层覆盖）", () => {
    const { container } = render(markdownNode("先说话\n\n```js\nconsole.log(1);"));
    expect(container.querySelector("pre code")).not.toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("先说话");
  });

  it("GFM 表格渲染（表头/行），宽表格容器 overflow-x", () => {
    const { container } = render(markdownNode("| a | b |\n|---|---|\n| 1 | 2 |"));
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("链接与内联图渲染", () => {
    const { container } = render(markdownNode("[文档](https://henira.dev) 与 ![图](x.png)"));
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://henira.dev");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("x.png");
  });

  it("raw HTML 不渲染（消毒默认）——img/script 标签不出现", () => {
    const { container } = render(
      markdownNode('<img src=x onerror="alert(1)">\n\n<script>1</script>'),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("删除线（GFM）", () => {
    const { container } = render(markdownNode("~~旧的~~"));
    expect(container.querySelector("del")?.textContent).toBe("旧的");
  });
});
