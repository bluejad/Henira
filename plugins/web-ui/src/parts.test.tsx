// @vitest-environment jsdom
// 官方件测试（jsdom）：locale 取字 / 交互回调 / 哑渲染。件纯呈现——数据经承重缝注入。

import type { ApprovalRow, Row, ServerFrame, SessionSummary } from "@henira/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "./locales/zh.js";
import { ApprovalCard } from "./parts/approval-card.js";
import { Composer } from "./parts/composer.js";
import { SessionList } from "./parts/session-list.js";
import type { HeniraClientLike, RowStoreLike, WebPartContext } from "./types.js";

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
    render(<SessionList {...ctx} />);
    const item = await screen.findByText("demo"); // cwd 尾段
    fireEvent.click(item);
    expect(selectSession).toHaveBeenCalledWith("s-1");
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
    // busy 形态
    const busyCtx = fixtureCtx({
      store: {
        getSession: () => ({ rows: [], state: { busy: true } }),
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
  it("pending 显示允许/拒绝；点击走 settleApproval", async () => {
    const ctx = fixtureCtx();
    const settle = vi.spyOn(ctx.client, "settleApproval");
    const row = {
      kind: "approval",
      rowId: "p:r-1",
      turn: "t-1",
      step: 1,
      requestId: "r-1",
      toolName: "demo-write",
      status: "pending",
    } as ApprovalRow;
    render(<ApprovalCard row={row} ctx={ctx} />);
    fireEvent.click(screen.getByText(t("approval.allow")));
    expect(settle).toHaveBeenCalledWith("s-1", "r-1", "allowed-once");
  });
});
