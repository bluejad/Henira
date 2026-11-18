// 设置弹窗（用户裁定 2026-11-18：左菜单右内容，只列现有三项——主题 / 语言 / 模型管理）。
// BC SettingsPanel 行为层参照（分区导航 + 右侧内容），分区收敛为现有能力；模型管理页 =
// 当前模型下拉（ModelSelect 共享件）+ 服务商密钥。开合状态归宿主（ctx.settingsSection /
// openSettings / closeSettings），本件只渲染当前分区。

import { type ReactNode, useEffect, useState } from "react";
import type { SettingsSection, UiAssetLocale, UiAssetTheme, WebPartContext } from "../types.js";
import { XGlyph } from "./icons.js";
import { ModelSelect } from "./model-select.js";

const SECTIONS: SettingsSection[] = ["theme", "locale", "models"];

export function SettingsModal(props: {
  ctx: WebPartContext;
  section: SettingsSection;
  onClose(): void;
}): ReactNode {
  const { ctx } = props;
  const [section, setSection] = useState<SettingsSection>(props.section);
  const [themes, setThemes] = useState<UiAssetTheme[]>([]);
  const [locales, setLocales] = useState<UiAssetLocale[]>([]);

  // 挂载拉一次已装资产清单（弹窗每次打开重挂载，恰跑一次）
  useEffect(() => {
    let alive = true;
    void ctx.client
      .listUiAssets()
      .then((a) => {
        if (!alive) return;
        setLocales(a.locales);
        setThemes(a.themes);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client]);

  return (
    <div className="henira-overlay" role="dialog" aria-label={ctx.t("settings.title")}>
      <div className="henira-dialog henira-settings-dialog">
        <div className="henira-dialog-head">
          <strong>{ctx.t("settings.title")}</strong>
          <button type="button" aria-label={ctx.t("settings.title")} onClick={props.onClose}>
            <XGlyph size={14} />
          </button>
        </div>
        <div className="henira-settings-body">
          <nav className="henira-settings-nav" aria-label={ctx.t("settings.title")}>
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                data-active={s === section ? "true" : undefined}
                onClick={() => {
                  setSection(s);
                }}
              >
                {ctx.t(`settings.section.${s}`)}
              </button>
            ))}
          </nav>
          <div className="henira-settings-content">
            {section === "theme" ? <ThemePage ctx={ctx} themes={themes} /> : null}
            {section === "locale" ? <LocalePage ctx={ctx} locales={locales} /> : null}
            {section === "models" ? <ModelsPage ctx={ctx} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 主题页：官方 light/dark + 已装主题包（选择即宿主切 data-theme + <link> 注入，D-059）──

function ThemePage(props: { ctx: WebPartContext; themes: UiAssetTheme[] }): ReactNode {
  const { ctx } = props;
  return (
    <label className="henira-dialog-field">
      <div className="henira-field-label">{ctx.t("settings.theme")}</div>
      <select
        className="henira-input"
        value={ctx.theme}
        onChange={(e) => {
          const id = e.target.value;
          ctx.onTheme?.(id, props.themes.find((t) => t.name === id)?.url);
        }}
      >
        <option value="light">{ctx.t("settings.theme.light")}</option>
        <option value="dark">{ctx.t("settings.theme.dark")}</option>
        {props.themes.map((theme) => (
          <option key={`${theme.pluginId}@${theme.version}/${theme.name}`} value={theme.name}>
            {theme.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── 语言页：官方 zh + 已装语言包（fetch 字典交宿主覆盖，D-059 缺 key 回落官方）──

function LocalePage(props: { ctx: WebPartContext; locales: UiAssetLocale[] }): ReactNode {
  const { ctx } = props;
  const [localeId, setLocaleId] = useState("zh");

  useEffect(() => {
    let alive = true;
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (alive && s.ui?.locale !== undefined) setLocaleId(s.ui.locale);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client]);

  const changeLocale = (lang: string): void => {
    setLocaleId(lang);
    if (lang === "zh") {
      ctx.onLocale?.(undefined, "zh"); // 官方 zh = 无覆盖字典
      return;
    }
    const url = props.locales.find((l) => l.lang === lang)?.url;
    if (url === undefined) return;
    void fetch(url)
      .then((r) => r.json())
      .then((dict: Record<string, string>) => {
        ctx.onLocale?.(dict, lang);
      })
      .catch(() => {});
  };

  return (
    <label className="henira-dialog-field">
      <div className="henira-field-label">{ctx.t("settings.locale")}</div>
      <select
        className="henira-input"
        value={localeId}
        onChange={(e) => {
          changeLocale(e.target.value);
        }}
      >
        <option value="zh">{ctx.t("settings.locale.zh")}</option>
        {props.locales.map((locale) => (
          <option key={`${locale.pluginId}@${locale.version}/${locale.lang}`} value={locale.lang}>
            {locale.lang}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── 模型管理页：当前模型（ModelSelect 共享件）+ 服务商密钥 + 保存 ──
// 保存语义承原设置浮层：putSettings({model})；provider+key 均非空再 putCredential
//（D-030：key 只进 credentials.json，永不回读）。

function ModelsPage(props: { ctx: WebPartContext }): ReactNode {
  const { ctx } = props;
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (alive && s.model !== undefined) setModel(s.model);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client]);

  const ready = ctx.client.putSettings !== undefined;
  const save = (): void => {
    const patch: { model?: string; ui?: { theme?: string; locale?: string } } = {};
    if (model.trim() !== "") patch.model = model.trim();
    const job = props.ctx.client.putSettings?.(patch);
    void (job ?? Promise.resolve())
      .then(() => {
        if (provider.trim() !== "" && key.trim() !== "") {
          return props.ctx.client.putCredential?.(provider.trim(), key.trim());
        }
        return undefined;
      })
      .then(() => {
        setSaved(true);
      })
      .catch(() => {});
  };

  return (
    <div>
      {ready ? (
        <div className="henira-dialog-field">
          <div className="henira-field-label">{ctx.t("settings.models.current")}</div>
          <ModelSelect
            ctx={ctx}
            value={model}
            onChange={setModel}
            ariaLabel={ctx.t("settings.models.current")}
          />
        </div>
      ) : null}
      <label className="henira-dialog-field">
        <div className="henira-field-label">{ctx.t("settings.credential")}</div>
        <div style={{ display: "flex", gap: "var(--henira-space-2)" }}>
          <input
            className="henira-input"
            value={provider}
            placeholder={ctx.t("settings.credentialProvider")}
            style={{ width: "140px", flexShrink: 0 }}
            onChange={(e) => {
              setProvider(e.target.value);
            }}
          />
          <input
            className="henira-input"
            value={key}
            type="password"
            placeholder={ctx.t("settings.credentialPlaceholder")}
            style={{ flex: 1, minWidth: 0 }}
            onChange={(e) => {
              setKey(e.target.value);
            }}
          />
        </div>
        <div className="henira-field-hint">{ctx.t("settings.credentialHint")}</div>
      </label>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--henira-space-2)",
          alignItems: "center",
        }}
      >
        {saved ? (
          <span style={{ color: "var(--henira-ok-text)" }}>{ctx.t("settings.saved")}</span>
        ) : null}
        <button type="button" className="henira-primary" onClick={save} disabled={!ready}>
          {ctx.t("settings.save")}
        </button>
      </div>
    </div>
  );
}
