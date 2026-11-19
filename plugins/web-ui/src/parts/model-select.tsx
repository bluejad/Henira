// 模型选择弹层（BC ModelSelect 行为层参照：触发钮 + 搜索 + 按厂商分组 + 底部「管理模型…」）。
// 官方共享件：composer 工具排用（设置弹窗·模型管理页的全局默认选择入口已撤——用户裁定
// 2026-11-19：composer 会话级绑定即职责）。清单来自 client.listModels
//（key+baseUrl 齐备的厂商才出现——模型目录收敛批闸门）；选择只回调不落盘——语义归调用方
//（composer 会话绑定各自行事）。条目渲染显示名 + 上下文窗/视觉/思考徽章（BC 选择器档——裸 id 退场）；
// 触发钮同样只显示模型显示名（厂商 id 永不进按钮），绑定值目录里失效即回落清单首个
//（断开 DeepSeek 后按钮不挂着已断厂商——2026-11-19 BC 对齐）。

import type { ReasoningOption } from "@henira/protocol";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { WebPartContext } from "../types.js";
import { BrainGlyph, CaretDownGlyph, GearGlyph, MagnifierGlyph } from "./icons.js";

/** 选择器目录条目（types.ts listModels 同形；本地声明——web-ui 不依 sdk） */
export interface PickerModel {
  id: string;
  name?: string;
  contextWindow?: number;
  vision?: boolean;
  reasoning?: boolean;
  /** 思考档位集合真源（models.dev reasoning_options——composer 档位控件数据驱动） */
  reasoningOptions?: ReasoningOption[];
}
export type PickerProviders = Record<
  string,
  { name?: string; baseUrl?: string; models?: PickerModel[] }
>;

/** 上下文窗紧凑显示（BC 同档：≥1M 显 M 去尾零、其余 k）——设置页管理分组共用 */
export function fmtWindow(n?: number): string {
  if (n === undefined || n <= 0) return "";
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    const text = Number.isInteger(millions)
      ? String(millions)
      : millions.toFixed(1).replace(/\.0$/, "");
    return `${text}M`;
  }
  return `${Math.round(n / 1000)}k`;
}

const EMPTY_PROVIDERS: PickerProviders = {};

/** 目录反查：绑定值（provider/model）→ 条目；目录里没有返回 undefined */
function findModel(
  providers: PickerProviders,
  fullId: string,
): { fullId: string; label: string } | undefined {
  for (const [provider, entry] of Object.entries(providers)) {
    for (const m of entry.models ?? []) {
      if (`${provider}/${m.id}` === fullId) return { fullId, label: m.name ?? m.id };
    }
  }
  return undefined;
}

/** 清单首个可选条目（BC ModelSelect 回落语义：绑定失效 → 清单第一个） */
function firstModel(providers: PickerProviders): { fullId: string; label: string } | undefined {
  for (const [provider, entry] of Object.entries(providers)) {
    const first = entry.models?.[0];
    if (first !== undefined) {
      return { fullId: `${provider}/${first.id}`, label: first.name ?? first.id };
    }
  }
  return undefined;
}

