// 形态二：远端 client（①一对多——连 server 的 REST + SSE）。重连退避 + 断档不猜：
// 每会话记 lastSeq，增量帧 seq !== lastSeq+1 时丢弃该帧并回拉快照换发（消费端永不猜中间态）；
// 重连后 server 重发 connected + 全量快照，水位自然重置。

import type {
  DirBrowse,
  GlobalUiState,
  PromptReceipt,
  RegisteredDir,
  RowsPage,
  ServerFrame,
  SessionSnapshot,
  SessionSummary,
  SessionUiState,
  WorkspaceFileContent,
} from "@henira/protocol";
import {
  frameQueue,
  type HeniraFacade,
  type LinkState,
  type ModelPresets,
  type ProviderCatalogEntry,
} from "./facade.js";

/** setTimeout 上限：超限延迟会被运行时钳成 1ms（反而秒杀连接）——配置值一律先钳再装表 */
const MAX_TIMER_MS = 2_147_483_647;

export interface ClientOptions {
  baseUrl: string;
  /** server token（回环三件套可选 token 位；Bearer / ?token=） */
  token?: string;
  /** fetch 注入（测试 / 代理）；缺省全局 fetch */
  fetch?: typeof fetch;
  /** 重连退避上限（默认 5s；起始 500ms 指数） */
  maxBackoffMs?: number;
  /** 链路字节空闲上限（默认 30s = 2×服务端 15s 心跳）：心跳也算字节——
   *  超过此值没有任何字节 = 半开连接，强制断开重连（R193；刷新不再是唯一手段） */
  linkIdleTimeoutMs?: number;
}

