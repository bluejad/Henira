// 官方件：对话面板（槽 conversation）。哑渲染器——行来自 store（server 投影器是唯一组装处），
// 件只做行→ReactNode 的纯呈现。流式文本透明度浮现（CSS .henira-streaming）。

import type { AssistantRow, ErrorRow, Row, ToolRow, UserRow } from "@henira/protocol";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { WebPart, WebPartContext } from "../types.js";
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
    // scrollIntoView 守卫（jsdom 等无滚动实现的环境直接跳过）。
  }, [rows.length]);

  return (
    <div
      className="henira-conversation"
      style={{ flex: 1, overflowY: "auto", padding: "24px", boxSizing: "border-box" }}
    >
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
      return <ToolView row={row} ctx={ctx} />;
    case "approval":
      return <ApprovalCard row={row} ctx={ctx} />;
    case "error":
      return <ErrorView row={row} ctx={ctx} />;
  }
}

function UserView({ row }: { row: UserRow; ctx: WebPartContext }) {
  return (
    <div
      style={{
        background: "var(--henira-surface)",
        border: "1px solid var(--henira-border)",
        borderRadius: "var(--henira-radius)",
        padding: "10px 14px",
        margin: "12px 0",
        whiteSpace: "pre-wrap",
      }}
    >
      {row.source === "steer" || row.source === "veto" ? (
        <span
          style={{
            background: "var(--henira-info-bg)",
            color: "var(--henira-info-text)",
            borderRadius: "9999px",
            fontSize: "11px",
            padding: "1px 8px",
            marginRight: "8px",
          }}
        >
          {row.source}
        </span>
      ) : null}
      {row.text}
    </div>
  );
}

function AssistantView({ row, ctx }: { row: AssistantRow; ctx: WebPartContext }) {
  const streaming = row.streaming;
  return (
    <div style={{ margin: "12px 0" }}>
      {row.reasoning !== undefined && row.reasoning !== "" ? (
        <p
          style={{
            color: "var(--henira-text-muted)",
            fontSize: "13px",
            borderLeft: "2px solid var(--henira-border)",
            paddingLeft: "10px",
            whiteSpace: "pre-wrap",
          }}
        >
          {row.reasoning}
        </p>
      ) : null}
      <div className={streaming ? "henira-streaming" : undefined}>
        {ctx.host.renderMarkdown(row.text)}
      </div>
    </div>
  );
}

function ToolView({ row, ctx }: { row: ToolRow; ctx: WebPartContext }) {
  const statusColor =
    row.status === "running"
      ? "var(--henira-info-text)"
      : row.status === "error"
        ? "var(--henira-danger-text)"
        : "var(--henira-ok-text)";
  return (
    <div
      style={{
        border: "1px solid var(--henira-border)",
        borderRadius: "var(--henira-radius)",
        margin: "8px 0",
        padding: "8px 12px",
        background: "var(--henira-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {row.status === "running" ? (
          <SpinnerGlyph size={14} color={statusColor} />
        ) : row.status === "error" ? (
          <XGlyph size={14} color={statusColor} />
        ) : (
          <CheckGlyph size={14} color={statusColor} />
        )}
        <span className="henira-mono" style={{ color: statusColor }}>
          {row.name}
        </span>
        {row.status === "done" && row.output !== undefined ? (
          <span style={{ color: "var(--henira-text-muted)", fontSize: "12px" }}>
            {row.output.durationMs}ms
          </span>
        ) : null}
      </div>
      <pre
        className="henira-mono"
        style={{
          margin: "6px 0 0",
          color: "var(--henira-text-muted)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {row.input}
      </pre>
      {row.output !== undefined ? (
        <details style={{ marginTop: "6px" }}>
          <summary
            style={{ cursor: "pointer", color: "var(--henira-text-muted)", fontSize: "12px" }}
          >
            {row.output.isError ? ctx.t("error.title") : ctx.t("common.copy")}
          </summary>
          <pre
            className="henira-mono"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "6px 0 0" }}
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
        padding: "10px 14px",
        margin: "12px 0",
      }}
    >
      <strong>{ctx.t("error.title")}</strong>
      <span className="henira-mono" style={{ marginLeft: "8px", fontSize: "13px" }}>
        {row.message}
      </span>
    </div>
  );
}
