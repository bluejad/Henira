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
  ServerFrame,
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
  /** 宿主组合面：注册工具（审批测试需要非并发安全工具） */
  registerTool(sessionId: string): Promise<void>;
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
      const facade = await createRuntime({
        dataDir,
        globalDir,
        llm: llmStub(mockLlm(script).service),
        interaction: controlledInteraction(),
        tools: [DEMO_WRITE],
      });
      cleanups.push(async () => {
        await facade.stop();
        await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      });
      return { facade, registerTool: async () => {} }; // 工具已经 opts.tools 进每个新会话
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
        registerTool: async (sessionId) => {
          server.registry
            .get(sessionId)
            ?.ctx.get("tools")
            .register({ ...DEMO_WRITE });
        },
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