/** 非 2xx 响应错误：message 形状照旧（`POST path → 404 detail`），status 结构化暴露——
 * UI 按 status 判别（404 = 对象已不存在，当已解决；网络错无 status 字段） */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function createClient(opts: ClientOptions): HeniraFacade {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  const authHeaders = (): Record<string, string> =>
    opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` };
  // 链路状态（R193）：只在变化时通知；初始 undefined（首次连上即发 connected）
  const linkListeners = new Set<(state: LinkState) => void>();
  let linkState: LinkState | undefined;
  /** 活跃事件泵（stop 时统一收口——SSE 常驻连接不跨 stop 泄漏） */
  const eventControllers = new Set<AbortController>();
  const emitLink = (next: LinkState): void => {
    if (linkState === next) return;
    linkState = next;
    for (const listener of [...linkListeners]) {
      try {
        listener(next);
      } catch {
        // 订阅者自身的渲染错误不得反噬事件泵
      }
    }
  };
  const url = (path: string, query?: Record<string, string>): string => {
    const search = query === undefined ? "" : `?${new URLSearchParams(query).toString()}`;
    return `${base}${path}${search}`;
  };

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(url(path), {
      ...init,
      headers: { "content-type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      // 错误体结构化提取（session_busy 等 code 码透传可判别；删除失败等 error/detail
      // 一并带上——UI 直接显示真实原因，不再只有裸状态码）
      const body = (await res.json().catch(() => undefined)) as
        | { code?: string; message?: string; error?: string; detail?: string }
        | undefined;
      const detail = [body?.code, body?.error, body?.detail ?? body?.message]
        .filter((part) => typeof part === "string" && part !== "")
        .join(" ");
      const suffix = detail === "" ? "" : ` ${detail}`;
      throw new HttpError(`${init?.method ?? "GET"} ${path} → ${res.status}${suffix}`, res.status);
    }
    return (await res.json()) as T;
  }

  const facade: HeniraFacade = {
    onLinkState(listener) {
      linkListeners.add(listener);
      if (linkState !== undefined) listener(linkState); // 晚订阅者立刻拿到当前态
      return () => {
        linkListeners.delete(listener);
      };
    },

    async createSession(sessionOpts) {
      return requestJson("/api/sessions", {
        method: "POST",
        body: JSON.stringify(sessionOpts ?? {}),
      });
    },

    async listSessions() {
      return requestJson<SessionSummary[]>("/api/sessions");
    },

    async prompt(sessionId, text, opts) {
      return requestJson<PromptReceipt>(`/api/sessions/${sessionId}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          text,
          steer: (opts as { steer?: boolean } | undefined)?.steer,
          modelId: opts?.modelId,
          reasoningEffort: opts?.reasoningEffort,
        }),
      });
    },

    async steer(sessionId, entryId) {
      const res = await requestJson<{ ok: boolean }>(`/api/sessions/${sessionId}/steer`, {
        method: "POST",
        body: JSON.stringify({ entryId }),
      });
      return res.ok;
    },

    async promoteQueueEntry(sessionId, entryId) {
      const res = await requestJson<{ ok: boolean }>(
        `/api/sessions/${sessionId}/queue/${encodeURIComponent(entryId)}/promote`,
        { method: "POST" },
      ).catch(() => ({ ok: false }) as { ok: boolean });
      return res.ok;
    },

    async removeQueueEntry(sessionId, entryId) {
      const res = await requestJson<{ ok: boolean }>(
        `/api/sessions/${sessionId}/queue/${encodeURIComponent(entryId)}`,
        { method: "DELETE" },
      ).catch(() => ({ ok: false }) as { ok: boolean });
      return res.ok;
    },

    async resumeQueue(sessionId) {
      const res = await requestJson<{ ok: boolean }>(`/api/sessions/${sessionId}/queue/resume`, {
        method: "POST",
      }).catch(() => ({ ok: false }) as { ok: boolean });
      return res.ok;
    },

    async interrupt(sessionId) {
      await requestJson(`/api/sessions/${sessionId}/interrupt`, { method: "POST" });
    },

    async fork(sessionId, atSeq) {
      const res = await requestJson<{ ok: boolean; id: string }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
        { method: "POST", body: JSON.stringify(atSeq === undefined ? {} : { atSeq }) },
      );
      return res.id;
    },

    async settleApproval(sessionId, requestId, decision, scope) {
      const res = await requestJson<{ applied: boolean }>(
        `/api/sessions/${sessionId}/approvals/${requestId}`,
        {
          method: "POST",
          body: JSON.stringify({ decision, ...(scope !== undefined ? { scope } : {}) }),
        },
      );
      return res.applied;
    },

    async settleQuestion(sessionId, requestId, answer) {
      const res = await requestJson<{ applied: boolean }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(requestId)}`,
        {
          method: "POST",
          body: JSON.stringify(
            Array.isArray(answer)
              ? { answers: answer }
              : { cancelled: (answer as { cancelled: true }).cancelled },
          ),
        },
      );
      return res.applied;
    },

    async getSettings() {
      return requestJson("/api/settings");
    },

    async putSettings(patch) {
      return requestJson("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
    },

    async listModels() {
      return requestJson("/api/models");
    },

    async listProviders() {
      return requestJson<{ providers: ProviderCatalogEntry[] }>("/api/providers");
    },

    async listModelPresets() {
      return requestJson<ModelPresets>("/api/models.presets");
    },

    async refreshModelPresets() {
      return requestJson<{ ok: boolean }>("/api/models.presets/refresh", { method: "POST" });
    },

    async connectProvider(providerId, key) {
      await requestJson(`/api/providers/${encodeURIComponent(providerId)}/connect`, {
        method: "PUT",
        body: JSON.stringify({ key }),
      });
    },

    async disconnectProvider(providerId) {
      await requestJson(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      });
    },

    async setModelEnabled(providerId, model, enabled) {
      await requestJson(
        `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(model)}/enabled`,
        { method: "PUT", body: JSON.stringify({ enabled }) },
      );
    },

    async putCustomProvider(input) {
      const res = await requestJson<{ ok: boolean; id: string }>("/api/providers/custom", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return { id: res.id };
    },

    async putCredential(providerId, key) {
      await requestJson(`/api/credentials/${providerId}`, {
        method: "PUT",
        body: JSON.stringify({ key }),
      });
    },

    async listUiAssets() {
      return requestJson("/api/ui-assets");
    },

    async listPlugins() {
      return requestJson("/api/plugins");
    },

    async confirmPlugin(id, version) {
      await requestJson(`/api/plugins/${encodeURIComponent(id)}/confirm`, {
        method: "POST",
        body: JSON.stringify({ version }),
      });
    },

    async setPluginEnabled(id, enabled) {
      await requestJson(`/api/plugins/${encodeURIComponent(id)}/enabled`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
    },

    async setPluginVersion(id, version) {
      await requestJson(`/api/plugins/${encodeURIComponent(id)}/version`, {
        method: "PUT",
        body: JSON.stringify({ version }),
      });
    },

    async removePlugin(id) {
      await requestJson(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    async confirmPluginMcp(id) {
      await requestJson(`/api/plugins/${encodeURIComponent(id)}/confirm-mcp`, { method: "POST" });
    },

    async executeResource(sessionId, pluginId, address) {
      return requestJson(`/api/sessions/${sessionId}/resource`, {
        method: "POST",
        body: JSON.stringify({ pluginId, address }),
      });
    },

    async listDir(sessionId, dirPath) {
      const query = dirPath === undefined ? "" : `?path=${encodeURIComponent(dirPath)}`;
      return requestJson(`/api/sessions/${sessionId}/files${query}`);
    },

    async readWorkspaceFile(sessionId, filePath) {
      return requestJson<WorkspaceFileContent>(
        `/api/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`,
      );
    },

    async listDirs() {
      return requestJson<RegisteredDir[]>("/api/dirs");
    },

    async addDir(cwd) {
      const res = await requestJson<{ ok: boolean; dir: RegisteredDir }>("/api/dirs", {
        method: "POST",
        body: JSON.stringify({ cwd }),
      });
      return res.dir;
    },

    async deleteDir(id) {
      const res = await requestJson<{ ok: boolean; blocked?: string[] }>(`/api/dirs/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(
          `directory busy; abort sessions before deletion: ${res.blocked?.join(", ")}`,
        );
      }
    },

    async browseDirs(path) {
      const query = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
      return requestJson<DirBrowse>(`/api/dirs/browse${query}`);
    },

    async deleteSession(id) {
      await requestJson(`/api/sessions/${id}`, { method: "DELETE" });
    },

    async getUiState() {
      return requestJson<GlobalUiState>("/api/ui-state");
    },

    async putUiState(doc) {
      await requestJson("/api/ui-state", {
        method: "PUT",
        body: JSON.stringify(doc),
      });
    },

    async getSessionUiState(sessionId) {
      return requestJson<SessionUiState>(`/api/sessions/${sessionId}/ui-state`);
    },

    async putSessionUiState(sessionId, doc) {
      await requestJson(`/api/sessions/${sessionId}/ui-state`, {
        method: "PUT",
        body: JSON.stringify(doc),
      });
    },

    async snapshot(sessionId) {
      return requestJson<SessionSnapshot>(`/api/sessions/${sessionId}/snapshot`);
    },

    async sessionRows(sessionId, opts) {
      const params = new URLSearchParams();
      if (opts?.before !== undefined) params.set("before", String(opts.before));
      if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return requestJson<RowsPage>(`/api/sessions/${sessionId}/rows${query}`);
    },

    async *events() {
      // 断档不猜（客户端纪律）：lastSeq 按会话跟踪；跳号 → 回拉快照换发，消费端永不猜中间态
      const lastSeq = new Map<string, number>();
      const queue = frameQueue();
      const controller = new AbortController();
      // 非正 / 非有限值回落默认；超大值钳到 setTimeout 上限（审查补：钳掉「配置越大越安全」的假象）
      const requestedIdle = opts.linkIdleTimeoutMs;
      const linkIdleTimeoutMs =
        typeof requestedIdle === "number" && Number.isFinite(requestedIdle) && requestedIdle > 0
          ? Math.min(requestedIdle, MAX_TIMER_MS)
          : 30_000;
      eventControllers.add(controller);
      const pump = (async (): Promise<void> => {
        let backoff = 500;
        const maxBackoff = opts.maxBackoffMs ?? 5000;
        while (!controller.signal.aborted) {
          // 每连接一个 controller：外层 stop 转发进来；字节看门狗只掐这条连接（不杀整个泵）
          const connection = new AbortController();
          const forwardAbort = (): void => connection.abort();
          controller.signal.addEventListener("abort", forwardAbort, { once: true });
          try {
            // 建立连接阶段也套同一上限（审查补）：服务端接受连接却迟迟不回响应头时，
            // fetch 会无限悬挂——此时还没有 body 可读，字节看门狗无处施展。超时先 abort
            // 本条连接让 fetch 收口，再走同一条退避重连路径。
            const res = await readWithIdle(
              () =>
                doFetch(url("/api/events"), {
                  headers: { accept: "text/event-stream", ...authHeaders() },
                  signal: connection.signal,
                }),
              linkIdleTimeoutMs,
              () => connection.abort(),
            );
            if (!res.ok || res.body === null) throw new Error(`events → ${res.status}`);
            backoff = 500; // 连上即重置
            emitLink("connected");
            for await (const frame of sseFrames(res.body as ReadableStream<Uint8Array>, {
              idleTimeoutMs: linkIdleTimeoutMs,
            })) {
              if (frame.kind === "snapshot") {
                lastSeq.set(frame.sessionId, frame.snapshot.seq);
                queue.push(frame);
              } else if (frame.kind === "delta") {
                const expected = (lastSeq.get(frame.sessionId) ?? 0) + 1;
                if (frame.seq === expected) {
                  lastSeq.set(frame.sessionId, frame.seq);
                  queue.push(frame);
                } else {
                  // 断档（溢出丢帧 / 非续接）：不猜——回拉快照换发。回拉本身也受空闲上限
                  // 约束（审查补）：它挂在事件泵的关键路径上，悬挂 = 帧消费静默停摆。
                  const snapshot = await readWithIdle(
                    () =>
                      requestJson<SessionSnapshot>(`/api/sessions/${frame.sessionId}/snapshot`, {
                        signal: connection.signal,
                      }),
                    linkIdleTimeoutMs,
                    () => connection.abort(),
                  );
                  lastSeq.set(frame.sessionId, snapshot.seq);
                  queue.push({ kind: "snapshot", sessionId: frame.sessionId, snapshot });
                }
              } else {
                queue.push(frame); // connected
              }
            }
          } catch {
            // 断线 / 半开（建连超时或字节看门狗超时）/ 流自然结束（volatile 契约）：退避后
            // 重连，server 重发全量快照——刷新不再是唯一恢复手段
          } finally {
            // 本条连接任何收尾路径都掐断：半开悬挂中的 fetch / body 不留活口（审查补）
            connection.abort();
            controller.signal.removeEventListener("abort", forwardAbort);
          }
          if (controller.signal.aborted) break;
          emitLink("reconnecting");
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, maxBackoff);
        }
      })();
      void pump.catch(() => {});
      // 拉帧与 abort 竞速：yield* 直取时若队列无帧，生成器的 return 会悬在队列等待上
      // （stop/dispose 关不掉连接）；race 一帧 abort 即可让生成器收尾
      const frames = queue.stream()[Symbol.asyncIterator]();
      const aborted = new Promise<"abort">((resolve) => {
        if (controller.signal.aborted) resolve("abort");
        else controller.signal.addEventListener("abort", () => resolve("abort"), { once: true });
      });
      try {
        for (;;) {
          const result = await Promise.race([frames.next(), aborted]);
          if (result === "abort") return;
          if (result.done === true) {
            // 队列自然结束只可能是溢出（push 超 cap → ended）——不是主动收尾：抛给消费方
            // 监督重建事件泵，否则界面静默冻死（审查补；stop/dispose 走上面的 abort 分支）
            if (controller.signal.aborted) return;
            throw new Error("event frame queue overflow");
          }
          yield result.value;
        }
      } finally {
        controller.abort();
        eventControllers.delete(controller);
        // 释放队列等待者（可能悬在无界等待上——不 await，失败也不许反噬收尾）
        const closing = frames.return?.(undefined);
        if (closing !== undefined) void closing.catch(() => {});
      }
    },

    async stop() {
      // SSE 常驻连接：stop = 全部事件泵收口（REST 无长连接）
      for (const controller of [...eventControllers]) controller.abort();
      eventControllers.clear();
    },
  };
  return facade;
}

