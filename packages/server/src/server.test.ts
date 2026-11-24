// server e2e（真 HTTP + 真 SSE + mock LLM 全引擎装配）：判据①多客户端 / ②断线重连审批重放 /
// ⑤回环三件套，另锁 REST 面 / 设置与凭据 / 文件围栏 / 握手文件生命周期 / 中断冻结。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer as createHttpServer } from "node:http";
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
import { projectKey, SESSION_LOG_FILE } from "@henira/plugin-session";
import type {
  ConfigService,
  LlmService,
  ServerFrame,
  ToolContext,
  WorkspaceFileContent,
} from "@henira/protocol";
import { QUESTION_CUSTOM_MAX, WORKSPACE_FILE_MAX_BYTES } from "@henira/protocol";
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
  return sink.filter(
    (f) => (f.kind === "snapshot" || f.kind === "delta") && f.sessionId === sessionId,
  );
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

  it("R176：sessions.changed 只随列表事实变化发（建/删/目录），流式增量不发", async () => {
    const { base, cleanup } = await makeServer([[mockText("回复"), mockFinish("stop")]]);
    const sink: ServerFrame[] = [];
    const controller = new AbortController();
    try {
      subscribe(base, sink, controller.signal);
      await waitFor(() => (sink.some((f) => f.kind === "connected") ? true : undefined));
      // 建会话 → 列表事实变（快照之外另有全局信号）
      const id = await createSession(base);
      await waitFor(() => (sink.some((f) => f.kind === "sessions.changed") ? true : undefined));
      // 流式窗口清零：此后只该有增量帧，列表信号一帧都不许有
      sink.length = 0;
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "问一句" }),
      });
      await waitFor(() => {
        const ended = framesFor(sink, id).some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
        );
        return ended ? true : undefined;
      });
      expect(sink.some((f) => f.kind === "sessions.changed")).toBe(false);
      // 删会话 → 信号
      sink.length = 0;
      const del = await fetch(`${base}/api/sessions/${id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      await waitFor(() => (sink.some((f) => f.kind === "sessions.changed") ? true : undefined));
      // 目录登记增 → 信号
      sink.length = 0;
      const cwd = await fs.mkdtemp(path.join(root, "r176-dir-"));
      const addRes = await fetch(`${base}/api/dirs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      expect(addRes.status).toBe(200);
      await waitFor(() => (sink.some((f) => f.kind === "sessions.changed") ? true : undefined));
    } finally {
      controller.abort();
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

  it("提问全链（R184）：挂起行重放 → REST 答题 → 工具结果带 meta；取消 → 错误结果；400/404 分型", async () => {
    const first = JSON.stringify({
      questions: [
        {
          id: "q1",
          question: "选哪个？",
          header: "选择",
          options: [{ label: "甲", description: "快" }, { label: "乙" }],
        },
      ],
    });
    const second = JSON.stringify({
      questions: [{ id: "q2", question: "继续吗？", options: [{ label: "是" }, { label: "否" }] }],
    });
    const { base, cleanup } = await makeServer([
      [mockToolCall("q1", "ask_user", first), mockFinish("tool-calls")],
      [mockText("收到甲"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
      [mockToolCall("q2", "ask_user", second), mockFinish("tool-calls")],
      [mockText("已取消"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const sink: ServerFrame[] = [];
    try {
      const id = await createSession(base);
      subscribe(base, sink);
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "问我问题" }),
      });
      const pending = await waitFor(() => {
        for (const f of framesFor(sink, id)) {
          if (
            f.kind === "delta" &&
            f.delta.op === "row.appended" &&
            f.delta.row.kind === "question"
          ) {
            return f.delta.row;
          }
        }
        return undefined;
      });
      expect(pending).toMatchObject({ status: "pending" });
      expect(pending.questions[0]).toMatchObject({ id: "q1", header: "选择" });

      // 断线重连快照即携带挂起提问行（自足可渲染）
      const snap1 = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
        rows: { kind: string; status?: string }[];
      };
      expect(snap1.rows.some((r) => r.kind === "question" && r.status === "pending")).toBe(true);

      // body 形状不合规 → 400
      expect(
        (
          await fetch(`${base}/api/sessions/${id}/questions/${pending.requestId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          })
        ).status,
      ).toBe(400);

      // 自定义答案超上限 → 400（R186：UI/REST/引擎/账本同源上限，不进账本）
      expect(
        (
          await fetch(`${base}/api/sessions/${id}/questions/${pending.requestId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              answers: [{ id: "q1", selected: [], custom: "甲".repeat(QUESTION_CUSTOM_MAX + 1) }],
            }),
          })
        ).status,
      ).toBe(400);

      // 答题 → 回合继续
      const answered = await fetch(`${base}/api/sessions/${id}/questions/${pending.requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: [{ id: "q1", selected: ["甲"] }] }),
      });
      expect(((await answered.json()) as { applied: boolean }).applied).toBe(true);
      // 幂等：第二次答案不炸（applied=false）
      const again = await fetch(`${base}/api/sessions/${id}/questions/${pending.requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancelled: true }),
      });
      expect(again.status).toBe(200);
      expect(((await again.json()) as { applied: boolean }).applied).toBe(false);

      // 第一回合收尾（下一 script 段归第二次 prompt）
      await waitFor(() =>
        framesFor(sink, id).some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
        )
          ? true
          : undefined,
      );
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "再问一次" }),
      });

      // 第二次提问 → 取消收口
      const pending2 = await waitFor(() => {
        for (const f of framesFor(sink, id)) {
          if (
            f.kind === "delta" &&
            f.delta.op === "row.appended" &&
            f.delta.row.kind === "question" &&
            f.delta.row.requestId !== pending.requestId
          ) {
            return f.delta.row;
          }
        }
        return undefined;
      });
      const cancelled = await fetch(`${base}/api/sessions/${id}/questions/${pending2.requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancelled: true }),
      });
      expect(((await cancelled.json()) as { applied: boolean }).applied).toBe(true);

      // 未知 requestId → 404（不假成功）
      expect(
        (
          await fetch(`${base}/api/sessions/${id}/questions/not-exist`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cancelled: true }),
          })
        ).status,
      ).toBe(404);

      await waitFor(() => {
        const frames = framesFor(sink, id);
        const settled = frames.filter(
          (f) =>
            f.kind === "delta" &&
            f.delta.op === "row.upserted" &&
            f.delta.row.kind === "question" &&
            f.delta.row.status === "settled",
        );
        return settled.length === 2 ? true : undefined;
      });

      // 等两个工具结果落账再拍快照：插件先 append question/settled 再返回工具结果（tool/result
      // 更晚），只等两个 settled 行时快照可能只见第二次 tool/call 行——CI 慢机实锤 flake（R185 审查）
      const snap = await waitFor(async () => {
        const body = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
          rows: {
            kind: string;
            status?: string;
            outcome?: string;
            answers?: unknown;
            name?: string;
            output?: { isError: boolean; meta?: Record<string, unknown> };
          }[];
        };
        const toolRows = body.rows.filter((r) => r.kind === "tool" && r.name === "ask_user");
        return toolRows.length === 2 && toolRows.every((r) => r.output !== undefined)
          ? body
          : undefined;
      });
      const questions = snap.rows.filter((r) => r.kind === "question");
      expect(questions).toHaveLength(2);
      expect(questions[0]).toMatchObject({
        status: "settled",
        outcome: "answered",
        answers: [{ id: "q1", selected: ["甲"] }],
      });
      expect(questions[1]).toMatchObject({ status: "settled", outcome: "cancelled" });
      const toolRows = snap.rows.filter((r) => r.kind === "tool" && r.name === "ask_user");
      expect(toolRows).toHaveLength(2);
      expect(toolRows[0]?.output?.isError).toBe(false);
      expect(toolRows[0]?.output?.meta).toMatchObject({ kind: "ask_user" });
      expect(toolRows[1]?.output?.isError).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("判据②续（E6）：pending 行带 args 全文；settle scope:'session' → 同工具第二次免审批", async () => {
    const { server, base, cleanup } = await makeServer([
      [
        mockToolCall("c1", "demo-edit", '{"file_path":"a.txt","old_string":"x","new_string":"y"}'),
        mockFinish("tool-calls"),
      ],
      [mockText("第一次完成"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
      [
        mockToolCall("c2", "demo-edit", '{"file_path":"b.txt","old_string":"p","new_string":"q"}'),
        mockFinish("tool-calls"),
      ],
      [mockText("第二次完成"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const sink: ServerFrame[] = [];
    const settle = async (sessionId: string, requestId: string, body: object): Promise<boolean> =>
      (
        (await (
          await fetch(`${base}/api/sessions/${sessionId}/approvals/${requestId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).json()) as { applied: boolean }
      ).applied;
    try {
      const id = await createSession(base);
      server.registry
        .get(id)
        ?.ctx.get("tools")
        .register({
          name: "demo-edit",
          description: "demo edit tool (requires approval)",
          inputSchema: { type: "object", properties: {} },
          execute: async () => ({ content: "edited" }),
        });
      subscribe(base, sink); // 先订后发（审查 F12）：asked 抢在连接完成前也走快照帧外的 delta
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "改文件" }),
      });
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
      // args 全文进行模型（D-046「挂起自足可渲染」——diff 预览数据源）
      expect(pendingRow).toMatchObject({
        status: "pending",
        toolName: "demo-edit",
        args: { file_path: "a.txt", old_string: "x", new_string: "y" },
      });

      // 本会话允许（scope:'session'）+ 忙时发 prompt2（D-045 队列：回合 1 落定后自动续跑）
      expect(
        await settle(id, pendingRow.requestId, { decision: "allowed-once", scope: "session" }),
      ).toBe(true);
      const prompt2Res = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "再改一次" }),
      });
      expect(((await prompt2Res.json()) as { queued: boolean }).queued).toBe(true);

      // 第二次同工具：折叠命中免审批——不产生新审批行，工具直接执行
      await waitFor(() => {
        const done = framesFor(sink, id).filter(
          (f) =>
            f.kind === "delta" &&
            f.delta.op === "row.upserted" &&
            f.delta.row.kind === "tool" &&
            f.delta.row.status === "done",
        ).length;
        return done >= 2 ? true : undefined;
      }, 15000);
      const snap = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
        rows: { kind: string; status?: string; decision?: string; scope?: string }[];
      };
      expect(snap.rows.filter((r) => r.kind === "approval")).toHaveLength(1); // 无第二次审批
      expect(snap.rows.filter((r) => r.kind === "tool" && r.status === "done")).toHaveLength(2);
      const settledRow = snap.rows.find((r) => r.kind === "approval");
      expect(settledRow).toMatchObject({ decision: "allowed-once", scope: "session" });
    } finally {
      await cleanup();
    }
  });
});

