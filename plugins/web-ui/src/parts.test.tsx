// @vitest-environment jsdom
// 官方件测试（jsdom）：locale 取字 / 交互回调 / 哑渲染。件纯呈现——数据经承重缝注入。

import type {
  ApprovalRow,
  AssistantRow,
  QuestionRow,
  Row,
  ServerFrame,
  SessionSummary,
  ToolRow,
} from "@henira/protocol";
import { QUESTION_CUSTOM_MAX } from "@henira/protocol";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineChainEntry } from "./chain.js";
import { zh } from "./locales/zh.js";
import { defaultToolViews, webUiModule } from "./module.js";
import { ApprovalCard, ApprovalQueueCard, ApprovalSettledRow } from "./parts/approval-card.js";
import { Composer } from "./parts/composer.js";
import {
  approvalTakeover,
  ComposerDock,
  pruneAnswered,
  questionTakeover,
} from "./parts/composer-dock.js";
import { Conversation } from "./parts/conversation.js";
import { HeniraSelect } from "./parts/dropdown.js";
import { LayoutFrame } from "./parts/layout-frame.js";
import { ModelSeat } from "./parts/model-seat.js";
import { ModelSelect } from "./parts/model-select.js";
import { QuestionCard } from "./parts/question-card.js";
import { QueueDock } from "./parts/queue-dock.js";
import { QueuePanel } from "./parts/queue-panel.js";
import { RightPanel } from "./parts/right-panel.js";
import { SessionList } from "./parts/session-list.js";
import { SettingsModal } from "./parts/settings-modal.js";
import { AskUserCard, McpCard, ReadCard } from "./parts/tool-cards.js";
import type {
  HeniraClientLike,
  RowStoreLike,
  SlotPart,
  WebPart,
  WebPartContext,
  WebSlotName,
} from "./types.js";

const t = (key: string): string => {
  const value = (zh as Record<string, string>)[key];
  if (value === undefined) throw new Error(`missing locale key: ${key}`); // fail-loud（D-050）
  return value;
};

/** R182 chain 通用性测试件（模块级：组件不随 render 重建） */
function DemoTakeover({
  matched,
}: {
  ctx: WebPartContext;
  matched: { key: string; label: string };
  owner: unknown;
}) {
  return <div data-testid="demo-takeover">{matched.label}</div>;
}

/** R183 左席探针：经 ComposerApi 写草稿 + 聚焦（座位件不私存状态） */
function LeftSeatProbe(props: WebPartContext) {
  const api = props.composer;
  return (
    <button
      type="button"
      onClick={() => {
        api?.setDraft("左席插入");
        api?.focus();
      }}
    >
      左席
    </button>
  );
}

/** R183 右席探针：读 busy、经 API 发送 */
function RightSeatProbe(props: WebPartContext) {
  const api = props.composer;
  return (
    <button type="button" onClick={() => api?.submit("右席发送")}>
      {api?.busy === true ? "忙" : "闲"}
    </button>
  );
}

/** R183 模型席顶替件：显示绑定、点击写绑定（same ComposerApi） */
function ModelSeatProbe(props: WebPartContext) {
  const api = props.composer;
  return (
    <button type="button" onClick={() => api?.setModel("probe/model")}>
      {api?.model === "" ? "empty" : api?.model}
    </button>
  );
}

/** R183 dock 条目探针：读审批面 + 乐观摘卡回调 */
function DockProbe(props: WebPartContext) {
  const api = props.composer;
  const pending = api?.pendingApproval;
  return (
    <div>
      <span data-testid="dock-probe-state">{pending === undefined ? "none" : "pending"}</span>
      <button
        type="button"
        onClick={() => {
          if (api !== undefined && pending !== undefined) api.onApprovalDecided(pending.requestId);
        }}
      >
        dock决定
      </button>
    </div>
  );
}

/** 审查 P3-2 探针：dock 里的 textarea 不得抢走接管结束后的回焦 */
function DockAreaProbe() {
  return <textarea aria-label="dock-area" />;
}

function fixtureCtx(overrides?: Partial<WebPartContext>): WebPartContext {
  const client: HeniraClientLike = {
    createSession: async () => ({ id: "s-1", cwd: "C:\\demo", updatedAt: 0, busy: false }),
    listSessions: async () => [
      { id: "s-1", cwd: "C:\\demo", updatedAt: 1, busy: true },
      { id: "s-2", cwd: "C:\\other", updatedAt: 2, busy: false },
    ],
    prompt: async () => ({ queued: false, id: null }),
    steer: async () => true,
    promoteQueueEntry: async () => true,
    removeQueueEntry: async () => true,
    resumeQueue: async () => true,
    interrupt: async () => {},
    settleApproval: async () => true,
    settleQuestion: async () => true,
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
    chains: new Map(),
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

/** R182/R183：输入座位组合（bar + 四席官方默认件 + 审批条目）——Composer 单件已不含接管，
 *  草稿/模型状态在 ComposerDock 运行时；单件测试一律经整座渲染。 */
function dockCtx(overrides?: Partial<WebPartContext>): WebPartContext {
  const base = fixtureCtx(overrides);
  return {
    ...base,
    slots: new Map<string, readonly SlotPart[]>([
      ...base.slots,
      ["composer.bar", [Composer]],
      ["composer.model", [ModelSeat]],
      ["composer.dock", [QueueDock]],
    ]),
    chains: new Map([["composer.takeover", [questionTakeover, approvalTakeover]]]),
  };
}

/** 整座渲染（保留调用方 spy 的 ctx 对象）：<Composer/> 不再接受单独装配 */
function renderComposer(ctx: WebPartContext) {
  return render(
    <ComposerDock
      {...ctx}
      slots={
        new Map<string, readonly SlotPart[]>([
          ...ctx.slots,
          ["composer.bar", [Composer]],
          ["composer.model", [ModelSeat]],
          ["composer.dock", [QueueDock]],
        ])
      }
    />,
  );
}

/** R176：可控帧流宿主——fixtureCtx 的 host.subscribe 换成可推帧的发射器 */
function signalFixture(overrides?: Partial<WebPartContext>): {
  ctx: WebPartContext;
  emit: (frame: ServerFrame) => void;
} {
  const listeners = new Set<(frame: ServerFrame) => void>();
  const base = fixtureCtx(overrides);
  const ctx: WebPartContext = {
    ...base,
    host: {
      ...base.host,
      subscribe: (_filter: { sessionId?: string }, cb: (frame: ServerFrame) => void) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    },
  };
  return {
    ctx,
    emit: (frame) => {
      for (const cb of [...listeners]) cb(frame);
    },
  };
}

describe("SessionList", () => {
  it("列出会话（busy 点）+ 新会话按钮走 client.createSession", async () => {
    const ctx = fixtureCtx();
    const createSession = vi.spyOn(ctx.client, "createSession");
    render(<SessionList {...ctx} />);
    expect(screen.getByText(t("dirs.title"))).toBeDefined();
    await waitFor(() => expect(screen.getAllByRole("button").length).toBeGreaterThan(1));
    const newButton = screen.getByRole("button", { name: t("sessions.new") });
    fireEvent.click(newButton);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("R176：行 store 通知不再拉列表（流式增量不碰列表）", async () => {
    const storeListeners = new Set<() => void>();
    const ctx = fixtureCtx({
      store: {
        getSession: () => ({ rows: [], state: { busy: false } }),
        subscribe: (cb: () => void) => {
          storeListeners.add(cb);
          return () => {
            storeListeners.delete(cb);
          };
        },
      },
    });
    const listSessions = vi.spyOn(ctx.client, "listSessions");
    render(<SessionList {...ctx} />);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 100; i++) {
      for (const cb of [...storeListeners]) cb();
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(listSessions).toHaveBeenCalledTimes(1); // 首载之外零请求
    // R188：允许一条活跃标题订阅（store 标题即时换行名）；列表刷新仍不接 store 通知
    expect(storeListeners.size).toBeLessThanOrEqual(1);
  });

  it("R176：sessions.changed 信号风暴 → 250ms 去抖后恰一枪", async () => {
    const { ctx, emit } = signalFixture();
    const listSessions = vi.spyOn(ctx.client, "listSessions");
    render(<SessionList {...ctx} />);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 10; i++) emit({ kind: "sessions.changed" });
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(listSessions).toHaveBeenCalledTimes(2); // 一束信号只发一枪
  });

  it("R176：在飞时信号只标脏，落定后恰补一枪", async () => {
    const { ctx, emit } = signalFixture();
    const pending: ((rows: SessionSummary[]) => void)[] = [];
    const listSessions = vi.spyOn(ctx.client, "listSessions").mockImplementation(
      () =>
        new Promise<SessionSummary[]>((resolve) => {
          pending.push(resolve);
        }),
    );
    render(<SessionList {...ctx} />);
    await waitFor(() => expect(pending).toHaveLength(1)); // 首载在飞
    emit({ kind: "sessions.changed" });
    await new Promise((resolve) => setTimeout(resolve, 300)); // 去抖到点：在飞 → 只标脏
    expect(pending).toHaveLength(1);
    pending[0]?.([{ id: "s-1", cwd: "C:\\demo", updatedAt: 1, busy: false }]);
    await waitFor(() => expect(pending).toHaveLength(2)); // 落定后补恰一枪
    pending[1]?.([]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(pending).toHaveLength(2); // 无更多补发
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it("R176：列表拉取失败 → 保旧列表、不自动重试（等下个信号）", async () => {
    const { ctx, emit } = signalFixture();
    const listSessions = vi.spyOn(ctx.client, "listSessions").mockRejectedValue(new Error("boom"));
    render(<SessionList {...ctx} />);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
    emit({ kind: "sessions.changed" });
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(listSessions).toHaveBeenCalledTimes(2); // 失败不重试
  });

  it("R176：state.updated 就地翻 busy 点（零列表请求）", async () => {
    const { ctx, emit } = signalFixture();
    const listSessions = vi.spyOn(ctx.client, "listSessions");
    render(<SessionList {...ctx} />);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(t("sessions.busy"))).toBeDefined());
    emit({
      kind: "delta",
      sessionId: "s-1",
      seq: 7,
      delta: { op: "state.updated", state: { busy: false } },
    });
    await waitFor(() => expect(screen.queryByLabelText(t("sessions.busy"))).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(listSessions).toHaveBeenCalledTimes(1); // 推送翻内存，零请求
  });

  it("R176：sessions.changed → 新会话上屏（列表事实变重载）", async () => {
    const { ctx, emit } = signalFixture();
    const listSessions = vi
      .spyOn(ctx.client, "listSessions")
      .mockResolvedValueOnce([{ id: "s-1", cwd: "C:\\demo", updatedAt: 1, busy: false }]);
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
    expect(container.querySelectorAll("button.henira-session-group")).toHaveLength(1);
    emit({ kind: "sessions.changed" });
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group")).toHaveLength(2);
    });
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

  it("按 cwd 分组：组头=目录名+计数徽标；点组头折叠/展开", async () => {
    const { container } = render(<SessionList {...fixtureCtx()} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    const headers = container.querySelectorAll("button.henira-session-group");
    expect(headers).toHaveLength(2); // demo / other 两组
    expect(container.querySelectorAll(".henira-session-count")).toHaveLength(2);
    // 初值：活跃组（demo）展开、非活跃组（other）收起 → 只有 s-1 行（本地折叠语义；
    // 种子 effect 与列表到达同批提交——等一拍再断言，R136 教训）
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1);
    });
    // 折叠 demo 组 → 其子行消失（两组都收起）
    const demoHeader = headers[0] as HTMLButtonElement;
    expect(demoHeader.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(demoHeader);
    expect(demoHeader.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(0);
    fireEvent.click(demoHeader);
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1); // demo 行回来（other 仍收起）
  });

  it("目录区标题行本体 = 折叠开关：点标题收起/展开整个目录列表（纯本地，不持久化——用户反馈②）", async () => {
    const { container } = render(<SessionList {...fixtureCtx()} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    const toggle = container.querySelector("button.henira-dirs-toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("button.henira-session-group")).toHaveLength(0); // 整个列表收起
    fireEvent.click(toggle);
    expect(container.querySelectorAll("button.henira-session-group")).toHaveLength(2); // 原样回来
  });

  it("活跃会话所在组自动展开（选中即见其组）", async () => {
    const ctx = fixtureCtx();
    const { container, rerender } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    // 初值：非活跃组（other）收起（种子 effect 与列表到达同一批提交，等一拍再断言）
    const other = container.querySelectorAll("button.henira-session-group")[1] as HTMLButtonElement;
    await waitFor(() => {
      expect(other.getAttribute("aria-expanded")).toBe("false");
    });
    fireEvent.click(other);
    expect(other.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(2);
    fireEvent.click(other);
    expect(other.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1); // 只剩活跃组 demo 的 s-1
    // 切选 other 组会话 → 其组自动展开（sessionId 变更即确定性触发）
    rerender(<SessionList {...ctx} sessionId="s-2" />);
    await waitFor(() => {
      const header = container.querySelectorAll(
        "button.henira-session-group",
      )[1] as HTMLButtonElement;
      expect(header.getAttribute("aria-expanded")).toBe("true");
    });
    expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(2);
  });

  it("目录区：登记目录驱动分组（空目录也显示）+ 未登记 cwd 补组；退化形态（宿主无方法）不渲染目录交互", async () => {
    const client: HeniraClientLike = {
      ...fixtureCtx().client,
      listDirs: async () => [
        {
          id: "d1",
          cwd: "C:\\demo",
          key: "--demo--",
          displayName: "demo",
          createdAt: 1,
          lastOpenedAt: 2,
          openCount: 1,
        },
        {
          id: "d2",
          cwd: "C:\\empty",
          key: "--empty--",
          displayName: "empty",
          createdAt: 1,
          lastOpenedAt: 3,
          openCount: 1,
        },
      ],
      addDir: async (cwd) => ({
        id: "dn",
        cwd,
        key: "--n--",
        displayName: cwd,
        createdAt: 1,
        lastOpenedAt: 1,
        openCount: 1,
      }),
      browseDirs: async (p) => ({ path: p ?? "", items: [] }),
      deleteDir: async () => {},
      deleteSession: async () => {},
    };
    const { container } = render(<SessionList {...fixtureCtx({ client })} />);
    await waitFor(() => {
      // demo（1 会话）+ empty（0 会话也显示）+ other（未登记 cwd 补组）= 3 组
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(3);
    });
    const counts = [...container.querySelectorAll(".henira-session-count")].map(
      (el) => el.textContent,
    );
    expect(counts).toEqual(["1", "0", "1"]); // 登记序 = listDirs 返回序（server 按 lastOpenedAt 排好）
    expect(screen.getByRole("button", { name: t("dirs.add") })).toBeDefined();
    expect(container.querySelector(`button[aria-label='${t("menu.newSession")}']`)).not.toBeNull();

    // 退化形态：无可选方法 → 无新增目录入口、无组内 ＋，分组照旧
    cleanup();
    const bare = fixtureCtx();
    render(<SessionList {...bare} />);
    expect(screen.queryByRole("button", { name: t("dirs.add") })).toBeNull();
  });

  it("目录行 hover ＋ → 该目录新建会话（createSession({cwd})——服务端自动登记）+ 建完即切", async () => {
    const client: HeniraClientLike = {
      ...fixtureCtx().client,
      createSession: async () => ({ id: "s-new", cwd: "C:\\demo", updatedAt: 0, busy: false }),
      listDirs: async () => [
        {
          id: "d1",
          cwd: "C:\\demo",
          key: "--demo--",
          displayName: "demo",
          createdAt: 1,
          lastOpenedAt: 2,
          openCount: 1,
        },
      ],
      addDir: async (cwd) => ({
        id: "dn",
        cwd,
        key: "--n--",
        displayName: cwd,
        createdAt: 1,
        lastOpenedAt: 1,
        openCount: 1,
      }),
      browseDirs: async (p) => ({ path: p ?? "", items: [] }),
      deleteDir: async () => {},
      deleteSession: async () => {},
    };
    const ctx = fixtureCtx({ client });
    const createSession = vi.spyOn(ctx.client, "createSession");
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(
        container.querySelector(`button[aria-label='${t("menu.newSession")}']`),
      ).not.toBeNull();
    });
    fireEvent.click(
      container.querySelector(`button[aria-label='${t("menu.newSession")}']`) as HTMLButtonElement,
    );
    expect(createSession).toHaveBeenCalledWith({ cwd: "C:\\demo" });
    // R185 活体抓的回归：组内 ＋ 只建不切（R150 只修了顶部按钮）——建完必须 selectSession
    await waitFor(() => {
      expect(ctx.selectSession).toHaveBeenCalledWith("s-new");
    });
  });

  it("右键目录 → 菜单（新建会话/复制路径/删除目录）→ 删除确认弹窗 → deleteDir(id) + 刷新", async () => {
    // 删「C:\empty」（无会话——busy 前置守卫会拦下有运行会话的目录，busy 拒绝形态在 server 侧用例锁）
    const client: HeniraClientLike = {
      ...fixtureCtx().client,
      listDirs: async () => [
        {
          id: "d1",
          cwd: "C:\\empty",
          key: "--empty--",
          displayName: "empty",
          createdAt: 1,
          lastOpenedAt: 2,
          openCount: 1,
        },
      ],
      deleteDir: async () => {},
      deleteSession: async () => {},
    };
    const ctx = fixtureCtx({ client });
    const deleteDir = vi.spyOn(ctx.client, "deleteDir");
    const listSessions = vi.spyOn(ctx.client, "listSessions");
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-group-row").length).toBe(3); // empty + demo + other
    });
    const emptyRow = [...container.querySelectorAll("button.henira-session-group")].find(
      (r) => r.getAttribute("title") === "C:\\empty",
    ) as HTMLElement;
    fireEvent.contextMenu(emptyRow);
    expect(screen.getByText(t("menu.deleteDir"))).toBeDefined();
    expect(screen.getByText(t("menu.copyPath"))).toBeDefined();
    fireEvent.click(screen.getByText(t("menu.deleteDir")));
    // 确认弹窗：标题 + 删除钮
    expect(screen.getByRole("dialog", { name: t("dirs.deleteTitle") })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: t("menu.delete") }));
    expect(deleteDir).toHaveBeenCalledWith("d1");
    // 删除后刷新（listSessions 重拉）
    await waitFor(() => expect(listSessions.mock.calls.length).toBeGreaterThan(1));
  });

  it("右键会话 → 删除项（busy 会话 disabled；非选中会话删后不动选中）→ 确认后 deleteSession(id)", async () => {
    // s-1 busy（demo 组）、s-2 idle（other 组，fixture sessionId=s-1 → s-2 非选中可删）
    const client: HeniraClientLike = {
      ...fixtureCtx().client,
      deleteSession: async () => {},
    };
    const ctx = fixtureCtx({ client });
    const deleteSession = vi.spyOn(ctx.client, "deleteSession");
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    // 非活跃组（other）初值收起——先展开才有 s-2 行
    fireEvent.click(
      container.querySelectorAll("button.henira-session-group")[1] as HTMLButtonElement,
    );
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(2);
    });
    const rows = container.querySelectorAll(".henira-sessions li");
    // busy 会话：菜单项 disabled + 提示
    fireEvent.contextMenu(rows[0] as HTMLElement);
    const busyItem = screen.getByRole("button", { name: t("menu.delete") });
    expect(busyItem.hasAttribute("disabled")).toBe(true);
    expect(busyItem.getAttribute("title")).toBe(t("menu.deleteBusy"));
    fireEvent.keyDown(window, { key: "Escape" }); // 关菜单
    // idle 非选中会话：删除 → 确认 → deleteSession("s-2")
    fireEvent.contextMenu(rows[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: t("menu.delete") }));
    expect(screen.getByRole("dialog", { name: t("sessions.deleteTitle") })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: t("menu.delete") }));
    expect(deleteSession).toHaveBeenCalledWith("s-2");
    // 删的不是选中会话 → 选中不被打扰（R185 收尾补的回落实现在此处不触发）
    expect(ctx.selectSession).not.toHaveBeenCalled();
  });

  it("删当前选中会话 → 同目录下一条接棒（优先于列表更靠前的别目录会话）", async () => {
    const client: HeniraClientLike = {
      ...fixtureCtx().client,
      listSessions: async () => [
        { id: "s-1", cwd: "C:\\demo", updatedAt: 3, busy: false },
        { id: "s-3", cwd: "C:\\other", updatedAt: 2, busy: false },
        { id: "s-2", cwd: "C:\\demo", updatedAt: 1, busy: false },
      ],
      deleteSession: async () => {},
    };
    const ctx = fixtureCtx({ client }); // 选中 = s-1（demo 组自动展开，列表内只有 s-1/s-2 两行）
    const deleteSession = vi.spyOn(ctx.client, "deleteSession");
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(2);
    });
    fireEvent.contextMenu(container.querySelectorAll(".henira-sessions li")[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: t("menu.delete") }));
    fireEvent.click(screen.getByRole("button", { name: t("menu.delete") }));
    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith("s-1");
    });
    await waitFor(() => {
      expect(ctx.selectSession).toHaveBeenCalledWith("s-2");
    });
  });

  it("删最后一个会话 → 选中清空（空态，不指向已删 id）", async () => {
    const client: HeniraClientLike = {
      ...fixtureCtx().client,
      listSessions: async () => [{ id: "s-1", cwd: "C:\\demo", updatedAt: 1, busy: false }],
      deleteSession: async () => {},
    };
    const ctx = fixtureCtx({ client });
    const deleteSession = vi.spyOn(ctx.client, "deleteSession");
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1);
    });
    fireEvent.contextMenu(container.querySelector(".henira-sessions li") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: t("menu.delete") }));
    fireEvent.click(screen.getByRole("button", { name: t("menu.delete") }));
    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith("s-1");
    });
    await waitFor(() => {
      expect(ctx.selectSession).toHaveBeenCalledWith(null);
    });
  });

  it("跨窗口：列表刷新后选中会话消失 → 本窗口回落（同目录下一条优先）", async () => {
    let phase = 1;
    const listSessions = vi.fn(async () =>
      phase === 1
        ? [
            { id: "s-1", cwd: "C:\\demo", updatedAt: 3, busy: false },
            { id: "s-3", cwd: "C:\\other", updatedAt: 2, busy: false },
            { id: "s-2", cwd: "C:\\demo", updatedAt: 1, busy: false },
          ]
        : [
            { id: "s-3", cwd: "C:\\other", updatedAt: 2, busy: false },
            { id: "s-2", cwd: "C:\\demo", updatedAt: 1, busy: false },
          ],
    );
    const { ctx, emit } = signalFixture({
      client: { ...fixtureCtx().client, listSessions },
    });
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(2); // demo 组展开
    });
    expect(ctx.selectSession).not.toHaveBeenCalled(); // 首次装载不误清
    phase = 2;
    emit({ kind: "sessions.changed" }); // 别的窗口删了选中会话 → 本窗收到列表信号
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(ctx.selectSession).toHaveBeenCalledWith("s-2"); // 同目录下一条（不是列表首个 s-3）
    });
  });

  it("跨窗口：消失的不是选中会话 → 不动选中", async () => {
    let phase = 1;
    const listSessions = vi.fn(async () =>
      phase === 1
        ? [
            { id: "s-1", cwd: "C:\\demo", updatedAt: 2, busy: false },
            { id: "s-2", cwd: "C:\\other", updatedAt: 1, busy: false },
          ]
        : [{ id: "s-1", cwd: "C:\\demo", updatedAt: 2, busy: false }],
    );
    const { ctx, emit } = signalFixture({
      client: { ...fixtureCtx().client, listSessions },
    });
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1);
    });
    phase = 2;
    emit({ kind: "sessions.changed" });
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ctx.selectSession).not.toHaveBeenCalled();
  });

  it("新增目录弹窗：browseDirs 树渲染 + 确认走 addDir(路径)；Escape 关闭", async () => {
    const client: HeniraClientLike = {
      ...fixtureCtx().client,
      listDirs: async () => [],
      deleteDir: async () => {},
      deleteSession: async () => {},
      browseDirs: async (p) =>
        p === "__drives__"
          ? { path: p, items: [{ name: "C:\\", path: "C:\\", type: "drive" }] }
          : {
              path: p ?? "",
              parent: "C:\\",
              items: [{ name: "work", path: "C:\\work", type: "directory" }],
            },
      addDir: async (cwd) => ({
        id: "dn",
        cwd,
        key: "--new--",
        displayName: "work",
        createdAt: 1,
        lastOpenedAt: 1,
        openCount: 1,
      }),
    };
    const ctx = fixtureCtx({ client });
    const addDir = vi.spyOn(ctx.client, "addDir");
    render(<SessionList {...ctx} />);
    fireEvent.click(await screen.findByRole("button", { name: t("dirs.add") }));
    expect(screen.getByRole("dialog", { name: t("dirs.add") })).toBeDefined();
    await waitFor(() => {
      // 盘符层懒加载到树（行文本 = 图标+名称混排，按容器文本断言）
      expect(screen.getByRole("dialog", { name: t("dirs.add") }).textContent).toContain("C:\\");
    });
    const input = screen.getByPlaceholderText(t("dirs.pathPlaceholder")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "C:\\work" } });
    fireEvent.click(screen.getByRole("button", { name: t("dirs.confirm") }));
    expect(addDir).toHaveBeenCalledWith("C:\\work");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: t("dirs.add") })).toBeNull();
  });
});

