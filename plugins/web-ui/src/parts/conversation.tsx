// 官方件：对话面板（槽 conversation）。哑渲染器——行来自 store（server 投影器是唯一组装处），
// 件只做行→ReactNode 的纯呈现。流式文本透明度浮现（CSS .henira-streaming）。
// 行级挂载点（D-057）：tool.call.view.<工具名>（keyed，顶替官方工具卡）/ conversation.images
// （assistant 行尾画廊位，缺席默认 = markdown 内联图）/ turn.tail（回合尾追加位，官方无默认件）。
// 行内状态渲染（M4 批 A）：usage 徽章（步级用量）/ interrupted 徽章（中断可见）/
// 截断徽章 + 落盘路径 / reasoning 折叠 / 输出复制按钮。容器样式在 tokens.css（.henira-conversation）。
// 长会话渲染（批 A'，2026-11-18 三家取证）：虚拟滚动（tanstack react-virtual，虚拟单位 = 轮——
// turn 相同行不拆散）+ bottom-follow（手势解除 / 贴底恢复 / 回底按钮）+ 滚顶翻页（sessionRows
// 前插，store.mergeOlderRows 合并 + 补滚动位防跳顶）；无 ResizeObserver 的环境（jsdom 测试）
// 降级全量渲染。行引用契约（store 未变行同引用）让 RowView memo 跳过未变行渲染。

import type { AssistantRow, ErrorRow, Row, ToolRow, UserRow } from "@henira/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ToolCallView, WebPart, WebPartContext } from "../types.js";
import { ApprovalSettledRow } from "./approval-card.js";
import { BrainGlyph, CaretGlyph, CheckGlyph, SpinnerGlyph, XGlyph } from "./icons.js";
import { DetailPane, DisclosureRow } from "./row-chrome.js";

/** 虚拟单位 = 轮（turn 相同行不拆散——工具输出与回答同轮同块；key = turnId，无 turn 的
 *  error 行独立成块）。ZCode ConversationTurnRenderUnit 思想的行模型简版。 */
interface TurnUnit {
  key: string;
  turn?: string;
  rows: Row[];
}

function buildTurnUnits(rows: readonly Row[]): TurnUnit[] {
  const units: TurnUnit[] = [];
  for (const row of rows) {
    const last = units[units.length - 1];
    if (last !== undefined && row.turn !== undefined && last.turn === row.turn) {
      last.rows.push(row);
    } else {
      units.push({ key: row.turn ?? `e:${row.rowId}`, turn: row.turn, rows: [row] });
    }
  }
  return units;
}

/** 离底容差（落点距底 <48px 视为贴底——ZCode BOTTOM_ANCHOR_EPSILON_PX 同档） */
const BOTTOM_EPSILON_PX = 48;
/** 滚顶翻页触发距离（ZCode LOAD_OLDER_TRIGGER_PX 同档） */
const LOAD_OLDER_TRIGGER_PX = 64;
/** 翻页单页行数（ZCode snapshotTailWindowRows 同档；服务端钳 200） */
const PAGE_SIZE = 60;
/** jsdom 等无 ResizeObserver 环境降级全量渲染（组件测试不依赖布局） */
const VIRTUAL = typeof ResizeObserver !== "undefined";

