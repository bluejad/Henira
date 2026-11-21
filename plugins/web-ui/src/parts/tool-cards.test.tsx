// @vitest-environment jsdom
// per-tool 官方卡单测（E5）：meta 窄化校验（不过 → 通用卡回落，dsh「宁缺毋滥」）、
// 各卡渲染语义（终端分色/退出码徽章、diff ±N、read gutter+窗口注、grep 分组、MCP 拆名）。
// DisclosureRow 默认收起——断言展开体文本前先点开行头（openText helper）。

import type { ToolRow } from "@henira/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { zh } from "../locales/zh.js";
import type { WebPartContext } from "../types.js";
import {
  buildDiffRows,
  EditCard,
  GlobCard,
  GrepCard,
  McpCard,
  ReadCard,
  TerminalCard,
  WriteCard,
} from "./tool-cards.js";

afterEach(cleanup);

const t = (key: string): string => {
  const v = zh[key as keyof typeof zh];
  if (v === undefined) throw new Error(`missing locale key: ${key}`);
  return v;
};

const ctx = { t } as unknown as WebPartContext;

let seq = 0;
function toolRow(over: Partial<ToolRow>): ToolRow {
  seq += 1;
  return {
    kind: "tool",
    rowId: `t:t:1:c${seq}`,
    rowSeq: seq,
    turn: "t",
    step: 1,
    callId: `c${seq}`,
    name: "bash",
    status: "done",
    input: "{}",
    ...over,
  };
}

/** 渲染并展开全部收起行，返回全文文本（展开体 children 断言用） */
function renderCard(el: ReactNode): string {
  const view = render(el);
  for (const btn of [...view.container.querySelectorAll('button[aria-expanded="false"]')]) {
    fireEvent.click(btn);
  }
  return view.container.textContent ?? "";
}

/** 渲染不展开，返回收起态头行全文（R171 头行摘要断言用） */
function renderHead(el: ReactNode): string {
  const view = render(el);
  return view.container.textContent ?? "";
}

describe("头行摘要与耗时（R171）", () => {
  it("收起态即见命令摘要 + 中文标题；callId 不占版面、走 rowTitle 悬停", () => {
    const head = renderHead(
      <TerminalCard
        row={toolRow({
          input: JSON.stringify({ command: "pnpm vitest run --coverage" }),
          output: { content: "ok", durationMs: 4560, isError: false },
        })}
        ctx={ctx}
      />,
    );
    expect(head).toContain("终端"); // 中文标题
    expect(head).toContain("pnpm vitest run --coverage"); // 摘要收起态可见
    expect(head).toContain("4.6 秒"); // 耗时中文格式
    expect(head).not.toContain("#c"); // callId 不再渲染为可见文本
    const { container } = render(
      <TerminalCard
        row={toolRow({
          callId: "call_00_abc",
          input: JSON.stringify({ command: "pwd" }),
        })}
        ctx={ctx}
      />,
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("title")).toContain("bash"); // wire 名保真
    expect(btn?.getAttribute("title")).toContain("call_00_abc"); // callId 排障通道
  });

  it("摘要 80 字符截断；未知工具取首个字符串值兜底；无 args → 无摘要", () => {
    const long = "x".repeat(200);
    const truncated = renderHead(
      <TerminalCard row={toolRow({ input: JSON.stringify({ command: long }) })} ctx={ctx} />,
    );
    expect(truncated).toContain("…");
    const fallback = renderHead(
      <TerminalCard
        row={toolRow({ name: "custom_tool", input: JSON.stringify({ target: "some-path" }) })}
        ctx={ctx}
      />,
    );
    expect(fallback).toContain("custom_tool"); // 未知工具标题回落 wire 名
    expect(fallback).toContain("some-path");
    const empty = renderHead(<TerminalCard row={toolRow({ input: "{}" })} ctx={ctx} />);
    expect(empty).not.toContain("undefined");
  });
});

