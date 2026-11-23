// @vitest-environment jsdom
// per-tool 官方卡单测（R178）：行语义 = 类别词 + 主信息 + 失败状态词；read/search 静态行；
// 结果卡参数键值化（扁平对象无花括号）、MCP 结果优先、终端命令/输出上限、diff 240 上限。
// ToolRow 默认收起——断言展开体前先点角色按钮（openCards helper）。

import type { ToolRow } from "@henira/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  ToolView,
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

/** 渲染并展开全部可展开行，返回全文文本 */
function renderCard(el: ReactNode): string {
  const view = render(el);
  for (const btn of [
    ...view.container.querySelectorAll('[role="button"][aria-expanded="false"]'),
  ]) {
    fireEvent.click(btn);
  }
  return view.container.textContent ?? "";
}

/** 渲染不展开，返回收起态头行全文 */
function renderHead(el: ReactNode): string {
  const view = render(el);
  return view.container.textContent ?? "";
}

function clickFirstToggle(container: HTMLElement): void {
  const trigger = container.querySelector('[role="button"]');
  if (trigger === null) throw new Error("missing tool row toggle");
  fireEvent.click(trigger);
}

describe("行语义（R178）", () => {
  it("终端：类别词 + 命令；不显示单次耗时/退出码胶囊；callId 走 title", () => {
    const view = render(
      <TerminalCard
        row={toolRow({
          input: JSON.stringify({ command: "pnpm vitest run --coverage" }),
          output: { content: "ok", durationMs: 4560, isError: false },
        })}
        ctx={ctx}
      />,
    );
    const head = view.container.textContent ?? "";
    expect(head).toContain("已执行");
    expect(head).toContain("pnpm vitest run --coverage");
    expect(head).not.toContain("4.6 秒");
    const trigger = view.container.querySelector(".henira-row-trigger");
    expect(trigger?.getAttribute("title")).toContain("bash");
    expect(trigger?.getAttribute("title")).toContain("c");
  });

  it("失败才有状态词；成功行不出现「执行失败」", () => {
    const ok = renderHead(<TerminalCard row={toolRow({ input: '{"command":"pwd"}' })} ctx={ctx} />);
    expect(ok).not.toContain("执行失败");
    const bad = renderHead(
      <TerminalCard
        row={toolRow({
          input: '{"command":"false"}',
          output: {
            content: "boom",
            isError: true,
            durationMs: 1,
            meta: { kind: "shell", exitCode: 2, stdout: "", stderr: "boom" },
          },
        })}
        ctx={ctx}
      />,
    );
    expect(bad).toContain("执行失败");
  });

  it("错误不自动展开；展开状态按 callId 记忆（虚拟列表重挂不丢）", () => {
    const row = toolRow({
      callId: "remember",
      input: '{"command":"echo"}',
      output: {
        content: "OUTPUT_TOKEN",
        isError: false,
        durationMs: 1,
        meta: { kind: "shell", exitCode: 0, stdout: "OUTPUT_TOKEN", stderr: "" },
      },
    });
    const first = render(<TerminalCard row={row} ctx={ctx} />);
    expect(first.container.textContent).not.toContain("OUTPUT_TOKEN");
    clickFirstToggle(first.container);
    expect(first.container.textContent).toContain("OUTPUT_TOKEN");
    first.unmount();
    const second = render(<TerminalCard row={row} ctx={ctx} />);
    expect(second.container.textContent).toContain("OUTPUT_TOKEN");
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
    mod[1] = "B2";
    mod[16] = "B17";
    const r = buildDiffRows(lines.join("\n"), mod.join("\n"));
    expect(r).not.toBeNull();
    expect(r?.rows.filter((row) => row.kind === "del").map((d) => d.oldLine)).toEqual([2, 17]);
    expect(r?.rows.filter((row) => row.kind === "add").map((a) => a.newLine)).toEqual([2, 17]);
  });

  it("相同文本 = null；超 maxEditLength（v9 返回 undefined）= 自构整体替换", () => {
    expect(buildDiffRows("same", "same")).toBeNull();
    const r = buildDiffRows("x".repeat(5000), "y".repeat(5000));
    expect(r).not.toBeNull();
    expect(r?.added).toBe(1);
    expect(r?.removed).toBe(1);
    expect(r?.truncated).toBeUndefined();
  });

  it("自构整体替换超千行 → 截断（±N 计数仍算全量，审查 F6）", () => {
    const bigOld = Array.from({ length: 1200 }, () => "xxxxx").join("\n");
    const bigNew = Array.from({ length: 1200 }, () => "yyyyy").join("\n");
    const r = buildDiffRows(bigOld, bigNew);
    expect(r?.truncated).toBe(true);
    expect(r?.rows.length).toBe(1000);
    expect(r?.added).toBe(1200);
    expect(r?.removed).toBe(1200);
  });
});

