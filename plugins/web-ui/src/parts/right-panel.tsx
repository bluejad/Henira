// 官方默认件（槽 sidebar.right，D-062）：右栏 tab 框架——ZCode 右栏行为层（⌄ 已开面板清单
// 在最左 + tab 条 + ＋ 新建 + ⤢ 最大化/还原；溢出走横向滚动，tab 最小 60px）。
// tab 总账 = ui-state.json rightPanel{open,active,tabs}（D-063 留位本批接线；按会话各记各的，
// 只存引用，＋ 建空白面板展位 kind:"blank"——内容随插件接入）。`sidebar.right.tab` 追加位的
// 注册件各成一 tab（官方 tab 与插件 tab 并存，D-062），标签暂取件名；顶替 sidebar.right 本体
// = 整条右栏替换（D-043 区域替换语义）。⤢ 最大化 = 覆盖视口的瞬态视图，不落盘。

import { type ReactNode, useRef, useState } from "react";
import type { WebPart, WebPartContext } from "../types.js";
import { useDismiss } from "./dropdown.js";
import { ArrowsInGlyph, ArrowsOutGlyph, CaretDownGlyph, PlusGlyph, XGlyph } from "./icons.js";

type PanelTab = { id: string; kind: string };

export const RightPanel: WebPart = (ctx: WebPartContext): ReactNode => {
  const rp = ctx.uiState?.rightPanel;
  const open = rp?.open === true;
  const tabs: PanelTab[] = rp?.tabs ?? [];
  const pluginParts = (ctx.slots.get("sidebar.right.tab") ?? []) as WebPart[];

  const persist = (patch: { active?: string | null; tabs?: PanelTab[]; open?: boolean }): void => {
    ctx.updateUiState?.({
      rightPanel: {
        open: patch.open ?? true,
        active: patch.active !== undefined ? patch.active : (rp?.active ?? null),
        tabs: patch.tabs ?? tabs,
      },
    });
  };

  const newTab = (): void => {
    const id = `blank-${Date.now().toString(36)}`;
    persist({ active: id, tabs: [...tabs, { id, kind: "blank" }] });
  };

  // 收起态 = 细轨（ZCode 边缘轨行为层）：只有 ＋——面板关着也要有入口（＋住在面板内则永远打不开）
  if (!open) {
    return (
      <div className="henira-right-rail">
        <button
          type="button"
          className="henira-iconbtn"
          aria-label={ctx.t("rightPanel.new")}
          title={ctx.t("rightPanel.new")}
          onClick={newTab}
        >
          <PlusGlyph size={14} />
        </button>
      </div>
    );
  }

  const active = rp?.active ?? tabs[0]?.id ?? null;
  const select = (id: string): void => persist({ active: id });
  const closeTab = (id: string): void => {
    const next = tabs.filter((t) => t.id !== id);
    persist({
      tabs: next,
      active: active === id ? (next[next.length - 1]?.id ?? null) : active,
      open: next.length > 0,
    });
  };

  return (
    <RightPanelView
      ctx={ctx}
      tabs={tabs}
      pluginParts={pluginParts}
      active={active}
      onSelect={select}
      onNew={newTab}
      onClose={closeTab}
    />
  );
};