describe("排队卡全链（E1：queue 上投影态）", () => {
  it("忙时 prompt 入队 → SSE state.updated 携带 queue（键级整体替换语义锁）→ snapshot 带队列 → steer 直插入队 → DELETE 摘除（不存在 404）→ 冲刷清空", async () => {
    // 首回合挂住到断言完再放行（确定性：固定 150ms 在慢机上可能先冲刷完 → snapshot 队列已空，
    // CI 实锤过一次；队列语义断言必须在回合未结束时做）
    let releaseSlow: () => void = () => {};
    const slowHeld = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const slow = async function* () {
      await slowHeld;
      yield mockText("慢回合");
      yield mockUsage({ inputTokens: 1, outputTokens: 1 });
      yield mockFinish("stop");
    };
    const { base, cleanup } = await makeServer([
      slow,
      [mockText("冲刷回合"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
      [mockText("冲刷二"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const sink: ServerFrame[] = [];
    try {
      const id = await createSession(base);
      subscribe(base, sink);
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "第一问" }),
      });
      // 等 busy=true（回合开跑）再忙时投递——确定性信号非 sleep
      await waitFor(() => {
        const frames = framesFor(sink, id);
        return frames.some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === true,
        )
          ? true
          : undefined;
      });
      const res = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "排队的话" }),
      });
      const receipt = (await res.json()) as { queued: boolean; id: string | null };
      expect(receipt.queued).toBe(true);
      expect(receipt.id).not.toBeNull();
      const entryId = receipt.id as string;
      // 语义锁：state.updated 载荷携带 queue（否则键级整体替换会在 busy 翻转时抹掉客户端队列）
      await waitFor(() => {
        const frames = framesFor(sink, id);
        return frames.some(
          (f) =>
            f.kind === "delta" &&
            f.delta.op === "state.updated" &&
            Array.isArray(f.delta.state.queue) &&
            f.delta.state.queue.some((e) => e.id === entryId),
        )
          ? true
          : undefined;
      });
      // 快照携带队列
      const snapJson = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
        state: { queue?: { id: string; steer: boolean }[] };
      };
      expect(snapJson.state.queue?.some((e) => e.id === entryId)).toBe(true);
      // steer:true 直插入队（REST 通道透传——引擎 send({steer}) 底座的传输面半边）
      const resSteer = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "直插的话", steer: true }),
      });
      const receiptSteer = (await resSteer.json()) as { queued: boolean; id: string | null };
      expect(receiptSteer.queued).toBe(true);
      const snapSteer = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
        state: { queue?: { id: string; steer: boolean }[] };
      };
      const steerEntry = snapSteer.state.queue?.find((e) => e.id === receiptSteer.id);
      expect(steerEntry?.steer).toBe(true);
      // DELETE 摘除；不存在 404
      expect(
        (await fetch(`${base}/api/sessions/${id}/queue/${entryId}`, { method: "DELETE" })).status,
      ).toBe(200);
      expect(
        (await fetch(`${base}/api/sessions/${id}/queue/q-none`, { method: "DELETE" })).status,
      ).toBe(404);
      releaseSlow(); // 首回合放行 → 队列逐条冲刷
      // 冲刷收尾：队列条目跑完后最终 state busy=false 且 queue 空
      await waitFor(() => {
        const states = framesFor(sink, id).flatMap((f) =>
          f.kind === "delta" && f.delta.op === "state.updated" ? [f.delta.state] : [],
        );
        const last = states.at(-1);
        return last !== undefined && last.busy === false && (last.queue ?? []).length === 0
          ? true
          : undefined;
      });
    } finally {
      await cleanup();
    }
  });
});

describe("中断×队列全链（冻结横幅 + resume 恢复）", () => {
  it("忙时入队 → interrupt → state.updated 携 queuePaused:true 且条目留守（不生而为 abort）→ POST queue/resume → 条目正常回复落账", async () => {
    const { base, cleanup } = await makeServer([
      "hang", // 首回合挂住 → interrupt
      [
        mockText("冻结条目回复"),
        mockUsage({ inputTokens: 1, outputTokens: 1 }),
        mockFinish("stop"),
      ],
    ]);
    const sink: ServerFrame[] = [];
    try {
      const id = await createSession(base);
      subscribe(base, sink);
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "第一问" }),
      });
      await waitFor(() => {
        const frames = framesFor(sink, id);
        return frames.some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === true,
        )
          ? true
          : undefined;
      });
      const res = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "冻结的话" }),
      });
      const receipt = (await res.json()) as { queued: boolean; id: string | null };
      expect(receipt.queued).toBe(true);
      await fetch(`${base}/api/sessions/${id}/interrupt`, { method: "POST" });
      // 语义锁：中断后 state.updated 携 queuePaused:true 且队列留守（冻结态推到客户端）
      await waitFor(() => {
        const frames = framesFor(sink, id);
        return frames.some(
          (f) =>
            f.kind === "delta" &&
            f.delta.op === "state.updated" &&
            f.delta.state.busy === false &&
            f.delta.state.queuePaused === true &&
            Array.isArray(f.delta.state.queue) &&
            f.delta.state.queue.some((e) => e.id === receipt.id),
        )
          ? true
          : undefined;
      });
      // 冻结期间账本无孤儿 user 行（对照修复前：条目生而为 abort 落账零回复）
      const frozenSnap = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
        rows: { kind: string; text?: string }[];
      };
      expect(frozenSnap.rows.some((r) => r.kind === "user" && r.text === "冻结的话")).toBe(false);
      // resume：等回复行落账（resume 的 drainNext 广播先于新回合 turn/start——
      // 等「队列空+busy=false」会被中间态提前放行，必须等回复行这个确定性信号）
      const resumeRes = await fetch(`${base}/api/sessions/${id}/queue/resume`, {
        method: "POST",
      });
      expect(((await resumeRes.json()) as { ok: boolean }).ok).toBe(true);
      await waitFor(() => {
        const frames = framesFor(sink, id);
        return frames.some(
          (f) =>
            f.kind === "delta" &&
            f.delta.op === "row.appended" &&
            f.delta.row.kind === "assistant" &&
            f.delta.row.text === "冻结条目回复",
        )
          ? true
          : undefined;
      });
    } finally {
      await cleanup();
    }
  });
});

