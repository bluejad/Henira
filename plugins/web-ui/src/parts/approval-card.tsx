// 官方件：审批卡。pending 态 = 输入区上方接管 dock 卡（dsh ApprovalPanel / ZCode V4InteractionDialogs
// 同位行为层参照：审批接管 composer 而非对话流内嵌；Enter=允许、Esc=拒绝，composer 提交让位）。
// E6 富化：①per-tool 预览体（approval-preview.tsx——args 完整原样窄化，D-046「挂起自足可渲染」
// 落地）②「本会话允许」三选项（scope:'session' 生产者落地，tools-approval §3.1 机器点亮；
// bash 族不提供——工具级整会话 bash 放行过宽，CC/ZCode 对 bash 只给前缀级，挂账）③队列计数
// （队首单卡由 composer 渲染，多卡 Enter 全中 bug 随单卡化消除）④keyed 缝 approval.view.<工具名>
// （D-057 延伸：官方默认件注册进缝、插件 replaceSlot 顶替、卸载回落通用卡——R163 slot-registry
// 语义直接复用）。收答经 client.settleApproval——幂等先答者赢（另一窗口已答时 applied=false）；
// settled 状态经行流同步（rowId p:<requestId>）。

import type { ApprovalRow } from "@henira/protocol";
import { useEffect, useState } from "react";
import type { ApprovalCardView, WebPartContext } from "../types.js";
import { ApprovalPreview } from "./approval-preview.js";
import { CheckGlyph, XGlyph } from "./icons.js";
import { DisclosureRow } from "./row-chrome.js";
import { SlotBoundary } from "./slot-boundary.js";
import { argsSummaryText, MonoBlock } from "./tool-cards.js";

type Decision = "allowed-once" | "rejected";

/** 键盘直选的模块级互斥登记（审查 F8）：同屏多 Shell 时后挂者胜——Enter/Esc 只命中一张 */
let activeKeyHandler: ((e: KeyboardEvent) => void) | undefined;

/** 工具族 → 是否提供「本会话允许」（bash/powershell 不提供——四仓一致谨慎：CC/ZCode 对
 * bash 只给前缀级规则，工具级整会话放行过宽；前缀级随 permissions.json 写路径挂账） */
function sessionAllowable(toolName: string): boolean {
  return toolName !== "bash" && toolName !== "powershell";
}

/** 审批卡外壳（导出——第三方 keyed 顶替件复用同一 chrome，D-057 观感协调）：warn 边框卡 +
 * 标题行（权限请求 + 队列计数 + pending/settled 徽章 + 工具名）+ reason 解释行 + 预览 children +
 * 按钮组 + Enter/Esc 键盘直选（IME 组合中不抢）。点击即退场（R171——参照产品/opencode/dsh
 * 三家同款乐观移除）：onDecided 在发起瞬间回调（composer 本地摘卡，不等 SSE settled 回传）；
 * settle 网络失败 onDecideFailed 回滚（卡回 dock 可重试）。幂等先答者赢（另一窗口已答时
 * applied=false）。 */
