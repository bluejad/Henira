// 官方框架件（槽 layout，D-062 整页框架槽）：三栏骨架本体，同一注册声明子槽
//（声明 = 独占渲染权——dsh ui-layout AppFrame 行为层：占 root 的同一 register 声明
// sidebar/conversation/rightbar 子槽，顶替 layout = 官方区域件声明随框架件消失）。
// 从 ctx.slots 渲染 sidebar / conversation / composer / sidebar.right；几何（列宽/拖宽/
// 持久化）是框架的职责，区域件不自管列宽。宿主零界面 JSX——一切可见物都在本件与子件。

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutOption, WebPart, WebPartContext, WebSlotName } from "../types.js";
import { GearGlyph, HorseGlyph } from "./icons.js";
import { SettingsModal } from "./settings-modal.js";

/** 侧栏拖宽钳位（D-063；tokens.css --henira-sidebar-width 260 为未拖过时的 var 缺省） */
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;
/** 右栏（ZCode sidePane 档位行为层：默认 ~45% 视口，这里取 380px 基准 + 50% 上限） */
const RIGHT_MIN = 280;
const RIGHT_DEFAULT = 380;

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
  // 右栏开合（件自管收起态窄轨 / 开态全栏；拖宽把手只在开态在场）
  const rightOpen = (ctx.uiState?.rightPanel?.open ?? false) === true;

  // 区域件取用：挑件表（object form）优先，否则槽位表（官方默认件经公共注册路径在表内）
  const partsOf = (slot: WebSlotName): WebPart[] => {
    const picked = custom?.[slot];
    if (picked !== undefined) return [picked];
    return (ctx.slots.get(slot) ?? []) as WebPart[];
  };
  const renderParts = (slot: WebSlotName): ReactNode[] =>
    // key = 件名（同旧 Shell 惯例；同槽重名件是注册冲突场景，不在此兜）
    partsOf(slot).map((Part) => <Part key={Part.name} {...ctx} />);

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

  // 中列 header：目录名 · 会话标题占位（标题生成随功能批接入，先占位）
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
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {showSidebar && sidebarHas ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: sidebarWidth,
            flexShrink: 0,
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
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>{renderParts("sidebar")}</div>
          {/* 底部固定行（ZCode WorkspaceSidebarFooter 行为层：footer shrink-0 收尾）——齿轮住左下；
              横向零内边距（按钮自身带）——按钮宽=左栏宽（用户反馈⑤） */}
          <footer
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              padding: "var(--henira-space-2) 0 var(--henira-space-4)",
              background: "var(--henira-surface)",
              borderRight: "1px solid var(--henira-border)",
              boxSizing: "border-box",
              width: sidebarWidth,
            }}
          >
            <button
              type="button"
              className="henira-footer-settings"
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
      {showSidebar && sidebarHas ? (
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
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        {showConversation ? (
          <header className="henira-header">
            {headerDir !== "" ? (
              <>
                <span className="henira-header-dir">{headerDir}</span>
                <span className="henira-header-sep">·</span>
              </>
            ) : null}
            <span className="henira-header-title">{t("app.untitled")}</span>
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
        {showComposer ? <div>{renderParts("composer")}</div> : null}
      </div>
      {showRight ? (
        <>
          {rightOpen ? (
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
          ) : null}
          {/* 收起态列宽塌到窄轨自宽（件内 36px 竖条）；开态全宽 + 把手 */}
          <div
            className="henira-right-col"
            style={rightOpen ? { width: rightWidthStyle } : undefined}
          >
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