describe("立即发送抢占全链（promote）", () => {
  it("忙时排两条 → promote 第二条 → 当前回合中断 + 该条先回复 + 首条留守自动续冲 + 全程无冻结横幅", async () => {
    // 半截文本后挂起（被 promote 打断——中断徽章要真实存在，纯 hang 无流式行可标）
    const partialThenHang = ((_req: unknown, signal: AbortSignal) =>
      (async function* () {
        yield mockText("half written...");
        await new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("hung until aborted")), {
            once: true,
          });
        });
      })()) as MockEntry;
    const { base, cleanup } = await makeServer([
      partialThenHang,
      [mockText("被提升回复"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
      [mockText("留守回复"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const sink: ServerFrame[] = [];
    try {
      const id = await createSession(base);
      subscribe(base, sink);
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "第一问" }),
      });
      await waitFor(() => {
        const frames = framesFor(sink, id);
        return frames.some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === true,
        )
          ? true
          : undefined;
      });
      const r1 = (await (
        await fetch(`${base}/api/sessions/${id}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "留守条目" }),
        })
      ).json()) as { id: string | null };
      const r2 = (await (
        await fetch(`${base}/api/sessions/${id}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "被提升条目" }),
        })
      ).json()) as { id: string | null };
      expect(r1.id).not.toBeNull();
      expect(r2.id).not.toBeNull();
      // promote 排队中间的第二条
      const res = await fetch(`${base}/api/sessions/${id}/queue/${r2.id}/promote`, {
        method: "POST",
      });
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
      // 不存在条目 404
      expect(
        (await fetch(`${base}/api/sessions/${id}/queue/q-none/promote`, { method: "POST" })).status,
      ).toBe(404);
      // 被抢占回合中断标 + 被提升回复先落 + 留守回复续冲（完成判据 = 三者都在场）
      await waitFor(() => {
        const frames = framesFor(sink, id);
        const assistantRows = frames.flatMap((f) =>
          f.kind === "delta" && (f.delta.op === "row.appended" || f.delta.op === "row.upserted")
            ? [f.delta.row]
            : [],
        );
        const hasInterrupted = assistantRows.some(
          (r) => r.kind === "assistant" && r.interrupted === true,
        );
        const hasPromoted = assistantRows.some(
          (r) => r.kind === "assistant" && r.text === "被提升回复",
        );
        const hasKept = assistantRows.some((r) => r.kind === "assistant" && r.text === "留守回复");
        const busyFalse = framesFor(sink, id).some(
          (f) =>
            f.kind === "delta" && f.delta.op === "state.updated" && f.delta.state.busy === false,
        );
        return hasInterrupted && hasPromoted && hasKept && busyFalse ? true : undefined;
      });
      // 全程无冻结横幅：queuePaused 从未推 true（抢占瞬态不出去——发布在 clearPause 之后）
      const pausedFrames = framesFor(sink, id).filter(
        (f) =>
          f.kind === "delta" &&
          f.delta.op === "state.updated" &&
          f.delta.state.queuePaused === true,
      );
      expect(pausedFrames).toHaveLength(0);
      // 收口判据用轮询：抢占后「留守续冲」回合可能在上一条 busy=false 之后立刻接棒——
      // 单次快照会撞回合间隙（CI 慢机实锤，E1 同族）；等到真正 idle + 队列空再断言行序
      const snap = await waitFor(async () => {
        const res = await fetch(`${base}/api/sessions/${id}/snapshot`);
        const body = (await res.json()) as {
          state: { queue?: unknown[]; busy: boolean };
          rows: { kind: string; text?: string }[];
        };
        return body.state.busy === false && (body.state.queue ?? []).length === 0
          ? body
          : undefined;
      });
      // user 行次序：第一问 → 被提升条目 → 留守条目（插队实锤）
      const userTexts = snap.rows.filter((r) => r.kind === "user").map((r) => r.text);
      expect(userTexts).toEqual(["第一问", "被提升条目", "留守条目"]);
    } finally {
      await cleanup();
    }
  });
});

