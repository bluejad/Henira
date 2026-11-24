// 官方框架件（槽 layout，D-062 整页框架槽）：三栏骨架本体，同一注册声明子槽
//（声明 = 独占渲染权——dsh ui-layout AppFrame 行为层：占 root 的同一 register 声明
// sidebar/conversation/rightbar 子槽，顶替 layout = 官方区域件声明随框架件消失）。
// 从 ctx.slots 渲染 sidebar / conversation / composer / sidebar.right；几何（列宽/拖宽/
// 持久化）是框架的职责，区域件不自管列宽。宿主零界面 JSX——一切可见物都在本件与子件。

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { LayoutOption, WebPart, WebPartContext, WebSlotName } from "../types.js";
import { FolderGlyph, GearGlyph, HorseGlyph, SidebarGlyph } from "./icons.js";
import { PreviewModal } from "./preview.js";
import { SettingsModal } from "./settings-modal.js";
import { SlotBoundary } from "./slot-boundary.js";

/** 侧栏拖宽钳位（D-063；tokens.css --henira-sidebar-width 260 为未拖过时的 var 缺省） */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;
/** 右栏（ZCode sidePane 档位行为层：默认 ~45% 视口，这里取 380px 基准 + 50% 上限） */
const RIGHT_MIN = 280;
const RIGHT_DEFAULT = 380;

