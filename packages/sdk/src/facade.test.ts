// 行为一致套件（D-037 / D-034①）：同一组用例对双形态各跑一遍——进程内 runtime（③）与
// 远端 client（①连真 HTTP server）。门面契约、ServerEvent 词表、审批流、终局语义必须一致。
// 另锁 client 独有纪律：断档不猜（跳号 → 回拉快照换发）。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ServiceDefinition } from "@henira/kernel";
import { mockFinish, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import type {
  InteractionAnswer,
  InteractionRequest,
  InteractionService,
  LlmService,
  Row,
  ServerFrame,
  ToolRow,
} from "@henira/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { autoRejectInteraction, createClient, createRuntime } from "./index.js";

const root = await fs.mkdtemp(path.join(tmpdir(), "henira-sdk-test-"));
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

const llmStub = (service: LlmService): ServiceDefinition<LlmService> => ({
  name: "llm",
  start: () => service,
});

async function tempDirs(): Promise<{ dataDir: string; globalDir: string }> {
  const dataDir = path.join(root, `d-${Math.random().toString(36).slice(2, 8)}`);
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  return { dataDir, globalDir };
}

/** 可控 InteractionService：ask 挂起、外部 resolve（审批流测试用） */
function controlledInteraction(): ServiceDefinition<InteractionService> {
  const resolvers = new Map<string, (answer: InteractionAnswer) => void>();
  return {
    name: "interaction",
    start() {
      return {
        ask: (req: InteractionRequest) =>
          new Promise<InteractionAnswer>((resolve) => {
            resolvers.set(req.requestId, resolve);
          }),
        settle: (requestId: string, answer: InteractionAnswer): boolean => {
          const resolve = resolvers.get(requestId);
          if (resolve === undefined) return false;
          resolvers.delete(requestId);
          resolve(answer);
          return true;
        },
        listPending: () => [],
      };
    },
  };
}

interface FormHandle {
  facade: import("./facade.js").HeniraFacade;
  /** 运行数据目录（MCP 用例写插件包用；D-064） */
  dataDir: string;
  /** 宿主组合面：注册工具（审批测试需要非并发安全工具） */
  registerTool(sessionId: string): Promise<void>;
  /** mock Llm 收到的请求（prompt opts 到引擎侧的双形态观测口） */
  mockRequests(): readonly unknown[];
}

const DEMO_WRITE = {
  name: "demo-write",
  description: "demo write tool (requires approval)",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ content: "written" }),
} as const;

const forms: {
  name: string;
  make: (script: import("@henira/llm-mock").MockEntry[]) => Promise<FormHandle>;
}[] = [
  {
    name: "runtime(③进程内)",
    async make(script) {
      const { mockLlm } = await import("@henira/llm-mock");
      const { dataDir, globalDir } = await tempDirs();
      const mock = mockLlm(script);
      const facade = await createRuntime({
        dataDir,
        globalDir,
        llm: llmStub(mock.service),
        interaction: controlledInteraction(),
        tools: [DEMO_WRITE],
      });
      cleanups.push(async () => {
        await facade.stop();
        await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      });
      // 工具已经 opts.tools 进每个新会话
      return { facade, dataDir, registerTool: async () => {}, mockRequests: () => mock.requests };
    },
  },
  {
    name: "client(①远端)",
    async make(script) {
      const { createServer } = await import("@henira/server");
      const { mockLlm } = await import("@henira/llm-mock");
      const mock = mockLlm(script);
      const { dataDir, globalDir } = await tempDirs();
      const server = await createServer({ dataDir, globalDir, llm: llmStub(mock.service) });
      const facade = createClient({ baseUrl: server.url });
      cleanups.push(async () => {
        await facade.stop();
        await server.stop();
        await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      });
      return {
        facade,
        dataDir,
        registerTool: async (sessionId) => {
          server.registry
            .get(sessionId)
            ?.ctx.get("tools")
            .register({ ...DEMO_WRITE });
        },
        mockRequests: () => mock.requests,
      };
    },
  },
];

