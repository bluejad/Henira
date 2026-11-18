// @vitest-environment jsdom
// web 宿主测试：槽位激活（公共注册路径）与安全模式（编译期出口）双通道 / 槽位收起 / 主题接线 /
// D-059 主题包下拉（<link> 注入与安全模式回落）。

import { zh } from "@henira/plugin-web-ui";
import type { HeniraFacade } from "@henira/sdk";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebApp } from "./host.js";

afterEach(cleanup);

function fakeClient(overrides?: Partial<HeniraFacade>): HeniraFacade {
  return {
    createSession: async () => ({ id: "s-1", cwd: "C:\\demo", updatedAt: 0, busy: false }),
    listSessions: async () => [],
    prompt: async () => ({ queued: false, id: null }),
    steer: async () => true,
    interrupt: async () => {},
    settleApproval: async () => true,
    snapshot: async () => ({ sessionId: "s-1", seq: 0, rows: [], state: { busy: false } }),
    getSettings: async () => ({ version: 1 }),
    putSettings: async () => ({ version: 1 }),
    listModels: async () => ({ providers: {} }),
    putCredential: async () => {},
    listDir: async () => [],
    listUiAssets: async () => ({ locales: [], themes: [] }),
    events: async function* () {}, // 无帧（宿主挂空流即可）
    stop: async () => {},
    ...overrides,
  } as unknown as HeniraFacade;
}

