// 思考块（R178）：默认收起；触发行 = 脑图标 + 「正在思考」/「思考 持续了 N 秒」，
// 流式收起态在同一行右侧显示最后一行摘要；展开体 = 左导线纯文本（14px/1.75）。
// R194：流式中展开 → 内滚视口直接落在最新一行并继续跟随；用户上滚即暂停，回底恢复。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  // 展开体是 240px 内滚视口：流式中新 token 到达时贴底；用户上滚（>4px）让出阅读权
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reasoning 是内容变化信号（触发贴底），体内只读 ref
  useLayoutEffect(() => {
    if (!open || !streaming) return; // 历史/已收尾的思考展开从头看
    const el = bodyRef.current;
    if (el === null || !followRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, streaming, reasoning]);
  const onBodyScroll = (): void => {
    const el = bodyRef.current;
    if (el === null) return;
    followRef.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 4;
  };
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
          if (!open) followRef.current = true; // 每次重新展开都从最新一行开始
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
      {open ? (
        <div className="henira-reasoning-body" ref={bodyRef} onScroll={onBodyScroll}>
          {reasoning}
        </div>
      ) : null}
    </div>
  );
}

export { ReasoningView };
