// 预览缝 e2e（R190 真浏览器闭环）：第三方 UI 插件注册 sidebar.right.preview.txt 顶替官方
// 内置预览体 → 点文件 chip 开右栏 tab → 插件体渲染；停用插件（2s 指纹轮询）→ 自动回落官方体。
// 服务端 = 进程内真 server + mock LLM 脚本（write 审批 → read → 收尾）；选择器取 zh 字典。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockFinish, mockLlm, mockText, mockToolCall, mockUsage } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** 第三方预览体：注册 sidebar.right.preview.txt（精确后缀单占用；官方兜底在通配键） */
async function writePreviewPlugin(dataDir: string): Promise<void> {
  const id = "txt-pack";
  const version = "1.0.0";
  const dir = path.join(dataDir, "plugins", id, version);
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name: id, version, ui: { title: id } }),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "ui", "main.js"),
    `import { jsx } from "react/jsx-runtime";

export function apply(ctx) {
  function TxtPreview(args) {
    return jsx("div", {
      "data-preview-plugin": "txt-pack",
      children: "PLUGIN PREVIEW " + args.target.path,
    });
  }
  return ctx.registerSlot("sidebar.right.preview.txt", TxtPreview);
}
`,
    "utf8",
  );
}

async function startServer(): Promise<{
  server: HeniraServer;
  dataDir: string;
  globalDir: string;
  stop: () => Promise<void>;
}> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-preview-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  await writePreviewPlugin(dataDir);
  const mock = mockLlm([
    [
      mockToolCall("fs1", "write", '{"file_path":"e2e-preview.txt","content":"alpha\\nbeta\\n"}'),
      mockUsage({ inputTokens: 1, outputTokens: 1 }),
      mockFinish("tool-calls"),
    ],
    [
      mockToolCall("fs2", "read", '{"file_path":"e2e-preview.txt"}'),
      mockUsage({ inputTokens: 1, outputTokens: 1 }),
      mockFinish("tool-calls"),
    ],
    [
      mockText("preview flow complete"),
      mockUsage({ inputTokens: 1, outputTokens: 1 }),
      mockFinish("stop"),
    ],
  ]);
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mock.service },
    port: 0,
  });
  return {
    server,
    dataDir,
    globalDir,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("preview seam: plugin body takes over .txt, disable falls back to official", async ({
  page,
}) => {
  const { server, dataDir, globalDir, stop } = await startServer();
  try {
    await page.goto(server.url);
    const textarea = page.getByTestId("composer-input");
    await expect(textarea).toBeVisible({ timeout: 20_000 });
    await textarea.fill("write and read a preview file");
    await textarea.press("Enter");

    // write 非只读 → 审批卡；放行
    const card = page.getByRole("dialog", { name: zh["approval.title"] });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: zh["approval.allow"], exact: true }).click();
    await expect(page.getByText("preview flow complete")).toBeVisible({ timeout: 20_000 });

    // 展开完成轮的过程（R177 默认折叠）→ 点 read 的文件 chip 开右栏预览
    await page
      .getByRole("button", { name: /已处理|已工作/ })
      .last()
      .click();
    const groups = page.locator(".henira-work-group-head");
    if (await groups.count()) await groups.last().click();
    await page.locator(".henira-file-link").first().click();

    // 插件体在场，官方内置体不在
    const seam = page.locator('[data-preview-plugin="txt-pack"]');
    await expect(seam).toBeVisible({ timeout: 10_000 });
    await expect(seam).toContainText("PLUGIN PREVIEW");
    await expect(page.locator(".henira-right-preview .henira-preview-text")).toHaveCount(0);
    await shot(page, "01-preview-plugin.png");

    // 停用插件 → 2s 指纹轮询 dispose + 重装 → 已开 tab 回落官方体（行快照仍在）
    await fs.writeFile(
      path.join(globalDir, "settings.json"),
      JSON.stringify({
        version: 1,
        model: "mock/mock-1",
        plugins: { "txt-pack": { enabled: false } },
      }),
      "utf8",
    );
    await expect(seam).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".henira-right-preview .henira-preview-text")).toContainText("alpha");
    await expect(page.locator(".henira-right-preview .henira-preview-text")).toContainText("beta");
    await shot(page, "02-official-fallback.png");

    // 数据目录断言（插件仍在盘上，只是 enabled=false——回落不靠删除）
    expect((await fs.stat(path.join(dataDir, "plugins", "txt-pack", "1.0.0"))).isDirectory()).toBe(
      true,
    );
  } finally {
    await stop();
    // 工具写的演示文件落在测试进程 cwd（默认会话目录）——清掉不留工作树脏物
    await fs.rm(path.join(process.cwd(), "e2e-preview.txt"), { force: true }).catch(() => {});
  }
});
