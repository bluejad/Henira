// plugin-ask-user 单测（R184）：工具 schema/唯一性闸、挂起→答复→账本对、取消三路（用户取消 /
// 交互缺席或抛错 / 回合 abort）、无开回合拒绝、答案归一（未知选项过滤、custom、跳过）。
// 集成全链（真 server + 真 UI）在 browser-e2e 与真 key 活体。

import { createHarness, type ServiceDefinition } from "@henira/kernel";
import {
  asHeniraContext,
  type InteractionAnswer,
  type InteractionRequest,
  QUESTION_CUSTOM_MAX,
  type QuestionSpec,
  type ToolContext,
  type ToolDefinition,
} from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { askUserPlugin, normalizeAnswers, parseQuestions } from "./index.js";

const QUESTIONS: QuestionSpec[] = [
  {
    id: "q1",
    question: "你更喜欢哪种方案？",
    header: "方案",
    options: [{ label: "甲", description: "快" }, { label: "乙" }],
  },
];

function sessionStub(): ServiceDefinition & {
  calls: { type: string; data: Record<string, unknown> }[];
  setOpenTurn(turn: string | undefined): void;
} {
  const calls: { type: string; data: Record<string, unknown> }[] = [];
  let openTurn: string | undefined;
  return {
    name: "session",
    calls,
    setOpenTurn(turn: string | undefined) {
      openTurn = turn;
    },
    start() {
      return {
        async append(input: { type: string; data: unknown }) {
          if (input.type.startsWith("question/") && openTurn === undefined) {
            throw new Error("requires an open turn");
          }
          calls.push({ type: input.type, data: input.data as Record<string, unknown> });
          return { ...input, seq: calls.length, time: 0 };
        },
      };
    },
  } as never;
}

function toolsStub(captured: { tool?: ToolDefinition }): ServiceDefinition {
  return {
    name: "tools",
    start() {
      return {
        register(tool: ToolDefinition) {
          captured.tool = tool;
        },
        isConcurrencySafe(name: string) {
          return name === "ask_user";
        },
      };
    },
  } as never;
}

type Scripted = InteractionAnswer | Error | ((req: InteractionRequest) => InteractionAnswer);
function interactionStub(script: Scripted[]): ServiceDefinition & {
  requests: InteractionRequest[];
} {
  const requests: InteractionRequest[] = [];
  return {
    name: "interaction",
    requests,
    start() {
      return {
        async ask(req: InteractionRequest): Promise<InteractionAnswer> {
          requests.push(req);
          const next = script.shift();
          const answer = typeof next === "function" ? next(req) : next;
          if (answer instanceof Error) throw answer;
          if (answer === undefined) throw new Error("no answerer present");
          return answer;
        },
        settle() {
          return false;
        },
        listPending() {
          return [];
        },
      };
    },
  } as never;
}

function toolCtx(signal: AbortSignal = new AbortController().signal): ToolContext {
  return {
    cwd: process.cwd(),
    signal,
    requestPermission: async () => "allowed-once",
    config: undefined as never,
  };
}

async function started(interaction: ServiceDefinition, openTurn = true) {
  const captured: { tool?: ToolDefinition } = {};
  const session = sessionStub();
  const harness = createHarness()
    .use(session)
    .use(toolsStub(captured))
    .use(interaction)
    .use(askUserPlugin());
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  if (openTurn) {
    session.setOpenTurn("t1");
    ctx.events.emit("turn/start", { turn: "t1" });
    ctx.events.emit("step/start", { turn: "t1", step: 1 });
  }
  const tool = captured.tool;
  if (tool === undefined) throw new Error("ask_user tool was not registered");
  return { harness, ctx, tool, session };
}

