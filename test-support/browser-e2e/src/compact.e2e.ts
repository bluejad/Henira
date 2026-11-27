// 手动压缩经输入框（D-092）真浏览器全链：余量面板「压缩」只把 /compact 交给输入框（此刻零请求）；
// 回车走与消息同一个提交函数 → 压缩入队并执行；压缩进行中发消息 = 排队（不插到压缩前面），
// 压完按序执行。选择器取 zh 字典，用例字符串保持 ASCII。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mockFinish, mockLlm, mockText, mockUsage } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import type { StreamEvent } from "@henira/protocol";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";
import { sendPrompt } from "./send-prompt.js";

const TURN_USAGE = { inputTokens: 40_000, outputTokens: 5_000 };
/** 长历史各回合的 usage：读数必须跟着历史涨——每轮都报同一个数会被计量器判成「截断嫌疑」
 *  （读数不涨），连判两次就把 40K 学成观测上限，压力线随之塌到历史以下（首版夹具踩过） */
const bigTurnUsage = (i: number): StreamEvent =>
  mockUsage({ inputTokens: 8_000 + i * 9_700, outputTokens: 5_000 });

/** 摘要请求的慢流（24 块 × 250ms = 6s）——给「压缩进行中发消息」留出确定的可断言窗口 */
async function* summaryStream(): AsyncGenerator<StreamEvent> {
  for (let i = 0; i < 24; i += 1) {
    yield { type: "text-delta", text: "summary part. " };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  yield { type: "usage", usage: { inputTokens: 20_000, outputTokens: 200 } };
  yield { type: "finish", reason: "stop" };
}

// 可压的历史：5 个回合、每个回答约 24K 字符（估算约 9.7K token）——尾部保留段（15.4K token）
// 之外还有 ≥ headMin（6.4K token）的头部可压
const BIG_ANSWER = "decision record with implementation notes and follow-up items. ".repeat(360);
const TURNS = 5;
const historyScript = Array.from({ length: TURNS }, (_, i) => [
  mockText(`${BIG_ANSWER} end of answer ${i}.`),
  bigTurnUsage(i),
  mockFinish("stop"),
]);

const QUEUE_ROW = ".henira-queue-row";
const COMPACTION_ROW = ".henira-compaction";

// 铺历史（多个长回合的流式渲染 + markdown）超过 Playwright 缺省 30s
test.setTimeout(180_000);

async function startServer(script: Parameters<typeof mockLlm>[0]): Promise<{
  server: HeniraServer;
  stop: () => Promise<void>;
}> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-compact-e2e-data-"));
  const globalDir = await fs.mkdtemp(path.join(tmpdir(), "henira-compact-e2e-config-"));
  // llm 是桩，配置仍要有默认模型可解析（examples/mock 同款最小 settings）
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mockLlm(script).service },
    port: 0,
  });
  return {
    server,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(globalDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** 记录本页之后发出的写请求：压缩入队（/compact）/ 消息入队（/prompt）各一条队列 */
function trackPosts(page: Page): { compact: number[]; messages: string[] } {
  const posts = { compact: [] as number[], messages: [] as string[] };
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const pathname = new URL(req.url()).pathname;
    if (pathname.endsWith("/compact")) posts.compact.push(Date.now());
    if (pathname.endsWith("/prompt")) posts.messages.push(req.postData() ?? "");
  });
  return posts;
}

/** 回合跑完的判据：空草稿 + 发送钮回来（忙时是停止钮） */
async function waitIdle(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: zh["composer.send"] })).toBeVisible({
    timeout: 30_000,
  });
}

test("compact entry is the composer: panel hands /compact to the input, Enter submits it", async ({
  page,
}) => {
  const { server, stop } = await startServer([
    [mockText("first answer"), mockUsage(TURN_USAGE), mockFinish("stop")],
  ]);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId("composer-input")).toBeVisible({ timeout: 20_000 });
    await sendPrompt(page, "warm up the context meter");
    await expect(page.getByText("first answer")).toBeVisible();
    await waitIdle(page);

    const posts = trackPosts(page);
    const area = page.getByTestId("composer-input");

    // 入口 = 输入框：面板悬停展开，「压缩」只把命令交给输入框——此刻零请求、面板收起、焦点跟过去
    await page.locator(".henira-context-entry").hover();
    const compactButton = page.locator(".henira-context-compact-btn");
    await expect(compactButton).toBeVisible();
    await compactButton.click();
    await expect(area).toHaveValue("/compact");
    await expect(area).toBeFocused();
    await expect(page.locator(".henira-context-pop")).toHaveCount(0);
    expect(posts.compact).toEqual([]);
    expect(posts.messages).toEqual([]);

    // 手敲的命令同路：说明跟在命令后面
    await area.fill("/COMPACT keep the decisions");
    await area.press("Enter");
    await expect.poll(() => posts.compact.length).toBe(1);
    await expect(area).toHaveValue("");
    expect(posts.messages).toEqual([]); // 压缩命令不走消息端点
    // 历史不足：已消费、无需压缩——输入栏行内说明（非失败态），草稿不回填
    const notice = page.getByText(zh["context.compactSkipped"]);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveClass(/henira-send-notice/);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await stop();
  }
});

test("message sent while a compact command is running queues behind it", async ({ page }) => {
  const { server, stop } = await startServer([
    ...historyScript,
    summaryStream(), // 手动压缩的摘要请求（6s 慢流）
    [mockText("ran after compact"), mockUsage(TURN_USAGE), mockFinish("stop")],
  ]);
  try {
    await page.goto(server.url);
    await expect(page.getByTestId("composer-input")).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < TURNS; i += 1) {
      await sendPrompt(page, `history turn ${i}`);
      await expect(page.getByText(`end of answer ${i}.`)).toBeVisible({ timeout: 30_000 });
      await waitIdle(page);
    }

    const posts = trackPosts(page);
    const area = page.getByTestId("composer-input");

    // 经输入框提交压缩命令 → 入队即执行
    await area.fill("/compact");
    await area.press("Enter");
    await expect(area).toHaveValue("");
    await expect(page.locator(COMPACTION_ROW)).toHaveAttribute("data-state", "running", {
      timeout: 10_000,
    });

    // 压缩进行中发消息：发送键是「排队发送」，消息进排队卡——不开回合、不插到压缩前面
    await area.fill("queued during compact");
    await expect(page.getByRole("button", { name: zh["composer.queueSend"] })).toBeVisible();
    await area.press("Enter");
    await expect(area).toHaveValue("");
    await expect(
      page.locator(QUEUE_ROW).filter({ hasText: "queued during compact" }),
    ).toBeVisible();
    await expect(page.getByText("ran after compact")).toHaveCount(0);
    expect(posts.compact).toHaveLength(1);
    expect(posts.messages).toHaveLength(1);
    expect(posts.messages[0]).toContain("queued during compact");

    // 压完 → 排队的消息按序执行、排队卡清空
    await expect(page.locator(COMPACTION_ROW)).toHaveAttribute("data-state", "completed", {
      timeout: 30_000,
    });
    await expect(page.getByText("ran after compact")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(QUEUE_ROW)).toHaveCount(0);
    await waitIdle(page);
  } finally {
    await stop();
  }
});