describe("Composer", () => {
  it("Enter 发送走 client.prompt；busy+空草稿 显示停止", async () => {
    const ctx = fixtureCtx();
    const prompt = vi.spyOn(ctx.client, "prompt");
    const { container } = renderComposer(ctx);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "你好" } });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(prompt).toHaveBeenCalledWith("s-1", "你好", {
      modelId: undefined,
      reasoningEffort: undefined,
    });
    // busy 形态（store 契约=rows 引用稳定：快照提出闭包，getSnapshot 每次新对象会让 useSyncExternalStore 死循环）
    const busyRows: Row[] = [];
    const busyCtx = fixtureCtx({
      store: {
        getSession: () => ({ rows: busyRows, state: { busy: true } }),
        subscribe: () => () => {},
      },
    });
    cleanup();
    renderComposer(busyCtx);
    expect(screen.getByRole("button", { name: t("composer.stop") })).toBeDefined();
    // R182：忙态常驻提示退场，占位改为排队文案
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).placeholder).toBe(
      t("composer.placeholder.queue"),
    );
  });

  it("R182 占位三态：空会话=新提问 / 有历史=追问 / 忙=排队", () => {
    const placeholderOf = (container: HTMLElement): string =>
      (container.querySelector("[data-testid='composer-input']") as HTMLTextAreaElement)
        .placeholder;
    const empty = renderComposer(fixtureCtx());
    expect(placeholderOf(empty.container)).toBe(t("composer.placeholder"));
    empty.unmount();
    const historyRow: Row = {
      kind: "user",
      rowId: "u:1",
      rowSeq: 1,
      turn: "t-1",
      text: "问",
      source: "send",
    };
    const historyRows = [historyRow];
    const history = renderComposer(
      fixtureCtx({
        store: {
          getSession: () => ({ rows: historyRows, state: { busy: false } }),
          subscribe: () => () => {},
        },
      }),
    );
    expect(placeholderOf(history.container)).toBe(t("composer.placeholder.followUp"));
    history.unmount();
    const busy = renderComposer(
      fixtureCtx({
        store: {
          getSession: () => ({ rows: historyRows, state: { busy: true } }),
          subscribe: () => () => {},
        },
      }),
    );
    expect(placeholderOf(busy.container)).toBe(t("composer.placeholder.queue"));
  });

  it("R182 chain 槽通用选举：非审批条目同样接管，fallback bar 隐藏但挂载", () => {
    const entry = defineChainEntry<unknown, { key: string; label: string }>({
      id: "demo",
      priority: 0,
      select: () => ({ key: "demo-1", label: "接管件" }),
      Component: DemoTakeover,
    });
    const ctx = dockCtx();
    const { container } = render(
      <ComposerDock {...ctx} chains={new Map([["composer.takeover", [entry]]])} />,
    );
    expect(screen.getByTestId("demo-takeover").textContent).toBe("接管件");
    expect(
      (container.querySelector(".henira-composer-bar-slot") as HTMLElement).style.display,
    ).toBe("none");
    cleanup();
    // 无条目当选 → fallback 输入栏可见
    const plain = render(<ComposerDock {...dockCtx()} />);
    expect(
      (plain.container.querySelector(".henira-composer-bar-slot") as HTMLElement).style.display,
    ).toBe("");
  });

  it("ZCode 语义：忙+有草稿=发送钮（排队插话）而非停止——点击发送走 prompt（E1：忙时钮文案=排队发送）", async () => {
    const ctx = fixtureCtx();
    const promptSpy = vi.spyOn(ctx.client, "prompt");
    const busyRows: Row[] = [];
    const busyCtx = fixtureCtx({
      ...ctx,
      store: {
        getSession: () => ({ rows: busyRows, state: { busy: true } }),
        subscribe: () => () => {},
      },
    });
    const { container } = renderComposer(busyCtx);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "排队的话" } });
    // 有草稿 → 停止钮不在场，发送钮点亮（E1：忙时 aria-label=排队发送）
    expect(screen.queryByRole("button", { name: t("composer.stop") })).toBeNull();
    const send = screen.getByRole("button", { name: t("composer.queueSend") });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() =>
      expect(promptSpy).toHaveBeenCalledWith("s-1", "排队的话", {
        steer: undefined,
        modelId: undefined,
        reasoningEffort: undefined,
      }),
    );
  });

  it("E1 发送模式：Ctrl+Enter=插话入队（prompt 携带 steer:true）；普通 Enter 照旧", async () => {
    const ctx = fixtureCtx();
    const promptSpy = vi.spyOn(ctx.client, "prompt");
    const { container } = renderComposer(ctx);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "插话的话" } });
    fireEvent.keyDown(area, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(promptSpy).toHaveBeenCalledWith("s-1", "插话的话", {
        steer: true,
        modelId: undefined,
        reasoningEffort: undefined,
      }),
    );
    fireEvent.change(area, { target: { value: "普通的话" } });
    fireEvent.keyDown(area, { key: "Enter" });
    await waitFor(() =>
      expect(promptSpy).toHaveBeenCalledWith("s-1", "普通的话", {
        steer: undefined,
        modelId: undefined,
        reasoningEffort: undefined,
      }),
    );
  });

  it("E1 排队卡：忙时队列可见（静音列表，无标题/计数头），steer 条目带插话徽章；空队列不渲染", () => {
    const queue = [
      { id: "q1", text: "第一条排队", steer: false },
      { id: "q2", text: "插话条目", steer: true },
    ];
    const queueCtx = fixtureCtx({
      store: {
        getSession: () => ({ rows: [] as Row[], state: { busy: true, queue } }),
        subscribe: () => () => {},
      },
    });
    const { container } = render(<QueuePanel ctx={queueCtx} />);
    expect(screen.getByRole("list", { name: t("composer.queue.title") })).toBeDefined();
    expect(screen.getByText("第一条排队")).toBeDefined();
    expect(screen.getByText(t("composer.queue.badgeSteer"))).toBeDefined();
    expect(container.querySelectorAll(".henira-queue-row")).toHaveLength(2);
    expect(container.querySelector(".henira-queue-head")).toBeNull();
    expect(container.querySelector(".henira-queue-count")).toBeNull();
    // 空队列 → null
    const emptyCtx = fixtureCtx();
    const empty = render(<QueuePanel ctx={emptyCtx} />);
    expect(empty.container.querySelector(".henira-queue")).toBeNull();
  });

  it("E1 排队卡操作：立即发送钮调 promoteQueueEntry；删除调 removeQueueEntry；编辑回填草稿并删条目", async () => {
    const queue = [{ id: "q9", text: "被操作条目", steer: false }];
    const ctx = fixtureCtx();
    const promoteSpy = vi.spyOn(ctx.client, "promoteQueueEntry");
    const removeSpy = vi.spyOn(ctx.client, "removeQueueEntry");
    const onEdit = vi.fn();
    const busyCtx = fixtureCtx({
      ...ctx,
      store: {
        getSession: () => ({ rows: [], state: { busy: true, queue } }),
        subscribe: () => () => {},
      },
    });
    const first = render(<QueuePanel ctx={busyCtx} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: t("composer.queue.sendNow") }));
    await waitFor(() => expect(promoteSpy).toHaveBeenCalledWith("s-1", "q9"));
    fireEvent.click(screen.getByRole("button", { name: t("composer.queue.edit") }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("s-1", "q9"));
    expect(onEdit).toHaveBeenCalledWith("被操作条目");
    fireEvent.click(screen.getByRole("button", { name: t("composer.queue.delete") }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledTimes(2));
    first.unmount();
    // 闲时未冻结 + 队列非空 = 回合末冲刷瞬态窗口 → 不渲染（防每对回合间面板闪现）
    const idleCtx = fixtureCtx({
      ...ctx,
      store: {
        getSession: () => ({ rows: [], state: { busy: false, queue } }),
        subscribe: () => () => {},
      },
    });
    const idle = render(<QueuePanel ctx={idleCtx} />);
    expect(idle.container.querySelector(".henira-queue")).toBeNull();
    idle.unmount();
    // 旧嵌入方缺 promoteQueueEntry → 立即发送钮禁用（不崩）
    const { promoteQueueEntry: _omitPromote, ...clientWithoutPromote } = ctx.client;
    const legacyCtx = fixtureCtx({
      ...ctx,
      client: clientWithoutPromote as HeniraClientLike,
      store: {
        getSession: () => ({ rows: [], state: { busy: true, queue } }),
        subscribe: () => () => {},
      },
    });
    const legacy = render(<QueuePanel ctx={legacyCtx} />);
    expect(
      (screen.getByRole("button", { name: t("composer.queue.sendNow") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    legacy.unmount();
    // 冻结（paused）态可见：立即发送钮三态都可点（闲时 preempt = no-op 直接发这条）
    const pausedCtx = fixtureCtx({
      ...ctx,
      store: {
        getSession: () => ({ rows: [], state: { busy: false, queuePaused: true, queue } }),
        subscribe: () => () => {},
      },
    });
    render(<QueuePanel ctx={pausedCtx} />);
    expect(
      (screen.getByRole("button", { name: t("composer.queue.sendNow") }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("E1 中断冻结：头部切「队列已暂停」+「继续发送」钮（调 resumeQueue；client 缺方法时禁用）", async () => {
    const queue = [{ id: "q1", text: "冻结条目", steer: false }];
    const ctx = fixtureCtx();
    const resumeSpy = vi.spyOn(ctx.client, "resumeQueue");
    const pausedCtx = fixtureCtx({
      ...ctx,
      store: {
        getSession: () => ({ rows: [], state: { busy: false, queuePaused: true, queue } }),
        subscribe: () => () => {},
      },
    });
    const view = render(<QueuePanel ctx={pausedCtx} />);
    expect(screen.getByText(t("composer.queue.pausedTitle"))).toBeDefined();
    const resumeBtn = screen.getByRole("button", { name: t("composer.queue.resume") });
    fireEvent.click(resumeBtn);
    await waitFor(() => expect(resumeSpy).toHaveBeenCalledWith("s-1"));
    // 旧嵌入方缺 resumeQueue → 继续钮禁用（不崩）
    const { resumeQueue: _omit, ...clientWithoutResume } = ctx.client;
    const legacyCtx = fixtureCtx({
      ...ctx,
      client: clientWithoutResume as HeniraClientLike,
      store: {
        getSession: () => ({ rows: [], state: { busy: false, queuePaused: true, queue } }),
        subscribe: () => () => {},
      },
    });
    view.unmount();
    render(<QueuePanel ctx={legacyCtx} />);
    expect(
      (screen.getByRole("button", { name: t("composer.queue.resume") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("prompt 失败不静默：草稿回填 + 行内错误提示", async () => {
    const ctx = fixtureCtx();
    vi.spyOn(ctx.client, "prompt").mockRejectedValueOnce(new Error("boom"));
    const { container } = renderComposer(ctx);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "会失败的话" } });
    fireEvent.keyDown(area, { key: "Enter" });
    const hint = await screen.findByRole("alert");
    expect(hint.textContent).toBe(t("composer.sendFailed"));
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("会失败的话");
  });

  it("模型选择器（弹层）：按厂商分组清单；选择=会话级绑定记忆（不写全局 settings）；「管理模型…」开设置弹窗", async () => {
    const putSettings = vi.fn().mockResolvedValue({ version: 1 });
    const updateUiState = vi.fn();
    const openSettings = vi.fn();
    const ctx = fixtureCtx({
      updateUiState,
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, model: "deepseek/deepseek-v4-flash" }),
        listModels: async () => ({
          providers: {
            deepseek: {
              baseUrl: "x",
              models: [
                {
                  id: "deepseek-v4-flash",
                  name: "DeepSeek V4 Flash",
                  contextWindow: 1048576,
                  vision: true,
                },
                { id: "deepseek-flash", name: "DeepSeek Flash" },
              ],
            },
            zhipuai: {
              models: [
                {
                  id: "glm-5.3-flash",
                  name: "GLM-5.3-Flash",
                  contextWindow: 1000000,
                  reasoning: true,
                },
              ],
            },
          },
        }),
        putSettings,
      },
      openSettings,
    });
    const { container } = renderComposer(ctx);
    const trigger = (await screen.findByRole("button", {
      name: t("composer.model"),
    })) as HTMLButtonElement;
    // 触发钮显示模型显示名（厂商 id 不进按钮）
    await waitFor(() => expect(trigger.textContent).toContain("DeepSeek V4 Flash"));
    expect(trigger.textContent).not.toContain("deepseek/");
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox", { name: t("composer.model") });
    expect(listbox.textContent).toContain("zhipuai"); // 按厂商分组
    // 条目可访问名 = 显示名+徽章排——按 title 定位完整 id
    fireEvent.click(screen.getByRole("option", { name: "DeepSeek Flash" }));
    // 笔 6 语义：composer 选择 = 会话绑定（ui-state 记忆），全局默认归设置弹窗·模型管理页
    expect(updateUiState).toHaveBeenCalledWith({ model: "deepseek/deepseek-flash" });
    expect(putSettings).not.toHaveBeenCalled();
    // 底部「管理模型…」→ openSettings("models")
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: t("composer.manageModels") }));
    expect(openSettings).toHaveBeenCalledWith("models");
    void container;
  });
});

describe("输入座位四席 + Composer API（R183）", () => {
  const readyClient = (): HeniraClientLike => ({
    ...fixtureCtx().client,
    getSettings: async () => ({ version: 1 }),
    listModels: async () => ({ providers: {} }),
  });

  it("composer.model 单槽：官方席渲染模型触发钮；顶替件拿同一 API（写会话绑定）", () => {
    const updateUiState = vi.fn();
    const ctx = dockCtx({ updateUiState, client: readyClient() });
    const official = render(<ComposerDock {...ctx} />);
    expect(screen.getByRole("button", { name: t("composer.model") })).toBeDefined();
    official.unmount();

    const slots = new Map(ctx.slots);
    slots.set("composer.model", [ModelSeatProbe]);
    render(<ComposerDock {...ctx} slots={slots} />);
    expect(screen.queryByRole("button", { name: t("composer.model") })).toBeNull(); // 官方席已让位
    fireEvent.click(screen.getByRole("button", { name: "empty" }));
    expect(updateUiState).toHaveBeenCalledWith({ model: "probe/model" });
  });

  it("composer.left / composer.right：追加件在工具排渲染，经 API 写草稿/聚焦/发送", async () => {
    const updateUiState = vi.fn();
    const ctx = dockCtx({ updateUiState });
    const prompt = vi.spyOn(ctx.client, "prompt");
    const slots = new Map(ctx.slots);
    slots.set("composer.left", [LeftSeatProbe]);
    slots.set("composer.right", [RightSeatProbe]);
    const { container } = render(<ComposerDock {...ctx} slots={slots} />);
    fireEvent.click(screen.getByRole("button", { name: "左席" }));
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(area.value).toBe("左席插入"); // 草稿真源在运行时
    expect(updateUiState).toHaveBeenCalledWith({ draft: "左席插入" }); // setDraft 双写（审查 P3⑦）
    expect(document.activeElement).toBe(area); // api.focus() 落输入框
    fireEvent.click(screen.getByRole("button", { name: "闲" }));
    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith("s-1", "右席发送", {
        steer: undefined,
        modelId: undefined,
        reasoningEffort: undefined,
      }),
    );
  });

  it("工具排 DOM 顺序：模型席 → 左追加位 → 右追加位 → 发送钮（审查 P3⑦）", () => {
    const ctx = dockCtx({ client: readyClient() });
    const slots = new Map(ctx.slots);
    slots.set("composer.left", [LeftSeatProbe]);
    slots.set("composer.right", [RightSeatProbe]);
    const { container } = render(<ComposerDock {...ctx} slots={slots} />);
    const bar = container.querySelector(".henira-composer-bar") as HTMLElement;
    const children = [...bar.children];
    const seats = children.filter((el) => el.classList.contains("henira-composer-seat"));
    expect(seats.length).toBe(3); // 模型/左/右（各一件；官方 bar 不再另开座位）
    expect(seats[0]?.querySelector(`button[aria-label="${t("composer.model")}"]`)).not.toBeNull();
    expect(seats[1]?.textContent).toContain("左席");
    expect(seats[2]?.textContent).toContain("闲");
    const sendIndex = children.findIndex((el) => el.classList.contains("henira-icon-round"));
    expect(sendIndex).toBeGreaterThan(children.indexOf(seats[2] as Element));
  });

  it("宿主无设置方法：模型席 null 时座位 wrapper 无子节点（:empty 退场，不占 8px gap——审查 P3⑧）", () => {
    const ctx = dockCtx(); // fixtureCtx 无 getSettings/listModels → settingsReady=false
    const { container } = render(<ComposerDock {...ctx} />);
    const emptySeat = [...container.querySelectorAll(".henira-composer-seat")].find(
      (el) => el.childNodes.length === 0,
    );
    expect(emptySeat).toBeDefined(); // 无子节点 = composer/00-shell.css 的 :empty 规则命中
  });

  it("composer.dock：排队面板在 bar 外；审批接管时 dock 仍可见、bar 槽隐藏；dock 件拿审批面", () => {
    const approvalRow = {
      kind: "approval",
      rowId: "p:r-1",
      turn: "t-1",
      step: 1,
      requestId: "r-1",
      toolName: "demo-write",
      status: "pending",
    } as ApprovalRow;
    const queue = [{ id: "q1", text: "排队的话", steer: false }];
    // 快照引用必须稳定（useSyncExternalStore 语义：每次新数组会死循环）
    const approvalRows: Row[] = [approvalRow];
    const sessionState = { busy: true, queue };
    const ctx = dockCtx({
      store: {
        getSession: () => ({ rows: approvalRows, state: sessionState }),
        subscribe: () => () => {},
      },
    });
    const slots = new Map(ctx.slots);
    slots.set("composer.dock", [QueueDock, DockProbe]);
    const { container } = render(<ComposerDock {...ctx} slots={slots} />);

    const barSlot = container.querySelector(".henira-composer-bar-slot") as HTMLElement;
    const queueEl = container.querySelector(".henira-queue") as HTMLElement;
    expect(barSlot.style.display).toBe("none"); // 接管中
    expect(queueEl).not.toBeNull();
    expect(barSlot.contains(queueEl)).toBe(false); // 排队面板不在被隐藏的 bar 子树里
    expect(screen.getByTestId("dock-probe-state").textContent).toBe("pending"); // API 审批面

    // 乐观摘卡：dock 条目点决定 → pending 让位（bar 回来）；settle 结果不影响本断言
    fireEvent.click(screen.getByRole("button", { name: "dock决定" }));
    expect(screen.getByTestId("dock-probe-state").textContent).toBe("none");
    expect(barSlot.style.display).toBe("");
  });

  it("审查修复：乐观已答不再吞发送；接管时排队编辑禁用；回焦不被 dock textarea 抢走", async () => {
    const approvalRow = {
      kind: "approval",
      rowId: "p:r-1",
      turn: "t-1",
      step: 1,
      requestId: "r-1",
      toolName: "demo-write",
      status: "pending",
    } as ApprovalRow;
    const approvalRows: Row[] = [approvalRow];
    const sessionState = { busy: true, queue: [{ id: "q1", text: "排队的话", steer: false }] };
    const ctx = dockCtx({
      store: {
        getSession: () => ({ rows: approvalRows, state: sessionState }),
        subscribe: () => () => {},
      },
    });
    const prompt = vi.spyOn(ctx.client, "prompt");
    // settle 挂起 = 乐观窗口：answered 已置、行仍 pending（卡已离场、bar 已回来）
    vi.spyOn(ctx.client, "settleApproval").mockImplementation(() => new Promise(() => {}));
    const slots = new Map(ctx.slots);
    slots.set("composer.dock", [QueueDock, DockAreaProbe]);
    const { container } = render(<ComposerDock {...ctx} slots={slots} />);

    // 接管中：排队编辑钮禁用（bar 隐藏，编辑会写进看不见的草稿）
    expect(
      (screen.getByRole("button", { name: t("composer.queue.edit") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByText(t("approval.allow"))); // 乐观摘卡，settle 不回
    const barSlot = container.querySelector(".henira-composer-bar-slot") as HTMLElement;
    await waitFor(() => expect(barSlot.style.display).toBe(""));
    // bar 回来 → 编辑恢复
    expect(
      (screen.getByRole("button", { name: t("composer.queue.edit") }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    // 回焦到登记输入框，不是 composer.dock 里的 textarea
    const area = container.querySelector(
      ".henira-composer-bar-slot textarea",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(area));

    // 乐观已答后发送不再被兜底吞掉（审查 P2）
    fireEvent.change(area, { target: { value: "接着说" } });
    fireEvent.keyDown(area, { key: "Enter" });
    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith("s-1", "接着说", {
        steer: undefined,
        modelId: undefined,
        reasoningEffort: undefined,
      }),
    );
  });

  it("pruneAnswered：settled 的 id 出集合、仍 pending 的保留；无变化返回原引用（审查 P3④）", () => {
    const pendingApproval = {
      kind: "approval",
      rowId: "p:r1",
      turn: "t-1",
      step: 1,
      requestId: "r1",
      toolName: "demo-write",
      status: "pending",
    } as ApprovalRow;
    const settledApproval = {
      ...pendingApproval,
      rowId: "p:r2",
      requestId: "r2",
      status: "settled",
    } as ApprovalRow;
    const pendingQuestion = {
      kind: "question",
      rowId: "q:r3",
      turn: "t-1",
      step: 1,
      requestId: "r3",
      questions: [{ id: "q1", question: "?" }],
      status: "pending",
    } as QuestionRow;

    const answered = new Set(["r1", "r2", "r3"]);
    const next = pruneAnswered(answered, [pendingApproval, settledApproval, pendingQuestion]);
    expect([...next].sort()).toEqual(["r1", "r3"]); // r2 已 settled → 裁掉（集合不再无限增长）

    const unchanged = new Set(["r1"]);
    expect(pruneAnswered(unchanged, [pendingApproval])).toBe(unchanged); // 引用不变，空转不渲染
    expect([...pruneAnswered(unchanged, [])]).toEqual([]); // 行清空 → 集合清空
  });

  it("接管出现不夺座位外焦点（审查 P3③）：在设置弹窗输入时审批到达不拽走", () => {
    let rows: Row[] = [];
    const listeners = new Set<() => void>();
    const ctx = dockCtx({
      store: {
        getSession: () => ({ rows, state: { busy: true } }),
        subscribe: (cb) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
      },
    });
    const approvalRow = {
      kind: "approval",
      rowId: "p:r-1",
      turn: "t-1",
      step: 1,
      requestId: "r-1",
      toolName: "demo-write",
      status: "pending",
    } as ApprovalRow;
    render(
      <>
        <input aria-label="设置项" />
        <ComposerDock {...ctx} />
      </>,
    );
    const outside = screen.getByLabelText("设置项") as HTMLInputElement;
    outside.focus();
    expect(document.activeElement).toBe(outside);
    act(() => {
      rows = [approvalRow];
      for (const cb of [...listeners]) cb();
    });
    expect(document.querySelector(".henira-composer-takeover")).not.toBeNull(); // 卡已出现
    expect(document.activeElement).toBe(outside); // 焦点仍在设置项
  });

  it("接管出现且焦点在 body → 接管容器获焦（守门不误伤常规路径）", () => {
    let rows: Row[] = [];
    const listeners = new Set<() => void>();
    const ctx = dockCtx({
      store: {
        getSession: () => ({ rows, state: { busy: true } }),
        subscribe: (cb) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
      },
    });
    const approvalRow = {
      kind: "approval",
      rowId: "p:r-1",
      turn: "t-1",
      step: 1,
      requestId: "r-1",
      toolName: "demo-write",
      status: "pending",
    } as ApprovalRow;
    render(<ComposerDock {...ctx} />);
    act(() => {
      rows = [approvalRow];
      for (const cb of [...listeners]) cb();
    });
    const takeover = document.querySelector(".henira-composer-takeover") as HTMLElement;
    expect(takeover).not.toBeNull();
    expect(document.activeElement).toBe(takeover);
  });
});

describe("提问卡（R184）", () => {
  const questionRow = {
    kind: "question",
    rowId: "q:r-q",
    rowSeq: 1,
    turn: "t-1",
    step: 1,
    requestId: "r-q",
    questions: [
      {
        id: "q1",
        question: "选哪个方案？",
        header: "方案",
        options: [{ label: "甲" }, { label: "乙", description: "慢但稳" }],
      },
    ],
    status: "pending",
  } as QuestionRow;

  function questionCtx(
    rows: Row[],
    state: { busy: boolean; queue?: { id: string; text: string; steer: boolean }[] } = {
      busy: true,
    },
  ) {
    return dockCtx({
      store: {
        getSession: () => ({ rows, state }),
        subscribe: () => () => {},
      },
    });
  }

  it("接管出现后焦点落在提问卡内——卡级键盘通道当场可达（不被接管容器回焦盖掉，R185）", () => {
    const rows: Row[] = [questionRow];
    const ctx = questionCtx(rows);
    ctx.client.settleQuestion = vi.fn(async () => true);
    const { container } = render(<ComposerDock {...ctx} />);
    const card = container.querySelector(".henira-question") as HTMLElement;
    // 卡级 onKeyDown（Enter/Esc/Arrow）只在焦点位于卡内时可达；dock 父级 effect 后跑，
    // 若无条件 focus 接管容器就会把卡的自聚焦顶掉——键盘提示全成假话
    expect(card.contains(document.activeElement)).toBe(true);
  });

  it("点选后焦点留在选项上——Space 连选 / ↓ 逐项依赖选项焦点（R185）", () => {
    const multiRow = {
      ...questionRow,
      requestId: "r-focus",
      rowId: "q:r-focus",
      questions: [
        {
          id: "a",
          question: "要哪些能力？",
          multiSelect: true,
          options: [{ label: "搜索" }, { label: "写作" }],
        },
      ],
    } as QuestionRow;
    const ctx = questionCtx([multiRow]);
    ctx.client.settleQuestion = vi.fn(async () => true);
    render(<ComposerDock {...ctx} />);
    const first = screen.getAllByRole("checkbox")[0] as HTMLButtonElement;
    first.focus();
    fireEvent.click(first);
    // 点击处理器不得把焦点收回卡容器：否则 ArrowDown 的 indexOf 见 -1，永远跳回第一项
    expect(document.activeElement).toBe(first);
  });

  it("单选 + 提交：settleQuestion 收逐题答案；乐观摘卡后 bar 回来", async () => {
    const rows: Row[] = [questionRow];
    const ctx = questionCtx(rows);
    const settle = vi.fn(async () => true);
    ctx.client.settleQuestion = settle;
    const { container } = render(<ComposerDock {...ctx} />);
    const barSlot = container.querySelector(".henira-composer-bar-slot") as HTMLElement;
    expect(barSlot.style.display).toBe("none"); // 提问接管

    fireEvent.click(screen.getByRole("option", { name: /甲/ }));
    fireEvent.click(screen.getByRole("button", { name: t("question.submit") }));
    expect(settle).toHaveBeenCalledWith("s-1", "r-q", [{ id: "q1", selected: ["甲"] }]);
    await waitFor(() => expect(barSlot.style.display).toBe(""));
  });

  it("多选 + 分页 + 自定义输入：下一页 Enter 提交，答案按题对齐", async () => {
    const multi = {
      ...questionRow,
      requestId: "r-m",
      rowId: "q:r-m",
      questions: [
        {
          id: "a",
          question: "要哪些能力？",
          multiSelect: true,
          options: [{ label: "搜索" }, { label: "写作" }],
        },
        { id: "b", question: "补充说明？" },
      ],
    } as QuestionRow;
    const rows: Row[] = [multi];
    const ctx = questionCtx(rows);
    const settle = vi.fn(async () => true);
    ctx.client.settleQuestion = settle;
    render(<ComposerDock {...ctx} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /搜索/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /写作/ }));
    fireEvent.click(screen.getByRole("button", { name: t("question.next") }));
    // 第二题：纯文本题（自定义输入直接成答案）
    const custom = screen.getByPlaceholderText(
      t("question.customPlaceholder"),
    ) as HTMLTextAreaElement;
    expect(custom.maxLength).toBe(QUESTION_CUSTOM_MAX); // 自由文本上限与协议同源（R186）
    fireEvent.change(custom, { target: { value: "都要" } });
    fireEvent.keyDown(custom, { key: "Enter" });
    expect(settle).toHaveBeenCalledWith("s-1", "r-m", [
      { id: "a", selected: ["搜索", "写作"] },
      { id: "b", selected: [], custom: "都要" },
    ]);
  });

  it("多选连点两下（同一批事件）不互相覆盖——函数式更新（活体实锤）", () => {
    const multi = {
      ...questionRow,
      requestId: "r-batch",
      rowId: "q:r-batch",
      questions: [
        {
          id: "a",
          question: "要哪些能力？",
          multiSelect: true,
          options: [{ label: "搜索" }, { label: "写作" }],
        },
      ],
    } as QuestionRow;
    const rows: Row[] = [multi];
    const ctx = questionCtx(rows);
    const settle = vi.fn(async () => true);
    ctx.client.settleQuestion = settle;
    render(<ComposerDock {...ctx} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLButtonElement[];
    // 同一批里连点两下：闭包里的 drafts 都是旧值，必须函数式合并
    act(() => {
      boxes[0]?.click();
      boxes[1]?.click();
    });
    fireEvent.click(screen.getByRole("button", { name: t("question.submit") }));
    expect(settle).toHaveBeenCalledWith("s-1", "r-batch", [
      { id: "a", selected: ["搜索", "写作"] },
    ]);
  });

  it("Esc：后续题回上一题、首题取消整个请求；IME 组合中 Enter 不推进", () => {
    const two = {
      ...questionRow,
      questions: [
        { id: "a", question: "第一题？", options: [{ label: "是" }, { label: "否" }] },
        { id: "b", question: "第二题？" },
      ],
    } as QuestionRow;
    const rows: Row[] = [two];
    const ctx = questionCtx(rows);
    const settle = vi.fn(async () => true);
    ctx.client.settleQuestion = settle;
    const { container } = render(<ComposerDock {...ctx} />);
    const card = container.querySelector(".henira-question") as HTMLElement;
    // 翻到第二题
    fireEvent.click(screen.getByRole("button", { name: t("question.next") }));
    expect(screen.getByText("第二题？")).toBeDefined();
    // Esc → 回上一题（不是取消）
    fireEvent.keyDown(card, { key: "Escape" });
    expect(screen.getByText("第一题？")).toBeDefined();
    expect(settle).not.toHaveBeenCalled();
    // IME 组合中的 Enter 不推进
    fireEvent.keyDown(card, { key: "Enter", isComposing: true });
    expect(screen.getByText("第一题？")).toBeDefined();
    // 首题 Esc → 取消整个请求
    fireEvent.keyDown(card, { key: "Escape" });
    expect(settle).toHaveBeenCalledWith("s-1", "r-q", { cancelled: true });
  });

  it("提问压过审批（dsh precedence）：答完提问后审批卡才浮出", async () => {
    const approvalRow = {
      kind: "approval",
      rowId: "p:r-a",
      turn: "t-1",
      step: 1,
      requestId: "r-a",
      toolName: "demo-write",
      status: "pending",
    } as ApprovalRow;
    const rows: Row[] = [approvalRow, questionRow];
    const ctx = questionCtx(rows);
    ctx.client.settleQuestion = vi.fn((): Promise<boolean> => new Promise(() => {}));
    render(<ComposerDock {...ctx} />);
    expect(screen.getByRole("dialog", { name: t("question.title") })).toBeDefined();
    expect(screen.queryByText(t("approval.title"))).toBeNull();
    // 提交（空选 = 跳过）→ 乐观摘卡；settle 不回、行仍 pending——提示卡已离场即让位
    fireEvent.click(screen.getByRole("button", { name: t("question.submit") }));
    await waitFor(() => expect(screen.getByText(t("approval.title"))).toBeDefined());
  });

  it("接管期间排队编辑禁用（提问与审批同一判据）", () => {
    const rows: Row[] = [questionRow];
    const ctx = questionCtx(rows, {
      busy: true,
      queue: [{ id: "q-1", text: "排队的话", steer: false }],
    });
    render(<ComposerDock {...ctx} />);
    expect(
      (screen.getByRole("button", { name: t("composer.queue.edit") }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("痕迹卡：运行中「提问中」；完成逐题问答；取消「已取消」", () => {
    const ctx = fixtureCtx();
    const base: ToolRow = {
      kind: "tool",
      rowId: "t:t-1:1:c1",
      rowSeq: 1,
      turn: "t-1",
      step: 1,
      callId: "c1",
      name: "ask_user",
      status: "running",
      input: JSON.stringify({ questions: questionRow.questions }),
    };
    const running = render(<AskUserCard ctx={ctx} row={base} />);
    expect(screen.getByText(t("question.asking"))).toBeDefined();
    running.unmount();

    const done: ToolRow = {
      ...base,
      status: "done",
      output: {
        content: "The user answered your questions",
        isError: false,
        durationMs: 1,
        meta: {
          kind: "ask_user",
          questions: questionRow.questions,
          answers: [{ id: "q1", selected: ["乙"] }],
        },
      },
    };
    const answered = render(<AskUserCard ctx={ctx} row={done} />);
    expect(screen.getAllByText("选哪个方案？").length).toBeGreaterThan(0);
    expect(screen.getAllByText("乙").length).toBeGreaterThan(0);
    answered.unmount();

    const cancelled: ToolRow = {
      ...base,
      status: "error",
      output: {
        content: "cancelled",
        isError: true,
        durationMs: 1,
        meta: { kind: "ask_user", questions: questionRow.questions, cancelled: true },
      },
    };
    render(<AskUserCard ctx={ctx} row={cancelled} />);
    expect(screen.getByText(t("question.cancelled"))).toBeDefined();
  });

  it("QuestionCard 直接渲染：无写入通道（旧宿主）时提交禁用", () => {
    const ctx = fixtureCtx({ client: { ...fixtureCtx().client, settleQuestion: undefined } });
    render(<QuestionCard row={questionRow} ctx={ctx} />);
    expect(
      (screen.getByRole("button", { name: t("question.submit") }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(t("question.unsupported"))).toBeDefined();
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

  it("非 bash 工具三选项：本会话允许走 settleApproval 带 scope:'session'（E6）", async () => {
    const ctx = fixtureCtx();
    const settle = vi.spyOn(ctx.client, "settleApproval");
    render(<ApprovalCard row={pendingRow} ctx={ctx} />);
    fireEvent.click(screen.getByText(t("approval.sessionAllow")));
    expect(settle).toHaveBeenCalledWith("s-1", "r-1", "allowed-once", "session");
  });

  it("bash 族不提供本会话允许（工具级整会话放行过宽——E6 四仓对照裁定）", () => {
    const ctx = fixtureCtx();
    render(<ApprovalCard row={{ ...pendingRow, toolName: "bash" } as ApprovalRow} ctx={ctx} />);
    expect(screen.getByText(t("approval.allow"))).toBeDefined();
    expect(screen.queryByText(t("approval.sessionAllow"))).toBeNull();
  });

  it("per-tool 预览体（E6）：edit 显示 diff 行；bash 显示命令行；args 缺 → 通用回落", () => {
    const editCtx = fixtureCtx();
    render(
      <ApprovalCard
        row={
          {
            ...pendingRow,
            toolName: "edit",
            args: { file_path: "f.ts", old_string: "alpha\nbeta", new_string: "alpha\nBETA" },
          } as ApprovalRow
        }
        ctx={editCtx}
      />,
    );
    expect(screen.getByText("f.ts")).toBeDefined();
    expect(screen.getByText("BETA")).toBeDefined();

    cleanup();
    const bashCtx = fixtureCtx();
    render(
      <ApprovalCard
        row={
          {
            ...pendingRow,
            toolName: "bash",
            args: { command: "echo hi" },
          } as ApprovalRow
        }
        ctx={bashCtx}
      />,
    );
    expect(screen.getByText("echo hi")).toBeDefined();

    cleanup();
    const legacyCtx = fixtureCtx();
    render(<ApprovalCard row={pendingRow} ctx={legacyCtx} />); // 无 args（旧账本/超尺寸闸）→ digest 弱色行回落
    expect(screen.queryByText("f.ts")).toBeNull();
  });

  it("队列计数徽标（E6）：queueTotal > 1 时显示「待审批 N」", () => {
    const ctx = fixtureCtx();
    render(<ApprovalCard row={pendingRow} ctx={ctx} queueTotal={3} />);
    expect(screen.getByText(`${t("approval.queueCount")} 3`)).toBeDefined();
  });

  it("keyed 顶替件收到乐观回调（R171）：onDecided 可调——顶替件与官方件同行为缝", () => {
    let received: { onDecided?: (id: string) => void } = {};
    const slots = new Map<string, readonly SlotPart[]>([
      [
        "approval.view.demo-write",
        [
          (args: { onDecided?: (id: string) => void }) => {
            received = args;
            return "顶替件乙";
          },
        ],
      ],
    ]);
    const ctx = fixtureCtx({ slots } as Partial<WebPartContext>);
    render(<ApprovalQueueCard row={pendingRow} ctx={ctx} queueTotal={1} onDecided={() => {}} />);
    expect(screen.getByText("顶替件乙")).toBeDefined();
    expect(typeof received.onDecided).toBe("function"); // 透传在场——顶替件可接线乐观摘卡
  });

  it("队首单卡路由（E6 keyed 缝 approval.view.<工具名>）：槽件顶替生效、缺席回落通用卡", () => {
    const slots = new Map<string, readonly SlotPart[]>([
      ["approval.view.demo-write", [() => "审批顶替件甲"]],
    ]);
    const ctx = fixtureCtx({ slots } as Partial<WebPartContext>);
    render(<ApprovalQueueCard row={pendingRow} ctx={ctx} queueTotal={1} />);
    expect(screen.getByText("审批顶替件甲")).toBeDefined();

    const plainCtx = fixtureCtx();
    render(<ApprovalQueueCard row={pendingRow} ctx={plainCtx} queueTotal={1} />);
    expect(screen.getByRole("dialog", { name: t("approval.title") })).toBeDefined();
  });

  it("pending 审批接管 composer dock（R182 chain）：输入栏让位（隐藏但挂载），Enter 不发送", () => {
    const approvalRows: Row[] = [pendingRow];
    const ctx = dockCtx({
      store: {
        getSession: () => ({ rows: approvalRows, state: { busy: false } }),
        subscribe: () => () => {},
      },
    });
    const prompt = vi.spyOn(ctx.client, "prompt");
    const { container } = render(<ComposerDock {...ctx} />);
    expect(screen.getByRole("dialog", { name: t("approval.title") })).toBeDefined();
    // 输入栏仍在 DOM（草稿/DOM 态不丢），但被 display:none 藏起
    const barSlot = container.querySelector(".henira-composer-bar-slot") as HTMLElement;
    expect(barSlot.style.display).toBe("none");
    fireEvent.keyDown(container.querySelector("textarea") as HTMLTextAreaElement, { key: "Enter" });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("点击即退场（R171）：点允许卡立即离场不等回传；settle 失败回滚可重试", async () => {
    const approvalRows: Row[] = [pendingRow];
    const ctx = dockCtx({
      store: {
        getSession: () => ({ rows: approvalRows, state: { busy: false } }),
        subscribe: () => () => {},
      },
    });
    const settle = vi.spyOn(ctx.client, "settleApproval").mockRejectedValueOnce(new Error("net"));
    render(<ComposerDock {...ctx} />);
    expect(screen.getByRole("dialog", { name: t("approval.title") })).toBeDefined();
    fireEvent.click(screen.getByText(t("approval.allow")));
    // 点击瞬间卡已离场（乐观移除——不等 SSE settled）
    expect(screen.queryByRole("dialog", { name: t("approval.title") })).toBeNull();
    // settle 失败 → 回滚：卡回 dock 可重试
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: t("approval.title") })).toBeDefined(),
    );
    expect(settle).toHaveBeenCalledTimes(1);
    // 重试成功 → 再度离场
    settle.mockResolvedValueOnce(undefined as never);
    fireEvent.click(screen.getByText(t("approval.allow")));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: t("approval.title") })).toBeNull(),
    );
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it("审批卡键盘守卫（R180）：焦点在输入框时 Enter/Esc 不抢——打字不误放行/误拒绝", () => {
    const ctx = fixtureCtx();
    const settle = vi.spyOn(ctx.client, "settleApproval");
    render(
      <>
        <ApprovalCard row={pendingRow} ctx={ctx} />
        <textarea aria-label="probe" />
      </>,
    );
    const probe = screen.getByLabelText("probe");
    fireEvent.keyDown(probe, { key: "Enter" });
    fireEvent.keyDown(probe, { key: "Escape" });
    expect(settle).not.toHaveBeenCalled();
  });

  it("404 不回滚（R175）：审批对象已不存在（服务重启收口）——卡保持离场当已解决", async () => {
    const approvalRows: Row[] = [pendingRow];
    const ctx = dockCtx({
      store: {
        getSession: () => ({ rows: approvalRows, state: { busy: false } }),
        subscribe: () => () => {},
      },
    });
    // HttpError 形状（sdk client 非 2xx：message 照旧 + status 结构化）
    const notFound = Object.assign(new Error("POST /approvals → 404 approval not found"), {
      status: 404,
    });
    const settle = vi.spyOn(ctx.client, "settleApproval").mockRejectedValueOnce(notFound);
    render(<ComposerDock {...ctx} />);
    expect(screen.getByRole("dialog", { name: t("approval.title") })).toBeDefined();
    fireEvent.click(screen.getByText(t("approval.allow")));
    expect(screen.queryByRole("dialog", { name: t("approval.title") })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20)); // catch 链微任务排空
    // 404 → 不回滚：卡不复活（死卡复活再点再炸的循环不再存在）
    expect(screen.queryByRole("dialog", { name: t("approval.title") })).toBeNull();
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("已失效痕迹行（R175）：decision:'invalidated' 显「已失效（服务重启）」", () => {
    const ctx = fixtureCtx();
    render(
      <ApprovalSettledRow
        row={{ ...pendingRow, status: "settled", decision: "invalidated" } as ApprovalRow}
        ctx={ctx}
      />,
    );
    expect(screen.getByText(t("approval.decision.invalidated"))).toBeDefined();
    cleanup();
  });

  it("settled 行走 ApprovalSettledRow：中文决策词在场；scope:'session' 显「允许（本会话）」（R171 词表化）", () => {
    const ctx = fixtureCtx();
    render(
      <ApprovalSettledRow
        row={{ ...pendingRow, status: "settled", decision: "rejected" }}
        ctx={ctx}
      />,
    );
    expect(screen.getByText(t("approval.decision.rejected"))).toBeDefined();

    cleanup();
    render(
      <ApprovalSettledRow
        row={
          {
            ...pendingRow,
            status: "settled",
            decision: "allowed-once",
            scope: "session",
          } as ApprovalRow
        }
        ctx={ctx}
      />,
    );
    expect(screen.getByText(t("approval.decision.session"))).toBeDefined();
  });

  it("settled 痕迹行带参数摘要与展开全文（R171：点得开——当时批的命令可回看）", () => {
    const ctx = fixtureCtx();
    render(
      <ApprovalSettledRow
        row={
          {
            ...pendingRow,
            status: "settled",
            decision: "allowed-once",
            toolName: "bash",
            args: { command: "echo hi" },
          } as ApprovalRow
        }
        ctx={ctx}
      />,
    );
    // 摘要在头行可见；点开 = 完整 args JSON
    expect(screen.getByText("echo hi")).toBeDefined();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/"command"/).textContent).toContain("echo hi");
  });
});

describe("行级挂载点（D-057）", () => {
  const toolRow: Row = {
    kind: "tool",
    rowId: "t:t-1:1:c1",
    rowSeq: 2,
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

  it("官方默认读写卡可经 keyed 槽渲染（卸载即回落同一语义）", () => {
    const slots = new Map<string, readonly SlotPart[]>([["tool.call.view.read", [ReadCard]]]);
    render(<Conversation {...ctxWithRows([toolRow], slots)} />);
    expect(screen.getByText("已读取")).toBeDefined();
  });

  it("MCP 工具路由（E5）：精确 wire 名无注册 → 查 tool.call.view.mcp 总缝渲染官方 MCP 卡", () => {
    const mcpRow: Row = {
      kind: "tool",
      rowId: "t:t-1:1:m1",
      rowSeq: 3,
      turn: "t-1",
      step: 1,
      callId: "m1",
      name: "mcp__office__read_doc",
      status: "done",
      input: "{}",
      output: {
        content: "doc body",
        isError: false,
        durationMs: 3,
        meta: { kind: "mcp", server: "office", tool: "read_doc" },
      },
    };
    const slots = new Map<string, readonly SlotPart[]>([["tool.call.view.mcp", [McpCard]]]);
    render(<Conversation {...ctxWithRows([mcpRow], slots)} />);
    // 类别词 MCP + server 弱信息 + 工具名 Title Case（wire 名只走 title）
    expect(screen.getByText("MCP")).toBeDefined();
    expect(screen.getByText("Read Doc")).toBeDefined();
    expect(screen.getByText("office")).toBeDefined();
    expect(screen.queryByText("read_doc")).toBeNull();
  });

  it("MCP 工具总缝也缺席 → ToolView 通用卡兜底（工具名人类化）", () => {
    const mcpRow: Row = {
      kind: "tool",
      rowId: "t:t-1:1:m2",
      rowSeq: 4,
      turn: "t-1",
      step: 1,
      callId: "m2",
      name: "mcp__fs__read_file",
      status: "done",
      input: "{}",
      output: { content: "body", isError: false, durationMs: 3 },
    };
    render(<Conversation {...ctxWithRows([mcpRow], new Map())} />);
    expect(screen.getByText("Fs Read File")).toBeDefined();
    expect(screen.queryByText("mcp__fs__read_file")).toBeNull();
  });

  it("MCP 总缝渲染槽内件本身（审查 F1 回归）：第三方顶替件生效，不是硬编码官方卡", () => {
    const mcpRow: Row = {
      kind: "tool",
      rowId: "t:t-1:1:m3",
      rowSeq: 5,
      turn: "t-1",
      step: 1,
      callId: "m3",
      name: "mcp__office__read_doc",
      status: "done",
      input: "{}",
      output: { content: "doc body", isError: false, durationMs: 3 },
    };
    const slots = new Map<string, readonly SlotPart[]>([
      ["tool.call.view.mcp", [() => "总缝顶替件甲"]],
    ]);
    render(<Conversation {...ctxWithRows([mcpRow], slots)} />);
    expect(screen.getByText("总缝顶替件甲")).toBeDefined();
    expect(screen.queryByText("read_doc")).toBeNull(); // 官方 McpCard 未被渲染
  });

  it("字面名 mcp 的工具不走总缝（保留键守卫，审查 F9）：顶替件与官方卡都不渲染", () => {
    const literalRow: Row = {
      kind: "tool",
      rowId: "t:t-1:1:m4",
      rowSeq: 6,
      turn: "t-1",
      step: 1,
      callId: "m4",
      name: "mcp",
      status: "done",
      input: "{}",
      output: { content: "body", isError: false, durationMs: 3 },
    };
    const slots = new Map<string, readonly SlotPart[]>([
      ["tool.call.view.mcp", [() => "总缝顶替件甲"]],
    ]);
    render(<Conversation {...ctxWithRows([literalRow], slots)} />);
    expect(screen.queryByText("总缝顶替件甲")).toBeNull();
    expect(screen.getByText("Mcp")).toBeDefined(); // ToolView 通用卡兜底渲染工具名人类化
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
      rowSeq: 3,
      turn: "t-1",
      step: 1,
      text: "看图",
      streaming: false,
    };
    render(<Conversation {...ctxWithRows([assistantRow], slots)} />);
    expect(screen.getByText("画廊位在场")).toBeDefined();
  });

  it("usage 不上屏：token 数不进对话区（数据仍留在行上）", () => {
    const row: Row = {
      kind: "assistant",
      rowId: "a:t-1:1",
      rowSeq: 3,
      turn: "t-1",
      step: 1,
      text: "答",
      streaming: false,
      usage: { inputTokens: 12, outputTokens: 4 },
    };
    const { container } = render(<Conversation {...ctxWithRows([row], new Map())} />);
    expect(container.textContent).not.toContain("↑");
    expect(container.textContent).not.toContain("12");
  });

  it("官方模块注册区域槽 + per-tool keyed 卡（E5 起官方自己消费 keyed 缝；插件通道与安全模式同形）", () => {
    const registered: string[] = [];
    const chainRegistered: string[] = [];
    const host = fixtureCtx().host;
    webUiModule({
      registerSlot: (name) => {
        registered.push(name);
        return () => {};
      },
      replaceSlot: () => () => {},
      registerChainSlot: (name, entry) => {
        chainRegistered.push(`${name}#${entry.id}`);
        return () => {};
      },
      replaceChainSlot: () => () => {},
      host,
    });
    // D-062 UI 侧子项：layout 框架件 + sidebar.right 右栏件随骨架批入列（区域级五名）
    // E5：defaultToolViews 七工具键 + mcp 总缝，官方 keyed 注册示范（D-057 全语义闭环）
    // E6：defaultApprovalViews 八审批键（approval.view.<工具名>，词表 10→11）
    // R182：composer 座位拆出 composer.bar（fallback）+ composer.takeover chain（审批条目）
    // R183：四席官方默认件 = composer.model（单槽模型席）+ composer.dock（排队面板）；
    //       composer.left/right 官方空不注册
    // R184：ask_user 痕迹卡入 keyed 缝；提问接管条目入 chain（priority 5 压过审批）
    expect([...registered].sort()).toEqual([
      "approval.view.bash",
      "approval.view.edit",
      "approval.view.glob",
      "approval.view.grep",
      "approval.view.mcp",
      "approval.view.powershell",
      "approval.view.read",
      "approval.view.write",
      "composer",
      "composer.bar",
      "composer.dock",
      "composer.model",
      "conversation",
      "layout",
      "sidebar",
      "sidebar.right",
      "tool.call.view.ask_user",
      "tool.call.view.bash",
      "tool.call.view.edit",
      "tool.call.view.glob",
      "tool.call.view.grep",
      "tool.call.view.mcp",
      "tool.call.view.powershell",
      "tool.call.view.read",
      "tool.call.view.write",
    ]);
    expect(chainRegistered).toEqual(["composer.takeover#question", "composer.takeover#approval"]);
    expect(
      registered.every(
        (n) =>
          (
            ["layout", "sidebar", "conversation", "composer", "sidebar.right"] as WebSlotName[]
          ).includes(n as WebSlotName) ||
          n === "composer.bar" ||
          n === "composer.model" ||
          n === "composer.dock" ||
          n.startsWith("tool.call.view.") ||
          n.startsWith("approval.view."),
      ),
    ).toBe(true);
  });
});

describe("Conversation 长会话渲染（批 A'——虚拟化降级路径 / bottom-follow / 翻页）", () => {
  const userRow: Row = {
    kind: "user",
    rowId: "u:1",
    rowSeq: 1,
    turn: "t-1",
    text: "问",
    source: "send",
  };
  const assistantRow: AssistantRow = {
    kind: "assistant",
    rowId: "a:t-1:1",
    rowSeq: 2,
    turn: "t-1",
    step: 1,
    text: "答",
    streaming: false,
  };

  function ctxWithView(
    view: {
      rows: readonly Row[];
      state: { busy: boolean };
      hasOlder?: boolean;
      totalRows?: number;
    },
    overrides?: Partial<WebPartContext>,
  ) {
    return fixtureCtx({
      store: {
        getSession: () => view,
        subscribe: () => () => {},
        mergeOlderRows: () => true,
      },
      ...overrides,
    });
  }

  it("RowView memo：行引用不变的重渲染跳过（store 未变行同引用契约——renderMarkdown 调用次数不增）", () => {
    const view = {
      rows: [userRow, assistantRow],
      state: { busy: false },
      hasOlder: false,
      totalRows: 2,
    };
    const renderMarkdown = vi.fn((text: string) => text);
    const ctx = ctxWithView(view, {
      host: {
        ...fixtureCtx().host,
        renderMarkdown,
      },
    });
    const { rerender } = render(<Conversation {...ctx} />);
    const afterFirst = renderMarkdown.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0); // assistant 行渲染过
    rerender(<Conversation {...ctx} />); // 同 view 同 ctx 重渲 → memo 命中（行引用与 ctx 引用皆不变）
    expect(renderMarkdown.mock.calls.length).toBe(afterFirst);
  });

  it("回底按钮：上滚手势（wheel deltaY<0）出现、点击回底消失", () => {
    const view = {
      rows: [userRow, assistantRow],
      state: { busy: false },
      hasOlder: false,
      totalRows: 2,
    };
    const ctx = ctxWithView(view);
    render(<Conversation {...ctx} />);
    const back = t("conversation.backToBottom");
    expect(screen.queryByRole("button", { name: back })).toBeNull(); // 初始跟随无按钮
    const conv = document.querySelector(".henira-conversation");
    if (conv === null) throw new Error("conversation container missing");
    fireEvent.wheel(conv, { deltaY: -100 }); // 用户上滚 → 解除跟随
    expect(screen.getByRole("button", { name: back })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: back }));
    expect(screen.queryByRole("button", { name: back })).toBeNull(); // 回底恢复
  });

  it("滚顶翻页：hasOlder 且滚到顶 → sessionRows 拉页 → mergeOlderRows 前插（宿主缺方法不触发）", async () => {
    const olderRow: Row = {
      kind: "user",
      rowId: "u:0",
      rowSeq: 0,
      turn: "t-0",
      text: "更早",
      source: "send",
    };
    const mergeOlderRows = vi.fn(() => true);
    const sessionRows = vi.fn(async () => ({ rows: [olderRow], hasOlder: false }));
    const view = {
      rows: [userRow],
      state: { busy: false },
      hasOlder: true,
      totalRows: 61,
    };
    const withRows = fixtureCtx({
      store: {
        getSession: () => view,
        subscribe: () => () => {},
        mergeOlderRows,
      },
      client: { sessionRows } as unknown as HeniraClientLike,
    });
    render(<Conversation {...withRows} />);
    const conv = document.querySelector(".henira-conversation");
    if (conv === null) throw new Error("conversation container missing");
    Object.defineProperty(conv, "scrollTop", { value: 10, configurable: true });
    fireEvent.scroll(conv);
    await waitFor(() => expect(mergeOlderRows).toHaveBeenCalledWith("s-1", [olderRow]));
    expect(sessionRows).toHaveBeenCalledWith("s-1", { before: 1, limit: 60 }); // 游标 = 窗口首行 rowSeq

    // 宿主缺 sessionRows → 不拉页（静态窗口）
    const noRows = fixtureCtx({
      store: {
        getSession: () => view,
        subscribe: () => () => {},
        mergeOlderRows,
      },
    });
    cleanup();
    render(<Conversation {...noRows} />);
    const conv2 = document.querySelector(".henira-conversation");
    if (conv2 === null) throw new Error("conversation container missing");
    const calls = sessionRows.mock.calls.length;
    Object.defineProperty(conv2, "scrollTop", { value: 5, configurable: true });
    fireEvent.scroll(conv2);
    expect(sessionRows.mock.calls.length).toBe(calls); // 未增加
  });
});

describe("界面绑定状态（D-063）", () => {
  it("Composer：uiState 回填草稿 + 输入上报 updateUiState + 发送成功清持久层", async () => {
    const updateUiState = vi.fn();
    const prompt = vi.fn(async () => ({ queued: false, id: null }));
    const ctx = fixtureCtx({ uiState: { draft: "上次的草稿" }, updateUiState });
    ctx.client.prompt = prompt;
    renderComposer(ctx);
    const area = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toBe("上次的草稿")); // 回填
    fireEvent.change(area, { target: { value: "新输入" } });
    expect(updateUiState).toHaveBeenCalledWith({ draft: "新输入" });
    fireEvent.keyDown(area, { key: "Enter" });
    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith("s-1", "新输入", {
        modelId: undefined,
        reasoningEffort: undefined,
      }),
    );
    expect(updateUiState).toHaveBeenCalledWith({ draft: "" }); // 持久层同步清空
  });

  it("SessionList：折叠纯本地——初值非活跃组收起、toggle 不上报持久层", async () => {
    const updateUiState = vi.fn();
    const ctx = fixtureCtx({ updateUiState });
    const { container } = render(<SessionList {...ctx} />);
    await waitFor(() => {
      expect(container.querySelectorAll("button.henira-session-group").length).toBe(2);
    });
    // 初值（刷新/重启语义）：选中会话所在组（demo）展开、其余组收起——不上报、不落盘
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(1);
    });
    expect(updateUiState).not.toHaveBeenCalled();
    const headers = container.querySelectorAll("button.henira-session-group");
    fireEvent.click(headers[1] as HTMLButtonElement); // 展开 other 组（纯本地）
    await waitFor(() => {
      expect(container.querySelectorAll(".henira-sessions li")).toHaveLength(2);
    });
    expect(updateUiState).not.toHaveBeenCalled(); // 折叠状态不进持久层
  });
});

describe("右栏 tab 框架（D-062 sidebar.right 官方默认件）", () => {
  function rightCtx(overrides?: {
    rightPanel?: {
      open?: boolean;
      active?: string | null;
      tabs?: Array<{ id: string; kind: string }>;
    };
    updateUiState?: (patch: unknown) => void;
  }): WebPartContext {
    const updateUiState = overrides?.updateUiState ?? vi.fn();
    return fixtureCtx({
      updateUiState: updateUiState as never,
      uiState: { rightPanel: overrides?.rightPanel },
    });
  }

  it("收起态 = 窄轨（＋ 常在入口——面板内 ＋ 会永远打不开的死锁防）；开态全栏无轨", () => {
    const updateUiState = vi.fn();
    const { container } = render(
      <RightPanel {...rightCtx({ rightPanel: { open: false }, updateUiState })} />,
    );
    // 窄轨：只有 ＋，无 tab 条 / 面板体
    expect(container.querySelector(".henira-right-rail")).not.toBeNull();
    expect(container.querySelector(".henira-right-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("rightPanel.new") }));
    expect(updateUiState).toHaveBeenCalledTimes(1);
    const patch = updateUiState.mock.calls[0][0] as {
      rightPanel: { open: boolean; tabs: unknown[] };
    };
    expect(patch.rightPanel.open).toBe(true);
    expect(patch.rightPanel.tabs).toHaveLength(1);
    cleanup();
    // 开态：全栏在、窄轨不在
    const open = render(<RightPanel {...rightCtx({ rightPanel: { open: true } })} />);
    expect(open.container.querySelector(".henira-right-rail")).toBeNull();
    expect(open.container.querySelector(".henira-right-panel")).not.toBeNull();
  });

  it("＋ 新建空白面板展位 tab：rightPanel 总账经 updateUiState 持久化（open:true + active 指向新 tab）", () => {
    const updateUiState = vi.fn();
    const { container } = render(
      <RightPanel {...rightCtx({ rightPanel: { open: true }, updateUiState })} />,
    );
    expect(container.querySelector(".henira-right-panel")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("rightPanel.new") }));
    expect(updateUiState).toHaveBeenCalledTimes(1);
    const patch = updateUiState.mock.calls[0][0] as {
      rightPanel: { open: boolean; active: string; tabs: Array<{ id: string; kind: string }> };
    };
    expect(patch.rightPanel.open).toBe(true);
    expect(patch.rightPanel.tabs).toHaveLength(1);
    expect(patch.rightPanel.tabs[0]?.kind).toBe("blank");
    expect(patch.rightPanel.active).toBe(patch.rightPanel.tabs[0]?.id);
  });

  it("tab 条渲染已开面板 + ✕ 关闭末个 tab → open:false（整栏收起）", () => {
    const updateUiState = vi.fn();
    const { container } = render(
      <RightPanel
        {...rightCtx({
          rightPanel: { open: true, active: "b1", tabs: [{ id: "b1", kind: "blank" }] },
          updateUiState,
        })}
      />,
    );
    expect(
      (container.querySelector(".henira-right-tab") as HTMLElement).getAttribute("data-active"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: `${t("rightPanel.close")} ${t("rightPanel.blank")}` }),
    );
    const patch = updateUiState.mock.calls[0][0] as {
      rightPanel: { open: boolean; tabs: unknown[] };
    };
    expect(patch.rightPanel.open).toBe(false);
    expect(patch.rightPanel.tabs).toHaveLength(0);
  });

  it("⌄ 清单列已开面板；⤢ 最大化是瞬态视图（面板体出现空占位）", () => {
    const { container } = render(
      <RightPanel
        {...rightCtx({
          rightPanel: { open: true, active: "b1", tabs: [{ id: "b1", kind: "blank" }] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("rightPanel.list") }));
    expect(screen.getByRole("menu")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect((container.querySelector(".henira-right-empty") as HTMLElement).textContent).toBe(
      t("rightPanel.placeholder"),
    );
    // ⤢ 最大化（瞬态，不落盘）
    fireEvent.click(screen.getByRole("button", { name: t("rightPanel.maximize") }));
    expect(container.querySelector(".henira-right-panel--max")).not.toBeNull();
    expect(screen.getByRole("button", { name: t("rightPanel.restore") })).not.toBeNull();
  });
});

describe("设置弹窗（左菜单右内容——只列现有三项）", () => {
  it("默认分区渲染主题页（下拉列官方双主题——原生 select 退场，HeniraSelect 自制弹层）；模型管理页无全局默认模型入口（用户裁定 2026-11-19）+ 行带视觉徽章", async () => {
    const putSettings = vi.fn().mockResolvedValue({ version: 1 });
    const onTheme = vi.fn();
    const ctx = fixtureCtx({
      theme: "dark",
      onTheme,
      closeSettings: vi.fn(),
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, model: "deepseek/deepseek-v4-flash" }),
        listModels: async () => ({
          providers: {
            deepseek: { models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }] },
          },
        }),
        listProviders: async () => ({
          providers: [
            {
              id: "deepseek",
              name: "DeepSeek",
              reasoning: "none",
              connected: true,
              models: [
                {
                  id: "deepseek-v4-flash",
                  name: "DeepSeek V4 Flash",
                  contextWindow: 1048576,
                  vision: true,
                  enabled: true,
                },
              ],
            },
          ],
        }),
        putSettings,
        putCredential: async () => {},
      },
    });
    render(<SettingsModal ctx={ctx} section="theme" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: t("settings.title") });
    expect(dialog).not.toBeNull();
    // 主题页：触发钮显示当前主题「深色」；点开面板选「浅色」走 onTheme
    //（定位走容器内 class——左导航分区钮的可访问名同为「主题」，role 查询撞名）
    const themeTrigger = dialog.querySelector(".henira-select-trigger") as HTMLButtonElement;
    expect(themeTrigger.textContent).toContain(t("settings.theme.dark"));
    fireEvent.click(themeTrigger);
    fireEvent.click(await screen.findByRole("option", { name: t("settings.theme.light") }));
    expect(onTheme).toHaveBeenCalledWith("light", undefined);
    // 切模型管理页：无「当前模型」入口（收敛裁定）；行徽章带 1M + 视觉
    fireEvent.click(screen.getByRole("button", { name: t("settings.section.models") }));
    await screen.findByText("DeepSeek V4 Flash");
    expect(screen.queryByText(t("settings.models.current"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("settings.save") })).toBeNull();
    const rowMeta = document.querySelector(".henira-model-meta")?.textContent ?? "";
    expect(rowMeta).toContain("1M");
    expect(rowMeta).toContain(t("settings.models.visionBadge"));
    // putSettings 只被主题切换调过一次（ui.theme）；模型管理页不再写全局 model
    expect(putSettings).toHaveBeenCalledTimes(1);
    expect(putSettings).toHaveBeenCalledWith({ ui: { theme: "light" } });
  });

  it("语言页显示实际生效语言（宿主 ctx.locale）：包卸载 boot 回落官方后不读磁盘旧值漂移显示（审查 P3-b）", async () => {
    const ctx = fixtureCtx({
      locale: "zh", // 宿主生效值（boot 时磁盘上的 fr 包不在场已回落官方）
      closeSettings: vi.fn(),
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, ui: { locale: "fr" } }), // 磁盘残留装不上的语言
        listUiAssets: async () => ({ locales: [], themes: [] }),
      },
    });
    render(<SettingsModal ctx={ctx} section="locale" onClose={() => {}} />);
    // 触发钮显示生效语言（不是磁盘残留的 fr）
    const localeTrigger = await screen.findByRole("button", { name: t("settings.locale") });
    expect(localeTrigger.textContent).toContain(t("settings.locale.zh"));
  });

  it("外观页（R188）：预览打开方式两行 + 分段切换写 ctx.preview.setMode", async () => {
    const setMode = vi.fn();
    const base = fixtureCtx();
    const ctx: WebPartContext = {
      ...base,
      preview: {
        settings: { file: "panel", image: "modal" },
        open: vi.fn(),
        setMode,
        modal: null,
        close: vi.fn(),
      },
    };
    render(<SettingsModal ctx={ctx} section="theme" onClose={() => {}} />);
    const fileLabel = await screen.findByText(t("settings.preview.file"));
    const fileRow = fileLabel.closest(".henira-settings-row") as HTMLElement;
    const modalButton = [...fileRow.querySelectorAll("button")].find(
      (b) => b.textContent === t("settings.preview.modal"),
    );
    expect(modalButton).toBeDefined();
    fireEvent.click(modalButton as HTMLButtonElement);
    expect(setMode).toHaveBeenCalledWith("file", "modal");
    // 图片行默认弹窗档为选中态
    const imageLabel = screen.getByText(t("settings.preview.image"));
    const imageRow = imageLabel.closest(".henira-settings-row") as HTMLElement;
    expect(imageRow.querySelector('button[data-active="true"]')?.textContent).toBe(
      t("settings.preview.modal"),
    );
  });

  it("模型管理面板（四视图）：分组+开关回调 → 厂商选择页 → 连接表单 → 自定义表单", async () => {
    const setModelEnabled = vi.fn().mockResolvedValue(undefined);
    const connectProvider = vi.fn().mockResolvedValue(undefined);
    const putCustomProvider = vi.fn().mockResolvedValue({ id: "user-relay-1" });
    const disconnectProvider = vi.fn().mockResolvedValue(undefined);
    const notifyCatalog = vi.fn();
    const ctx = fixtureCtx({
      closeSettings: vi.fn(),
      notifyModelCatalogChanged: notifyCatalog,
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, model: "deepseek/deepseek-chat" }),
        listModels: async () => ({ providers: {} }),
        listProviders: async () => ({
          providers: [
            {
              id: "deepseek",
              name: "DeepSeek",
              reasoning: "none",
              connected: true,
              models: [
                {
                  id: "deepseek-chat",
                  name: "DeepSeek Chat",
                  contextWindow: 131072,
                  enabled: true,
                },
                { id: "deepseek-reasoner", enabled: false },
              ],
            },
            {
              id: "user-relay-1",
              name: "relay station",
              connected: true,
              models: [{ id: "my-model", enabled: true }],
            },
            {
              id: "moonshotai",
              name: "Moonshot",
              connected: false, // 主列表不列未连接厂商——连接态只在挑选页显示
              models: [{ id: "kimi-x", enabled: true }],
            },
          ],
        }),
        listModelPresets: async () => ({
          presets: {
            deepseek: { name: "DeepSeek", models: { "deepseek-chat": {} } },
            anthropic: { name: "Anthropic", models: { "claude-x": {} } },
            moonshotai: { name: "Moonshot", models: { "kimi-x": {} } },
          },
        }),
        refreshModelPresets: async () => ({ ok: false }),
        setModelEnabled,
        connectProvider,
        putCustomProvider,
        disconnectProvider,
      },
    });
    render(<SettingsModal ctx={ctx} section="models" onClose={() => {}} />);
    await screen.findByText("DeepSeek"); // 分组头（显示名）
    // 模型行：显示名 + 上下文窗紧凑显示 + 开关（off 行在场）
    expect(screen.getByTitle("deepseek/deepseek-chat")).not.toBeNull();
    expect(screen.getByText("131k")).not.toBeNull();
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3); // deepseek×2 + relay×1（moonshot 未连接：不进主列表）
    // 主列表只列已连接厂商——未连接组与模型行整块不渲染
    const groups = document.querySelectorAll(".henira-provider-group");
    expect(groups).toHaveLength(2);
    expect(
      Array.from(groups).some((g) => g.textContent?.includes(t("settings.models.notConnected"))),
    ).toBe(false);
    expect(screen.queryByText("Moonshot")).toBeNull();
    const off = switches.find((s) => s.getAttribute("aria-checked") === "false");
    expect(off).toBeDefined();
    fireEvent.click(off as HTMLElement);
    await waitFor(() =>
      expect(setModelEnabled).toHaveBeenCalledWith("deepseek", "deepseek-reasoner", true),
    );
    expect(notifyCatalog).toHaveBeenCalled(); // 开关=目录变更广播（composer 即时重拉）
    // 断开=目录广播（composer 当场回落，不等设置关闭——用户纠偏 2026-11-19）
    notifyCatalog.mockClear();
    const dsGroup = Array.from(document.querySelectorAll(".henira-provider-group")).find((g) =>
      g.textContent?.includes("DeepSeek"),
    );
    fireEvent.click(dsGroup?.querySelector(".henira-provider-disconnect") as HTMLElement);
    await waitFor(() => expect(disconnectProvider).toHaveBeenCalledWith("deepseek"));
    expect(notifyCatalog).toHaveBeenCalled();
    // 厂商选择页：返回在顶部工具行 + 自定义入口第一行（用户拍板 2026-11-19）+ 热门节
    fireEvent.click(screen.getByRole("button", { name: t("settings.models.addProvider") }));
    await screen.findByText(t("settings.models.hot"));
    const toolbar = document.querySelector(".henira-models-toolbar");
    expect(toolbar?.textContent).toContain(t("settings.models.back"));
    const firstItem = document.querySelector(".henira-provider-picker .henira-picker-item");
    expect(firstItem?.textContent).toContain(t("settings.models.customEntry"));
    // 连接态标只住挑选页：未连接厂商在这里显示「未连接」，已连接显示 is-on
    const pickerItems = Array.from(document.querySelectorAll(".henira-picker-item"));
    const moonItem = pickerItems.find((el) => el.textContent?.includes("Moonshot"));
    expect(moonItem?.textContent).toContain(t("settings.models.notConnected"));
    const deepItem = pickerItems.find((el) => el.textContent?.includes("DeepSeek"));
    expect(deepItem?.querySelector(".henira-picker-state.is-on")).not.toBeNull();
    fireEvent.click(screen.getByText("Anthropic"));
    // 连接已知厂商：空 key 本地拦（词表文案——服务端 400 英文原文不出用户眼前，审查 P2）
    const keyInput = await screen.findByPlaceholderText(t("settings.models.keyPlaceholder"));
    fireEvent.click(screen.getByRole("button", { name: t("settings.models.submit") }));
    expect(screen.getByText(t("settings.models.errKey"))).not.toBeNull();
    expect(connectProvider).not.toHaveBeenCalled();
    fireEvent.change(keyInput, { target: { value: "sk-abc" } });
    fireEvent.click(screen.getByRole("button", { name: t("settings.models.submit") }));
    await waitFor(() => expect(connectProvider).toHaveBeenCalledWith("anthropic", "sk-abc"));
    // 回选择页 → 自定义入口 → 表单校验 + 提交回调
    fireEvent.click(screen.getByRole("button", { name: t("settings.models.addProvider") }));
    fireEvent.click(screen.getByText(t("settings.models.customEntry")));
    const urlInput = await screen.findByPlaceholderText("https://api.example.com/v1");
    fireEvent.change(urlInput, { target: { value: "https://relay.example.com/v1" } });
    fireEvent.click(screen.getByRole("button", { name: t("settings.models.submit") }));
    await waitFor(() => expect(putCustomProvider).not.toHaveBeenCalled()); // 缺 model-id 拦下
    fireEvent.change(screen.getAllByPlaceholderText(t("settings.models.formModelId"))[0], {
      target: { value: "my-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("settings.models.submit") }));
    await waitFor(() =>
      expect(putCustomProvider).toHaveBeenCalledWith({
        baseUrl: "https://relay.example.com/v1",
        models: [{ model: "my-model" }],
      }),
    );
  });
});

