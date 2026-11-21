// 行 chrome 原语（对话流扁平折叠行，M4 批 A 视觉二轮）。两家行为层参照的机制启示
// （dsh "容器归树、视图归槽"）：官方默认件拆成「行 chrome（强约束）+ 卡面原语（可选组装）」
// 两层，官方件自己当"插件视角"组装同一套原语——顶替件用同一原语即获得同款行观感与交互
// （展开/hover 箭头/运行态扫光），无需继承容器 CSS。包根出口（index.ts）供 keyed 顶替件复用。
// 样式语义全走 tokens.css 变量；动效尊重 prefers-reduced-motion（tokens.css 全局禁）。

import { Fragment, useState } from "react";
import { CaretGlyph } from "./icons.js";

export type DisclosureRowProps = {
  /** 前置状态图标槽（16px 语义色 glyph——状态语义由调用方定） */
  icon?: React.ReactNode;
  /** 标题词（工具名/类别词；busy=true 时走扫光） */
  title: React.ReactNode;
  /** busy 态标题扫光（运行中） */
  busy?: boolean;
  /** 标题色（done/info/error 语义色；busy 时忽略——扫光接管） */
  tone?: string;
  /** 元信息小字（callId / 耗时等，hover 或常态灰显） */
  meta?: React.ReactNode;
  /** 行尾摘要（单行省略；截断徽章等短件） */
  summary?: React.ReactNode;
  /** 行级悬停提示（排障通道：wire 名 + callId 等——不占版面，五家 0/5 把 call id 渲染为可见文本） */
  rowTitle?: string;
  /** 无展开体时隐藏箭头（纯状态行） */
  expandable?: boolean;
  /** 初始展开（error 行默认展开——错误必须被看见，dsh/ZCode 同行为） */
  initialOpen?: boolean;
  /** 受控展开（可选；缺省内部自管） */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children?: React.ReactNode;
};

/** 扁平折叠行：图标+标题+元信息+摘要单行，展开体挂 children（pt-2 缩进）。
 * 箭头 hover 才显形（静态安静、悬停发声）；展开态箭头转 90°。 */
export function DisclosureRow(props: DisclosureRowProps): React.ReactNode {
  const [internalOpen, setInternalOpen] = useState(props.initialOpen ?? false);
  const open = props.open ?? internalOpen;
  const toggle = (): void => {
    if (props.expandable === false) return;
    const next = !open;
    if (props.onToggle !== undefined) props.onToggle(next);
    else setInternalOpen(next);
  };
  const hasBody = props.children !== undefined && props.children !== null;
  const expandable = (props.expandable ?? true) && hasBody;
  return (
    <div style={{ margin: "var(--henira-space-2) 0" }}>
      <button
        type="button"
        onClick={toggle}
        title={props.rowTitle}
        aria-expanded={expandable ? open : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--henira-space-2)",
          width: "100%",
          border: "none",
          background: "none",
          padding: "2px 4px",
          borderRadius: "var(--henira-radius)",
          textAlign: "left",
          cursor: expandable ? "pointer" : "default",
        }}
      >
        {props.icon !== undefined ? (
          <span style={{ display: "inline-flex" }}>{props.icon}</span>
        ) : null}
        <span
          className={props.busy === true ? "henira-sweep" : undefined}
          style={
            props.busy === true
              ? { fontFamily: "var(--henira-mono)", fontSize: "var(--henira-fs-base)" }
              : {
                  color: props.tone,
                  fontFamily: "var(--henira-mono)",
                  fontSize: "var(--henira-fs-base)",
                }
          }
        >
          {props.title}
        </span>
        {props.meta !== undefined ? (
          <span
            style={{ color: "var(--henira-text-muted)", fontSize: "var(--henira-fs-sm)" }}
            className="henira-mono"
          >
            {props.meta}
          </span>
        ) : null}
        <span
          className="henira-fade-right"
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--henira-text-muted)",
            fontSize: "var(--henira-fs-sm)",
            display: "flex",
            alignItems: "center",
            gap: "var(--henira-space-2)",
          }}
        >
          {props.summary}
        </span>
        {expandable ? (
          <span
            className="henira-row-caret"
            style={{
              display: "inline-flex",
              color: "var(--henira-text-muted)",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.12s ease",
            }}
          >
            <CaretGlyph size={12} />
          </span>
        ) : null}
      </button>
      {expandable && open ? (
        <div style={{ padding: "var(--henira-space-2) 0 0 var(--henira-space-4)" }}>
          {props.children}
        </div>
      ) : null}
    </div>
  );
}

/** 行级印章胶囊（状态语义色——语义粉彩只做印章不做装饰）。原 conversation 内私有件，
 * per-tool 卡（E5）共用后提升到此。 */
export function Pill({
  bg,
  color,
  title,
  children,
}: {
  bg: string;
  color: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      style={{
        background: bg,
        color,
        borderRadius: "9999px",
        fontSize: "var(--henira-fs-sm)",
        padding: "1px 8px",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

/** 展开体分区（dsh ioCard 行为层参照：hairline 卡 + 标签小字 + 分区滚动上限）。
 * errors/tone 由调用方传色。 */
export function DetailPane({
  sections,
}: {
  sections: {
    label: React.ReactNode;
    tone?: string;
    actions?: React.ReactNode;
    /** 内容最大高度（px；超出滚动） */
    maxHeight?: number;
    body: React.ReactNode;
  }[];
}): React.ReactNode {
  return (
    <div
      style={{
        border: "1px solid var(--henira-border)",
        borderRadius: "var(--henira-radius)",
        background: "var(--henira-surface)",
        padding: "var(--henira-space-2) var(--henira-space-3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--henira-space-2)",
      }}
    >
      {sections.map((section, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 分区是无状态纯呈现（声明序即渲染序，无重排歧义）
        <Fragment key={i}>
          {i > 0 ? <div style={{ borderTop: "1px solid var(--henira-border)" }} /> : null}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--henira-space-2)",
              color: section.tone ?? "var(--henira-text-muted)",
              fontSize: "var(--henira-fs-sm)",
            }}
          >
            <span style={{ fontWeight: 500 }}>{section.label}</span>
            {section.actions}
          </div>
          <div
            style={{
              maxHeight: section.maxHeight,
              overflowY: section.maxHeight !== undefined ? "auto" : undefined,
            }}
          >
            {section.body}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
