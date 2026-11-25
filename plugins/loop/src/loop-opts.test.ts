// 模型/思考按次覆盖（每次提问绑定）：显式 modelId 走 config.model(id) 既有显式缝、
// 缺省回落全局默认；思考档进 LlmRequest + request/header.params（实际生效档审计）；
// 忙时入队条目携带覆盖、回合末冲刷按原选择开新回合。插话进场不换档（回合档位回合开始即定）。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness, type ServiceDefinition } from "@henira/kernel";
import { mockFinish, mockLlm, mockText, mockUsage } from "@henira/llm-mock";
import { sessionPlugin } from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import { asHeniraContext, type ConfigService, type LlmService } from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-loop-opts-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const USAGE = { inputTokens: 3, outputTokens: 2 };

function llmStub(service: LlmService): ServiceDefinition<LlmService> {
  return { name: "llm", start: () => service };
}

function approvalStub(): ServiceDefinition {
  return {
    name: "approval",
    start() {
      return { requestPermission: async () => ({ decision: "allowed-once" as const }) };
    },
  };
}

function interactionStub(): ServiceDefinition {
  return {
    name: "interaction",
    start() {
      return {
        ask: async () => ({ kind: "approval", requestId: "x", decision: "allowed-once" }),
        settle: () => false,
        listPending: () => [],
      };
    },
  };
}

/** config 桩：model(id) 可观测（记录调用实参）；缺省返回 mock/mock-1 */
function configStub(): ServiceDefinition<ConfigService> {
  const calls: (string | undefined)[] = [];
  return {
    name: "config",
    start() {
      return {
        cwd: root,
        model: async (id?: string) => {
          calls.push(id);
          return {
            provider: id === undefined ? "mock" : "other",
            model: id === undefined ? "mock-1" : (id.split("/")[1] ?? "m"),
          };
        },
        credential: async () => "k",
        get: async () => undefined,
        permissionRules: async () => [],
        projectPermissionRules: async () => [],
        addProjectPermissionRule: async () => {},
      } satisfies ConfigService;
    },
  };
}

async function startedLoop(script: Parameters<typeof mockLlm>[0]) {
  const mock = mockLlm(script);
  const sessionDir = path.join(root, "sess");
  const harness = createHarness()
    .use(sessionPlugin({ directory: sessionDir, cwd: root }))
    .use(toolsPlugin({}))
    .use(llmStub(mock.service))
    .use(approvalStub())
    .use(interactionStub())
    .use(configStub())
    .use((await import("./service.js")).loopPlugin({}));
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  return { ctx, loop: ctx.get("loop"), mock, session: ctx.get("session"), sessionDir };
}

