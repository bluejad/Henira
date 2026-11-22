// markdown→React（host.renderMarkdown 的实现体：settled 臂在本文件，流式增量臂在
// streaming-markdown.ts——路由在 host.ts，D-057 边界：正文不可插——正文渲染永远是官方实现，
// 可插的是容器不是内容）。GFM（表格/删除线/任务列表）；raw HTML 不渲染（react-markdown
// 默认跳过 = 消毒）。样式 = tokens.css .henira-md / .henira-code 类族（嵌入方零样式依赖不变）。
// 行为取舍（dsh MarkdownText 行为层参照 2026-11-17）：流式中未闭合代码围栏 = 代码块渲染
// （settled grammar is the streaming one，remark 天然如此）；宽表格自然宽度 + 容器横向滚动。
// 语法高亮（E4 重构为懒加载）：shiki JS regex 引擎（无 WASM）+ CSS 变量主题（色值在
// tokens.css 双主题组，随 data-theme 自动切）；语言包按需 dynamic import（vite 逐语言
// 分包——主包零语法体积，E4 前 5 语言静态打进主包）；官方 5 语言启动即后台预热；加载
// 结果缓存（语言已热后重复渲染同步命中不闪），未知语言/加载失败静默降纯文本（原语义）；
// 流式中不高亮（delta 高频重渲下高亮是纯开销，回合完成后一次成型——ZCode 同行为）。

import { CodeGlyph, CopyButton } from "@henira/plugin-web-ui";
import { createElement, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createCssVariablesTheme,
  createHighlighterCore,
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

// 围栏信息串 → 规范语言 id（小写归一后查表；表外原样作 id 试加载，加载失败降纯文本）
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
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  cs: "csharp",
  "c#": "csharp",
  java: "java",
  kt: "kotlin",
  kotlin: "kotlin",
  rs: "rust",
  rust: "rust",
  go: "go",
  golang: "go",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  markdown: "markdown",
  md: "markdown",
  mdx: "mdx",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  zig: "zig",
  powershell: "powershell",
  ps1: "powershell",
  elixir: "elixir",
  haskell: "haskell",
  dart: "dart",
  r: "r",
};

