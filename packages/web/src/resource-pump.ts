// useResource 数据泵（plugins.md §4 / D-064）：同地址一份泵、2s 共享轮询、引用计数、
// 末订阅者退订；失败保留上次数据（status:'failed' 但 data/text 还在）。
// 抽独立模块的动机：泵是判据⑤的核心语义，独立成纯逻辑件可单测（host.ts 只做接线）。

import type { ResourceSnapshot } from "@henira/plugin-web-ui";
import type { ResourceReply } from "@henira/protocol";

export interface ResourcePumpDeps {
  /** 泵单跳（宿主门面 executeResource——REST / 进程内同形） */
  execute(sessionId: string, pluginId: string, address: string): Promise<ResourceReply>;
  /** 当前会话（null = 无会话，泵报 failed 而不打端点） */
  getSessionId(): string | null;
  /** 轮询间隔（默认 2000ms——§4 2s 共享轮询） */
  pollMs?: number;
}

export interface ResourcePumpController {
  /** 订阅即首拉 + 开轮询；返回退订（末订阅者退订关泵） */
  subscribe(
    address: string,
    pluginId: string,
    cb: (snapshot: ResourceSnapshot) => void,
  ): () => void;
  /** 现值读取（订阅前初值——同地址已在泵中直接取，避免 loading 闪帧） */
  snapshotOf(address: string): ResourceSnapshot | undefined;
  /** 全部清场（第三方件重装 / 宿主 dispose 时；重装后由新件订阅重新首拉） */
  clearAll(): void;
}

export function createResourcePump(deps: ResourcePumpDeps): ResourcePumpController {
  interface Pump {
    subscribers: Set<(snapshot: ResourceSnapshot) => void>;
    timer?: ReturnType<typeof setInterval>;
    snapshot: ResourceSnapshot;
    /** 上一跳在飞：跳过该 tick（慢工具不堆叠请求、不产生乱序覆盖） */
    inFlight: boolean;
  }
  const pumps = new Map<string, Pump>();
  const pollMs = deps.pollMs ?? 2000;

  function apply(address: string, reply: ResourceReply): void {
    const pump = pumps.get(address);
    if (pump === undefined) return;
    if (!reply.ok) {
      // 失败保留上次数据（D-028：status:'failed' 但 data/text/updatedAt 还在）
      pump.snapshot = { ...pump.snapshot, status: "failed", error: reply.error };
    } else {
      let data: unknown;
      let parseFailed = false;
      if (reply.text !== undefined) {
        try {
          const parsed: unknown = JSON.parse(reply.text);
          if (parsed !== null && typeof parsed === "object") data = parsed;
          else parseFailed = true; // 标量不进 data——原文走 text（D-028）
        } catch {
          parseFailed = true;
        }
      }
      pump.snapshot = {
        status: "live",
        ...(parseFailed ? {} : { data }),
        ...(reply.text !== undefined ? { text: reply.text } : {}),
        updatedAt: reply.updatedAt,
        error: undefined,
      };
    }
    for (const cb of pump.subscribers) cb(pump.snapshot);
  }

  async function fetchOnce(address: string, pluginId: string): Promise<void> {
    const pump = pumps.get(address);
    if (pump === undefined || pump.inFlight) return;
    pump.inFlight = true;
    try {
      const sessionId = deps.getSessionId();
      if (sessionId === null) {
        apply(address, { ok: false, error: "no active session", updatedAt: Date.now() });
        return;
      }
      try {
        apply(address, await deps.execute(sessionId, pluginId, address));
      } catch (err) {
        apply(address, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          updatedAt: Date.now(),
        });
      }
    } finally {
      pump.inFlight = false;
    }
  }

  return {
    subscribe(address, pluginId, cb) {
      let pump = pumps.get(address);
      if (pump === undefined) {
        pump = { subscribers: new Set(), snapshot: { status: "loading" }, inFlight: false };
        pumps.set(address, pump);
      }
      pump.subscribers.add(cb);
      if (pump.timer === undefined) {
        void fetchOnce(address, pluginId); // 立即首拉
        pump.timer = setInterval(() => {
          void fetchOnce(address, pluginId);
        }, pollMs);
      }
      return () => {
        const current = pumps.get(address);
        if (current === undefined) return;
        current.subscribers.delete(cb);
        if (current.subscribers.size === 0) {
          if (current.timer !== undefined) clearInterval(current.timer);
          pumps.delete(address);
        }
      };
    },
    snapshotOf(address) {
      return pumps.get(address)?.snapshot;
    },
    clearAll() {
      for (const pump of pumps.values()) {
        if (pump.timer !== undefined) clearInterval(pump.timer);
      }
      pumps.clear();
    },
  };
}
