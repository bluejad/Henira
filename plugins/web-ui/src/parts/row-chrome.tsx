// 行 chrome 原语（R178）：行本身无边框无底色，图标 + 类别词 + 摘要 + 状态；
// 结果才用卡片（.henira-tool-card），hover 才提亮并显箭头。静态行（read/search）不是按钮。
// 官方件与 keyed 顶替件共用同一套原语（D-057 观感协调）；样式全走 CSS 类。

import { Fragment, useEffect, useState } from "react";
import { CaretGlyph } from "./icons.js";
import { useToolPreview } from "./tool-preview.js";

export type DisclosureRowProps = {
  /** 前置状态图标槽（16px 语义色 glyph——状态语义由调用方定） */
  icon?: React.ReactNode;
  /** 标题词（工具名/类别词；busy=true 时走扫光） */
  title: React.ReactNode;
  /** busy 态标题扫光（运行中） */
  busy?: boolean;
  /** 标题色（错误语义色；正常态不传——层级由 CSS 决定） */
  tone?: string;
  /** 元信息小字（工具名等弱信息；R171 起 callId 不进此槽——走 rowTitle 悬停） */
  meta?: React.ReactNode;
  /** 行尾摘要（单行省略；截断徽章等短件） */
  summary?: React.ReactNode;
  /** 行尾独立操作（不嵌套在触发按钮内——文件 chip 等可点击件挂这里） */
  actions?: React.ReactNode;
  /** 行级悬停提示（排障通道：wire 名 + callId 等——不占版面） */
  rowTitle?: string;
  /** 无展开体时隐藏箭头（纯状态行） */
  expandable?: boolean;
  /** 初始展开（error 行默认展开——错误必须被看见，dsh/参照实现同行为） */
  initialOpen?: boolean;
  /** 受控展开（可选；缺省内部自管） */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children?: React.ReactNode;
};

/** 扁平折叠行（旧出口，保持插件兼容）：图标+标题+摘要单行，展开体挂 children。
 * 箭头 hover 才显形（静态安静、悬停发声）；展开态箭头转 90°。 */
export function DisclosureRow(props: DisclosureRowProps): React.ReactNode {
  const [internalOpen, setInternalOpen] = useState(props.initialOpen ?? false);
  const open = props.open ?? internalOpen;
  const toggle = (): void => {
    if (props.expandable === false) return;
    const next = !open;
    setInternalOpen(next);
    props.onToggle?.(next);
  };
  const hasBody = props.children !== undefined && props.children !== null;
  const expandable = (props.expandable ?? true) && hasBody;
  return (
    <div className="henira-row">
      <div className="henira-row-head">
        <button
          type="button"
          className="henira-row-trigger"
          onClick={toggle}
          title={props.rowTitle}
          aria-expanded={expandable ? open : undefined}
        >
          {props.icon !== undefined ? <span className="henira-row-icon">{props.icon}</span> : null}
          <span
            className={`henira-row-title${props.busy === true ? " henira-sweep" : ""}`}
            style={
              props.busy === true
                ? undefined
                : props.tone !== undefined
                  ? { color: props.tone }
                  : undefined
            }
          >
            {props.title}
          </span>
          {props.meta !== undefined ? <span className="henira-row-meta">{props.meta}</span> : null}
          <span className="henira-row-summary-wrap">{props.summary}</span>
          {expandable ? (
            <span className={`henira-row-caret${open ? " is-open" : ""}`}>
              <CaretGlyph size={16} />
            </span>
          ) : null}
        </button>
        {props.actions !== undefined ? (
          <span className="henira-row-actions">{props.actions}</span>
        ) : null}
      </div>
      {expandable && open ? <div className="henira-row-body">{props.children}</div> : null}
    </div>
  );
}

/** 工具行壳（R178 主原语）：类别词弱色、主信息可点击件、失败才显示状态词；
 *  read/search 这类 canToggle=false 的行渲染成静态 div（无按钮语义/无箭头/no-op 点击）。
 *  展开状态按 persistKey 记忆（虚拟列表滚走再回来不丢）。 */
const openState = new Map<string, boolean>();

