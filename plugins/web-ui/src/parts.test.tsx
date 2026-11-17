// @vitest-environment jsdom
// 官方件测试（jsdom）：locale 取字 / 交互回调 / 哑渲染。件纯呈现——数据经承重缝注入。

import type { ApprovalRow, Row, ServerFrame, ToolRow } from "@henira/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "./locales/zh.js";
import { webUiModule } from "./module.js";
import { ApprovalCard, ApprovalSettledRow } from "./parts/approval-card.js";
import { Composer } from "./parts/composer.js";
import { Conversation } from "./parts/conversation.js";
import { SessionList } from "./parts/session-list.js";
import type {
  HeniraClientLike,
  RowStoreLike,
  SlotPart,
  WebPartContext,
  WebSlotName,
} from "./types.js";

const t = (key: string): string => {
  const value = (zh as Record<string, string>)[key];
  if (value === undefined) throw new Error(`missing locale key: ${key}`); // fail-loud（D-050）
  return value;
};

function fixtureCtx(overrides?: Partial<WebPartContext>): WebPartContext {
  const client: HeniraClientLike = {
    createSession: async () => ({ id: "s-1", cwd: "C:\\demo", updatedAt: 0, busy: false }),
    listSessions: async () => [
      { id: "s-1", cwd: "C:\\demo", updatedAt: 1, busy: true },
      { id: "s-2", cwd: "C:\\other", updatedAt: 2, busy: false },
    ],
    prompt: async () => ({ queued: false, id: null }),
    steer: async () => true,
    interrupt: async () => {},
    settleApproval: async () => true,
    events: async function* () {
      yield {} as ServerFrame;
    },
    listUiAssets: async () => ({ locales: [], themes: [] }),
  };
  const rows: Row[] = [];
  const store: RowStoreLike = {
    getSession: () => ({ rows, state: { busy: false } }),
    subscribe: () => () => {},
  };
  return {
    client,
    sessionId: "s-1",
    selectSession: vi.fn(),
    t,
    theme: "light",
    store,
    slots: new Map<string, readonly SlotPart[]>(),
    host: {
      sendPrompt: async () => ({ messageId: null, sessionId: "s-1" }),
      subscribe: () => () => {},
      onTurnFinished: () => () => {},
      prefill: () => {},
      renderMarkdown: (text) => text,
      getSession: () => ({ sessionId: "s-1", cwd: "C:\\demo" }),
      openInExplorer: async () => false,
      openPlugin: () => {},
      getInitialView: () => undefined,
      listDir: async () => [],
      listSessionsByCwd: async () => [],
      useResource: () => ({ status: "failed", error: "M4" }),
      listPlugins: async () => [],
    },
    ...overrides,
  };
}

afterEach(cleanup);

