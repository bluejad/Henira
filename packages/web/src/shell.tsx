// Shell（web 宿主的 React 组装层）：槽位渲染 + 选中态 + 设置浮层 + 主题。
// 件经承重缝（WebPartContext）拿数据——Shell 只做组装，不做数据加工。

import {
  type PluginUiHost,
  type RowStoreLike,
  type SlotPart,
  type UiAssetLocale,
  type UiAssetTheme,
  type WebPart,
  type WebSlotName,
  zh,
} from "@henira/plugin-web-ui";
import type { HeniraFacade } from "@henira/sdk";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { createContext, useEffect, useMemo, useState } from "react";
import type { Layout } from "./host.js";
import type { RowStore } from "./store.js";

export type ShellProps = {
  store: RowStore;
  slots: ReadonlyMap<string, readonly SlotPart[]>;
  client: HeniraFacade;
  layout: Layout;
  host: PluginUiHost;
  /** 主题 id：官方 light/dark 或已装主题包名（D-059） */
  theme: string;
  /** 语言包覆盖字典（D-059：缺 key 回落官方 zh，zh 也缺才 fail-loud；undefined = 官方 zh） */
  localeOverride?: Record<string, string>;
  safeMode: boolean;
  /** 受控选中态：宿主单一真源（开场自动选 + 列表点选都走 onSelectSession，e2e 锁住开场选中） */
  sessionId: string | null;
  onSelectSession(sessionId: string | null): void;
  onToggleSafe(on: boolean): void;
  onTheme(next: string, cssUrl?: string): void;
  onLocale(dict: Record<string, string> | undefined, localeId: string): void;
};

/** 承重缝上下文（件消费）——createContext 传递，件收到的 props 即此对象 */
type WebPartContextValue = {
  client: HeniraFacade;
  sessionId: string | null;
  selectSession(sessionId: string | null): void;
  t(key: string): string;
  theme: string;
  store: RowStoreLike;
  host: PluginUiHost;
  slots: ReadonlyMap<string, readonly SlotPart[]>;
};

const PartContext = createContext<WebPartContextValue>(undefined as never);

/** D-050 取字工厂（D-059 语言包）：覆盖字典缺 key 回落官方 zh，zh 也缺才 fail-loud。
 * 宿主侧也用（renderMarkdown 注入代码块复制钮文案——markdown 纯渲染层不持有字典）。 */
export const makeT =
  (override?: Record<string, string>): ((key: string) => string) =>
  (key: string): string => {
    const value = override?.[key] ?? (zh as Record<string, string>)[key];
    if (value === undefined) throw new Error(`missing locale key: ${key}`);
    return value;
  };

export function Shell(props: ShellProps) {
  const { store, client, layout, safeMode } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = makeT(props.localeOverride);

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
      slots: props.slots,
    }),
    [
      client,
      props.sessionId,
      props.onSelectSession,
      store,
      props.theme,
      props.host,
      props.slots,
      t,
    ],
  );

  const showSidebar = layout === "full";
  const showConversation = layout === "full" || layout === "center";
  const showComposer = layout === "full" || layout === "composer" || layout === "center";
  // 区域槽只可能装 WebPart（webUiModule/defaultParts 只注册区域件）——keyed 件由行渲染侧消费
  const partsOf = (slot: WebSlotName): WebPart[] => (props.slots.get(slot) ?? []) as WebPart[];
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
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "var(--henira-space-2) var(--henira-space-2) 0",
                background: "var(--henira-surface)",
                borderRight: "1px solid var(--henira-border)",
              }}
            >
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
            t={t}
            onClose={() => {
              setSettingsOpen(false);
            }}
            onTheme={props.onTheme}
            onLocale={props.onLocale}
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
              fontSize: "var(--henira-fs-sm)",
              padding: "2px 10px",
            }}
          >
            {t("app.safeMode")}
          </div>
        ) : null}
      </div>
    </PartContext.Provider>
  );
}

