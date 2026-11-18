// 会话绑定界面状态持久化验收（D-063 判据①②）：草稿 / 上次选中 / 侧栏宽 / 折叠组——
// 刷新还原（reload）+ 重启还原（同 dataDir 新 server 实例）。每断言落盘前用磁盘文件轮询
// 确定性等待（CI 纪律：异步断言禁固定 sleep——防抖 500ms 在慢机不可靠）。选择器取 locale 字典。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type MockEntry, mockFinish, mockLlm, mockText } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");
const DRAFT = "persistent draft text";
// 正文造一行（刷新/重启后必须在场——selftest8：boot 还原曾只摆选中不补拉快照，正文空白）
const HISTORY_TEXT = "persist history row";
const HISTORY_SCRIPT: MockEntry[] = [[mockText(HISTORY_TEXT), mockFinish("stop")]];

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** 两个不同 cwd 的会话（组可折叠）——registry 建会话自动登记目录（D-060） */
async function startPersistServer(script: MockEntry[] = []): Promise<{
  server: HeniraServer;
  dataDir: string;
  dirA: string;
  dirB: string;
  stop: (wipe: boolean) => Promise<void>;
  restart: () => Promise<HeniraServer>;
}> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-persist-"));
  const globalDir = await fs.mkdtemp(path.join(tmpdir(), "henira-persist-cfg-"));
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  let server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mockLlm(script).service },
    port: 0,
  });
  const dirA = await fs.mkdtemp(path.join(tmpdir(), "henira-persist-a-"));
  const dirB = await fs.mkdtemp(path.join(tmpdir(), "henira-persist-b-"));
  await server.registry.create({ cwd: dirA });
  await server.registry.create({ cwd: dirB });
  const restart = async (): Promise<HeniraServer> => {
    await server.stop();
    server = await createServer({
      dataDir,
      globalDir,
      llm: { name: "llm", start: () => mockLlm(script).service },
      port: 0,
    });
    return server;
  };
  return {
    server,
    dataDir,
    dirA,
    dirB,
    stop: async (wipe) => {
      await server.stop();
      if (wipe) {
        await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
        await fs.rm(globalDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    restart,
  };
}

/** 轮询任一会话目录的 ui-state.json 含谓词命中（防抖落盘的确定性等待） */
async function waitUiStateOnDisk(
  dataDir: string,
  match: (doc: Record<string, unknown>) => boolean,
): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const keys = await fs.readdir(path.join(dataDir, "projects"));
      for (const key of keys) {
        const sessions = await fs.readdir(path.join(dataDir, "projects", key, "sessions"));
        for (const id of sessions) {
          try {
            const raw = await fs.readFile(
              path.join(dataDir, "projects", key, "sessions", id, "ui-state.json"),
              "utf8",
            );
            if (match(JSON.parse(raw) as Record<string, unknown>)) return;
          } catch {
            // 尚未落盘——继续轮询
          }
        }
      }
    } catch {
      // projects 目录尚不存在——继续轮询
    }
    if (Date.now() > deadline) throw new Error("ui-state not persisted within 5s");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const activeRow = (page: Page) => page.locator('.henira-sessions li button[data-active="true"]');

test("刷新还原（D-063 判据①）：上次选中 + 草稿 + 侧栏宽 + 正文；折叠纯本地（活跃组展开）", async ({
  page,
}) => {
  const ctx = await startPersistServer(HISTORY_SCRIPT);
  try {
    await page.goto(ctx.server.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    // 初值组态 = 选中会话所在组展开、其余折叠（本地默认）；初始选中 = dirB 会话 → 先展开 A 组
    const groupA = page.locator("button.henira-session-group", { hasText: "persist-a" });
    const groupB = page.locator("button.henira-session-group", { hasText: "persist-b" });
    await expect(page.locator("button.henira-session-group")).toHaveCount(2);
    await groupA.click();
    const rowA = page.locator(".henira-sessions li button", { hasText: "persist-a" });
    await rowA.click();
    await expect(activeRow(page)).toContainText("persist-a");
    // 先造正文一行（刷新后必须在场的回归锚——selftest8：boot 还原曾只摆选中不补拉快照）
    const area = page.getByPlaceholder(zh["composer.placeholder"]);
    await area.fill("persist seed");
    await area.press("Enter");
    await expect(page.getByText(HISTORY_TEXT)).toBeVisible({ timeout: 15_000 });
    // 草稿（A 的文档）→ 防抖落盘轮询
    await area.fill(DRAFT);
    await waitUiStateOnDisk(ctx.dataDir, (doc) => doc.draft === DRAFT);
    // 侧栏拖宽（A 的文档）：把手右拖 120px → 松手落盘轮询
    const handle = page.locator(".henira-drag-handle");
    const box = (await handle.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 5 });
    await page.mouse.up();
    await waitUiStateOnDisk(ctx.dataDir, (doc) => {
      const layout = doc.layout as { leftWidth?: unknown } | undefined;
      return typeof layout?.leftWidth === "number";
    });
    const navWide = await page.locator("nav.henira-sessions").boundingBox();
    expect(navWide?.width ?? 0).toBeGreaterThan(340); // 260 + 120 ≈ 380（拖宽生效）
    // 折叠是纯本地态（不持久化）：把两组都折起来（li=0）——刷新后应按「活跃组展开、其余折叠」重播
    await groupB.click();
    await groupA.click();
    await expect(page.locator(".henira-sessions li")).toHaveCount(0);
    // ── 刷新：选中/草稿/宽度/正文还原 + 组态按活跃组重播 ──
    await page.reload();
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    await expect(activeRow(page)).toContainText("persist-a"); // 上次选中
    await expect(page.getByText(HISTORY_TEXT)).toBeVisible({ timeout: 15_000 }); // 正文随快照回
    await waitUiStateOnDisk(ctx.dataDir, (doc) => doc.draft === DRAFT); // 文档已进宿主（稳定锚）
    await expect(page.locator(".henira-sessions li")).toHaveCount(1); // 刷新前 li=0 → 现在只有活跃组 1 行
    const navAfter = await page.locator("nav.henira-sessions").boundingBox();
    expect(navAfter?.width ?? 0).toBeGreaterThan(340); // 宽度还原
    // 展开 B 组 → 切 B → 草稿随 B 的文档为空；切回 A → 草稿还原
    await groupB.click();
    await expect(page.locator(".henira-sessions li")).toHaveCount(2);
    await page.locator(".henira-sessions li button", { hasText: "persist-b" }).click();
    await expect(activeRow(page)).toContainText("persist-b");
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toHaveValue("");
    await rowA.click();
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toHaveValue(DRAFT);
    await shot(page, "17-persist-reload.png");
  } finally {
    await ctx.stop(true);
    await fs.rm(ctx.dirA, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ctx.dirB, { recursive: true, force: true }).catch(() => {});
  }
});

test("重启还原（D-063 判据②）：同 dataDir 新 server 实例选中/草稿/正文还原（折叠本地重播）", async ({
  page,
}) => {
  const ctx = await startPersistServer(HISTORY_SCRIPT);
  try {
    await page.goto(ctx.server.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    // 初值组态 = 选中会话所在组展开、其余折叠 → 先展开 A 组再点 A
    const groupA = page.locator("button.henira-session-group", { hasText: "persist-a" });
    const groupB = page.locator("button.henira-session-group", { hasText: "persist-b" });
    await expect(page.locator("button.henira-session-group")).toHaveCount(2);
    await groupA.click();
    const rowA = page.locator(".henira-sessions li button", { hasText: "persist-a" });
    await rowA.click();
    await expect(activeRow(page)).toContainText("persist-a");
    // 先造正文一行（重启后必须在场的回归锚）
    const area = page.getByPlaceholder(zh["composer.placeholder"]);
    await area.fill("persist seed");
    await area.press("Enter");
    await expect(page.getByText(HISTORY_TEXT)).toBeVisible({ timeout: 15_000 });
    await area.fill(DRAFT);
    await waitUiStateOnDisk(ctx.dataDir, (doc) => doc.draft === DRAFT);
    // 本地折起两组（不落盘）后停服——重启后组态应重播为「活跃组展开」
    await groupB.click();
    await groupA.click();
    await expect(page.locator(".henira-sessions li")).toHaveCount(0);
    await ctx.stop(false);

    // ── 重启：新实例同 dataDir（新端口）──
    const server2 = await ctx.restart();
    await page.goto(server2.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    await expect(activeRow(page)).toContainText("persist-a"); // 上次选中跨重启
    await expect(page.getByText(HISTORY_TEXT)).toBeVisible({ timeout: 15_000 }); // 正文跨重启
    await expect(page.locator(".henira-sessions li")).toHaveCount(1); // 组态重播：A 展开、B 折叠
    await groupB.click(); // 展开 B → 切 B → 草稿随 B 文档为空
    await page.locator(".henira-sessions li button", { hasText: "persist-b" }).click();
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toHaveValue("");
    await rowA.click();
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toHaveValue(DRAFT); // 草稿跨重启
    await shot(page, "18-persist-restart.png");
  } finally {
    await ctx.stop(true);
    await fs.rm(ctx.dirA, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ctx.dirB, { recursive: true, force: true }).catch(() => {});
  }
});

test("右栏 tab 框架持久化（骨架批）：＋开空白面板 → rightPanel 进 ui-state → 刷新还原", async ({
  page,
}) => {
  const ctx = await startPersistServer();
  try {
    await page.goto(ctx.server.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    // 初态右栏收起 = 窄轨（只有 ＋——面板关着也要有入口）
    await expect(page.locator(".henira-right-rail")).toHaveCount(1);
    await expect(page.locator(".henira-right-tab")).toHaveCount(0);
    // ＋ 新建空白面板展位 tab → 开态全栏 + tab 在场；rightPanel 总账落盘轮询
    await page.getByRole("button", { name: zh["rightPanel.new"] }).click();
    await expect(page.locator(".henira-right-tab")).toHaveCount(1);
    await expect(page.locator(".henira-right-rail")).toHaveCount(0);
    await expect(page.locator(".henira-right-empty")).toContainText(zh["rightPanel.placeholder"]);
    await waitUiStateOnDisk(ctx.dataDir, (doc) => {
      const rp = doc.rightPanel as { open?: unknown } | undefined;
      return rp?.open === true;
    });
    await shot(page, "19-right-panel-blank.png");
    // ── 刷新：右栏开合与 tab 总账还原 ──
    await page.reload();
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".henira-right-tab")).toHaveCount(1);
    await expect(page.locator(".henira-right-rail")).toHaveCount(0);
    // ✕ 关闭末个 tab → 回到窄轨（open:false 回写）
    await page.locator(".henira-right-tab-close").click();
    await expect(page.locator(".henira-right-rail")).toHaveCount(1);
    await waitUiStateOnDisk(ctx.dataDir, (doc) => {
      const rp = doc.rightPanel as { open?: unknown } | undefined;
      return rp?.open === false;
    });
  } finally {
    await ctx.stop(true);
    await fs.rm(ctx.dirA, { recursive: true, force: true }).catch(() => {});
    await fs.rm(ctx.dirB, { recursive: true, force: true }).catch(() => {});
  }
});