export function ApprovalCardShell(props: {
  row: ApprovalRow;
  ctx: WebPartContext;
  /** 队列总数（composer 队首单卡传入；>1 时显示「待审批 N」计数徽标——CC/ZCode FIFO 单卡同款） */
  queueTotal?: number;
  /** 决定发起即回调（乐观摘卡——点击即走，不等回传） */
  onDecided?: (requestId: string) => void;
  /** settle 失败回调（回滚乐观摘除——卡回 pending 可重试） */
  onDecideFailed?: (requestId: string) => void;
  children?: React.ReactNode;
}): React.ReactNode {
  const { row, ctx } = props;
  const [settling, setSettling] = useState(false);
  const pending = row.status === "pending" && !settling;

  const decide = (decision: Decision, scope?: "session"): void => {
    if (ctx.sessionId === null) return;
    setSettling(true);
    props.onDecided?.(row.requestId); // 乐观摘卡（点击即走——失败走 onDecideFailed 回滚）
    // scope 缺省保持三参调用形状（once 字节面与 E6 前等价）
    void ctx.client
      .settleApproval(
        ctx.sessionId,
        row.requestId,
        decision,
        ...(scope !== undefined ? [scope] : []),
      )
      .catch((err: unknown) => {
        // 404 = 审批对象已不存在（服务重启收口/已答）——当已解决，卡保持离场不回滚
        //（回滚会让死卡复活、再点再炸死循环；参照物「404 视为已解决」同款语义）
        if ((err as { status?: number } | undefined)?.status === 404) return;
        setSettling(false); // 网络失败回到待处理（重试语义）
        props.onDecideFailed?.(row.requestId);
      });
  };

  // 键盘直选（队首单卡——composer 只渲染一张）：Enter=允许一次、Esc=拒绝（CC/ZCode 同款：
  // Esc 是拒绝通道不是中断）。模块级互斥（审查 F8）：Shell 是导出件，同屏多 Shell 时
  // 后挂者胜、先挂者被摘——Enter/Esc 永远只命中一张卡，多卡全中 bug 在机制上不可复活。
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
    if (activeKeyHandler !== undefined) {
      window.removeEventListener("keydown", activeKeyHandler);
    }
    activeKeyHandler = onKey;
    window.addEventListener("keydown", onKey);
    return () => {
      if (activeKeyHandler === onKey) activeKeyHandler = undefined;
      window.removeEventListener("keydown", onKey);
    };
  });

  const allowSession = sessionAllowable(row.toolName);
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
            row.reason !== undefined || row.args !== undefined || pending
              ? "var(--henira-space-2)"
              : undefined,
        }}
      >
        <strong>{ctx.t("approval.title")}</strong>
        {pending && props.queueTotal !== undefined && props.queueTotal > 1 ? (
          <span
            style={{
              fontSize: "var(--henira-fs-sm)",
              borderRadius: "9999px",
              padding: "1px 8px",
              background: "var(--henira-warn-text)",
              color: "var(--henira-warn-bg)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {`${ctx.t("approval.queueCount")} ${props.queueTotal}`}
          </span>
        ) : null}
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
      {row.reason !== undefined ? (
        <div
          style={{
            fontSize: "var(--henira-fs-sm)",
            color: "var(--henira-text-muted)",
            marginBottom: pending ? "var(--henira-space-2)" : 0,
          }}
        >
          {row.reason}
        </div>
      ) : null}
      {props.children}
      {pending ? (
        <div style={{ display: "flex", gap: "var(--henira-space-2)" }}>
          <button type="button" className="henira-primary" onClick={() => decide("allowed-once")}>
            {ctx.t("approval.allow")}
          </button>
          {allowSession ? (
            <button
              type="button"
              onClick={() => decide("allowed-once", "session")}
              title={ctx.t("approval.sessionAllowTip")}
            >
              {ctx.t("approval.sessionAllow")}
            </button>
          ) : null}
          <button type="button" onClick={() => decide("rejected")}>
            {ctx.t("approval.deny")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 通用审批卡（fallback）：外壳 + per-tool 预览体。args 缺（旧账本/超尺寸闸丢弃）→
 * digest 弱色行（「digest 保留作关联指纹」的数据通道承诺对齐——审查 F6） */
export function ApprovalCard(props: {
  row: ApprovalRow;
  ctx: WebPartContext;
  queueTotal?: number;
  onDecided?: (requestId: string) => void;
  onDecideFailed?: (requestId: string) => void;
}): React.ReactNode {
  return (
    <ApprovalCardShell
      row={props.row}
      ctx={props.ctx}
      queueTotal={props.queueTotal}
      onDecided={props.onDecided}
      onDecideFailed={props.onDecideFailed}
    >
      {props.row.args !== undefined ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--henira-space-2)",
            marginBottom: props.row.status === "pending" ? "var(--henira-space-2)" : 0,
          }}
        >
          <ApprovalPreview row={props.row} ctx={props.ctx} />
        </div>
      ) : props.row.argsSummary !== undefined ? (
        <div
          className="henira-mono"
          style={{
            fontSize: "var(--henira-fs-sm)",
            color: "var(--henira-text-muted)",
            marginBottom: props.row.status === "pending" ? "var(--henira-space-2)" : 0,
            wordBreak: "break-all",
          }}
        >
          {props.row.argsSummary}
        </div>
      ) : null}
    </ApprovalCardShell>
  );
}

/** 队首审批卡路由（E6 keyed 缝 approval.view.<工具名>）：精确 key → 通用卡兜底。composer
 * 只渲染队首一张（FIFO，CC/ZCode 同款）；SlotBoundary 行级隔离 + **崩溃回落官方卡**（审查
 * F1：审批 dock 是唯一应答通道，顶替件崩溃渲染 null = composer 被无卡永久阻塞——必须回落）。
 * 队首更替由 composer 的 key={rowId} 重挂复位崩溃态。 */
export function ApprovalQueueCard(props: {
  row: ApprovalRow;
  ctx: WebPartContext;
  queueTotal: number;
  onDecided?: (requestId: string) => void;
  onDecideFailed?: (requestId: string) => void;
}): React.ReactNode {
  const view = props.ctx.slots.get(`approval.view.${props.row.toolName}`)?.[0] as
    | ApprovalCardView
    | undefined;
  const routed = (children: React.ReactNode): React.ReactNode => (
    <SlotBoundary
      label={`approval.view.${props.row.toolName}`}
      fallback={() => (
        <ApprovalCard
          row={props.row}
          ctx={props.ctx}
          queueTotal={props.queueTotal}
          onDecided={props.onDecided}
          onDecideFailed={props.onDecideFailed}
        />
      )}
    >
      {children}
    </SlotBoundary>
  );
  if (view !== undefined) {
    const View = view; // 组件渲染（hooks 合法）
    return routed(
      <View
        ctx={props.ctx}
        row={props.row}
        queueTotal={props.queueTotal}
        onDecided={props.onDecided}
        onDecideFailed={props.onDecideFailed}
      />,
    );
  }
  return (
    <ApprovalCard
      row={props.row}
      ctx={props.ctx}
      queueTotal={props.queueTotal}
      onDecided={props.onDecided}
      onDecideFailed={props.onDecideFailed}
    />
  );
}

/** settled 紧凑结果行（对话流内留痕——R171 升级：中文决策词 + 参数摘要 + 可展开看全文，
 *  与工具行同一行 chrome；决策原文不再裸显英文）。展开体 = args 完整 JSON / digest 弱色行。 */
export function ApprovalSettledRow({
  row,
  ctx,
}: {
  row: ApprovalRow;
  ctx: WebPartContext;
}): React.ReactNode {
  const allowed = row.decision === "allowed-once";
  const decisionLabel =
    row.decision === undefined
      ? ctx.t("approval.settled")
      : row.decision === "invalidated"
        ? ctx.t("approval.decision.invalidated")
        : allowed
          ? row.scope === "session"
            ? ctx.t("approval.decision.session")
            : ctx.t("approval.decision.allowed")
          : ctx.t("approval.decision.rejected");
  const args =
    row.args !== null && typeof row.args === "object" && !Array.isArray(row.args)
      ? (row.args as Record<string, unknown>)
      : null;
  const summary = argsSummaryText(row.toolName, args);
  const fullText = args !== null ? JSON.stringify(args, null, 2) : (row.argsSummary ?? "");
  return (
    <DisclosureRow
      icon={
        allowed ? (
          <CheckGlyph size={14} color="var(--henira-ok-text)" />
        ) : (
          <XGlyph size={14} color="var(--henira-danger-text)" />
        )
      }
      title={decisionLabel}
      meta={row.toolName}
      rowTitle={fullText !== "" ? `${row.toolName} ${row.decision ?? ""}` : undefined}
      summary={
        summary !== null ? (
          <span className="henira-row-summary" title={summary}>
            {summary}
          </span>
        ) : null
      }
    >
      {fullText !== "" ? <MonoBlock text={fullText} maxHeight={240} /> : null}
    </DisclosureRow>
  );
}