export function ModelSelect(props: {
  ctx: WebPartContext;
  value: string;
  onChange(model: string): void;
  ariaLabel: string;
  /** 弹层展开方向：composer 在屏幕底部 → 向上；设置弹窗内 → 向下（缺省） */
  direction?: "up" | "down";
  /** 厂商目录（可选——调用方已拉取时下传，免二次请求；缺省自取 client.listModels） */
  providers?: PickerProviders;
}): ReactNode {
  const { ctx, value, onChange, ariaLabel } = props;
  const direction = props.direction ?? "down";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<PickerProviders>(EMPTY_PROVIDERS);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const providers = props.providers ?? fetched;

  // 每次展开自取目录（不开不拉——设置里新连的厂商下一开就在，免整页刷新）
  useEffect(() => {
    if (!open) return;
    if (props.providers !== undefined) return; // 调用方下传——不自取
    if (ctx.client.listModels === undefined) return;
    let alive = true;
    void ctx.client
      .listModels()
      .then((catalog) => {
        if (alive) setFetched(catalog.providers);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client, props.providers, open]);

  // 开着时点外 / Escape 收（监听只在 open 挂——关闭态零开销）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Array<{ provider: string; label: string; models: PickerModel[] }> = [];
    for (const [provider, entry] of Object.entries(providers)) {
      const models = (entry.models ?? []).filter(
        (m) =>
          q === "" ||
          `${provider}/${m.id}`.toLowerCase().includes(q) ||
          (m.name ?? "").toLowerCase().includes(q),
      );
      if (models.length > 0) out.push({ provider, label: entry.name ?? provider, models });
    }
    return out;
  }, [providers, query]);

  const hasCatalog = Object.keys(providers).length > 0;

  // 触发钮文案 = 目录条目的显示名（BC ModelSelect 同档：按钮上永不出厂商 id）。目录里
  // 没有该绑定值（断开/移除/禁用后失效）→ 裸模型 id 兜底，同样不带厂商前缀
  const current = value === "" ? undefined : findModel(providers, value);
  const fallback = value === "" ? undefined : firstModel(providers);
  const bareId = value.slice(value.indexOf("/") + 1);
  const currentLabel =
    value === "" ? ariaLabel : (current?.label ?? (bareId === "" ? value : bareId));

  // 绑定失效 → 回落清单首个（BC：current = 清单查 ?? 清单[0]——断开后按钮不会挂着已断厂商）。
  // 目录为空/未到不动：目录外绑定（如测试桩 model）在没有目录可比时不误换。
  useEffect(() => {
    if (value === "" || current !== undefined) return;
    if (fallback === undefined) return;
    onChange(fallback.fullId);
  }, [value, current, fallback, onChange]);

  return (
    <span className="henira-model-select" ref={wrapRef}>
      <button
        type="button"
        className="henira-model-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
      >
        <span className="henira-model-trigger-label">{currentLabel}</span>
        <CaretDownGlyph size={10} />
      </button>
      {open ? (
        <span className="henira-model-popover" data-direction={direction}>
          <span className="henira-model-search-row">
            <MagnifierGlyph size={12} />
            <input
              value={query}
              placeholder={ctx.t("composer.modelSearch")}
              aria-label={ctx.t("composer.modelSearch")}
              className="henira-model-search"
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </span>
          {hasCatalog ? (
            <span role="listbox" aria-label={ariaLabel} className="henira-model-list">
              {groups.map((group) => (
                <span key={group.provider} className="henira-model-group">
                  <span className="henira-model-group-label">{group.label}</span>
                  {group.models.map((m) => {
                    const fullId = `${group.provider}/${m.id}`;
                    return (
                      <button
                        key={fullId}
                        type="button"
                        role="option"
                        aria-selected={fullId === value}
                        className="henira-model-item"
                        data-active={fullId === value ? "true" : undefined}
                        title={fullId}
                        onClick={() => {
                          setOpen(false);
                          onChange(fullId);
                        }}
                      >
                        <span className="henira-model-item-label">{m.name ?? m.id}</span>
                        {m.contextWindow !== undefined ||
                        m.vision === true ||
                        m.reasoning === true ? (
                          <span className="henira-model-item-meta">
                            {fmtWindow(m.contextWindow) !== "" ? (
                              <span>{fmtWindow(m.contextWindow)}</span>
                            ) : null}
                            {m.vision === true ? (
                              <span>{ctx.t("settings.models.visionBadge")}</span>
                            ) : null}
                            {m.reasoning === true ? <BrainGlyph size={11} /> : null}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </span>
              ))}
              {groups.length === 0 ? (
                <span className="henira-model-empty">{ctx.t("composer.modelsEmpty")}</span>
              ) : null}
            </span>
          ) : (
            <span className="henira-model-empty">{ctx.t("settings.models.catalogEmpty")}</span>
          )}
          {ctx.openSettings !== undefined ? (
            <button
              type="button"
              className="henira-model-manage"
              onClick={() => {
                setOpen(false);
                ctx.openSettings?.("models");
              }}
            >
              <GearGlyph size={12} />
              {ctx.t("composer.manageModels")}
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