describe("buildDiffRows（jsdiff 包装）", () => {
  it("行级 diff：+/- 计数与行号窗口", () => {
    const r = buildDiffRows("alpha\nbeta\ngamma\ndelta", "alpha\nBETA\ngamma\ndelta");
    expect(r).not.toBeNull();
    expect(r?.added).toBe(1);
    expect(r?.removed).toBe(1);
    expect(r?.rows.some((row) => row.kind === "context")).toBe(true);
    expect(r?.rows.some((row) => row.kind === "add" && row.newLine === 2)).toBe(true);
    expect(r?.rows.some((row) => row.kind === "del" && row.oldLine === 2)).toBe(true);
  });

  it("多 hunk：行号按各自 hunk.oldStart/newStart 重置（审查 F2 回归）", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const mod = [...lines];
    mod[1] = "B2"; // 第 2 行改
    mod[16] = "B17"; // 第 17 行改——与第 2 行相距足够远 → 多 hunk
    const r = buildDiffRows(lines.join("\n"), mod.join("\n"));
    expect(r).not.toBeNull();
    // 不论 jsdiff 切几个 hunk，del 行号必须等于真实旧文件行号（拍平实现第二 hunk 会错）
    expect(r?.rows.filter((row) => row.kind === "del").map((d) => d.oldLine)).toEqual([2, 17]);
    expect(r?.rows.filter((row) => row.kind === "add").map((a) => a.newLine)).toEqual([2, 17]);
  });

  it("相同文本 = null；超 maxEditLength（v9 返回 undefined）= 自构整体替换", () => {
    expect(buildDiffRows("same", "same")).toBeNull();
    const r = buildDiffRows("x".repeat(5000), "y".repeat(5000));
    expect(r).not.toBeNull();
    expect(r?.added).toBe(1);
    expect(r?.removed).toBe(1);
    expect(r?.truncated).toBeUndefined(); // 两行，未触千行闸
  });

  it("自构整体替换超千行 → 截断（±N 计数仍算全量，审查 F6）", () => {
    // jsdiff 对字符串按行 token 跑 Myers：总编辑长度（删+增行数）2400 > maxEditLength
    // 2000 → 返回 undefined → 自构整体替换 fallback（千行闸截断）
    const bigOld = Array.from({ length: 1200 }, () => "xxxxx").join("\n");
    const bigNew = Array.from({ length: 1200 }, () => "yyyyy").join("\n");
    const r = buildDiffRows(bigOld, bigNew);
    expect(r?.truncated).toBe(true);
    expect(r?.rows.length).toBe(1000); // 500 del + 500 add
    expect(r?.added).toBe(1200); // 计数不截断
    expect(r?.removed).toBe(1200);
  });
});

