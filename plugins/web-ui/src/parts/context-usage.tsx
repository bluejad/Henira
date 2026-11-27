// 官方件：上下文余量入口（compaction.md §4.11）——输入栏工具排右侧的常驻圆环，
// 栏内不放数字；悬停展开面板（指针移入面板不收起；触屏与键盘用点击开合）。
// 数据源 = store 快照 state.context（loop 每步重算 → server/sdk 经 context/changed
// 并入 state.updated；快照携带 → 断线重连自洽）。圆环进度 = used ÷ size。
// 预警 = used 进入压力线下方 10% 窗口：圆环转警示色，面板写明距自动压缩还差 N%。
// 用量为 0 或非法时不渲染（同 zcode contextUsage 的取数守卫）。

import { COMPACTION_INSTRUCTIONS_MAX } from "@henira/protocol";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WebPartContext } from "../types.js";
import { useDismiss } from "./dropdown.js";

const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 4;
const WARNING_WINDOW_RATIO = 0.1;

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** 紧凑读数（96.4K / 128K / 1.2M）——栏内不放数字，此格式只用于面板与 aria */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimZero(value / 1_000)}K`;
  return String(Math.round(value));
}

function percentOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

function Ring({ progress }: { progress: number }): ReactNode {
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const offset = circumference * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <svg
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

export function ContextUsageButton({ ctx }: { ctx: WebPartContext }): ReactNode {
  const context = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.context,
    () => undefined,
  );
  const compacting = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId).state.compacting === true,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = (): void => {
    if (closeTimer.current !== undefined) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };
  /** 指针从圆环移向面板要跨 8px：延迟关闭，面板 onMouseEnter 取消 */
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      closeTimer.current = undefined;
    }, 120);
  };
  useEffect(() => {
    const timer = closeTimer;
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, []);
  useDismiss(open, wrapRef, () => {
    setOpen(false);
  });

  if (ctx.sessionId === null || context === undefined) return null;
  const { used, size, pressure, parts, estimated, cacheHitRate } = context;
  if (!Number.isFinite(used) || !Number.isFinite(size) || size <= 0 || used <= 0) return null;

  const progress = Math.max(0, Math.min(1, used / size));
  const percent = Math.round(progress * 100);
  // 磁盘快照恢复（§4.11）：总量有锚点、三段拆分不可得（未装配没有工具表）——隐藏明细
  const partial = context.partial === true;
  const warningAt = pressure - Math.floor(size * WARNING_WINDOW_RATIO);
  const warning = used >= warningAt;
  const untilPressure = Math.max(0, Math.floor(((pressure - used) / size) * 100));
  const summary = `${formatTokens(used)}/${formatTokens(size)} (${percent}%)`;
  const label = `${ctx.t("context.title")} ${summary}`;

  const feedbackFor = (result: {
    state: "accepted" | "queued" | "skipped" | "rejected";
    reason?: string;
  }): string => {
    if (result.state === "accepted") return ctx.t("context.compactAccepted");
    if (result.state === "queued") return ctx.t("context.compactQueued");
    if (result.state === "skipped") return ctx.t("context.compactSkipped");
    switch (result.reason) {
      case "instructions-too-long":
        return ctx.t("context.compactTooLong");
      case "compaction-in-progress":
        return ctx.t("context.compactBusy");
      case "history-insufficient":
        return ctx.t("context.compactSkipped");
      case "no-model":
        return ctx.t("context.compactNoModel");
      case "interrupted":
        return ctx.t("context.compactInterrupted");
      case "compaction-unavailable":
        return ctx.t("context.compactUnavailable");
      default:
        return ctx.t("context.compactFailed");
    }
  };

  const submitCompact = (): void => {
    setFeedback(undefined);
    if (ctx.client.compact === undefined) {
      setFeedback(ctx.t("context.compactUnavailable"));
      return;
    }
    const trimmed = instructions.trim();
    void ctx.client
      .compact(ctx.sessionId as string, trimmed === "" ? undefined : trimmed)
      .then((result) => {
        setFeedback(feedbackFor(result));
        if (result.state === "accepted" || result.state === "queued") setInstructions("");
      })
      .catch(() => {
        setFeedback(ctx.t("context.compactFailed"));
      });
  };

  return (
    <span className="henira-context" ref={wrapRef}>
      <button
        type="button"
        className="henira-icon-round henira-context-entry"
        data-warning={warning ? "true" : undefined}
        data-compacting={compacting ? "true" : undefined}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        disabled={compacting}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onClick={() => {
          cancelClose();
          setOpen((value) => !value);
        }}
      >
        <Ring progress={progress} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={ctx.t("context.title")}
          className="henira-pop henira-context-pop"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="henira-context-head">
            <span className="henira-context-title">{ctx.t("context.title")}</span>
            <span className="henira-context-summary">{summary}</span>
          </div>
          {partial ? (
            <p className="henira-context-restored">{ctx.t("context.restored")}</p>
          ) : (
            <>
              <div className="henira-context-bar" aria-hidden="true">
                <span
                  className="henira-context-seg henira-context-seg-system"
                  style={{ width: `${percentOf(parts.system, used)}%` }}
                />
                <span
                  className="henira-context-seg henira-context-seg-tools"
                  style={{ width: `${percentOf(parts.tools, used)}%` }}
                />
                <span
                  className="henira-context-seg henira-context-seg-messages"
                  style={{ width: `${percentOf(parts.messages, used)}%` }}
                />
              </div>
              <ul className="henira-context-parts">
                {(
                  [
                    ["system", ctx.t("context.system"), parts.system],
                    ["tools", ctx.t("context.tools"), parts.tools],
                    ["messages", ctx.t("context.messages"), parts.messages],
                  ] as const
                ).map(([kind, text, value]) => (
                  <li key={kind} className="henira-context-part">
                    <span
                      className={`henira-context-dot henira-context-seg-${kind}`}
                      aria-hidden="true"
                    />
                    <span className="henira-context-part-label">{text}</span>
                    <span className="henira-context-part-value">
                      {formatTokens(value)} · {percentOf(value, used)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="henira-context-foot">
            <span className="henira-context-mode">
              {estimated ? ctx.t("context.estimated") : ctx.t("context.exact")}
            </span>
            {warning ? (
              <span className="henira-context-warn">
                {untilPressure > 0
                  ? `${ctx.t("context.untilPressure")} ${untilPressure}%`
                  : ctx.t("context.autoNext")}
              </span>
            ) : (
              <span className="henira-context-remaining">
                {ctx.t("context.remaining")} {formatTokens(Math.max(0, pressure - used))}
              </span>
            )}
          </div>
          {cacheHitRate !== undefined && cacheHitRate >= 0.78 ? (
            <div className="henira-context-cache">
              {ctx.t("context.cacheHit")} {Math.round(cacheHitRate * 100)}%
            </div>
          ) : null}
          {context.suspicion !== undefined ? (
            <div className="henira-context-suspicion">
              {ctx.t("context.suspicion")} {formatTokens(context.suspicion.actual)} &lt;{" "}
              {formatTokens(context.suspicion.expected)}
            </div>
          ) : null}
          <div className="henira-context-compact">
            {compacting ? (
              <span className="henira-context-compacting">{ctx.t("context.compacting")}</span>
            ) : (
              <>
                <input
                  className="henira-context-input"
                  type="text"
                  value={instructions}
                  maxLength={COMPACTION_INSTRUCTIONS_MAX}
                  placeholder={ctx.t("context.compactPlaceholder")}
                  aria-label={ctx.t("context.compactPlaceholder")}
                  onChange={(event) => {
                    setInstructions(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCompact();
                    }
                  }}
                />
                <button
                  type="button"
                  className="henira-context-compact-btn"
                  onClick={submitCompact}
                >
                  {ctx.t("context.compact")}
                </button>
              </>
            )}
            {feedback !== undefined ? (
              <p className="henira-context-feedback" role="status">
                {feedback}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}