export interface ToolRowProps {
  icon: React.ReactNode;
  /** 类别词：正在读取 / 已读取 / 已执行 / MCP …（运行态 busy=true 扫光） */
  kindLabel: React.ReactNode;
  /** 类别补充（MCP server 等弱信息） */
  kindDetail?: React.ReactNode;
  /** 主信息（read 的文件名、edit 的文件 chip、search 的整句…） */
  primary?: React.ReactNode;
  /** 次要信息（execute 的命令等；单行省略） */
  secondary?: React.ReactNode;
  /** diff 统计（+N -N） */
  diff?: React.ReactNode;
  /** 失败状态词（仅失败/停止时传；成功不显示状态词） */
  status?: React.ReactNode;
  /** 状态词悬停原因（失败输出首行等） */
  statusTitle?: string;
  /** 行级悬停提示（wire 名/callId 等排障信息） */
  rowTitle?: string;
  /** 运行态类别词扫光 */
  busy?: boolean;
  /** 缺省 = 有 children 才可展开；false = 永远静态 */
  canToggle?: boolean;
  initialOpen?: boolean;
  /** 展开状态记忆键（虚拟列表重挂不丢；建议 sessionId:callId） */
  persistKey?: string;
  /** 行尾独立操作（不嵌套在触发区里——插件扩展位） */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function ToolRow(props: ToolRowProps): React.ReactNode {
  const preview = useToolPreview();
  const hasBody = props.children !== undefined && props.children !== null;
  const expandable = !preview && props.canToggle !== false && hasBody;
  const [internalOpen, setInternalOpen] = useState(() =>
    props.persistKey !== undefined
      ? (openState.get(props.persistKey) ?? props.initialOpen ?? false)
      : (props.initialOpen ?? false),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: persistKey 是重挂同步信号
  useEffect(() => {
    if (props.persistKey === undefined) return;
    setInternalOpen(openState.get(props.persistKey) ?? props.initialOpen ?? false);
  }, [props.persistKey]);
  const open = expandable && internalOpen;
  const toggle = (): void => {
    if (!expandable) return;
    const next = !open;
    if (props.persistKey !== undefined) openState.set(props.persistKey, next);
    setInternalOpen(next);
  };
  const summary = (
    <>
      <span className="henira-row-icon">{props.icon}</span>
      <span className={`henira-row-kind${props.busy === true ? " henira-sweep" : ""}`}>
        {props.kindLabel}
      </span>
      {props.kindDetail !== undefined ? (
        <span className="henira-row-kind-detail">{props.kindDetail}</span>
      ) : null}
      {props.primary !== undefined ? (
        <span className="henira-row-primary">{props.primary}</span>
      ) : null}
      {props.secondary !== undefined ? (
        <span
          className="henira-row-secondary"
          title={typeof props.secondary === "string" ? props.secondary : undefined}
        >
          {props.secondary}
        </span>
      ) : null}
      {props.diff !== undefined ? <span className="henira-row-diff">{props.diff}</span> : null}
      {props.status !== undefined ? (
        <span className="henira-row-status is-error" title={props.statusTitle}>
          {props.status}
        </span>
      ) : null}
      {expandable ? (
        <span className={`henira-row-caret${open ? " is-open" : ""}`}>
          <CaretGlyph size={16} />
        </span>
      ) : null}
    </>
  );
  return (
    <div className="henira-row">
      <div className="henira-row-head">
        {expandable ? (
          // biome-ignore lint/a11y/useSemanticElements: 摘要里嵌文件链接等交互件——满宽 button 会形成嵌套按钮；div+role 为 WAI-ARIA 允许形态
          <div
            role="button"
            tabIndex={0}
            className="henira-row-trigger"
            aria-expanded={open}
            title={props.rowTitle}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              toggle();
            }}
          >
            {summary}
          </div>
        ) : (
          <div className="henira-row-trigger is-static" title={props.rowTitle}>
            {summary}
          </div>
        )}
        {props.actions !== undefined ? (
          <span className="henira-row-actions">{props.actions}</span>
        ) : null}
      </div>
      {expandable && open ? <div className="henira-row-body">{props.children}</div> : null}
    </div>
  );
}

/** 行级印章胶囊（状态语义色——语义粉彩只做印章不做装饰）。 */
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

/** 展开体分区（结果卡统一语言：卡片 + 分区 + 标签小字 + 分区滚动上限）。 */
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
    <div className="henira-detail-pane">
      {sections.map((section, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 分区是无状态纯呈现（声明序即渲染序，无重排歧义）
        <Fragment key={i}>
          {i > 0 ? <div className="henira-detail-sep" /> : null}
          <div className="henira-detail-section">
            <div
              className="henira-detail-label"
              style={section.tone !== undefined ? { color: section.tone } : undefined}
            >
              <span>{section.label}</span>
              {section.actions}
            </div>
            <div
              className="henira-detail-body"
              style={
                section.maxHeight !== undefined
                  ? { maxHeight: section.maxHeight, overflowY: "auto" }
                  : { maxHeight: undefined, overflowY: undefined }
              }
            >
              {section.body}
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