export const Conversation: WebPart = (ctx: WebPartContext) => {
  // useSyncExternalStore：store 引用稳定（未变化返回同一对象），快照整体替换语义
  const snapshot = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId),
    () => ctx.store.getSession(ctx.sessionId),
  );
  const units = useMemo(() => buildTurnUnits(snapshot.rows), [snapshot.rows]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const sessionRows = ctx.client.sessionRows; // feature-detect：宿主缺方法 = 不翻页
  const tailParts = ctx.slots.get("turn.tail") ?? [];

  const commitFollowing = (on: boolean): void => {
    followingRef.current = on;
    setFollowing(on);
  };

  // 流式贴底：跟随中内容变高 → 写 scrollTop（内容未变高时 no-op；初始挂载定位最新）
  // biome-ignore lint/correctness/useExhaustiveDependencies: followingRef 是意图裁决引用（有意不进 deps——进则每帧重挂监听）；snapshot.rows 即渲染变化信号
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !followingRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [snapshot.rows]);

  // 用户意图先行（capture 阶段，先于 scroll）：明确上滚手势解除跟随；程序化写入永不误解除
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅挂载期装监听——commitFollowing 为稳定 setState 包装、scrollRef 容器不变
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const away = (): void => {
      if (followingRef.current) commitFollowing(false);
    };
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY < 0) away();
    };
    let touchY: number | undefined;
    const onTouchStart = (e: TouchEvent): void => {
      touchY = e.touches[0]?.clientY;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (touchY !== undefined && y !== undefined && y > touchY) away(); // 手指下移 = 视图上滚
      touchY = y;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") away();
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    el.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    el.addEventListener("keydown", onKey, { capture: true });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);

  // 滚动裁决：落点贴底（<48px）恢复跟随；滚顶触发翻页。
  // React 19 的 onScroll 合成事件对非冒泡 scroll 委托失效（真浏览器实证——jsdom fireEvent
  // 直走 React 事件系统测不出）→ 原生 listener + ref 转发最新闭包（与 wheel/touch 同法）
  const onScrollRef = useRef<() => void>(() => {});
  onScrollRef.current = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < BOTTOM_EPSILON_PX && !followingRef.current) commitFollowing(true);
    if (el.scrollTop < LOAD_OLDER_TRIGGER_PX && snapshot.hasOlder && !loadingOlder) loadOlder();
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const fn = (): void => onScrollRef.current();
    el.addEventListener("scroll", fn, { capture: true, passive: true });
    return () => {
      el.removeEventListener("scroll", fn, { capture: true });
    };
  }, []);

  const loadOlder = (): void => {
    const first = snapshot.rows[0];
    const id = ctx.sessionId;
    if (first === undefined || id === null || sessionRows === undefined) return;
    setLoadingOlder(true);
    void sessionRows
      .call(ctx.client, id, { before: first.rowSeq, limit: PAGE_SIZE })
      .then((page) => {
        ctx.store.mergeOlderRows?.(id, page.rows);
      })
      .catch(() => {})
      .finally(() => {
        setLoadingOlder(false);
      });
  };

  // 前插补位（ZCode prependScrollAdjustment 兜底法）：首块 key 变化（前插发生）且离底状态
  // → scrollTop += 新增高度，正在看的内容不跳
  const prevLayoutRef = useRef({ height: 0, firstKey: "" });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const prev = prevLayoutRef.current;
    const firstKey = units[0]?.key ?? "";
    if (prev.height > 0 && firstKey !== prev.firstKey && !followingRef.current) {
      el.scrollTop += el.scrollHeight - prev.height;
    }
    prevLayoutRef.current = { height: el.scrollHeight, firstKey };
  });

  const backVisible = !following && snapshot.rows.length > 0;
  const backToBottom = (): void => {
    commitFollowing(true);
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  };

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <div className="henira-conversation" ref={scrollRef}>
        {/* 内层以 sessionId 为 React key：会话切换重挂 → 虚拟器测高缓存换代（turnId 跨会话可重复） */}
        <ConversationTimeline
          key={ctx.sessionId ?? "none"}
          units={units}
          ctx={ctx}
          scrollRef={scrollRef}
        />
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
      </div>
      {loadingOlder ? (
        <div
          className="henira-loading-older"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            textAlign: "center",
            padding: "var(--henira-space-2) 0",
            color: "var(--henira-text-muted)",
            fontSize: "var(--henira-fs-sm)",
            pointerEvents: "none",
          }}
        >
          {ctx.t("conversation.loadingOlder")}
        </div>
      ) : null}
      {backVisible ? (
        <button
          type="button"
          className="henira-back-bottom"
          aria-label={ctx.t("conversation.backToBottom")}
          title={ctx.t("conversation.backToBottom")}
          onClick={backToBottom}
          style={{
            position: "absolute",
            right: "var(--henira-space-4)",
            bottom: "var(--henira-space-4)",
            borderRadius: "9999px",
            border: "1px solid var(--henira-border-strong)",
            background: "var(--henira-panel)",
            color: "var(--henira-text)",
            padding: "6px 12px",
            fontSize: "var(--henira-fs-sm)",
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          }}
        >
          ↓ {ctx.t("conversation.backToBottom")}
        </button>
      ) : null}
    </div>
  );
};

