// markdown→React（host.renderMarkdown 的实现体：settled 臂在本文件，流式增量臂在
// streaming-markdown.ts——路由在 host.ts，D-057 边界：正文不可插——正文渲染永远是官方实现，
// 可插的是容器不是内容）。GFM（表格/删除线/任务列表）；raw HTML 不渲染（react-markdown
// 默认跳过 = 消毒）。样式 = tokens.css .henira-md / .henira-code 类族（嵌入方零样式依赖不变）。
// 行为取舍（dsh MarkdownText 行为层参照 2026-11-17）：流式中未闭合代码围栏 = 代码块渲染
// （settled grammar is the streaming one，remark 天然如此）；宽表格自然宽度 + 容器横向滚动。
// 语法高亮（v1 翻案 2026-11-17，两家行为层参照）：shiki JS regex 引擎（无 WASM）+ CSS 变量
// 主题（色值在 tokens.css 双主题组，随 data-theme 自动切）。dsh 接法启示=启动少量语言、简单
// 可靠：v1 只预装 js/ts/python/bash/json，未知语言降级纯文本（不做懒加载/异步重渲——确定性
// 优先）；流式中不高亮（delta 高频重渲下高亮是纯开销，回合完成后一次成型——ZCode 同行为）。

import { CopyButton } from "@henira/plugin-web-ui";
import bash from "@shikijs/langs/bash";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import python from "@shikijs/langs/python";
import typescript from "@shikijs/langs/typescript";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createCssVariablesTheme,
  createHighlighterCoreSync,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { isFreshUnit, type RevealState, segmentRevealUnits } from "./streaming-reveal.js";

export type MarkdownOptions = {
  /** 流式中不高亮（delta 高频重渲；高亮留到回合完成一次成型） */
  streaming?: boolean;
  /** 代码块复制钮文案（host 注入 t——markdown 是纯渲染层，不持有字典） */
  t?: (key: string) => string;
  /** 逐词淡入渲染上下文（E3——仅流式尾臂传入；冻结臂/settled 臂不传 = 整段 settled）。
   * state = 排期真源（advance 每帧重建 plans）；seam = 尾段在全文中的绝对偏移（块 key 基准） */
  reveal?: { state: import("./streaming-reveal.js").RevealState; seam: number };
};

// 围栏信息串 → 预装语言归一化（表外 = 纯文本，v1 不做异步加载）
const LANG_ALIASES: Record<string, string> = {
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  python: "python",
  py: "python",
  py3: "python",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  json: "json",
  jsonc: "json",
};

// 高亮 token 色走 CSS 变量（真色值在 tokens.css 明暗两组——主题切换零重高亮）
const HENIRA_SHIKI = createCssVariablesTheme({
  name: "henira",
  variablePrefix: "--henira-shiki-",
});

let highlighter: HighlighterCore | undefined;