describe("官方框架件 LayoutFrame（D-062 layout 槽——宿主零界面 JSX 的载体）", () => {
  function frameCtx(overrides?: Partial<WebPartContext>): WebPartContext {
    const stub: WebPart = () => <div data-stub="part" />;
    return fixtureCtx({
      layout: "full",
      sessionCwd: "C:\\demo",
      slots: new Map<string, readonly SlotPart[]>([
        ["sidebar", [stub]],
        ["conversation", [stub]],
        ["composer", [stub]],
        ["sidebar.right", [RightPanel]], // 真件——收起轨形态可断言（stub 是哑 div 没有轨）
      ]),
      ...overrides,
    });
  }

  it("full：三栏骨架在场 + header 目录名 · 标题占位 + 齿轮开设置", () => {
    const openSettings = vi.fn();
    const { container } = render(<LayoutFrame {...frameCtx({ openSettings })} />);
    expect(container.querySelector(".henira-header")).not.toBeNull();
    expect((container.querySelector(".henira-header-dir") as HTMLElement).textContent).toBe("demo");
    expect((container.querySelector(".henira-header-title") as HTMLElement).textContent).toBe(
      t("app.untitled"),
    );
    expect(container.querySelectorAll("[data-stub='part']")).toHaveLength(3); // 三区
    expect(container.querySelector(".henira-right-rail")).not.toBeNull(); // 右栏收起轨（＋ 常在入口）
    fireEvent.click(screen.getByRole("button", { name: t("settings.open") }));
    expect(openSettings).toHaveBeenCalled(); // 缺省分区由宿主定（默认主题页）
  });

  it("conversation 区域槽可整块顶替（「一切皆插件」不回退）", () => {
    const stub: WebPart = () => <div data-stub="part" />;
    const slots = new Map<string, readonly SlotPart[]>([
      ["sidebar", [stub]],
      ["conversation", [() => "自定义会话区"]],
      ["composer", [stub]],
      ["sidebar.right", [RightPanel]],
    ]);
    const { container } = render(<LayoutFrame {...frameCtx({ slots })} />);
    expect(container.textContent).toContain("自定义会话区");
    expect(container.querySelector(".henira-conversation")).toBeNull(); // 官方 Conversation 未渲染
  });

  it("layout=composer：只渲染输入区（D-043 挑件语义——无 header/侧栏）", () => {
    const { container } = render(<LayoutFrame {...frameCtx({ layout: "composer" })} />);
    expect(container.querySelector(".henira-header")).toBeNull();
    expect(container.querySelectorAll("[data-stub='part']")).toHaveLength(1);
  });

  it("safeMode 徽标 + settingsSection 非空渲染设置弹窗", () => {
    const closeSettings = vi.fn();
    const { container } = render(
      <LayoutFrame {...frameCtx({ safeMode: true, settingsSection: "theme", closeSettings })} />,
    );
    expect(container.textContent).toContain(t("app.safeMode"));
    expect(screen.getByRole("dialog", { name: t("settings.title") })).not.toBeNull();
  });
});

