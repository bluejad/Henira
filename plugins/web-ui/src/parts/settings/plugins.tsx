// 插件页（R177 拆分；R188 视觉收口）：页头 + 内置/可管理两段；行内去重复 id / 「官方」胶囊，
// 统一 switch；卸载 hover 浮现（仍带原生确认）。
import { type ReactNode, useEffect, useState } from "react";
import type { WebPartContext } from "../../types.js";

// ── 插件页（批 C，plugins.md §6.4）：列表 / 状态 / 启停 / 确认 / 卸载 + 装载告警 ──
// 状态模型见 §5（enabled 只是选择；loaded/failed/awaiting-confirm 才是装载结果）。
// 官方五件只读展示（不给关、不给版本钉、不可卸载——§5 :222）。

type PluginRow = Awaited<
  ReturnType<NonNullable<WebPartContext["client"]["listPlugins"]>>
>["plugins"][number];

const OFFICIAL_PLUGIN_IDS = new Set([
  "plugin-session",
  "plugin-tools",
  "plugin-llm",
  "plugin-approval",
  "plugin-loop",
]);

function pluginStateKey(state: PluginRow["state"]): "loaded" | "disabled" | "failed" | "confirm" {
  if (state === "loaded") return "loaded";
  if (state === "failed") return "failed";
  if (state === "awaiting-confirm") return "confirm";
  return "disabled";
}

