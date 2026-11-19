// server e2e（真 HTTP + 真 SSE + mock LLM 全引擎装配）：判据①多客户端 / ②断线重连审批重放 /
// ⑤回环三件套，另锁 REST 面 / 设置与凭据 / 文件围栏 / 握手文件生命周期 / 中断冻结。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ServiceDefinition } from "@henira/kernel";
import {
  type MockEntry,
  mockFinish,
  mockLlm,
  mockText,
  mockToolCall,
  mockUsage,
} from "@henira/llm-mock";
import type { LlmService, ServerFrame } from "@henira/protocol";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type HeniraServer, type ServerOptions } from "./server.js";

interface Ctx {
  server: HeniraServer;
  base: string;
  cleanup: () => Promise<void>;
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-server-test-"));
});

afterAll(async () => {
  // 各测试自行 cleanup；root 兜底
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

const llmStub = (service: LlmService): ServiceDefinition<LlmService> => ({
  name: "llm",
  start: () => service,
});

async function makeServer(
  script: readonly MockEntry[],
  opts?: {
    token?: string;
    dictionary?: ServerOptions["dictionary"];
    plugins?: ServerOptions["plugins"];
  },
): Promise<Ctx & { mock: { requests: readonly unknown[] }; globalDir: string; dataDir: string }> {
  const { mockLlm } = await import("@henira/llm-mock");
  const mock = mockLlm(script);
  const dataDir = path.join(root, `data-${Math.random().toString(36).slice(2, 8)}`);
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  // mock 模型默认配置（无它回合死于 NoDefaultModelError——引擎消息英文，D-050 第 2 款）
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const server = await createServer({
    dataDir,
    globalDir,
    token: opts?.token,
    llm: llmStub(mock.service),
    dictionary: opts?.dictionary,
    plugins: opts?.plugins,
  });
  return {
    server,
    base: server.url,
    mock,
    globalDir,
    dataDir,
    cleanup: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** SSE 订阅者：真 HTTP 读 text/event-stream，帧入 sink；返回关闭函数 */
function subscribe(base: string, sink: ServerFrame[], signal?: AbortSignal): void {
  void (async () => {
    try {
      const res = await fetch(`${base}/api/events`, { signal });
      const reader = res.body?.getReader();
      if (reader === undefined) return;
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              sink.push(JSON.parse(line.slice(6)) as ServerFrame);
            }
          }
          index = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // 断开（stop / abort / 溢出）——volatile 契约：客户端重连重拉
    }
  })();
}

/** 轮询等待谓词成立（CI 纪律：异步断言禁固定 sleep；fn 可同步可异步——async 返回值必须
 *  await，否则 promise 对象恒 ≠ undefined 会立即假通过，R127 教训；返回类型自动剥 undefined） */
async function waitFor<RT>(
  fn: () => RT,
  timeoutMs = 5000,
): Promise<Exclude<Awaited<RT>, undefined>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value as Exclude<Awaited<RT>, undefined>;
    if (Date.now() > deadline) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function framesFor(sink: ServerFrame[], sessionId: string): ServerFrame[] {
  return sink.filter((f) => f.kind !== "connected" && f.sessionId === sessionId);
}

async function createSession(base: string, cwd?: string): Promise<string> {
  const res = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cwd === undefined ? {} : { cwd }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

describe("回环三件套（判据⑤）", () => {
  it("只绑 127.0.0.1 + 随机端口 + Host/Origin 校验：恶意 Origin 403、正常连接 200", async () => {
    const { server, base, cleanup } = await makeServer([]);
    try {
      expect(server.port).not.toBe(0); // 随机端口已分配
      expect(new URL(server.url).hostname).toBe("127.0.0.1"); // 只绑回环
      const good = await fetch(`${base}/api/server/info`);
      expect(good.status).toBe(200);
      const evil = await fetch(`${base}/api/server/info`, {
        headers: { origin: "http://evil.example" }, // 恶意网页把域名解析到 127.0.0.1 冒充
      });
      expect(evil.status).toBe(403);
    } finally {
      await cleanup();
    }
  });

  it("可选 token 位：HENIRA_SERVER_TOKEN 语义——无 token 401、Bearer 200、?token= 200", async () => {
    const { server, base, cleanup } = await makeServer([], { token: "secret-token" });
    try {
      expect((await fetch(`${base}/api/server/info`)).status).toBe(401);
      expect(
        (
          await fetch(`${base}/api/server/info`, {
            headers: { authorization: "Bearer secret-token" },
          })
        ).status,
      ).toBe(200);
      expect((await fetch(`${base}/api/server/info?token=secret-token`)).status).toBe(200);
      expect(server.token).toBe("secret-token"); // server.json 携带（客户端发现）
    } finally {
      await cleanup();
    }
  });
});

describe("回合全链（mock LLM + 真 HTTP）", () => {
  it("prompt → SSE 增量帧到齐（用户行 / 助手流式 / 落定）→ busy 落 false；seq 单调（断档不猜的服务端半边）", async () => {
    // 慢速流（块间 30ms > 16ms 攒批窗）：中途增量以 row.delta 到达，尾段被账本落定整行替换
    const slowStream = async function* () {
      yield mockText("你好");
      await new Promise((r) => setTimeout(r, 30));
      yield mockText("，世界");
      await new Promise((r) => setTimeout(r, 30));
      yield mockUsage({ inputTokens: 1, outputTokens: 2 });
      yield mockFinish("stop");
    };
    const { base, cleanup } = await makeServer([slowStream]);
    const sink: ServerFrame[] = [];
    try {
      const id = await createSession(base);
      subscribe(base, sink);
      const res = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "打招呼" }),
      });
      const receipt = (await res.json()) as { queued: boolean; id: string | null };
      expect(receipt).toEqual({ queued: false, id: null }); // 闲时直跑

      await waitFor(() => {
        const frames = framesFor(sink, id);
        const ended = frames.some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
        );
        return ended ? frames : undefined;
      });

      const frames = framesFor(sink, id);
      const ops = frames.flatMap((f) => (f.kind === "delta" ? [f.delta.op] : []));
      expect(ops).toContain("row.appended"); // 用户行
      expect(ops).toContain("row.delta"); // 流式碎片
      // seq 单调：同会话 delta 帧连续 +1
      const seqs = frames.flatMap((f) => (f.kind === "delta" ? [f.seq] : []));
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe(seqs[i - 1] + 1);
      }
      // 快照帧水位 ≤ 首个增量帧水位（先连后 prompt，快照先到）
      const snapshot = frames.find((f) => f.kind === "snapshot");
      expect(snapshot).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("判据①：两个网页同时连接同一会话，增量都到达", async () => {
    const { base, cleanup } = await makeServer([[mockText("回复"), mockFinish("stop")]]);
    const sinkA: ServerFrame[] = [];
    const sinkB: ServerFrame[] = [];
    try {
      const id = await createSession(base);
      subscribe(base, sinkA);
      subscribe(base, sinkB);
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "问" }),
      });
      const rowsOf = (sink: ServerFrame[]): string[] | undefined => {
        const frames = framesFor(sink, id);
        const userAppended = frames.some(
          (f) => f.kind === "delta" && f.delta.op === "row.appended" && f.delta.row.kind === "user",
        );
        const ended = frames.some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
        );
        return userAppended && ended ? ["ok"] : undefined;
      };
      await Promise.all([waitFor(() => rowsOf(sinkA)), waitFor(() => rowsOf(sinkB))]);
      expect(sinkA.some((f) => f.kind === "delta")).toBe(true);
      expect(sinkB.some((f) => f.kind === "delta")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("判据②：审批挂起 → 新客户端重连快照即见审批行（重放）→ REST 收答 → 回合继续", async () => {
    // 非并发安全工具 → 默认放行层不适用 → approval/request 缝 → answerer（server InteractionService）
    const { server, base, cleanup } = await makeServer([
      [mockToolCall("c1", "demo-write", "{}"), mockFinish("tool-calls")],
      [mockText("已处理"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const sink: ServerFrame[] = [];
    try {
      const id = await createSession(base);
      // 注册非并发安全工具（缺省注册表不自带工具——宿主组合面）
      server.registry
        .get(id)
        ?.ctx.get("tools")
        .register({
          name: "demo-write",
          description: "demo write tool (requires approval)",
          inputSchema: { type: "object", properties: {} },
          execute: async () => ({ content: "written" }),
        });
      const promptRes = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "写文件" }),
      });
      expect(promptRes.status).toBe(200);

      // 首个客户端看到挂起审批行
      subscribe(base, sink);
      const pendingRow = await waitFor(() => {
        for (const f of framesFor(sink, id)) {
          if (
            f.kind === "delta" &&
            f.delta.op === "row.appended" &&
            f.delta.row.kind === "approval"
          ) {
            return f.delta.row;
          }
        }
        return undefined;
      });
      expect(pendingRow).toMatchObject({ status: "pending", toolName: "demo-write" });

      // 断线重连（判据②本体）：新客户端首帧快照即携带挂起审批行
      const reconnect: ServerFrame[] = [];
      subscribe(base, reconnect);
      const replayed = await waitFor(() => {
        const snapshot = reconnect.find(
          (f): f is Extract<ServerFrame, { kind: "snapshot" }> =>
            f.kind === "snapshot" && f.sessionId === id,
        );
        if (snapshot === undefined) return undefined;
        const row = snapshot.snapshot.rows.find(
          (r): r is Extract<import("@henira/protocol").Row, { kind: "approval" }> =>
            r.kind === "approval" && r.status === "pending",
        );
        return row;
      });
      expect(replayed).toMatchObject({ status: "pending" });

      // REST 收答（先答者赢）→ 回合继续 → 收尾
      const settle = await fetch(`${base}/api/sessions/${id}/approvals/${pendingRow.requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "rejected" }),
      });
      expect(((await settle.json()) as { applied: boolean }).applied).toBe(true);
      expect(
        (
          await fetch(`${base}/api/sessions/${id}/approvals/${pendingRow.requestId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision: "allowed-once" }),
          })
        ).status,
      ).toBe(200); // 幂等：迟到答案不炸（applied=false 语义在 interaction 层）

      await waitFor(() => {
        const frames = framesFor(sink, id);
        const settled = frames.some(
          (f) =>
            f.kind === "delta" &&
            f.delta.op === "row.upserted" &&
            f.delta.row.kind === "approval" &&
            f.delta.row.status === "settled",
        );
        const ended = frames.some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
        );
        return settled && ended ? true : undefined;
      });
      // 快照终态：审批 settled + 工具行 error（被拒）
      const snap = await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json();
      const rows = (snap as { rows: { kind: string; status?: string }[] }).rows;
      expect(rows.some((r) => r.kind === "approval" && r.status === "settled")).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