describe("createWebApp", () => {
  it("选中 store 无数据的会话（磁盘历史，不在 SSE 扇出）→ 补拉快照渲染行", async () => {
    const snapshots: string[] = [];
    const client = fakeClient({
      listSessions: async () => [
        { id: "s-live", cwd: "C:/live", updatedAt: 2, busy: false },
        { id: "s-disk", cwd: "C:/disk", updatedAt: 1, busy: false },
      ],
      snapshot: async (id) => {
        snapshots.push(id);
        return {
          sessionId: id,
          seq: 1,
          rows: [
            {
              kind: "user",
              rowId: "u:1",
              rowSeq: 1,
              turn: "t-1",
              text: "历史会话存量行",
              source: "send",
            },
          ],
          state: { busy: false },
          hasOlder: false,
          totalRows: 1,
        } as Awaited<ReturnType<HeniraFacade["snapshot"]>>;
      },
      events: async function* () {}, // 无帧：历史会话不在扇出范围
    });
    const el = document.createElement("div");
    document.body.append(el);
    const app = createWebApp({ client });
    app.mount(el);
    try {
      // 初始选择 s-live（第一个）；非活跃组（disk）初值收起（本地折叠语义）——先展开其组。
      // 组头按 title（= 完整 cwd）定位，不依赖 label 拼字（CI 慢机回归失败后加固）
      await vi.waitFor(
        () => {
          if (el.querySelectorAll("button.henira-session-group").length < 2) {
            throw new Error("session groups not ready");
          }
          return true;
        },
        { timeout: 4000 },
      );
      const diskGroup = [...el.querySelectorAll("button.henira-session-group")].find((b) =>
        b.getAttribute("title")?.includes("disk"),
      );
      if (diskGroup === undefined) throw new Error("disk group not rendered");
      fireEvent.click(diskGroup);
      await vi.waitFor(
        () => {
          if (diskGroup.getAttribute("aria-expanded") !== "true") {
            throw new Error("disk group not expanded");
          }
          return true;
        },
        { timeout: 4000 }, // 全仓并跑负载下 1s 默认预算不够（831f1a3 同款竞态）
      );
      // 轮询 disk 行出现（CI 纪律：异步断言禁固定 sleep——
      // 慢机 50ms 不够；失败时打印现有行文本自证）
      await vi.waitFor(
        () => {
          const rows = [...el.querySelectorAll(".henira-sessions li button")];
          const disk = rows.find((b) => b.textContent?.includes("disk"));
          if (disk === undefined) {
            throw new Error(
              `s-disk row not ready; rows=${JSON.stringify(rows.map((b) => b.textContent))}`,
            );
          }
          return disk;
        },
        { timeout: 4000 },
      );
      snapshots.length = 0; // 本用例只看点击后的补拉

      const diskRow = [...el.querySelectorAll(".henira-sessions li button")].find((b) =>
        b.textContent?.includes("disk"),
      );
      if (diskRow === undefined) throw new Error("s-disk row not rendered");
      fireEvent.click(diskRow);
      await vi.waitFor(
        () => {
          if (!snapshots.includes("s-disk")) throw new Error("snapshot not refetched"); // 补拉
        },
        { timeout: 4000 },
      );
      await vi.waitFor(
        () => {
          if (!el.textContent?.includes("历史会话存量行")) throw new Error("rows not rendered"); // 不再空对话
        },
        { timeout: 4000 },
      );
      expect(snapshots).toEqual(["s-disk"]);
    } finally {
      await app.dispose(); // throw 路径也收尾——残根会污染下一用例（「设置」按钮 multiple 连锁）
      el.remove();
    }
  }, 15_000); // 首用例含 react 冷启动 + 三段等待（组头/行/补拉）——CI 慢机 5s 默认预算不够

  it("正常装载：UI 模块激活 → 三槽位官方件在渲染（公共注册路径，判据④正向）", async () => {
    const el = document.createElement("div");
    document.body.append(el);
    const app = createWebApp({ client: fakeClient() });
    app.mount(el);
    await new Promise((r) => setTimeout(r, 50)); // 等初始选择 + 渲染
    expect(el.querySelector(".henira-sessions")).not.toBeNull(); // 会话列表件在场
    expect(el.querySelector(".henira-composer")).not.toBeNull(); // 输入框件在场
    await app.dispose();
    el.remove();
  });

  it("安全模式：?ui=safe 语义（opts.safeMode）→ 同一套官方件编译期出口渲染 + safe mode 徽标", async () => {
    const el = document.createElement("div");
    document.body.append(el);
    const app = createWebApp({ client: fakeClient(), safeMode: true });
    app.mount(el);
    await new Promise((r) => setTimeout(r, 50));
    expect(el.querySelector(".henira-sessions")).not.toBeNull(); // 同一零件库
    expect(el.textContent).toContain(zh["app.safeMode"]); // 徽标文案走字典（死键活化）
    await app.dispose();
    el.remove();
  });

  it("layout=composer：只渲染输入框（挑件语义，D-043 第 7 条）", async () => {
    const el = document.createElement("div");
    document.body.append(el);
    const app = createWebApp({ client: fakeClient(), layout: "composer" });
    app.mount(el);
    await new Promise((r) => setTimeout(r, 50));
    expect(el.querySelector(".henira-composer")).not.toBeNull();
    expect(el.querySelector(".henira-sessions")).toBeNull(); // 槽位收起（不渲染不占宽）
    await app.dispose();
    el.remove();
  });

  it("设置浮层列已装主题包：选择即注入 <link> + 切 data-theme；安全模式回落官方默认（D-059）", async () => {
    const el = document.createElement("div");
    document.body.append(el);
    const client = fakeClient({
      listUiAssets: async () => ({
        locales: [],
        themes: [
          {
            pluginId: "sea-pack",
            version: "1.0.0",
            name: "sea",
            url: "/api/ui-assets/sea-pack/1.0.0/themes/sea.css",
          },
        ],
      }),
    });
    const app = createWebApp({ client });
    app.mount(el);
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    const themeSelect = dialog.querySelectorAll("select")[0] as HTMLSelectElement;
    fireEvent.change(themeSelect, { target: { value: "sea" } });
    expect(el.dataset.theme).toBe("sea"); // 容器切主题 id
    const link = document.head.querySelector("link[data-henira-theme]");
    expect(link?.getAttribute("href")).toBe("/api/ui-assets/sea-pack/1.0.0/themes/sea.css");
    expect(themeSelect.value).toBe("sea"); // 显示值跟随主题（onTheme 漏 render 回归锚，R125）
    // 安全模式回落官方默认：第三方主题/语言收起（D-059 决定 4）
    app.setSafeMode(true);
    expect(el.dataset.theme).toBe("light");
    expect(document.head.querySelector("link[data-henira-theme]")).toBeNull();
    await app.dispose();
    el.remove();
  });

  it("界面绑定状态（D-063）：启动还原上次选中（非列表第一个）+ 点选写全局指针 + 会话文档回填", async () => {
    const docs = new Map<string, unknown>([
      ["s-a", { draft: "甲的草稿" }],
      ["s-b", {}],
    ]);
    const puts: unknown[] = [];
    const client = fakeClient({
      listSessions: async () => [
        { id: "s-a", cwd: "C:/alpha", updatedAt: 2, busy: false },
        { id: "s-b", cwd: "C:/beta", updatedAt: 1, busy: false },
      ],
      getUiState: async () => ({ lastSessionId: "s-b" }), // 上次选中 s-b（列表第二个）
      putUiState: async (doc) => {
        puts.push(doc);
      },
      getSessionUiState: async (id) => (docs.get(id) ?? {}) as never,
      putSessionUiState: async (id, doc) => {
        docs.set(id, doc);
      },
      events: async function* () {},
    });
    const el = document.createElement("div");
    document.body.append(el);
    const app = createWebApp({ client });
    app.mount(el);
    try {
      // 还原 = s-b（不是最新更新的 s-a）
      await vi.waitFor(
        () => {
          const active = el.querySelector('.henira-sessions li button[data-active="true"]');
          if (active === null || !active.textContent?.includes("beta")) {
            throw new Error(
              `active not s-b; rows=${JSON.stringify(
                [...el.querySelectorAll(".henira-sessions li button")].map((b) => b.textContent),
              )}`,
            );
          }
          return active;
        },
        { timeout: 5000 },
      );
      // boot 选定即固化指针（还原的 s-b 也回写——不写则下次启动回落会随"最新更新"漂移）
      await vi.waitFor(() => {
        if (!puts.some((p) => (p as { lastSessionId?: string }).lastSessionId === "s-b")) {
          throw new Error(`boot pointer not persisted; puts=${JSON.stringify(puts)}`);
        }
        return true;
      });
      // 切到 s-a → 全局指针写 s-a。非活跃组（alpha）初值收起（本地折叠语义）——先展开
      const alphaGroup = [...el.querySelectorAll("button.henira-session-group")].find((b) =>
        b.textContent?.includes("alpha"),
      );
      if (alphaGroup === undefined) throw new Error("alpha group not rendered");
      fireEvent.click(alphaGroup);
      const rowA = [...el.querySelectorAll(".henira-sessions li button")].find((b) =>
        b.textContent?.includes("alpha"),
      );
      if (rowA === undefined) throw new Error("s-a row not rendered");
      fireEvent.click(rowA);
      await vi.waitFor(() => {
        if (!puts.some((p) => (p as { lastSessionId?: string }).lastSessionId === "s-a")) {
          throw new Error(`global pointer not written; puts=${JSON.stringify(puts)}`);
        }
        return true;
      });
    } finally {
      await app.dispose();
      el.remove();
    }
  });

  it("界面绑定状态（D-063）：boot 还原选中同样补拉快照——刷新后正文行在场（selftest8 回归）", async () => {
    const snapshots: string[] = [];
    const client = fakeClient({
      listSessions: async () => [
        { id: "s-a", cwd: "C:/alpha", updatedAt: 2, busy: false },
        { id: "s-b", cwd: "C:/beta", updatedAt: 1, busy: false },
      ],
      getUiState: async () => ({ lastSessionId: "s-b" }), // 上次选中 = 磁盘历史会话（store 恒空）
      putUiState: async () => {},
      getSessionUiState: async () => ({}),
      putSessionUiState: async () => {},
      snapshot: async (id) => {
        snapshots.push(id);
        return {
          sessionId: id,
          seq: 1,
          rows: [
            {
              kind: "user",
              rowId: "u:1",
              rowSeq: 1,
              turn: "t-1",
              text: "刷新前的正文",
              source: "send",
            },
          ],
          state: { busy: false },
          hasOlder: false,
          totalRows: 1,
        } as Awaited<ReturnType<HeniraFacade["snapshot"]>>;
      },
      events: async function* () {},
    });
    const el = document.createElement("div");
    document.body.append(el);
    const app = createWebApp({ client });
    app.mount(el);
    try {
      // 刷新/重启后 store 恒空——还原选中必须与点选走同一补拉路径，否则正文空白
      await vi.waitFor(
        () => {
          if (!el.textContent?.includes("刷新前的正文")) {
            throw new Error(`boot snapshot not rendered; snapshots=${JSON.stringify(snapshots)}`);
          }
          return true;
        },
        { timeout: 5000 },
      );
      expect(snapshots).toEqual(["s-b"]); // 只补拉还原的会话
    } finally {
      await app.dispose();
      el.remove();
    }
  });
});