/** 会话标题：store 快照里的 title（R188 服务端派生）；订阅 store——快照到达时 header 跟着换。 */
function useSessionTitle(ctx: WebPartContext): string | undefined {
  const subscribe = useMemo(() => (cb: () => void) => ctx.store.subscribe(cb), [ctx.store]);
  const getSnapshot = (): string | undefined =>
    ctx.sessionId === null ? undefined : ctx.store.getSession(ctx.sessionId).title;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const LayoutFrame: WebPart = (ctx: WebPartContext): ReactNode => {
  const layout: LayoutOption = ctx.layout ?? "full";
  const custom = typeof layout === "object" ? layout.parts : undefined;
  const showSidebar = custom !== undefined ? custom.sidebar !== undefined : layout === "full";
  const showConversation =
    custom !== undefined
      ? custom.conversation !== undefined
      : layout === "full" || layout === "center";
  const showComposer =
    custom !== undefined
      ? custom.composer !== undefined
      : layout === "full" || layout === "composer" || layout === "center";
  const showRight =
    custom !== undefined ? custom["sidebar.right"] !== undefined : layout === "full";
  // 右栏开合（R194：收起 = 整列不渲染、不留窄轨；重开入口在中列 header）
  const rightOpen = (ctx.uiState?.rightPanel?.open ?? false) === true;
  // 左栏收起（R194，纯本地态——这是窗口布局偏好，不跨刷新/不写 ui-state）
  const [leftHidden, setLeftHidden] = useState(false);
  const sessionTitle = useSessionTitle(ctx);
  // R200：对话滚动视口两侧的滚动条槽宽由浏览器决定（webkit / Firefox / overlay 各不同）——
  // 探针与真实滚动条共用同一套全局样式；both-edges 下 (offsetWidth - clientWidth)/2 = 单侧槽宽。
  // 输入区外层按同宽内缩，正文列与输入卡才共用「扣掉两侧槽」的横向盒子。
  const centerColumnRef = useRef<HTMLDivElement>(null);
  const scrollProbeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const probe = scrollProbeRef.current;
    const column = centerColumnRef.current;
    if (probe === null || column === null) return;
    const apply = (): void => {
      const gutter = (probe.offsetWidth - probe.clientWidth) / 2;
      column.style.setProperty("--henira-scroll-gutter", `${gutter}px`);
    };
    apply();
    // 槽宽会随平台/缩放/滚动条首次出现而变（活体：挂载时 12.5 → 稳定后 15）——
    // RO 在后台/IAB 页可能被暂停，补一次定型后复测 + 窗口缩放复测；RO 只作常驻兜底。
    const settle = window.setTimeout(apply, 600);
    window.addEventListener("resize", apply);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(apply);
      observer.observe(probe);
    }
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", apply);
      observer?.disconnect();
    };
  }, []);

  // 区域件取用：挑件表（object form）优先，否则槽位表（官方默认件经公共注册路径在表内）
  const partsOf = (slot: WebSlotName): WebPart[] => {
    const picked = custom?.[slot];
    if (picked !== undefined) return [picked];
    return (ctx.slots.get(slot) ?? []) as WebPart[];
  };
  const renderParts = (slot: WebSlotName): ReactNode[] =>
    // key = 件名（同旧 Shell 惯例；同槽重名件是注册冲突场景，不在此兜）；
    // 每件独立 boundary：崩溃只退出该件，不白屏（批 C，dsh abdicate 行为层）
    partsOf(slot).map((Part) => (
      <SlotBoundary key={Part.name} label={slot}>
        <Part {...ctx} />
      </SlotBoundary>
    ));

  // ── 侧栏拖宽（D-063）：本地态管拖动中视觉，松手才落盘；每会话回填一次 ──
  const [leftWidth, setLeftWidth] = useState<number | undefined>(undefined);
  const leftSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ctx.uiState === undefined) return; // 未加载——保 var 缺省
    if (ctx.sessionId === leftSyncedFor.current) return;
    leftSyncedFor.current = ctx.sessionId;
    const w = ctx.uiState.layout?.leftWidth;
    setLeftWidth(typeof w === "number" ? w : undefined);
  }, [ctx.sessionId, ctx.uiState]);

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth ?? SIDEBAR_DEFAULT;
    const clamp = (v: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v));
    const move = (ev: MouseEvent): void => {
      setLeftWidth(clamp(startW + (ev.clientX - startX)));
    };
    const up = (ev: MouseEvent): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      ctx.updateUiState?.({ layout: { leftWidth: clamp(startW + (ev.clientX - startX)) } });
    };
    document.body.style.userSelect = "none"; // 拖动中禁选中文本
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ── 右栏拖宽（rightPanel 随骨架批接线：layout.rightWidth，每会话各记各的）──
  const [rightWidth, setRightWidth] = useState<number | undefined>(undefined);
  const rightSyncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ctx.uiState === undefined) return;
    if (ctx.sessionId === rightSyncedFor.current) return;
    rightSyncedFor.current = ctx.sessionId;
    const w = ctx.uiState.layout?.rightWidth;
    setRightWidth(typeof w === "number" ? w : undefined);
  }, [ctx.sessionId, ctx.uiState]);

  const startRightDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth ?? RIGHT_DEFAULT;
    const max = Math.max(RIGHT_MIN, Math.floor(window.innerWidth / 2));
    const clamp = (v: number): number => Math.min(max, Math.max(RIGHT_MIN, v));
    const move = (ev: MouseEvent): void => {
      setRightWidth(clamp(startW + (startX - ev.clientX)));
    };
    const up = (ev: MouseEvent): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      ctx.updateUiState?.({ layout: { rightWidth: clamp(startW + (startX - ev.clientX)) } });
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const t = ctx.t; // 宿主侧引用稳定（语言包变化才换新）

  // 中列 header：目录弱前缀 + 会话标题（R188 服务端派生 title；不再点串/占位）
  const headerDir = useMemo(() => {
    const cwd = ctx.sessionCwd ?? "";
    const segs = cwd.split(/[\\/]/).filter((s) => s !== "");
    return segs.length > 0 ? segs[segs.length - 1] : "";
  }, [ctx.sessionCwd]);

  const sidebarWidth = leftWidth === undefined ? "var(--henira-sidebar-width)" : `${leftWidth}px`;
  const sidebarHas = partsOf("sidebar").length > 0;
  const rightWidthStyle =
    rightWidth === undefined ? "var(--henira-right-width)" : `${rightWidth}px`;

  return (
    // R201 卡片化：根内缩 8px（左 0 让侧栏贴窗口）——中列/右栏卡片四周有缝、四角可见
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        boxSizing: "border-box",
        padding: "8px 8px 8px 0",
      }}
    >
      {showSidebar && sidebarHas ? (
        <div
          className="henira-left-col"
          data-collapsed={leftHidden ? "true" : undefined}
          aria-hidden={leftHidden || undefined}
          inert={leftHidden ? true : undefined}
          style={{
            display: "flex",
            flexDirection: "column",
            // R194：收起 = 列宽收 0（保持挂载，列表滚动/折叠态不丢）；不是卸载、不留窄轨
            width: leftHidden ? 0 : sidebarWidth,
            flexShrink: 0,
            overflow: "hidden",
            opacity: leftHidden ? 0 : 1,
            pointerEvents: leftHidden ? "none" : undefined,
          }}
        >
          {/* 品牌行（ZCode 左栏顶部行行为层：logo 住栏顶，48px 与中右两栏顶连成一条线） */}
          <div
            className="henira-brand"
            style={{
              height: "var(--henira-header-height)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: "var(--henira-space-2)",
              padding: "0 var(--henira-space-4)",
              borderBottom: "1px solid var(--henira-border)",
              borderRight: "1px solid var(--henira-border)",
              background: "var(--henira-surface)",
              boxSizing: "border-box",
            }}
          >
            <HorseGlyph size={16} color="var(--henira-text-strong)" />
            <span
              style={{
                fontWeight: 600,
                color: "var(--henira-text-strong)",
                fontSize: "var(--henira-fs-base)",
              }}
            >
              {t("app.title")}
            </span>
            <button
              type="button"
              className="henira-iconbtn"
              style={{ marginLeft: "auto" }}
              aria-label={t("app.collapseSidebar")}
              title={t("app.collapseSidebar")}
              onClick={() => {
                setLeftHidden(true);
              }}
            >
              <SidebarGlyph side="left" size={14} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{renderParts("sidebar")}</div>
          {/* 底部固定行（R194）：本地服务 + 链路状态（无账号体系，不造头像身份）；
              齿轮住右下——左侧状态、右侧动作一行收尾 */}
          <footer
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--henira-space-2)",
              padding: "var(--henira-space-2) var(--henira-space-3) var(--henira-space-4)",
              background: "var(--henira-surface)",
              borderRight: "1px solid var(--henira-border)",
              boxSizing: "border-box",
              width: sidebarWidth,
            }}
          >
            <span
              className="henira-footer-status"
              role="status"
              aria-label={`${t("footer.localService")} ${
                ctx.linkState === "reconnecting" ? t("footer.reconnecting") : t("footer.connected")
              }`}
              title={
                ctx.linkState === "reconnecting" ? t("footer.reconnecting") : t("footer.connected")
              }
            >
              <span
                className={`henira-status-dot${
                  ctx.linkState === "reconnecting" ? " is-warn" : " is-ok"
                }`}
                aria-hidden="true"
              />
              {t("footer.localService")}
            </span>
            <button
              type="button"
              className="henira-iconbtn henira-footer-settings"
              aria-label={t("settings.open")}
              title={t("settings.title")}
              onClick={() => {
                ctx.openSettings?.();
              }}
            >
              <GearGlyph size={16} />
            </button>
          </footer>
        </div>
      ) : (
        <div style={{ padding: "8px" }}>
          <button
            type="button"
            aria-label={t("settings.open")}
            onClick={() => {
              ctx.openSettings?.();
            }}
          >
            <GearGlyph size={16} />
          </button>
        </div>
      )}
      {showSidebar && sidebarHas && !leftHidden ? (
        <button
          type="button"
          className="henira-drag-handle"
          title={t("app.dragHint")}
          onMouseDown={startDrag}
          onDoubleClick={() => {
            setLeftWidth(SIDEBAR_DEFAULT); // 双击回落默认宽
            ctx.updateUiState?.({ layout: { leftWidth: SIDEBAR_DEFAULT } });
          }}
        />
      ) : null}
      <div
        ref={centerColumnRef}
        className="henira-pane-card"
        style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
      >
        {/* R200 槽宽探针：fixed 离屏，只量滚动条宽度，不参与布局 */}
        <div ref={scrollProbeRef} className="henira-scroll-probe" aria-hidden="true" />
        {showConversation ? (
          <header className="henira-header">
            {leftHidden ? (
              <button
                type="button"
                className="henira-iconbtn"
                aria-label={t("app.expandSidebar")}
                title={t("app.expandSidebar")}
                onClick={() => {
                  setLeftHidden(false);
                }}
              >
                <SidebarGlyph side="left" size={14} />
              </button>
            ) : null}
            {headerDir !== "" ? (
              <span className="henira-header-dir" title={ctx.sessionCwd ?? undefined}>
                <FolderGlyph size={13} />
                <span className="henira-header-dir-name">{headerDir}</span>
              </span>
            ) : null}
            <span className="henira-header-title" title={sessionTitle ?? t("app.untitled")}>
              {sessionTitle ?? t("app.untitled")}
            </span>
            {showRight && !rightOpen ? (
              <button
                type="button"
                className="henira-iconbtn"
                aria-label={t("rightPanel.open")}
                title={t("rightPanel.open")}
                // 会话 ui-state 尚未加载时不能发写——空 tabs 会抹掉磁盘上的 tab 总账
                disabled={ctx.uiState === undefined}
                onClick={() => {
                  // 会话 ui-state 是顶层浅合并——重开必须带上既有 tab 总账，不能只发 open
                  ctx.updateUiState?.({
                    rightPanel: {
                      open: true,
                      active: ctx.uiState?.rightPanel?.active ?? null,
                      tabs: ctx.uiState?.rightPanel?.tabs ?? [],
                    },
                  });
                }}
              >
                <SidebarGlyph side="right" size={14} />
              </button>
            ) : null}
          </header>
        ) : null}
        {showConversation ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {renderParts("conversation")}
          </div>
        ) : null}
        {showComposer ? (
          <div className="henira-composer-gutter">{renderParts("composer")}</div>
        ) : null}
      </div>
      {showRight && rightOpen ? (
        <>
          <button
            type="button"
            className="henira-drag-handle"
            title={t("app.dragHint")}
            onMouseDown={startRightDrag}
            onDoubleClick={() => {
              setRightWidth(RIGHT_DEFAULT);
              ctx.updateUiState?.({ layout: { rightWidth: RIGHT_DEFAULT } });
            }}
          />
          <div className="henira-right-col henira-pane-card" style={{ width: rightWidthStyle }}>
            {renderParts("sidebar.right")}
          </div>
        </>
      ) : null}
      {ctx.settingsSection != null ? (
        <SettingsModal
          ctx={ctx}
          section={ctx.settingsSection}
          onClose={() => ctx.closeSettings?.()}
        />
      ) : null}
      {ctx.preview?.modal !== undefined && ctx.preview.modal !== null ? (
        <PreviewModal target={ctx.preview.modal} ctx={ctx} onClose={() => ctx.preview?.close()} />
      ) : null}
      {ctx.safeMode === true ? (
        <div
          style={{
            position: "fixed",
            right: "12px",
            bottom: "12px",
            background: "var(--henira-warn-bg)",
            color: "var(--henira-warn-text)",
            borderRadius: "9999px",
            fontSize: "var(--henira-fs-sm)",
            padding: "2px 10px",
          }}
        >
          {t("app.safeMode")}
        </div>
      ) : null}
    </div>
  );
};
