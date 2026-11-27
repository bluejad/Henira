// 官方件：上下文余量入口（compaction.md §4.11）——输入栏工具排右侧的常驻圆环，
// 栏内不放数字；悬停展开面板（指针移入面板不收起；触屏与键盘用点击开合）。
// 数据源 = store 快照 state.context（loop 每步重算 → server/sdk 经 context/changed
// 并入 state.updated；快照携带 → 断线重连自洽）。圆环进度 = used ÷ size；面板三段条同口径
// 按 size 折算（占用 + 构成二合一——按 used 折成占比会恒满格、用量不进条的几何，2026-11-27 用户纠偏）。
// 预警 = used 进入压力线下方 10% 窗口：圆环转警示色，面板写明距自动压缩还差 N%。
// 用量为 0 或非法时不渲染（同 zcode contextUsage 的取数守卫）。
// 手动压缩入口（D-092）：面板里的「压缩」只把 /compact 交给输入框（宿主 prefill——只回填不
// 发送），由用户在输入框点发送，与消息走同一个提交路径；本件不直发压缩请求。

import { COMPACT_COMMAND } from "@henira/protocol";
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
  // D-092：压缩是队列意图——已排队（尚未轮到时）也算「已提交」，入口不再收第二次
  const compactQueued = useSyncExternalStore(
    ctx.store.subscribe,
    () =>
      (ctx.store.getSession(ctx.sessionId).state.queue ?? []).some(
        (entry) => entry.kind === "compact",
      ),
    () => false,
  );
  const [open, setOpen] = useState(false);
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

  // 交给输入框（D-092）：手动压缩只从输入框出去——本件不调 client.compact。输入框已有草稿时
  // 宿主不覆盖，这里先看一眼就地提示（先发送或清空）。
  const handOffCompact = (): void => {
    if ((ctx.composer?.draft ?? "").trim() !== "") {
      setFeedback(ctx.t("context.compactDraftBusy"));
      return;
    }
    setFeedback(undefined);
    ctx.host.prefill({ text: COMPACT_COMMAND });
    setOpen(false); // 收起面板，把视线交给输入框
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
              {/* 段宽分母是 size 不是 used（见文件头）：条要回答「占了多少上限」，答「已用量里各占几成」恒满格 */}
              <div className="henira-context-bar" aria-hidden="true">
                <span
                  className="henira-context-seg henira-context-seg-system"
                  style={{ width: `${percentOf(parts.system, size)}%` }}
                />
                <span
                  className="henira-context-seg henira-context-seg-tools"
                  style={{ width: `${percentOf(parts.tools, size)}%` }}
                />
                <span
                  className="henira-context-seg henira-context-seg-messages"
                  style={{ width: `${percentOf(parts.messages, size)}%` }}
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
            ) : compactQueued ? (
              <span className="henira-context-compacting">
                {ctx.t("context.compactQueueNotice")}
              </span>
            ) : (
              <button
                type="button"
                className="henira-context-compact-btn"
                title={ctx.t("context.compactHint")}
                onClick={handOffCompact}
              >
                {ctx.t("context.compact")}
              </button>
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
