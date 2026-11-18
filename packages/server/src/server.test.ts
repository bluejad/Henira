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
import { createServer, type HeniraServer } from "./server.js";

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
  opts?: { token?: string },
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
    const { base, globalDir, cleanup } = await makeServer([]);
    try {
      const v = path.join(globalDir, "plugins", "ja-pack", "1.0.0");
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
