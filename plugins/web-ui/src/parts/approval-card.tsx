// 官方件：审批卡（内联于对话流的 approval 行）。收答经 client.settleApproval——幂等先答者赢
// （另一窗口已答时 applied=false，卡片显示已处理态）。多客户端语义：settled 状态经行流同步。

import type { ApprovalRow } from "@henira/protocol";
import { useState } from "react";
import type { WebPartContext } from "../types.js";

export function ApprovalCard({
  row,
  ctx,
}: {
  row: ApprovalRow;
  ctx: WebPartContext;
}): React.ReactNode {
  const [settling, setSettling] = useState(false);
  const pending = row.status === "pending" && !settling;

  const decide = (decision: "allowed-once" | "rejected"): void => {
    if (ctx.sessionId === null) return;
    setSettling(true);
    void ctx.client
      .settleApproval(ctx.sessionId, row.requestId, decision)
      .catch(() => setSettling(false)); // 网络失败回到待处理（重试语义）
  };

  return (
    <div
      role="dialog"
      aria-label={ctx.t("approval.title")}
      style={{
        border: `1px solid ${pending ? "var(--henira-border-strong)" : "var(--henira-border)"}`,
        borderRadius: "var(--henira-radius)",
        background: pending ? "var(--henira-warn-bg)" : "var(--henira-surface)",
        padding: "var(--henira-space-3)",
        margin: "var(--henira-space-3) 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--henira-space-2)",
          marginBottom: "var(--henira-space-2)",
        }}
      >
        <strong>{ctx.t("approval.title")}</strong>
        <span
          style={{
            fontSize: "11px",
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
          style={{ fontSize: "12px", color: "var(--henira-text-muted)" }}
        >
          {row.toolName}
        </span>
      </div>
      {row.argsSummary !== undefined ? (
        <div
          className="henira-mono"
          style={{ fontSize: "12px", color: "var(--henira-text-muted)", marginBottom: "8px" }}
        >
          {row.argsSummary}
        </div>
      ) : null}
      {pending ? (
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="henira-primary" onClick={() => decide("allowed-once")}>
            {ctx.t("approval.allow")}
          </button>
          <button type="button" onClick={() => decide("rejected")}>
            {ctx.t("approval.deny")}
          </button>
        </div>
      ) : row.decision !== undefined ? (
        <span
          className="henira-mono"
          style={{ fontSize: "12px", color: "var(--henira-text-muted)" }}
        >
          {row.decision}
        </span>
      ) : null}
    </div>
  );
}
