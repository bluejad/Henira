// 官方件：对话面板（槽 conversation）。哑渲染器——行来自 store（server 投影器是唯一组装处），
// 件只做行→ReactNode 的纯呈现。流式文本透明度浮现（CSS .henira-streaming）。
// 行级挂载点（D-057）：tool.call.view.<工具名>（keyed，顶替官方工具卡）/ conversation.images
// （assistant 行尾画廊位，缺席默认 = markdown 内联图）/ turn.tail（回合尾追加位，官方无默认件）。
// 行内状态渲染（M4 批 A）：usage 徽章（步级用量）/ interrupted 徽章（中断可见）/
// 截断徽章 + 落盘路径 / reasoning 折叠 / 输出复制按钮。容器样式在 tokens.css（.henira-conversation）。

import type { AssistantRow, ErrorRow, Row, ToolRow, UserRow } from "@henira/protocol";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ToolCallView, WebPart, WebPartContext } from "../types.js";
import { ApprovalCard } from "./approval-card.js";
import { CheckGlyph, SpinnerGlyph, XGlyph } from "./icons.js";

export const Conversation: WebPart = (ctx: WebPartContext) => {
  // useSyncExternalStore：store 引用稳定（未变化返回同一对象），快照整体替换语义
  const snapshot = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId),
    () => ctx.store.getSession(ctx.sessionId),
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const rows = snapshot.rows;
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows.length 是渲染层的变化信号而非 effect 输入（有意豁免）
  useEffect(() => {
    // 新行到达滚到底（流式时由最后行长度变化触发——测高稳定因为 DOM 文本完整）；
    // scrollIntoView 可选调用守卫（jsdom 等无滚动实现的环境直接跳过）。
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [rows.length]);
  const tailParts = ctx.slots.get("turn.tail") ?? [];

  return (
    <div className="henira-conversation">
      {rows.length === 0 ? (
        <p style={{ color: "var(--henira-text-muted)" }}>{ctx.t("conversation.empty")}</p>
      ) : (
        rows.map((row) => <RowView key={row.rowId} row={row} ctx={ctx} />)
      )}
      {snapshot.state.busy ? (
        <p style={{ color: "var(--henira-text-muted)", fontStyle: "italic" }}>
          {ctx.t("conversation.thinking")}
        </p>
      ) : null}
      {tailParts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 追加位件为无状态纯呈现函数（注册序即渲染序、卸载即整表移除）——索引键无重排歧义
        <Fragment key={i}>{(part as WebPart)(ctx)}</Fragment>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

function RowView({ row, ctx }: { row: Row; ctx: WebPartContext }): React.ReactNode {
  switch (row.kind) {
    case "user":
      return <UserView row={row} ctx={ctx} />;
    case "assistant":
      return <AssistantView row={row} ctx={ctx} />;
    case "tool":
      return <ToolRowView row={row} ctx={ctx} />;
    case "approval":
      return <ApprovalCard row={row} ctx={ctx} />;
    case "error":
      return <ErrorView row={row} ctx={ctx} />;
  }
}

/** 行级印章胶囊（状态语义色——语义粉彩只做印章不做装饰） */
function Pill({
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
      }}
    >
      {children}
    </span>
  );
}

function UserView({ row }: { row: UserRow; ctx?: WebPartContext }) {
  return (
    <div
      style={{
        background: "var(--henira-surface)",
        border: "1px solid var(--henira-border)",
        borderRadius: "var(--henira-radius)",
        padding: "var(--henira-space-2) var(--henira-space-3)",
        margin: "var(--henira-space-3) 0",
        whiteSpace: "pre-wrap",
      }}
    >
      {row.source === "steer" || row.source === "veto" ? (
        <Pill bg="var(--henira-info-bg)" color="var(--henira-info-text)">
          {row.source}
        </Pill>
      ) : null}
      {row.text}
    </div>
  );
}

function AssistantView({ row, ctx }: { row: AssistantRow; ctx: WebPartContext }) {
  const streaming = row.streaming;
  const gallery = ctx.slots.get("conversation.images")?.[0] as WebPart | undefined;
  return (
    <div style={{ margin: "var(--henira-space-3) 0" }}>
      {row.reasoning !== undefined && row.reasoning !== "" ? (
        <details
          style={{
            marginBottom: "var(--henira-space-2)",
            borderLeft: "2px solid var(--henira-border)",
            paddingLeft: "10px",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              color: "var(--henira-text-muted)",
              fontSize: "var(--henira-fs-sm)",
              userSelect: "none",
            }}
          >
            {ctx.t("row.reasoning")}
          </summary>
          <div
            style={{
              color: "var(--henira-text-muted)",
              fontSize: "var(--henira-fs-md)",
              whiteSpace: "pre-wrap",
              marginTop: "var(--henira-space-1)",
            }}
          >
            {row.reasoning}
          </div>
        </details>
      ) : null}
      <div className={streaming ? "henira-streaming" : undefined}>
        {ctx.host.renderMarkdown(row.text, { streaming })}
      </div>
      {row.interrupted === true ? (
        <div style={{ marginTop: "var(--henira-space-2)" }}>
          <Pill bg="var(--henira-warn-bg)" color="var(--henira-warn-text)">
            {ctx.t("row.interrupted")}
          </Pill>
        </div>
      ) : null}
      {!streaming && row.usage !== undefined ? (
        <div
          className="henira-mono"
          style={{ marginTop: "var(--henira-space-1)", fontSize: "var(--henira-fs-sm)" }}
        >
          <span style={{ color: "var(--henira-text-muted)" }} title={ctx.t("row.output")}>
            {row.usage.inputTokens ?? 0}↑ {row.usage.outputTokens ?? 0}↓
          </span>
        </div>
      ) : null}
      {gallery !== undefined ? gallery(ctx) : null}
    </div>
  );
}

/** 工具行：keyed 槽 tool.call.view.<工具名> 顶替官方工具卡（D-057；官方默认=未被顶替时生效） */
function ToolRowView({ row, ctx }: { row: ToolRow; ctx: WebPartContext }): React.ReactNode {
  const view = ctx.slots.get(`tool.call.view.${row.name}`)?.[0] as ToolCallView | undefined;
  return view !== undefined ? view({ ctx, row }) : <ToolView row={row} ctx={ctx} />;
}

/** 复制按钮（common.copy / common.copied）。t 可选注入（markdown 代码块头部条复用——
 * 纯渲染层不持有字典，缺省英文兜底）；无 ctx 依赖，包根出口供插件/宿主共用。 */
export function CopyButton({
  text,
  t,
  className,
}: {
  text: string;
  t?: (key: string) => string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1500);
          })
          .catch(() => {});
      }}
      style={{
        fontSize: "var(--henira-fs-sm)",
        padding: "0 6px",
      }}
    >
      {copied ? (t?.("common.copied") ?? "Copied") : (t?.("common.copy") ?? "Copy")}
    </button>
  );
}

