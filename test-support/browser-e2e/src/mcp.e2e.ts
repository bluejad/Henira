// MCP 读者 e2e（C5 真浏览器闭环，D-064）：带 mcp 槽的纯内容包 + UI 件 useResource 面板——
// 未确认 = 面板 failed（确认前工具/泵不达）→ 管理面确认连接 → 新会话装配自动连接 →
// 2s 泵 live 数据上屏 → 管理面徽章转已确认。断言走 data 属性；轮询等待 timeout 放宽。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockLlm } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";

const ARTIFACTS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "artifacts",
  "C5-mcp",
);

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** MCP stdio 桩（手写 JSON-RPC——initialize / tools/list / tools/call echo） */
const MCP_STUB = `let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let idx;
  while ((idx = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line === "") continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "e", version: "1" } } }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } }) + "\\n");
    } else if (msg.method === "tools/call") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ echo: msg.params.arguments?.text ?? null, at: 1 }) }] } }) + "\\n");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

/** echo-mcp 包：mcp 槽（stdio 桩）+ UI 件（turn.tail 面板调 host.useResource——所有权闸
 *  绑定本插件 id） */
async function writeMcpUiPack(dataDir: string): Promise<void> {
  const dir = path.join(dataDir, "plugins", "echo-mcp", "1.0.0");
  await fs.mkdir(path.join(dir, "mcp"), { recursive: true });
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(path.join(dir, "stub.js"), MCP_STUB, "utf8");
  await fs.writeFile(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name: "echo-mcp", version: "1.0.0", ui: { title: "echo-mcp" } }),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "mcp", "echo.json"),
    JSON.stringify({ command: process.execPath, args: [path.join(dir, "stub.js")] }),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "ui", "main.js"),
    `import { jsx } from "react/jsx-runtime";

export function apply(ctx) {
  const address = "henira-data://echo-mcp/echo/echo?args=" + encodeURIComponent(JSON.stringify({ text: "browser" }));
  function PumpPanel() {
    const snap = ctx.host.useResource(address);
    return jsx("div", {
      "data-pump-state": snap.status,
      "data-pump-text": snap.text ?? "",
      "data-pump-error": snap.error ?? "",
      children: snap.status === "live" ? "PUMP-LIVE" : snap.status.toUpperCase(),
    });
  }
  return ctx.registerSlot("turn.tail", PumpPanel);
}
`,
    "utf8",
  );
}

async function startServer(): Promise<{
  server: HeniraServer;
  dataDir: string;
  stop: () => Promise<void>;
}> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-mcp-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mockLlm([]).service },
    port: 0,
  });
  return {
    server,
    dataDir,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("MCP 全链：未确认泵 failed → 管理面确认连接 → 新会话泵 live（真 stdio server）", async ({
  page,
}) => {
  const { server, dataDir, stop } = await startServer();
  try {
    await writeMcpUiPack(dataDir);
    await page.goto(server.url);
    // 第三方 UI 件装载（批 C 通道）；泵首拉 → 未确认 = 不连接 → failed 快照
    const panel = page.locator("[data-pump-state]");
    await expect(panel).toBeVisible({ timeout: 12000 });
    await expect(panel).toHaveAttribute("data-pump-state", "failed", { timeout: 10000 });
    await shot(page, "01-pump-failed-unconfirmed.png");

    // 管理面：插件页 → echo-mcp 行 → MCP 分区可见（名/待确认徽章）→ 确认连接
    await page.getByRole("button", { name: zh["settings.open"] }).first().click();
    await page.getByRole("button", { name: zh["settings.section.plugins"] }).click();
    const row = page.locator('[data-plugin-id="echo-mcp"]');
    await expect(row).toBeVisible({ timeout: 8000 });
    await expect(row).toContainText(zh["settings.plugins.mcpAwaiting"]);
    await shot(page, "02-plugins-page-awaiting.png");
    const confirmButton = row
      .locator("button")
      .filter({ hasText: zh["settings.plugins.mcpConfirm"] });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
    // 徽章跟手（页面 2s 轮询刷新清单）→ 已确认；确认按钮退场
    await expect(row).toContainText(zh["settings.plugins.mcpConfirmed"], { timeout: 10000 });
    await expect(confirmButton).toHaveCount(0);
    // 关设置弹窗（对话框头部首个按钮 = 关闭钮；aria-label 三处同名「设置」须用 dialog 作用域）
    const dialog = page.getByRole("dialog", { name: zh["settings.title"] });
    await dialog.locator("button").first().click();
    await shot(page, "03-confirmed.png");

    // 新会话（确认语义 = 新会话装配自动连接）：泵 2s 轮询在旧会话仍 failed（旧会话装配时
    // servers=[]）——切新会话后 MCP 连接建立 → live 数据上屏
    await page.getByRole("button", { name: `+ ${zh["sessions.new"]}` }).click();
    const deadline = Date.now() + 15000;
    let state = "";
    let errorText = "";
    while (Date.now() < deadline) {
      state =
        (await page.locator("[data-pump-state]").first().getAttribute("data-pump-state")) ?? "";
      errorText =
        (await page.locator("[data-pump-state]").first().getAttribute("data-pump-error")) ?? "";
      if (state === "live") break;
      await page.waitForTimeout(300);
    }
    if (state !== "live") {
      // 失败诊断：逐会话资源直打（分辨「没切会话」vs「新会话拿空 servers」）
      const sessions = (await (await fetch(`${server.url}/api/sessions`)).json()) as {
        id: string;
        updatedAt: number;
      }[];
      const lines: string[] = [];
      for (const s of sessions) {
        const r = await fetch(`${server.url}/api/sessions/${s.id}/resource`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pluginId: "echo-mcp",
            address:
              "henira-data://echo-mcp/echo/echo?args=" +
              encodeURIComponent(JSON.stringify({ text: "probe" })),
          }),
        });
        lines.push(`${s.id} -> ${r.status} ${JSON.stringify(await r.json())}`);
      }
      throw new Error(
        "pump did not go live (state=" +
          state +
          ", error=" +
          errorText +
          ")\nsessions:\n" +
          lines.join("\n"),
      );
    }
    const text =
      (await page.locator("[data-pump-state]").first().getAttribute("data-pump-text")) ?? "{}";
    expect(JSON.parse(text)).toEqual({ echo: "browser", at: 1 });
    await shot(page, "04-pump-live.png");
  } finally {
    await stop();
  }
});