describe("思考档按次绑定（骨架批）", () => {
  function ctxWithRows(rows: Row[]): WebPartContext {
    const snapshot = { rows, state: { busy: false } }; // 引用稳定——useSyncExternalStore 语义
    return fixtureCtx({
      store: {
        getSession: () => snapshot,
        subscribe: () => () => {},
      },
    });
  }

  it("模型条目显示：行首显示名、行尾上下文窗/视觉徽章；纯 id 条目无徽章排（模型目录收敛批）", async () => {
    const ctx = fixtureCtx();
    const providers = {
      deepseek: {
        name: "DeepSeek",
        baseUrl: "x",
        models: [
          {
            id: "deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            contextWindow: 1048576,
            vision: true,
          },
          { id: "deepseek-flash", name: "DeepSeek Flash" },
        ],
      },
    };
    render(
      <ModelSelect
        ctx={ctx}
        value=""
        onChange={() => {}}
        ariaLabel={t("composer.model")}
        providers={providers}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("composer.model") }));
    const items = await screen.findAllByRole("option");
    expect(items).toHaveLength(2);
    const first = items[0] as HTMLElement;
    expect(first.querySelector(".henira-model-item-label")?.textContent).toBe("DeepSeek V4 Flash");
    expect(first.getAttribute("title")).toBe("deepseek/deepseek-v4-flash"); // 完整 id 住 title
    const meta = first.querySelector(".henira-model-item-meta")?.textContent ?? "";
    expect(meta).toContain("1M"); // 上下文窗紧凑显示
    expect(meta).toContain(t("settings.models.visionBadge"));
    const second = items[1] as HTMLElement;
    expect(second.querySelector(".henira-model-item-label")?.textContent).toBe("DeepSeek Flash");
    expect(second.querySelector(".henira-model-item-meta")).toBeNull(); // 无徽章位不渲染排
  });

  it("触发钮显示模型显示名（不出厂商 id）；绑定值目录里失效 → 回落清单首个", async () => {
    const ctx = fixtureCtx();
    const providers = {
      deepseek: {
        name: "DeepSeek",
        baseUrl: "x",
        models: [
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
          { id: "deepseek-flash", name: "DeepSeek Flash" },
        ],
      },
    };
    const onChange = vi.fn();
    render(
      <ModelSelect
        ctx={ctx}
        value="deepseek/deepseek-v4-flash"
        onChange={onChange}
        ariaLabel={t("composer.model")}
        providers={providers}
      />,
    );
    // 按钮显示显示名——provider/model 裸串不出现在触发钮上
    const trigger = screen.getByRole("button", { name: t("composer.model") });
    expect(trigger.querySelector(".henira-model-trigger-label")?.textContent).toBe(
      "DeepSeek V4 Flash",
    );
    expect(trigger.textContent).not.toContain("deepseek/");
    expect(onChange).not.toHaveBeenCalled(); // 绑定有效不纠正
    cleanup();

    // 绑定失效（断开后目录里已无该厂商）→ 回落清单首个并回调纠正（按钮不挂已断厂商）
    const stray = vi.fn();
    render(
      <ModelSelect
        ctx={ctx}
        value="deepseek/deepseek-flash"
        onChange={stray}
        ariaLabel={t("composer.model")}
        providers={{
          agnes: {
            name: "Agnes AI",
            baseUrl: "x",
            models: [{ id: "agnes-3.0-flash", name: "Agnes 3.0 Flash" }],
          },
        }}
      />,
    );
    await waitFor(() => expect(stray).toHaveBeenCalledWith("agnes/agnes-3.0-flash"));
    cleanup();

    // 目录为空/未到 → 不动绑定（目录外绑定不误换），按钮显示去前缀模型 id
    const untouched = vi.fn();
    render(
      <ModelSelect
        ctx={ctx}
        value="mock/mock-1"
        onChange={untouched}
        ariaLabel={t("composer.model")}
        providers={{}}
      />,
    );
    expect(untouched).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t("composer.model") }).textContent).toContain(
      "mock-1",
    );
  });

  it("思考档数据驱动：未知厂商置灰「—」；zhipu 数据四档（关/低/高/最高）；agnes 两档（关/开）", async () => {
    const noneCtx = fixtureCtx({
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, model: "foo/bar" }),
        listModels: async () => ({
          providers: { foo: { models: [{ id: "bar", name: "Bar" }] } },
        }),
      },
    });
    const { container } = renderComposer(noneCtx);
    await waitFor(() => {
      if (container.querySelector(".henira-thinking-select[data-disabled='true']") === null) {
        throw new Error("thinking control not grayed");
      }
    });
    expect(container.querySelector(".henira-thinking-select button")).toBeNull();
    expect(container.textContent).toContain("—");
    cleanup();

    const glmCtx = fixtureCtx({
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, model: "zhipuai-coding-plan/glm-5.3-flash" }),
        listModels: async () => ({
          providers: {
            "zhipuai-coding-plan": {
              models: [
                {
                  id: "glm-5.3-flash",
                  name: "GLM-5.3-Flash",
                  contextWindow: 1000000,
                  reasoning: true,
                  reasoningOptions: [{ type: "effort", values: ["low", "high", "max"] }],
                },
              ],
            },
          },
        }),
      },
    });
    const glm = renderComposer(glmCtx);
    // 数据驱动档位：effort 值直通——关/低/高/最高 四档（max 独立成档，不归并）；
    // 点开自制面板断言选项排（原生 select 退场）
    fireEvent.click(await screen.findByRole("button", { name: t("composer.thinking") }));
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options.map((o) => o.textContent)).toEqual([
      t("composer.thinking.off"),
      t("composer.thinking.low"),
      t("composer.thinking.high"),
      t("composer.thinking.max"),
    ]);
    void glm;
    cleanup();

    // agnes 数据仅 toggle → 两档「关/开」（开承载 medium）
    const agnesUpdateUiState = vi.fn();
    const agnesCtx = fixtureCtx({
      updateUiState: agnesUpdateUiState,
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, model: "agnes/agnes-3.0-flash" }),
        listModels: async () => ({
          providers: {
            agnes: {
              models: [
                {
                  id: "agnes-3.0-flash",
                  name: "Agnes 3.0 Flash",
                  reasoning: true,
                  reasoningOptions: [{ type: "toggle" }],
                },
              ],
            },
          },
        }),
      },
    });
    renderComposer(agnesCtx);
    fireEvent.click(await screen.findByRole("button", { name: t("composer.thinking") }));
    const agnesOptions = await screen.findAllByRole("option");
    expect(agnesOptions.map((o) => o.textContent)).toEqual([
      t("composer.thinking.off"),
      t("composer.thinking.on"),
    ]);
    // 「开」承载 medium（原 select option value 断言的行为化等价——点它落会话记忆）
    fireEvent.click(screen.getByRole("option", { name: t("composer.thinking.on") }));
    expect(agnesUpdateUiState).toHaveBeenCalledWith({ reasoningEffort: "medium" });
  });

  it("选档写会话记忆（updateUiState）；发送携带 {modelId, reasoningEffort}", async () => {
    const updateUiState = vi.fn();
    const promptSpy = vi.fn(async () => ({ queued: false, id: null }));
    const ctx = fixtureCtx({
      updateUiState,
      uiState: { model: "zhipuai-coding-plan/glm-5.3-flash" }, // 会话级记忆回填
      client: {
        ...fixtureCtx().client,
        prompt: promptSpy,
        getSettings: async () => ({ version: 1, model: "deepseek/deepseek-v4-flash" }),
        listModels: async () => ({
          providers: {
            "zhipuai-coding-plan": {
              models: [
                {
                  id: "glm-5.3-flash",
                  name: "GLM-5.3-Flash",
                  contextWindow: 1000000,
                  reasoning: true,
                  reasoningOptions: [{ type: "effort", values: ["low", "high", "max"] }],
                },
              ],
            },
          },
        }),
      },
    });
    const { container } = renderComposer(ctx);
    // 会话绑定优先于全局默认（触发钮显示 glm）
    const trigger = await screen.findByRole("button", { name: t("composer.model") });
    await waitFor(() => expect(trigger.textContent).toContain("GLM-5.3-Flash"));
    const thinkTrigger = await screen.findByRole("button", { name: t("composer.thinking") });
    fireEvent.click(thinkTrigger);
    fireEvent.click(await screen.findByRole("option", { name: t("composer.thinking.high") }));
    expect(updateUiState).toHaveBeenCalledWith({ reasoningEffort: "high" });
    const area = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "问一句" } });
    fireEvent.keyDown(area, { key: "Enter" });
    await waitFor(() =>
      expect(promptSpy).toHaveBeenCalledWith("s-1", "问一句", {
        modelId: "zhipuai-coding-plan/glm-5.3-flash",
        reasoningEffort: "high",
      }),
    );
    void container;
  });

  it("切模型档位 clamp：存储 high 在 toggle-only 模型（agnes）上不合法 → 落「开」=medium 并写会话记忆", async () => {
    const updateUiState = vi.fn();
    const ctx = fixtureCtx({
      updateUiState,
      uiState: { model: "agnes/agnes-3.0-flash", reasoningEffort: "high" }, // 旧模型档位残留
      client: {
        ...fixtureCtx().client,
        getSettings: async () => ({ version: 1, model: "agnes/agnes-3.0-flash" }),
        listModels: async () => ({
          providers: {
            agnes: {
              models: [
                {
                  id: "agnes-3.0-flash",
                  name: "Agnes 3.0 Flash",
                  reasoning: true,
                  reasoningOptions: [{ type: "toggle" }],
                },
              ],
            },
          },
        }),
      },
    });
    renderComposer(ctx);
    await waitFor(() => expect(updateUiState).toHaveBeenCalledWith({ reasoningEffort: "medium" }));
    // 触发钮显示为「开」（medium 的 toggle 文案）
    const thinkTrigger = await screen.findByRole("button", { name: t("composer.thinking") });
    await waitFor(() => expect(thinkTrigger.textContent).toContain(t("composer.thinking.on")));
  });

  it("思考档不上屏：行上徽章移除（档位只在 composer 控件）", () => {
    const row: Row = {
      kind: "assistant",
      rowId: "a:t-1:1",
      rowSeq: 1,
      turn: "t-1",
      step: 1,
      text: "答",
      streaming: false,
      reasoningEffort: "high",
    };
    render(<Conversation {...ctxWithRows([row])} />);
    expect(screen.queryByTitle(t("composer.thinking"))).toBeNull();
  });
});

