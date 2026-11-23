// 外观页（R188：原主题页扩展）：主题 + 预览打开方式（文件/图片各自选右侧或弹窗）。
// 设置字段 = settings.json ui.preview（D-030 程序写面）；宿主 ctx.preview 缺席 = 旧宿主，
// 预览行不渲染（主题行照旧）。
import type { PreviewKind, PreviewOpenMode } from "@henira/protocol";
import type { ReactNode } from "react";
import type { UiAssetTheme, WebPartContext } from "../../types.js";
import { HeniraSelect } from "../dropdown.js";

function ModeSegment(props: {
  value: PreviewOpenMode;
  label: string;
  panelLabel: string;
  modalLabel: string;
  onChange(mode: PreviewOpenMode): void;
}): ReactNode {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 分段控件是按钮组；fieldset 会引入表单语义与默认边框
    <div className="henira-segment" role="group" aria-label={props.label}>
      <button
        type="button"
        aria-pressed={props.value === "panel"}
        data-active={props.value === "panel" ? "true" : undefined}
        onClick={() => {
          props.onChange("panel");
        }}
      >
        {props.panelLabel}
      </button>
      <button
        type="button"
        aria-pressed={props.value === "modal"}
        data-active={props.value === "modal" ? "true" : undefined}
        onClick={() => {
          props.onChange("modal");
        }}
      >
        {props.modalLabel}
      </button>
    </div>
  );
}

function PreviewRow(props: {
  ctx: WebPartContext;
  kind: PreviewKind;
  label: string;
  hint: string;
}): ReactNode {
  const { ctx } = props;
  const preview = ctx.preview;
  if (preview === undefined) return null;
  return (
    <div className="henira-settings-row">
      <div className="henira-settings-row-text">
        <div className="henira-settings-row-label">{props.label}</div>
        <div className="henira-settings-row-hint">{props.hint}</div>
      </div>
      <ModeSegment
        value={preview.settings[props.kind]}
        label={props.label}
        panelLabel={ctx.t("settings.preview.panel")}
        modalLabel={ctx.t("settings.preview.modal")}
        onChange={(mode) => {
          preview.setMode(props.kind, mode);
        }}
      />
    </div>
  );
}

function AppearancePage(props: { ctx: WebPartContext; themes: UiAssetTheme[] }): ReactNode {
  const { ctx } = props;
  return (
    <div className="henira-settings-page">
      <header className="henira-settings-page-head">
        <h2>{ctx.t("settings.appearance.title")}</h2>
        <p>{ctx.t("settings.appearance.hint")}</p>
      </header>
      <div className="henira-settings-card">
        <div className="henira-settings-row">
          <div className="henira-settings-row-text">
            <div className="henira-settings-row-label">{ctx.t("settings.theme")}</div>
            <div className="henira-settings-row-hint">{ctx.t("settings.theme.hint")}</div>
          </div>
          <HeniraSelect
            variant="input"
            ariaLabel={ctx.t("settings.theme")}
            value={ctx.theme}
            options={[
              { value: "light", label: ctx.t("settings.theme.light") },
              { value: "dark", label: ctx.t("settings.theme.dark") },
              ...props.themes.map((theme) => ({ value: theme.name, label: theme.name })),
            ]}
            onChange={(id) => {
              ctx.onTheme?.(id, props.themes.find((t) => t.name === id)?.url);
              // 持久化（用户反馈：选深色刷新回落亮色——改前只切内存不落盘）：settings.json
              // ui.theme；旧服务器无 putSettings 静默跳过
              void ctx.client.putSettings?.({ ui: { theme: id } }).catch(() => {});
            }}
          />
        </div>
        <PreviewRow
          ctx={ctx}
          kind="file"
          label={ctx.t("settings.preview.file")}
          hint={ctx.t("settings.preview.fileHint")}
        />
        <PreviewRow
          ctx={ctx}
          kind="image"
          label={ctx.t("settings.preview.image")}
          hint={ctx.t("settings.preview.imageHint")}
        />
      </div>
    </div>
  );
}

export { AppearancePage };