/** 预装语言同步高亮；表外/异常 → undefined（降级纯文本） */
function codeHighlight(language: string, code: string): string | undefined {
  try {
    if (highlighter === undefined) {
      // v4 语言包 default export = LanguageRegistration[]（数组），flat 展开注册
      highlighter = createHighlighterCoreSync({
        themes: [HENIRA_SHIKI],
        langs: [javascript, typescript, python, bash, json].flat(),
        engine: createJavaScriptRegexEngine(),
      });
    }
    // shiki v4 实例方法运行时返回 { tokens, ... }（类型标注与运行时不符，强转并留证）
    const { tokens } = highlighter.codeToTokens(code, {
      lang: language,
      theme: "henira",
    }) as unknown as { tokens: ThemedToken[][] };
    // 自拼行结构（不用 shiki 的 pre/code 模板——容器与头部条由 .henira-code 族自绘）
    const renderToken = (token: ThemedToken): string =>
      token.color === undefined
        ? escapeHtml(token.content)
        : `<span style="color:${token.color}">${escapeHtml(token.content)}</span>`;
    return tokens
      .map((line) => {
        const html = line.map(renderToken).join("");
        return `<span class="henira-code-line">${html}</span>`;
      })
      .join("\n");
  } catch {
    return undefined;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** 围栏代码块：头部条（语言名 + 复制钮）+ pre>code（block 级 code 只经由此路径——接管 pre） */
function codeBlock(children: React.ReactNode, opts: MarkdownOptions): React.ReactNode {
  const el = Array.isArray(children) ? children[0] : children;
  const props =
    el !== null && typeof el === "object" && "props" in el
      ? (el.props as { className?: string; children?: unknown })
      : {};
  const info = /language-([\w+#-]+)/.exec(props.className ?? "")?.[1];
  const lang = info !== undefined ? (LANG_ALIASES[info] ?? undefined) : undefined;
  const raw = typeof props.children === "string" ? props.children : String(props.children ?? "");
  const highlighted =
    opts.streaming !== true && lang !== undefined ? codeHighlight(lang, raw) : undefined;
  return createElement(
    "div",
    { className: "henira-code" },
    createElement(
      "div",
      { className: "henira-code-head" },
      createElement("span", { className: "henira-code-lang" }, info ?? "text"),
      createElement(CopyButton, { text: raw, t: opts.t }),
    ),
    createElement(
      "pre",
      null,
      highlighted !== undefined
        ? createElement("code", {
            className: "henira-code-highlight",
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 内容是 shiki 生成的固定 span 模板（代码文本已 escapeHtml 转义），非用户注入面
            dangerouslySetInnerHTML: { __html: highlighted },
          })
        : createElement("code", null, raw),
    ),
  );
}

// 模块常量（数组字面量每次内联会触发 react-markdown 无谓的管线重建）
const REMARK_PLUGINS = [remarkGfm];

// ── 逐词淡入 rehype 插件（E3 生命感；机制照参照物——span 包装 + CSS 变量延迟，只动 opacity）──

interface HastNodeLike {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNodeLike[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

/** 逐词淡入插件工厂：块内非空白文本单元包 span（fresh = data-reveal new + 延迟；已排期 =
 * settled——span 位置不变 DOM 保留，new→settled 换属性不重播动画）；空白保持裸文本；
 * **pre 整块与行内 code 跳过**（code 内出现带 style 的 span 会碎「流式无着色」断言）；
 * 无 plan 的块不动（重置帧/非增量帧零 DOM 搅动）。 */
function makeRevealPlugin(ctx: { state: RevealState; seam: number }) {
  return (tree: unknown): void => {
    const root = tree as HastNodeLike | undefined;
    if (root?.children === undefined) return; // 管线构建期（freeze）可能以未就绪树调用——跳过
    for (const child of root.children) {
      if (child.type === "element" && child.tagName === "pre") continue; // 代码块整体跳过
      const blockStart = child.position?.start?.offset;
      if (blockStart === undefined) continue;
      const blockKey = String(ctx.seam + blockStart);
      visitRevealNode(child, blockStart, blockKey, ctx.state);
    }
  };
}

function visitRevealNode(
  node: HastNodeLike,
  blockStart: number,
  blockKey: string,
  state: RevealState,
): void {
  if (node.children === undefined || node.children.length === 0) return;
  const next: HastNodeLike[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      next.push(...wrapRevealText(child, blockStart, blockKey, state));
      continue;
    }
    if (child.type === "element") {
      if (child.tagName === "code") {
        next.push(child); // 行内 code 原样即现（跳过——着色断言与原子性）
        continue;
      }
      visitRevealNode(child, blockStart, blockKey, state);
    }
    next.push(child);
  }
  node.children = next;
}

function wrapRevealText(
  node: HastNodeLike,
  blockStart: number,
  blockKey: string,
  state: RevealState,
): HastNodeLike[] {
  const value = node.value ?? "";
  const nodeStart = node.position?.start?.offset;
  if (nodeStart === undefined) return [node];
  const out: HastNodeLike[] = [];
  let cursor = 0;
  for (const unit of segmentRevealUnits(value)) {
    const gap = value.slice(cursor, unit.start);
    if (gap !== "") out.push({ type: "text", value: gap });
    const raw = value.slice(unit.start, unit.end);
    cursor = unit.end;
    if (raw.trim() === "") {
      out.push({ type: "text", value: raw }); // 空白不包装（参照物：非空白单元才包 span）
      continue;
    }
    const hit = isFreshUnit(state, blockKey, nodeStart - blockStart + unit.start);
    const reveal: HastNodeLike = {
      type: "element",
      tagName: "span",
      properties: hit.fresh
        ? {
            dataHeniraReveal: "new",
            style: { "--henira-reveal-delay": `${hit.delay ?? 0}ms` },
          }
        : { dataHeniraReveal: "settled" },
      children: [{ type: "text", value: raw }],
    };
    out.push(reveal);
  }
  if (cursor < value.length) out.push({ type: "text", value: value.slice(cursor) });
  return out;
}

/** 单实例 markdown 子元素（markdownNode 与流式增量臂 streaming-markdown.ts 共用的渲染体）；
 * key 供流式臂的多块平铺用（省去 cloneElement） */
export function markdownChildren(
  text: string,
  opts: MarkdownOptions,
  key?: string,
): React.ReactNode {
  // rehypePlugins 条目 = unified 插件（freeze 期调用以产出 transformer）——传工厂而非成品
  // transformer（成品被无参调用一次即静默丢弃，包装永不执行——E3 调试实锤）
  const reveal = opts.reveal;
  const rehypePlugins =
    reveal !== undefined
      ? [() => makeRevealPlugin({ state: reveal.state, seam: reveal.seam })]
      : undefined;
  return createElement(
    ReactMarkdown,
    {
      key,
      remarkPlugins: REMARK_PLUGINS,
      ...(rehypePlugins !== undefined ? { rehypePlugins } : {}),
      components: {
        pre: ({ children }) => codeBlock(children, opts),
      },
    },
    text,
  );
}

export function markdownNode(text: string, opts: MarkdownOptions = {}): React.ReactNode {
  return createElement("div", { className: "henira-md" }, markdownChildren(text, opts));
}