describe("插件页（批 C，plugins.md §6.4 管理面）", () => {
  it("列表状态徽章 + 官方件只读 + 确认/启停/卸载接线", async () => {
    const base = fixtureCtx();
    const calls: string[] = [];
    const ctx: WebPartContext = {
      ...base,
      client: {
        ...base.client,
        listPlugins: async () => ({
          plugins: [
            {
              id: "plugin-loop",
              version: "0.0.0",
              name: "plugin-loop",
              forms: ["engine"] as const,
              enabled: true,
              state: "loaded" as const,
              warnings: [],
            },
            {
              id: "bad-pack",
              version: "1.0.0",
              name: "bad-pack",
              forms: ["ui"] as const,
              enabled: true,
              state: "failed" as const,
              reason: "装载失败：boom",
              warnings: [],
            },
            {
              id: "new-pack",
              version: "2.0.0",
              name: "new-pack",
              forms: ["engine"] as const,
              enabled: true,
              state: "awaiting-confirm" as const,
              warnings: [],
            },
          ],
          fingerprint: "abc123456789",
        }),
        setPluginEnabled: async (id, enabled) => {
          calls.push(`enabled:${id}:${String(enabled)}`);
        },
        confirmPlugin: async (id, version) => {
          calls.push(`confirm:${id}:${version}`);
        },
        removePlugin: async (id) => {
          calls.push(`remove:${id}`);
        },
      },
    };
    const { container } = render(<SettingsModal ctx={ctx} section="plugins" onClose={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain("bad-pack"));
    expect(container.textContent).toContain(zh["settings.plugins.state.failed"]);
    expect(container.textContent).toContain(zh["settings.plugins.state.confirm"]);
    expect(container.textContent).toContain(zh["settings.plugins.builtinSection"]);
    // 内置件只读：switch 只有两个第三方件
    expect(container.querySelectorAll('button[role="switch"]').length).toBe(2);
    // 确认按钮 → confirmPlugin（版本取行上的 version）
    const confirmButton = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === zh["settings.plugins.confirm"],
    );
    expect(confirmButton).toBeDefined();
    fireEvent.click(confirmButton as HTMLButtonElement);
    await waitFor(() => expect(calls).toContain("confirm:new-pack:2.0.0"));
    // 启停开关 → setPluginEnabled
    const firstSwitch = container.querySelector('button[role="switch"]') as HTMLButtonElement;
    fireEvent.click(firstSwitch);
    await waitFor(() => expect(calls.some((c) => c.startsWith("enabled:bad-pack:"))).toBe(true));
    // 卸载（window.confirm 确认后）→ removePlugin
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const removeButtons = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === zh["settings.plugins.remove"],
    );
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[0] as HTMLButtonElement);
    await waitFor(() => expect(calls.some((c) => c.startsWith("remove:"))).toBe(true));
    confirmSpy.mockRestore();
  });
});

