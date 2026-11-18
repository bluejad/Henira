// 模型选择弹层（BC ModelSelect 行为层参照：触发钮 + 搜索 + 按厂商分组 + 底部「管理模型…」）。
// 官方共享件：composer 工具排与设置弹窗·模型管理页同用一份。清单来自 client.listModels
//（手写 models.json + models.dev 快照，无密钥）；选择只回调不落盘——语义归调用方
//（composer 会话绑定 / 设置页全局默认各自行事）。

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { WebPartContext } from "../types.js";
import { CaretDownGlyph, GearGlyph, MagnifierGlyph } from "./icons.js";

const EMPTY_PROVIDERS: Record<string, { models?: string[] }> = {};

export function ModelSelect(props: {
  ctx: WebPartContext;
  value: string;
  onChange(model: string): void;
  ariaLabel: string;
  /** 弹层展开方向：composer 在屏幕底部 → 向上；设置弹窗内 → 向下（缺省） */
  direction?: "up" | "down";
  /** 厂商目录（可选——调用方已拉取时下传，免二次请求；缺省自取 client.listModels） */
  providers?: Record<string, { models?: string[] }>;
}): ReactNode {
  const { ctx, value, onChange, ariaLabel } = props;
  const direction = props.direction ?? "down";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState(EMPTY_PROVIDERS);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const providers = props.providers ?? fetched;

  useEffect(() => {
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
  }, [ctx.client, props.providers]);

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
    const out: Array<{ provider: string; models: string[] }> = [];
    for (const [provider, entry] of Object.entries(providers)) {
      const models = (entry.models ?? [])
        .map((m) => `${provider}/${m}`)
        .filter((id) => q === "" || id.toLowerCase().includes(q));
      if (models.length > 0) out.push({ provider, models });
    }
    return out;
  }, [providers, query]);

  const hasCatalog = Object.keys(providers).length > 0;

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
        <span className="henira-model-trigger-label">{value === "" ? ariaLabel : value}</span>
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
                  <span className="henira-model-group-label">{group.provider}</span>
                  {group.models.map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={id === value}
                      className="henira-model-item"
                      data-active={id === value ? "true" : undefined}
                      title={id}
                      onClick={() => {
                        setOpen(false);
                        onChange(id);
                      }}
                    >
                      {id}
                    </button>
                  ))}
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