function RightPanelView(props: {
  ctx: WebPartContext;
  tabs: PanelTab[];
  pluginParts: WebPart[];
  active: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onClose(id: string): void;
}): ReactNode {
  const { ctx, tabs, pluginParts, active } = props;
  const [maximized, setMaximized] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLSpanElement>(null);

  // ⌄ 清单：点外 / Escape 收（useDismiss 统一出口）
  useDismiss(listOpen, listRef, () => {
    setListOpen(false);
  });

  const labelOf = (tab: PanelTab): string =>
    tab.kind === "blank" ? ctx.t("rightPanel.blank") : tab.kind;

  return (
    <div
      className={maximized ? "henira-right-panel henira-right-panel--max" : "henira-right-panel"}
      style={
        maximized
          ? undefined
          : { display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }
      }
    >
      <div className="henira-right-tabs">
        <span className="henira-right-tablist-wrap" ref={listRef}>
          <button
            type="button"
            className="henira-iconbtn"
            aria-label={ctx.t("rightPanel.list")}
            title={ctx.t("rightPanel.list")}
            aria-expanded={listOpen}
            onClick={() => {
              setListOpen((v) => !v);
            }}
          >
            <CaretDownGlyph size={12} />
          </button>
          {listOpen ? (
            <span className="henira-context-menu henira-right-tabmenu" role="menu">
              {tabs.length === 0 && pluginParts.length === 0 ? (
                <span className="henira-model-empty">{ctx.t("rightPanel.new")}</span>
              ) : null}
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="menuitem"
                  className="henira-menu-item"
                  onClick={() => {
                    props.onSelect(tab.id);
                    setListOpen(false);
                  }}
                >
                  {labelOf(tab)}
                </button>
              ))}
              {pluginParts.map((Part) => (
                <button
                  key={`p:${Part.name}`}
                  type="button"
                  role="menuitem"
                  className="henira-menu-item"
                  onClick={() => {
                    props.onSelect(`plugin:${Part.name}`);
                    setListOpen(false);
                  }}
                >
                  {Part.name}
                </button>
              ))}
            </span>
          ) : null}
        </span>
        <span
          className="henira-right-tabstrip"
          onWheel={(e) => {
            // 滚动条已藏（用户裁定）——滚轮纵向增量转横向滚动保住可达性；
            // 不 preventDefault：本条滚不动时不吞页面滚动
            const el = e.currentTarget;
            if (el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
          }}
        >
          {tabs.map((tab) => (
            <span
              key={tab.id}
              className="henira-right-tab"
              data-active={tab.id === active ? "true" : undefined}
            >
              <button
                type="button"
                className="henira-right-tab-label"
                title={labelOf(tab)}
                onClick={() => {
                  props.onSelect(tab.id);
                }}
              >
                {labelOf(tab)}
              </button>
              <button
                type="button"
                className="henira-right-tab-close"
                aria-label={`${ctx.t("rightPanel.close")} ${labelOf(tab)}`}
                onClick={() => {
                  props.onClose(tab.id);
                }}
              >
                <XGlyph size={12} />
              </button>
            </span>
          ))}
          {pluginParts.map((Part) => {
            const id = `plugin:${Part.name}`;
            return (
              <span
                key={id}
                className="henira-right-tab"
                data-active={id === active ? "true" : undefined}
              >
                <button
                  type="button"
                  className="henira-right-tab-label"
                  onClick={() => {
                    props.onSelect(id);
                  }}
                >
                  {Part.name}
                </button>
              </span>
            );
          })}
        </span>
        <button
          type="button"
          className="henira-iconbtn"
          aria-label={ctx.t("rightPanel.new")}
          title={ctx.t("rightPanel.new")}
          onClick={props.onNew}
        >
          <PlusGlyph size={14} />
        </button>
        <button
          type="button"
          className="henira-iconbtn"
          aria-label={maximized ? ctx.t("rightPanel.restore") : ctx.t("rightPanel.maximize")}
          title={maximized ? ctx.t("rightPanel.restore") : ctx.t("rightPanel.maximize")}
          onClick={() => {
            setMaximized((v) => !v);
          }}
        >
          {maximized ? <ArrowsInGlyph size={12} /> : <ArrowsOutGlyph size={12} />}
        </button>
      </div>
      <div className="henira-right-body">
        {tabs.map((tab) =>
          tab.id === active && tab.kind === "blank" ? (
            <div key={tab.id} className="henira-right-empty">
              {ctx.t("rightPanel.placeholder")}
            </div>
          ) : null,
        )}
        {pluginParts.map((Part) => {
          const id = `plugin:${Part.name}`;
          return id === active ? <Part key={id} {...ctx} /> : null;
        })}
      </div>
    </div>
  );
}