/** 时间线主体（sessionId 作 React key——会话切换重挂换测高缓存）：虚拟化窗口挂载，
 *  无 ResizeObserver 环境（jsdom）降级全量。 */
function ConversationTimeline(props: {
  units: readonly TurnUnit[];
  ctx: WebPartContext;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { units, ctx, scrollRef } = props;
  const virtualizer = useVirtualizer({
    count: VIRTUAL ? units.length : 0,
    getScrollElement: () => scrollRef.current,
    // 未知块估高 = 一屏（ZCode 同思想：固定小值会让首屏挂十几块正文）；实高经 measureElement 回写
    estimateSize: () => scrollRef.current?.clientHeight || 240,
    overscan: 2,
    getItemKey: (i) => units[i]?.key ?? i,
  });

  if (!VIRTUAL) {
    return (
      <>
        {units.map((unit) => (
          <TurnBlock key={unit.key} unit={unit} ctx={ctx} />
        ))}
      </>
    );
  }
  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((item) => {
        const unit = units[item.index];
        if (unit === undefined) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            }}
          >
            <TurnBlock unit={unit} ctx={ctx} />
          </div>
        );
      })}
    </div>
  );
}

/** 轮块：行列表（RowView memo——store 未变行同引用，跳过重渲；每帧 O(n) 分组循环在
 *  buildTurnUnits，微秒级，ZCode history/tail 分区缓存挂账实测需要时再做） */
function TurnBlock({ unit, ctx }: { unit: TurnUnit; ctx: WebPartContext }) {
  return (
    <>
      {unit.rows.map((row) => (
        <RowView key={row.rowId} row={row} ctx={ctx} />
      ))}
    </>
  );
}

const RowView = memo(
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
  },
  // ctx 本体每渲染都是新对象（宿主 <Part {...ctxValue} /> spread）——比较稳定子集：
  // row 同引用（store 契约）+ t/host/slots 同引用（shell useMemo；字典/插件变更时正确重渲刷新）
  (a, b) =>
    a.row === b.row &&
    a.ctx.t === b.ctx.t &&
    a.ctx.host === b.ctx.host &&
    a.ctx.slots === b.ctx.slots,
);

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
      {!streaming &&
      row.usage !== undefined &&
      (row.usage.inputTokens ?? 0) + (row.usage.outputTokens ?? 0) > 0 ? (
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
  // 完成态自动收起（ZCode autoCollapse 行为——流式看思路、完成还正文；用户可手动再展开）
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);
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
      {/* 流式摘要独立一行（R125 糙点⑤：不与标题行混排——ZCode 摘要独立 muted 行为层） */}
      {streaming ? (
        <div
          className="henira-fade-right"
          style={{
            color: "var(--henira-text-muted)",
            fontSize: "var(--henira-fs-sm)",
            margin: "var(--henira-space-1) 0 0 var(--henira-space-5)",
          }}
        >
          {reasoningPreview(reasoning)}
        </div>
      ) : null}
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
  // 错误揭示（dsh/ZCode autoOpen 行为参照）：mount 时已 error 或执行中转 error 都要展开可见
  const [revealed, setRevealed] = useState(isError);
  useEffect(() => {
    if (isError) setRevealed(true);
  }, [isError]);
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
      open={revealed ? true : undefined}
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
