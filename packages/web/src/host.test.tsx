// @vitest-environment jsdom
// web 宿主测试：槽位激活（公共注册路径）与安全模式（编译期出口）双通道 / 槽位收起 / 主题接线 /
// D-059 主题包下拉（<link> 注入与安全模式回落）。

import type { HeniraFacade } from "@henira/sdk";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(el.textContent).toContain("safe mode");
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
    // 安全模式回落官方默认：第三方主题/语言收起（D-059 决定 4）
    app.setSafeMode(true);
    expect(el.dataset.theme).toBe("light");
    expect(document.head.querySelector("link[data-henira-theme]")).toBeNull();
    await app.dispose();
    el.remove();
  });
});