describe("模型/思考按次覆盖（每次提问绑定）", () => {
  it("显式 modelId：config.model(id) 显式缝生效，request/header 记实际解析模型；缺省回落全局默认", async () => {
    const { loop, session } = await startedLoop([
      [mockText("好"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("好"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    // 第二回合：显式 other/m-2
    for await (const _ of loop.run("默认档")) void _;
    for await (const _ of loop.run("覆盖档", undefined, {
      modelId: "other/m-2",
      reasoningEffort: "high",
    })) {
      void _;
    }
    const headers = session.events().filter((e) => e.type === "request/header");
    expect(headers).toHaveLength(2);
    const modelOf = (i: number): string => {
      const h = headers[i];
      if (h === undefined) throw new Error(`header ${i} missing`);
      return (h.data as { model: string }).model;
    };
    expect(modelOf(0)).toBe("mock/mock-1"); // 缺省 = 全局默认
    expect(modelOf(1)).toBe("other/m-2"); // 显式覆盖生效
  });

  it("思考档进 request/header.params（实际生效档审计）；未指定 = 空对象（兼容旧读方）", async () => {
    const { loop, session } = await startedLoop([
      [mockText("好"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("好"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    for await (const _ of loop.run("无档")) void _;
    for await (const _ of loop.run("中档", undefined, { reasoningEffort: "medium" })) void _;
    const headers = session.events().filter((e) => e.type === "request/header");
    const paramsOf = (i: number): Record<string, unknown> => {
      const h = headers[i];
      if (h === undefined) throw new Error(`header ${i} missing`);
      return (h.data as { params: Record<string, unknown> }).params;
    };
    expect(paramsOf(0)).toEqual({});
    expect(paramsOf(1)).toEqual({ reasoningEffort: "medium" });
  });

  it("思考档透传 LlmRequest（适配器映射的输入）；缺省字段缺席", async () => {
    const script = [[mockText("好"), mockUsage(USAGE), mockFinish("stop")]] as const;
    const { loop, mock } = await startedLoop(script as never);
    const spy = vi.spyOn(mock.service, "stream");
    for await (const _ of loop.run("带档", undefined, { reasoningEffort: "low" })) void _;
    expect(spy.mock.calls[0]?.[0].reasoningEffort).toBe("low");
  });

  it("忙时入队条目携带覆盖（queue.json 落盘）+ 回合末冲刷按条目原选择开新回合", async () => {
    // 门控式 Llm 桩：第一回合流挂起占住 busy 窗——第二 send 确定性走队列（不靠时序赛跑）
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const calls: unknown[] = [];
    const held: LlmService = {
      async *stream(req, signal) {
        calls.push(req);
        yield { type: "text-delta", text: "一" };
        await gate; // 占住回合（busy）
        yield { type: "usage", usage: USAGE };
        yield { type: "finish", reason: "stop" };
        void signal;
      },
    };
    const sessionDir = path.join(root, "sess");
    const harness = createHarness()
      .use(sessionPlugin({ directory: sessionDir, cwd: root }))
      .use(toolsPlugin({}))
      .use(llmStub(held))
      .use(approvalStub())
      .use(interactionStub())
      .use(configStub())
      .use((await import("./service.js")).loopPlugin({}));
    await harness.start();
    const ctx = asHeniraContext(harness.context);
    const loop = ctx.get("loop");
    const session = ctx.get("session");
    await loop.send("第一", { modelId: "other/one" }); // 闲时直开，回合挂起中
    await loop.send("第二", { modelId: "other/two", reasoningEffort: "high" }); // 忙时入队
    // 队列条目落盘断言（先于冲刷读——证明覆盖随条目持久化，重启恢复语义的依据）
    const queuedRaw = await fs.readFile(path.join(sessionDir, "queue.json"), "utf8");
    expect(queuedRaw).toContain('"modelId": "other/two"');
    expect(queuedRaw).toContain('"reasoningEffort": "high"');
    release(); // 放行第一回合 → 回合末冲刷队列
    await vi.waitFor(
      () => {
        const headers = session.events().filter((e) => e.type === "request/header");
        if (headers.length < 2) throw new Error(`headers=${headers.length}`);
      },
      { timeout: 4000 },
    );
    const headers = session.events().filter((e) => e.type === "request/header");
    const models = headers.map((h) => (h.data as { model: string }).model).sort();
    expect(models).toEqual(["other/one", "other/two"]); // 队列条目覆盖随冲刷生效
    const h2 = headers[1];
    if (h2 === undefined) throw new Error("header 1 missing");
    expect((h2.data as { params: { reasoningEffort?: string } }).params).toEqual({
      reasoningEffort: "high",
    });
  });

  it("权限模式随回合开场落账（turn/start 带 permissionMode）+ 队列条目持久化、冲刷按原选择开新回合（D-080）", async () => {
    // 门控式 Llm 桩（同上）：第一回合挂起占 busy，第二 send 确定性入队
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held: LlmService = {
      async *stream(req, signal) {
        void req;
        yield { type: "text-delta", text: "一" };
        await gate;
        yield { type: "usage", usage: USAGE };
        yield { type: "finish", reason: "stop" };
        void signal;
      },
    };
    const sessionDir = path.join(root, "sess");
    const harness = createHarness()
      .use(sessionPlugin({ directory: sessionDir, cwd: root }))
      .use(toolsPlugin({}))
      .use(llmStub(held))
      .use(approvalStub())
      .use(interactionStub())
      .use(configStub())
      .use((await import("./service.js")).loopPlugin({}));
    await harness.start();
    const ctx = asHeniraContext(harness.context);
    const loop = ctx.get("loop");
    const session = ctx.get("session");
    await loop.send("默认档"); // 无模式 = turn/start 无字段（缺省 ask，旧读者兼容）
    await loop.send("full 档", { permissionMode: "full" }); // 忙时入队
    const queuedRaw = await fs.readFile(path.join(sessionDir, "queue.json"), "utf8");
    expect(queuedRaw).toContain('"permissionMode": "full"');
    release();
    await vi.waitFor(
      () => {
        const starts = session.events().filter((e) => e.type === "turn/start");
        if (starts.length < 2) throw new Error(`starts=${starts.length}`);
      },
      { timeout: 4000 },
    );
    const starts = session.events().filter((e) => e.type === "turn/start");
    const modeOf = (i: number): string | undefined => {
      const s = starts[i];
      if (s === undefined) throw new Error(`start ${i} missing`);
      return (s.data as { permissionMode?: string }).permissionMode;
    };
    expect(modeOf(0)).toBeUndefined();
    expect(modeOf(1)).toBe("full");
  });
});
