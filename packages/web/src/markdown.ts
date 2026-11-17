// markdown→React（host.renderMarkdown 的唯一实现体，D-057 边界：正文不可插——正文渲染永远
// 是官方实现，可插的是容器不是内容）。GFM（表格/删除线/任务列表）；raw HTML 不渲染（react-markdown
// 默认跳过 = 消毒）；无语法高亮 v1（facade opts.highlight 预留）。样式 = tokens.css .henira-md
// 类族（嵌入方零样式依赖不变）。行为取舍（dsh MarkdownText 行为层参照 2026-11-17）：
// 流式中未闭合代码围栏 = 代码块渲染（settled grammar is the streaming one，remark 天然如此）；
// 宽表格自然宽度 + 容器横向滚动（md-table-wide 同行为，纯 CSS 达成）。

import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function markdownNode(text: string): React.ReactNode {
  return createElement(
    "div",
    { className: "henira-md" },
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, text),
  );
}