describe("插件页 MCP 详情（C5，D-064）", () => {
  it("mcp server 行渲染（名/目标/确认徽章）+ 确认按钮接线 confirmPluginMcp；plugin-mcp 可停用不可卸载", async () => {
    const base = fixtureCtx();
    const calls: string[] = [];
    const ctx: WebPartContext = {
      ...base,
      client: {
        ...base.client,
        listPlugins: async () => ({
          plugins: [
            {
              id: "plugin-mcp",
              version: "0.0.0",
              name: "plugin-mcp",
              forms: ["engine"] as const,
              enabled: true,
              state: "loaded" as const,
              warnings: [],
            },
            {
              id: "echo-mcp",
              version: "1.0.0",
              name: "echo-mcp",
              forms: ["content"] as const,
              enabled: true,
              state: "loaded" as const,
              mcp: [
                { name: "echo", target: "node stub.js", confirmed: true },
                { name: "cred", target: "node stub.js", confirmed: false },
              ],
              warnings: [],
            },
          ],
          fingerprint: "fedcba987654",
        }),
        setPluginEnabled: async (id, enabled) => {
          calls.push(`enabled:${id}:${String(enabled)}`);
        },
        confirmPluginMcp: async (id) => {
          calls.push(`confirmMcp:${id}`);
        },
        removePlugin: async (id) => {
          calls.push(`remove:${id}`);
        },
      },
    };
    const { container } = render(<SettingsModal ctx={ctx} section="plugins" onClose={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain("echo-mcp"));
    // server 名 + 目标串可见（§6.4：连接目标必须在详情可见）
    expect(container.textContent).toContain("cred");
    expect(container.textContent).toContain("node stub.js");
    // 徽章：已确认 + 待确认各一
    expect(container.textContent).toContain(zh["settings.plugins.mcpConfirmed"]);
    expect(container.textContent).toContain(zh["settings.plugins.mcpAwaiting"]);
    // 确认按钮（有未确认 server 才出）→ confirmPluginMcp
    const confirmButton = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === zh["settings.plugins.mcpConfirm"],
    );
    expect(confirmButton).toBeDefined();
    fireEvent.click(confirmButton as HTMLButtonElement);
    await waitFor(() => expect(calls).toContain("confirmMcp:echo-mcp"));
    // plugin-mcp：内置外圈件——有停用开关（可关）、无卸载钮（不可卸）、归入内置段
    const switches = container.querySelectorAll('button[role="switch"]');
    const mcpToggle = [...switches].find(
      (el) => el.closest('[data-plugin-id="plugin-mcp"]') !== null,
    );
    expect(mcpToggle).toBeDefined();
    const removeButtons = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === zh["settings.plugins.remove"],
    );
    expect(removeButtons.every((b) => b.closest('[data-plugin-id="plugin-mcp"]') === null)).toBe(
      true,
    );
    expect(container.textContent).toContain(zh["settings.plugins.builtinSection"]);
  });
});

