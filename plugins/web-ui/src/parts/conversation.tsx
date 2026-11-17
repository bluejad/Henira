// 官方件：对话面板（槽 conversation）。哑渲染器——行来自 store（server 投影器是唯一组装处），
// 件只做行→ReactNode 的纯呈现。流式文本透明度浮现（CSS .henira-streaming）。
// 行级挂载点（D-057）：tool.call.view.<工具名>（keyed，顶替官方工具卡）/ conversation.images
// （assistant 行尾画廊位，缺席默认 = markdown 内联图）/ turn.tail（回合尾追加位，官方无默认件）。
// 行内状态渲染（M4 批 A）：usage 徽章（步级用量）/ interrupted 徽章（中断可见）/
// 截断徽章 + 落盘路径 / reasoning 折叠 / 输出复制按钮。容器样式在 tokens.css（.henira-conversation）。

import type { AssistantRow, ErrorRow, Row, ToolRow, UserRow } from "@henira/protocol";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ToolCallView, WebPart, WebPartContext } from "../types.js";
import { ApprovalSettledRow } from "./approval-card.js";
import { BrainGlyph, CaretGlyph, CheckGlyph, SpinnerGlyph, XGlyph } from "./icons.js";
import { DetailPane, DisclosureRow } from "./row-chrome.js";

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
        <p
          className="henira-sweep"
          style={{ margin: "var(--henira-space-3) 0", fontSize: "var(--henira-fs-base)" }}
        >
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
      // pending 审批在输入区上方 dock 渲染（composer.tsx 接管）；对话流内只留 settled 痕迹行
      return row.status === "pending" ? null : <ApprovalSettledRow row={row} ctx={ctx} />;
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
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function UserView({ row }: { row: UserRow; ctx?: WebPartContext }) {
  // 右对齐气泡（两家共识：user 右浅气泡 + assistant 左全宽裸排；中性 5% 派生面——
  // 2026-11-17 用户拍板不走 dsh 浅蓝）；右上角收小角=朝向说话者的气泡性格语言。
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        margin: "var(--henira-space-3) 0",
      }}
    >
      {row.source === "steer" || row.source === "veto" ? (
        <div style={{ marginBottom: "var(--henira-space-1)" }}>
          <Pill bg="var(--henira-info-bg)" color="var(--henira-info-text)">
            {row.source}
          </Pill>
        </div>
      ) : null}
      <div
        style={{
          background: "var(--henira-surface)",
          border: "1px solid var(--henira-border)",
          borderRadius: "var(--henira-radius-lg)",
          borderTopRightRadius: "2px",
          padding: "var(--henira-space-2) var(--henira-space-3)",
          maxWidth: "min(85%, 560px)",
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        {row.text}
      </div>
    </div>
  );
}

/** 推理流式摘要：取最近一个非空行的首段（流式中随最新思路推进——ZCode 行为层参照） */
function reasoningPreview(reasoning: string): string {
  const lines = reasoning.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 ? (lines[lines.length - 1] ?? "").trim() : "";
}

