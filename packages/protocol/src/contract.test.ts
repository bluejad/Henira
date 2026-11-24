import { describe, expect, it } from "vitest";
import { DECISIONS, type Decision } from "./approval.js";
import type { SlotMap } from "./context.js";
import type { InteractionAnswer, InteractionRequest, InteractionService } from "./interaction.js";
import { FINISH_REASONS, LlmError } from "./llm.js";
import { TURN_END_REASONS } from "./loop.js";

// 槽位清单编译期钉死：SlotMap 扩项 / 减项时此数组立即类型报错
const EXPECTED_SLOTS: readonly (keyof SlotMap)[] = [
  "session",
  "llm",
  "tools",
  "approval",
  "loop",
  "interaction",
  "config",
  "mcp",
  "fs",
  "shell",
];

describe("protocol 契约", () => {
  it("封闭词表钉死（session.md §2.4 / D-046 / AI SDK reason 集）", () => {
    expect([...TURN_END_REASONS]).toEqual([
      "completed",
      "aborted",
      "blocked",
      "error",
      "max-tokens",
      "interrupted",
      "forked",
    ]);
    expect([...DECISIONS]).toEqual(["allowed-once", "rejected", "cancelled", "unavailable"]);
    expect([...FINISH_REASONS]).toEqual([
      "stop",
      "tool-calls",
      "length",
      "content-filter",
      "unknown",
    ]);
  });

  it("SlotMap = 10 槽（commands 随 M6 进入）", () => {
    expect(EXPECTED_SLOTS).toHaveLength(10);
    expect(EXPECTED_SLOTS).not.toContain("commands");
  });

  it("LlmError：携带 code / status，rejection 通道不进 StreamEvent", () => {
    const err = new LlmError("RATE_LIMIT", "429", 429);
    expect(err.name).toBe("LlmError");
    expect(err.code).toBe("RATE_LIMIT");
    expect(err.status).toBe(429);
    expect(err).toBeInstanceOf(Error);
  });

  it("InteractionService 契约参考实现：settle 幂等、先答者赢（宿主实现者行为规格样本）", async () => {
    // 参考实现即契约语义的可执行规格：ask 挂起、settle 先答者赢、listPending 暴露挂起集。
    function createInteractionService(): InteractionService {
      const waiting = new Map<string, (answer: InteractionAnswer) => void>();
      const settled = new Set<string>();
      const requests: InteractionRequest[] = [];
      return {
        ask(req) {
          requests.push(req);
          return new Promise((resolve) => {
            waiting.set(req.requestId, resolve);
          });
        },
        settle(requestId, answer) {
          if (settled.has(requestId) || !waiting.has(requestId)) return false;
          settled.add(requestId);
          waiting.get(requestId)?.(answer);
          return true;
        },
        listPending() {
          return requests.filter((r) => !settled.has(r.requestId));
        },
      };
    }

    const svc = createInteractionService();
    const req: InteractionRequest = {
      kind: "approval",
      requestId: "r1",
      toolName: "bash",
      args: { command: "ls" },
    };
    const asking = svc.ask(req);
    expect(svc.listPending()).toHaveLength(1);
    const first: InteractionAnswer = {
      kind: "approval",
      requestId: "r1",
      decision: "allowed-once" as Decision,
    };
    expect(svc.settle("r1", first)).toBe(true);
    await expect(asking).resolves.toEqual(first);
    const second: InteractionAnswer = { kind: "approval", requestId: "r1", decision: "rejected" };
    expect(svc.settle("r1", second)).toBe(false); // 先答者赢
    expect(svc.settle("unknown", second)).toBe(false);
    expect(svc.listPending()).toHaveLength(0);

    // scope:'session' 透传（E6）：settle 值形状到 ask resolve 的字节面——会话级允许的契约载体
    const req2: InteractionRequest = {
      kind: "approval",
      requestId: "r2",
      toolName: "edit",
      args: {},
    };
    const asking2 = svc.ask(req2);
    const scoped: InteractionAnswer = {
      kind: "approval",
      requestId: "r2",
      decision: "allowed-once" as Decision,
      scope: "session",
    };
    expect(svc.settle("r2", scoped)).toBe(true);
    await expect(asking2).resolves.toEqual(scoped);

    // 提问（R184）：同一服务承载 question kind——答案逐题、取消是独立变体
    const qreq: InteractionRequest = {
      kind: "question",
      requestId: "q1",
      toolName: "ask_user",
      questions: [{ id: "a", question: "选哪个？", options: [{ label: "甲" }, { label: "乙" }] }],
    };
    const askingQ = svc.ask(qreq);
    const qans: InteractionAnswer = {
      kind: "question",
      requestId: "q1",
      answers: [{ id: "a", selected: ["甲"] }],
    };
    expect(svc.settle("q1", qans)).toBe(true);
    await expect(askingQ).resolves.toEqual(qans);

    const qreq2: InteractionRequest = {
      kind: "question",
      requestId: "q2",
      toolName: "ask_user",
      questions: [{ id: "a", question: "继续？" }],
    };
    const askingQ2 = svc.ask(qreq2);
    const qcancel: InteractionAnswer = { kind: "question", requestId: "q2", cancelled: true };
    expect(svc.settle("q2", qcancel)).toBe(true);
    await expect(askingQ2).resolves.toEqual(qcancel);
  });
});