/** 语言包加载器（每个 import() 一个独立 chunk——vite 代码分割，主包只载本表骨架） */
const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  bash: () => import("@shikijs/langs/bash"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  elixir: () => import("@shikijs/langs/elixir"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  haskell: () => import("@shikijs/langs/haskell"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  less: () => import("@shikijs/langs/less"),
  lua: () => import("@shikijs/langs/lua"),
  markdown: () => import("@shikijs/langs/markdown"),
  mdx: () => import("@shikijs/langs/mdx"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  python: () => import("@shikijs/langs/python"),
  r: () => import("@shikijs/langs/r"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  zig: () => import("@shikijs/langs/zig"),
};

// 高亮 token 色走 CSS 变量（真色值在 tokens.css 明暗两组——主题切换零重高亮）
const HENIRA_SHIKI = createCssVariablesTheme({
  name: "henira",
  variablePrefix: "--henira-shiki-",
});

let highlighterPromise: Promise<HighlighterCore> | undefined;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [HENIRA_SHIKI],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

/** 语言包按需加载；未登记/加载失败 → false（降级纯文本，原语义） */
async function ensureLang(lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;
  const load = LANG_LOADERS[lang];
  if (load === undefined) return false;
  try {
    const [hl, mod] = [await getHighlighter(), await load()];
    await hl.loadLanguage(mod.default as never); // v4 语言包 default = LanguageRegistration[]（数组）
    loadedLangs.add(lang);
    return true;
  } catch {
    return false;
  }
}

// 官方 5 语言启动即后台预热（并行 chunk 取数——用户首个代码块基本命中缓存，不闪纯文本）
for (const id of ["bash", "javascript", "json", "python", "typescript"]) void ensureLang(id);

function renderToken(token: ThemedToken): string {
  return token.color === undefined
    ? escapeHtml(token.content)
    : `<span style="color:${token.color}">${escapeHtml(token.content)}</span>`;
}

/** 高亮结果缓存（语言已热后重复渲染同步命中——首渲即着色不闪；cap 防长会话无界） */
const highlightCache = new Map<string, string>();
const HIGHLIGHT_CACHE_CAP = 300;

async function ensureHighlighted(lang: string, code: string): Promise<string | undefined> {
  const key = `${lang}\u0000${code}`;
  const hit = highlightCache.get(key);
  if (hit !== undefined) return hit;
  if (!(await ensureLang(lang))) return undefined;
  try {
    const hl = await getHighlighter();
    // shiki v4 实例方法运行时返回 { tokens, ... }（类型标注与运行时不符，强转并留证）
    const { tokens } = hl.codeToTokens(code, { lang, theme: "henira" }) as unknown as {
      tokens: ThemedToken[][];
    };
    // 自拼行结构（不用 shiki 的 pre/code 模板——容器与头部条由 .henira-code 族自绘）
    const html = tokens
      .map((line) => `<span class="henira-code-line">${line.map(renderToken).join("")}</span>`)
      .join("\n");
    highlightCache.set(key, html);
    while (highlightCache.size > HIGHLIGHT_CACHE_CAP) {
      const oldest = highlightCache.keys().next().value;
      if (oldest === undefined) break;
      highlightCache.delete(oldest);
    }
    return html;
  } catch {
    return undefined;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** 围栏代码块（真组件——换行切换局部 state + 高亮异步 swap 的 hooks 经 React 渲染进
 *  组件实例，绝不可当纯函数直呼——React #310 教训）：头部条（文件图标+伪文件名=语言串
 *  按文件名样式，dsh/ZCode 同款 + 换行钮 + 复制钮）+ pre>code。默认不换行 = 现状横滚
 *  （拍板 2026-11-21），每块独立切换不持久化（dsh/ZCode 同语义，持久化挂账）。 */
function CodeBlock({ children, opts }: { children: React.ReactNode; opts: MarkdownOptions }) {
  const el = Array.isArray(children) ? children[0] : children;
  const props =
    el !== null && typeof el === "object" && "props" in el
      ? (el.props as { className?: string; children?: unknown })
      : {};
  const info = /language-([\w+#-]+)/.exec(props.className ?? "")?.[1];
  const infoKey = info?.toLowerCase();
  const lang = infoKey !== undefined ? (LANG_ALIASES[infoKey] ?? infoKey) : undefined;
  const raw = typeof props.children === "string" ? props.children : String(props.children ?? "");
  const streaming = opts.streaming === true;
  const canHighlight = !streaming && lang !== undefined;
  // 缓存命中同步着色（语言已热不闪纯文本）；未命中经 effect 异步加载后 swap
  const cached = canHighlight ? highlightCache.get(`${lang ?? ""}\u0000${raw}`) : undefined;
  const [loadedHtml, setLoadedHtml] = useState<string | undefined>(undefined);
  const [wrapped, setWrapped] = useState(false);
  useEffect(() => {
    if (!canHighlight || lang === undefined) return;
    let cancelled = false;
    void ensureHighlighted(lang, raw).then((html) => {
      if (!cancelled && html !== undefined) setLoadedHtml(html);
    });
    return () => {
      cancelled = true;
    };
  }, [canHighlight, lang, raw]);
  const highlighted = cached ?? loadedHtml;
  return createElement(
    "div",
    { className: "henira-code", "data-code-wrap": wrapped ? "true" : "false" },
    createElement(
      "div",
      { className: "henira-code-head" },
      createElement(
        "span",
        { className: "henira-code-lang", title: info },
        createElement(CodeGlyph, { size: 12 }),
        createElement("span", { className: "henira-code-filename" }, info ?? "text"),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "henira-code-wrap",
          "aria-pressed": wrapped,
          onClick: () => setWrapped((v) => !v),
        },
        wrapped ? (opts.t?.("code.nowrap") ?? "No wrap") : (opts.t?.("code.wrap") ?? "Wrap"),
      ),
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

/** 宽表判定列数（dsh md-table-wide 同款取数思路）：表头 th 数；无表头取首行单元格数 */
function countTableColumns(node: unknown): number {
  interface HastElementLike {
    tagName?: string;
    children?: HastElementLike[];
  }
  const el = node as HastElementLike | undefined;
  const cellCount = (tr: HastElementLike | undefined): number =>
    (tr?.children ?? []).filter((c) => c?.tagName === "th" || c?.tagName === "td").length;
  for (const child of el?.children ?? []) {
    if (child?.tagName !== "thead") continue;
    for (const tr of child.children ?? []) {
      if (tr?.tagName === "tr" && cellCount(tr) > 0) return cellCount(tr);
    }
  }
  for (const child of el?.children ?? []) {
    if (child?.tagName !== "tbody") continue;
    for (const tr of child.children ?? []) {
      if (tr?.tagName === "tr" && cellCount(tr) > 0) return cellCount(tr);
    }
  }
  return 0;
}

/** 宽表专组件（E4，dsh md-table-wide 行为层参照）：≥4 列进横滚容器（tabIndex=0 补键盘
 *  滚动；hover/focus 才显横滚条 = 切 overflow-x 本身——hidden→scroll 是 layout 变化必然
 *  重绘，hover 条件化的 scrollbar 样式 Chromium 不重绘）；<4 列 width:100% 占满消息列。 */
function WideTable({ node, children }: { node: unknown; children: React.ReactNode }) {
  if (countTableColumns(node) >= 4) {
    return createElement(
      "div",
      { className: "henira-table-scroll", tabIndex: 0 },
      createElement("table", null, children),
    );
  }
  return createElement("table", { className: "henira-table-fill" }, children);
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
        pre: ({ children }) => createElement(CodeBlock, { children, opts }),
        table: ({ node, children }) => createElement(WideTable, { node, children }),
        // 外链新标签打开；相对/锚点链接禁止把宿主应用导航走（R177：参照物无「点链接整页被顶掉」）
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
          const target = href ?? "";
          const external = /^(?:https?:|mailto:)/i.test(target);
          const hash = target.startsWith("#");
          return createElement(
            "a",
            {
              href,
              ...(external ? { target: "_blank", rel: "noreferrer noopener" } : {}),
              onClick: (event: React.MouseEvent) => {
                if (!external && !hash) event.preventDefault();
              },
            },
            children,
          );
        },
        // GFM 任务列表勾选框：统一主题化（只读展示，不接受交互）
        input: ({ checked }: { checked?: boolean }) =>
          createElement("input", {
            type: "checkbox",
            checked,
            disabled: true,
            className: "henira-task-checkbox",
          }),
      },
    },
    text,
  );
}

export function markdownNode(text: string, opts: MarkdownOptions = {}): React.ReactNode {
  return createElement("div", { className: "henira-md" }, markdownChildren(text, opts));
}