describe("TerminalCard（终端卡）", () => {
  it("stdout/stderr 合并输出 + 命令区；失败状态带原因 title", () => {
    const view = render(
      <TerminalCard
        row={toolRow({
          name: "bash",
          input: JSON.stringify({ command: "echo hi" }),
          output: {
            content: "hi\noops",
            isError: false,
            durationMs: 12,
            meta: { kind: "shell", exitCode: 2, stdout: "hi", stderr: "oops" },
          },
        })}
        ctx={ctx}
      />,
    );
    const text = renderCard(
      <TerminalCard
        row={toolRow({
          name: "bash",
          input: JSON.stringify({ command: "echo hi" }),
          output: {
            content: "hi\noops",
            isError: false,
            durationMs: 12,
            meta: { kind: "shell", exitCode: 2, stdout: "hi", stderr: "oops" },
          },
        })}
        ctx={ctx}
      />,
    );
    expect(text).toContain("echo hi");
    expect(text).toContain("hi");
    expect(text).toContain("oops");
    expect(text).not.toContain("exit 2");
    const status = view.container.querySelector(".henira-row-status");
    expect(status?.textContent).toBe("执行失败");
    expect(status?.getAttribute("title")).toBe("oops");
  });

  it("exitCode 0 无失败状态 + 空输出注记；timedOut 状态原因", () => {
    const ok = renderCard(
      <TerminalCard
        row={toolRow({
          input: JSON.stringify({ command: "true" }),
          output: {
            content: "(no output; exit code 0)",
            isError: false,
            durationMs: 5,
            meta: { kind: "shell", exitCode: 0, stdout: "", stderr: "" },
          },
        })}
        ctx={ctx}
      />,
    );
    expect(ok).not.toContain("执行失败");
    expect(ok).not.toContain("exit 0");
    expect(ok).toContain("没有输出。");

    const timed = render(
      <TerminalCard
        row={toolRow({
          input: JSON.stringify({ command: "sleep" }),
          output: {
            content: "[timed out after 600ms]",
            isError: false,
            durationMs: 600,
            meta: { kind: "shell", exitCode: null, stdout: "", stderr: "", timedOut: true },
          },
        })}
        ctx={ctx}
      />,
    );
    expect(timed.container.querySelector(".henira-row-status")?.getAttribute("title")).toBe(
      "已超时",
    );
  });

  it("meta 缺（旧会话）→ content 原样；running 无 output → 通用卡回落", () => {
    const legacy = renderCard(
      <TerminalCard
        row={toolRow({
          input: JSON.stringify({ command: "echo hi" }),
          output: { content: "hi\n[exit code: 2]", isError: false, durationMs: 12 },
        })}
        ctx={ctx}
      />,
    );
    expect(legacy).toContain("[exit code: 2]");

    const running = renderCard(
      <TerminalCard row={toolRow({ status: "running", input: "not-json" })} ctx={ctx} />,
    );
    expect(running).toContain("Bash");
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

  it("±N 计数 + 文件名 + diff 行；不显示耗时/替换数徽章", () => {
    const text = renderCard(createElement(EditCard, { row: editRow(), ctx }));
    expect(text).toContain("已编辑");
    expect(text).toContain("demo.txt");
    expect(text).toContain("+1");
    expect(text).toContain("-1");
    expect(text).toContain("beta");
    expect(text).toContain("BETA");
    expect(text).not.toContain("0.0 秒");
  });

  it("old === new → 仍走 edit 行（已编辑 + 无变更），不回落通用参数卡（R179）", () => {
    const text = renderCard(
      createElement(EditCard, {
        row: editRow({
          input: JSON.stringify({
            file_path: "demo.txt",
            old_string: "same",
            new_string: "same",
          }),
        }),
        ctx,
      }),
    );
    expect(text).toContain(t("tool.kind.edited"));
    expect(text).toContain("demo.txt");
    expect(text).toContain(t("tool.noChanges"));
    expect(text).not.toContain(t("tool.params"));
  });

  it("diff 高亮（R188）：展开才 token 化（R189 懒加载）→ 差异行按 token 着色", async () => {
    let calls = 0;
    const tokenizeCode = async (code: string) => {
      calls += 1;
      const tail = code.includes("2;") ? " = 2;" : " = 1;";
      return [
        [
          { content: "const", color: "red" },
          { content: " x", color: undefined },
          { content: tail, color: undefined },
        ],
      ];
    };
    const hlCtx = { t, host: { tokenizeCode } } as unknown as WebPartContext;
    const view = render(
      createElement(EditCard, {
        row: editRow({
          input: JSON.stringify({
            file_path: "demo.ts",
            old_string: "const x = 1;",
            new_string: "const x = 2;",
          }),
        }),
        ctx: hlCtx,
      }),
    );
    expect(calls).toBe(0); // 收起态不 token 化
    fireEvent.click(
      view.container.querySelector('[role="button"][aria-expanded="false"]') as HTMLElement,
    );
    await waitFor(() => {
      expect(view.container.querySelector('.henira-diff-text span[style*="color"]')).not.toBeNull();
    });
    expect(calls).toBeGreaterThan(0);
  });

  it("无变更卡不触发 tokenize（R189：diff 体不存在，token 化随展开体挂载）", () => {
    let calls = 0;
    const tokenizeCode = async () => {
      calls += 1;
      return [[{ content: "x" }]];
    };
    const lazyCtx = { t, host: { tokenizeCode } } as unknown as WebPartContext;
    render(
      createElement(EditCard, {
        row: editRow({
          input: JSON.stringify({ file_path: "demo.ts", old_string: "same", new_string: "same" }),
        }),
        ctx: lazyCtx,
      }),
    );
    expect(calls).toBe(0);
  });

  it("replacements > 1 不再上摘要（差异由 diff 本身表达）", () => {
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
    expect(screen.queryByText("3 处替换")).toBeNull();
  });

  it("input 缺 old_string → 通用卡回落（宁缺毋滥）", () => {
    const text = renderCard(
      createElement(EditCard, {
        row: toolRow({ name: "edit", input: "not-json", status: "running" }),
        ctx,
      }),
    );
    expect(text).toContain("Edit");
  });
});

describe("WriteCard（写入卡）", () => {
  it("created → 已写入 + 全文 add 行；覆盖 → 已更新 + 中性 pre；无新建/覆盖徽章", () => {
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
    expect(created).toContain("已写入");
    expect(created).toContain("new.txt");
    expect(created).toContain("hello");
    expect(created).toContain("+2");
    expect(created).not.toContain("新建文件");

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
    expect(overwrote).toContain("已更新");
    expect(overwrote).toContain("hi");
    expect(overwrote).not.toContain("覆盖文件");
  });

  it("created 全文超千行 → 截断注记", () => {
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
  it("静态一行：已读取 + 文件名；无范围/耗时；文件名点开弹窗看内容", () => {
    const view = render(
      createElement(ReadCard, {
        row: toolRow({
          name: "read",
          input: JSON.stringify({ file_path: "demo.txt" }),
          output: {
            content: "3\talpha\n4\tbeta",
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
    const head = view.container.textContent ?? "";
    expect(head).toContain("已读取");
    expect(head).toContain("demo.txt");
    expect(head).not.toContain("3–4 / 9 行");
    expect(head).not.toContain("秒");
    expect(head).not.toContain("alpha");
    // 行本身不可展开（不是 aria-expanded 按钮）
    expect(view.container.querySelector("[aria-expanded]")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "demo.txt" }));
    const dialog = document.body.textContent ?? "";
    expect(dialog).toContain("alpha");
    expect(dialog).toContain("beta");
    expect(dialog).not.toContain("3–4 / 9 行");
  });

  it("无 meta（旧会话）：文件名仍可开弹窗看原始内容", () => {
    const view = render(
      createElement(ReadCard, {
        row: toolRow({
          name: "read",
          input: JSON.stringify({ file_path: "demo.txt" }),
          output: {
            content: "1\thello\n2\tworld",
            isError: false,
            durationMs: 2,
          },
        }),
        ctx,
      }),
    );
    const head = view.container.textContent ?? "";
    expect(head).not.toContain("秒");
    fireEvent.click(view.getByRole("button", { name: "demo.txt" }));
    expect(document.body.textContent).toContain("hello");
  });
});

describe("GlobCard / GrepCard（搜索卡）", () => {
  it("glob：一行「已搜索 查找 pattern」，不展开结果列表/计数", () => {
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
    expect(text).toContain("已搜索");
    expect(text).toContain("查找 *.txt");
    expect(text).not.toContain("a.txt");
    expect(text).not.toContain("2/5");
  });

  it("grep：一行「已搜索 查找 query」；不展开命中/文件 chip", () => {
    const view = render(
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
              matches: [{ file: "a.ts", line: 2, text: "hit", match: true }],
              totalSeen: 2,
            },
          },
        }),
        ctx,
      }),
    );
    const head = view.container.textContent ?? "";
    expect(head).toContain("已搜索");
    expect(head).toContain("查找 hit");
    expect(head).not.toContain("a.ts");
    expect(head).not.toContain("处命中");
    expect(view.container.querySelector("[aria-expanded]")).toBeNull();
  });

  it("meta 缺（旧会话）→ 同一静态行，不回落通用卡", () => {
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
    expect(legacy).toContain("已搜索");
    expect(legacy).toContain("查找");
    expect(legacy).not.toContain("搜内容");
  });
});

describe("McpCard（MCP 卡）", () => {
  it("MCP + server + 工具名；结果优先，参数收进「调用详情」", () => {
    const view = render(
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
    clickFirstToggle(view.container);
    const text = view.container.textContent ?? "";
    expect(text).toContain("MCP");
    expect(text).toContain("office");
    expect(text).toContain("Read Doc");
    expect(text).not.toContain("mcp__office__read_doc");
    expect(text).toContain("ok");
    const details = view.container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("x.docx");
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
    expect(text).toContain("MCP");
    expect(text).toContain("fs");
    expect(text).toContain("Read File");
    expect(text).toContain("plain text");
  });
});

describe("ToolView（通用卡）", () => {
  it("扁平参数 = 键值表，不露花括号；结果文本直出", () => {
    const text = renderCard(
      createElement(ToolView, {
        row: toolRow({
          name: "custom_tool",
          input: JSON.stringify({ target: "some-path", count: 2 }),
          output: { content: "done", isError: false, durationMs: 1 },
        }),
        ctx,
      }),
    );
    expect(text).toContain("Custom Tool");
    expect(text).toContain("target");
    expect(text).toContain("some-path");
    expect(text).toContain("count");
    expect(text).not.toContain("{");
    expect(text).toContain("done");
  });

  it("嵌套参数才用 JSON 代码块；失败状态词在场", () => {
    const view = render(
      createElement(ToolView, {
        row: toolRow({
          name: "custom_tool",
          input: JSON.stringify({ nested: { a: 1 } }),
          status: "error",
          output: { content: "bad", isError: true, durationMs: 1 },
        }),
        ctx,
      }),
    );
    clickFirstToggle(view.container);
    expect(view.container.textContent).toContain("nested");
    expect(view.container.textContent).toContain("bad");
    expect(view.container.textContent).toContain("执行失败");
  });
});
