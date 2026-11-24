// 卡死治理 e2e（R193）：真 provider 链路 + 假 SSE 端点（写完响应头就静默）。
// 期望：plugin-llm 空闲看门狗（settings 压到 1.5s）掐流 → ErrorRow（LLM_STREAM_IDLE_TIMEOUT）
// → 可行动中文提示上屏、busy 归 false；等待期只显示「工作中」走秒（不再有 3s「响应停滞」）。

import { promises as fs } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";
import { sendPrompt } from "./send-prompt.js";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

/** 静默 provider：SSE 头写完永不发数据、永不结束（网关静默的确定性复现） */
function startSilentProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createHttpServer((req, res) => {
      req.resume(); // 吃掉请求体
      if (req.method !== "POST") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.flushHeaders();
      // 一个字节都不写、也永不主动结束（req 的 close 表示请求体读完，不是客户端断开）
      res.on("close", () => {
        // 客户端 abort 后连接关闭——无需清理
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections(); // 静默响应永不自然结束——收尾强关，别让 close 挂住
            server.close(() => done());
          }),
      });
    });
  });
}

async function startServer(providerBaseUrl: string): Promise<{
  server: HeniraServer;
  dataDir: string;
  stop: () => Promise<void>;
}> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-stall-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({
      version: 1,
      model: "silent/silent-1",
      // 测试压缩：1.5s 静默即判死（生产默认 180s，语义同一条看门狗）
      plugins: { "plugin-llm": { options: { streamIdleTimeoutMs: 1500 } } },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(globalDir, "models.json"),
    JSON.stringify({
      version: 1,
      providers: { silent: { label: "Silent", baseUrl: providerBaseUrl } },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(globalDir, "credentials.json"),
    JSON.stringify({ providers: { silent: "e2e-fake-key" } }),
    "utf8",
  );
  // 不注入 llm 桩：走官方 plugin-llm + 真 AI SDK 流（看门狗所在层）
  const server = await createServer({ dataDir, globalDir, port: 0 });
  return {
    server,
    dataDir,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("provider 静默 → 空闲看门狗收口：错误行 + busy 归 false；等待期只走秒", async ({ page }) => {
  const provider = await startSilentProvider();
  const { server, stop } = await startServer(provider.baseUrl);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId("composer-input")).toBeVisible({ timeout: 20_000 });
    await sendPrompt(page, "silent provider run");

    // 等待期：忙碌行是「工作中」走秒（R193 删掉了 3s「响应停滞」的猜测）
    await expect(page.locator(".henira-loading-dots")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(zh["conversation.working"])).toBeVisible();

    // 看门狗触发：错误行（code 可见）+ 可行动中文提示；busy 归 false
    await expect(page.getByText("LLM_STREAM_IDLE_TIMEOUT")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(zh["error.idleTimeoutHint"]).first()).toBeVisible();
    await expect(page.locator(".henira-loading-dots")).toHaveCount(0);

    await shot(page, "r193-01-idle-timeout-error.png");
  } finally {
    await stop();
    await provider.close();
  }
});
