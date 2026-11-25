import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness, type ServiceDefinition } from "@henira/kernel";
import { mockFinish, mockLlm, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import { sessionPlugin } from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import {
  asHeniraContext,
  type Decision,
  type LlmRequest,
  type LlmService,
  type ToolDefinition,
} from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loopPlugin } from "./service.js";

// 中断纪律五条（P6 / loop.md §2）——每条一个具名测试（roadmap M2 判据②：loop.md §2 表格一行一测试）。

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-loop-int-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const USAGE = { inputTokens: 10, outputTokens: 5 };

function llmStub(service: LlmService): ServiceDefinition<LlmService> {
  return { name: "llm", start: () => service };
}
function approvalStub(): ServiceDefinition {
  return {
    name: "approval",
    start: () => ({ requestPermission: async () => ({ decision: "allowed-once" as const }) }),
  };
}
function interactionStub(): ServiceDefinition {
  return {
    name: "interaction",
    start: () => ({
      ask: async () => ({ kind: "approval", requestId: "x", decision: "allowed-once" as Decision }),
      settle: () => false,
      listPending: () => [],
    }),
  };
}
function configStub(): ServiceDefinition {
  return {
    name: "config",
    start: () => ({
      cwd: root,
      model: async () => ({ provider: "mock", model: "m" }),
      credential: async () => "k",
      get: () => undefined,
      permissionRules: async () => [],
    }),
  };
}

const instantTool: ToolDefinition = {
  name: "read",
  description: "read",
  inputSchema: { type: "object" },
  execute: async () => ({ content: "ok" }),
};

async function startedLoop(
  script: Parameters<typeof mockLlm>[0],
  tool: ToolDefinition = instantTool,
) {
  const mock = mockLlm(script);
  const harness = createHarness()
    .use(
      sessionPlugin({ directory: path.join(root, Math.random().toString(16).slice(2)), cwd: root }),
    )
    .use(toolsPlugin({}))
    .use(llmStub(mock.service))
    .use(approvalStub())
    .use(interactionStub())
    .use(configStub())
    .use(loopPlugin());
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  ctx.get("tools").register(tool);
  return { harness, ctx, loop: ctx.get("loop"), session: ctx.get("session"), mock };
}