describe("统一下拉基础件（基础件批 2026-11-20）", () => {
  const opts = [
    { value: "off", label: "关" },
    { value: "low", label: "低" },
    { value: "high", label: "高" },
    { value: "max", label: "最高" },
  ];

  it("键盘：关闭态 ↓ 开面板；End/↑/Home 移动活动项（data-active）；Enter 选中收面板", () => {
    const onChange = vi.fn();
    render(<HeniraSelect value="off" options={opts} onChange={onChange} ariaLabel="档位" />);
    const trigger = screen.getByRole("button", { name: "档位" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // 关闭态 ↓ = 开面板（活动项=当前值）
    const active = () => document.querySelector("[role='option'][data-kbd='true']");
    expect(active()?.textContent).toBe("关");
    fireEvent.keyDown(trigger, { key: "End" });
    expect(active()?.textContent).toBe("最高");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(active()?.textContent).toBe("高");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("high");
    expect(screen.queryByRole("listbox", { name: "档位" })).toBeNull();
  });

  it("Esc 收（焦点归还触发钮）+ 外点收（useDismiss 统一出口）", () => {
    const onChange = vi.fn();
    render(<HeniraSelect value="off" options={opts} onChange={onChange} ariaLabel="档位" />);
    const trigger = screen.getByRole("button", { name: "档位" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: "档位" })).not.toBeNull();
    fireEvent.keyDown(trigger, { key: "Escape" }); // 冒泡到 document 监听
    expect(screen.queryByRole("listbox", { name: "档位" })).toBeNull();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body); // 面板外按下
    expect(screen.queryByRole("listbox", { name: "档位" })).toBeNull();
  });

  it("弹向：auto 在 jsdom（rect 全 0）判向下；direction=up 钉死向上", () => {
    render(<HeniraSelect value="off" options={opts} onChange={vi.fn()} ariaLabel="档位" />);
    fireEvent.click(screen.getByRole("button", { name: "档位" }));
    expect(document.querySelector(".henira-select-pop")?.getAttribute("data-direction")).toBe(
      "down",
    );
    cleanup();
    render(
      <HeniraSelect
        value="off"
        options={opts}
        onChange={vi.fn()}
        ariaLabel="档位"
        direction="up"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "档位" }));
    expect(document.querySelector(".henira-select-pop")?.getAttribute("data-direction")).toBe("up");
  });

  it("排队卡行操作钮 = henira-iconbtn 基类 + hover 浮现容器（浮现语义收口在 CSS，此处锁 class 结构）", () => {
    const queue = [{ id: "q1", text: "第一条排队", steer: false }];
    const queueCtx = fixtureCtx({
      store: {
        getSession: () => ({ rows: [] as Row[], state: { busy: true, queue } }),
        subscribe: () => () => {},
      },
    });
    render(<QueuePanel ctx={queueCtx} />);
    expect(document.querySelector(".henira-queue-row .henira-queue-actions")).not.toBeNull();
    expect(document.querySelector(".henira-queue-actions .henira-iconbtn")).not.toBeNull();
  });

  it("模型下拉键盘导航：活动项初值=当前绑定值，↓ 移动（data-kbd）、Enter 选中", async () => {
    const onChange = vi.fn();
    const ctx = fixtureCtx();
    render(
      <ModelSelect
        ctx={ctx}
        value="deepseek/deepseek-v4-flash"
        onChange={onChange}
        ariaLabel={t("composer.model")}
        providers={{
          deepseek: { models: [{ id: "deepseek-v4-flash" }, { id: "deepseek-flash" }] },
        }}
      />,
    );
    const trigger = screen.getByRole("button", { name: t("composer.model") });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(
        document.querySelector(".henira-model-item[data-kbd='true']")?.getAttribute("title"),
      ).toBe("deepseek/deepseek-v4-flash"),
    );
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(
      document.querySelector(".henira-model-item[data-kbd='true']")?.getAttribute("title"),
    ).toBe("deepseek/deepseek-flash");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("deepseek/deepseek-flash");
  });
});

// ── 生命感（E3）：回合头 / 相邻工具聚合 / busy 计时行 ──

