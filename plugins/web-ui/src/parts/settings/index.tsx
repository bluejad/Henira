// 设置弹窗外壳（R177 拆分）：左菜单右内容 + 分区渲染。
import { type ReactNode, useEffect, useState } from "react";
import type { SettingsSection, UiAssetLocale, UiAssetTheme, WebPartContext } from "../../types.js";
import { XGlyph } from "../icons.js";
import { LocalePage } from "./locale.js";
import { ModelsPage } from "./models.js";
import { PluginsPage } from "./plugins.js";
import { ThemePage } from "./theme.js";

const SECTIONS: SettingsSection[] = ["theme", "locale", "models", "plugins"];

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

  // Esc 关闭（2026-11-20 用户裁定：点外面要能关）——keydown 挂 document，弹窗开着才挂
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);

  return (
    <div
      className="henira-overlay"
      role="dialog"
      aria-label={ctx.t("settings.title")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose(); // 只点遮罩本体（不含弹窗内）
      }}
    >
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
            {section === "plugins" ? <PluginsPage ctx={ctx} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
