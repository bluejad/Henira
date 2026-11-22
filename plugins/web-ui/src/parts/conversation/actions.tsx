// 轮尾操作行（R177 拆分）：时间戳 · 复制 · fork。
import type { AssistantRow, SessionState } from "@henira/protocol";
import { useMemo, useState } from "react";
import type { WebPartContext } from "../../types.js";
import { CopyButton } from "../copy-button.js";
import { formatTurnClock, turnEndsWithText } from "./format.js";
import type { TurnUnit } from "./turn-units.js";

type TurnTiming = NonNullable<SessionState["turnTimings"]>[string];

/** 轮尾操作行（E4，dsh TurnTailNodeView 行为层参照）：时间戳 · 复制（本回合全部助手文本
 * 原始 markdown，非 DOM 取文）· fork（可点 = 该轮以文本回复收尾；置灰带原因提示；点击 =
 * 前缀复制出新会话并跳转）。仅落定轮渲染；最新落定轮常显，其余 hover 浮现（纯 CSS）。 */
function TurnTailActions({
  unit,
  ctx,
  timing,
  alwaysVisible,
}: {
  unit: TurnUnit;
  ctx: WebPartContext;
  timing: TurnTiming;
  alwaysVisible: boolean;
}) {
  const [forking, setForking] = useState(false);
  const copyText = useMemo(
    () =>
      unit.rows
        .filter((r): r is AssistantRow => r.kind === "assistant")
        .map((r) => r.text)
        .filter((t) => t !== "")
        .join("\n\n"),
    [unit.rows],
  );
  const forkClient = ctx.client.fork;
  const forkable = forkClient !== undefined && turnEndsWithText(unit.rows);
  const onFork = (): void => {
    if (forkClient === undefined || ctx.sessionId === null || forking) return;
    setForking(true);
    void forkClient(ctx.sessionId, timing.forkSeq)
      .then((childId) => {
        ctx.selectSession(childId);
      })
      .catch(() => {})
      .finally(() => setForking(false));
  };
  return (
    <div className="henira-turn-actions" data-actions-reveal={alwaysVisible ? "always" : "hover"}>
      <span className="henira-turn-time">{formatTurnClock(timing.endedAt)}</span>
      <CopyButton text={copyText} t={ctx.t} className="henira-turn-copy" />
      {forkClient !== undefined ? (
        <button
          type="button"
          className="henira-turn-fork"
          disabled={!forkable || forking}
          title={forkable ? ctx.t("turn.fork") : ctx.t("turn.forkUnavailable")}
          onClick={onFork}
        >
          {forking ? ctx.t("turn.forking") : ctx.t("turn.fork")}
        </button>
      ) : null}
    </div>
  );
}

export type { TurnTiming };
export { TurnTailActions };