describe("轮尾分叉全链（E4：fork REST + 子会话装配）", () => {
  it("POST /fork 缺省复制到最新 → 子会话在册且行 = 前缀；atSeq 越界 400；不存在 404", async () => {
    const { base, cleanup } = await makeServer([[mockText("答"), mockFinish("stop")]]);
    try {
      const id = await createSession(base);
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "问" }),
      });
      await waitFor(async () => {
        const snap = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
          state: { busy: boolean };
          rows: { kind: string }[];
        };
        return !snap.state.busy && snap.rows.length >= 2 ? true : undefined;
      });

      const res = await fetch(`${base}/api/sessions/${id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const forked = (await res.json()) as { ok: boolean; id: string };
      expect(forked.ok).toBe(true);
      expect(forked.id).not.toBe(id);

      // 子会话在册（listSessions 含 child）且行 = 前缀（user + assistant）
      const list = (await (await fetch(`${base}/api/sessions`)).json()) as { id: string }[];
      expect(list.some((s) => s.id === forked.id)).toBe(true);
      const childRows = (await (await fetch(`${base}/api/sessions/${forked.id}/rows`)).json()) as {
        rows: { kind: string; text?: string }[];
      };
      expect(childRows.rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
      expect(childRows.rows[0]?.text).toBe("问");

      // 越界切点 400（ForkCutOutOfRangeError 形状化）
      const bad = await fetch(`${base}/api/sessions/${id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ atSeq: 99999 }),
      });
      expect(bad.status).toBe(400);

      // 不存在会话 404
      const missing = await fetch(`${base}/api/sessions/s-nope/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(missing.status).toBe(404);
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
        body: JSON.stringify({
          model: "mock/mock-1",
          permissionMode: "full",
          ui: { theme: "dark", preview: { file: "modal" } },
        }),
      });
      expect(put.status).toBe(200);
      const settings = (await (await fetch(`${base}/api/settings`)).json()) as {
        model?: string;
        permissionMode?: string;
        ui?: { theme?: string; preview?: { file?: string; image?: string } };
      };
      expect(settings.model).toBe("mock/mock-1");
      expect(settings.permissionMode).toBe("full");
      expect(settings.ui?.theme).toBe("dark");
      expect(settings.ui?.preview?.file).toBe("modal");

      // 非法权限模式值 400（fail-closed：词表外不入盘，D-080）
      const badMode = await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissionMode: "yolo" }),
      });
      expect(badMode.status).toBe(400);

      // 预览设置深合并：只改 image 不丢 file（R188）
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ui: { preview: { image: "panel" } } }),
      });
      const merged = (await (await fetch(`${base}/api/settings`)).json()) as {
        ui?: { preview?: { file?: string; image?: string } };
      };
      expect(merged.ui?.preview).toEqual({ file: "modal", image: "panel" });

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

  it("prompt 权限模式透传（D-080）：full 落 turn/start 账本；非法值 400", async () => {
    const { base, cleanup, dataDir } = await makeServer([
      [mockText("好"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    const cwd = path.join(root, "perm-cwd");
    await fs.mkdir(cwd, { recursive: true });
    try {
      const id = await createSession(base, cwd);
      const res = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "放开做", permissionMode: "full" }),
      });
      expect(res.status).toBe(200);
      // 回合落定后读账本（turn/start 不投影为行——直接读 session.v1.jsonl）
      const ledgerPath = path.join(
        dataDir,
        "projects",
        projectKey(cwd),
        "sessions",
        id,
        SESSION_LOG_FILE,
      );
      await waitFor(async () => {
        try {
          const raw = await fs.readFile(ledgerPath, "utf8");
          return raw.includes('"turn/start"') ? true : undefined;
        } catch {
          return undefined;
        }
      });
      const events = (await fs.readFile(ledgerPath, "utf8"))
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l) as { type: string; data: { permissionMode?: string } });
      const start = events.find((e) => e.type === "turn/start");
      expect(start?.data.permissionMode).toBe("full");
      // 非法值 400（词表外不入引擎，D-080 fail-closed）
      const bad = await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "x", permissionMode: "yolo" }),
      });
      expect(bad.status).toBe(400);
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("会话列表 updatedAt = 账本 mtime（R189：新活动回顶，非目录 mtime）", async () => {
    const { base, cleanup, dataDir } = await makeServer([]);
    try {
      const a = await createSession(base, dataDir);
      const b = await createSession(base, dataDir);
      const list = async (): Promise<Array<{ id: string; updatedAt: number }>> =>
        (await (await fetch(`${base}/api/sessions`)).json()) as Array<{
          id: string;
          updatedAt: number;
        }>;
      // b 建得晚 → 初次列表 b 在前
      const first = await list();
      expect(first[0]?.id).toBe(b);

      // a 的账本追加活动（mtime 推后；目录 mtime 不随文件追加变化）→ a 回顶
      const logA = path.join(
        dataDir,
        "projects",
        projectKey(dataDir),
        "sessions",
        a,
        SESSION_LOG_FILE,
      );
      const future = new Date(Date.now() + 60_000);
      await fs.utimes(logA, future, future);
      const second = await list();
      expect(second[0]?.id).toBe(a);
      expect(second[0]?.updatedAt).toBeGreaterThan(first[0]?.updatedAt ?? 0);
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

  it("工作区文件读取（R190）：文本/绝对路径/二进制/截断 + 404/400 矩阵", async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-file-cwd-"));
    const note = "alpha\nbeta\n";
    await fs.writeFile(path.join(cwd, "note.txt"), note, "utf8");
    await fs.writeFile(path.join(cwd, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    await fs.writeFile(path.join(cwd, "big.txt"), "a".repeat(WORKSPACE_FILE_MAX_BYTES + 16));
    await fs.writeFile(path.join(cwd, "exact.txt"), "b".repeat(WORKSPACE_FILE_MAX_BYTES));
    await fs.writeFile(path.join(cwd, "big.bin"), Buffer.alloc(WORKSPACE_FILE_MAX_BYTES + 1));
    await fs.mkdir(path.join(cwd, "sub"));
    await fs.writeFile(path.join(cwd, "sub", "deep.txt"), "deep body", "utf8");
    const { base, cleanup } = await makeServer([]);
    try {
      const id = await createSession(base, cwd);
      const read = (p: string): Promise<Response> =>
        fetch(`${base}/api/sessions/${id}/file?path=${encodeURIComponent(p)}`);
      const text = (await (await read("note.txt")).json()) as WorkspaceFileContent;
      expect(text).toEqual({
        path: path.join(cwd, "note.txt"),
        encoding: "utf8",
        content: note,
        size: Buffer.byteLength(note),
      });
      // 绝对路径（cwd 内）同样可读
      const absolute = (await (
        await read(path.join(cwd, "note.txt"))
      ).json()) as WorkspaceFileContent;
      expect(absolute.content).toBe(note);
      // 二进制 → base64 完整字节
      const bin = (await (await read("blob.bin")).json()) as WorkspaceFileContent;
      expect(bin.encoding).toBe("base64");
      expect([...Buffer.from(bin.content, "base64")]).toEqual([0, 1, 2, 3]);
      // 文本超限：只读前缀（R191）+ 截断 + 总大小如实
      const big = (await (await read("big.txt")).json()) as WorkspaceFileContent;
      expect(big.truncated).toBe(true);
      expect(big.content.length).toBe(WORKSPACE_FILE_MAX_BYTES);
      expect(big.size).toBe(WORKSPACE_FILE_MAX_BYTES + 16);
      // 恰为上限：不标 truncated（边界不误伤）
      const exact = (await (await read("exact.txt")).json()) as WorkspaceFileContent;
      expect(exact.truncated).toBeUndefined();
      expect(exact.content.length).toBe(WORKSPACE_FILE_MAX_BYTES);
      // 相对归一：sub/../ 合法落在围栏内
      expect(((await (await read("sub/../note.txt")).json()) as WorkspaceFileContent).content).toBe(
        note,
      );
      expect(
        ((await (await read("sub/../sub/deep.txt")).json()) as WorkspaceFileContent).content,
      ).toBe("deep body");
      // 二进制超限：残缺字节不可用 → 400
      expect((await read("big.bin")).status).toBe(400);
      expect((await (await read("big.bin")).json()) as { error: string }).toMatchObject({
        error: "file too large to preview",
      });
      // 越界 / 目录 / 不存在 / 缺 path / 未知会话
      expect((await read("../../escape.txt")).status).toBe(400);
      expect((await read("sub")).status).toBe(400);
      expect((await read("nope.txt")).status).toBe(404);
      expect((await fetch(`${base}/api/sessions/${id}/file`)).status).toBe(400);
      expect((await fetch(`${base}/api/sessions/nope/file?path=note.txt`)).status).toBe(404);
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("工作区文件读取：历史会话从账本首行 header 取 cwd（不需挂载）", async () => {
    const dataDir = path.join(root, `file-hist-${Math.random().toString(36).slice(2, 8)}`);
    const globalDir = path.join(dataDir, "config");
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(
      path.join(globalDir, "settings.json"),
      JSON.stringify({ version: 1, model: "mock/mock-1" }),
      "utf8",
    );
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-file-hist-"));
    await fs.writeFile(path.join(cwd, "old.txt"), "historical body", "utf8");
    const sid = "s-hist0000-abc123";
    const ledgerDir = path.join(dataDir, "projects", "--hist-test--", "sessions", sid);
    await fs.mkdir(ledgerDir, { recursive: true });
    await fs.writeFile(
      path.join(ledgerDir, SESSION_LOG_FILE),
      `${JSON.stringify({ version: 1, id: sid, createdAt: 1, cwd })}\n`,
      "utf8",
    );
    // R191：header.cwd 形状非法（空串）→ 404，不得把围栏根错设成 server 进程 cwd
    const badSid = "s-hist0000-bad999";
    const badDir = path.join(dataDir, "projects", "--hist-test--", "sessions", badSid);
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(
      path.join(badDir, SESSION_LOG_FILE),
      `${JSON.stringify({ version: 1, id: badSid, createdAt: 1, cwd: "" })}\n`,
      "utf8",
    );
    const server = await createServer({
      dataDir,
      globalDir,
      llm: llmStub(mockLlm([]).service),
    });
    try {
      const res = await fetch(`${server.url}/api/sessions/${sid}/file?path=old.txt`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as WorkspaceFileContent).content).toBe("historical body");
      expect((await fetch(`${server.url}/api/sessions/${badSid}/file?path=old.txt`)).status).toBe(
        404,
      );
    } finally {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("工作区文件读取：符号链接逃逸被 realpath 复核拦下（平台无 symlink 权限则跳过）", async () => {
    const cwd = await fs.mkdtemp(path.join(tmpdir(), "henira-file-link-"));
    const outside = await fs.mkdtemp(path.join(tmpdir(), "henira-file-outside-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    const made = await fs
      .symlink(path.join(outside, "secret.txt"), path.join(cwd, "link.txt"), "file")
      .then(() => true)
      .catch(() => false);
    const { base, cleanup } = await makeServer([]);
    try {
      const id = await createSession(base, cwd);
      if (!made) return; // Windows 未开开发者模式：跳过（CI Linux 覆盖）
      const res = await fetch(`${base}/api/sessions/${id}/file?path=link.txt`);
      expect(res.status).toBe(400);
      expect((await res.json()) as { error: string }).toMatchObject({
        error: "path escapes session workspace",
      });
    } finally {
      await cleanup();
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
      await fs.rm(outside, { recursive: true, force: true }).catch(() => {});
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
        plugins: { id: string; state: string; forms: string[]; source?: string }[];
        fingerprint: string;
      };
      const pending = before.plugins.find((p) => p.id === "probe-pack");
      expect(pending?.state).toBe("awaiting-confirm");
      expect(pending?.source).toBe("managed"); // 目录件来源（R189）
      expect(pending?.forms).toContain("engine");
      // 官方件在列（source official 由 UI 侧区分；状态 loaded）——含外圈 fs（R189）
      expect(before.plugins.some((p) => p.id === "plugin-loop" && p.state === "loaded")).toBe(true);
      expect(before.plugins.some((p) => p.id === "plugin-fs" && p.source === "official")).toBe(
        true,
      );
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

describe("MCP 读者（D-064：确认门 / stdio 全链 / useResource / 凭据注入）", () => {
  /** MCP stdio 桩（手写 JSON-RPC，零 SDK——initialize / tools/list / tools/call echo + showenv） */
  const MCP_STUB = `let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let idx;
  while ((idx = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line === "") continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      reply(msg, { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "echo-server", version: "1.0.0" } });
    } else if (msg.method === "tools/list") {
      reply(msg, { tools: [
        { name: "echo", description: "echo back", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
        { name: "showenv", description: "show MY_SECRET", inputSchema: { type: "object", properties: {} } },
      ] });
    } else if (msg.method === "tools/call") {
      const args = msg.params.arguments ?? {};
      const text = msg.params.name === "showenv" ? JSON.stringify({ secret: process.env.MY_SECRET ?? null }) : JSON.stringify({ echo: args.text ?? null });
      reply(msg, { content: [{ type: "text", text }], isError: false });
    } else if (msg.method !== "notifications/initialized") {
      reply(msg, {}, true);
    }
  }
});
function reply(msg, result, isErr) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, [isErr ? "error" : "result"]: isErr ? { code: -32601, message: "method not found" } : result }) + "\\n");
}
process.stdin.on("end", () => {
  if (process.env.MCP_EXIT_MARKER) {
    try { require("node:fs").writeFileSync(process.env.MCP_EXIT_MARKER, "exited"); } catch {}
  }
  process.exit(0);
});
`;

  /** 写一个带 mcp 槽的纯内容包（echo stdio server + 凭据 server） */
  async function writeMcpPack(dataDir: string, withCredentialRef: boolean): Promise<string> {
    const v = path.join(dataDir, "plugins", "echo-mcp", "1.0.0");
    await fs.mkdir(path.join(v, "mcp"), { recursive: true });
    await fs.writeFile(path.join(v, "stub.js"), MCP_STUB, "utf8");
    await fs.writeFile(
      path.join(v, "plugin.json"),
      JSON.stringify({ name: "echo-mcp", version: "1.0.0" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(v, "mcp", "echo.json"),
      JSON.stringify({
        command: process.execPath,
        args: [path.join(v, "stub.js")],
        // 子进程退出探针（会话删除用例：stop 必须等到子进程真退出）
        env: { MCP_EXIT_MARKER: path.join(v, "mcp-exited.txt") },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(v, "mcp", "cred.json"),
      JSON.stringify({
        command: process.execPath,
        args: [path.join(v, "stub.js")],
        env: withCredentialRef
          ? // biome-ignore lint/suspicious/noTemplateCurlyInString: 凭据引用语法本身即此字面量
            { MY_SECRET: "${credential:test-token}" }
          : { MY_SECRET: "literal-value" },
      }),
      "utf8",
    );
    return v;
  }

  /** 轮询直至条件成立（连接/注册是异步的——装配不等 server，D-064） */
  async function until(label: string, probe: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!probe()) {
      if (Date.now() > deadline) throw new Error(`timeout waiting for: ${label}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** 最小 ToolContext（tools.execute 直呼用） */
  function toolCtxOf(entry: { ctx: { get(name: string): unknown } }, dataDir: string): unknown {
    return {
      cwd: dataDir,
      signal: new AbortController().signal,
      requestPermission: async () => "allowed-once",
      config: entry.ctx.get("config"),
    };
  }

  it("确认门 fail-closed：未确认不 spawn；confirm-mcp 后新会话工具进注册表并经 tools.execute 触达", {
    timeout: 20_000,
  }, async () => {
    const { server, base, dataDir, cleanup } = await makeServer([]);
    try {
      await writeMcpPack(dataDir, false);
      const before = (await (await fetch(`${base}/api/plugins`)).json()) as {
        plugins: { id: string; mcp?: { name: string; target: string; confirmed: boolean }[] }[];
      };
      const entry0 = before.plugins.find((p) => p.id === "echo-mcp");
      expect(entry0?.mcp?.map((m) => m.name).sort()).toEqual(["cred", "echo"]);
      expect(entry0?.mcp?.every((m) => !m.confirmed)).toBe(true);

      // 未确认：装配后工具不进注册表（连接根本不发生）
      const blocked = await server.registry.create({ cwd: dataDir });
      const namesOf = (session: { ctx: { get(name: string): unknown } }): string[] =>
        (session.ctx.get("tools") as { project(): { name: string }[] })
          .project()
          .map((w) => w.name);
      await new Promise((r) => setTimeout(r, 400));
      expect(namesOf(blocked).some((n) => n.startsWith("mcp__"))).toBe(false);

      const confirm = await fetch(`${base}/api/plugins/echo-mcp/confirm-mcp`, { method: "POST" });
      expect(confirm.status).toBe(200);
      // settings 持久化（重启续聊语义）
      const settings = JSON.parse(
        await fs.readFile(path.join(dataDir, "config", "settings.json"), "utf8"),
      ) as { plugins?: Record<string, { mcpFingerprint?: string }> };
      expect(settings.plugins?.["echo-mcp"]?.mcpFingerprint).toMatch(/^[0-9a-f]{40}$/);

      // 新会话：异步连接 → 工具进注册表 → tools.execute 全链（含出口限量段）
      const mounted = await server.registry.create({ cwd: dataDir });
      await until("mcp tools registered", () => namesOf(mounted).includes("mcp__echo__echo"));
      const executeOf = (session: { ctx: { get(name: string): unknown } }) =>
        (
          session.ctx.get("tools") as {
            execute(
              call: { callId: string; name: string; argsText: string },
              ctx: unknown,
            ): Promise<{ result: { content: string } }>;
          }
        ).execute.bind(session.ctx.get("tools"));
      const outcome = await executeOf(mounted)(
        { callId: "t-1", name: "mcp__echo__echo", argsText: JSON.stringify({ text: "hello" }) },
        toolCtxOf(mounted, dataDir),
      );
      expect(JSON.parse(outcome.result.content)).toEqual({ echo: "hello" });
      // 字面 env（非凭据引用）注入生效：showenv 回读 MY_SECRET
      const envOutcome = await executeOf(mounted)(
        { callId: "t-2", name: "mcp__cred__showenv", argsText: "{}" },
        toolCtxOf(mounted, dataDir),
      );
      expect(JSON.parse(envOutcome.result.content)).toEqual({ secret: "literal-value" });
    } finally {
      await cleanup();
    }
  });

  it("useResource 端点：越权 403 / 未声明 server 403 / happy path", {
    timeout: 20_000,
  }, async () => {
    const { server, base, dataDir, cleanup } = await makeServer([]);
    try {
      await writeMcpPack(dataDir, false);
      await fetch(`${base}/api/plugins/echo-mcp/confirm-mcp`, { method: "POST" });
      const entry = await server.registry.create({ cwd: dataDir });
      const namesOf = (): string[] =>
        (entry.ctx.get("tools") as { project(): { name: string }[] }).project().map((w) => w.name);
      await until("mcp tools registered", () => namesOf().includes("mcp__echo__echo"));
      const address = `henira-data://${encodeURIComponent("echo-mcp")}/echo/echo?args=${encodeURIComponent(
        JSON.stringify({ text: "ping" }),
      )}`;
      // 所有权闸：调用方 pluginId 与地址不一致 → 403
      const wrong = await fetch(`${base}/api/sessions/${entry.id}/resource`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: "other-pack", address }),
      });
      expect(wrong.status).toBe(403);
      // 未声明 server → 403（同闸）
      const undeclared = await fetch(`${base}/api/sessions/${entry.id}/resource`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: "echo-mcp", address: "henira-data://echo-mcp/nope/tool" }),
      });
      expect(undeclared.status).toBe(403);
      // happy path：text JSON 可解析
      const ok = await fetch(`${base}/api/sessions/${entry.id}/resource`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: "echo-mcp", address }),
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { ok: boolean; text?: string; updatedAt: number };
      expect(body.ok).toBe(true);
      expect(JSON.parse(body.text ?? "{}")).toEqual({ echo: "ping" });
      expect(body.updatedAt).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it("凭据引用：缺失 → 该 server 跳过不 spawn；凭据在场 → env 注入生效（值只进内存）", {
    timeout: 20_000,
  }, async () => {
    const { server, base, dataDir, globalDir, cleanup } = await makeServer([]);
    try {
      await writeMcpPack(dataDir, true); // cred.json env.MY_SECRET = ${credential:test-token}
      await fetch(`${base}/api/plugins/echo-mcp/confirm-mcp`, { method: "POST" });
      const noCred = await server.registry.create({ cwd: dataDir });
      const namesOf = (session: { ctx: { get(name: string): unknown } }): string[] =>
        (session.ctx.get("tools") as { project(): { name: string }[] })
          .project()
          .map((w) => w.name);
      await until("echo tool registered (cred server skipped)", () =>
        namesOf(noCred).includes("mcp__echo__echo"),
      );
      await new Promise((r) => setTimeout(r, 300)); // 给 cred server 一个（不该发生的）连接窗口
      expect(namesOf(noCred).includes("mcp__cred__showenv")).toBe(false);

      // 写入凭据 → 指纹不变（凭据在 credentials.json，不在 mcp/*.json）→ 无需重确认；
      // 新会话 env 注入生效
      await fs.writeFile(
        path.join(globalDir, "credentials.json"),
        JSON.stringify({ providers: { "test-token": "sk-test-secret" } }),
        "utf8",
      );
      const withCred = await server.registry.create({ cwd: dataDir });
      await until("cred tool registered after credential write", () =>
        namesOf(withCred).includes("mcp__cred__showenv"),
      );
      const executeOf = (session: { ctx: { get(name: string): unknown } }) =>
        (
          session.ctx.get("tools") as {
            execute(
              call: { callId: string; name: string; argsText: string },
              ctx: unknown,
            ): Promise<{ result: { content: string } }>;
          }
        ).execute.bind(session.ctx.get("tools"));
      const outcome = await executeOf(withCred)(
        { callId: "t-3", name: "mcp__cred__showenv", argsText: "{}" },
        toolCtxOf(withCred, dataDir),
      );
      expect(JSON.parse(outcome.result.content)).toEqual({ secret: "sk-test-secret" });
    } finally {
      await cleanup();
    }
  });

  it("plugin-mcp 停用：settings enabled:false 后新会话不装配（开关真生效）", async () => {
    const { server, base, dataDir, cleanup } = await makeServer([]);
    try {
      await writeMcpPack(dataDir, false);
      await fetch(`${base}/api/plugins/echo-mcp/confirm-mcp`, { method: "POST" });
      const off = await fetch(`${base}/api/plugins/plugin-mcp/enabled`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      expect(off.status).toBe(200);
      const session = await server.registry.create({ cwd: dataDir });
      await new Promise((r) => setTimeout(r, 400));
      const names = (session.ctx.get("tools") as { project(): { name: string }[] })
        .project()
        .map((w) => w.name);
      expect(names.some((n) => n.startsWith("mcp__"))).toBe(false);
      let assembled = true;
      try {
        session.ctx.get("mcp");
      } catch {
        assembled = false;
      }
      expect(assembled).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("会话删除：MCP 子进程随 dispose 关闭（stop 等待退出）", async () => {
    const { server, base, dataDir, cleanup } = await makeServer([]);
    try {
      const v = await writeMcpPack(dataDir, false);
      await fetch(`${base}/api/plugins/echo-mcp/confirm-mcp`, { method: "POST" });
      const entry = await server.registry.create({ cwd: dataDir });
      const names = (): string[] =>
        (entry.ctx.get("tools") as { project(): { name: string }[] }).project().map((w) => w.name);
      await until("mcp tools registered", () => names().includes("mcp__echo__echo"));
      const marker = path.join(v, "mcp-exited.txt");
      expect(
        await fs
          .access(marker)
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
      expect(await server.registry.deleteSession(entry.id)).toBe(true);
      expect(await fs.readFile(marker, "utf8")).toBe("exited");
    } finally {
      await cleanup();
    }
  });

  /** 最小 Streamable HTTP MCP 桩（application/json 响应，不实现 SSE 流）：验证远程
   *  transport 全链与 headers 传递（D-064 的 remote 分支此前零运行时覆盖） */
  async function startHttpMcpStub(): Promise<{
    url: string;
    seenHeaders: Array<Record<string, string | string[] | undefined>>;
    close: () => Promise<void>;
  }> {
    const seenHeaders: Array<Record<string, string | string[] | undefined>> = [];
    const http = createHttpServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        body += chunk;
      });
      req.on("end", () => {
        seenHeaders.push({ ...req.headers });
        const send = (status: number, payload?: unknown): void => {
          res.statusCode = status;
          if (payload === undefined) {
            res.end();
            return;
          }
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(payload));
        };
        if (req.method !== "POST") {
          send(405);
          return;
        }
        let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
        try {
          msg = JSON.parse(body) as typeof msg;
        } catch {
          send(400);
          return;
        }
        if (msg.method === "initialize") {
          send(200, {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: (msg.params as { protocolVersion?: string })?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "http-echo", version: "1.0.0" },
            },
          });
          return;
        }
        if (msg.method === "tools/list") {
          send(200, {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              tools: [
                {
                  name: "echo",
                  description: "echo over http",
                  inputSchema: {
                    type: "object",
                    properties: { text: { type: "string" } },
                  },
                },
              ],
            },
          });
          return;
        }
        if (msg.method === "tools/call") {
          const params = msg.params as { arguments?: { text?: string } };
          send(200, {
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ echo: params.arguments?.text ?? null }),
                },
              ],
            },
          });
          return;
        }
        // notifications/initialized 等：200 空体（202 会让 client 转而开 GET SSE，桩不伺服）
        send(200);
      });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
    const address = http.address();
    if (address === null || typeof address === "string") throw new Error("http stub listen failed");
    return {
      url: `http://127.0.0.1:${address.port}/mcp`,
      seenHeaders,
      close: () =>
        new Promise<void>((resolve) => {
          http.closeAllConnections();
          http.close(() => resolve());
        }),
    };
  }

  it("远程 transport（Streamable HTTP）：连接 / tools 注册 / 调用 / headers 凭据注入", async () => {
    const { server, base, dataDir, globalDir, cleanup } = await makeServer([]);
    const stub = await startHttpMcpStub();
    try {
      const v = await writeMcpPack(dataDir, false);
      await fs.writeFile(
        path.join(v, "mcp", "remote.json"),
        JSON.stringify({
          url: stub.url,
          // biome-ignore lint/suspicious/noTemplateCurlyInString: 凭据引用语法本身即此字面量
          headers: { Authorization: "Bearer ${credential:remote-token}" },
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(globalDir, "credentials.json"),
        JSON.stringify({ providers: { "remote-token": "sk-remote-secret" } }),
        "utf8",
      );
      await fetch(`${base}/api/plugins/echo-mcp/confirm-mcp`, { method: "POST" });
      const entry = await server.registry.create({ cwd: dataDir });
      const names = (): string[] =>
        (entry.ctx.get("tools") as { project(): { name: string }[] }).project().map((w) => w.name);
      await until("remote mcp tools registered", () => names().includes("mcp__remote__echo"));
      const executeOf = (
        entry.ctx.get("tools") as {
          execute(
            call: { callId: string; name: string; argsText: string },
            ctx: unknown,
          ): Promise<{ result: { content: string } }>;
        }
      ).execute.bind(entry.ctx.get("tools"));
      const outcome = await executeOf(
        {
          callId: "t-http",
          name: "mcp__remote__echo",
          argsText: JSON.stringify({ text: "over-http" }),
        },
        toolCtxOf(entry, dataDir),
      );
      expect(JSON.parse(outcome.result.content)).toEqual({ echo: "over-http" });
      // header 展开生效（凭据只进请求头，不回显到结果）
      expect(stub.seenHeaders.some((h) => h.authorization === "Bearer sk-remote-secret")).toBe(
        true,
      );
    } finally {
      await cleanup();
      await stub.close();
    }
  });

  it("确认端点 404：无 mcp 槽的插件 / 未知 id", async () => {
    const { base, dataDir, cleanup } = await makeServer([]);
    try {
      await fs.mkdir(path.join(dataDir, "plugins", "plain-pack", "1.0.0"), { recursive: true });
      await fs.writeFile(
        path.join(dataDir, "plugins", "plain-pack", "1.0.0", "plugin.json"),
        JSON.stringify({ name: "plain-pack", version: "1.0.0" }),
        "utf8",
      );
      const noMcp = await fetch(`${base}/api/plugins/plain-pack/confirm-mcp`, { method: "POST" });
      expect(noMcp.status).toBe(404);
      const unknown = await fetch(`${base}/api/plugins/ghost/confirm-mcp`, { method: "POST" });
      expect(unknown.status).toBe(404);
    } finally {
      await cleanup();
    }
  });
});

