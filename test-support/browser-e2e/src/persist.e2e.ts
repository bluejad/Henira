// 会话绑定界面状态持久化验收（D-063 判据①②）：草稿 / 上次选中 / 侧栏宽 / 折叠组——
// 刷新还原（reload）+ 重启还原（同 dataDir 新 server 实例）。每断言落盘前用磁盘文件轮询
// 确定性等待（CI 纪律：异步断言禁固定 sleep——防抖 500ms 在慢机不可靠）。选择器取 locale 字典。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockLlm } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");
const DRAFT = "persistent draft text";

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** 两个不同 cwd 的会话（组可折叠）——registry 建会话自动登记目录（D-060） */
async function startPersistServer(): Promise<{
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
    llm: { name: "llm", start: () => mockLlm([]).service },
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
      llm: { name: "llm", start: () => mockLlm([]).service },
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

test("刷新还原（D-063 判据①）：上次选中 + 草稿 + 侧栏宽 + 折叠组", async ({ page }) => {
  const ctx = await startPersistServer();
  try {
    await page.goto(ctx.server.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    // 初始选中 = 列表第一个（updatedAt 最新 = dirB 会话）；全局指针此刻为 null——先点 A 再回来
    const rowA = page.locator(".henira-sessions li button", { hasText: "persist-a" });
    await rowA.click();
    await expect(activeRow(page)).toContainText("persist-a");
    // 草稿（A 的文档）→ 防抖落盘轮询
    const area = page.getByPlaceholder(zh["composer.placeholder"]);
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
    // 折叠非活跃组（dirB 组，A 的文档）→ B 行隐藏
    const groupHeaders = page.locator("button.henira-session-group");
    await expect(groupHeaders).toHaveCount(2);
    await groupHeaders.first().click(); // 组序 = 登记表 lastOpenedAt 降序 → first = dirB（非活跃）
    await waitUiStateOnDisk(ctx.dataDir, (doc) => {
      const sidebar = doc.sidebar as { collapsedGroups?: unknown } | undefined;
      return Array.isArray(sidebar?.collapsedGroups);
    });
    await expect(page.locator(".henira-sessions li")).toHaveCount(1); // 只剩 A
    // ── 刷新：四样全还原 ──
    await page.reload();
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    await expect(activeRow(page)).toContainText("persist-a"); // 上次选中
    await waitUiStateOnDisk(ctx.dataDir, (doc) => doc.draft === DRAFT); // 文档已进宿主（稳定锚）
    await expect(page.locator(".henira-sessions li")).toHaveCount(1); // 折叠还原（B 行仍隐藏）
    const navAfter = await page.locator("nav.henira-sessions").boundingBox();
    expect(navAfter?.width ?? 0).toBeGreaterThan(340); // 宽度还原
    // 展开组 → 切 B → 草稿随 B 的文档为空；切回 A → 草稿还原
    await page.locator("button.henira-session-group").first().click();
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

test("重启还原（D-063 判据②）：同 dataDir 新 server 实例四样全还原", async ({ page }) => {
  const ctx = await startPersistServer();
  try {
    await page.goto(ctx.server.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    const rowA = page.locator(".henira-sessions li button", { hasText: "persist-a" });
    await rowA.click();
    await expect(activeRow(page)).toContainText("persist-a");
    const area = page.getByPlaceholder(zh["composer.placeholder"]);
    await area.fill(DRAFT);
    await waitUiStateOnDisk(ctx.dataDir, (doc) => doc.draft === DRAFT);
    // 折叠非活跃组（dirB）后停服——不 wipe 盘
    const groupHeaders = page.locator("button.henira-session-group");
    await expect(groupHeaders).toHaveCount(2);
    await groupHeaders.first().click();
    await waitUiStateOnDisk(ctx.dataDir, (doc) => {
      const sidebar = doc.sidebar as { collapsedGroups?: unknown } | undefined;
      return Array.isArray(sidebar?.collapsedGroups);
    });
    await ctx.stop(false);

    // ── 重启：新实例同 dataDir（新端口）──
    const server2 = await ctx.restart();
    await page.goto(server2.url);
    await expect(page.getByPlaceholder(zh["composer.placeholder"])).toBeVisible({
      timeout: 15_000,
    });
    await expect(activeRow(page)).toContainText("persist-a"); // 上次选中跨重启
    await expect(page.locator(".henira-sessions li")).toHaveCount(1); // 折叠还原
    await page.locator("button.henira-session-group").first().click(); // 展开 → 切 B → 草稿随 B 文档为空
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
