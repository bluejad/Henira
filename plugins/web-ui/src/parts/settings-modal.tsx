// 设置弹窗（用户裁定 2026-11-18：左菜单右内容，只列现有三项——主题 / 语言 / 模型管理）。
// BC SettingsPanel 行为层参照（分区导航 + 右侧内容），分区收敛为现有能力；模型管理页 =
// 当前模型下拉（ModelSelect 共享件）+ 服务商密钥。开合状态归宿主（ctx.settingsSection /
// openSettings / closeSettings），本件只渲染当前分区。

import type { ReasoningCapability } from "@henira/protocol";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { SettingsSection, UiAssetLocale, UiAssetTheme, WebPartContext } from "../types.js";
import { BrainGlyph, GearGlyph, XGlyph } from "./icons.js";
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
          // 持久化（用户反馈：选深色刷新回落亮色——改前只切内存不落盘）：settings.json
          // ui.theme；旧服务器无 putSettings 静默跳过
          void ctx.client.putSettings?.({ ui: { theme: id } }).catch(() => {});
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
  // 显示实际生效语言（宿主 ctx.locale——boot 已按磁盘还原过）：包卸载/字典损坏 boot 回落
  // 官方后这里跟手，不再读磁盘旧值漂移显示（改前读 getSettings 与生效脱节，审查 P3-b）；
  // 缺席（旧宿主）= 官方 zh
  const [localeId, setLocaleId] = useState(ctx.locale ?? "zh");

  const changeLocale = (lang: string): void => {
    if (lang === "zh") {
      setLocaleId("zh");
      ctx.onLocale?.(undefined, "zh"); // 官方 zh = 无覆盖字典
      // 持久化（与主题同款两处断头的另一半）：settings.json ui.locale
      void ctx.client.putSettings?.({ ui: { locale: "zh" } }).catch(() => {});
      return;
    }
    const url = props.locales.find((l) => l.lang === lang)?.url;
    if (url === undefined) return; // 选项本就来自资产清单——防御性兜底
    // 字典 fetch 成功才应用+落盘——失败/空字典不应用不落盘，不留下「装不上的语言」
    //（改前先 setLocaleId+落盘再 fetch，失败后显示与磁盘都漂移，审查 P3-b）
    void fetch(url)
      .then((r) => r.json())
      .then((dict: Record<string, string>) => {
        if (Object.keys(dict).length === 0) return;
        setLocaleId(lang);
        ctx.onLocale?.(dict, lang);
        void ctx.client.putSettings?.({ ui: { locale: lang } }).catch(() => {});
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

// ── 模型管理页（BC ModelsPanel 行为层参照，四视图：分组列表 / 厂商选择 / 连接已知 / 自定义）──
// 数据面：listProviders（连接态+显隐开关）/ listModelPresets（厂商选择全表）/ connect /
// disconnect / setModelEnabled / putCustomProvider（宿主缺 = 只渲染默认模型页）。
// key 形态纪律（D-030）：password 输入只写 credentials.json，永不回显。
// 请求头不收——引擎不消费的字段不造假配置。

const HOT_PROVIDERS = new Set([
  "deepseek",
  "zhipuai",
  "moonshotai",
  "alibaba",
  "volcengine",
  "siliconflow",
  "anthropic",
  "google",
  "openai",
  "openrouter",
  "xai",
  "mistral",
  "groq",
  "togetherai",
]);

interface ProviderGroup {
  id: string;
  name?: string;
  reasoning?: ReasoningCapability;
  connected: boolean;
  models: Array<{ id: string; name?: string; contextWindow?: number; enabled: boolean }>;
}

interface ModelPreset {
  name?: string;
  models: Record<string, { name?: string; contextWindow?: number }>;
}

type ModelsView = "list" | "picker" | "known" | "custom";

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** 上下文窗紧凑显示（BC 同档：≥1M 显 M、其余 k） */
function fmtWindow(n?: number): string {
  if (n === undefined || n <= 0) return "";
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
}

function ModelsPage(props: { ctx: WebPartContext }): ReactNode {
  const { ctx } = props;
  const [view, setView] = useState<ModelsView>("list");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [presets, setPresets] = useState<Record<string, ModelPreset>>({});
  const [target, setTarget] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const hasPanel = ctx.client.listProviders !== undefined;

  const reloadProviders = (): void => {
    void ctx.client
      .listProviders?.()
      .then((r) => {
        setGroups(r.providers);
      })
      .catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (alive && s.model !== undefined) setModel(s.model);
      })
      .catch(() => {});
    void ctx.client
      .listProviders?.()
      .then((r) => {
        if (alive) setGroups(r.providers);
      })
      .catch(() => {});
    void ctx.client
      .listModelPresets?.()
      .then((r) => {
        if (alive) setPresets(r.presets);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client]);

  const ready = ctx.client.putSettings !== undefined;
  const save = (): void => {
    const patch: { model?: string } = {};
    if (model.trim() !== "") patch.model = model.trim();
    void props.ctx.client
      .putSettings?.(patch)
      .then(() => {
        setSaved(true);
      })
      .catch(() => {});
  };

  const toggle = async (group: ProviderGroup, modelId: string, enabled: boolean): Promise<void> => {
    setError(null);
    try {
      await ctx.client.setModelEnabled?.(group.id, modelId, enabled);
      reloadProviders();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const disconnect = async (id: string): Promise<void> => {
    setError(null);
    try {
      await ctx.client.disconnectProvider?.(id);
      reloadProviders();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const doRefresh = async (): Promise<void> => {
    setRefreshMsg(null);
    try {
      const r = await ctx.client.refreshModelPresets?.();
      const ok = r?.ok === true;
      setRefreshMsg(ctx.t(ok ? "settings.models.refreshOk" : "settings.models.refreshFail"));
      if (ok) {
        const p = await ctx.client.listModelPresets?.();
        if (p !== undefined) setPresets(p.presets);
      }
    } catch {
      setRefreshMsg(ctx.t("settings.models.refreshFail"));
    }
  };

  // ── 视图一：分组列表（默认模型 + 厂商分组 + 模型开关 + 搜索）──

  const q = query.trim().toLowerCase();
  const visibleGroups = groups.filter(
    (g) =>
      q === "" ||
      g.name?.toLowerCase().includes(q) === true ||
      g.id.toLowerCase().includes(q) ||
      g.models.some((m) => `${g.id}/${m.id}`.toLowerCase().includes(q)),
  );

  const renderList = (): ReactNode => (
    <div className="henira-models-panel">
      {ready ? (
        <div className="henira-dialog-field">
          <div className="henira-field-label">{ctx.t("settings.models.current")}</div>
          <div className="henira-models-current">
            <ModelSelect
              ctx={ctx}
              value={model}
              onChange={setModel}
              ariaLabel={ctx.t("settings.models.current")}
            />
            {saved ? <span className="henira-models-saved">{ctx.t("settings.saved")}</span> : null}
            <button type="button" className="henira-primary" onClick={save} disabled={!ready}>
              {ctx.t("settings.save")}
            </button>
          </div>
        </div>
      ) : null}
      {hasPanel ? (
        <>
          <div className="henira-models-toolbar">
            <span className="henira-models-hint">{ctx.t("settings.models.toggleHint")}</span>
            <button
              type="button"
              className="henira-primary"
              onClick={() => {
                setError(null);
                setPickerQuery("");
                setView("picker");
              }}
            >
              {ctx.t("settings.models.addProvider")}
            </button>
          </div>
          {groups.length === 0 ? (
            <div className="henira-models-hint">{ctx.t("settings.models.empty")}</div>
          ) : null}
          <input
            className="henira-input henira-models-search"
            placeholder={ctx.t("settings.models.searchModels")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          {visibleGroups.map((group) => (
            <div key={group.id} className="henira-provider-group">
              <div className="henira-provider-head">
                <span className="henira-provider-name">{group.name ?? group.id}</span>
                <button
                  type="button"
                  className="henira-provider-disconnect"
                  title={ctx.t("settings.models.disconnectTip")}
                  onClick={() => {
                    void disconnect(group.id);
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
                  return (
                    <div key={m.id} className={`henira-model-row${on ? "" : " is-off"}`}>
                      <span className="henira-model-label" title={`${group.id}/${m.id}`}>
                        {m.name ?? m.id}
                      </span>
                      <span className="henira-model-meta">
                        {fmtWindow(m.contextWindow)}
                        {group.reasoning !== undefined && group.reasoning !== "none" ? (
                          <>
                            {" · "}
                            <BrainGlyph size={11} />
                          </>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${group.id}/${m.id}`}
                        className={`henira-switch${on ? " is-on" : ""}`}
                        onClick={() => {
                          void toggle(group, m.id, !on);
                        }}
                      >
                        <span className="henira-switch-knob" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ))}
        </>
      ) : null}
      {error !== null ? <div className="henira-models-error">{error}</div> : null}
    </div>
  );

  // ── 视图二：厂商选择页（热门置顶 + 字母序其余 + 自定义入口 + 目录刷新）──

  const renderPicker = (): ReactNode => {
    const pq = pickerQuery.trim().toLowerCase();
    const all = Object.entries(presets)
      .map(([id, p]) => ({
        id,
        name: p.name ?? id,
        connected: groups.some((g) => g.id === id),
      }))
      .filter(({ id, name }) => pq === "" || id.includes(pq) || name.toLowerCase().includes(pq));
    const hot = all
      .filter(({ id, connected }) => HOT_PROVIDERS.has(id) || connected)
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
    const rest = all
      .filter(({ id }) => !HOT_PROVIDERS.has(id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const item = (entry: { id: string; name: string; connected: boolean }): ReactNode => (
      <button
        key={entry.id}
        type="button"
        className="henira-picker-item"
        onClick={() => {
          setTarget(entry.id);
          setError(null);
          setView("known");
        }}
      >
        <span className="henira-picker-name">{entry.name}</span>
        <span className={`henira-picker-state${entry.connected ? " is-on" : ""}`}>
          {ctx.t(entry.connected ? "settings.models.connected" : "settings.models.notConnected")}
        </span>
      </button>
    );
    return (
      <div className="henira-models-panel">
        <div className="henira-models-toolbar">
          <span className="henira-models-hint">
            {ctx.t("settings.models.pickHint")} {all.length} {ctx.t("settings.models.pickHintUnit")}
          </span>
          <button
            type="button"
            className="henira-ghost"
            disabled={busy}
            onClick={() => {
              void doRefresh();
            }}
          >
            {ctx.t("settings.models.refresh")}
          </button>
        </div>
        {refreshMsg !== null ? <div className="henira-models-hint">{refreshMsg}</div> : null}
        <input
          className="henira-input henira-models-search"
          placeholder={ctx.t("settings.models.searchProviders")}
          value={pickerQuery}
          onChange={(e) => {
            setPickerQuery(e.target.value);
          }}
        />
        <div className="henira-provider-picker">
          {hot.length > 0 ? (
            <>
              <div className="henira-provider-section">{ctx.t("settings.models.hot")}</div>
              {hot.map(item)}
            </>
          ) : null}
          {rest.length > 0 ? (
            <>
              <div className="henira-provider-section">{ctx.t("settings.models.others")}</div>
              {rest.map(item)}
            </>
          ) : null}
          {all.length === 0 ? (
            <div className="henira-models-hint">{ctx.t("composer.modelsEmpty")}</div>
          ) : null}
          <button
            type="button"
            className="henira-picker-item"
            onClick={() => {
              setError(null);
              setView("custom");
            }}
          >
            <span className="henira-picker-name">
              <GearGlyph size={12} /> {ctx.t("settings.models.customEntry")}
            </span>
            <span className="henira-picker-tag">{ctx.t("settings.models.customTag")}</span>
          </button>
        </div>
        {error !== null ? <div className="henira-models-error">{error}</div> : null}
        <button
          type="button"
          className="henira-ghost"
          onClick={() => {
            setView("list");
          }}
        >
          {ctx.t("settings.models.back")}
        </button>
      </div>
    );
  };

  // ── 视图三/四 ──

  if (view === "picker") return renderPicker();
  if (view === "list") return renderList();
  if (view === "known" && target !== null) {
    return (
      <KnownProviderForm
        ctx={ctx}
        targetId={target}
        targetName={presets[target]?.name ?? target}
        busy={busy}
        error={error}
        onSubmit={async (key) => {
          setBusy(true);
          setError(null);
          try {
            await ctx.client.connectProvider?.(target, key);
            setView("list");
            reloadProviders();
          } catch (err) {
            setError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => {
          setView("picker");
        }}
      />
    );
  }
  return (
    <CustomProviderForm
      ctx={ctx}
      busy={busy}
      error={error}
      onSubmit={async (input) => {
        setBusy(true);
        setError(null);
        try {
          await ctx.client.putCustomProvider?.(input);
          setView("list");
          reloadProviders();
        } catch (err) {
          setError(errMsg(err));
        } finally {
          setBusy(false);
        }
      }}
      onCancel={() => {
        setView("picker");
      }}
    />
  );
}

// ── 连接已知厂商（只填一把 key—— Henira 无 env 兜底，必填）──

function KnownProviderForm(props: {
  ctx: WebPartContext;
  targetId: string;
  targetName: string;
  busy: boolean;
  error: string | null;
  onSubmit(key: string): void;
  onCancel(): void;
}): ReactNode {
  const { ctx } = props;
  const [key, setKey] = useState("");
  return (
    <div className="henira-models-panel">
      <div className="henira-provider-form-title">
        {ctx.t("settings.models.connectTitle")} {props.targetName}
      </div>
      <div className="henira-models-hint">{ctx.t("settings.models.keyHint")}</div>
      <label className="henira-dialog-field">
        <div className="henira-field-label">{ctx.t("settings.models.keyLabel")}</div>
        <input
          className="henira-input"
          type="password"
          value={key}
          placeholder={ctx.t("settings.models.keyPlaceholder")}
          onChange={(e) => {
            setKey(e.target.value);
          }}
        />
      </label>
      {props.error !== null ? <div className="henira-models-error">{props.error}</div> : null}
      <div className="henira-model-form-actions">
        <button
          type="button"
          className="henira-primary"
          disabled={props.busy}
          onClick={() => {
            props.onSubmit(key);
          }}
        >
          {ctx.t("settings.models.submit")}
        </button>
        <button
          type="button"
          className="henira-ghost"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          {ctx.t("settings.models.back")}
        </button>
      </div>
    </div>
  );
}

// ── 自定义 OpenAI 兼容厂商（显示名 / baseUrl / 可选 key / 显式模型清单）──

interface CustomModelRow {
  key: number;
  model: string;
  label: string;
}

function CustomProviderForm(props: {
  ctx: WebPartContext;
  busy: boolean;
  error: string | null;
  onSubmit(input: {
    label?: string;
    baseUrl: string;
    key?: string;
    models: Array<{ model: string; label?: string }>;
  }): void;
  onCancel(): void;
}): ReactNode {
  const { ctx } = props;
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const nextKey = useRef(1);
  const [rows, setRows] = useState<CustomModelRow[]>([{ key: 0, model: "", label: "" }]);
  const [localError, setLocalError] = useState<string | null>(null);
  const err = localError ?? props.error;

  return (
    <div className="henira-models-panel">
      <div className="henira-provider-form-title">{ctx.t("settings.models.customTitle")}</div>
      <div className="henira-models-hint">{ctx.t("settings.models.customHint")}</div>
      <label className="henira-dialog-field">
        <div className="henira-field-label">{ctx.t("settings.models.formLabel")}</div>
        <input
          className="henira-input"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
      </label>
      <label className="henira-dialog-field">
        <div className="henira-field-label">{ctx.t("settings.models.formBaseUrl")}</div>
        <input
          className="henira-input"
          value={baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(e) => {
            setBaseUrl(e.target.value);
          }}
        />
      </label>
      <label className="henira-dialog-field">
        <div className="henira-field-label">{ctx.t("settings.models.formKey")}</div>
        <input
          className="henira-input"
          type="password"
          value={key}
          placeholder={ctx.t("settings.models.keyPlaceholder")}
          onChange={(e) => {
            setKey(e.target.value);
          }}
        />
      </label>
      <div className="henira-field-label">{ctx.t("settings.models.formModels")}</div>
      {rows.map((row, i) => (
        <div key={row.key} className="henira-custom-model-row">
          <input
            className="henira-input"
            placeholder={ctx.t("settings.models.formModelId")}
            value={row.model}
            onChange={(e) => {
              setRows(rows.map((r, j) => (j === i ? { ...r, model: e.target.value } : r)));
            }}
          />
          <input
            className="henira-input"
            placeholder={ctx.t("settings.models.formModelName")}
            value={row.label}
            onChange={(e) => {
              setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)));
            }}
          />
          <button
            type="button"
            className="henira-ghost"
            title={ctx.t("settings.models.removeModel")}
            onClick={() => {
              setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows);
            }}
          >
            <XGlyph size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="henira-ghost"
        onClick={() => {
          setRows([...rows, { key: nextKey.current++, model: "", label: "" }]);
        }}
      >
        {ctx.t("settings.models.addModel")}
      </button>
      {err !== null ? <div className="henira-models-error">{err}</div> : null}
      <div className="henira-model-form-actions">
        <button
          type="button"
          className="henira-primary"
          disabled={props.busy}
          onClick={() => {
            if (baseUrl.trim() === "") {
              setLocalError(ctx.t("settings.models.errBaseUrl"));
              return;
            }
            const valid = rows.filter((r) => r.model.trim() !== "");
            if (valid.length === 0) {
              setLocalError(ctx.t("settings.models.errModels"));
              return;
            }
            setLocalError(null);
            props.onSubmit({
              ...(label.trim() === "" ? {} : { label: label.trim() }),
              baseUrl: baseUrl.trim(),
              ...(key.trim() === "" ? {} : { key: key.trim() }),
              models: valid.map((r) => ({
                model: r.model.trim(),
                ...(r.label.trim() === "" ? {} : { label: r.label.trim() }),
              })),
            });
          }}
        >
          {props.busy ? ctx.t("settings.models.submitting") : ctx.t("settings.models.submit")}
        </button>
        <button
          type="button"
          className="henira-ghost"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          {ctx.t("settings.models.back")}
        </button>
      </div>
    </div>
  );
}
