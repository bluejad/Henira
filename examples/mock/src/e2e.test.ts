// examples/mock 离线 e2e（roadmap M2 判据①⑦的离线半边）：
// mock LLM 确定性驱动完整回合 → 回合完成 + 会话文件可回放 + 一条审批拒绝路径。
// 真实模型 smoke = examples/real（env 门控，不进 CI）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { mockFinish, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import { readSessionFile } from "@henira/plugin-session";
import { describe, expect, it } from "vitest";
import { assembleMock, echoTool } from "./assemble.js";

const USAGE = { inputTokens: 12, outputTokens: 6 };

describe("examples/mock 离线 e2e", () => {
  it("判据①：mock LLM 驱动完整回合（工具调用 → 结果回灌 → 纯文本收尾），会话文件可回放", async () => {
    const script = [
      [
        mockToolCall("c1", "echo", '{"text":"hello from mock"}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [mockText("工具说：hello from mock"), mockUsage(USAGE), mockFinish("stop")],
    ];
    const { ctx, sessionDir, dispose } = await assembleMock({ script });
    const events: string[] = [];
    for await (const event of ctx.get("loop").run("帮我 echo 一下")) {
      events.push(event.type);
    }
    expect(events.at(-1)).toBe("turn-ended");
    expect(events).toContain("tool-started");
    expect(events).toContain("tool-finished");

    // P1：模型可见 ⟺ 已落日志——派生历史含 user / assistant / tool 结果
    const session = ctx.get("session");
    const derived = session.deriveMessages();
    expect(derived.some((m) => m.role === "user")).toBe(true);
    expect(derived.some((m) => m.role === "assistant")).toBe(true);
    expect(derived.some((m) => m.role === "tool")).toBe(true);

    // 会话文件可回放：从磁盘重读（header + 事件 + seq 连续校验）
    const file = path.join(sessionDir, "session.v1.jsonl");
    const raw = await fs.readFile(file, "utf8");
    expect(raw.split("\n").filter((l) => l.trim() !== "").length).toBeGreaterThan(5);
    const reread = await readSessionFile(file); // 从磁盘重读（路径入参；seq 连续 / 版本闸在 reader 内）
    expect(reread.events.at(-1)?.type).toBe("turn/end");

    // request/header 快照在场：任何请求可重建（P1 的字面事实）
    expect(session.events().some((e) => e.type === "request/header")).toBe(true);
    await dispose();
  });

  it("判据②（M4）：mock 会话跑完 fs+shell 工具流——write → read → edit → bash 全链", {
    timeout: 30_000,
  }, async () => {
    const script = [
      [
        mockToolCall("c1", "write", '{"file_path":"demo.txt","content":"line1\\nline2\\n"}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [
        mockToolCall("c2", "read", '{"file_path":"demo.txt"}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [
        mockToolCall(
          "c3",
          "edit",
          '{"file_path":"demo.txt","old_string":"line1","new_string":"LINE-1"}',
        ),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [
        mockToolCall("c4", "bash", '{"command":"node -e \\"console.log(2+2)\\""}'),
        mockUsage(USAGE),
        mockFinish("tool-calls"),
      ],
      [mockText("fs+shell 全链跑完"), mockUsage(USAGE), mockFinish("stop")],
    ];
    const { ctx, dispose } = await assembleMock({ script });
    const events: string[] = [];
    for await (const event of ctx.get("loop").run("读写改跑一遍")) {
      events.push(event.type);
    }
    expect(events.at(-1)).toBe("turn-ended");

    const events2 = ctx.get("session").events();
    const callName = new Map<string, string>();
    for (const e of events2) {
      if (e.type === "tool/call") {
        const d = e.data as { callId: string; name: string };
        callName.set(d.callId, d.name);
      }
    }
    const results = events2
      .filter((e) => e.type === "tool/result")
      .map((e) => {
        const d = e.data as { callId: string; content: string; isError?: boolean };
        return { name: callName.get(d.callId) ?? "", content: d.content, isError: d.isError };
      });
    const byName = (name: string) => results.filter((r) => r.name === name);
    expect(byName("write")).toHaveLength(1);
    expect(byName("write")[0]?.content).toContain("File created successfully");
    expect(byName("read")).toHaveLength(1);
    expect(byName("read")[0]?.content).toContain("1\tline1");
    expect(byName("edit")).toHaveLength(1);
    expect(byName("edit")[0]?.content).toContain("has been updated successfully");
    expect(byName("bash")).toHaveLength(1);
    expect(byName("bash")[0]?.content).toContain("4");
    for (const r of results) expect(r.isError).toBe(false);
    // 盘上事实：edit 已生效
    const session = ctx.get("session");
    const written = await fs.readFile(path.join(session.header().cwd, "demo.txt"), "utf8");
    expect(written).toContain("LINE-1");
    await dispose();
  });

  it("熔断件（D-058/D-065）：连续同形调用 → 提醒行 + 回合尾 veto 续跑一步（bail 缝首个生产消费者）", async () => {
    const sameCall = (id: string) => [
      mockToolCall(id, "echo", '{"text":"loop"}'),
      mockUsage(USAGE),
      mockFinish("tool-calls"),
    ];
    const script = [
      sameCall("c1"),
      sameCall("c2"),
      sameCall("c3"), // 第 3 次连续同形 → 提醒行
      [mockText("我觉得我完成了"), mockUsage(USAGE), mockFinish("stop")], // 回合尾 → veto
      [mockText("收到熔断提示，收尾"), mockUsage(USAGE), mockFinish("stop")], // resume 续跑的一步
    ];
    const { ctx, dispose } = await assembleMock({ script });
    for await (const _ of ctx.get("loop").run("死循环演练")) void _;

    const userRows = ctx
      .get("session")
      .events()
      .filter((e) => e.type === "user/message")
      .map((e) => e.data as { content: string; source: string });
    expect(
      userRows.some((r) => r.source === "breaker" && r.content.includes("Circuit breaker")),
    ).toBe(true);
    expect(userRows.some((r) => r.source === "veto" && r.content.includes("Circuit breaker"))).toBe(
      true,
    );
    const end = [...ctx.get("session").events()].reverse().find((e) => e.type === "turn/end");
    expect(end === undefined ? undefined : (end.data as { reason: string }).reason).toBe(
      "completed",
    );
    // resume 续跑的一步真的跑了：最终 assistant 行是收尾文本
    const assistant = ctx
      .get("session")
      .events()
      .filter((e) => e.type === "assistant/message")
      .map((e) => e.data as { content: string });
    expect(assistant.at(-1)?.content).toContain("收尾");
    await dispose();
  });

  it("拒绝路径：自动应答器 rejected → 工具不执行，tool/result 落拒绝错误，回合照常收尾", async () => {
    const script = [
      [mockToolCall("c1", "echo", '{"text":"x"}'), mockUsage(USAGE), mockFinish("tool-calls")],
      [mockText("好的，不执行了"), mockUsage(USAGE), mockFinish("stop")],
    ];
    const { ctx, dispose } = await assembleMock({
      script,
      tools: [{ ...echoTool, isConcurrencySafe: false }], // 非只读 → 不走默认放行层 → 问 answerer
      answers: ["rejected"],
    });
    for await (const _ of ctx.get("loop").run("试试被拒")) void _;
    const result = ctx
      .get("session")
      .events()
      .find((e) => e.type === "tool/result");
    const resultData =
      result === undefined ? undefined : (result.data as { isError: boolean; content: string });
    expect(resultData?.isError).toBe(true);
    expect(resultData?.content).toContain("[permission:rejected]");
    // 审计对落盘（asked + decided）
    const types = ctx
      .get("session")
      .events()
      .map((e) => e.type);
    expect(types).toContain("approval/asked");
    expect(types).toContain("approval/decided");
    const end = [...ctx.get("session").events()].reverse().find((e) => e.type === "turn/end");
    expect(end === undefined ? undefined : (end.data as { reason: string }).reason).toBe(
      "completed",
    );
    await dispose();
  });
});
