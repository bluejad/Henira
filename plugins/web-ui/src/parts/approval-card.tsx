// 官方件：审批卡。pending 态 = 输入区上方接管 dock 卡（dsh ApprovalPanel / ZCode V4InteractionDialogs
// 同位行为层参照：审批接管 composer 而非对话流内嵌；Enter=允许、Esc=拒绝，composer 提交让位）。
// settled 态 = 对话流内紧凑结果行（决策留痕，行模型投影忠实呈现）。收答经 client.settleApproval
// ——幂等先答者赢（另一窗口已答时 applied=false）；settled 状态经行流同步（rowId p:<requestId>）。

import type { ApprovalRow } from "@henira/protocol";
import { useEffect, useState } from "react";
import type { WebPartContext } from "../types.js";
import { CheckGlyph, XGlyph } from "./icons.js";

type Decision = "allowed-once" | "rejected";

export function ApprovalCard({
  row,
  ctx,
}: {
  row: ApprovalRow;
  ctx: WebPartContext;
}): React.ReactNode {
  const [settling, setSettling] = useState(false);
  const pending = row.status === "pending" && !settling;

  const decide = (decision: Decision): void => {
    if (ctx.sessionId === null) return;
    setSettling(true);
    void ctx.client
      .settleApproval(ctx.sessionId, row.requestId, decision)
      .catch(() => setSettling(false)); // 网络失败回到待处理（重试语义）
  };

  // 键盘直选（dsh 行为层参照）：Enter=允许、Esc=拒绝；IME 组合中不抢（isComposing 防抖）
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        decide("allowed-once");
      } else if (e.key === "Escape") {
        e.preventDefault();
        decide("rejected");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div
      role="dialog"
      aria-label={ctx.t("approval.title")}
      style={{
        border: "1px solid var(--henira-border-strong)",
        borderLeft: "3px solid var(--henira-warn-text)",
        borderRadius: "var(--henira-radius)",
        background: "var(--henira-warn-bg)",
        padding: "var(--henira-space-3)",
        marginBottom: "var(--henira-space-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--henira-space-2)",
          marginBottom:
            row.argsSummary !== undefined || pending ? "var(--henira-space-2)" : undefined,
        }}
      >
        <strong>{ctx.t("approval.title")}</strong>
        <span
          style={{
            fontSize: "var(--henira-fs-sm)",
            borderRadius: "9999px",
            padding: "1px 8px",
            background: pending ? "var(--henira-warn-text)" : "var(--henira-border)",
            color: pending ? "var(--henira-warn-bg)" : "var(--henira-text-muted)",
          }}
        >
          {pending ? ctx.t("approval.pending") : ctx.t("approval.settled")}
        </span>
        <span
          className="henira-mono"
          style={{ fontSize: "var(--henira-fs-sm)", color: "var(--henira-text-muted)" }}
        >
          {row.toolName}
        </span>
      </div>
      {row.argsSummary !== undefined ? (
        <div
          className="henira-mono"
          style={{
            fontSize: "var(--henira-fs-sm)",
            color: "var(--henira-text-muted)",
            marginBottom: pending ? "var(--henira-space-2)" : 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {row.argsSummary}
        </div>
      ) : null}
      {pending ? (
        <div style={{ display: "flex", gap: "var(--henira-space-2)" }}>
          <button type="button" className="henira-primary" onClick={() => decide("allowed-once")}>
            {ctx.t("approval.allow")}
          </button>
          <button type="button" onClick={() => decide("rejected")}>
            {ctx.t("approval.deny")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** settled 紧凑结果行（对话流内留痕：图标 + 标题 + 工具名 + 决策原文） */
export function ApprovalSettledRow({
  row,
  ctx,
}: {
  row: ApprovalRow;
  ctx: WebPartContext;
}): React.ReactNode {
  const allowed = row.decision === "allowed-once";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--henira-space-2)",
        margin: "var(--henira-space-2) 0",
        padding: "2px 4px",
        color: "var(--henira-text-muted)",
        fontSize: "var(--henira-fs-sm)",
      }}
    >
      {allowed ? (
        <CheckGlyph size={14} color="var(--henira-ok-text)" />
      ) : (
        <XGlyph size={14} color="var(--henira-danger-text)" />
      )}
      <span>{ctx.t("approval.title")}</span>
      <span className="henira-mono">{row.toolName}</span>
      {row.decision !== undefined ? (
        <span className="henira-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
          {row.decision}
        </span>
      ) : null}
    </div>
  );
}
