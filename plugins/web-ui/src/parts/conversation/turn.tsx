// 轮块（R178）：完成轮把过程（思考/工具/中间文本）收进「已工作 3 分 44 秒」折叠行，
// 最终回答留在外面；运行中不显示轮头、过程直接展开（组内仍按自己的开合）；
// 中断/错误轮默认展开；用户手动开合优先。
import type { SessionState } from "@henira/protocol";
import { useEffect, useMemo, useState } from "react";
import type { WebPartContext } from "../../types.js";
import { CaretGlyph } from "../icons.js";
import { TurnTailActions } from "./actions.js";
import { formatWorkDuration } from "./format.js";
import { ReasoningView } from "./reasoning.js";
import { RowView } from "./rows.js";
import { ToolGroupItem } from "./tool-group.js";
import { buildTurnLayout, type TurnItem } from "./turn-items.js";
import type { TurnUnit } from "./turn-units.js";

function renderItems(items: TurnItem[], ctx: WebPartContext, running: boolean): React.ReactNode {
  const lastIndex = items.length - 1;
  return items.map((item, index) =>
    item.kind === "group" ? (
      <ToolGroupItem
        key={item.rows[0]?.rowId ?? "group"}
        rows={item.rows}
        stats={item.stats}
        ctx={ctx}
        running={running && index === lastIndex}
      />
    ) : (
      <RowView key={item.row.rowId} row={item.row} ctx={ctx} />
    ),
  );
}

function TurnBlock({
  unit,
  ctx,
  turnTimings,
  latestSettled,
  running,
}: {
  unit: TurnUnit;
  ctx: WebPartContext;
  turnTimings?: SessionState["turnTimings"];
  latestSettled?: boolean;
  running?: boolean;
}): React.ReactNode {
  const timing = unit.turn !== undefined ? turnTimings?.[unit.turn] : undefined;
  const layout = useMemo(() => buildTurnLayout(unit.rows), [unit.rows]);
  const [override, setOverride] = useState<boolean | undefined>(undefined);
  // 轮切换/运行态变化 → 清手动开合，回到自动裁决
  // biome-ignore lint/correctness/useExhaustiveDependencies: unit.key/running 是重置信号
  useEffect(() => {
    setOverride(undefined);
  }, [unit.key, running]);
  const interrupted = unit.rows.some((row) => row.kind === "assistant" && row.interrupted === true);
  const durationLabel = formatWorkDuration(timing?.durationMs, ctx.t);
  const headerLabel = interrupted
    ? ctx.t("turn.stopped")
    : durationLabel !== null
      ? `${ctx.t("turn.worked")} ${durationLabel}`
      : ctx.t("turn.processed");
  const canFold = layout.foldable && running !== true;
  const open = canFold ? (override ?? layout.abnormal) : false;
  const finalReasoning =
    canFold &&
    layout.final !== undefined &&
    layout.final.kind === "assistant" &&
    layout.final.reasoning !== undefined &&
    layout.final.reasoning !== ""
      ? layout.final.reasoning
      : undefined;
  const showStaticHeader = running !== true && (timing !== undefined || interrupted);
  return (
    <div className="henira-turn-group">
      {layout.leading.map((row) => (
        <RowView key={row.rowId} row={row} ctx={ctx} />
      ))}
      {canFold ? (
        <div className="henira-turn-history">
          <button
            type="button"
            className="henira-turn-history-trigger"
            aria-expanded={open}
            onClick={() => setOverride(!open)}
          >
            <span>{headerLabel}</span>
            <span className={`henira-turn-history-caret${open ? " is-open" : ""}`}>
              <CaretGlyph size={16} />
            </span>
          </button>
          {open ? (
            <div className="henira-turn-history-body">
              {renderItems(layout.process, ctx, false)}
              {finalReasoning !== undefined ? (
                <ReasoningView reasoning={finalReasoning} streaming={false} ctx={ctx} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {showStaticHeader ? (
            <div className="henira-turn-history-trigger is-static">
              <span>{headerLabel}</span>
            </div>
          ) : null}
          <div className="henira-process">{renderItems(layout.process, ctx, running === true)}</div>
        </>
      )}
      {layout.final !== undefined ? (
        <RowView row={layout.final} ctx={ctx} skipReasoning={finalReasoning !== undefined} />
      ) : null}
      {layout.trailing.map((row) => (
        <RowView key={row.rowId} row={row} ctx={ctx} />
      ))}
      {timing !== undefined ? (
        <TurnTailActions
          unit={unit}
          ctx={ctx}
          timing={timing}
          alwaysVisible={latestSettled === true}
        />
      ) : null}
    </div>
  );
}

export { TurnBlock };
