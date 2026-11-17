// Shell（web 宿主的 React 组装层）：槽位渲染 + 选中态 + 设置浮层 + 主题。
// 件经承重缝（WebPartContext）拿数据——Shell 只做组装，不做数据加工。

import {
  type PluginUiHost,
  type RowStoreLike,
  type WebPart,
  type WebSlotName,
  zh,
} from "@henira/plugin-web-ui";
import type { HeniraFacade } from "@henira/sdk";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { createContext, type ReactNode, useMemo, useState } from "react";
import type { Layout } from "./host.js";
import type { RowStore } from "./store.js";

export type ShellProps = {
  store: RowStore;
  slots: Map<WebSlotName, WebPart[]>;
  client: HeniraFacade;
  layout: Layout;
  host: PluginUiHost;
  theme: "light" | "dark";
  safeMode: boolean;
  /** 受控选中态：宿主单一真源（开场自动选 + 列表点选都走 onSelectSession，e2e 锁住开场选中） */
  sessionId: string | null;
  onSelectSession(sessionId: string | null): void;
  onToggleSafe(on: boolean): void;
  onTheme(next: "light" | "dark"): void;
};

/** 承重缝上下文（件消费）——createContext 传递，件收到的 props 即此对象 */
type WebPartContextValue = {
  client: HeniraFacade;
  sessionId: string | null;
  selectSession(sessionId: string | null): void;
  t(key: string): string;
  theme: "light" | "dark";
  store: RowStoreLike;
  host: PluginUiHost;
};

const PartContext = createContext<WebPartContextValue>(undefined as never);

const t = (key: string): string => {
  const value = (zh as Record<string, string>)[key];
  if (value === undefined) throw new Error(`missing locale key: ${key}`); // D-050 fail-loud
  return value;
};

export function Shell(props: ShellProps) {
  const { store, slots, client, layout, safeMode } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const ctxValue = useMemo<WebPartContextValue>(
    () => ({
      client,
      sessionId: props.sessionId,
      selectSession: (id) => {
        props.onSelectSession(id);
      },
      t,
      theme: props.theme,
      store,
      host: props.host,
    }),
    [client, props.sessionId, props.onSelectSession, store, props.theme, props.host],
  );

  const showSidebar = layout === "full";
  const showConversation = layout === "full" || layout === "center";
  const showComposer = layout === "full" || layout === "composer" || layout === "center";
  const partsOf = (slot: WebSlotName): WebPart[] => slots.get(slot) ?? [];
  // 槽位收起：未装件的槽不渲染不占宽（未装件槽位收起语义）
  const sidebarHas = partsOf("sidebar").length > 0;

  return (
    <PartContext.Provider value={ctxValue}>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {showSidebar && sidebarHas ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "var(--henira-sidebar-width)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 8px 0" }}>
              <button
                type="button"
                aria-label={t("settings.open")}
                title={t("settings.title")}
                onClick={() => {
                  setSettingsOpen(true);
                }}
              >
                <GearSixIcon size={16} />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {partsOf("sidebar").map((Part) => (
                <Part key={Part.name} {...ctxValue} />
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: "8px" }}>
            <button
              type="button"
              aria-label={t("settings.open")}
              onClick={() => {
                setSettingsOpen(true);
              }}
            >
              <GearSixIcon size={16} />
            </button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
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
              {partsOf("conversation").map((Part) => (
                <Part key={Part.name} {...ctxValue} />
              ))}
            </div>
          ) : null}
          {showComposer ? (
            <div>
              {partsOf("composer").map((Part) => (
                <Part key={Part.name} {...ctxValue} />
              ))}
            </div>
          ) : null}
        </div>
        {settingsOpen ? (
          <SettingsPanel
            client={client}
            theme={props.theme}
            onClose={() => {
              setSettingsOpen(false);
            }}
            onTheme={props.onTheme}
          />
        ) : null}
        {safeMode ? (
          <div
            style={{
              position: "fixed",
              right: "12px",
              bottom: "12px",
              background: "var(--henira-warn-bg)",
              color: "var(--henira-warn-text)",
              borderRadius: "9999px",
              fontSize: "12px",
              padding: "2px 10px",
            }}
          >
            safe mode
          </div>
        ) : null}
      </div>
    </PartContext.Provider>
  );
}

// ── 设置浮层（判据③：默认模型 / 主题 / 密钥录入）────────────────────

function SettingsPanel(props: {
  client: HeniraFacade;
  theme: "light" | "dark";
  onClose(): void;
  onTheme(next: "light" | "dark"): void;
}) {
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useState(() => {
    // 仅首挂载拉一次（lazy initializer 恰跑一次，无依赖数组问题）
    void props.client.getSettings().then((s) => {
      if (s.model !== undefined) setModel(s.model);
    });
    return true;
  });

  const save = (): void => {
    const patch: { model?: string; ui?: { theme?: string } } = {};
    if (model.trim() !== "") patch.model = model.trim();
    patch.ui = { theme: props.theme };
    const job = props.client.putSettings(patch).then(() => {
      if (provider.trim() !== "" && key.trim() !== "") {
        return props.client.putCredential(provider.trim(), key.trim());
      }
      return undefined;
    });
    void job
      .then(() => {
        setSaved(true);
      })
      .catch(() => {});
  };

  return (
    <div
      role="dialog"
      aria-label={t("settings.title")}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--henira-surface)",
          border: "1px solid var(--henira-border)",
          borderRadius: "var(--henira-radius)",
          padding: "24px",
          minWidth: "360px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
          <strong>{t("settings.title")}</strong>
          <button type="button" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <label style={{ display: "block", marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {t("settings.model")}
          </div>
          <input
            value={model}
            placeholder={t("settings.modelPlaceholder")}
            onChange={(e) => {
              setModel(e.target.value);
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "block", marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {t("settings.theme")}
          </div>
          <select
            value={props.theme}
            onChange={(e) => {
              props.onTheme(e.target.value as "light" | "dark");
            }}
            style={inputStyle}
          >
            <option value="light">{t("settings.theme.light")}</option>
            <option value="dark">{t("settings.theme.dark")}</option>
          </select>
        </label>
        <label style={{ display: "block", marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {t("settings.locale")}
          </div>
          <select style={inputStyle} disabled value="zh">
            <option value="zh">{t("settings.locale.zh")}</option>
          </select>
        </label>
        <div style={{ marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {t("settings.credential")}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={provider}
              placeholder={t("settings.credentialProvider")}
              onChange={(e) => {
                setProvider(e.target.value);
              }}
              style={{ ...inputStyle, width: "120px" }}
            />
            <input
              value={key}
              type="password"
              placeholder={t("settings.credentialPlaceholder")}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
          </div>
        </div>
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: "8px", alignItems: "center" }}
        >
          {saved ? (
            <span style={{ color: "var(--henira-ok-text)" }}>{t("settings.saved")}</span>
          ) : null}
          <button type="button" className="henira-primary" onClick={save}>
            {t("settings.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--henira-border)",
  borderRadius: "var(--henira-radius)",
  background: "var(--henira-bg)",
  color: "var(--henira-text)",
  padding: "6px 10px",
  font: "inherit",
  boxSizing: "border-box",
};

void (undefined as unknown as ReactNode);
