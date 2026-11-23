// 模型管理页（R187 拆分）：四视图（分组列表 / 厂商选择 / 连接已知 / 自定义）。
// 数据面：listProviders（连接态+显隐开关）/ listModelPresets（厂商选择全表）/ connect /
// disconnect / setModelEnabled / putCustomProvider（宿主缺 = 只渲染默认模型页）。
// key 形态纪律（D-030）：password 输入只写 credentials.json，永不回显。
// 请求头不收——引擎不消费的字段不造假配置。
import { type ReactNode, useEffect, useState } from "react";
import type { WebPartContext } from "../../../types.js";
import { KnownProviderForm } from "./connect.js";
import { CustomProviderForm } from "./custom.js";
import { ModelsList } from "./list.js";
import { ModelsPicker } from "./picker.js";
import { errMsg, type ModelPreset, type ModelsView, type ProviderGroup } from "./shared.js";

export function ModelsPage(props: { ctx: WebPartContext }): ReactNode {
  const { ctx } = props;
  const [view, setView] = useState<ModelsView>("list");
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [presets, setPresets] = useState<Record<string, ModelPreset>>({});
  const [loading, setLoading] = useState(ctx.client.listProviders !== undefined);
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
      .listProviders?.()
      .then((r) => {
        if (alive) setGroups(r.providers);
      })
      .catch((err) => {
        if (alive) setError(errMsg(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
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

  const toggle = async (group: ProviderGroup, modelId: string, enabled: boolean): Promise<void> => {
    setError(null);
    try {
      await ctx.client.setModelEnabled?.(group.id, modelId, enabled);
      reloadProviders();
      ctx.notifyModelCatalogChanged?.(); // 目录广播——composer 即时重拉（选择器当步跟上）
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const disconnect = async (id: string): Promise<void> => {
    setError(null);
    try {
      await ctx.client.disconnectProvider?.(id);
      reloadProviders();
      ctx.notifyModelCatalogChanged?.(); // 目录广播——断开当场回落，不等设置关闭
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const doRefresh = async (): Promise<void> => {
    setBusy(true); // 双击防抖——刷新与表单共用 busy（审查 P3 2026-11-19：改前 disabled 不生效）
    setRefreshMsg(null);
    try {
      const r = await ctx.client.refreshModelPresets?.();
      const ok = r?.ok === true;
      setRefreshMsg(ctx.t(ok ? "settings.models.refreshOk" : "settings.models.refreshFail"));
      if (ok) {
        const p = await ctx.client.listModelPresets?.();
        if (p !== undefined) setPresets(p.presets);
        ctx.notifyModelCatalogChanged?.(); // 目录刷新后显示名/上下文窗可能变——composer 跟上
      }
    } catch {
      setRefreshMsg(ctx.t("settings.models.refreshFail"));
    } finally {
      setBusy(false);
    }
  };

  if (view === "picker") {
    return (
      <ModelsPicker
        ctx={ctx}
        presets={presets}
        groups={groups}
        pickerQuery={pickerQuery}
        onPickerQueryChange={setPickerQuery}
        busy={busy}
        error={error}
        refreshMsg={refreshMsg}
        onBack={() => {
          setView("list");
        }}
        onRefresh={() => {
          void doRefresh();
        }}
        onPick={(id) => {
          setTarget(id);
          setError(null);
          setView("known");
        }}
        onCustom={() => {
          setError(null);
          setView("custom");
        }}
      />
    );
  }
  if (view === "list") {
    return (
      <ModelsList
        ctx={ctx}
        hasPanel={hasPanel}
        groups={groups}
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        error={error}
        onAdd={() => {
          setError(null);
          setPickerQuery("");
          setView("picker");
        }}
        onToggle={(group, modelId, enabled) => {
          void toggle(group, modelId, enabled);
        }}
        onDisconnect={(id) => {
          void disconnect(id);
        }}
      />
    );
  }
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
            ctx.notifyModelCatalogChanged?.(); // 连上即进选择器——目录广播（当步可见）
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
          ctx.notifyModelCatalogChanged?.(); // 自定义厂商进选择器——目录广播
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