// ── 设置浮层（判据③：默认模型 / 主题 / 密钥录入；D-059：主题/语言下拉列已装资产包）──

function SettingsPanel(props: {
  client: HeniraFacade;
  theme: string;
  t(key: string): string;
  onClose(): void;
  onTheme(next: string, cssUrl?: string): void;
  onLocale(dict: Record<string, string> | undefined, localeId: string): void;
}) {
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [localeId, setLocaleId] = useState("zh");
  const [locales, setLocales] = useState<UiAssetLocale[]>([]);
  const [themes, setThemes] = useState<UiAssetTheme[]>([]);

  useEffect(() => {
    // 挂载拉一次当前模型 + 已装资产清单（浮层每次打开重挂载，恰跑一次）
    void props.client.getSettings().then((s) => {
      if (s.model !== undefined) setModel(s.model);
      if (s.ui?.locale !== undefined) setLocaleId(s.ui.locale);
    });
    void props.client
      .listUiAssets()
      .then((a) => {
        setLocales(a.locales);
        setThemes(a.themes);
      })
      .catch(() => {});
  }, [props.client]);

  const save = (): void => {
    const patch: { model?: string; ui?: { theme?: string; locale?: string } } = {};
    if (model.trim() !== "") patch.model = model.trim();
    patch.ui = { theme: props.theme, locale: localeId };
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

  const changeTheme = (id: string): void => {
    props.onTheme(id, themes.find((t) => t.name === id)?.url);
  };

  const changeLocale = (lang: string): void => {
    setLocaleId(lang);
    if (lang === "zh") {
      props.onLocale(undefined, "zh"); // 官方 zh = 无覆盖字典
      return;
    }
    const url = locales.find((l) => l.lang === lang)?.url;
    if (url === undefined) return;
    void fetch(url)
      .then((r) => r.json())
      .then((dict: Record<string, string>) => {
        props.onLocale(dict, lang);
      })
      .catch(() => {});
  };

  return (
    <div
      role="dialog"
      aria-label={props.t("settings.title")}
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
          <strong>{props.t("settings.title")}</strong>
          <button type="button" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <label style={{ display: "block", marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {props.t("settings.model")}
          </div>
          <input
            value={model}
            placeholder={props.t("settings.modelPlaceholder")}
            onChange={(e) => {
              setModel(e.target.value);
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "block", marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {props.t("settings.theme")}
          </div>
          <select
            value={props.theme}
            onChange={(e) => {
              changeTheme(e.target.value);
            }}
            style={inputStyle}
          >
            <option value="light">{props.t("settings.theme.light")}</option>
            <option value="dark">{props.t("settings.theme.dark")}</option>
            {themes.map((theme) => (
              <option key={`${theme.pluginId}@${theme.version}/${theme.name}`} value={theme.name}>
                {theme.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "block", marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {props.t("settings.locale")}
          </div>
          <select
            value={localeId}
            onChange={(e) => {
              changeLocale(e.target.value);
            }}
            style={inputStyle}
          >
            <option value="zh">{props.t("settings.locale.zh")}</option>
            {locales.map((locale) => (
              <option
                key={`${locale.pluginId}@${locale.version}/${locale.lang}`}
                value={locale.lang}
              >
                {locale.lang}
              </option>
            ))}
          </select>
        </label>
        <div style={{ marginBottom: "12px" }}>
          <div style={{ color: "var(--henira-text-muted)", marginBottom: "4px" }}>
            {props.t("settings.credential")}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={provider}
              placeholder={props.t("settings.credentialProvider")}
              onChange={(e) => {
                setProvider(e.target.value);
              }}
              style={{ ...inputStyle, width: "120px" }}
            />
            <input
              value={key}
              type="password"
              placeholder={props.t("settings.credentialPlaceholder")}
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
            <span style={{ color: "var(--henira-ok-text)" }}>{props.t("settings.saved")}</span>
          ) : null}
          <button type="button" className="henira-primary" onClick={save}>
            {props.t("settings.save")}
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