function AssistantView({ row, ctx }: { row: AssistantRow; ctx: WebPartContext }) {
  const streaming = row.streaming;
  const gallery = ctx.slots.get("conversation.images")?.[0] as WebPart | undefined;
  const reasoning = row.reasoning !== undefined && row.reasoning !== "" ? row.reasoning : undefined;
  return (
    <div style={{ margin: "var(--henira-space-3) 0" }}>
      {reasoning !== undefined ? (
        <ReasoningView reasoning={reasoning} streaming={streaming === true} ctx={ctx} />
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
        <div style={{ marginTop: "var(--henira-space-1)" }}>
          <span
            className="henira-mono"
            title={ctx.t("row.output")}
            style={{
              border: "1px solid var(--henira-border)",
              borderRadius: "9999px",
              padding: "1px 8px",
              fontSize: "var(--henira-fs-sm)",
              color: "var(--henira-text-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {row.usage.inputTokens ?? 0}↑ {row.usage.outputTokens ?? 0}↓
          </span>
        </div>
      ) : null}
      {gallery !== undefined ? gallery(ctx) : null}
    </div>
  );
}

/** 推理块：折叠行（脑图标 + 状态词 + 流式摘要单行渐隐）+ 展开左导线纯文本（240px 上限滚动）。
 * 流式中默认展开可见最新思路、完成态默认收起（ZCode 行为层参照）。 */
function ReasoningView({
  reasoning,
  streaming,
  ctx,
}: {
  reasoning: string;
  streaming: boolean;
  ctx: WebPartContext;
}): React.ReactNode {
  const [open, setOpen] = useState(streaming);
  return (
    <div style={{ margin: "0 0 var(--henira-space-2)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--henira-space-2)",
          padding: "2px 4px",
          borderRadius: "var(--henira-radius)",
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--henira-space-2)",
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
            minWidth: 0,
          }}
        >
          <BrainGlyph size={14} color="var(--henira-text-muted)" />
          <span
            className={streaming ? "henira-sweep" : undefined}
            style={
              streaming
                ? { fontSize: "var(--henira-fs-sm)", userSelect: "none" }
                : {
                    fontSize: "var(--henira-fs-sm)",
                    userSelect: "none",
                    color: "var(--henira-text-muted)",
                  }
            }
          >
            {ctx.t("row.reasoning")}
          </span>
          {streaming ? (
            <span
              className="henira-fade-right"
              style={{
                flex: 1,
                minWidth: 0,
                color: "var(--henira-text-muted)",
                fontSize: "var(--henira-fs-sm)",
              }}
            >
              {reasoningPreview(reasoning)}
            </span>
          ) : null}
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
        </button>
      </div>
      {open ? (
        <div
          style={{
            marginTop: "var(--henira-space-1)",
            marginLeft: "var(--henira-space-2)",
            borderLeft: "2px solid var(--henira-border)",
            paddingLeft: "var(--henira-space-3)",
            maxHeight: 240,
            overflowY: "auto",
            color: "var(--henira-text-muted)",
            fontSize: "var(--henira-fs-md)",
            whiteSpace: "pre-wrap",
          }}
        >
          {reasoning}
        </div>
      ) : null}
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
  const running = row.status === "running";
  // 官方默认工具卡 = 组装行 chrome 原语（与 keyed 顶替件同一套，D-057 观感协调）
  return (
    <DisclosureRow
      icon={
        running ? (
          <SpinnerGlyph size={14} color={statusColor} />
        ) : isError ? (
          <XGlyph size={14} color={statusColor} />
        ) : (
          <CheckGlyph size={14} color={statusColor} />
        )
      }
      title={row.name}
      busy={running}
      tone={statusColor}
      meta={`#${row.callId}`}
      summary={
        <>
          {row.status === "done" && row.output !== undefined ? (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.output.durationMs}ms</span>
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
        </>
      }
      initialOpen={isError}
    >
      <DetailPane
        sections={[
          {
            label: ctx.t("tool.input"),
            body: (
              <pre
                className="henira-mono"
                style={{
                  margin: 0,
                  color: "var(--henira-text-muted)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontSize: "var(--henira-fs-md)",
                }}
              >
                {row.input}
              </pre>
            ),
          },
          ...(row.output !== undefined
            ? [
                {
                  label: isError ? ctx.t("error.title") : ctx.t("row.output"),
                  tone: isError ? "var(--henira-danger-text)" : undefined,
                  actions: <CopyButton text={row.output.content} t={ctx.t} />,
                  maxHeight: 180,
                  body: (
                    <pre
                      className="henira-mono"
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        fontSize: "var(--henira-fs-md)",
                      }}
                    >
                      {row.output.content}
                    </pre>
                  ),
                },
              ]
            : []),
        ]}
      />
    </DisclosureRow>
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
