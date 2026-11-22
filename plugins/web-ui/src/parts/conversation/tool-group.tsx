// 过程组（R178）：相邻思考/工具项聚合（含思考 ≥2 项折叠）。组头 = 运行中当前活动项的
// 摘要行（不挂详情/交互）或统计「已查阅 N 项，已执行 N 命令，已修改 N 文件」；展开 = 原序子行 + 左导线。
import type { AssistantRow, Row, ToolRow } from "@henira/protocol";
import { useState } from "react";
import type { WebPartContext } from "../../types.js";
import { BrainGlyph, CaretGlyph } from "../icons.js";
import { baseName } from "../tool-cards/shell.js";
import { categoryGlyph } from "../tool-icons.js";
import { ToolPreviewContext } from "../tool-preview.js";
import { reasoningPreview } from "./format.js";
import { RowView } from "./rows.js";
import type { WorkStats } from "./turn-items.js";

const SEPARATOR = "，";

/** 统计文案（运行中未完成措辞 / 完成后「已」措辞；中文逗号分隔、无「个/条」）。 */
function statsLabel(stats: WorkStats, ctx: WebPartContext, completed: boolean): string {
  const parts: string[] = [];
  if (stats.explore > 0) {
    parts.push(
      `${ctx.t(completed ? "tools.groupExplore" : "tools.groupExploreActive")} ${stats.explore} ${ctx.t("tools.unitItems")}`,
    );
  }
  const commands = stats.run + stats.session;
  if (commands > 0) {
    parts.push(
      `${ctx.t(completed ? "tools.groupRun" : "tools.groupRunActive")} ${commands} ${ctx.t("tools.unitCommands")}`,
    );
  }
  if (stats.change > 0) {
    parts.push(
      `${ctx.t(completed ? "tools.groupChange" : "tools.groupChangeActive")} ${stats.change} ${ctx.t("tools.unitFiles")}`,
    );
  }
  if (stats.unresolved > 0) {
    parts.push(
      `${ctx.t(completed ? "tools.groupChange" : "tools.groupChangeActive")} ${stats.unresolved} ${ctx.t("tools.unitUnknown")}`,
    );
  }
  return parts.join(SEPARATOR) || ctx.t("tools.groupThinking");
}

/** 活动项：最后一个运行中的工具或流式思考。 */
function activeItem(rows: readonly Row[]): ToolRow | AssistantRow | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined) continue;
    if (row.kind === "tool" && row.status === "running") return row;
    if (row.kind === "assistant" && row.streaming === true && row.reasoning !== undefined) {
      return row;
    }
  }
  return undefined;
}

/** 代表图标：change > run > explore > reasoning（组收起时只露一个图标）。 */
function groupGlyph(rows: readonly Row[]): React.ReactNode {
  let hasExplore = false;
  let hasRun = false;
  let hasChange = false;
  for (const row of rows) {
    if (row.kind !== "tool") continue;
    const name = row.name;
    if (name === "edit" || name === "write") hasChange = true;
    else if (name === "bash" || name === "powershell") hasRun = true;
    else if (name === "read" || name === "glob" || name === "grep") hasExplore = true;
  }
  if (hasChange) return categoryGlyph("change");
  if (hasRun) return categoryGlyph("run");
  if (hasExplore) return categoryGlyph("explore");
  return <BrainGlyph size={16} />;
}

export function ToolGroupItem({
  rows,
  stats,
  ctx,
  running,
}: {
  rows: Row[];
  stats: WorkStats;
  ctx: WebPartContext;
  /** 整轮运行中且本组是最后一组 = 结构未闭合（统计用未完成措辞） */
  running?: boolean;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const active = activeItem(rows);
  const statsText = statsLabel(stats, ctx, running !== true);
  // 收起态修改组给文件名（参照：展开显示统计；运行中让位活动项 / 未完成措辞）
  const showFiles = !open && running !== true && stats.files.length > 0;
  const statsContent = (
    <>
      <span className="henira-row-icon">{groupGlyph(rows)}</span>
      {showFiles ? (
        <>
          <span className="henira-work-stats">
            {stats.files.length === 1 && stats.unresolved === 0
              ? ctx.t("tools.groupChange")
              : statsText}
          </span>
          <span className="henira-work-files" title={stats.files.join("\n")}>
            {stats.files.map((path) => baseName(path)).join("，")}
          </span>
        </>
      ) : (
        <span className={`henira-work-stats${running === true ? " henira-sweep" : ""}`}>
          {statsText}
        </span>
      )}
    </>
  );
  const label =
    open || active === undefined ? (
      statsContent
    ) : active.kind === "tool" ? (
      <span className="henira-work-preview" inert>
        <ToolPreviewContext.Provider value={true}>
          <RowView row={active} ctx={ctx} />
        </ToolPreviewContext.Provider>
      </span>
    ) : (
      <span className="henira-work-preview">
        <span className="henira-row-icon">
          <BrainGlyph size={16} />
        </span>
        <span className="henira-sweep">{ctx.t("row.reasoning.thinking")}</span>
        <span className="henira-work-active-summary">
          {reasoningPreview(active.reasoning ?? "")}
        </span>
      </span>
    );
  const toggle = (): void => setOpen(!open);
  return (
    <div className="henira-work-group">
      {/* biome-ignore lint/a11y/useSemanticElements: 组头内嵌当前活动项摘要（含文件链接）——button 会形成嵌套交互件；div+role 为 WAI-ARIA 允许形态 */}
      <div
        role="button"
        tabIndex={0}
        className="henira-work-group-head"
        aria-expanded={open}
        aria-label={statsText}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        }}
      >
        {label}
        <span className={`henira-row-caret${open ? " is-open" : ""}`}>
          <CaretGlyph size={16} />
        </span>
      </div>
      {open ? (
        <div className="henira-work-group-body">
          {rows.map((row) => (
            <RowView key={row.rowId} row={row} ctx={ctx} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