describe("生命感（E3）", () => {
  const toolInput = (name: string): string => {
    if (name === "bash" || name === "powershell") return JSON.stringify({ command: "echo" });
    if (name === "read") return JSON.stringify({ file_path: "x.txt" });
    if (name === "edit") {
      return JSON.stringify({ file_path: "x.txt", old_string: "a", new_string: "b" });
    }
    if (name === "write") return JSON.stringify({ file_path: "x.txt", content: "x" });
    return JSON.stringify({ pattern: "x" });
  };
  const mkTool = (callId: string, name: string, seq: number, status = "done"): Row =>
    ({
      kind: "tool",
      rowId: `t:t-1:1:${callId}`,
      rowSeq: seq,
      turn: "t-1",
      step: 1,
      callId,
      name,
      status: status as "running" | "done" | "error",
      input: toolInput(name),
      output:
        status === "running"
          ? undefined
          : { content: `${name} body`, isError: false, durationMs: 3 },
    }) as Row;

  function ctxWithState(rows: Row[], state: Record<string, unknown>): WebPartContext {
    const snapshot = { rows, state }; // 引用稳定——useSyncExternalStore 语义（每调用新对象=无限重渲）
    // 生产里官方 per-tool 卡经 webUiModule 注册进 keyed 槽；测试同形注入，
    // 让对话组织的断言跑在真实卡上而不是通用兜底卡。
    const slots = new Map<string, readonly SlotPart[]>(
      Object.entries(defaultToolViews).map(([key, view]) => [key, [view]]),
    );
    return fixtureCtx({
      store: {
        getSession: () => snapshot,
        subscribe: () => () => {},
      },
      slots,
    } as unknown as Partial<WebPartContext>);
  }

  it("回合头：settled 轮有 turnTimings → 已工作 4 秒；无 timing → 已处理；都不带工具数", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkTool("c1", "bash", 2),
      {
        kind: "assistant",
        rowId: "a:1",
        rowSeq: 3,
        turn: "t-1",
        step: 1,
        text: "完成",
        streaming: false,
      },
    ];
    const ctx = ctxWithState(rows, {
      busy: false,
      turnTimings: { "t-1": { durationMs: 4000, endedAt: 1_700_000_060_000, forkSeq: 3 } },
    });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.textContent).toContain(`${t("turn.worked")} 4 ${t("tool.unitSec")}`);
    expect(container.textContent).not.toContain(t("turn.toolsSuffix"));
    expect(container.textContent).not.toContain("用时");

    cleanup();
    const noTiming = ctxWithState(rows, { busy: false });
    const { container: c2 } = render(<Conversation {...noTiming} />);
    expect(c2.textContent).toContain(t("turn.processed"));
    expect(c2.textContent).not.toContain("用时");
  });

  it("相邻工具聚合：≥2 连续工具按类别折叠组头；点开 = 全部子行", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkTool("c1", "bash", 2),
      mkTool("c2", "grep", 3),
      mkTool("c3", "glob", 4),
      {
        kind: "assistant",
        rowId: "a:1",
        rowSeq: 5,
        turn: "t-1",
        step: 1,
        text: "完成",
        streaming: false,
      },
    ];
    const ctx = ctxWithState(rows, { busy: false });
    const { container } = render(<Conversation {...ctx} />);
    // 完成轮过程默认折叠：先展开「已工作」，再展开过程组
    fireEvent.click(screen.getByRole("button", { name: /已处理|已工作/ }));
    const groupLabel = `${t("tools.groupExplore")} 2 ${t("tools.unitItems")}，${t("tools.groupRun")} 1 ${t("tools.unitCommands")}`;
    expect(screen.getByRole("button", { name: groupLabel })).toBeDefined();
    expect(screen.queryByText("bash body")).toBeNull(); // 折叠中子行不渲染
    fireEvent.click(screen.getByRole("button", { name: groupLabel }));
    // 子行 = 工具卡默认收起——组展开后再点开终端行
    for (const btn of [...container.querySelectorAll('[role="button"][aria-expanded="false"]')]) {
      fireEvent.click(btn);
    }
    expect(screen.getByText("bash body")).toBeDefined();

    cleanup();
    const twoRows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkTool("c1", "bash", 2),
      mkTool("c2", "grep", 3),
    ];
    const two = ctxWithState(twoRows, { busy: false });
    const { container: c3 } = render(<Conversation {...two} />);
    expect(c3.textContent).toContain(t("tools.groupExplore"));
    expect(c3.textContent).toContain(t("tools.groupRun"));
  });

  it("修改组收起态显示文件名（R179）：多文件统计 + 文件名；展开回统计", () => {
    const editRow = (callId: string, filePath: string, seq: number): Row => ({
      kind: "tool",
      rowId: `t:t-1:1:${callId}`,
      rowSeq: seq,
      turn: "t-1",
      step: 1,
      callId,
      name: "edit",
      status: "done",
      input: JSON.stringify({ file_path: filePath, old_string: "a", new_string: "b" }),
      output: { content: "", isError: false, durationMs: 1 },
    });
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "改文件", source: "send" },
      editRow("c1", "src/x.ts", 2),
      editRow("c2", "src/y.ts", 3),
      {
        kind: "assistant",
        rowId: "a:1",
        rowSeq: 4,
        turn: "t-1",
        step: 1,
        text: "改完",
        streaming: false,
      },
    ];
    const ctx = ctxWithState(rows, { busy: false });
    render(<Conversation {...ctx} />);
    fireEvent.click(screen.getByRole("button", { name: /已处理|已工作/ }));
    const stats = `${t("tools.groupChange")} 2 ${t("tools.unitFiles")}`;
    expect(screen.getByRole("button", { name: stats })).toBeDefined();
    expect(screen.getByText("x.ts，y.ts")).toBeDefined(); // 收起态给文件名（basename）
    fireEvent.click(screen.getByRole("button", { name: stats }));
    expect(screen.queryByText("x.ts，y.ts")).toBeNull(); // 展开改显统计
  });

  it("busy 计时行：busy 时「工作中 + 时长」；空闲不渲染", () => {
    const ctx = ctxWithState([], { busy: true });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.querySelector(".henira-loading-dots")).not.toBeNull();
    expect(container.textContent).toContain(t("conversation.working"));

    cleanup();
    const idle = ctxWithState([], { busy: false });
    const { container: c2 } = render(<Conversation {...idle} />);
    expect(c2.querySelector(".henira-loading-dots")).toBeNull();
  });

  it("busy 计时权威起点（R173）：state.busySince 在场时从服务端起点续算，刷新不归零", () => {
    const ctx = ctxWithState([], { busy: true, busySince: Date.now() - 30_000 });
    const { container } = render(<Conversation {...ctx} />);
    const m = container.textContent?.match(/工作中 (\d+) 秒/);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(28); // 续表 ≥28s（tick 容差）——而非从 0 重数
  });

  // 审查批（2026-11-21）：空文本步级行分两档——纯空行剔除；带可视内容（步级 usage/
  // reasoning/中断徽章）为透明行随组携带不拆组，展开按原序可见
  const mkStep = (
    step: number,
    seq: number,
    usage?: { inputTokens?: number; outputTokens?: number },
    interrupted?: boolean,
  ): Row =>
    ({
      kind: "assistant",
      rowId: `a:t-1:${step}`,
      rowSeq: seq,
      turn: "t-1",
      step,
      text: "",
      streaming: false,
      ...(usage !== undefined ? { usage } : {}),
      ...(interrupted === true ? { interrupted: true } : {}),
    }) as Row;

  it("空步级行不再携 usage 上屏：纯空行剔除，工具仍折叠成组", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkStep(1, 2, { inputTokens: 10, outputTokens: 5 }),
      mkTool("c1", "bash", 3),
      mkStep(2, 4, { inputTokens: 20, outputTokens: 6 }),
      mkTool("c2", "grep", 5),
      mkStep(3, 6, { inputTokens: 30, outputTokens: 7 }),
      mkTool("c3", "glob", 7),
    ];
    const ctx = ctxWithState(rows, { busy: false });
    const { container } = render(<Conversation {...ctx} />);
    const groupLabel = `${t("tools.groupExplore")} 2 ${t("tools.unitItems")}，${t("tools.groupRun")} 1 ${t("tools.unitCommands")}`;
    expect(screen.getByRole("button", { name: groupLabel })).toBeDefined();
    expect(container.textContent).not.toContain("↑");
    fireEvent.click(screen.getByRole("button", { name: groupLabel }));
    for (const btn of [...container.querySelectorAll('[role="button"][aria-expanded="false"]')]) {
      fireEvent.click(btn);
    }
    expect(container.textContent).not.toContain("↑");
    expect(screen.getByText("bash body")).toBeDefined();
  });

  it("纯空步级行剔除：无任何可视内容的空文本行不拆组也不残留渲染", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkStep(1, 2),
      mkTool("c1", "bash", 3),
      mkStep(2, 4),
      mkTool("c2", "grep", 5),
      mkStep(3, 6),
      mkTool("c3", "glob", 7),
    ];
    const ctx = ctxWithState(rows, { busy: false });
    const { container } = render(<Conversation {...ctx} />);
    const groupLabel = `${t("tools.groupExplore")} 2 ${t("tools.unitItems")}，${t("tools.groupRun")} 1 ${t("tools.unitCommands")}`;
    expect(screen.getByRole("button", { name: groupLabel })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: groupLabel }));
    for (const btn of [...container.querySelectorAll('[role="button"][aria-expanded="false"]')]) {
      fireEvent.click(btn);
    }
    expect(screen.getByText("bash body")).toBeDefined();
  });

  it("中断可见性：零文本中止行不被空行剔除——轮头「已停止」在场", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "写一段", source: "send" },
      mkStep(1, 2, undefined, true),
    ];
    const ctx = ctxWithState(rows, { busy: false });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.textContent).toContain(t("turn.stopped"));
  });

  // R177：完成轮历史折叠（ZCode 形态）——过程收进「已工作」，最终回答留在外面
  it("完成轮折叠：默认只见最终回答 + 已工作；展开后过程与工具行可见", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkTool("c1", "bash", 2),
      {
        kind: "assistant",
        rowId: "a:1",
        rowSeq: 3,
        turn: "t-1",
        step: 1,
        text: "最终回答",
        streaming: false,
      },
    ];
    const ctx = ctxWithState(rows, {
      busy: false,
      turnTimings: { "t-1": { durationMs: 4000, endedAt: 1_700_000_060_000, forkSeq: 3 } },
    });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.textContent).toContain("最终回答");
    expect(container.textContent).toContain(t("turn.worked"));
    expect(screen.queryByText("bash body")).toBeNull(); // 过程默认收起
    fireEvent.click(screen.getByRole("button", { name: /已处理|已工作/ }));
    for (const btn of [...container.querySelectorAll('[role="button"][aria-expanded="false"]')]) {
      fireEvent.click(btn);
    }
    expect(screen.getByText("bash body")).toBeDefined();
  });

  it("最终回答自带的思考收进折叠体：折叠态不留思考行，展开后在场", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "想一想", source: "send" },
      mkTool("c1", "bash", 2),
      {
        kind: "assistant",
        rowId: "a:1",
        rowSeq: 3,
        turn: "t-1",
        step: 1,
        text: "最终回答",
        reasoning: "先想一下再回答",
        streaming: false,
      },
    ];
    const ctx = ctxWithState(rows, {
      busy: false,
      turnTimings: { "t-1": { durationMs: 3000, endedAt: 1_700_000_060_000, forkSeq: 3 } },
    });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.textContent).toContain("最终回答");
    expect(screen.queryByText(t("row.reasoning.done"))).toBeNull(); // 折叠态：思考收进「已工作」
    fireEvent.click(screen.getByRole("button", { name: /已处理|已工作/ }));
    expect(screen.getByText(t("row.reasoning.done"))).toBeDefined();
  });

  it("思考+回答（无工具）也折叠：头不显示「0 个工具」，展开后思考可见", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "想一想", source: "send" },
      {
        kind: "assistant",
        rowId: "a:1",
        rowSeq: 2,
        turn: "t-1",
        step: 1,
        text: "回答",
        reasoning: "想一想再答",
        streaming: false,
      },
    ];
    const ctx = ctxWithState(rows, {
      busy: false,
      turnTimings: { "t-1": { durationMs: 2000, endedAt: 1_700_000_060_000, forkSeq: 2 } },
    });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.textContent).toContain(t("turn.worked"));
    expect(container.textContent?.includes(`0 ${t("turn.toolsSuffix")}`)).toBe(false);
    expect(container.textContent?.includes("回答")).toBe(true);
    expect(screen.queryByText(t("row.reasoning.done"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /已处理|已工作/ }));
    expect(screen.getByText(t("row.reasoning.done"))).toBeDefined();
  });

  it("运行中轮：不显示轮级折叠头，过程直接展开，加载行「工作中」", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkTool("c1", "bash", 2, "running"),
    ];
    const ctx = ctxWithState(rows, { busy: true, lastTurnId: "t-1" });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.querySelector(".henira-turn-history-trigger")).toBeNull();
    expect(container.textContent).toContain(t("tool.kind.running"));
    expect(container.textContent).toContain(t("conversation.working"));
  });

  it("中断轮：过程强制展开，最终回答与已停止头同时可见", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "跑工具", source: "send" },
      mkTool("c1", "bash", 2),
      {
        kind: "assistant",
        rowId: "a:1",
        rowSeq: 3,
        turn: "t-1",
        step: 1,
        text: "半截回答",
        streaming: false,
        interrupted: true,
      },
    ];
    const ctx = ctxWithState(rows, { busy: false });
    const { container } = render(<Conversation {...ctx} />);
    expect(container.textContent).toContain("半截回答");
    expect(container.textContent).toContain(t("turn.stopped"));
    expect(container.textContent).toContain(t("tool.kind.ran")); // 折开态：工具行可见
  });
});

// ── 外壳操作栏（E4）：轮尾 时间戳·复制·fork / 用户行 时间戳·复制 / 浮现 data 属性 ──

describe("外壳操作栏（E4）", () => {
  const TIMING = { durationMs: 4000, endedAt: 1_700_000_060_000, forkSeq: 7 };

  function ctxWithActions(
    rows: Row[],
    fork?: (sessionId: string, atSeq?: number) => Promise<string>,
  ): WebPartContext {
    const snapshot = { rows, state: { busy: false, turnTimings: { "t-1": TIMING } } };
    const client: HeniraClientLike = {
      createSession: async () => ({ id: "s-1", cwd: "C:demo", updatedAt: 0, busy: false }),
      listSessions: async () => [],
      prompt: async () => ({ queued: false, id: null }),
      steer: async () => true,
      interrupt: async () => {},
      settleApproval: async () => true,
      events: async function* () {
        yield {} as ServerFrame;
      },
      listUiAssets: async () => ({ locales: [], themes: [] }),
      ...(fork !== undefined ? { fork } : {}),
    };
    return fixtureCtx({
      client,
      store: { getSession: () => snapshot, subscribe: () => () => {} },
    } as unknown as Partial<WebPartContext>);
  }

  const settledRows = (text: string): Row[] =>
    [
      {
        kind: "user",
        rowId: "u:1",
        rowSeq: 1,
        turn: "t-1",
        text: "问",
        source: "send",
        time: 1_700_000_000_000,
      },
      {
        kind: "assistant",
        rowId: "a:t-1:1",
        rowSeq: 3,
        turn: "t-1",
        step: 1,
        text,
        streaming: false,
      },
    ] as Row[];

  it("轮尾操作行：落定轮渲染时间戳+复制+fork；fork 点击 → client.fork(forkSeq) → selectSession(子会话)；最新落定轮常显", async () => {
    const fork = vi.fn(async () => "s-child");
    const ctx = ctxWithActions(settledRows("回答"), fork);
    const { container } = render(<Conversation {...ctx} />);
    const actions = container.querySelector(".henira-turn-actions");
    expect(actions).not.toBeNull();
    expect(actions?.getAttribute("data-actions-reveal")).toBe("always");
    expect(container.querySelector(".henira-turn-time")?.textContent).toMatch(/\d/);
    const forkBtn = container.querySelector<HTMLButtonElement>(".henira-turn-fork");
    expect(forkBtn?.disabled).toBe(false);
    fireEvent.click(forkBtn as HTMLButtonElement);
    await waitFor(() => expect(fork).toHaveBeenCalledWith("s-1", 7));
    expect(ctx.selectSession).toHaveBeenCalledWith("s-child");
  });

  it("轮尾 fork 置灰：文本后跟工具的轮不干净 → disabled + 原因 title；宿主缺 fork 方法 → fork 钮不渲染（时间戳+复制仍在）", () => {
    const rows: Row[] = [
      ...settledRows("先答一半"),
      {
        kind: "tool",
        rowId: "t:t-1:2:c1",
        rowSeq: 4,
        turn: "t-1",
        step: 2,
        callId: "c1",
        name: "bash",
        status: "done",
        input: "{}",
        output: { content: "bash body", isError: false, durationMs: 3 },
      },
    ];
    const ctx = ctxWithActions(rows, async () => "s-child");
    const { container } = render(<Conversation {...ctx} />);
    const forkBtn = container.querySelector<HTMLButtonElement>(".henira-turn-fork");
    expect(forkBtn?.disabled).toBe(true);
    expect(forkBtn?.getAttribute("title")).toBe(t("turn.forkUnavailable"));

    cleanup();
    const noFork = ctxWithActions(settledRows("回答"));
    const { container: c2 } = render(<Conversation {...noFork} />);
    expect(c2.querySelector(".henira-turn-fork")).toBeNull();
    expect(c2.querySelector(".henira-turn-actions")).not.toBeNull();
  });

  it("用户行操作行：时间戳 + 复制在场，hover 浮现 data 属性", () => {
    const ctx = ctxWithActions(settledRows("回答"));
    const { container } = render(<Conversation {...ctx} />);
    const userActions = container.querySelector(".henira-user-actions");
    expect(userActions).not.toBeNull();
    expect(userActions?.getAttribute("data-actions-reveal")).toBe("hover");
    expect(userActions?.querySelector(".henira-turn-time")).not.toBeNull();
  });

  it("流式中轮无操作行（timing 未结算不渲染）", () => {
    const rows: Row[] = [
      { kind: "user", rowId: "u:1", rowSeq: 1, turn: "t-1", text: "问", source: "send" },
      {
        kind: "assistant",
        rowId: "a:t-1:1",
        rowSeq: 2,
        turn: "t-1",
        step: 1,
        text: "写到",
        streaming: true,
      },
    ];
    const snapshot = { rows, state: { busy: true } }; // turn/end 未落账 → 无 turnTimings
    const client: HeniraClientLike = {
      createSession: async () => ({ id: "s-1", cwd: "C:\\demo", updatedAt: 0, busy: false }),
      listSessions: async () => [],
      prompt: async () => ({ queued: false, id: null }),
      steer: async () => true,
      interrupt: async () => {},
      settleApproval: async () => true,
      events: async function* () {
        yield {} as ServerFrame;
      },
      listUiAssets: async () => ({ locales: [], themes: [] }),
      fork: async () => "s-child",
    };
    const ctx = fixtureCtx({
      client,
      store: { getSession: () => snapshot, subscribe: () => () => {} },
    } as unknown as Partial<WebPartContext>);
    const { container } = render(<Conversation {...ctx} />);
    expect(container.querySelector(".henira-turn-actions")).toBeNull();
  });
});
