// @vitest-environment jsdom
// 官方件测试（jsdom）：locale 取字 / 交互回调 / 哑渲染。件纯呈现——数据经承重缝注入。

import type { ApprovalRow, AssistantRow, Row, ServerFrame, ToolRow } from "@henira/protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zh } from "./locales/zh.js";
import { webUiModule } from "./module.js";
import { ApprovalCard, ApprovalSettledRow } from "./parts/approval-card.js";
import { Composer } from "./parts/composer.js";
import { Conversation } from "./parts/conversation.js";
import { LayoutFrame } from "./parts/layout-frame.js";
import { ModelSelect } from "./parts/model-select.js";
import { RightPanel } from "./parts/right-panel.js";
import { SessionList } from "./parts/session-list.js";
import { SettingsModal } from "./parts/settings-modal.js";
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
    expect(screen.getByText(t("dirs.title"))).toBeDefined();
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

  it("目录行 hover ＋ → 该目录新建会话（createSession({cwd})——服务端自动登记）", async () => {
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

  it("右键会话 → 删除项（busy 会话 disabled；当前选中会话不提供删除）→ 确认后 deleteSession(id)", async () => {
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
    const { container } = render(<Composer {...ctx} />);
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
    render(<Composer {...busyCtx} />);
    expect(screen.getByRole("button", { name: t("composer.stop") })).toBeDefined();
    expect(screen.getByText(t("composer.steerHint"))).toBeDefined();
  });

  it("ZCode 语义：忙+有草稿=发送钮（排队插话）而非停止——点击发送走 prompt", async () => {
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
    const { container } = render(<Composer {...busyCtx} />);
    const area = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "排队的话" } });
    // 有草稿 → 停止钮不在场，发送钮点亮
    expect(screen.queryByRole("button", { name: t("composer.stop") })).toBeNull();
    const send = screen.getByRole("button", { name: t("composer.send") });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() =>
      expect(promptSpy).toHaveBeenCalledWith("s-1", "排队的话", {
        modelId: undefined,
        reasoningEffort: undefined,
      }),
    );
  });

  it("prompt 失败不静默：草稿回填 + 行内错误提示", async () => {
    const ctx = fixtureCtx();
    vi.spyOn(ctx.client, "prompt").mockRejectedValueOnce(new Error("boom"));
    const { container } = render(<Composer {...ctx} />);
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
    const { container } = render(<Composer {...ctx} />);
    const trigger = (await screen.findByRole("button", {
      name: t("composer.model"),
    })) as HTMLButtonElement;
    // 触发钮显示模型显示名（厂商 id 不进按钮——BC ModelSelect 同档）
    await waitFor(() => expect(trigger.textContent).toContain("DeepSeek V4 Flash"));
    expect(trigger.textContent).not.toContain("deepseek/");
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox", { name: t("composer.model") });
    expect(listbox.textContent).toContain("zhipuai"); // 按厂商分组
    // 条目可访问名 = 显示名+徽章排（BC 档）——按 title 定位完整 id
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
      rowSeq: 3,
      turn: "t-1",
      step: 1,
      text: "看图",
      streaming: false,
    };
    render(<Conversation {...ctxWithRows([assistantRow], slots)} />);
    expect(screen.getByText("画廊位在场")).toBeDefined();
  });

  it("usage 徽章：有值渲染 12↑4↓；全 0（中断回合）不渲染（R125 糙点③）", () => {
    const base = {
      kind: "assistant",
      rowId: "a:t-1:1",
      rowSeq: 3,
      turn: "t-1",
      step: 1,
      text: "答",
      streaming: false,
    } as const;
    const withUsage: Row = { ...base, usage: { inputTokens: 12, outputTokens: 4 } };
    const { container } = render(<Conversation {...ctxWithRows([withUsage], new Map())} />);
    expect(container.textContent).toContain("12↑ 4↓");
    cleanup();
    const zeroUsage: Row = {
      ...base,
      rowId: "a:t-1:2",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const zero = render(<Conversation {...ctxWithRows([zeroUsage], new Map())} />);
    expect(zero.container.textContent).not.toContain("↑");
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
    // D-062 UI 侧子项：layout 框架件 + sidebar.right 右栏件随骨架批入列（区域级五名）
    expect([...registered].sort()).toEqual([
      "composer",
      "conversation",
      "layout",
      "sidebar",
      "sidebar.right",
    ]);
    expect(
      registered.every((n) =>
        (
          ["layout", "sidebar", "conversation", "composer", "sidebar.right"] as WebSlotName[]
        ).includes(n as WebSlotName),
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
    render(<Composer {...ctx} />);
    const area = screen.getByPlaceholderText(t("composer.placeholder")) as HTMLTextAreaElement;
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
  it("默认分区渲染主题页（select 列官方双主题）；模型管理页无全局默认模型入口（用户裁定 2026-11-19）+ 行带视觉徽章", async () => {
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
    // 主题页：select 显示当前主题 dark；切 light 走 onTheme
    const themeSelect = dialog.querySelector("select") as HTMLSelectElement;
    expect(themeSelect.value).toBe("dark");
    fireEvent.change(themeSelect, { target: { value: "light" } });
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

  it("语言页显示实际生效语言（宿主 ctx.locale）：包卸载 boot 回落官方后不读磁盘旧值漂移显示（审查 P3-b）", () => {
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
    const dialog = screen.getByRole("dialog", { name: t("settings.title") });
    const localeSelect = dialog.querySelectorAll("select")[0] as HTMLSelectElement;
    expect(localeSelect.value).toBe("zh"); // 显示生效值，不是磁盘的 fr
  });

  it("模型管理面板（BC 四视图）：分组+开关回调 → 厂商选择页 → 连接表单 → 自定义表单", async () => {
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
              connected: false, // 主列表不列未连接厂商（BC 同形）——连接态只在挑选页显示
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
    // 主列表只列已连接厂商（BC ModelsPanel 同形）——未连接组与模型行整块不渲染
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
    // 连接态标只住挑选页（BC 同形）：未连接厂商在这里显示「未连接」，已连接显示 is-on
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

describe("思考档按次绑定（BC 语义——骨架批）", () => {
  function ctxWithRows(rows: Row[]): WebPartContext {
    const snapshot = { rows, state: { busy: false } }; // 引用稳定——useSyncExternalStore 语义
    return fixtureCtx({
      store: {
        getSession: () => snapshot,
        subscribe: () => () => {},
      },
    });
  }

  it("模型条目 BC 档显示：行首显示名、行尾上下文窗/视觉徽章；纯 id 条目无徽章排（模型目录收敛批）", async () => {
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

  it("触发钮显示模型显示名（不出厂商 id）；绑定值目录里失效 → 回落清单首个（BC 同语义）", async () => {
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
    const { container } = render(<Composer {...noneCtx} />);
    await waitFor(() => {
      if (container.querySelector(".henira-thinking-select[data-disabled='true']") === null) {
        throw new Error("thinking control not grayed");
      }
    });
    expect(container.querySelector(".henira-thinking-select select")).toBeNull();
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
    const glm = render(<Composer {...glmCtx} />);
    const select = (await screen.findByRole("combobox", {
      name: t("composer.thinking"),
    })) as HTMLSelectElement;
    // 数据驱动档位：effort 值直通——关/低/高/最高 四档（max 独立成档，不归并）
    expect(select.options).toHaveLength(4);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      t("composer.thinking.off"),
      t("composer.thinking.low"),
      t("composer.thinking.high"),
      t("composer.thinking.max"),
    ]);
    void glm;
    cleanup();

    // agnes 数据仅 toggle → 两档「关/开」（开承载 medium）
    const agnesCtx = fixtureCtx({
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
    render(<Composer {...agnesCtx} />);
    const agnesSelect = (await screen.findByRole("combobox", {
      name: t("composer.thinking"),
    })) as HTMLSelectElement;
    expect(Array.from(agnesSelect.options).map((o) => o.textContent)).toEqual([
      t("composer.thinking.off"),
      t("composer.thinking.on"),
    ]);
    expect(Array.from(agnesSelect.options).map((o) => o.value)).toEqual(["off", "medium"]);
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
    const { container } = render(<Composer {...ctx} />);
    // 会话绑定优先于全局默认（触发钮显示 glm）
    const trigger = await screen.findByRole("button", { name: t("composer.model") });
    await waitFor(() => expect(trigger.textContent).toContain("GLM-5.3-Flash"));
    const select = (await screen.findByRole("combobox", {
      name: t("composer.thinking"),
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "high" } });
    expect(updateUiState).toHaveBeenCalledWith({ reasoningEffort: "high" });
    const area = screen.getByPlaceholderText(t("composer.placeholder")) as HTMLTextAreaElement;
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
    render(<Composer {...ctx} />);
    await waitFor(() => expect(updateUiState).toHaveBeenCalledWith({ reasoningEffort: "medium" }));
    const select = (await screen.findByRole("combobox", {
      name: t("composer.thinking"),
    })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("medium")); // 显示为「开」
  });

  it("思考档行上徽章（AssistantRow.reasoningEffort 投影；off 不渲染）", () => {
    const base = {
      kind: "assistant",
      rowId: "a:t-1:1",
      rowSeq: 1,
      turn: "t-1",
      step: 1,
      text: "答",
      streaming: false,
    } as const;
    const high: Row = { ...base, reasoningEffort: "high" };
    render(<Conversation {...ctxWithRows([high])} />);
    expect(screen.getByTitle(t("composer.thinking")).textContent).toContain(
      t("composer.thinking.high"),
    );
    cleanup();
    const off: Row = { ...base, reasoningEffort: "off" };
    render(<Conversation {...ctxWithRows([off])} />);
    expect(screen.queryByTitle(t("composer.thinking"))).toBeNull(); // off = 缺省语义不渲染
  });
});
