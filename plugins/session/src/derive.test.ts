import type { SessionEvent } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { deriveMessages } from "./index.js";

// 派生规则（session.md §4，纯函数直接钉——不依赖存储）。

let seq = 0;
function ev(type: string, data: unknown, ignorable?: boolean): SessionEvent {
  seq += 1;
  return { type, seq, time: 0, data, ...(ignorable !== undefined && { ignorable }) };
}
function reset(): void {
  seq = 0;
}

const userMsg = (content: string) =>
  ev("user/message", { turn: "t1", step: 0, content, source: "user" });
const sysMsg = (content: string, key?: string) =>
  ev("system/message", { turn: "t1", step: 0, content, ...(key && { key }) });
const asstMsg = (content: string, reasoning?: string) =>
  ev("assistant/message", {
    turn: "t1",
    step: 0,
    content,
    model: "mock",
    finishReason: "stop",
    ...(reasoning && { reasoning }),
  });
const call = (callId: string, name: string, args = "{}") =>
  ev("tool/call", { turn: "t1", step: 0, callId, name, arguments: args });
const result = (callId: string, content: string, isError = false) =>
  ev("tool/result", { turn: "t1", step: 0, callId, isError, content, durationMs: 1 });

describe("基本派生", () => {
  it("消息进、审批对与审计事件跳过、reasoning 不回灌", () => {
    reset();
    const events = [
      ev("turn/start", { turn: "t1" }),
      ev("step/start", { turn: "t1", step: 1 }),
      ev("request/header", {
        turn: "t1",
        step: 1,
        model: "m",
        params: {},
        toolNames: [],
        systemPromptHash: "h",
      }),
      userMsg("hi"),
      ev("approval/asked", {
        turn: "t1",
        step: 1,
        requestId: "r1",
        callId: "c1",
        tool: "bash",
        argsDigest: "{}",
      }),
      ev("approval/decided", { turn: "t1", step: 1, requestId: "r1", decision: "allowed-once" }),
      asstMsg("here is the answer", "internal reasoning"),
      call("c1", "fs_read", '{"path":"a.txt"}'),
      result("c1", "file content"),
      ev("assistant/attempt", { turn: "t1", step: 1, error: { code: "x", message: "y" } }),
      ev("step/end", { turn: "t1", step: 1, usage: { inputTokens: 1, outputTokens: 1 } }),
      ev("turn/end", { turn: "t1", reason: "completed" }),
    ];
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "here is the answer",
        toolCalls: [{ callId: "c1", name: "fs_read", arguments: '{"path":"a.txt"}' }],
      },
      { role: "tool", callId: "c1", name: "fs_read", content: "file content", isError: false },
    ]);
  });

  it("孤儿 tool/call（无 result）在派生时合成错误结果，紧跟 assistant（防 400）", () => {
    reset();
    const events = [userMsg("go"), asstMsg("calling"), call("c1", "bash", '{"cmd":"ls"}')];
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "calling",
        toolCalls: [{ callId: "c1", name: "bash", arguments: '{"cmd":"ls"}' }],
      },
      { role: "tool", callId: "c1", name: "bash", content: expect.any(String), isError: true },
    ]);
  });

  it("孤儿 result（无 call）不进模型历史", () => {
    reset();
    const events = [userMsg("go"), result("ghost", "??")];
    expect(deriveMessages(events)).toEqual([{ role: "user", content: "go" }]);
  });

  it("attachments 随 user 消息派生", () => {
    reset();
    const events = [
      ev("user/message", {
        turn: "t1",
        step: 0,
        content: "看这个",
        source: "user",
        attachments: [{ path: "attachments/1/a.png", mime: "image/png" }],
      }),
    ];
    expect(deriveMessages(events)).toEqual([
      {
        role: "user",
        content: "看这个",
        attachments: [{ path: "attachments/1/a.png", mime: "image/png" }],
      },
    ]);
  });
});

describe("key 去重（先于 surfaceOp）", () => {
  it("同名 key 只派生最新一条，候选留在自己的位置", () => {
    reset();
    const events = [
      sysMsg("old state", "tasks/state"), // 2
      userMsg("continue"), // 3
      sysMsg("new state", "tasks/state"), // 4
    ];
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "continue" },
      { role: "system", content: "new state" },
    ]);
  });

  it("无名 system/message 不参与去重，逐条保留", () => {
    reset();
    const events = [sysMsg("one"), sysMsg("two")];
    expect(deriveMessages(events)).toEqual([
      { role: "system", content: "one" },
      { role: "system", content: "two" },
    ]);
  });

  it("候选落在被替换区间内则随区间一起被替换，不复活", () => {
    reset();
    const events = [
      sysMsg("old", "tasks/state"), // 1
      userMsg("q"), // 2
      ev("system/message", {
        turn: "t1",
        step: 0,
        content: "summary",
        surfaceOp: { op: "replace", startSeq: 1, endSeq: 2 },
      }), // 3
    ];
    expect(deriveMessages(events)).toEqual([{ role: "system", content: "summary" }]);
  });
});

describe("surfaceOp replace", () => {
  it("区间内事件被替换为摘要消息（插在区间起点），区间外原样输出", () => {
    reset();
    const events = [
      userMsg("turn one"), // 1
      userMsg("turn two"), // 2
      userMsg("turn three"), // 3
      ev("system/message", {
        turn: "t1",
        step: 0,
        content: "digest of 1-2",
        surfaceOp: { op: "replace", startSeq: 1, endSeq: 2 },
      }), // 4
      userMsg("turn four"), // 5
    ];
    expect(deriveMessages(events)).toEqual([
      { role: "system", content: "digest of 1-2" },
      { role: "user", content: "turn three" },
      { role: "user", content: "turn four" },
    ]);
  });

  it("重叠记录在派生侧同样先写生效（与写入裁决一致的双保险）", () => {
    reset();
    const events = [
      userMsg("a"), // 1
      userMsg("b"), // 2
      ev("system/message", {
        turn: "t1",
        step: 0,
        content: "A",
        surfaceOp: { op: "replace", startSeq: 1, endSeq: 2 },
      }), // 3
      ev("system/message", {
        turn: "t1",
        step: 0,
        content: "B",
        surfaceOp: { op: "replace", startSeq: 2, endSeq: 3 },
      }), // 4
    ];
    expect(deriveMessages(events)).toEqual([{ role: "system", content: "A" }]);
  });
});

describe("ignorable 与未知域", () => {
  it("opaque 记录（ignorable:true）透明跳过", () => {
    reset();
    const events = [userMsg("hi"), ev("mypkg/metric", { any: "thing" }, true)];
    expect(deriveMessages(events)).toEqual([{ role: "user", content: "hi" }]);
  });
});
