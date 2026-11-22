// 时间线主体（R177 拆分）：虚拟化窗口挂载，无 ResizeObserver 环境降级全量。
import type { SessionState } from "@henira/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo } from "react";
import type { WebPartContext } from "../../types.js";
import { VIRTUAL } from "./constants.js";
import { TurnBlock } from "./turn.js";
import type { TurnUnit } from "./turn-units.js";

/** 时间线主体（sessionId 作 React key——会话切换重挂换测高缓存）：虚拟化窗口挂载，
 *  无 ResizeObserver 环境（jsdom）降级全量。 */
function ConversationTimeline(props: {
  units: readonly TurnUnit[];
  ctx: WebPartContext;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  turnTimings?: SessionState["turnTimings"];
  runningTurn?: string;
}) {
  const { units, ctx, scrollRef, turnTimings, runningTurn } = props;
  const virtualizer = useVirtualizer({
    count: VIRTUAL ? units.length : 0,
    getScrollElement: () => scrollRef.current,
    // 未知块估高 = 一屏（参照实现同思想：固定小值会让首屏挂十几块正文）；实高经 measureElement 回写
    estimateSize: () => scrollRef.current?.clientHeight || 240,
    overscan: 2,
    getItemKey: (i) => units[i]?.key ?? i,
  });
  // 最新落定轮（E4 操作行常显判据）：从尾往前第一个 turn/end 已结算的轮
  const lastSettledKey = useMemo(() => {
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (u?.turn !== undefined && turnTimings?.[u.turn] !== undefined) return u.key;
    }
    return undefined;
  }, [units, turnTimings]);

  if (!VIRTUAL) {
    return (
      <>
        {units.map((unit) => (
          <TurnBlock
            key={unit.key}
            unit={unit}
            ctx={ctx}
            turnTimings={turnTimings}
            latestSettled={unit.key === lastSettledKey}
            running={unit.turn !== undefined && unit.turn === runningTurn}
          />
        ))}
      </>
    );
  }
  return (
    <div className="henira-virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const unit = units[item.index];
        if (unit === undefined) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="henira-virtual-item"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <TurnBlock
              unit={unit}
              ctx={ctx}
              turnTimings={turnTimings}
              latestSettled={unit.key === lastSettledKey}
              running={unit.turn !== undefined && unit.turn === runningTurn}
            />
          </div>
        );
      })}
    </div>
  );
}

export { ConversationTimeline };
