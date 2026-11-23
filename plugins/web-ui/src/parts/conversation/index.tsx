// 对话面板主件（R177 拆分）：store 订阅 + 滚动裁决/翻页 + 时间线挂载。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { WebPart, WebPartContext } from "../../types.js";
import { SlotBoundary } from "../slot-boundary.js";
import { BOTTOM_EPSILON_PX, LOAD_OLDER_TRIGGER_PX, PAGE_SIZE } from "./constants.js";
import { ConversationEmpty } from "./empty-state.js";
import { formatWorkDuration } from "./format.js";
import { ConversationTimeline } from "./timeline.js";
import { buildTurnUnits } from "./turn-units.js";

export const Conversation: WebPart = (ctx: WebPartContext) => {
  // useSyncExternalStore：store 引用稳定（未变化返回同一对象），快照整体替换语义
  const snapshot = useSyncExternalStore(
    ctx.store.subscribe,
    () => ctx.store.getSession(ctx.sessionId),
    () => ctx.store.getSession(ctx.sessionId),
  );
  const units = useMemo(() => buildTurnUnits(snapshot.rows), [snapshot.rows]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null); // 手势/滚动监听挂这里——回底按钮是容器的兄弟，
  // 按钮位置的滚轮事件不进容器 capture（活体自测 selftest6 抓到：按钮在场时滚轮失效）
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const sessionRows = ctx.client.sessionRows; // feature-detect：宿主缺方法 = 不翻页
  const tailParts = ctx.slots.get("turn.tail") ?? [];

  // ── 轮级 loading 计时（E3 生命感；R193 起只走秒，不再猜「停滞」——慢不是异常）──
  const busy = snapshot.state.busy;
  const [busySince, setBusySince] = useState<number | undefined>(undefined);
  const [, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ctx.sessionId 刻意触发信号——切会话重置兜底表
  useEffect(() => {
    if (busy) {
      setBusySince((prev) => prev ?? Date.now()); // 边沿起表；StrictMode 重渲不重置
      const timer = setInterval(() => setTick((t) => t + 1), 1000);
      return () => {
        clearInterval(timer);
        setBusySince(undefined);
      };
    }
    setBusySince(undefined);
    return undefined;
  }, [busy, ctx.sessionId]);
  // 计时起点：服务端 busySince 权威（R173——turn/start 事件 time，快照重建自愈），
  // 刷新/重连/换窗口续同一块表；无字段（老快照）才兜底本地起表
  const since = busy ? (snapshot.state.busySince ?? busySince) : undefined;
  const busySeconds = since !== undefined ? Math.floor((Date.now() - since) / 1000) : 0;
  // 60s 后改中性措辞（「仍在等待模型响应」）——秒数照走、不变红；真正的死由引擎空闲超时收口
  const waitingLong = busy && busySeconds >= 60;
  // 断链横幅（R193）：reconnecting 持续 5s 才露头——退避重连通常几百毫秒自愈，不闪
  const [linkLost, setLinkLost] = useState(false);
  useEffect(() => {
    if (ctx.linkState !== "reconnecting") {
      setLinkLost(false);
      return undefined;
    }
    const timer = setTimeout(() => setLinkLost(true), 5000);
    return () => {
      clearTimeout(timer);
    };
  }, [ctx.linkState]);

  const commitFollowing = (on: boolean): void => {
    followingRef.current = on;
    setFollowing(on);
  };

  // 流式贴底：跟随中内容变高 → 写 scrollTop（内容未变高时 no-op；初始挂载定位最新）
  // biome-ignore lint/correctness/useExhaustiveDependencies: followingRef 是意图裁决引用（有意不进 deps——进则每帧重挂监听）；snapshot.rows 即渲染变化信号
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null || !followingRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [snapshot.rows]);

  // 用户意图先行（capture 阶段，先于 scroll）：明确上滚手势解除跟随；程序化写入永不误解除
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅挂载期装监听——commitFollowing 为稳定 setState 包装、scrollRef 容器不变
  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const away = (): void => {
      if (followingRef.current) commitFollowing(false);
    };
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY < 0) away();
    };
    let touchY: number | undefined;
    const onTouchStart = (e: TouchEvent): void => {
      touchY = e.touches[0]?.clientY;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (touchY !== undefined && y !== undefined && y > touchY) away(); // 手指下移 = 视图上滚
      touchY = y;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") away();
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    el.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    el.addEventListener("keydown", onKey, { capture: true });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("keydown", onKey, { capture: true });
    };
  }, []);

  // 滚动裁决：落点贴底（<48px）恢复跟随；滚顶触发翻页。
  // React 19 的 onScroll 合成事件对非冒泡 scroll 委托失效（真浏览器实证——jsdom fireEvent
  // 直走 React 事件系统测不出）→ 原生 listener + ref 转发最新闭包（与 wheel/touch 同法）
  const onScrollRef = useRef<() => void>(() => {});
  onScrollRef.current = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < BOTTOM_EPSILON_PX && !followingRef.current) commitFollowing(true);
    if (el.scrollTop < LOAD_OLDER_TRIGGER_PX && snapshot.hasOlder && !loadingOlder) loadOlder();
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const fn = (): void => onScrollRef.current();
    el.addEventListener("scroll", fn, { capture: true, passive: true });
    return () => {
      el.removeEventListener("scroll", fn, { capture: true });
    };
  }, []);

  const loadOlder = (): void => {
    const first = snapshot.rows[0];
    const id = ctx.sessionId;
    if (first === undefined || id === null || sessionRows === undefined) return;
    setLoadingOlder(true);
    void sessionRows
      .call(ctx.client, id, { before: first.rowSeq, limit: PAGE_SIZE })
      .then((page) => {
        ctx.store.mergeOlderRows?.(id, page.rows);
      })
      .catch(() => {})
      .finally(() => {
        setLoadingOlder(false);
      });
  };

  // 前插补位（参照实现 prependScrollAdjustment 兜底法）：首块 key 变化（前插发生）且离底状态
  // → scrollTop += 新增高度，正在看的内容不跳
  const prevLayoutRef = useRef({ height: 0, firstKey: "" });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const prev = prevLayoutRef.current;
    const firstKey = units[0]?.key ?? "";
    if (prev.height > 0 && firstKey !== prev.firstKey && !followingRef.current) {
      el.scrollTop += el.scrollHeight - prev.height;
    }
    prevLayoutRef.current = { height: el.scrollHeight, firstKey };
  });

  const backVisible = !following && snapshot.rows.length > 0;
  // 空会话草稿态：已加载 + 无行 + 不忙——首帧（快照未到）不闪问候
  const loaded =
    ctx.sessionId !== null && (ctx.store.has?.(ctx.sessionId) ?? snapshot.rows.length > 0);
  const empty = loaded && snapshot.rows.length === 0 && !busy;
  const backToBottom = (): void => {
    commitFollowing(true);
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  };

  const tailNodes = tailParts.map((part, i) => {
    // 件 = React 组件（可带 hooks）：JSX 渲染，不直呼（直呼会把 hooks 落进外层序列——批 C 修正）
    const TailPart = part as WebPart;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: 追加位按注册序渲染、卸载即整表移除——索引键无重排歧义
      <SlotBoundary key={i} label="turn.tail">
        <TailPart {...ctx} />
      </SlotBoundary>
    );
  });

  return (
    <div ref={wrapRef} className="henira-conversation-wrap">
      {linkLost ? (
        <div className="henira-link-banner" role="status">
          {ctx.t("connection.reconnecting")}
        </div>
      ) : null}
      {empty ? (
        <>
          <ConversationEmpty ctx={ctx} />
          {tailNodes.length > 0 ? <div className="henira-empty-tail">{tailNodes}</div> : null}
        </>
      ) : (
        <div className="henira-conversation" ref={scrollRef}>
          {/* 内层以 sessionId 为 React key：会话切换重挂 → 虚拟器测高缓存换代（turnId 跨会话可重复） */}
          <ConversationTimeline
            key={ctx.sessionId ?? "none"}
            units={units}
            ctx={ctx}
            scrollRef={scrollRef}
            turnTimings={snapshot.state.turnTimings}
            runningTurn={busy ? snapshot.state.lastTurnId : undefined}
          />
          {busy ? (
            <p className="henira-loading-dots">
              <span>·</span>
              <span>·</span>
              <span>·</span>{" "}
              <span className={waitingLong ? "henira-waiting" : "henira-sweep"}>
                {ctx.t(waitingLong ? "conversation.waitingModel" : "conversation.working")}
              </span>{" "}
              <span className="henira-loading-duration">
                {formatWorkDuration(busySeconds * 1000, ctx.t)}
              </span>
            </p>
          ) : null}
          {tailNodes}
        </div>
      )}
      {loadingOlder ? (
        <div className="henira-loading-older">{ctx.t("conversation.loadingOlder")}</div>
      ) : null}
      {backVisible ? (
        <button
          type="button"
          className="henira-back-bottom"
          aria-label={ctx.t("conversation.backToBottom")}
          title={ctx.t("conversation.backToBottom")}
          onClick={backToBottom}
        >
          ↓ {ctx.t("conversation.backToBottom")}
        </button>
      ) : null}
    </div>
  );
};