describe("REST 面与设置", () => {
  it("设置读写 / 凭据只写不读（D-030）", async () => {
    const { base, cleanup } = await makeServer([]);
    try {
      const put = await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "mock/mock-1", ui: { theme: "dark" } }),
      });
      expect(put.status).toBe(200);
      const settings = (await (await fetch(`${base}/api/settings`)).json()) as {
        model?: string;
        ui?: { theme?: string };
      };
      expect(settings.model).toBe("mock/mock-1");
      expect(settings.ui?.theme).toBe("dark");

      await fetch(`${base}/api/credentials/deepseek`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "sk-secret-value" }),
      });
      const settingsAgain = await (await fetch(`${base}/api/settings`)).text();
      expect(settingsAgain).not.toContain("sk-secret-value"); // 明文永不回读
      expect((await fetch(`${base}/api/credentials/deepseek`)).status).toBe(404); // 无 GET 端点
    } finally {
      await cleanup();
    }
  });

  it("文件列表：会话工作区围栏（越界 400）+ 隐藏项不返", async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-cwd-"));
    await fs.writeFile(path.join(cwd, "visible.txt"), "hi");
    await fs.mkdir(path.join(cwd, "sub"));
    await fs.writeFile(path.join(cwd, ".hidden"), "x");
    const { base, cleanup } = await makeServer([]);
    try {
      const id = await createSession(base, cwd);
      const list = (await (await fetch(`${base}/api/sessions/${id}/files`)).json()) as {
        name: string;
        kind: string;
      }[];
      expect(list.map((e) => e.name).sort()).toEqual(["sub", "visible.txt"]);
      expect((await fetch(`${base}/api/sessions/${id}/files?path=..%2F..`)).status).toBe(400); // 越界拒
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("模型目录收敛批：闸门（无 key/缺地址不可选）+ 连接种地址 + 条目显示名/徽章位", async () => {
    const { base, cleanup, globalDir } = await makeServer([]);
    try {
      // 手写 models.json 但无凭据 → 闸门拦下（不能跑的厂商不进选择器）
      await fs.writeFile(
        path.join(globalDir, "models.json"),
        JSON.stringify({
          providers: {
            deepseek: { baseUrl: "https://api.deepseek.com" },
          },
        }),
        "utf8",
      );
      const gated = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<string, unknown>;
      };
      expect(gated.providers.deepseek).toBeUndefined(); // 无 key → 不出现

      // 连接（只填 key）→ 快照 endpoint 种进 models.json + 选择器并入带显示名/徽章位
      const put = await fetch(`${base}/api/providers/deepseek/connect`, {
        method: "PUT",
        body: JSON.stringify({ key: "sk-test-secret-123" }),
      });
      expect(put.status).toBe(200);
      const modelsFile = JSON.parse(
        await fs.readFile(path.join(globalDir, "models.json"), "utf8"),
      ) as { providers?: Record<string, { baseUrl?: string }> };
      expect(modelsFile.providers?.deepseek?.baseUrl).toBe("https://api.deepseek.com"); // 目录种子
      const catalog = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<
          string,
          {
            baseUrl?: string;
            reasoning?: string;
            models?: Array<{
              id: string;
              name?: string;
              contextWindow?: number;
              vision?: boolean;
              reasoning?: boolean;
              reasoningOptions?: Array<{ type: string; values?: string[] }>;
            }>;
          }
        >;
      };
      const deepseek = catalog.providers.deepseek;
      expect(deepseek?.baseUrl).toBe("https://api.deepseek.com");
      expect(deepseek?.reasoning).toBe("thinking-effort"); // thinking 开关 + reasoning_effort 形状族
      expect((deepseek?.models ?? []).length).toBeGreaterThan(0);
      const first = deepseek?.models?.[0];
      expect(first?.name).toBeTruthy(); // 显示名（快照 name 透传）
      // 思考档数据驱动：模型条目带 reasoningOptions（models.dev 真源——toggle+effort 三档）
      const withOptions = (deepseek?.models ?? []).find(
        (m) => (m.reasoningOptions ?? []).length > 0,
      );
      expect(withOptions?.reasoningOptions?.some((o) => o.type === "toggle")).toBe(true);
      expect(
        withOptions?.reasoningOptions?.some(
          (o) => o.type === "effort" && (o.values ?? []).includes("max"),
        ),
      ).toBe(true);
      // 至少一个模型带徽章位（快照 324 家的 vision/reasoning 已再生入库）
      const withBadge = (deepseek?.models ?? []).some(
        (m) => m.vision === true || m.reasoning === true,
      );
      expect(withBadge).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("界面绑定状态（D-063）：全局缺省/写读 roundtrip/非法 400；每会话缺省/写读/落盘会话目录/未知 404/超限 400；重启同盘读回", async () => {
    const { server, base, cleanup, dataDir } = await makeServer([]);
    try {
      // 全局：缺省
      let res = await fetch(`${base}/api/ui-state`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ lastSessionId: null });
      // 写读 roundtrip + 真落 state/ui.json
      res = await fetch(`${base}/api/ui-state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastSessionId: "s-x-abcdef" }),
      });
      expect(res.status).toBe(200);
      const globalRead = (await (await fetch(`${base}/api/ui-state`)).json()) as {
        lastSessionId: string | null;
      };
      expect(globalRead.lastSessionId).toBe("s-x-abcdef");
      const globalFile = JSON.parse(
        await fs.readFile(path.join(dataDir, "state", "ui.json"), "utf8"),
      ) as { lastSessionId: string | null };
      expect(globalFile.lastSessionId).toBe("s-x-abcdef");
      // 非法形状 400
      res = await fetch(`${base}/api/ui-state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastSessionId: 42 }),
      });
      expect(res.status).toBe(400);

      // 每会话：缺省 → 写读 → 文件落在会话目录
      const id = await createSession(base);
      res = await fetch(`${base}/api/sessions/${id}/ui-state`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({});
      res = await fetch(`${base}/api/sessions/${id}/ui-state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draft: "继续写",
          layout: { leftWidth: 320 },
        }),
      });
      expect(res.status).toBe(200);
      res = await fetch(`${base}/api/sessions/${id}/ui-state`);
      expect(await res.json()).toEqual({
        draft: "继续写",
        layout: { leftWidth: 320 },
      });
      const keys = await fs.readdir(path.join(dataDir, "projects"));
      expect(keys.length).toBe(1);
      const projectKey = keys[0] as string;
      const sessionFile = path.join(
        dataDir,
        "projects",
        projectKey,
        "sessions",
        id,
        "ui-state.json",
      );
      expect(JSON.parse(await fs.readFile(sessionFile, "utf8"))).toMatchObject({ draft: "继续写" });
      // 未知会话 404；非对象 400；超 64KB 400
      expect((await fetch(`${base}/api/sessions/s-no-nothing/ui-state`)).status).toBe(404);
      res = await fetch(`${base}/api/sessions/${id}/ui-state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([1, 2]),
      });
      expect(res.status).toBe(400);
      res = await fetch(`${base}/api/sessions/${id}/ui-state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft: "x".repeat(65 * 1024) }),
      });
      expect(res.status).toBe(400);
    } finally {
      await server.stop(); // 停服不删盘——重启还原段复用同一 dataDir
    }

    // 重启还原（D-063 判据）：同 dataDir 新 server 实例读回两份文档；每会话走扫盘兜底路径
    const server2 = await createServer({
      dataDir,
      globalDir: path.join(dataDir, "config"),
      llm: llmStub({ stream: async function* () {} } as unknown as LlmService),
    });
    try {
      const base2 = server2.url;
      const globalRead2 = (await (await fetch(`${base2}/api/ui-state`)).json()) as {
        lastSessionId: string | null;
      };
      expect(globalRead2.lastSessionId).toBe("s-x-abcdef");
      const keys2 = await fs.readdir(path.join(dataDir, "projects"));
      const sessions2 = await fs.readdir(
        path.join(dataDir, "projects", keys2[0] as string, "sessions"),
      );
      const res = await fetch(`${base2}/api/sessions/${sessions2[0]}/ui-state`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ draft: "继续写" });
    } finally {
      await server2.stop();
      await cleanup();
    }
  });

  it("server.json 握手文件生命周期：跑时在、停后删", async () => {
    const dataDir = path.join(root, `handshake-${Math.random().toString(36).slice(2, 8)}`);
    const server = await createServer({
      dataDir,
      globalDir: path.join(dataDir, "config"),
      llm: llmStub({ stream: async function* () {} } as unknown as LlmService),
    });
    const handshake = path.join(dataDir, "state", "server.json");
    const written = JSON.parse(await fs.readFile(handshake, "utf8")) as {
      port: number;
      pid: number;
      token?: string;
    };
    expect(written.port).toBe(server.port);
    expect(written.pid).toBe(process.pid);
    await server.stop();
    await expect(fs.access(handshake)).rejects.toThrow(); // 停后删
  });

  it("历史会话快照：进程重启后从账本重建（真相兜底）", async () => {
    const dataDir = path.join(root, `history-${Math.random().toString(36).slice(2, 8)}`);
    const first = await createServer({
      dataDir,
      globalDir: path.join(dataDir, "config"),
      llm: llmStub({ stream: async function* () {} } as unknown as LlmService),
    });
    const id = await createSession(first.url);
    await first.stop();

    // 新进程：同一 dataDir，未装配该会话——快照仍可从账本读出
    const second = await createServer({
      dataDir,
      globalDir: path.join(dataDir, "config"),
      llm: llmStub({ stream: async function* () {} } as unknown as LlmService),
    });
    try {
      const res = await fetch(`${second.url}/api/sessions/${id}/snapshot`);
      expect(res.status).toBe(200);
      const snapshot = (await res.json()) as { sessionId: string; rows: unknown[] };
      expect(snapshot.sessionId).toBe(id);
      const list = (await (await fetch(`${second.url}/api/sessions`)).json()) as {
        id: string;
        busy: boolean;
      }[];
      expect(list.some((s) => s.id === id)).toBe(true);
    } finally {
      await second.stop();
    }
  });

  it("ui-assets（D-059）：清单枚举已装语言包 + 资产只读伺服 + 穿越与非法 kind 拒绝", async () => {
    const { base, dataDir, cleanup } = await makeServer([]);
    try {
      const v = path.join(dataDir, "plugins", "ja-pack", "1.0.0");
      await fs.mkdir(path.join(v, "locales"), { recursive: true });
      await fs.writeFile(
        path.join(v, "locales", "ja.json"),
        JSON.stringify({ "row.reasoning": "思考" }),
        "utf8",
      );
      const list = (await (await fetch(`${base}/api/ui-assets`)).json()) as {
        locales: { pluginId: string; version: string; lang: string; url: string }[];
        themes: unknown[];
      };
      expect(list.locales).toEqual([
        {
          pluginId: "ja-pack",
          version: "1.0.0",
          lang: "ja",
          url: "/api/ui-assets/ja-pack/1.0.0/locales/ja.json",
        },
      ]);
      expect(list.themes).toEqual([]);
      const file = await fetch(`${base}/api/ui-assets/ja-pack/1.0.0/locales/ja.json`);
      expect(file.status).toBe(200);
      expect(await file.json()).toEqual({ "row.reasoning": "思考" });
      // 穿越与非法段：编码斜杠段（SAFE_SEG 拒）→ 400；编码点段被 HTTP 栈规范化吞掉 → 404（仍安全，
      // 路由层 SAFE_SEG + startsWith 双防线在，观察行为按栈规范化结果断言）；不存在的资产 → 404
      expect((await fetch(`${base}/api/ui-assets/ja%2Fpack/1.0.0/locales/ja.json`)).status).toBe(
        400,
      );
      expect((await fetch(`${base}/api/ui-assets/ja-pack/%2E%2E/locales/ja.json`)).status).toBe(
        404,
      );
      expect((await fetch(`${base}/api/ui-assets/ja-pack/1.0.0/nope/ja.json`)).status).toBe(400);
      expect((await fetch(`${base}/api/ui-assets/ja-pack/1.0.0/locales/ko.json`)).status).toBe(404);
    } finally {
      await cleanup();
    }
  });
});

// ── 目录登记与删除（data-directory §4/§7；D-060）──

describe("目录登记与删除", () => {
  it("建会话带 cwd 自动登记 + 列表；cwd 相对路径 400（POST /api/sessions）", async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-autoreg-"));
    const { base, cleanup } = await makeServer([]);
    try {
      const id = await createSession(base, cwd);
      const dirs = (await (await fetch(`${base}/api/dirs`)).json()) as {
        id: string;
        cwd: string;
        key: string;
        displayName: string;
        openCount: number;
        lastSessionId?: string | null;
      }[];
      expect(dirs).toHaveLength(1);
      expect(dirs[0]?.cwd).toBe(cwd);
      expect(dirs[0]?.displayName).toBe(path.basename(cwd));
      expect(dirs[0]?.openCount).toBe(1);
      expect(dirs[0]?.lastSessionId).toBe(id);
      expect(dirs[0]?.key).toMatch(/^--.+-[0-9a-f]{8}--$/);
      const bad = await fetch(`${base}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "relative/path" }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("POST /api/dirs 登记校验序列（缺 cwd / 相对 / 不存在 / 非目录 / 成功）", async () => {
    const { base, cleanup } = await makeServer([]);
    const fileCwd = await fs.mkdtemp(path.join(tmpdir(), "henira-dirs-"));
    try {
      const post = async (body: unknown): Promise<Response> =>
        fetch(`${base}/api/dirs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      expect((await post({})).status).toBe(400);
      expect((await post({ cwd: "demo" })).status).toBe(400); // 相对路径
      expect((await post({ cwd: path.join(fileCwd, "missing") })).status).toBe(400); // 不存在
      const notDir = path.join(fileCwd, "file.txt");
      await fs.writeFile(notDir, "x");
      expect((await post({ cwd: notDir })).status).toBe(400); // 不是目录
      const ok = await post({ cwd: fileCwd });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { ok: boolean; dir: { displayName: string } };
      expect(body.ok).toBe(true);
      expect(body.dir.displayName).toBe(path.basename(fileCwd));
    } finally {
      await cleanup();
      await fs.rm(fileCwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("GET /api/dirs/browse：一层目录 + 隐藏项不返 + 不存在 404 + 盘符根（平台分档）", async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-browse-"));
    await fs.mkdir(path.join(cwd, "sub"));
    await fs.mkdir(path.join(cwd, ".hidden"));
    const { base, cleanup } = await makeServer([]);
    try {
      const res = await fetch(`${base}/api/dirs/browse?path=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        path: string;
        parent: string;
        items: { name: string; path: string; type: string }[];
      };
      expect(body.path).toBe(cwd);
      expect(body.parent).toBe(path.dirname(cwd));
      expect(body.items).toEqual([{ name: "sub", path: path.join(cwd, "sub"), type: "directory" }]);
      expect(
        (await fetch(`${base}/api/dirs/browse?path=${encodeURIComponent(path.join(cwd, "nope"))}`))
          .status,
      ).toBe(404);
      const drives = (await (await fetch(`${base}/api/dirs/browse?path=__drives__`)).json()) as {
        items: { path: string; type: string }[];
      };
      if (process.platform === "win32") {
        expect(drives.items.length).toBeGreaterThan(0);
        expect(drives.items.every((i) => i.type === "drive")).toBe(true);
      } else {
        expect(drives.items).toEqual([{ name: "/", path: "/", type: "directory" }]);
      }
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("DELETE /api/sessions/:id：busy 409 拒绝；闲时删账本目录 + 快照 404 + 列表移除", async () => {
    const { base, cleanup } = await makeServer(["hang"]);
    try {
      const id = await createSession(base);
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "跑起来" }),
      });
      await waitFor(async () => {
        const list = (await (await fetch(`${base}/api/sessions`)).json()) as {
          id: string;
          busy: boolean;
        }[];
        return list.find((s) => s.id === id)?.busy === true ? true : undefined;
      });
      const busy = await fetch(`${base}/api/sessions/${id}`, { method: "DELETE" });
      expect(busy.status).toBe(409);
      expect(((await busy.json()) as { code: string }).code).toBe("session_busy");
      await fetch(`${base}/api/sessions/${id}/interrupt`, { method: "POST" });
      await waitFor(async () => {
        const list = (await (await fetch(`${base}/api/sessions`)).json()) as {
          id: string;
          busy: boolean;
        }[];
        return list.find((s) => s.id === id)?.busy === false ? true : undefined;
      });
      const del = await fetch(`${base}/api/sessions/${id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
      expect((await fetch(`${base}/api/sessions/${id}/snapshot`)).status).toBe(404);
      const list = (await (await fetch(`${base}/api/sessions`)).json()) as { id: string }[];
      expect(list.some((s) => s.id === id)).toBe(false); // 磁盘扫描也不在（账本目录已删）
    } finally {
      await cleanup();
    }
  });

  it("DELETE /api/dirs/:id：busy blocked（200 语义响应）；闲时删账本树+检查点树+登记；未知 id 幂等", async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-dirdel-"));
    const { base, dataDir, cleanup } = await makeServer(["hang"]);
    try {
      const id = await createSession(base, cwd);
      const dirs = (await (await fetch(`${base}/api/dirs`)).json()) as {
        id: string;
        cwd: string;
        key: string;
      }[];
      const entry = dirs.find((d) => d.cwd === cwd) as { id: string; key: string };
      // busy → blocked（200 + {ok:false, blocked:[ids]}，非 4xx——批操作语义，与删会话 409 双轨）
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "跑起来" }),
      });
      await waitFor(async () => {
        const list = (await (await fetch(`${base}/api/sessions`)).json()) as {
          id: string;
          busy: boolean;
        }[];
        return list.find((s) => s.id === id)?.busy === true ? true : undefined;
      });
      const blocked = (await (
        await fetch(`${base}/api/dirs/${entry.id}`, { method: "DELETE" })
      ).json()) as { ok: boolean; blocked?: string[] };
      expect(blocked.ok).toBe(false);
      expect(blocked.blocked).toEqual([id]);
      await fetch(`${base}/api/sessions/${id}/interrupt`, { method: "POST" });
      await waitFor(async () => {
        const list = (await (await fetch(`${base}/api/sessions`)).json()) as {
          id: string;
          busy: boolean;
        }[];
        return list.find((s) => s.id === id)?.busy === false ? true : undefined;
      });
      const del = await fetch(`${base}/api/dirs/${entry.id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
      await expect(fs.access(cwd)).resolves.toBeUndefined(); // 盘上工作目录本身不动（§7）
      await expect(fs.access(path.join(dataDir, "projects", entry.key))).rejects.toThrow();
      await expect(fs.access(path.join(dataDir, "checkpoints", entry.key))).rejects.toThrow();
      expect(await (await fetch(`${base}/api/dirs`)).json()).toEqual([]); // 登记条目移除
      // 未知 id 幂等
      const again = await fetch(`${base}/api/dirs/nonexistent0`, { method: "DELETE" });
      expect(again.status).toBe(200);
      expect(((await again.json()) as { ok: boolean }).ok).toBe(true);
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(process.platform !== "win32")(
    "DELETE /api/dirs/:id 目录被进程占用 → 500 形状化错误体（error+detail）；释放后重删成功",
    async () => {
      const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-dirlock-"));
      const { base, dataDir, cleanup } = await makeServer([]);
      const child = spawn(
        process.execPath,
        [
          "-e",
          "let d='';process.stdin.on('data',(c)=>d+=c);process.stdin.on('end',()=>{process.chdir(d.trim());process.stdout.write('ready');setInterval(()=>{},1000)})",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      try {
        await createSession(base, cwd);
        const dirs = (await (await fetch(`${base}/api/dirs`)).json()) as {
          id: string;
          key: string;
        }[];
        const entry = dirs[0] as { id: string; key: string };
        const sessionsDir = path.join(dataDir, "projects", entry.key, "sessions");
        // 子进程 CWD 钉进账本树内（Windows：目录为进程工作目录时 rm EBUSY——确定性占用）；
        // stdout 哨兵「ready」= chdir 完成，不赌启动时序
        child.stdin.write(sessionsDir);
        child.stdin.end();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("lock child never became ready")), 5000);
          child.stdout?.on("data", (chunk: Buffer) => {
            if (chunk.toString().includes("ready")) {
              clearTimeout(timer);
              resolve();
            }
          });
        });
        const res = await fetch(`${base}/api/dirs/${entry.id}`, { method: "DELETE" });
        expect(res.status).toBe(500); // rm 重试耗尽后仍失败 → 形状化错误体（不再裸 500 无形状）
        const body = (await res.json()) as { error?: string; detail?: string };
        expect(body.error).toBe("delete failed");
        expect((body.detail ?? "").length).toBeGreaterThan(0);
        child.kill();
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
        const retry = await fetch(`${base}/api/dirs/${entry.id}`, { method: "DELETE" });
        expect(retry.status).toBe(200); // 占用释放后重删走通（失败后登记条目仍在——可重试语义）
        expect(((await retry.json()) as { ok: boolean }).ok).toBe(true);
        expect(await (await fetch(`${base}/api/dirs`)).json()).toEqual([]);
      } finally {
        child.kill();
        await cleanup();
        await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
      }
    },
    20000, // rm 重试退避 + 子进程哨兵 + 两轮 DELETE，Windows 本机实测远超默认 5s
  );

  it("中文目录名删除全链路（用户实测场景）：登记+建会话+DELETE 200+账本树消失——形态闸不拦 CJK slug", async () => {
    // 真根因回归：原 ASCII 正则把中文目录 key 全判非法 → 删中文目录必 500（R130）
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-中文目录-"));
    const { base, dataDir, cleanup } = await makeServer([]);
    try {
      await createSession(base, cwd); // 会话树落在 projects/<CJK slug key>/ 下
      const dirs = (await (await fetch(`${base}/api/dirs`)).json()) as { id: string }[];
      expect(dirs).toHaveLength(1);
      const del = await fetch(`${base}/api/dirs/${dirs[0]?.id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
      const keys = await fs.readdir(path.join(dataDir, "projects"));
      expect(keys).toEqual([]); // CJK key 账本树已删
      expect(await (await fetch(`${base}/api/dirs`)).json()).toEqual([]);
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("projects.json 并发写不炸：并发 upsert/list/remove 全 200、终态单条不重复", async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-dirrace-"));
    const { base, dataDir, cleanup } = await makeServer([]);
    try {
      const jobs: Promise<Response>[] = [];
      for (let i = 0; i < 4; i++) {
        // 同一 cwd 的并发 upsert（同 id 幂等）混着并发 list（reconcile 扫盘）与幂等 remove——
        // 修复前固定 .tmp 撞名可炸 ENOENT/EPERM；写互斥 + 唯一 tmp + rename 退避后全 200
        jobs.push(
          fetch(`${base}/api/dirs`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd }),
          }),
        );
        jobs.push(fetch(`${base}/api/dirs`));
        jobs.push(fetch(`${base}/api/dirs/nope0`, { method: "DELETE" }));
      }
      const responses = await Promise.all(jobs);
      for (const r of responses) expect(r.status).toBe(200);
      const list = (await (await fetch(`${base}/api/dirs`)).json()) as { cwd: string }[];
      expect(list.filter((d) => d.cwd.toLowerCase() === cwd.toLowerCase())).toHaveLength(1);
      // 残 tmp 不留（唯一 tmp 命名 + 失败清理）
      const leftovers = (await fs.readdir(dataDir)).filter((n) => n.startsWith("projects.json."));
      expect(leftovers).toEqual([]);
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ── 行翻页与快照窗口化（长会话分页：rowSeq 游标 / 轮边界补齐 / 尾窗）──

  /** 跑一个文本回合并等落定（prompt 单口 D-045）：等 /rows 落账行数收敛（确定性事实——
   *  busy false 有「回合未启动」间隙假过（CI 慢机 POST 返回时回合尚未处理，R127 同款），
   *  期望行数由调用方给（回合前基数 + 2） */
  async function runTurn(
    base: string,
    id: string,
    text: string,
    expectRows: number,
  ): Promise<void> {
    await fetch(`${base}/api/sessions/${id}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await waitFor(async () => {
      const page = (await (await fetch(`${base}/api/sessions/${id}/rows?limit=200`)).json()) as {
        rows: unknown[];
      };
      return page.rows.length >= expectRows ? true : undefined;
    });
  }

  it("快照窗口化 + rowSeq 盖章 + /rows 翻页（游标排他 + 轮边界补齐 + 校验）", async () => {
    // 32 回合 × 2 行（user + assistant）= 64 行 > 尾窗 60 → hasOlder 触发
    const turns = 32;
    const script: MockEntry[] = Array.from({ length: turns }, (_, i) => [
      mockText(`回合 ${i}`),
      mockFinish("stop"),
    ]);
    const { base, cleanup } = await makeServer(script);
    try {
      const id = await createSession(base);
      for (let i = 0; i < turns; i++) await runTurn(base, id, `问 ${i}`, (i + 1) * 2);

      // 快照 = 尾窗 60 + hasOlder + totalRows；行 rowSeq 单调不减
      const snap = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
        rows: { rowSeq: number; rowId: string; kind: string }[];
        hasOlder: boolean;
        totalRows: number;
      };
      expect(snap.totalRows).toBe(turns * 2);
      expect(snap.hasOlder).toBe(true);
      expect(snap.rows).toHaveLength(60);
      const seqs = snap.rows.map((r) => r.rowSeq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // rowSeq 单调不减
      expect(snap.rows.at(-1)?.rowId).toMatch(/^a:/); // 尾行 = 最后 assistant

      // 翻页游标接续：第一页尾窗行段；第二页全是更早的行
      const page1 = (await (await fetch(`${base}/api/sessions/${id}/rows?limit=10`)).json()) as {
        rows: { rowSeq: number }[];
        hasOlder: boolean;
      };
      expect(page1.rows).toHaveLength(10);
      expect(page1.hasOlder).toBe(true);
      const boundary = page1.rows[0]?.rowSeq;
      if (boundary === undefined) throw new Error("page1 empty");
      const page2 = (await (
        await fetch(`${base}/api/sessions/${id}/rows?before=${boundary}&limit=10`)
      ).json()) as { rows: { rowSeq: number }[]; hasOlder: boolean };
      for (const row of page2.rows) {
        expect(row.rowSeq).toBeLessThan(boundary);
      }
      // 全量拉取（limit 100 ≥ totalRows）→ hasOlder false；首行 = 最早的 user/message
      const all = (await (await fetch(`${base}/api/sessions/${id}/rows?limit=100`)).json()) as {
        rows: { rowSeq: number; kind: string; turn: string }[];
        hasOlder: boolean;
      };
      expect(all.rows).toHaveLength(turns * 2);
      expect(all.hasOlder).toBe(false);
      expect(all.rows[0]?.kind).toBe("user");
      expect(all.rows[0]?.rowSeq).toBeGreaterThan(0); // seq=1 是账本基底事件，首行 user/message 在其后

      // 轮边界补齐：limit=1 也回整轮（user + assistant 同 turn 不切散）
      const one = (await (await fetch(`${base}/api/sessions/${id}/rows?limit=1`)).json()) as {
        rows: { kind: string; turn: string }[];
      };
      expect(one.rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
      expect(one.rows[0]?.turn).toBe(one.rows[1]?.turn);

      // 校验：before 非数字 400；未知会话 404
      expect((await fetch(`${base}/api/sessions/${id}/rows?before=abc`)).status).toBe(400);
      expect((await fetch(`${base}/api/sessions/nope/rows`)).status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("磁盘历史会话 /rows：进程重启后从账本重建切片（真相兜底）", async () => {
    const dataDir = path.join(root, `rows-disk-${Math.random().toString(36).slice(2, 8)}`);
    const globalDir = path.join(dataDir, "config");
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(
      path.join(globalDir, "settings.json"),
      JSON.stringify({ version: 1, model: "mock/mock-1" }),
      "utf8",
    );
    const mock = mockLlm([[mockText("存量"), mockFinish("stop")]]);
    const first = await createServer({
      dataDir,
      globalDir,
      llm: llmStub(mock.service),
    });
    const id = await createSession(first.url);
    await runTurn(first.url, id, "老问", 2); // 等 user+assistant 都落账（磁盘重启读取的前置）

    const second = await createServer({
      dataDir,
      globalDir: path.join(dataDir, "config"),
      llm: llmStub({ stream: async function* () {} } as unknown as LlmService),
    });
    try {
      const res = await fetch(`${second.url}/api/sessions/${id}/rows`);
      expect(res.status).toBe(200);
      const page = (await res.json()) as { rows: { kind: string }[]; hasOlder: boolean };
      expect(page.rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
      expect(page.hasOlder).toBe(false);
    } finally {
      await second.stop();
    }
  });
});

// ── 重启续聊（懒挂载 attach）：磁盘历史会话首次写操作按需重建运行体——重启后不再只读 ──

describe("重启续聊（懒挂载 attach）", () => {
  /** 独立 dataDir + settings；start() 每次造新 server（mock 游标每实例归零——重启即换新脚本） */
  async function restartable(script: readonly MockEntry[]): Promise<{
    start: () => Promise<HeniraServer>;
  }> {
    const dataDir = path.join(root, `attach-${Math.random().toString(36).slice(2, 8)}`);
    const globalDir = path.join(dataDir, "config");
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(
      path.join(globalDir, "settings.json"),
      JSON.stringify({ version: 1, model: "mock/mock-1" }),
      "utf8",
    );
    return {
      start: (): Promise<HeniraServer> =>
        createServer({ dataDir, globalDir, llm: llmStub(mockLlm(script).service) }),
    };
  }

  /** 跑一个文本回合并等落定（prompt 单口 D-045 同 runTurn 先例：busy false 有回合未启动间隙假过） */
  async function runTurn(
    base: string,
    id: string,
    text: string,
    expectRows: number,
  ): Promise<void> {
    await fetch(`${base}/api/sessions/${id}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await waitRows(base, id, expectRows);
  }

  /** 等 /rows 行数收敛（确定性事实——不投递的纯等待） */
  async function waitRows(base: string, id: string, expectRows: number): Promise<void> {
    await waitFor(async () => {
      const page = (await (await fetch(`${base}/api/sessions/${id}/rows?limit=200`)).json()) as {
        rows: unknown[];
      };
      return page.rows.length >= expectRows ? true : undefined;
    });
  }

  it("重启后历史会话 prompt 续聊成功：懒挂载重建运行体 + 投影补账（改前 404）", async () => {
    const ctx = await restartable([[mockText("存量"), mockFinish("stop")]]);
    const first = await ctx.start();
    const id = await createSession(first.url);
    await runTurn(first.url, id, "老问", 2); // 重启前存量 2 行（磁盘读取的前置）
    await first.stop();

    const second = await ctx.start();
    try {
      // 改前：requireEntry 纯内存查 → 404；改后：懒挂载续聊
      const res = await fetch(`${second.url}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "重启后问" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { queued: boolean };
      expect(body.queued).toBe(false); // 闲直跑（挂载后 loop 在场）
      await waitRows(second.url, id, 4); // 存量 2 行 + 新回合 2 行落账
      // 快照从在订投影出（懒挂载已从账本补账——含重启前历史），busy 状态真实化
      const snap = (await (await fetch(`${second.url}/api/sessions/${id}/snapshot`)).json()) as {
        rows: { kind: string }[];
        totalRows: number;
      };
      expect(snap.totalRows).toBe(4);
      const list = (await (await fetch(`${second.url}/api/sessions`)).json()) as {
        id: string;
        busy: boolean;
      }[];
      expect(list.find((s) => s.id === id)?.busy).toBe(false);
    } finally {
      await second.stop();
    }
  });

  it("重启后未知 id prompt 仍 404（磁盘无目录不挂垃圾）", async () => {
    const ctx = await restartable([]);
    const server = await ctx.start();
    try {
      const res = await fetch(`${server.url}/api/sessions/s-nothing-000000/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "问" }),
      });
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it("attach 幂等 + 并发去重：并行两次与串行三次同一引用", async () => {
    const ctx = await restartable([]);
    const first = await ctx.start();
    const id = await createSession(first.url);
    await first.stop();
    const second = await ctx.start();
    try {
      const [a, b] = await Promise.all([second.registry.attach(id), second.registry.attach(id)]);
      expect(a).toBeDefined();
      expect(a).toBe(b); // 并发共享同一次挂载
      expect(await second.registry.attach(id)).toBe(a); // 在订即返回
    } finally {
      await second.stop();
    }
  });

  it("另一活进程持锁：prompt 409 session_busy（不误挂）", async () => {
    const ctx = await restartable([[mockText("存量"), mockFinish("stop")]]);
    const first = await ctx.start();
    const id = await createSession(first.url);
    await runTurn(first.url, id, "老问", 2);
    // first 仍活着（在订持 session.lock）；第二个 server 同盘懒挂载 → SessionLockedError → 409
    const second = await ctx.start();
    try {
      const res = await fetch(`${second.url}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "问" }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("session_busy");
    } finally {
      await second.stop();
      await first.stop();
    }
  });
});

describe("模型管理面（四视图服务端半边）", () => {
  it("presets 全表 + 连接 → 选择器并入 + 分组连接态；key 明文永不回读（D-030）", async () => {
    const { base, cleanup, globalDir } = await makeServer([]);
    try {
      const presets = (await (await fetch(`${base}/api/models.presets`)).json()) as {
        presets: Record<string, { name?: string; models: Record<string, unknown> }>;
      };
      expect(Object.keys(presets.presets).length).toBeGreaterThan(100); // 快照 324 家
      expect(presets.presets.deepseek?.name).toBe("DeepSeek");
      expect(Object.keys(presets.presets.deepseek?.models ?? {}).length).toBeGreaterThan(0);

      // 连接已知厂商（只填 key）→ credentials.json 在册 + 选择器清单并入
      const put = await fetch(`${base}/api/providers/deepseek/connect`, {
        method: "PUT",
        body: JSON.stringify({ key: "sk-test-secret-123" }),
      });
      expect(put.status).toBe(200);
      const credFile = JSON.parse(
        await fs.readFile(path.join(globalDir, "credentials.json"), "utf8"),
      ) as { providers?: Record<string, string> };
      expect(credFile.providers?.deepseek).toBe("sk-test-secret-123"); // 落盘正确
      const catalog = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<string, { models?: string[] }>;
      };
      expect(catalog.providers.deepseek?.models?.length).toBeGreaterThan(0);

      // 管理分组：连接态 + 显示名 + 模型条目全开；明文不出响应体
      const list = (await (await fetch(`${base}/api/providers`)).json()) as {
        providers: Array<{
          id: string;
          name?: string;
          connected: boolean;
          models: Array<{ id: string; enabled: boolean }>;
        }>;
      };
      const group = list.providers.find((p) => p.id === "deepseek");
      expect(group?.connected).toBe(true);
      expect(group?.name).toBe("DeepSeek");
      expect((group?.models ?? []).length).toBeGreaterThan(0);
      expect((group?.models ?? []).every((m) => m.enabled)).toBe(true);
      expect(JSON.stringify(list)).not.toContain("sk-test-secret-123");
    } finally {
      await cleanup();
    }
  });

  it("开关显隐：关 → 选择器过滤 + hidden 落盘；开 → 还原；非法 body 400", async () => {
    const { base, cleanup, globalDir } = await makeServer([]);
    try {
      await fetch(`${base}/api/providers/deepseek/connect`, {
        method: "PUT",
        body: JSON.stringify({ key: "sk-x" }),
      });
      const catalog = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<string, { models?: Array<{ id: string }> }>;
      };
      const modelId = catalog.providers.deepseek?.models?.[0]?.id as string;
      const off = await fetch(
        `${base}/api/providers/deepseek/models/${encodeURIComponent(modelId)}/enabled`,
        { method: "PUT", body: JSON.stringify({ enabled: false }) },
      );
      expect(off.status).toBe(200);
      const after = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<string, { models?: Array<{ id: string }> }>;
      };
      expect(after.providers.deepseek?.models?.some((m) => m.id === modelId)).toBe(false);
      const modelsFile = JSON.parse(
        await fs.readFile(path.join(globalDir, "models.json"), "utf8"),
      ) as { providers?: Record<string, { hidden?: string[] }> };
      expect(modelsFile.providers?.deepseek?.hidden).toContain(modelId);
      await fetch(`${base}/api/providers/deepseek/models/${encodeURIComponent(modelId)}/enabled`, {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
      });
      const restored = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<string, { models?: Array<{ id: string }> }>;
      };
      expect(restored.providers.deepseek?.models?.some((m) => m.id === modelId)).toBe(true);
      const bad = await fetch(
        `${base}/api/providers/deepseek/models/${encodeURIComponent(modelId)}/enabled`,
        { method: "PUT", body: JSON.stringify({ enabled: "yes" }) },
      );
      expect(bad.status).toBe(400);
    } finally {
      await cleanup();
    }
  });

  it("断开：凭据摘键 + 已知厂商只清显隐（baseUrl 保留——2026-11-19 教训锁）；自定义厂商整条删", async () => {
    const { base, cleanup, globalDir } = await makeServer([]);
    try {
      await fetch(`${base}/api/providers/deepseek/connect`, {
        method: "PUT",
        body: JSON.stringify({ key: "sk-x" }),
      });
      const del = await fetch(`${base}/api/providers/deepseek`, { method: "DELETE" });
      expect(del.status).toBe(200);
      const catalog = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<string, unknown>;
      };
      expect(catalog.providers.deepseek).toBeUndefined(); // 闸门：无 key 不可选
      const credFile = JSON.parse(
        await fs.readFile(path.join(globalDir, "credentials.json"), "utf8"),
      ) as { providers?: Record<string, string> };
      expect(credFile.providers?.deepseek).toBeUndefined();
      // 收敛批语义锁：断开不删承重配置——快照种的 baseUrl 仍在 models.json
      const modelsFile = JSON.parse(
        await fs.readFile(path.join(globalDir, "models.json"), "utf8"),
      ) as { providers?: Record<string, { baseUrl?: string; hidden?: string[] }> };
      expect(modelsFile.providers?.deepseek?.baseUrl).toBe("https://api.deepseek.com");
      expect(modelsFile.providers?.deepseek?.hidden).toBeUndefined(); // 显隐已清

      // 自定义厂商：显式模型清单 + baseUrl；无 key = 连接态仍 true（目录条目即在册）
      const custom = (await (
        await fetch(`${base}/api/providers/custom`, {
          method: "POST",
          body: JSON.stringify({
            label: "relay station",
            baseUrl: "https://relay.example.com/v1",
            models: [{ model: "my-model", label: "My Model" }],
          }),
        })
      ).json()) as { ok: boolean; id: string };
      expect(custom.ok).toBe(true);
      expect(custom.id.startsWith("user-")).toBe(true);
      const list = (await (await fetch(`${base}/api/providers`)).json()) as {
        providers: Array<{
          id: string;
          name?: string;
          baseUrl?: string;
          connected: boolean;
          models: Array<{ id: string; name?: string; enabled: boolean }>;
        }>;
      };
      const group = list.providers.find((p) => p.id === custom.id);
      expect(group?.connected).toBe(true);
      expect(group?.name).toBe("relay station");
      expect(group?.baseUrl).toBe("https://relay.example.com/v1");
      expect(group?.models).toEqual([{ id: "my-model", name: "My Model", enabled: true }]);
      const customCatalog = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<
          string,
          { name?: string; baseUrl?: string; models?: Array<{ id: string; name?: string }> }
        >;
      };
      expect(customCatalog.providers[custom.id]?.name).toBe("relay station"); // label 优先（选择器/管理页同口径——收敛批审查 2026-11-19）
      expect(customCatalog.providers[custom.id]?.baseUrl).toBe("https://relay.example.com/v1");
      expect(customCatalog.providers[custom.id]?.models).toEqual([
        { id: "my-model", name: "My Model" },
      ]);
      // 断开自定义 = 摘目录条目
      await fetch(`${base}/api/providers/${custom.id}`, { method: "DELETE" });
      const after = (await (await fetch(`${base}/api/models`)).json()) as {
        providers: Record<string, unknown>;
      };
      expect(after.providers[custom.id]).toBeUndefined();
      // 非法自定义（缺 baseUrl）400
      const bad = await fetch(`${base}/api/providers/custom`, {
        method: "POST",
        body: JSON.stringify({ models: [{ model: "m" }] }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await cleanup();
    }
  });

  it("目录刷新：注入桩字典 refresh → ok:true 且 presets 反映 entries", async () => {
    const { base, cleanup } = await makeServer([], {
      dictionary: {
        loadCache: async () => {},
        refresh: async () => true,
        entries: () => ({
          fakeprov: {
            id: "fakeprov",
            name: "Fake",
            models: { m1: { name: "M One", contextWindow: 4096 } },
          },
        }),
      },
    });
    try {
      const refresh = await (
        await fetch(`${base}/api/models.presets/refresh`, {
          method: "POST",
        })
      ).json();
      expect(refresh).toEqual({ ok: true });
      const presets = (await (await fetch(`${base}/api/models.presets`)).json()) as {
        presets: Record<
          string,
          { name?: string; models: Record<string, { contextWindow?: number }> }
        >;
      };
      expect(presets.presets.fakeprov?.name).toBe("Fake");
      expect(presets.presets.fakeprov?.models.m1?.contextWindow).toBe(4096);
    } finally {
      await cleanup();
    }
  });
});

describe("插件装载（批 C：目录发现 + 确认门 + 目录件装配）", () => {
  /** 写一个最小 engine 件（probe 服务 + inject tools） */
  async function writeProbePack(dataDir: string): Promise<void> {
    const v = path.join(dataDir, "plugins", "probe-pack", "1.0.0");
    await fs.mkdir(path.join(v, "engine"), { recursive: true });
    await fs.writeFile(
      path.join(v, "plugin.json"),
      JSON.stringify({ name: "probe-pack", version: "1.0.0", engine: {} }),
      "utf8",
    );
    await fs.writeFile(
      path.join(v, "engine", "main.js"),
      'export const inject = ["tools"];\nexport default { name: "probe", start() { return { ok: true }; } };\n',
      "utf8",
    );
  }

  it("engine 件：未确认不装载 → confirm 后新会话生效（probe 槽）；/api/plugins 状态跟手 + 指纹", async () => {
    const { server, base, dataDir, cleanup } = await makeServer([]);
    try {
      await writeProbePack(dataDir);
      const before = (await (await fetch(`${base}/api/plugins`)).json()) as {
        plugins: { id: string; state: string; forms: string[] }[];
        fingerprint: string;
      };
      const pending = before.plugins.find((p) => p.id === "probe-pack");
      expect(pending?.state).toBe("awaiting-confirm");
      expect(pending?.forms).toContain("engine");
      // 官方五件在列（source official 由 UI 侧区分；状态 loaded）
      expect(before.plugins.some((p) => p.id === "plugin-loop" && p.state === "loaded")).toBe(true);
      expect(before.fingerprint).toMatch(/^[0-9a-f]{12}$/);

      // 未确认 = fail-closed：会话里没有 probe 槽
      const blocked = await server.registry.create({ cwd: dataDir });
      expect(() =>
        (blocked.ctx as unknown as { get(name: string): unknown }).get("probe"),
      ).toThrow();

      const confirm = await fetch(`${base}/api/plugins/probe-pack/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: "1.0.0" }),
      });
      expect(confirm.status).toBe(200);

      const after = (await (await fetch(`${base}/api/plugins`)).json()) as {
        plugins: { id: string; state: string }[];
      };
      expect(after.plugins.find((p) => p.id === "probe-pack")?.state).toBe("loaded");
      const mounted = await server.registry.create({ cwd: dataDir });
      expect((mounted.ctx as unknown as { get(name: string): unknown }).get("probe")).toEqual({
        ok: true,
      });
    } finally {
      await cleanup();
    }
  });

  it("坏清单 / 依赖违规：跳过 + 告警不挡启动，/api/plugins 可见 failed", async () => {
    const { server, base, globalDir, dataDir, cleanup } = await makeServer([]);
    try {
      const badJson = path.join(dataDir, "plugins", "bad-pack", "1.0.0");
      await fs.mkdir(badJson, { recursive: true });
      await fs.writeFile(path.join(badJson, "plugin.json"), "{", "utf8");
      const forbidden = path.join(dataDir, "plugins", "forbidden-pack", "1.0.0");
      await fs.mkdir(path.join(forbidden, "engine"), { recursive: true });
      await fs.writeFile(
        path.join(forbidden, "plugin.json"),
        JSON.stringify({ name: "forbidden-pack", version: "1.0.0", engine: {} }),
        "utf8",
      );
      await fs.writeFile(
        path.join(forbidden, "engine", "main.js"),
        'export default { name: "x", start() { return {}; } };\n',
        "utf8",
      );
      await fs.writeFile(
        path.join(forbidden, "engine", "package.json"),
        JSON.stringify({ dependencies: { "@henira/protocol": "*" } }),
        "utf8",
      );
      // 依赖违规检查发生在「确认之后」（未确认先卡），预写确认记录再装配
      await fs.writeFile(
        path.join(globalDir, "settings.json"),
        JSON.stringify({
          version: 1,
          model: "mock/mock-1",
          plugins: { "forbidden-pack": { confirmedVersion: "1.0.0" } },
        }),
        "utf8",
      );
      await server.registry.create({ cwd: dataDir });
      const list = (await (await fetch(`${base}/api/plugins`)).json()) as {
        plugins: { id: string; state: string; reason?: string }[];
      };
      // 坏清单不进 plugins 列表（发现层跳过）但服务照常
      expect(list.plugins.some((p) => p.id === "bad-pack")).toBe(false);
      const failed = list.plugins.find((p) => p.id === "forbidden-pack");
      expect(failed?.state).toBe("failed");
      expect(failed?.reason).toContain("@henira/protocol");
      // 启动与建会话不受影响
      const sessions = await fetch(`${base}/api/sessions`);
      expect(sessions.status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("config.plugins 对 serve 生效：清单只列部分官方件 → 缺失槽位按内核报错兜底", async () => {
    const { server, cleanup } = await makeServer([], { plugins: [{ id: "plugin-session" }] });
    try {
      const entry = await server.registry.create({ cwd: root });
      expect(() => entry.ctx.get("loop")).toThrow(); // 清单没列 loop = 不装（听清单的）
      expect(() => entry.ctx.get("tools")).toThrow();
      expect(entry.ctx.get("session")).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("config.plugins 自定义条目：definition 进 harness（非官方 id）", async () => {
    const { server, cleanup } = await makeServer([], {
      plugins: [
        { id: "plugin-session" },
        { id: "plugin-tools" },
        { id: "plugin-llm" },
        { id: "plugin-approval" },
        { id: "plugin-loop" },
        {
          id: "custom-probe",
          definition: { name: "probe", start: () => ({ ok: true }) },
        },
      ],
    });
    try {
      const entry = await server.registry.create({ cwd: root });
      expect((entry.ctx as unknown as { get(name: string): unknown }).get("probe")).toEqual({
        ok: true,
      });
      expect(entry.ctx.get("loop")).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("管理面端点：启停 / 版本钉 / 卸载（官方件一律拒绝；settings 落盘；plugins-data 保留）", async () => {
    const { base, dataDir, globalDir, cleanup } = await makeServer([]);
    const putJson = (urlPath: string, body: unknown): Promise<Response> =>
      fetch(`${base}${urlPath}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      // 装一个双版本 UI 件
      for (const version of ["1.0.0", "2.0.0"]) {
        const v = path.join(dataDir, "plugins", "admin-pack", version);
        await fs.mkdir(v, { recursive: true });
        await fs.writeFile(
          path.join(v, "plugin.json"),
          JSON.stringify({ name: "admin-pack", version }),
          "utf8",
        );
      }

      // 启停：写 settings.plugins.<id>.enabled；官方五件拒绝
      expect((await putJson("/api/plugins/admin-pack/enabled", { enabled: false })).status).toBe(
        200,
      );
      const settings = JSON.parse(
        await fs.readFile(path.join(globalDir, "settings.json"), "utf8"),
      ) as { plugins?: Record<string, { enabled?: boolean }> };
      expect(settings.plugins?.["admin-pack"]?.enabled).toBe(false);
      expect((await putJson("/api/plugins/plugin-loop/enabled", { enabled: false })).status).toBe(
        404,
      );

      // 版本钉：盘上存在的版本 ok；不存在 404；官方件拒绝
      expect((await putJson("/api/plugins/admin-pack/version", { version: "1.0.0" })).status).toBe(
        200,
      );
      expect((await putJson("/api/plugins/admin-pack/version", { version: "9.9.9" })).status).toBe(
        404,
      );
      expect((await putJson("/api/plugins/plugin-loop/version", { version: "1.0.0" })).status).toBe(
        404,
      );

      // 卸载：官方件 403；删 plugins/<id> 整目录；plugins-data 保留；重复卸载 404
      const pluginData = path.join(dataDir, "plugins-data", "admin-pack");
      await fs.mkdir(pluginData, { recursive: true });
      await fs.writeFile(path.join(pluginData, "state.json"), "{}", "utf8");
      expect((await fetch(`${base}/api/plugins/plugin-loop`, { method: "DELETE" })).status).toBe(
        403,
      );
      expect((await fetch(`${base}/api/plugins/admin-pack`, { method: "DELETE" })).status).toBe(
        200,
      );
      await expect(fs.access(path.join(dataDir, "plugins", "admin-pack"))).rejects.toThrow();
      await fs.access(pluginData); // plugins-data 保留（§6.4）
      expect((await fetch(`${base}/api/plugins/admin-pack`, { method: "DELETE" })).status).toBe(
        404,
      );
    } finally {
      await cleanup();
    }
  });
});
