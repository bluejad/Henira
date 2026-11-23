// 流式增量 markdown 渲染（host.renderMarkdown 流式臂的实现体，路由在 host.ts；settled 臂 =
// markdown.ts 单实例全文一次成型）。每帧成本 = O(全文) 字节前缀比对 + O(尾段) 解析渲染：
// 文本增长是前缀追加时，已完成顶层块的 React 元素按源偏移 key 只建一次、引用跨帧复用——
// React 命中同引用同 key 完全跳过重渲（块内 DOM 与用户选区原地不动）；只解析重渲尾段。
// 尾段保留最后 2 块不冻结：块级语法是行制的，追加只能重塑最后一块（段落→setext 标题、
// 围栏收口、表格续行）——留第二块做安全边际，冻结决策无需推理解析前沿。
// 非前缀输入（换消息/编辑/历史跳转）整体重置按全量渲染。切点 = 上一冻结块 end.offset
// （块间空行归入下一片：冻结片+尾片拼回 = 全文逐字不变）。流式全程不高亮（settle 后一次
// 成型）。语言切换（t 引用变化）= 冻结元素按原 key 重建，复制钮文案跟随语言包（行组件
// memo 比较 ctx.t 的刷新链路不被增量臂截断；重建是一次性子树重渲——components.pre 内联
// 函数类型标识随帧变，React 重挂而非就地更新，选区语义与 settle 同级，罕见事件可接受）。
// 已知取舍：跨冻结边界的链接引用定义流式期渲染为字面文本、settled 自愈；settle
// 时全文重渲一次（选区丢失一次）。正文渲染永远是官方实现（D-057：可插的是容器不是内容）。

import { createElement, Fragment, type ReactNode, useRef } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { type MarkdownOptions, markdownChildren } from "./markdown.js";
import {
  commitFrame,
  createRevealState,
  isIncrementalReveal,
  type RevealState,
} from "./streaming-reveal.js";

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
  /** 尾段块界（绝对偏移——逐词淡入排期的分块基准，E3） */
  tailBlocks: { start: number; end: number }[];
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
    return { seam, newlyFrozen: [], tail: slice, tailBlocks: blocks };
  }
  const newlyFrozen: FrozenBlock[] = [];
  let cursor = seam;
  // slice + for-of（freezeCount ≤ blocks.length，索引访问不可越界——无需防御分支）
  for (const block of blocks.slice(0, freezeCount)) {
    newlyFrozen.push({ key: block.start, text: text.slice(cursor, block.end) });
    cursor = block.end;
  }
  return {
    seam: cursor,
    newlyFrozen,
    tail: text.slice(cursor),
    tailBlocks: blocks.slice(freezeCount).map((b) => ({ start: b.start, end: b.end })),
  };
}

interface StreamState {
  /** 产生当前输出的全文（前缀校验基准；同文同 t 短路保幂等——StrictMode 双渲安全） */
  text: string;
  seam: number;
  /** 已冻结片源文本（key+text）——语言切换时按原 key 重建元素的原料 */
  blocks: FrozenBlock[];
  /** 已冻结块元素（引用跨帧复用 = React 跳过重渲的全部机制；t 变化按原 key 全量重建 =
   * 文案跟随语言包，一次性子树重渲） */
  frozen: ReactNode[];
  tail: string;
  /** 构建当前冻结元素所用 t（引用比对；opts.t 变化即重建，复制钮文案跟随语言包） */
  t?: (key: string) => string;
  /** 逐词淡入排期状态（E3；跨帧持久——EWMA/进度/时钟；重置帧整体换新=不动画） */
  reveal: RevealState;
}

const EMPTY: StreamState = {
  text: "",
  seam: 0,
  blocks: [],
  frozen: [],
  tail: "",
  reveal: createRevealState(),
};

function advance(prev: StreamState, text: string, opts: MarkdownOptions, now: number): StreamState {
  if (text === prev.text && prev.t === opts.t) return prev;
  // 非前缀（换消息/编辑/历史跳转）：缝与冻结清零，本帧按全量渲染
  const base = text.startsWith(prev.text) ? prev : EMPTY;
  const split = splitTail(text, base.seam);
  if (split === undefined) {
    // 本帧弃增量：缝与冻结原样（t 变则按原 key 重建元素），尾段按整片渲染（下一帧再试解析）
    return {
      text,
      seam: base.seam,
      blocks: base.blocks,
      frozen:
        opts.t === base.t
          ? base.frozen
          : base.blocks.map((block) => markdownChildren(block.text, opts, String(block.key))),
      tail: text.slice(base.seam),
      t: opts.t,
      reveal: base.reveal,
    };
  }
  const blocks = [...base.blocks, ...split.newlyFrozen];
  // 逐词淡入（E3）：真前缀小增量才排期——回填/重置/切会话整体换新状态（整段 settled 不动画）
  const reveal =
    base !== EMPTY && isIncrementalReveal(base.text, text)
      ? commitFrame(base.reveal, base.text, text, split.tailBlocks, now)
      : createRevealState();
  return {
    text,
    seam: split.seam,
    blocks,
    // t 未变：老元素引用原样保留（新冻结只追加）；t 变了：全量按原 key 重建（一次性成本）
    frozen:
      opts.t === base.t
        ? [
            ...base.frozen,
            ...split.newlyFrozen.map((block) =>
              markdownChildren(block.text, opts, String(block.key)),
            ),
          ]
        : blocks.map((block) => markdownChildren(block.text, opts, String(block.key))),
    tail: split.tail,
    t: opts.t,
    reveal,
  };
}

/** 流式臂组件：实例随行组件驻留（RowView memo 层已保证同行同实例），ref 持缝与冻结元素。
 * 返回 Fragment 平铺块——.henira-md 容器由 streamingMarkdownNode 供，两臂 DOM 同形
 * （审查 P2-1：双层嵌套会让 .henira-md 直接子选择器语义漂移）；直用场景调用方自备容器。
 * 尾臂带逐词淡入上下文（E3）——冻结臂不带（整段 settled）。 */
export function IncrementalMarkdown(props: {
  text: string;
  t?: (key: string) => string;
  onImageClick?: (image: { src: string; alt?: string }) => void;
}): ReactNode {
  const stateRef = useRef<StreamState>(EMPTY);
  const opts: MarkdownOptions = {
    streaming: true,
    t: props.t,
    ...(props.onImageClick !== undefined ? { onImageClick: props.onImageClick } : {}),
  };
  const state = advance(stateRef.current, props.text, opts, performance.now());
  stateRef.current = state;
  const tailOpts: MarkdownOptions = {
    streaming: true,
    t: props.t,
    ...(props.onImageClick !== undefined ? { onImageClick: props.onImageClick } : {}),
    reveal: { state: state.reveal, seam: state.seam },
  };
  return createElement(
    Fragment,
    null,
    ...state.frozen,
    markdownChildren(state.tail, tailOpts, "tail"),
  );
}

/** host.renderMarkdown 流式臂入口（容器 .henira-md 与 settled 臂同形） */
export function streamingMarkdownNode(text: string, opts: MarkdownOptions): ReactNode {
  return createElement(
    "div",
    { className: "henira-md" },
    createElement(IncrementalMarkdown, {
      text,
      t: opts.t,
      ...(opts.onImageClick !== undefined ? { onImageClick: opts.onImageClick } : {}),
    }),
  );
}
