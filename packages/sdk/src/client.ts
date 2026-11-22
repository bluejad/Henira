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
} from "@henira/protocol";
import {
  frameQueue,
  type HeniraFacade,
  type ModelPresets,
  type ProviderCatalogEntry,
} from "./facade.js";

export interface ClientOptions {
  baseUrl: string;
  /** server token（回环三件套可选 token 位；Bearer / ?token=） */
  token?: string;
  /** fetch 注入（测试 / 代理）；缺省全局 fetch */
  fetch?: typeof fetch;
  /** 重连退避上限（默认 5s；起始 500ms 指数） */
  maxBackoffMs?: number;
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
      const pump = (async (): Promise<void> => {
        let backoff = 500;
        const maxBackoff = opts.maxBackoffMs ?? 5000;
        while (!controller.signal.aborted) {
          try {
            const res = await doFetch(url("/api/events"), {
              headers: { accept: "text/event-stream", ...authHeaders() },
              signal: controller.signal,
            });
            if (!res.ok || res.body === null) throw new Error(`events → ${res.status}`);
            backoff = 500; // 连上即重置
            for await (const frame of sseFrames(res.body as ReadableStream<Uint8Array>)) {
              if (frame.kind === "snapshot") {
                lastSeq.set(frame.sessionId, frame.snapshot.seq);
                queue.push(frame);
              } else if (frame.kind === "delta") {
                const expected = (lastSeq.get(frame.sessionId) ?? 0) + 1;
                if (frame.seq === expected) {
                  lastSeq.set(frame.sessionId, frame.seq);
                  queue.push(frame);
                } else {
                  // 断档（溢出丢帧 / 非续接）：不猜——回拉快照换发
                  const snapshot = await requestJson<SessionSnapshot>(
                    `/api/sessions/${frame.sessionId}/snapshot`,
                  );
                  lastSeq.set(frame.sessionId, snapshot.seq);
                  queue.push({ kind: "snapshot", sessionId: frame.sessionId, snapshot });
                }
              } else {
                queue.push(frame); // connected
              }
            }
          } catch {
            // 断线（volatile 契约）：退避后重连，server 重发全量快照
          }
          if (controller.signal.aborted) break;
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, maxBackoff);
        }
      })();
      void pump.catch(() => {});
      try {
        yield* queue.stream();
      } finally {
        controller.abort();
      }
    },

    async stop() {
      // SSE 连接随 events() 生成器结束而断（finally abort）；REST 无常驻连接
    },
  };
  return facade;
}

/** SSE 文本流 → ServerFrame（data: 行 JSON；注释心跳行忽略） */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
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
    reader.releaseLock();
  }
}
