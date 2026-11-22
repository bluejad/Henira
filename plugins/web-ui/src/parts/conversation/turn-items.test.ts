// R179：过程分组纯函数单测——「思考也算一项」、未知/MCP 边界、修改去重与路径未知。
// 这些规则是 R178 的核心修正，组件测试不直接触达，单独锁住。
import type { Row } from "@henira/protocol";
import { describe, expect, it } from "vitest";
import { buildProcessItems, buildTurnLayout } from "./turn-items.js";

let seq = 0;

function nextId(prefix: string): { rowId: string; rowSeq: number } {
  seq += 1;
  return { rowId: `${prefix}:${seq}`, rowSeq: seq };
}

function thinking(reasoning = "先想想"): Row {
  return {
    kind: "assistant",
    ...nextId("think"),
    turn: "t-1",
    step: 1,
    text: "",
    streaming: false,
    reasoning,
  };
}

function text(value: string): Row {
  return {
    kind: "assistant",
    ...nextId("a"),
    turn: "t-1",
    step: 1,
    text: value,
    streaming: false,
  };
}

function tool(name: string, input: Record<string, unknown> = {}): Row {
  return {
    kind: "tool",
    ...nextId("tool"),
    turn: "t-1",
    step: 1,
    callId: `c${seq}`,
    name,
    status: "done",
    input: JSON.stringify(input),
    output: { content: "", isError: false, durationMs: 1 },
  };
}

function user(value: string): Row {
  return { kind: "user", ...nextId("u"), turn: "t-1", text: value, source: "send" };
}

describe("buildProcessItems（过程分组）", () => {
  it("思考 + 单工具 = 两项成组（思考也算一项，不是只数工具）", () => {
    const items = buildProcessItems([thinking(), tool("read", { file_path: "a.ts" })]);
    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first?.kind).toBe("group");
    if (first?.kind === "group") {
      expect(first.rows).toHaveLength(2);
      expect(first.stats.explore).toBe(1);
    }
  });

  it("思考与工具交错进同一组；单独一项不折组", () => {
    const items = buildProcessItems([
      thinking(),
      tool("read", { file_path: "a.ts" }),
      thinking(),
      tool("bash", { command: "ls" }),
    ]);
    expect(items).toHaveLength(1);
    const first = items[0];
    if (first?.kind === "group") {
      expect(first.rows).toHaveLength(4);
      expect(first.stats.explore).toBe(1);
      expect(first.stats.run).toBe(1);
    } else {
      throw new Error("应为组");
    }

    const single = buildProcessItems([thinking(), text("正文")]);
    expect(single).toHaveLength(2);
    expect(single.every((item) => item.kind === "row")).toBe(true);
  });

  it("未知工具 / MCP 是边界：断组且各成一行", () => {
    for (const boundary of ["echo", "mcp__office__read_doc"]) {
      const items = buildProcessItems([
        tool("read", { file_path: "a.ts" }),
        tool(boundary),
        tool("read", { file_path: "b.ts" }),
      ]);
      expect(items.map((item) => item.kind)).toEqual(["row", "row", "row"]);
    }
  });

  it("修改按去重文件数统计；路径未知单列；files 保持首现顺序", () => {
    const items = buildProcessItems([
      thinking(),
      tool("edit", { file_path: "a.ts" }),
      tool("edit", { file_path: "a.ts" }),
      tool("write", { file_path: "b.ts" }),
      tool("edit", { content: "无路径" }),
    ]);
    const first = items[0];
    if (first?.kind !== "group") throw new Error("应为组");
    expect(first.stats.change).toBe(2);
    expect(first.stats.files).toEqual(["a.ts", "b.ts"]);
    expect(first.stats.unresolved).toBe(1);
  });

  it("纯空步级行剔除；中断行断组但保留", () => {
    const empty: Row = {
      kind: "assistant",
      ...nextId("empty"),
      turn: "t-1",
      step: 1,
      text: "",
      streaming: false,
    };
    const interrupted: Row = {
      kind: "assistant",
      ...nextId("stop"),
      turn: "t-1",
      step: 1,
      text: "",
      streaming: false,
      interrupted: true,
    };
    const items = buildProcessItems([
      thinking(),
      empty,
      tool("read", { file_path: "a.ts" }),
      interrupted,
      tool("read", { file_path: "b.ts" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["group", "row", "row"]);
    const last = items[2];
    if (last?.kind !== "row") throw new Error("应为行");
    expect(last.row.kind).toBe("tool");
  });
});

describe("buildTurnLayout（轮布局）", () => {
  it("完成轮：过程折出、最终回答留外、审批行不进官方流", () => {
    const rows: Row[] = [
      user("干活"),
      thinking(),
      tool("read", { file_path: "a.ts" }),
      text("完成"),
      {
        kind: "approval",
        rowId: "ap:1",
        rowSeq: 900,
        turn: "t-1",
        step: 1,
        requestId: "r1",
        toolName: "bash",
        status: "settled",
      },
    ];
    const layout = buildTurnLayout(rows);
    expect(layout.leading).toHaveLength(1);
    expect(layout.foldable).toBe(true);
    expect(layout.final?.kind).toBe("assistant");
    expect(layout.process).toHaveLength(1);
    expect(layout.process[0]?.kind).toBe("group");
  });

  it("无最终回答（运行中）不折叠：过程按原序展开", () => {
    const layout = buildTurnLayout([user("干活"), thinking(), tool("read", { file_path: "a.ts" })]);
    expect(layout.foldable).toBe(false);
    expect(layout.final).toBeUndefined();
    expect(layout.process).toHaveLength(1);
  });
});