interface SseFrameOptions {
  /** 单次字节等待上限（心跳注释也算字节——注释与 data 行一视同仁）；
   *  超时 = 半开连接，抛错交给上游退避重连 */
  idleTimeoutMs?: number;
}

/** SSE 文本流 → ServerFrame（data: 行 JSON；注释心跳行忽略但计入字节活性） */
async function* sseFrames(
  body: ReadableStream<Uint8Array>,
  options: SseFrameOptions = {},
): AsyncGenerator<ServerFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } =
        options.idleTimeoutMs === undefined
          ? await reader.read()
          : await readWithIdle(() => reader.read(), options.idleTimeoutMs);
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            yield JSON.parse(line.slice(6)) as ServerFrame;
          }
        }
        index = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // 结束 / 超时 / 消费方提前退出都要关底层连接（半开连接不 cancel 会吊着）。
    // cancel 不 await：个别实现会把它挂住——重连不能被收尾拖死
    try {
      void reader.cancel().catch(() => {});
    } catch {
      // 流已关闭
    }
    try {
      reader.releaseLock();
    } catch {
      // 仍有挂起 read（abort 竞态）——锁随流收尾释放
    }
  }
}

/** 单次等待（建立连接 / 读一帧）的空闲上限：每次收到字节（含心跳注释）后重新计时。
 *  超时先 onTimeout 收口底层（掐连接），再抛错——否则悬挂的 fetch/body 会带着旧连接进重连。 */
async function readWithIdle<R>(
  read: () => Promise<R>,
  idleMs: number,
  onTimeout?: () => void,
): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`link idle timeout after ${idleMs}ms`));
    }, idleMs);
  });
  try {
    return await Promise.race([read(), idle]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
