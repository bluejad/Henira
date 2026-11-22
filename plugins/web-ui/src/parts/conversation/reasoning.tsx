// 思考块（R178）：默认收起；触发行 = 脑图标 + 「正在思考」/「思考 持续了 N 秒」，
// 流式收起态在同一行右侧显示最后一行摘要；展开体 = 左导线纯文本（14px/1.75）。
import { useEffect, useRef, useState } from "react";
import type { WebPartContext } from "../../types.js";
import { BrainGlyph, CaretGlyph } from "../icons.js";
import { reasoningPreview } from "./format.js";

function ReasoningView({
  reasoning,
  streaming,
  ctx,
}: {
  reasoning: string;
  streaming: boolean;
  ctx: WebPartContext;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  // 流式耗时：协议无 reasoning 时间戳，客户端起表；历史行无起点 → 「持续了几秒」
  const startedAtRef = useRef<number | null>(streaming ? Date.now() : null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!streaming) {
      if (startedAtRef.current !== null) {
        setElapsedSeconds(Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000)));
        startedAtRef.current = null;
      }
      return;
    }
    startedAtRef.current ??= Date.now();
    // 收起态显示摘要，不需要每秒重渲；展开时才补算并持续更新。
    if (!open) return;
    const update = (): void => {
      if (startedAtRef.current === null) return;
      setElapsedSeconds(Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [streaming, open]);
  const collapsedStreaming = streaming && !open;
  return (
    <div className="henira-reasoning">
      <button
        type="button"
        className="henira-reasoning-trigger"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <BrainGlyph size={16} />
        <span className="henira-reasoning-label">
          {collapsedStreaming ? (
            <span className="henira-sweep">{ctx.t("row.reasoning.thinking")}</span>
          ) : (
            <>
              <span>{ctx.t("row.reasoning.done")}</span>
              <span className="henira-reasoning-duration">
                {elapsedSeconds === null
                  ? ctx.t("row.reasoning.fewSeconds")
                  : `${ctx.t("row.reasoning.durationPrefix")} ${elapsedSeconds} ${ctx.t("tool.unitSec")}`}
              </span>
            </>
          )}
        </span>
        {collapsedStreaming ? (
          <span className="henira-reasoning-summary henira-fade-right">
            {reasoningPreview(reasoning)}
          </span>
        ) : null}
        <span className={`henira-row-caret${open ? " is-open" : ""}`}>
          <CaretGlyph size={16} />
        </span>
      </button>
      {open ? <div className="henira-reasoning-body">{reasoning}</div> : null}
    </div>
  );
}

export { ReasoningView };
