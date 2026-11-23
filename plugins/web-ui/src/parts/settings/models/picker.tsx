// 模型管理·厂商选择视图（R187 拆分；R188 视觉收口：页头/说明左对齐、厂商标记、分区计数）。
import type { ReactNode } from "react";
import type { WebPartContext } from "../../../types.js";
import { GearGlyph } from "../../icons.js";
import { HOT_PROVIDERS, type ModelPreset, type ProviderGroup, providerMark } from "./shared.js";

export function ModelsPicker(props: {
  ctx: WebPartContext;
  presets: Record<string, ModelPreset>;
  groups: readonly ProviderGroup[];
  pickerQuery: string;
  onPickerQueryChange(value: string): void;
  busy: boolean;
  error: string | null;
  refreshMsg: string | null;
  onBack(): void;
  onRefresh(): void;
  onPick(providerId: string): void;
  onCustom(): void;
}): ReactNode {
  const { ctx } = props;
  const pq = props.pickerQuery.trim().toLowerCase();
  const all = Object.entries(props.presets)
    .map(([id, p]) => ({
      id,
      name: p.name ?? id,
      connected: props.groups.some((g) => g.id === id && g.connected),
    }))
    .filter(({ id, name }) => pq === "" || id.includes(pq) || name.toLowerCase().includes(pq));
  const hot = all
    .filter(({ id, connected }) => HOT_PROVIDERS.has(id) || connected)
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  // 已连接的非热门厂商已在「热门」区——不要在两区重复出现
  const rest = all
    .filter(({ id, connected }) => !HOT_PROVIDERS.has(id) && !connected)
    .sort((a, b) => a.name.localeCompare(b.name));
  const item = (entry: { id: string; name: string; connected: boolean }): ReactNode => (
    <button
      key={entry.id}
      type="button"
      className="henira-picker-item"
      onClick={() => {
        props.onPick(entry.id);
      }}
    >
      <span className="henira-picker-name">
        <span className="henira-provider-mark" aria-hidden="true">
          {providerMark(entry.name, entry.id)}
        </span>
        {entry.name}
      </span>
      <span className={`henira-picker-state${entry.connected ? " is-on" : ""}`}>
        {ctx.t(entry.connected ? "settings.models.connected" : "settings.models.notConnected")}
      </span>
    </button>
  );
  return (
    <div className="henira-models-panel">
      <header className="henira-settings-page-head">
        <h2>{ctx.t("settings.models.pickerTitle")}</h2>
        <p>
          {ctx.t("settings.models.pickHint")} {all.length} {ctx.t("settings.models.pickHintUnit")}
        </p>
      </header>
      <div className="henira-models-toolbar">
        <button type="button" className="henira-ghost" onClick={props.onBack}>
          {ctx.t("settings.models.back")}
        </button>
        <span className="henira-models-toolbar-space" />
        <button
          type="button"
          className="henira-ghost"
          disabled={props.busy}
          onClick={props.onRefresh}
        >
          {ctx.t("settings.models.refresh")}
        </button>
      </div>
      {props.refreshMsg !== null ? (
        <div className="henira-models-hint">{props.refreshMsg}</div>
      ) : null}
      <input
        className="henira-input henira-models-search"
        placeholder={ctx.t("settings.models.searchProviders")}
        value={props.pickerQuery}
        onChange={(e) => {
          props.onPickerQueryChange(e.target.value);
        }}
      />
      <div className="henira-provider-picker">
        {/* 自定义入口第一行（用户拍板 2026-11-19：不用翻 324 行找入口） */}
        <button type="button" className="henira-picker-item" onClick={props.onCustom}>
          <span className="henira-picker-name">
            <GearGlyph size={14} /> {ctx.t("settings.models.customEntry")}
          </span>
          <span className="henira-picker-tag">{ctx.t("settings.models.customTag")}</span>
        </button>
        {hot.length > 0 ? (
          <>
            <div className="henira-provider-section">
              {ctx.t("settings.models.hot")}
              <span className="henira-provider-section-count">{hot.length}</span>
            </div>
            {hot.map(item)}
          </>
        ) : null}
        {rest.length > 0 ? (
          <>
            <div className="henira-provider-section">
              {ctx.t("settings.models.others")}
              <span className="henira-provider-section-count">{rest.length}</span>
            </div>
            {rest.map(item)}
          </>
        ) : null}
        {all.length === 0 ? (
          <div className="henira-models-hint">{ctx.t("composer.modelsEmpty")}</div>
        ) : null}
      </div>
      {props.error !== null ? <div className="henira-models-error">{props.error}</div> : null}
    </div>
  );
}
