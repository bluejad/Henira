// 流式增量 markdown 渲染（host.renderMarkdown 流式臂的实现体，路由在 host.ts；settled 臂 =
// markdown.ts 单实例全文一次成型）。每帧成本 = O(全文) 字节前缀比对 + O(尾段) 解析渲染：
// 文本增长是前缀追加时，已完成顶层块的 React 元素按源偏移 key 只建一次、引用跨帧复用——
// React 命中同引用同 key 完全跳过重渲（块内 DOM 与用户选区原地不动）；只解析重渲尾段。
// 尾段保留最后 2 块不冻结：块级语法是行制的，追加只能重塑最后一块（段落→setext 标题、
// 围栏收口、表格续行）——留第二块做安全边际，冻结决策无需推理解析前沿。
// 非前缀输入（换消息/编辑/历史跳转）整体重置按全量渲染。切点 = 上一冻结块 end.offset
// （块间空行归入下一片：冻结片+尾片拼回 = 全文逐字不变）。流式全程不高亮（settle 后一次
// 成型）。已知取舍：跨冻结边界的链接引用定义流式期渲染为字面文本、settled 自愈；settle
// 时全文重渲一次（选区丢失一次）。正文渲染永远是官方实现（D-057：可插的是容器不是内容）。

import type { ReactNode } from "react";
import { createElement, useRef } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { type MarkdownOptions, markdownChildren } from "./markdown.js";

/** 尾段不冻结的块数（追加只能重塑最后一块，第二块是安全边际） */
const UNSTABLE_TAIL_BLOCKS = 2;

// 尾段边界解析器（与 react-markdown 同栈：remark-parse + remark-gfm，块位置可靠）
const tailParser = unified().use(remarkParse).use(remarkGfm);

export interface FrozenBlock {
  /** 块首绝对偏移（React key，前缀追加下跨帧稳定） */
  key: number;
  /** 源切片（自上一冻结缝起、含块间空行——冻结片+尾片拼回 = 全文逐字） */
  text: string;
}

export interface TailSplit {
  /** 新冻结缝（已冻结内容覆盖的字节长度）；与入参相同 = 本帧无新冻结 */
  seam: number;
  newlyFrozen: FrozenBlock[];
  /** 尾段切片（自新缝到文末，含正在生长的块与未闭合围栏） */
  tail: string;
}

interface ParsedChild {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

/** 解析尾段并推进冻结缝；undefined = 本帧放弃增量（块缺位置信息等），调用方按整片重渲尾段 */
export function splitTail(text: string, seam: number): TailSplit | undefined {
  const slice = text.slice(seam);
  let root: { children: ParsedChild[] };
  try {
    root = tailParser.parse(slice) as unknown as { children: ParsedChild[] };
  } catch {
    return undefined;
  }
  const blocks: { start: number; end: number }[] = [];
  for (const child of root.children) {
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    if (start === undefined || end === undefined) return undefined;
    blocks.push({ start: seam + start, end: seam + end });
  }
  const freezeCount = blocks.length - UNSTABLE_TAIL_BLOCKS;
  if (freezeCount <= 0) {
    return { seam, newlyFrozen: [], tail: slice };
  }
  const newlyFrozen: FrozenBlock[] = [];
  let cursor = seam;
  for (let i = 0; i < freezeCount; i += 1) {
    const block = blocks[i];
    if (block === undefined) return undefined;
    newlyFrozen.push({ key: block.start, text: text.slice(cursor, block.end) });
    cursor = block.end;
  }
  return { seam: cursor, newlyFrozen, tail: text.slice(cursor) };
}

interface StreamState {
  /** 产生当前输出的全文（前缀校验基准；同文短路保幂等——StrictMode 双渲安全） */
  text: string;
  seam: number;
  /** 已冻结块元素（引用跨帧复用 = React 跳过重渲的全部机制） */
  frozen: ReactNode[];
  tail: string;
}

const EMPTY: StreamState = { text: "", seam: 0, frozen: [], tail: "" };

function advance(prev: StreamState, text: string, opts: MarkdownOptions): StreamState {
  if (text === prev.text) return prev;
  // 非前缀（换消息/编辑/历史跳转）：缝与冻结清零，本帧按全量渲染
  const base = text.startsWith(prev.text) ? prev : EMPTY;
  const split = splitTail(text, base.seam);
  if (split === undefined) {
    // 本帧弃增量：缝与冻结原样，尾段按整片渲染（下一帧再试解析）
    return { text, seam: base.seam, frozen: base.frozen, tail: text.slice(base.seam) };
  }
  const frozen =
    split.newlyFrozen.length > 0
      ? [
          ...base.frozen,
          ...split.newlyFrozen.map((block) =>
            markdownChildren(block.text, opts, String(block.key)),
          ),
        ]
      : base.frozen;
  return { text, seam: split.seam, frozen, tail: split.tail };
}

/** 流式臂组件：实例随行组件驻留（RowView memo 层已保证同行同实例），ref 持缝与冻结元素 */
export function IncrementalMarkdown(props: {
  text: string;
  t?: (key: string) => string;
}): ReactNode {
  const stateRef = useRef<StreamState>(EMPTY);
  const opts: MarkdownOptions = { streaming: true, t: props.t };
  const state = advance(stateRef.current, props.text, opts);
  stateRef.current = state;
  return createElement(
    "div",
    { className: "henira-md" },
    ...state.frozen,
    markdownChildren(state.tail, opts, "tail"),
  );
}

/** host.renderMarkdown 流式臂入口（外层容器与 settled 臂同形——.henira-md 挂点不变） */
export function streamingMarkdownNode(text: string, opts: MarkdownOptions): ReactNode {
  return createElement(
    "div",
    { className: "henira-md" },
    createElement(IncrementalMarkdown, { text, t: opts.t }),
  );
}