describe("能力件（D-065 批 B：fs / shell 服务 + 工具件 + breaker 默认装配）", () => {
  const USAGE = { inputTokens: 12, outputTokens: 6 };
  /** 最小 ToolContext（tools.execute 直呼用） */
  function fsToolCtx(cwd: string, decision = "allowed-once"): ToolContext {
    return {
      cwd,
      signal: new AbortController().signal,
      requestPermission: async () => decision as never,
      config: { get: async () => undefined } as unknown as ConfigService,
    };
  }

  it("默认装配：fs / shell 槽在场 + 八工具注册（含 ask_user）+ breaker 无名件 + /api/plugins 官方 13 条", async () => {
    const { server, dataDir, base, cleanup } = await makeServer([]);
    try {
      const entry = await server.registry.create({ cwd: dataDir });
      expect(() => entry.ctx.get("fs")).not.toThrow();
      expect(() => entry.ctx.get("shell")).not.toThrow();
      const names = entry.ctx
        .get("tools")
        .project()
        .map((t) => t.name)
        .sort();
      for (const expected of [
        "ask_user",
        "bash",
        "edit",
        "glob",
        "grep",
        "powershell",
        "read",
        "write",
      ]) {
        expect(names).toContain(expected);
      }

      const list = (await (await fetch(`${base}/api/plugins`)).json()) as {
        plugins: { id: string; enabled: boolean; state: string }[];
      };
      expect(list.plugins).toHaveLength(13); // defaultPreset：引擎 5 + fs 族 3 + shell 族 2 + breaker + ask-user + mcp
      const ids = list.plugins.map((p) => p.id);
      for (const id of [
        "plugin-fs",
        "plugin-fs-tools",
        "plugin-fs-search",
        "plugin-shell",
        "plugin-shell-tools",
        "plugin-breaker",
        "plugin-ask-user",
      ]) {
        expect(ids).toContain(id);
      }
    } finally {
      await cleanup();
    }
  });

  it("能力服务装载强制（M4 判据③）：停用 fs 服务 → fs 工具全体缺席 + fs 槽缺失，shell 照常", async () => {
    const { server, dataDir, globalDir, cleanup } = await makeServer([]);
    try {
      await fs.writeFile(
        path.join(globalDir, "settings.json"),
        JSON.stringify({
          version: 1,
          model: "mock/mock-1",
          plugins: { "plugin-fs": { enabled: false } },
        }),
        "utf8",
      );
      const entry = await server.registry.create({ cwd: dataDir });
      expect(() => entry.ctx.get("fs")).toThrow(); // MissingSlotError
      const names = entry.ctx
        .get("tools")
        .project()
        .map((t) => t.name);
      for (const gone of ["read", "write", "edit", "glob", "grep"]) {
        expect(names).not.toContain(gone);
      }
      expect(names).toContain("bash"); // shell 族照常——系统照跑
    } finally {
      await cleanup();
    }
  });

  it("read 工具全链（server 宿主）：tools.execute → 行号输出；区外路径经判定链弹卡", async () => {
    const { server, dataDir, cleanup } = await makeServer([]);
    try {
      await fs.writeFile(path.join(dataDir, "hello.txt"), "alpha\nbeta\n", "utf8");
      const entry = await server.registry.create({ cwd: dataDir });
      const outcome = await entry.ctx
        .get("tools")
        .execute(
          { callId: "t1", name: "read", argsText: '{"file_path":"hello.txt"}' },
          fsToolCtx(dataDir),
        );
      expect(outcome.result.isError).toBeUndefined();
      expect(outcome.result.content).toContain("1\talpha");
      expect(outcome.result.content).toContain("2\tbeta");

      // 区外：floor ask → 自动应答 allowed → 放行（卡经判定链，reason 带区外说明）
      const outside = await fs.mkdtemp(path.join(tmpdir(), "henira-out-"));
      await fs.writeFile(path.join(outside, "o.txt"), "outer", "utf8");
      const asks: { reason?: string }[] = [];
      const askCtx = fsToolCtx(dataDir);
      askCtx.requestPermission = async (req) => {
        asks.push({ reason: req.reason });
        return "allowed-once";
      };
      const o = await entry.ctx.get("tools").execute(
        {
          callId: "t2",
          name: "read",
          argsText: JSON.stringify({ file_path: path.join(outside, "o.txt") }),
        },
        askCtx,
      );
      expect(o.result.isError).toBeUndefined();
      expect(o.result.content).toContain("outer");
      // 第一次 ask = 管线判定链（无 reason），第二次 = 服务层区外问（带 reason）
      expect(asks.some((a) => a.reason?.includes("outside the session workspace"))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("bash 工具全链（server 宿主）：执行 + [exit code] 语义", async () => {
    const { server, dataDir, cleanup } = await makeServer([]);
    try {
      const entry = await server.registry.create({ cwd: dataDir });
      const ok = await entry.ctx
        .get("tools")
        .execute(
          { callId: "t1", name: "bash", argsText: '{"command":"node -e \\"console.log(40+2)\\""}' },
          fsToolCtx(dataDir),
        );
      expect(ok.result.isError).toBeUndefined();
      expect(ok.result.content).toContain("42");

      const fail = await entry.ctx
        .get("tools")
        .execute(
          { callId: "t2", name: "bash", argsText: '{"command":"node -e \\"process.exit(7)\\""}' },
          fsToolCtx(dataDir),
        );
      expect(fail.result.isError).toBeUndefined(); // 非零退出码不是 isError
      expect(fail.result.content).toContain("[exit code: 7]");
    } finally {
      await cleanup();
    }
  });

  it("凭据硬拒（D-030）走真判定链：读 .env 链前拒（无审计对），工具未执行", async () => {
    const { server, dataDir, cleanup } = await makeServer([
      [
        mockToolCall("c1", "read", '{"file_path":".env"}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [mockText("被拒后收尾"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    try {
      await fs.writeFile(path.join(dataDir, ".env"), "SECRET=1", "utf8");
      const entry = await server.registry.create({ cwd: dataDir });
      const events: string[] = [];
      for await (const event of entry.ctx.get("loop").run("读 env")) {
        events.push(event.type);
      }
      expect(events.at(-1)).toBe("turn-ended");
      const results = entry.ctx
        .get("session")
        .events()
        .filter((e) => e.type === "tool/result")
        .map((e) => e.data as { isError: boolean; content: string });
      expect(results[0]?.isError).toBe(true);
      expect(results[0]?.content).toContain("[permission:rejected]");
      // 链外硬拒无审计对（D-039：清单前拒不进 asked/decided）
      const types = entry.ctx
        .get("session")
        .events()
        .map((e) => e.type);
      expect(types).not.toContain("approval/asked");
    } finally {
      await cleanup();
    }
  });
});

describe("重启收口（R175）：settle 分型 + 启动账本修理", () => {
  it("settle 分型：未知 requestId → 404 approval not found；真挂起 → applied:true；已答 → applied:false", async () => {
    const { server, base, cleanup } = await makeServer([
      [mockToolCall("c1", "demo-write", "{}"), mockFinish("tool-calls")],
      [mockText("已处理"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    try {
      const id = await createSession(base);
      // 从不存在（服务重启收口/重启前死亡）：404 结构化——不假成功不 500
      const missing = await fetch(`${base}/api/sessions/${id}/approvals/no-such-id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allowed-once" }),
      });
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { error: string }).error).toBe("approval not found");

      // 造真挂起 → settle 应用 → 重复 settle 幂等 false（200，先答者赢语义不变）
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
      const requestId = await waitFor(async () => {
        const snap = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
          rows: { kind: string; status?: string; requestId?: string }[];
        };
        const row = snap.rows.find((r) => r.kind === "approval" && r.status === "pending");
        return row?.requestId;
      });
      const settle1 = await fetch(`${base}/api/sessions/${id}/approvals/${requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allowed-once" }),
      });
      expect(settle1.status).toBe(200);
      expect(((await settle1.json()) as { applied: boolean }).applied).toBe(true);
      const settle2 = await fetch(`${base}/api/sessions/${id}/approvals/${requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allowed-once" }),
      });
      expect(settle2.status).toBe(200);
      expect(((await settle2.json()) as { applied: boolean }).applied).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("R198 权限快照/撤销端点：会话允许 → GET 可见 → 撤销清空（回合之外也落账）", async () => {
    const { server, base, cleanup } = await makeServer([
      [mockToolCall("c1", "demo-write", "{}"), mockFinish("tool-calls")],
      [mockText("已处理"), mockUsage({ inputTokens: 1, outputTokens: 1 }), mockFinish("stop")],
    ]);
    try {
      const id = await createSession(base);
      const empty = (await (
        await fetch(`${base}/api/sessions/${id}/permissions`)
      ).json()) as unknown;
      expect(empty).toEqual({ session: { rules: [], tools: [] }, project: [], global: [] });

      server.registry
        .get(id)
        ?.ctx.get("tools")
        .register({
          name: "demo-write",
          description: "demo write tool (requires approval)",
          inputSchema: { type: "object", properties: {} },
          execute: async () => ({ content: "written" }),
        });
      await fetch(`${base}/api/sessions/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "写文件" }),
      });
      const requestId = await waitFor(async () => {
        const snap = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
          rows: { kind: string; status?: string; requestId?: string }[];
        };
        return snap.rows.find((r) => r.kind === "approval" && r.status === "pending")?.requestId;
      });
      const settle = await fetch(`${base}/api/sessions/${id}/approvals/${requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allowed-once", scope: "session" }),
      });
      expect(((await settle.json()) as { applied: boolean }).applied).toBe(true);
      await waitFor(async () => {
        const snap = (await (await fetch(`${base}/api/sessions/${id}/snapshot`)).json()) as {
          state: { busy: boolean };
        };
        return snap.state.busy === false ? true : undefined;
      });

      const allowed = (await (await fetch(`${base}/api/sessions/${id}/permissions`)).json()) as {
        session: { rules: unknown[]; tools: string[] };
      };
      expect(allowed.session).toEqual({ rules: [], tools: ["demo-write"] });

      // 回合已结束（无 open turn）：撤销仍可落账（store 闸对 revoked 豁免）
      const revoke = await fetch(`${base}/api/sessions/${id}/permissions/session/revoke`, {
        method: "POST",
      });
      expect(revoke.status).toBe(200);
      const after = (await (await fetch(`${base}/api/sessions/${id}/permissions`)).json()) as {
        session: unknown;
      };
      expect(after.session).toEqual({ rules: [], tools: [] });
      expect(
        server.registry
          .get(id)
          ?.ctx.get("session")
          .events()
          .some((e) => e.type === "approval/revoked"),
      ).toBe(true);
      // 未知会话 404
      expect((await fetch(`${base}/api/sessions/no-such/permissions`)).status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("R199 权限管理端点：项目清单/详情/全局删除 + 会话撤销 body + 路径闸", async () => {
    const { base, cleanup, dataDir, globalDir } = await makeServer([]);
    try {
      const workspace = path.join(root, `perm-ws-${Math.random().toString(36).slice(2, 8)}`);
      await fs.mkdir(workspace, { recursive: true });
      const id = await createSession(base, workspace);
      const key = projectKey(workspace);
      const projectFile = path.join(dataDir, "projects", key, "permissions.json");
      await fs.mkdir(path.dirname(projectFile), { recursive: true });
      const allow = {
        match: { tool: "bash", commandExact: "echo r199" },
        decision: "allow" as const,
      };
      const deny = {
        match: { tool: "bash", commandContains: "rm -rf" },
        decision: "deny" as const,
      };
      await fs.writeFile(projectFile, JSON.stringify({ version: 1, rules: [allow, deny] }), "utf8");

      const list = (await (
        await fetch(`${base}/api/permissions/projects?sessionId=${id}`)
      ).json()) as {
        projects: {
          id: string;
          key: string;
          cwd: string;
          allowCount: number;
          denyCount: number;
          status: string;
        }[];
        currentId?: string;
      };
      expect(list.currentId).toBeDefined();
      expect(list.projects[0]?.id).toBe(list.currentId); // 当前项目置顶
      expect(list.projects.find((p) => p.id === list.currentId)).toMatchObject({
        key,
        cwd: workspace,
        allowCount: 1,
        denyCount: 1,
        status: "ok",
      });

      const detail = (await (
        await fetch(`${base}/api/permissions/projects/${list.currentId}`)
      ).json()) as { path: string; status: string; rules: unknown[] };
      expect(detail).toMatchObject({ status: "ok", rules: [allow, deny] });
      expect(detail.path).toBe(projectFile);

      // 删除一条 allow：deny 保留、文件格式仍 2 空格
      const removed = await fetch(`${base}/api/permissions/projects/${list.currentId}/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rule: allow }),
      });
      expect(removed.status).toBe(200);
      expect(((await removed.json()) as { removed: number }).removed).toBe(1);
      expect(JSON.parse(await fs.readFile(projectFile, "utf8"))).toMatchObject({ rules: [deny] });

      // 全局规则视图 + 删除
      const globalFile = path.join(globalDir, "permissions.json");
      const globalAllow = { match: { tool: "read" }, decision: "allow" as const };
      await fs.writeFile(globalFile, JSON.stringify({ version: 1, rules: [globalAllow] }), "utf8");
      const globalView = (await (await fetch(`${base}/api/permissions/global`)).json()) as {
        path: string;
        status: string;
        rules: unknown[];
      };
      expect(globalView).toMatchObject({ path: globalFile, status: "ok", rules: [globalAllow] });
      const globalRemoved = await fetch(`${base}/api/permissions/global/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rule: globalAllow }),
      });
      expect(((await globalRemoved.json()) as { removed: number }).removed).toBe(1);
      expect(JSON.parse(await fs.readFile(globalFile, "utf8"))).toMatchObject({ rules: [] });

      // 会话撤销 body：缺省 = 清空；tool/rule 互斥；rule 只收 allow；坏 JSON 400
      const post = (body?: string): Promise<Response> =>
        fetch(`${base}/api/sessions/${id}/permissions/session/revoke`, {
          method: "POST",
          ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
        });
      expect((await post()).status).toBe(200);
      expect((await post(JSON.stringify({ tool: "demo-write" }))).status).toBe(200);
      expect((await post(JSON.stringify({ tool: "demo-write", rule: allow }))).status).toBe(400);
      expect(
        (
          await post(
            JSON.stringify({
              rule: { match: { tool: "bash", commandExact: "x" }, decision: "deny" },
            }),
          )
        ).status,
      ).toBe(400);
      expect((await post("{ nope")).status).toBe(400);
      expect(
        (
          await post(
            JSON.stringify({
              rule: { match: { tool: "bash", commandExact: "echo r199" }, decision: "allow" },
            }),
          )
        ).status,
      ).toBe(200);

      // 路径闸：projects.json 里手改出的坏 key 不进清单，按 id 取详情 404
      const registryFile = path.join(dataDir, "projects.json");
      const registryRaw = JSON.parse(await fs.readFile(registryFile, "utf8")) as {
        projects: Record<string, unknown>[];
      };
      registryRaw.projects.push({
        id: "badbadbadbadbad0",
        cwd: workspace,
        key: "../escape",
        displayName: "bad",
        createdAt: 1,
        lastOpenedAt: 1,
        openCount: 1,
        lastSessionId: null,
      });
      await fs.writeFile(registryFile, JSON.stringify(registryRaw), "utf8");
      const guarded = (await (await fetch(`${base}/api/permissions/projects`)).json()) as {
        projects: { id: string }[];
      };
      expect(guarded.projects.some((p) => p.id === "badbadbadbadbad0")).toBe(false);
      expect((await fetch(`${base}/api/permissions/projects/badbadbadbadbad0`)).status).toBe(404);

      // 坏项目文件：详情 status corrupt；删除 409 且原文件不动
      const broken = '{\n  "rules": [\n';
      await fs.writeFile(projectFile, broken, "utf8");
      const corrupt = (await (
        await fetch(`${base}/api/permissions/projects/${list.currentId}`)
      ).json()) as { status: string };
      expect(corrupt.status).toBe("corrupt");
      const corruptRemove = await fetch(
        `${base}/api/permissions/projects/${list.currentId}/remove`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rule: deny }),
        },
      );
      expect(corruptRemove.status).toBe(409);
      expect(await fs.readFile(projectFile, "utf8")).toBe(broken);
      // 未知项目 404
      expect((await fetch(`${base}/api/permissions/projects/no-such`)).status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("启动账本修理：seq 重排 + 孤儿收口在监听前完成（幽灵卡与假在跑工具行不可能重放出来）", async () => {
    const dataDir = path.join(root, `repair-${Math.random().toString(36).slice(2, 8)}`);
    const globalDir = path.join(dataDir, "config");
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(
      path.join(globalDir, "settings.json"),
      JSON.stringify({ version: 1, model: "mock/mock-1" }),
      "utf8",
    );
    const sid = "s-repair000-abc123";
    const ledgerDir = path.join(dataDir, "projects", "--repair-test-deadbeef--", "sessions", sid);
    await fs.mkdir(ledgerDir, { recursive: true });
    const header = JSON.stringify({ version: 1, id: sid, createdAt: 1, cwd: root });
    const line = (seq: number, type: string, data: object, time: number): string =>
      JSON.stringify({ type, seq, time, data });
    // 用户幽灵会话同款账本伤：decided 连发抢 seq（3,3）+ 孤儿审批挂起 + 开回合无收尾
    const ledger = [
      header,
      line(1, "user/message", { turn: "t1", step: 0, content: "hi", source: "send" }, 100),
      line(2, "turn/start", { turn: "t1" }, 120),
      line(
        3,
        "approval/asked",
        {
          turn: "t1",
          step: 1,
          requestId: "r-ghost",
          callId: "r-ghost",
          tool: "bash",
          argsDigest: "sha:x",
          args: { command: "ls" },
        },
        150,
      ),
      line(
        3,
        "approval/decided",
        { turn: "t1", step: 1, requestId: "r-other", decision: "allowed-once" },
        151,
      ),
      line(
        4,
        "assistant/message",
        { turn: "t1", step: 1, content: "", model: "m", finishReason: "tool-calls" },
        160,
      ),
    ].join("\n");
    const ledgerPath = path.join(ledgerDir, "session.v1.jsonl");
    await fs.writeFile(ledgerPath, `${ledger}\n`, "utf8");

    const { mockLlm } = await import("@henira/llm-mock");
    const server = await createServer({
      dataDir,
      globalDir,
      llm: llmStub(mockLlm([]).service),
    });
    try {
      const readEvents = async (): Promise<
        { seq: number; type: string; data: Record<string, unknown> }[]
      > => {
        const raw = (await fs.readFile(ledgerPath, "utf8")).trimEnd().split("\n");
        return raw
          .slice(1)
          .map(
            (l) => JSON.parse(l) as { seq: number; type: string; data: Record<string, unknown> },
          );
      };
      // 账本自洽：seq 连续 + 尾部 invalidated → interrupted（先审批后回合）
      const events = await readEvents();
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(events[5]).toMatchObject({
        type: "approval/invalidated",
        data: { requestId: "r-ghost" },
      });
      expect(events[6]).toMatchObject({
        type: "turn/end",
        data: { turn: "t1", reason: "interrupted" },
      });

      // 快照（未装配、从账本重建的路径）：无 pending 幽灵卡、已失效痕迹行在场、busy false
      const snap = (await (await fetch(`${server.url}/api/sessions/${sid}/snapshot`)).json()) as {
        rows: { kind: string; status?: string; decision?: string }[];
        state: { busy: boolean };
      };
      expect(snap.state.busy).toBe(false);
      expect(snap.rows.some((r) => r.kind === "approval" && r.status === "pending")).toBe(false);
      expect(
        snap.rows.some(
          (r) => r.kind === "approval" && r.status === "settled" && r.decision === "invalidated",
        ),
      ).toBe(true);

      // 幂等：再跑一遍零新增
      await server.registry.repairLedgers();
      expect((await readEvents()).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    } finally {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