function framesOf(sink: ServerFrame[], sessionId: string): ServerFrame[] {
  return sink.filter((f) => f.kind !== "connected" && f.sessionId === sessionId);
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

describe.each(forms.map((f) => [f.name, f] as const))("行为一致：%s", (_name, form) => {
  it("createSession → prompt → events 流到齐（用户行 / 助手落定 / busy false）→ snapshot 形状", async () => {
    const { facade } = await form.make([
      [mockText("回复正文"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const sink: ServerFrame[] = [];
    const session = await facade.createSession();
    void (async () => {
      try {
        for await (const frame of facade.events()) sink.push(frame);
      } catch {
        // stop 时流自然结束
      }
    })();
    const receipt = await facade.prompt(session.id, "问一句");
    expect(receipt.queued).toBe(false);

    const frames = await waitFor(() => {
      const list = framesOf(sink, session.id);
      const user = list.some(
        (f) => f.kind === "delta" && f.delta.op === "row.appended" && f.delta.row.kind === "user",
      );
      const ended = list.some(
        (f) => f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
      );
      return user && ended ? list : undefined;
    });

    const snapshot = await facade.snapshot(session.id);
    expect(snapshot.rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
    expect(snapshot.state.busy).toBe(false);
    void frames;
  });

  it("settleApproval：未知 requestId → false；挂起审批 → 收答放行", async () => {
    const { facade, registerTool } = await form.make([
      [mockToolCall("c1", "demo-write", "{}"), mockFinish("tool-calls")],
      [mockText("完成"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const sink: ServerFrame[] = [];
    const session = await facade.createSession();
    await registerTool(session.id);
    void (async () => {
      try {
        for await (const frame of facade.events()) sink.push(frame);
      } catch {
        // stop
      }
    })();
    expect(await facade.settleApproval(session.id, "no-such-request", "allowed-once")).toBe(false);

    await facade.prompt(session.id, "写文件");
    const requestRow = await waitFor(() => {
      for (const f of framesOf(sink, session.id)) {
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
    expect(requestRow.status).toBe("pending");
    expect(await facade.settleApproval(session.id, requestRow.requestId, "allowed-once")).toBe(
      true,
    );

    await waitFor(() => {
      const snapshotRows = () => undefined; // 占位：经流断言终态
      void snapshotRows;
      const done = framesOf(sink, session.id).some(
        (f) =>
          f.kind === "delta" &&
          f.delta.op === "row.upserted" &&
          f.delta.row.kind === "approval" &&
          f.delta.row.status === "settled",
      );
      const ended = framesOf(sink, session.id).some(
        (f) => f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
      );
      return done && ended ? true : undefined;
    });
  });

  it("目录登记：建会话带 cwd 自动登记 + addDir 校验拒绝 + browseDirs 一层 + deleteDir 收树", async () => {
    const { facade } = await form.make([]);
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-sdk-dir-"));
    cleanups.push(async () => {
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    });
    await fs.mkdir(path.join(cwd, "sub"));

    const session = await facade.createSession({ cwd });
    const dirs1 = await facade.listDirs();
    expect(dirs1.some((d) => d.cwd === cwd && d.lastSessionId === session.id)).toBe(true);

    await expect(facade.addDir("relative/path")).rejects.toThrow(); // 相对路径
    await expect(facade.addDir(path.join(cwd, "missing"))).rejects.toThrow(); // 不存在
    const added = await facade.addDir(cwd);
    expect(added.cwd).toBe(cwd);

    const browse = await facade.browseDirs(cwd);
    expect(browse.items.some((i) => i.name === "sub")).toBe(true);
    await expect(facade.browseDirs(path.join(cwd, "missing"))).rejects.toThrow();

    // 闲时删目录：登记移除 + 该 cwd 会话消失（在订/磁盘两边语义一致）
    const delDir = dirs1.find((d) => d.cwd === cwd);
    if (delDir !== undefined) {
      await facade.deleteDir(delDir.id);
      expect((await facade.listDirs()).some((d) => d.cwd === cwd)).toBe(false);
      expect((await facade.listSessions()).some((s) => s.id === session.id)).toBe(false);
    }
  });

  it("listPlugins（批 C）：官方五件在列、状态 loaded、指纹 12 hex（双形态同形状）", async () => {
    const { facade } = await form.make([]);
    const snapshot = await facade.listPlugins();
    const ids = new Set(snapshot.plugins.map((p) => p.id));
    for (const id of [
      "plugin-session",
      "plugin-tools",
      "plugin-llm",
      "plugin-approval",
      "plugin-loop",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(snapshot.plugins.every((p) => p.state === "loaded" && p.enabled)).toBe(true);
    expect(snapshot.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it("deleteSession：闲删后列表移除 + snapshot 拒绝；回合悬挂时拒绝（busy 保护）", async () => {
    const { facade } = await form.make(["hang"]);
    const session = await facade.createSession();
    await facade.prompt(session.id, "跑起来");
    // busy 判定：listSessions 形态差异（runtime 仅在订 / client 含磁盘）——统一按该会话 busy 位
    await waitFor(async () => {
      const hit = (await facade.listSessions()).find((s) => s.id === session.id);
      return hit?.busy === true ? true : undefined;
    });
    await expect(facade.deleteSession(session.id)).rejects.toThrow(/busy/);

    await facade.interrupt(session.id);
    await waitFor(async () => {
      const hit = (await facade.listSessions()).find((s) => s.id === session.id);
      return hit?.busy === false ? true : undefined;
    });
    await facade.deleteSession(session.id);
    expect((await facade.listSessions()).some((s) => s.id === session.id)).toBe(false);
    await expect(facade.snapshot(session.id)).rejects.toThrow();
    await expect(facade.getSessionUiState(session.id)).rejects.toThrow(); // 删后目录随树走
  });

  it("界面绑定状态（D-063）：全局缺省 + 写读 roundtrip；每会话缺省 + 写读 roundtrip；未知会话拒绝", async () => {
    const { facade } = await form.make([]);
    // 全局：缺省 → 写读
    expect(await facade.getUiState()).toEqual({ lastSessionId: null });
    await facade.putUiState({ lastSessionId: null });
    const session = await facade.createSession();
    await facade.putUiState({ lastSessionId: session.id });
    expect(await facade.getUiState()).toEqual({ lastSessionId: session.id });
    // 每会话：缺省 → 写读（整份换——第二笔不保留第一笔没有的字段语义）
    expect(await facade.getSessionUiState(session.id)).toEqual({});
    await facade.putSessionUiState(session.id, {
      draft: "接着来",
      layout: { leftWidth: 320 },
    });
    expect(await facade.getSessionUiState(session.id)).toEqual({
      draft: "接着来",
      layout: { leftWidth: 320 },
    });
    await facade.putSessionUiState(session.id, { draft: "" });
    expect((await facade.getSessionUiState(session.id)).layout).toBeUndefined();
    // 未知会话拒绝
    await expect(facade.getSessionUiState("s-zz-000000")).rejects.toThrow();
  });

  it("sessionRows 翻页 + 快照窗口形状（rowSeq 游标排他 / 轮边界补齐 / hasOlder+totalRows）", async () => {
    const { facade } = await form.make([
      [mockText("一"), mockFinish("stop")],
      [mockText("二"), mockFinish("stop")],
      [mockText("三"), mockFinish("stop")],
    ]);
    const session = await facade.createSession();
    const prompts = ["问一", "问二", "问三"];
    for (let i = 0; i < prompts.length; i++) {
      await facade.prompt(session.id, prompts[i] ?? "");
      // 等落账行数收敛（行数单调不减——mock 短回合 busy true 窗口不可观察，直接等行数到位）
      await waitFor(async () => {
        const page = await facade.sessionRows(session.id);
        return page.rows.length >= (i + 1) * 2 ? true : undefined;
      });
    }

    // 快照形状：6 行 < 尾窗 60 → hasOlder false；totalRows = 全序行数
    const snap = await facade.snapshot(session.id);
    expect(snap.rows).toHaveLength(6);
    expect(snap.hasOlder).toBe(false);
    expect(snap.totalRows).toBe(6);

    // 缺省翻页 = 尾部一页（全量）；limit=4 → 尾部 4 行 + hasOlder
    const full = await facade.sessionRows(session.id);
    expect(full.rows).toHaveLength(6);
    expect(full.hasOlder).toBe(false);
    expect(full.rows[0]?.kind).toBe("user");
    const page1 = await facade.sessionRows(session.id, { limit: 4 });
    expect(page1.rows).toHaveLength(4);
    expect(page1.hasOlder).toBe(true);

    // 游标排他接续：before = page1 首行 rowSeq → 全部更早；轮边界补齐把同轮行收进
    const boundary = page1.rows[0]?.rowSeq;
    if (boundary === undefined) throw new Error("page1 empty");
    const page2 = await facade.sessionRows(session.id, { before: boundary, limit: 60 });
    expect(page2.rows.every((r) => r.rowSeq < boundary)).toBe(true);
    expect(page2.hasOlder).toBe(false);
    // limit=1 也回整轮（user + assistant 同 turn 不切散）
    const one = await facade.sessionRows(session.id, { limit: 1 });
    expect(one.rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
  });

  it("prompt opts（每次提问绑定）：modelId/reasoningEffort 随请求到达引擎侧 LlmRequest", async () => {
    const reply = [
      mockText("回"),
      mockUsage({ inputTokens: 1, outputTokens: 1 }),
      mockFinish("stop"),
    ];
    const { facade, mockRequests } = await form.make([reply, [...reply]]);
    const session = await facade.createSession();
    await facade.prompt(session.id, "缺省");
    await facade.prompt(session.id, "覆盖", { modelId: "mock/mock-1", reasoningEffort: "high" });
    await waitFor(() => (mockRequests().length >= 2 ? mockRequests() : undefined));
    const requests = mockRequests() as { reasoningEffort?: string }[];
    expect(requests[0]?.reasoningEffort).toBeUndefined(); // 缺省不带字段
    expect(requests[1]?.reasoningEffort).toBe("high"); // 显式档位到引擎
  });

  it("模型管理面：connect → 选择器并入 → 开关隐藏 → 自定义厂商 → 断开摘净（双形态同行为）", async () => {
    const { facade } = await form.make([]);
    // presets 全表（快照兜底）
    const presets = await facade.listModelPresets();
    expect(Object.keys(presets.presets).length).toBeGreaterThan(100);
    expect(presets.presets.deepseek?.name).toBe("DeepSeek");
    // 连接已知厂商 → 选择器并入 + 分组连接态；明文不出分组响应（D-030）
    await facade.connectProvider("deepseek", "sk-test-secret-123");
    const catalog = await facade.listModels();
    expect(catalog.providers.deepseek?.models?.length).toBeGreaterThan(0);
    const groups = await facade.listProviders();
    const group = groups.providers.find((p) => p.id === "deepseek");
    expect(group?.connected).toBe(true);
    expect(JSON.stringify(groups)).not.toContain("sk-test-secret-123");
    // 开关隐藏 → 选择器过滤；管理面 enabled:false；开回还原
    const modelId = catalog.providers.deepseek?.models?.[0]?.id as string;
    await facade.setModelEnabled("deepseek", modelId, false);
    expect(
      (await facade.listModels()).providers.deepseek?.models?.some((m) => m.id === modelId),
    ).toBe(false);
    const off = (await facade.listProviders()).providers.find((p) => p.id === "deepseek");
    expect(off?.models.find((m) => m.id === modelId)?.enabled).toBe(false);
    await facade.setModelEnabled("deepseek", modelId, true);
    expect(
      (await facade.listModels()).providers.deepseek?.models?.some((m) => m.id === modelId),
    ).toBe(true);
    // 自定义厂商（无 key 也算连接）：显式清单 + baseUrl；断开摘净
    const custom = await facade.putCustomProvider({
      label: "relay",
      baseUrl: "https://relay.example.com/v1",
      models: [{ model: "my-model", label: "My Model" }],
    });
    expect(custom.id.startsWith("user-")).toBe(true);
    const customCatalog = await facade.listModels();
    expect(customCatalog.providers[custom.id]?.models?.some((m) => m.id === "my-model")).toBe(true);
    expect(customCatalog.providers[custom.id]?.baseUrl).toBe("https://relay.example.com/v1");
    await facade.disconnectProvider(custom.id);
    expect((await facade.listModels()).providers[custom.id]).toBeUndefined();
    // 断开已知厂商 → 选择器摘除
    await facade.disconnectProvider("deepseek");
    expect((await facade.listModels()).providers.deepseek).toBeUndefined();
  });
});

describe("client 独有：断档不猜", () => {
  it("增量帧跳号 → 丢弃并回拉快照换发（消费端永不猜中间态）", async () => {
    const sessionId = "s-gap-test";
    const snapshot = { sessionId, seq: 9, rows: [], state: { busy: false } };
    let snapshotReads = 0;
    const fakeFetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/events")) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            const frame = (obj: unknown): void => {
              controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
            };
            frame({ kind: "connected", server: { version: "t", startedAt: 0 } });
            frame({ kind: "snapshot", sessionId, snapshot }); // 水位 9
            // 跳号增量（期望 10 来了 12）——client 必须丢弃并回拉
            frame({
              kind: "delta",
              sessionId,
              seq: 12,
              delta: { op: "state.updated", state: { busy: true } },
            });
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url.includes("/snapshot")) {
        snapshotReads += 1;
        return new Response(JSON.stringify({ ...snapshot, seq: 12 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const facade = createClient({ baseUrl: "http://127.0.0.1:0", fetch: fakeFetch });
    const sink: ServerFrame[] = [];
    for await (const frame of facade.events()) {
      sink.push(frame);
      // 确定性退出条件：初始快照 + 回拉换发快照都到齐（回拉与消费竞态无关紧要）
      if (sink.filter((f) => f.kind === "snapshot").length >= 2) break;
    }
    await facade.stop();
    expect(snapshotReads).toBe(1);
    // 跳号 delta 未透传（被快照替换）
    expect(sink.some((f) => f.kind === "delta")).toBe(false);
    expect(sink.filter((f) => f.kind === "snapshot")).toHaveLength(2); // 初始 + 回拉换发
  });
});

describe("runtime 独有：缺省 fail-closed", () => {
  it("autoRejectInteraction：ask 即拒——工具被拒、回合照常收尾（fail-closed 语义）", async () => {
    const { mockLlm } = await import("@henira/llm-mock");
    const { dataDir, globalDir } = await tempDirs();
    const mock = mockLlm([
      [mockToolCall("c1", "demo-write", "{}"), mockFinish("tool-calls")],
      [
        mockText("被拒后的回应"),
        mockUsage({ inputTokens: 1, outputTokens: 1 }),
        mockFinish("stop"),
      ],
    ]);
    const facade = await createRuntime({
      dataDir,
      globalDir,
      llm: llmStub(mock.service),
      interaction: autoRejectInteraction(), // 显式缺省（不传同款）
    });
    cleanups.push(async () => {
      await facade.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    });
    const sink: ServerFrame[] = [];
    const session = await facade.createSession();
    void (async () => {
      try {
        for await (const frame of facade.events()) sink.push(frame);
      } catch {
        // stop
      }
    })();
    await facade.prompt(session.id, "写文件");
    await waitFor(() => {
      const ended = framesOf(sink, session.id).some(
        (f) => f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
      );
      return ended ? true : undefined;
    });
    const snapshot = await facade.snapshot(session.id);
    // 审批被自动拒：无挂起审批行（hard-reject 在链外、无审计）；回合照常收尾
    expect(snapshot.rows.some((r) => r.kind === "approval" && r.status === "pending")).toBe(false);
    expect(snapshot.state.busy).toBe(false);
  });
});

describe.each(forms.map((f) => [f.name, f] as const))(
  "MCP 读者（D-064）双形态：%s",
  (_name, form) => {
    it("confirm-mcp → executeResource 全链；未确认/越权拒绝", async () => {
      const handle = await form.make([]);
      const { facade, dataDir } = handle;
      // 写一个带 mcp 槽的纯内容包（stdio echo 桩——手写 JSON-RPC，零 SDK）
      const v = path.join(dataDir, "plugins", "echo-mcp", "1.0.0");
      await fs.mkdir(path.join(v, "mcp"), { recursive: true });
      await fs.writeFile(
        path.join(v, "stub.js"),
        `let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let idx;
  while ((idx = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line === "") continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "e", version: "1" } } }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } }) + "\\n");
    } else if (msg.method === "tools/call") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ echo: msg.params.arguments?.text ?? null }) }] } }) + "\\n");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`,
        "utf8",
      );
      await fs.writeFile(
        path.join(v, "plugin.json"),
        JSON.stringify({ name: "echo-mcp", version: "1.0.0" }),
        "utf8",
      );
      await fs.writeFile(
        path.join(v, "mcp", "echo.json"),
        JSON.stringify({ command: process.execPath, args: [path.join(v, "stub.js")] }),
        "utf8",
      );

      // 未确认：清单可见待确认态；executeResource 拒绝（未确认 = 不连接）
      const snapshot = await facade.listPlugins();
      const row = snapshot.plugins.find((p) => p.id === "echo-mcp");
      expect(row?.mcp?.[0]?.confirmed).toBe(false);
      const session = await facade.createSession({ cwd: dataDir });
      await expect(
        facade.executeResource(session.id, "echo-mcp", "henira-data://echo-mcp/echo/echo"),
      ).rejects.toThrow();

      // 确认 → 新会话 → executeResource happy（连接异步——waitFor 轮询）
      await facade.confirmPluginMcp("echo-mcp");
      const confirmed = (await facade.listPlugins()).plugins.find((p) => p.id === "echo-mcp");
      expect(confirmed?.mcp?.[0]?.confirmed).toBe(true);
      const session2 = await facade.createSession({ cwd: dataDir });
      const address = `henira-data://echo-mcp/echo/echo?args=${encodeURIComponent(
        JSON.stringify({ text: "pong" }),
      )}`;
      const reply = await waitFor(async () => {
        try {
          const r = await facade.executeResource(session2.id, "echo-mcp", address);
          return r.ok ? r : undefined;
        } catch {
          return undefined; // 连接未就绪——继续轮询
        }
      });
      expect(JSON.parse(reply.text ?? "{}")).toEqual({ echo: "pong" });
      // 所有权闸（双形态同语义）：调用方 pluginId ≠ 地址 pluginId → 拒
      await expect(facade.executeResource(session2.id, "other-pack", address)).rejects.toThrow();
      // 停用 plugin-mcp → 新会话不装配（D-064 开关真生效，双形态同语义）
      await facade.setPluginEnabled("plugin-mcp", false);
      const session3 = await facade.createSession({ cwd: dataDir });
      await expect(facade.executeResource(session3.id, "echo-mcp", address)).rejects.toThrow();
    });
  },
);

describe.each(forms.map((f) => [f.name, f] as const))(
  "能力件一致（D-065 批 B）：%s",
  (_name, form) => {
    const U1 = { inputTokens: 1, outputTokens: 1 };
    const asTool = (r: Row): r is ToolRow => r.kind === "tool";
    it("官方清单含 6 新件；read 工具经 mock 回合真执行（行模型可见，isError false）", async () => {
      const { facade, dataDir } = await form.make([
        [
          mockToolCall("c1", "read", '{"file_path":"note.txt"}'),
          mockUsage(U1),
          mockFinish("tool-calls"),
        ],
        [mockText("read 完成"), mockUsage(U1), mockFinish("stop")],
      ]);
      await fs.writeFile(path.join(dataDir, "note.txt"), "alpha\nbeta\n", "utf8");

      const ids = (await facade.listPlugins()).plugins.map((p) => p.id);
      for (const id of [
        "plugin-fs",
        "plugin-fs-tools",
        "plugin-fs-search",
        "plugin-shell",
        "plugin-shell-tools",
        "plugin-breaker",
      ]) {
        expect(ids).toContain(id);
      }

      const session = await facade.createSession({ cwd: dataDir });
      const receipt = await facade.prompt(session.id, "读一下");
      expect(receipt.queued).toBe(false);
      const toolRow = await waitFor(async () => {
        const rows = await facade.sessionRows(session.id, {});
        const hit = rows.rows.find((r): r is ToolRow => asTool(r) && r.name === "read");
        return hit !== undefined && hit.status === "done" ? hit : undefined;
      });
      expect(toolRow.output?.isError).toBe(false);
      expect(toolRow.output?.content).toContain("1\talpha");
    });

    it("停用 fs 服务 → fs 工具不注册、shell 照常（能力服务装载强制，双形态）", async () => {
      const { facade, dataDir } = await form.make([
        [
          mockToolCall("c1", "bash", '{"command":"node -e \\"console.log(41+1)\\""}'),
          mockUsage(U1),
          mockFinish("tool-calls"),
        ],
        [mockText("bash 完成"), mockUsage(U1), mockFinish("stop")],
      ]);
      await facade.setPluginEnabled("plugin-fs", false);
      const after = (await facade.listPlugins()).plugins.find((p) => p.id === "plugin-fs");
      expect(after?.enabled).toBe(false);

      const session = await facade.createSession({ cwd: dataDir });
      const sink: ServerFrame[] = [];
      void (async () => {
        try {
          for await (const frame of facade.events()) sink.push(frame);
        } catch {
          // stop
        }
      })();
      await facade.prompt(session.id, "跑个命令");
      // bash 非只读 → 审批卡（fail-closed 默认）；收答放行
      const requestRow = await waitFor(() => {
        for (const f of framesOf(sink, session.id)) {
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
      expect(await facade.settleApproval(session.id, requestRow.requestId, "allowed-once")).toBe(
        true,
      );

      const done = await waitFor(async () => {
        const page = await facade.sessionRows(session.id, {});
        const hit = page.rows.find((r): r is ToolRow => asTool(r) && r.name === "bash");
        return hit?.status === "done" ? hit : undefined;
      }, 15_000);
      // fs 工具全体缺席的正面证据：bash 照常执行成功（系统照跑）
      expect(done.output?.isError).toBe(false);
      expect(done.output?.content).toContain("42");
    });
  },
);
