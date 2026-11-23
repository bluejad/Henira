// 模型管理·分组列表视图（R187 拆分；R188 视觉收口：厂商标记/去点串/加载态/断开 hover）。
import type { ReactNode } from "react";
import type { WebPartContext } from "../../../types.js";
import { BrainGlyph } from "../../icons.js";
import { fmtWindow } from "../../model-select.js";
import { type ProviderGroup, providerMark } from "./shared.js";

export function ModelsList(props: {
  ctx: WebPartContext;
  hasPanel: boolean;
  groups: readonly ProviderGroup[];
  query: string;
  onQueryChange(value: string): void;
  loading: boolean;
  error: string | null;
  onAdd(): void;
  onToggle(group: ProviderGroup, modelId: string, enabled: boolean): void;
  onDisconnect(id: string): void;
}): ReactNode {
  const { ctx } = props;
  const q = props.query.trim().toLowerCase();
  // 主列表只列已连接厂商（未连接不进组列表，连接入口走「＋ 连接提供商」；
  // 每家连接态只在挑选页显示）。数据层不动——断开止血后 baseUrl/label 仍保留在 models.json
  const connectedGroups = props.groups.filter((g) => g.connected);
  const visibleGroups = connectedGroups.filter(
    (g) =>
      q === "" ||
      g.name?.toLowerCase().includes(q) === true ||
      g.id.toLowerCase().includes(q) ||
      g.models.some((m) => `${g.id}/${m.id}`.toLowerCase().includes(q)),
  );

  return (
    <div className="henira-models-panel">
      <header className="henira-settings-page-head">
        <h2>{ctx.t("settings.models.pageTitle")}</h2>
        <p>{ctx.t("settings.models.pageHint")}</p>
      </header>
      {props.hasPanel ? (
        <>
          <div className="henira-models-toolbar">
            <input
              className="henira-input henira-models-search"
              placeholder={ctx.t("settings.models.searchModels")}
              value={props.query}
              onChange={(e) => {
                props.onQueryChange(e.target.value);
              }}
            />
            <button type="button" className="henira-primary" onClick={props.onAdd}>
              {ctx.t("settings.models.addProvider")}
            </button>
          </div>
          <div className="henira-models-hint">{ctx.t("settings.models.toggleHint")}</div>
          {props.loading ? (
            <div className="henira-models-hint">{ctx.t("settings.models.loading")}</div>
          ) : connectedGroups.length === 0 ? (
            <div className="henira-models-hint">{ctx.t("settings.models.empty")}</div>
          ) : (
            visibleGroups.map((group) => (
              <div key={group.id} className="henira-provider-group">
                <div className="henira-provider-head">
                  <span className="henira-provider-mark" aria-hidden="true">
                    {providerMark(group.name, group.id)}
                  </span>
                  <span className="henira-provider-name">{group.name ?? group.id}</span>
                  {/* 主列表只有已连接组（上面过滤）——断开钮 hover/focus 浮现，点后组即从列表消失
                      （数据层保留 baseUrl/label，重连不用再填地址；2026-11-19） */}
                  <button
                    type="button"
                    className="henira-provider-disconnect"
                    title={ctx.t("settings.models.disconnectTip")}
                    onClick={() => {
                      props.onDisconnect(group.id);
                    }}
                  >
                    {ctx.t("settings.models.disconnect")}
                  </button>
                </div>
                {group.models.length === 0 ? (
                  <div className="henira-models-hint">{ctx.t("settings.models.groupEmpty")}</div>
                ) : (
                  group.models.map((m) => {
                    const on = m.enabled;
                    const window = fmtWindow(m.contextWindow);
                    return (
                      <div key={m.id} className={`henira-model-row${on ? "" : " is-off"}`}>
                        <span className="henira-model-label" title={`${group.id}/${m.id}`}>
                          {m.name ?? m.id}
                        </span>
                        <span className="henira-model-meta">
                          {window !== "" ? (
                            <span
                              className="henira-model-meta-window"
                              title={`${ctx.t("settings.models.contextWindow")} ${window}`}
                            >
                              {window}
                            </span>
                          ) : null}
                          {m.vision === true ? (
                            <span className="henira-model-tag">
                              {ctx.t("settings.models.visionBadge")}
                            </span>
                          ) : null}
                          {m.reasoning === true ? (
                            <span
                              className="henira-model-meta-icon"
                              title={ctx.t("settings.models.reasoningBadge")}
                            >
                              <BrainGlyph size={12} />
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${group.id}/${m.id}`}
                          className={`henira-switch${on ? " is-on" : ""}`}
                          onClick={() => {
                            props.onToggle(group, m.id, !on);
                          }}
                        >
                          <span className="henira-switch-knob" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ))
          )}
        </>
      ) : null}
      {props.error !== null ? <div className="henira-models-error">{props.error}</div> : null}
    </div>
  );
}