describe("parseQuestions", () => {
  it("正常题面通过并剔除未知字段", () => {
    const parsed = parseQuestions({ questions: QUESTIONS });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.questions[0]?.options).toHaveLength(2);
  });

  it("重复 id / 重复选项 / 超长 header / 选项数不合规一律拒绝", () => {
    expect(parseQuestions({ questions: [QUESTIONS[0], QUESTIONS[0]] })).toMatchObject({
      ok: false,
    });
    expect(
      parseQuestions({
        questions: [{ id: "a", question: "?", options: [{ label: "x" }, { label: "x" }] }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseQuestions({ questions: [{ id: "a", question: "?", header: "x".repeat(13) }] }),
    ).toMatchObject({ ok: false });
    expect(
      parseQuestions({ questions: [{ id: "a", question: "?", options: [{ label: "x" }] }] }),
    ).toMatchObject({ ok: false });
    expect(parseQuestions({ questions: [] })).toMatchObject({ ok: false });
  });
});

describe("normalizeAnswers", () => {
  it("按题对齐、过滤未知选项、保留 custom、缺项=跳过", () => {
    const answers = normalizeAnswers(
      [QUESTIONS[0] as QuestionSpec, { id: "q2", question: "补充？" }],
      [
        { id: "q1", selected: ["甲", "不存在的"], custom: "也可以丙" },
        { id: "ghost", selected: ["x"] },
      ],
    );
    expect(answers).toEqual([
      { id: "q1", selected: ["甲"], custom: "也可以丙" },
      { id: "q2", selected: [] },
    ]);
  });

  it("超长 custom 按码点截断到协议上限（R186 收尾；REST 已 400，直连路径兜底）", () => {
    const long = "甲".repeat(QUESTION_CUSTOM_MAX + 10);
    const [answer] = normalizeAnswers(
      [{ id: "q", question: "?" }],
      [{ id: "q", selected: [], custom: long }],
    );
    expect([...(answer?.custom ?? "")].length).toBe(QUESTION_CUSTOM_MAX);
  });
});

describe("ask_user 工具", () => {
  it("注册为并发安全工具（绕过审批默认链）", async () => {
    const { harness, tool } = await started(interactionStub([]));
    expect(tool.name).toBe("ask_user");
    expect(tool.isConcurrencySafe).toBe(true);
    await harness.dispose();
  });

  it("挂起→答复：账本 asked→settled(answered)，工具结果带答案与 meta", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "question",
        requestId: req.requestId,
        answers: [{ id: "q1", selected: ["乙"] }],
      }),
    ]);
    const { harness, tool, session } = await started(interaction);
    const result = await tool.execute({ questions: QUESTIONS }, toolCtx());
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("乙");
    expect(interaction.requests[0]).toMatchObject({ kind: "question", toolName: "ask_user" });
    expect(session.calls.map((c) => c.type)).toEqual(["question/asked", "question/settled"]);
    expect(session.calls[0]?.data).toMatchObject({ turn: "t1", step: 1 });
    expect(session.calls[1]?.data).toMatchObject({
      outcome: "answered",
      answers: [{ id: "q1", selected: ["乙"] }],
    });
    expect(result.__meta).toMatchObject({ kind: "ask_user" });
    await harness.dispose();
  });

  it("用户取消：settled(cancelled) + Error 结果（回合继续由 loop 负责）", async () => {
    const interaction = interactionStub([
      (req) => ({ kind: "question", requestId: req.requestId, cancelled: true }),
    ]);
    const { harness, tool, session } = await started(interaction);
    const result = await tool.execute({ questions: QUESTIONS }, toolCtx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("cancelled");
    expect(session.calls[1]?.data).toMatchObject({ outcome: "cancelled" });
    expect(result.__meta).toMatchObject({ cancelled: true });
    await harness.dispose();
  });

  it("交互服务抛错 / 缺席 → 取消收口（fail-closed）", async () => {
    const { harness, tool, session } = await started(interactionStub([new Error("boom")]));
    const result = await tool.execute({ questions: QUESTIONS }, toolCtx());
    expect(result.isError).toBe(true);
    expect(session.calls[1]?.data).toMatchObject({ outcome: "cancelled" });
    await harness.dispose();
  });

  it("回合已 abort → 即使答复到达也按取消收口", async () => {
    const controller = new AbortController();
    const interaction = interactionStub([
      (req) => ({
        kind: "question",
        requestId: req.requestId,
        answers: [{ id: "q1", selected: ["甲"] }],
      }),
    ]);
    const { harness, tool, session } = await started(interaction);
    controller.abort();
    const result = await tool.execute({ questions: QUESTIONS }, toolCtx(controller.signal));
    expect(result.isError).toBe(true);
    expect(session.calls[1]?.data).toMatchObject({ outcome: "cancelled" });
    await harness.dispose();
  });

  it("无打开回合：拒绝且不写账本", async () => {
    const { harness, tool, session } = await started(interactionStub([]), false);
    const result = await tool.execute({ questions: QUESTIONS }, toolCtx());
    expect(result.isError).toBe(true);
    expect(session.calls).toEqual([]);
    await harness.dispose();
  });
});
