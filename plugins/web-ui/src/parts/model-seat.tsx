// 官方件：模型席（单槽 composer.model，R183；dsh conversation.input.model 行为层——
// 模型与思考档同一席，dsh ui-model-selection 同包两个控件）。数据全部来自
// ctx.composer（ComposerDock 注入）：模型/档位状态、目录快照、会话级绑定写。
// 档位数据驱动（思考档批 2026-11-19）：档位集合来自模型条目 reasoningOptions（models.dev
// 真源——toggle=关/开两档、effort=厂商档位映射四档子集）；目录未到/无数据 → 形状表兜底；
// 形状族 none 或仅 budget 声明 → 置灰「—」。切模型后当前档不在新集合 → clamp
//（不渲染不存在的档）；本席被第三方顶替时 clamp 归顶替件自理（状态存储仍在运行时）。

import type { ReasoningOption } from "@henira/protocol";
import {
  type ReasoningCapability,
  type ReasoningEffort,
  reasoningCapability,
  reasoningLevels,
} from "@henira/protocol";
import { useEffect, useMemo } from "react";
import type { ModelCatalog, WebPart } from "../types.js";
import { HeniraSelect } from "./dropdown.js";
import { BrainGlyph } from "./icons.js";
import { ModelSelect } from "./model-select.js";

const EMPTY_CATALOG: ModelCatalog = {};

export const ModelSeat: WebPart = (ctx) => {
  const api = ctx.composer;
  const model = api?.model ?? "";
  const effort = api?.effort ?? null;
  const catalog = api?.catalog ?? EMPTY_CATALOG;

  const capability: ReasoningCapability =
    model === "" ? "none" : reasoningCapability(model.split("/")[0] ?? "");
  // 档位集合：模型级数据真源（catalog 条目的 reasoningOptions）；目录未到/无数据 → 形状表兜底
  const providerId = model === "" ? "" : (model.split("/")[0] ?? "");
  const modelId = model === "" ? "" : model.slice(providerId.length + 1);
  const modelOptions: ReasoningOption[] | undefined = catalog[providerId]?.models?.find(
    (m) => m.id === modelId,
  )?.reasoningOptions;
  const levels = useMemo(
    () => reasoningLevels(capability, modelOptions),
    [capability, modelOptions],
  );
  // toggle-only 模型（如 agnes）：两档文案「关/开」（「开」承载值 medium——server 枚举只认四值）。
  // 开关族且数据无 effort 档（含目录数据缺省）即按开关呈现
  const toggleOnly =
    (capability === "thinking" || capability === "enable" || capability === "template-enable") &&
    modelOptions?.some((o) => o.type === "effort") !== true;

  // 切模型后档位校验：当前值不在新可选集合 → clamp 到首个非 off（toggle 模型优先「开」=medium）；
  // 置灰（集合空）不动存储值——切回可调模型时恢复
  useEffect(() => {
    if (api === undefined || levels.length === 0) return;
    const current = effort ?? "off";
    if (levels.includes(current)) return;
    const next = levels.includes("medium") ? "medium" : (levels.find((l) => l !== "off") ?? "off");
    api.setEffort(next);
  }, [api, levels, effort]);

  if (api === undefined || !api.settingsReady) return null;

  return (
    <>
      <ModelSelect
        ctx={ctx}
        value={model}
        onChange={api.setModel}
        ariaLabel={ctx.t("composer.model")}
        direction="up"
        providers={catalog}
      />
      {/* 思考档：档位集合数据驱动（模型 reasoningOptions）——
          空集合（none/budget/形状未收录）置灰「—」；toggle-only 两档「关/开」；
          弹层 = HeniraSelect 自制面板（原生 select 系统菜单退场，基础件批 2026-11-20） */}
      {levels.length === 0 ? (
        <span
          className="henira-thinking-select"
          data-disabled="true"
          title={ctx.t("composer.thinking.none")}
        >
          <BrainGlyph size={14} />
          <span aria-hidden="true">—</span>
        </span>
      ) : (
        <span className="henira-thinking-select">
          <BrainGlyph size={14} />
          <HeniraSelect
            ariaLabel={ctx.t("composer.thinking")}
            value={effort ?? "off"}
            direction="up"
            options={levels.map((level) => ({
              value: level,
              label: ctx.t(
                toggleOnly && level === "medium"
                  ? "composer.thinking.on"
                  : `composer.thinking.${level}`,
              ),
            }))}
            onChange={(next) => {
              api.setEffort(next as ReasoningEffort);
            }}
          />
        </span>
      )}
    </>
  );
};