describe("中断纪律五条（loop.md §2，一行一测试）", () => {
  it("纪律①：掐流后先查 aborted 再诊断——hang 流被 abort 后收尾 aborted，不误判为可重试错误", async () => {
    const { harness, loop, session } = await startedLoop(["hang"]);
    const controller = new AbortController();
    const events: { type: string }[] = [];
    const consuming = (async () => {
      for await (const event of loop.run("会挂住", controller.signal)) events.push(event);
    })();
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await consuming;
    const end = [...session.events()].reverse().find((e) => e.type === "turn/end");
    const endData =
      end === undefined ? undefined : (end.data as { reason: string; cause?: string });
    expect(endData?.reason).toBe("aborted");
    expect(endData?.cause).toBe("user");
    // 掐流不是错误：没有 error 事件落账（"干净收尾"没被误判 retryable）
    expect(session.events().some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(false);
    await harness.dispose();
  });

  it("纪律②：dangling tool_calls 清理——流中断后每个 tool/call 必有配对结果（不留孤儿）", async () => {
    // 脚本：吐出 tool-call 事件后挂住 → abort → 中断路径
    const script: Parameters<typeof mockLlm>[0] = [
      async function* (_req: LlmRequest, signal: AbortSignal) {
        yield mockToolCall("c1", "read", "{}");
        // 挂住直至 abort（signal 钩子——hang 条目的等价物）
        await new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted by test signal")), {
            once: true,
          });
        });
      },
    ];
    const { harness, loop, session } = await startedLoop(script);
    const controller = new AbortController();
    const consuming = (async () => {
      for await (const _ of loop.run("中断在流中", controller.signal)) void _;
    })();
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await consuming;
    // P8 替换者清单：每个 tool/call 必有 tool/result——中断时 calls 未执行、未落 tool/call，
    // 派生侧兜底（session 孤儿合成）与 loop 侧（执行中合成）双保险都为零孤儿：
    const derived = session.deriveMessages();
    const orphanCalls = derived.filter((m) => m.role === "assistant" && m.toolCalls?.length).length;
    const toolMsgs = derived.filter((m) => m.role === "tool").length;
    expect(orphanCalls).toBe(0); // 未落的 call 不进派生（先查 aborted 再结算）
    expect(toolMsgs).toBe(0);
    await harness.dispose();
  });

  it("纪律③：工具执行与信号竞速——已启动的工具跑完并按真实结果结算，不留'运行中'残影", async () => {
    let started = false;
    let completed = false;
    const slowTool: ToolDefinition = {
      ...instantTool,
      execute: async () => {
        started = true;
        await new Promise((r) => setTimeout(r, 60));
        completed = true;
        return { content: "slow but done" };
      },
    };
    const { harness, loop, session } = await startedLoop(
      [
        [mockToolCall("c1", "read", "{}"), mockUsage(USAGE), mockFinish("tool-calls")],
        [mockText("x"), mockUsage(USAGE), mockFinish("stop")],
      ],
      slowTool,
    );
    const controller = new AbortController();
    const consuming = (async () => {
      for await (const _ of loop.run("慢工具", controller.signal)) void _;
    })();
    while (!started) await new Promise((r) => setTimeout(r, 2)); // 确定性：工具已启动（fs append 耗时不定，睡等是竞态）
    controller.abort();
    await consuming;
    expect(completed).toBe(true); // 已启动则等工具自行结束（dsh 语义）
    const result = session.events().find((e) => e.type === "tool/result");
    expect(result === undefined ? undefined : (result.data as { content: string }).content).toBe(
      "slow but done",
    ); // 真实结果照常结算
    const end = [...session.events()].reverse().find((e) => e.type === "turn/end");
    expect(end === undefined ? undefined : (end.data as { reason: string }).reason).toBe("aborted"); // 回合仍以 aborted 收尾
    await harness.dispose();
  });

  it("纪律④：inflight 事件兜底补发——缓冲中的增量在收尾前冲出，消费者不缺尾包", async () => {
    const { harness, loop } = await startedLoop([
      [mockText("早"), mockText("晚"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const events: { type: string }[] = [];
    for await (const event of loop.run("正常收尾")) events.push(event);
    const deltas = events.filter((e) => e.type === "text-delta");
    expect(deltas.length).toBeGreaterThanOrEqual(2); // 首包透传 + 窗口攒批的都在
    expect(events.at(-1)?.type).toBe("turn-ended");
    await harness.dispose();
  });

  it("纪律⑤：错误落盘为事件——流异常回合也有收尾（error + turn/end{error}）", async () => {
    const boom = new Error("provider 500");
    const { harness, loop, session } = await startedLoop([boom]);
    const events: { type: string }[] = [];
    for await (const event of loop.run("会炸")) events.push(event);
    expect(events.some((e) => e.type === "error")).toBe(true);
    const errorEvent = session.events().find((e) => e.type === "error");
    expect(errorEvent === undefined ? undefined : (errorEvent.data as { code: string }).code).toBe(
      "LLM_STREAM",
    );
    const end = [...session.events()].reverse().find((e) => e.type === "turn/end");
    expect(end === undefined ? undefined : (end.data as { reason: string }).reason).toBe("error");
    // 有 turn/start 必有 turn/end（回合无僵尸）
    const starts = session.events().filter((e) => e.type === "turn/start").length;
    const ends = session.events().filter((e) => e.type === "turn/end").length;
    expect(starts).toBe(ends);
    await harness.dispose();
  });
});

describe("中断×队列（队列非空中断 = 冻结不冲刷，resume 显式恢复）", () => {
  it("冻结：中断后条目留守（不落账、无孤儿 user 行、paused 置位），resume 取队头恢复续冲", async () => {
    const { harness, ctx, loop, session } = await startedLoop([
      "hang", // 首回合挂住 → interrupt 打断
      [mockText("排队一回复"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("排队二回复"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const pauses: boolean[] = [];
    ctx.events.on("queue/changed", () => pauses.push(loop.paused()));
    const consuming = (async () => {
      for await (const _ of loop.run("首回合挂住")) void _;
    })();
    await new Promise((r) => setTimeout(r, 20));
    await loop.send("排队一");
    await loop.send("排队二");
    expect(loop.pending()).toHaveLength(2);
    expect(loop.paused()).toBe(false);
    await loop.interrupt();
    await consuming; // 中断收尾：冲刷守卫接住，不带走队列
    expect(loop.pending()).toHaveLength(2); // 冻结：条目留守
    expect(loop.paused()).toBe(true);
    expect(pauses).toContain(true);
    // 修复前此处会「生而为 abort」：排队条目落 user 行、零回复——现在账本里只有首回合的提问
    const userTexts = session
      .events()
      .filter((e) => e.type === "user/message")
      .map((e) => (e.data as { content: string }).content);
    expect(userTexts).toEqual(["首回合挂住"]);
    // resume：队头开新回合 + 回合末自动续冲第二条，两回复都落账
    let ends = 0;
    const chainDone = new Promise<void>((resolve) => {
      ctx.events.on("turn/end", () => {
        ends += 1;
        if (ends >= 2) resolve(); // resume 首回合 + 续冲回合
      });
    });
    expect(await loop.resume()).toBe(true);
    await chainDone;
    expect(loop.paused()).toBe(false);
    expect(loop.pending()).toHaveLength(0);
    const contents = session
      .events()
      .filter((e) => e.type === "assistant/message")
      .map((e) => (e.data as { content: string }).content);
    expect(contents).toContain("排队一回复"); // 有回复（对照修复前的零回复）
    expect(contents).toContain("排队二回复");
    await harness.dispose();
  });

  it("冻结期间 send 新消息 = 解冻开跑，该回合末队列照常自动续冲", async () => {
    const { harness, ctx, loop, session } = await startedLoop([
      "hang",
      [mockText("新消息回复"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("排队回复"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const consuming = (async () => {
      for await (const _ of loop.run("首回合挂住")) void _;
    })();
    await new Promise((r) => setTimeout(r, 20));
    await loop.send("排队的话");
    await loop.interrupt();
    await consuming;
    expect(loop.paused()).toBe(true);
    let ends = 0;
    const chainDone = new Promise<void>((resolve) => {
      ctx.events.on("turn/end", () => {
        ends += 1;
        if (ends >= 2) resolve(); // 新消息回合 + 续冲回合
      });
    });
    await loop.send("解冻的新消息"); // 闲时直开回合 = 重新上路
    expect(loop.paused()).toBe(false); // 解冻即时生效（横幅退场）
    await chainDone;
    expect(loop.pending()).toHaveLength(0); // 冻结条目在该回合末自动续冲
    const contents = session
      .events()
      .filter((e) => e.type === "assistant/message")
      .map((e) => (e.data as { content: string }).content);
    expect(contents).toContain("新消息回复");
    expect(contents).toContain("排队回复");
    await harness.dispose();
  });

  it("队列空时中断 = 不置冻结态；resume 无事可做返回 false", async () => {
    const { harness, loop } = await startedLoop(["hang"]);
    const consuming = (async () => {
      for await (const _ of loop.run("只此一回")) void _;
    })();
    await new Promise((r) => setTimeout(r, 20));
    await loop.interrupt();
    await consuming;
    expect(loop.pending()).toHaveLength(0);
    expect(loop.paused()).toBe(false); // 队列空：无冻结（横幅判据不会误亮）
    expect(await loop.resume()).toBe(false);
    await harness.dispose();
  });

  it("冻结态 promote = 直接发该条（无当前回合可停），回合末剩余条目自动续冲", async () => {
    const { harness, loop, session } = await startedLoop([
      "hang",
      [mockText("被提升条目回复"), mockUsage(USAGE), mockFinish("stop")],
      [mockText("留守条目回复"), mockUsage(USAGE), mockFinish("stop")],
    ]);
    const consuming = (async () => {
      for await (const _ of loop.run("首回合挂住")) void _;
    })();
    await new Promise((r) => setTimeout(r, 20));
    await loop.send("留守条目");
    const q2 = await loop.send("被提升条目");
    await loop.interrupt();
    await consuming;
    expect(loop.paused()).toBe(true);
    // 冻结中提升 q2：闲时 preempt = no-op，直接以该条开新回合
    expect(await loop.promote(q2.id)).toBe(true);
    expect(loop.paused()).toBe(false); // 解冻即时生效
    // 完成判据 = 两条回复都在场（提升回合 + 续冲回合；mock 秒完成，计数器注册有竞态）
    const getContents = () =>
      session
        .events()
        .filter((e) => e.type === "assistant/message")
        .map((e) => (e.data as { content: string }).content);
    while (!getContents().includes("被提升条目回复") || !getContents().includes("留守条目回复")) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(loop.pending()).toHaveLength(0);
    await harness.dispose();
  });
});