describe("SessionList", () => {
  it("列出会话（busy 点）+ 新会话按钮走 client.createSession", async () => {
    const ctx = fixtureCtx();
    const createSession = vi.spyOn(ctx.client, "createSession");
    render(<SessionList {...ctx} />);
    expect(screen.getByText(t("sessions.title"))).toBeDefined();
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(1));
    const newButton = screen.getByText(`+ ${t("sessions.new")}`);
    fireEvent.click(newButton);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("点会话条目 → selectSession 回调（承重缝）", async () => {
    const selectSession = vi.fn();
    const ctx = fixtureCtx({ selectSession });
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    const item = container.querySelector(".henira-sessions li button") as HTMLButtonElement;
    fireEvent.click(item);
    expect(selectSession).toHaveBeenCalledWith("s-1");
  });

  it("按 cwd 分组：组头=目录名+计数徽标；点组头折叠/展开（BC「目录」行为层）", async () => {
    const { container } = render(<SessionList {...fixtureCtx()} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    const headers = container.querySelectorAll("button.henira-session-group");
    expect(headers).toHaveLength(2); // demo / other 两组
    expect(container.querySelectorAll(".henira-session-count")).toHaveLength(2);
    // 折叠 demo 组 → 其子行消失；other 组子行仍在
    const demoHeader = headers[0] as HTMLButtonElement;
    expect(demoHeader.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(demoHeader);
    expect(demoHeader.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1); // 只剩 other 组的 s-2
    fireEvent.click(demoHeader);
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(2);
  });

  it("活跃会话所在组自动展开（选中即见其组）", async () => {
    const ctx = fixtureCtx();
    const { container, rerender } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    const headers = container.querySelectorAll("button.henira-session-group");
    fireEvent.click(headers[0] as HTMLButtonElement); // 手动折叠 demo 组
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1);
    rerender(<SessionList {...ctx} sessionId="s-2" />);
    // 选中 other 组会话——demo 组保持用户折叠（只自动展开活跃组所在组）
    await waitFor(() => {
      const demo = container.querySelector("button.henira-session-group") as HTMLButtonElement;
      expect(demo.getAttribute("aria-expanded")).toBe("false");
    });
    const other = container.querySelectorAll("button.henira-session-group")[1] as HTMLButtonElement;
    expect(other.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Composer", () => {
  it("Enter 发送走 client.prompt；busy 时显示停止", async () => {
    const ctx = fixtureCtx();
    const prompt = vi.spyOn(ctx.client, "prompt");
    const { container } = render(<Composer {...ctx} />);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "你好" } });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(prompt).toHaveBeenCalledWith("s-1", "你好");
    // busy 形态（store 契约=rows 引用稳定：快照提出闭包，getSnapshot 每次新对象会让 useSyncExternalStore 死循环）
    const busyRows: Row[] = [];
    const busyCtx = fixtureCtx({
      store: {
        getSession: () => ({ rows: busyRows, state: { busy: true } }),
        subscribe: () => () => {},
      },
    });
    cleanup();
    render(<Composer {...busyCtx} />);
    expect(screen.getByText(t("composer.stop"))).toBeDefined();
    expect(screen.getByText(t("composer.steerHint"))).toBeDefined();
  });
});

describe("ApprovalCard", () => {
  const pendingRow = {
    kind: "approval",
    rowId: "p:r-1",
    turn: "t-1",
    step: 1,
    requestId: "r-1",
    toolName: "demo-write",
    status: "pending",
  } as ApprovalRow;

  it("pending 显示允许/拒绝；点击走 settleApproval", async () => {
    const ctx = fixtureCtx();
    const settle = vi.spyOn(ctx.client, "settleApproval");
    render(<ApprovalCard row={pendingRow} ctx={ctx} />);
    fireEvent.click(screen.getByText(t("approval.allow")));
    expect(settle).toHaveBeenCalledWith("s-1", "r-1", "allowed-once");
  });

  it("pending 审批接管 composer dock：卡渲染于输入卡上方，Enter 让位不发送", () => {
    const approvalRows: Row[] = [pendingRow];
    const ctx = fixtureCtx({
      store: {
        getSession: () => ({ rows: approvalRows, state: { busy: false } }),
        subscribe: () => () => {},
      },
    });
    const prompt = vi.spyOn(ctx.client, "prompt");
    const { container } = render(<Composer {...ctx} />);
    expect(screen.getByRole("dialog", { name: t("approval.title") })).toBeDefined();
    fireEvent.keyDown(container.querySelector("textarea") as HTMLTextAreaElement, { key: "Enter" });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("settled 行走 ApprovalSettledRow：决策原文在场", () => {
    const ctx = fixtureCtx();
    render(
      <ApprovalSettledRow
        row={{ ...pendingRow, status: "settled", decision: "rejected" }}
        ctx={ctx}
      />,
    );
    expect(screen.getByText("rejected")).toBeDefined();
  });
});

describe("行级挂载点（D-057）", () => {
  const toolRow: Row = {
    kind: "tool",
    rowId: "t:t-1:1:c1",
    turn: "t-1",
    step: 1,
    callId: "c1",
    name: "read",
    status: "done",
    input: "{}",
    output: { content: "file body", isError: false, durationMs: 3 },
  };

  function ctxWithRows(rows: Row[], slots: Map<string, readonly SlotPart[]>): WebPartContext {
    const snapshot = { rows, state: { busy: false } }; // 引用稳定——useSyncExternalStore 语义
    return fixtureCtx({
      store: {
        getSession: () => snapshot,
        subscribe: () => () => {},
      },
      slots,
    });
  }

  it("keyed 槽 tool.call.view.<工具名> 顶替官方工具卡（ToolCallView 拿得到行）", () => {
    const slots = new Map<string, readonly SlotPart[]>([
      [
        "tool.call.view.read",
        [
          ({ row }: { ctx: WebPartContext; row: ToolRow }) =>
            `自定义工具卡:${row.name}:${row.status}:${row.output?.content ?? ""}`,
        ],
      ],
    ]);
    render(<Conversation {...ctxWithRows([toolRow], slots)} />);
    expect(screen.getByText("自定义工具卡:read:done:file body")).toBeDefined();
    expect(screen.queryByText("read")).toBeNull(); // 官方工具卡被顶替
  });

  it("keyed 槽缺席 → 回落官方默认工具卡（卸载即回落同一语义）", () => {
    render(<Conversation {...ctxWithRows([toolRow], new Map())} />);
    expect(screen.getByText("read")).toBeDefined(); // 官方卡渲染工具名
  });

  it("turn.tail 追加位：行列表之后渲染全部件（官方无默认件）", () => {
    const slots = new Map<string, readonly SlotPart[]>([
      ["turn.tail", [() => "回合尾追加块甲", () => "回合尾追加块乙"]],
    ]);
    const { container } = render(<Conversation {...ctxWithRows([], slots)} />);
    // 件可返回裸字符串（纯呈现函数）——按容器文本断言
    expect(container.textContent).toContain("回合尾追加块甲");
    expect(container.textContent).toContain("回合尾追加块乙");
  });

  it("conversation.images 槽在场即渲染画廊位（缺席默认 = markdown 内联图，无附加块）", () => {
    const slots = new Map<string, readonly SlotPart[]>([
      ["conversation.images", [() => "画廊位在场"]],
    ]);
    const assistantRow: Row = {
      kind: "assistant",
      rowId: "a:t-1:1",
      turn: "t-1",
      step: 1,
      text: "看图",
      streaming: false,
    };
    render(<Conversation {...ctxWithRows([assistantRow], slots)} />);
    expect(screen.getByText("画廊位在场")).toBeDefined();
  });

  it("官方模块只注册区域槽（无 keyed 项——安全模式编译期出口无 keyed 缝 = 收起的结构保证）", () => {
    const registered: string[] = [];
    const host = fixtureCtx().host;
    webUiModule({
      registerSlot: (name) => {
        registered.push(name);
        return () => {};
      },
      replaceSlot: () => () => {},
      host,
    });
    expect([...registered].sort()).toEqual(["composer", "conversation", "sidebar"]);
    expect(
      registered.every((n) =>
        (["sidebar", "conversation", "composer"] as WebSlotName[]).includes(n as WebSlotName),
      ),
    ).toBe(true);
  });
});