function PluginsPage(props: { ctx: WebPartContext }): ReactNode {
  const { ctx } = props;
  const [rows, setRows] = useState<PluginRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listPlugins = ctx.client.listPlugins;
  const canManage = listPlugins !== undefined;

  // 弹窗打开期间 2s 跟手（与宿主轮询同频：AI 改插件后本页也跟手；hooks 在 early return 前）
  useEffect(() => {
    const list = listPlugins;
    if (list === undefined) return;
    const device = { alive: true };
    const load = (): void => {
      void list()
        .then((snapshot) => {
          if (device.alive) setRows(snapshot.plugins);
        })
        .catch(() => {
          if (device.alive) setRows([]);
        });
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      device.alive = false;
      clearInterval(timer);
    };
  }, [listPlugins]);

  const act = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      if (listPlugins !== undefined) {
        try {
          const snapshot = await listPlugins();
          setRows(snapshot.plugins);
        } catch {
          // 刷新失败保留旧列表（操作本身已由错误分支提示）
        }
      }
    }
  };

  if (!canManage) {
    return <div className="henira-field-hint">{ctx.t("settings.plugins.unsupported")}</div>;
  }

  const renderRow = (row: PluginRow): ReactNode => {
    const officialCore = OFFICIAL_PLUGIN_IDS.has(row.id);
    // plugin-mcp 是外圈官方件：可停用（不给卸载、版本钉）
    const builtin = officialCore || row.id === "plugin-mcp";
    const stateKey = pluginStateKey(row.state);
    return (
      <div
        key={row.id}
        className="henira-plugin-row"
        data-plugin-id={row.id}
        data-state={row.state}
      >
        <div className="henira-plugin-main">
          <div className="henira-plugin-title">
            <strong>{row.name}</strong>
            {stateKey !== "loaded" ? (
              <span className="henira-plugin-badge" data-state={stateKey}>
                {ctx.t(`settings.plugins.state.${stateKey}`)}
              </span>
            ) : null}
          </div>
          <div className="henira-plugin-meta">
            <span>v{row.version}</span>
            {row.forms.map((form) => (
              <span key={form} className="henira-plugin-form">
                {form}
              </span>
            ))}
          </div>
          {row.reason !== undefined ? (
            <span className="henira-form-error">{row.reason}</span>
          ) : null}
          {row.mcp !== undefined && row.mcp.length > 0 ? (
            <div className="henira-plugin-mcp">
              {row.mcp.map((server) => (
                <div key={server.name} className="henira-plugin-mcp-row" data-server={server.name}>
                  <code>{server.name}</code>
                  <span className="henira-field-hint">{server.target}</span>
                  <span
                    className="henira-plugin-badge"
                    data-state={server.confirmed ? "loaded" : "confirm"}
                  >
                    {ctx.t(
                      server.confirmed
                        ? "settings.plugins.mcpConfirmed"
                        : "settings.plugins.mcpAwaiting",
                    )}
                  </span>
                </div>
              ))}
              {!row.mcp.every((server) => server.confirmed) &&
              ctx.client.confirmPluginMcp !== undefined ? (
                <button
                  type="button"
                  className="henira-ghost"
                  disabled={busy === row.id}
                  onClick={() => {
                    const confirm = ctx.client.confirmPluginMcp;
                    if (confirm !== undefined) void act(row.id, () => confirm(row.id));
                  }}
                >
                  {ctx.t("settings.plugins.mcpConfirm")}
                </button>
              ) : null}
              <span className="henira-field-hint">{ctx.t("settings.plugins.mcpHint")}</span>
            </div>
          ) : null}
        </div>
        <div className="henira-plugin-actions">
          {row.state === "awaiting-confirm" && ctx.client.confirmPlugin !== undefined ? (
            <button
              type="button"
              className="henira-ghost"
              disabled={busy === row.id}
              onClick={() => {
                const confirm = ctx.client.confirmPlugin;
                if (confirm !== undefined) void act(row.id, () => confirm(row.id, row.version));
              }}
            >
              {ctx.t("settings.plugins.confirm")}
            </button>
          ) : null}
          {!officialCore ? (
            <button
              type="button"
              role="switch"
              aria-checked={row.enabled}
              aria-label={row.id}
              title={ctx.t("settings.plugins.enabled")}
              className={`henira-switch${row.enabled ? " is-on" : ""}`}
              disabled={busy === row.id || ctx.client.setPluginEnabled === undefined}
              onClick={() => {
                const setEnabled = ctx.client.setPluginEnabled;
                if (setEnabled !== undefined) {
                  void act(row.id, () => setEnabled(row.id, !row.enabled));
                }
              }}
            >
              <span className="henira-switch-knob" />
            </button>
          ) : null}
          {!builtin && ctx.client.removePlugin !== undefined ? (
            <button
              type="button"
              className="henira-plugin-remove"
              disabled={busy === row.id}
              onClick={() => {
                const remove = ctx.client.removePlugin;
                if (
                  remove !== undefined &&
                  window.confirm(ctx.t("settings.plugins.removeConfirm"))
                ) {
                  void act(row.id, () => remove(row.id));
                }
              }}
            >
              {ctx.t("settings.plugins.remove")}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const builtinRows = (rows ?? []).filter(
    (row) => OFFICIAL_PLUGIN_IDS.has(row.id) || row.id === "plugin-mcp",
  );
  const managedRows = (rows ?? []).filter(
    (row) => !OFFICIAL_PLUGIN_IDS.has(row.id) && row.id !== "plugin-mcp",
  );

  return (
    <div className="henira-settings-page henira-plugins-page">
      <header className="henira-settings-page-head">
        <h2>{ctx.t("settings.plugins.pageTitle")}</h2>
        <p>{ctx.t("settings.plugins.pageHint")}</p>
        {rows !== null ? (
          <div className="henira-plugin-summary">
            <span>
              {ctx.t("settings.plugins.installed")} {rows.length}
            </span>
            <span>
              {ctx.t("settings.plugins.builtin")} {builtinRows.length}
            </span>
          </div>
        ) : null}
      </header>
      {error !== null ? <div className="henira-form-error">{error}</div> : null}
      {rows === null ? <div className="henira-field-hint">{ctx.t("dirs.loading")}</div> : null}
      {rows !== null && rows.length === 0 ? (
        <div className="henira-field-empty">{ctx.t("settings.plugins.empty")}</div>
      ) : null}
      {builtinRows.length > 0 ? (
        <section className="henira-plugin-section">
          <div className="henira-plugin-section-head">
            {ctx.t("settings.plugins.builtinSection")}
            <span className="henira-plugin-section-count">{builtinRows.length}</span>
          </div>
          {builtinRows.map(renderRow)}
        </section>
      ) : null}
      {managedRows.length > 0 ? (
        <section className="henira-plugin-section">
          <div className="henira-plugin-section-head">
            {ctx.t("settings.plugins.managedSection")}
            <span className="henira-plugin-section-count">{managedRows.length}</span>
          </div>
          {managedRows.map(renderRow)}
        </section>
      ) : null}
    </div>
  );
}

export { PluginsPage };