function ToolView({ row, ctx }: { row: ToolRow; ctx: WebPartContext }) {
  const isError = row.status === "error";
  const statusColor =
    row.status === "running"
      ? "var(--henira-info-text)"
      : isError
        ? "var(--henira-danger-text)"
        : "var(--henira-ok-text)";
  return (
    <div
      style={{
        border: `1px solid ${isError ? "var(--henira-danger-bg)" : "var(--henira-border)"}`,
        borderRadius: "var(--henira-radius)",
        margin: "var(--henira-space-2) 0",
        padding: "var(--henira-space-2) var(--henira-space-3)",
        background: "var(--henira-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--henira-space-2)",
          flexWrap: "wrap",
        }}
      >
        {row.status === "running" ? (
          <SpinnerGlyph size={14} color={statusColor} />
        ) : isError ? (
          <XGlyph size={14} color={statusColor} />
        ) : (
          <CheckGlyph size={14} color={statusColor} />
        )}
        <span className="henira-mono" style={{ color: statusColor }}>
          {row.name}
        </span>
        <span
          className="henira-mono"
          title={row.callId}
          style={{ color: "var(--henira-text-muted)", fontSize: "var(--henira-fs-sm)" }}
        >
          #{row.callId}
        </span>
        {row.status === "done" && row.output !== undefined ? (
          <span style={{ color: "var(--henira-text-muted)", fontSize: "var(--henira-fs-sm)" }}>
            {row.output.durationMs}ms
          </span>
        ) : null}
        {row.output?.truncated !== undefined ? (
          <Pill
            bg="var(--henira-warn-bg)"
            color="var(--henira-warn-text)"
            title={row.output.truncated.path}
          >
            {ctx.t("row.truncated")}
          </Pill>
        ) : null}
      </div>
      <pre
        className="henira-mono"
        style={{
          margin: "var(--henira-space-2) 0 0",
          color: "var(--henira-text-muted)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontSize: "var(--henira-fs-md)",
        }}
      >
        {row.input}
      </pre>
      {row.output !== undefined ? (
        <details style={{ marginTop: "var(--henira-space-2)" }}>
          <summary
            style={{
              cursor: "pointer",
              color: isError ? "var(--henira-danger-text)" : "var(--henira-text-muted)",
              fontSize: "var(--henira-fs-sm)",
              userSelect: "none",
            }}
          >
            {isError ? ctx.t("error.title") : ctx.t("row.output")}
          </summary>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: "var(--henira-space-1)",
              marginLeft: "var(--henira-space-2)",
            }}
          >
            <CopyButton text={row.output.content} t={ctx.t} />
          </div>
          <pre
            className="henira-mono"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: "var(--henira-space-1) 0 0",
              fontSize: "var(--henira-fs-md)",
            }}
          >
            {row.output.content}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function ErrorView({ row, ctx }: { row: ErrorRow; ctx: WebPartContext }) {
  return (
    <div
      role="alert"
      style={{
        background: "var(--henira-danger-bg)",
        color: "var(--henira-danger-text)",
        borderRadius: "var(--henira-radius)",
        padding: "var(--henira-space-2) var(--henira-space-3)",
        margin: "var(--henira-space-3) 0",
      }}
    >
      <strong>{ctx.t("error.title")}</strong>
      {row.code !== undefined ? (
        <span
          className="henira-mono"
          style={{ marginLeft: "var(--henira-space-2)", fontSize: "var(--henira-fs-md)" }}
        >
          {row.code}
        </span>
      ) : null}
      <span
        className="henira-mono"
        style={{ marginLeft: "var(--henira-space-2)", fontSize: "var(--henira-fs-md)" }}
      >
        {row.message}
      </span>
    </div>
  );
}