describe("TerminalCard（终端卡）", () => {
  it("stdout 渲染 + stderr 分色段 + 非零退出徽章", () => {
    const text = renderCard(
      createElement(TerminalCard, {
        row: toolRow({
          name: "bash",
          input: JSON.stringify({ command: "echo hi" }),
          output: {
            content: "hi\n[stderr]\noops\n[exit code: 2]",
            isError: false,
            durationMs: 12,
            meta: { kind: "shell", exitCode: 2, stdout: "hi", stderr: "oops" },
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("echo hi");
    expect(text).toContain("hi");
    expect(text).toContain("stderr");
    expect(text).toContain("oops");
    expect(text).toContain("exit 2");
  });

  it("exitCode 0 无退出徽章 + 空输出注记；timedOut 徽章", () => {
    const ok = renderCard(
      createElement(TerminalCard, {
        row: toolRow({
          name: "bash",
          input: JSON.stringify({ command: "true" }),
          output: {
            content: "(no output; exit code 0)",
            isError: false,
            durationMs: 5,
            meta: { kind: "shell", exitCode: 0, stdout: "", stderr: "" },
          },
        }),
        ctx,
      }),
    );
    expect(ok).not.toContain("exit 0");
    expect(ok).toContain("（无输出）");

    const timed = renderCard(
      createElement(TerminalCard, {
        row: toolRow({
          name: "bash",
          input: JSON.stringify({ command: "sleep" }),
          output: {
            content: "[timed out after 600ms]",
            isError: false,
            durationMs: 600,
            meta: { kind: "shell", exitCode: null, stdout: "", stderr: "", timedOut: true },
          },
        }),
        ctx,
      }),
    );
    expect(timed).toContain("已超时");
  });

  it("stdout/stderr 流截断 → 「输出已截断」徽章（审查 F4）", () => {
    const text = renderCard(
      createElement(TerminalCard, {
        row: toolRow({
          name: "bash",
          input: JSON.stringify({ command: "big" }),
          output: {
            content: "...(truncated)",
            isError: false,
            durationMs: 1,
            meta: {
              kind: "shell",
              exitCode: 0,
              stdout: "tail only",
              stderr: "",
              stdoutTruncated: true,
            },
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("输出已截断");
    expect(text).toContain("tail only");
  });

  it("meta 缺（旧会话）→ content 原样；running 无 output → 通用卡回落", () => {
    const legacy = renderCard(
      createElement(TerminalCard, {
        row: toolRow({
          name: "bash",
          input: JSON.stringify({ command: "echo hi" }),
          output: { content: "hi\n[exit code: 2]", isError: false, durationMs: 12 },
        }),
        ctx,
      }),
    );
    expect(legacy).toContain("[exit code: 2]");

    const running = renderCard(
      createElement(TerminalCard, {
        row: toolRow({ name: "bash", status: "running", input: "not-json" }),
        ctx,
      }),
    );
    expect(running).toContain("终端"); // ToolView 兜底渲染中文标题
  });
});

describe("EditCard（diff 卡）", () => {
  const editRow = (over: Partial<ToolRow> = {}): ToolRow =>
    toolRow({
      name: "edit",
      input: JSON.stringify({
        file_path: "demo.txt",
        old_string: "alpha\nbeta",
        new_string: "alpha\nBETA",
      }),
      output: {
        content: "The file demo.txt has been updated successfully.",
        isError: false,
        durationMs: 7,
        meta: { kind: "edit", path: "demo.txt", replacements: 1 },
      },
      ...over,
    });

  it("±N 计数 + 文件路径 + 行内容", () => {
    const text = renderCard(createElement(EditCard, { row: editRow(), ctx }));
    expect(text).toContain("demo.txt");
    expect(text).toContain("+1");
    expect(text).toContain("-1");
    expect(text).toContain("beta");
    expect(text).toContain("BETA");
  });

  it("replacements > 1 → N 处替换徽章", () => {
    render(
      createElement(EditCard, {
        row: editRow({
          output: {
            content: "Replaced 3 occurrences in demo.txt.",
            isError: false,
            durationMs: 7,
            meta: { kind: "edit", path: "demo.txt", replacements: 3 },
          },
        }),
        ctx,
      }),
    );
    expect(screen.getByText("3 处替换")).toBeDefined();
  });

  it("input 缺 old_string → 通用卡回落（宁缺毋滥）", () => {
    const text = renderCard(
      createElement(EditCard, {
        row: toolRow({ name: "edit", input: "not-json", status: "running" }),
        ctx,
      }),
    );
    expect(text).toContain("编辑"); // ToolView 渲染中文标题
  });
});

describe("WriteCard（新建/覆盖卡）", () => {
  it("created → 新建徽章 + 全文 add 行；覆盖 → 覆盖徽章 + 中性 pre", () => {
    const created = renderCard(
      createElement(WriteCard, {
        row: toolRow({
          name: "write",
          input: JSON.stringify({ file_path: "new.txt", content: "hello\nworld" }),
          output: {
            content: "File created successfully at: new.txt",
            isError: false,
            durationMs: 3,
            meta: { kind: "write", path: "new.txt", created: true },
          },
        }),
        ctx,
      }),
    );
    expect(created).toContain("新建文件");
    expect(created).toContain("hello");
    expect(created).toContain("+");

    const overwrote = renderCard(
      createElement(WriteCard, {
        row: toolRow({
          name: "write",
          input: JSON.stringify({ file_path: "old.txt", content: "hi" }),
          output: {
            content: "updated",
            isError: false,
            durationMs: 3,
            meta: { kind: "write", path: "old.txt", created: false },
          },
        }),
        ctx,
      }),
    );
    expect(overwrote).toContain("覆盖文件");
    expect(overwrote).toContain("hi");
  });

  it("created 全文超千行 → 截断注记（审查 F6：行数闸防大文件挂满 DOM）", () => {
    const content = Array.from({ length: 1200 }, (_, i) => `L${i}`).join("\n");
    const text = renderCard(
      createElement(WriteCard, {
        row: toolRow({
          name: "write",
          input: JSON.stringify({ file_path: "big.txt", content }),
          output: {
            content: "created",
            isError: false,
            durationMs: 1,
            meta: { kind: "write", path: "big.txt", created: true },
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("差异过大，已截断显示");
  });
});

describe("ReadCard（读取卡）", () => {
  it("行号 gutter 拆分 + 窗口注 + 尾注分离", () => {
    const text = renderCard(
      createElement(ReadCard, {
        row: toolRow({
          name: "read",
          input: JSON.stringify({ file_path: "demo.txt" }),
          output: {
            content: "3\talpha\n4\tbeta\n(End of file — total 9 lines)",
            isError: false,
            durationMs: 2,
            meta: {
              kind: "read",
              path: "/ws/demo.txt",
              startLine: 3,
              endLine: 4,
              totalLines: 9,
            },
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("alpha");
    expect(text).toContain("3–4 / 9 行");
    expect(text).toContain("(End of file — total 9 lines)");
  });

  it("无 meta（旧会话）：`N\\t` 格式仍拆 gutter，尾注按「(」开头识别", () => {
    const text = renderCard(
      createElement(ReadCard, {
        row: toolRow({
          name: "read",
          input: JSON.stringify({ file_path: "demo.txt" }),
          output: {
            content: "1\thello\n2\tworld\n(Showing lines 1-2 of 2. Use offset=3 to continue.)",
            isError: false,
            durationMs: 2,
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("hello");
    expect(text).toContain("(Showing lines 1-2 of 2. Use offset=3 to continue.)");
    expect(text).not.toContain("行"); // 无 meta 无窗口注
  });
});

describe("GlobCard / GrepCard（搜索卡）", () => {
  it("glob：路径列表 + 截断计数 2/5", () => {
    const text = renderCard(
      createElement(GlobCard, {
        row: toolRow({
          name: "glob",
          input: JSON.stringify({ pattern: "*.txt" }),
          output: {
            content: "a.txt\nb.txt",
            isError: false,
            durationMs: 1,
            meta: { kind: "glob", files: ["a.txt", "b.txt"], total: 5 },
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("a.txt");
    expect(text).toContain("2/5");
  });

  it("grep content 模式：按文件分组（组头计数 + 上下文行在场）", () => {
    const text = renderCard(
      createElement(GrepCard, {
        row: toolRow({
          name: "grep",
          input: JSON.stringify({ pattern: "hit", output_mode: "content" }),
          output: {
            content: "a.ts-1-before\na.ts:2:hit",
            isError: false,
            durationMs: 1,
            meta: {
              kind: "grep",
              mode: "content",
              matches: [
                { file: "a.ts", line: 1, text: "before", match: false },
                { file: "a.ts", line: 2, text: "hit", match: true },
              ],
              totalSeen: 2,
            },
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("a.ts");
    expect(text).toContain("before");
    expect(text).toContain("hit");
    expect(text).toContain("2 处命中");
  });

  it("grep files 模式：文件列表；meta 缺 → 通用卡回落", () => {
    const files = renderCard(
      createElement(GrepCard, {
        row: toolRow({
          name: "grep",
          input: JSON.stringify({ pattern: "x" }),
          output: {
            content: "Found 1 file\na.txt",
            isError: false,
            durationMs: 1,
            meta: { kind: "grep", mode: "files_with_matches", files: ["a.txt"], totalSeen: 1 },
          },
        }),
        ctx,
      }),
    );
    expect(files).toContain("a.txt");

    const legacy = renderCard(
      createElement(GrepCard, {
        row: toolRow({
          name: "grep",
          input: "{}",
          output: { content: "Found 1 file\na.txt", isError: false, durationMs: 1 },
        }),
        ctx,
      }),
    );
    expect(legacy).toContain("搜内容"); // ToolView 渲染中文标题
  });
});

describe("McpCard（MCP 卡）", () => {
  it("meta 拆名：title=tool、summary=server；wire 名保底可见", () => {
    const text = renderCard(
      createElement(McpCard, {
        row: toolRow({
          name: "mcp__office__read_doc",
          input: JSON.stringify({ path: "x.docx" }),
          output: {
            content: '{"ok":true}',
            isError: false,
            durationMs: 9,
            meta: { kind: "mcp", server: "office", tool: "read_doc" },
          },
        }),
        ctx,
      }),
    );
    expect(text).toContain("read_doc");
    expect(text).toContain("office");
    expect(text).toContain("mcp__office__read_doc"); // wire 名保底可见
    expect(text).toContain("x.docx"); // 输入参数段
  });

  it("meta 缺（旧会话）：从 wire 名机械反拆", () => {
    const text = renderCard(
      createElement(McpCard, {
        row: toolRow({
          name: "mcp__fs__read_file",
          input: "{}",
          output: { content: "plain text", isError: false, durationMs: 1 },
        }),
        ctx,
      }),
    );
    expect(text).toContain("read_file");
    expect(text).toContain("fs");
    expect(text).toContain("plain text");
  });
});
