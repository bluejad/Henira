// R200 布局 e2e：滚动条贴中列最右 + 用户气泡右缘 = 输入卡右缘（助手正文左缘 = 卡片左缘）。
// 关键窄窗 1024：中列比列宽窄，输入区外层必须与滚动视口同槽宽内缩，否则右缘差一个槽宽。
// 服务端 = 进程内真 server + mock LLM（长文本撑出滚动条）；选择器取 zh 字典。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockFinish, mockLlm, mockText, mockUsage } from "@henira/llm-mock";
import { zh } from "@henira/plugin-web-ui";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, type Page, test } from "@playwright/test";
import { sendPrompt } from "./send-prompt.js";

const ARTIFACTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts");

async function shot(page: Page, name: string): Promise<void> {
  await fs.mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, name) });
}

async function startServer(): Promise<{ server: HeniraServer; stop: () => Promise<void> }> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-layout-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  // 长回复把对话撑出滚动条（截图能看到 thumb 在滚动视口最右）
  const mock = mockLlm([
    [
      mockText("layout alignment sample ".repeat(260)),
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
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

interface LayoutMetrics {
  convRight: number;
  wrapRight: number;
  bubbleRight: number;
  assistantLeft: number;
  cardLeft: number;
  cardRight: number;
  hOverflow: number;
}

async function readMetrics(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const conv = document.querySelector(".henira-conversation") as HTMLElement;
    const wrap = conv.parentElement as HTMLElement;
    const bubble = document.querySelector(".henira-user-bubble") as HTMLElement;
    const assistant = document.querySelector(".henira-assistant") as HTMLElement;
    const card = document.querySelector(".henira-composer-card") as HTMLElement;
    const rect = (el: HTMLElement): DOMRect => el.getBoundingClientRect();
    return {
      convRight: rect(conv).right,
      wrapRight: rect(wrap).right,
      bubbleRight: rect(bubble).right,
      assistantLeft: rect(assistant).left,
      cardLeft: rect(card).left,
      cardRight: rect(card).right,
      hOverflow: conv.scrollWidth - conv.clientWidth,
    };
  });
}

test("layout: scrollbar hugs the center pane; user bubble and composer share the right edge", async ({
  page,
}) => {
  const { server, stop } = await startServer();
  try {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(server.url);
    await page
      .getByRole("button", { name: zh["composer.permission"] })
      .waitFor({ state: "visible", timeout: 20_000 });
    await sendPrompt(page, "layout alignment check");
    await page.locator(".henira-assistant").first().waitFor({ state: "visible", timeout: 20_000 });
    await page
      .locator(".henira-user-bubble")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    for (const width of [1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      // 视口切换 → resize 监听重测槽宽（慢机可能晚一两帧才落 CSS 变量）；轮询到三线对齐
      await expect
        .poll(
          async () => {
            const m = await readMetrics(page);
            return Math.max(
              Math.abs(m.convRight - m.wrapRight),
              Math.abs(m.bubbleRight - m.cardRight),
              Math.abs(m.assistantLeft - m.cardLeft),
            );
          },
          { timeout: 5_000, message: `layout not settled at ${width}px` },
        )
        .toBeLessThanOrEqual(1);
      const m = await readMetrics(page);
      // 滚动视口铺满中列 → 滚动条（视口右缘）贴中列最右
      expect(Math.abs(m.convRight - m.wrapRight)).toBeLessThanOrEqual(1);
      // 用户气泡右缘 = 输入卡右缘；助手正文左缘 = 输入卡左缘（共用扣槽后的横向盒子）
      expect(Math.abs(m.bubbleRight - m.cardRight)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.assistantLeft - m.cardLeft)).toBeLessThanOrEqual(1);
      // 不引入横向滚动（长文本只应纵向撑高）
      expect(m.hOverflow).toBeLessThanOrEqual(1);
      await shot(page, `layout-${width}.png`);
    }

    // 视觉留档：滚到顶看气泡右缘（卡片常驻底部）——1024 窄窗 + 1920 宽窗
    for (const width of [1024, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      await page.locator(".henira-conversation").evaluate((el) => {
        (el as HTMLElement).scrollTop = 0;
      });
      await page.waitForTimeout(100);
      await shot(page, `layout-${width}-top.png`);
    }

    // 右栏开合也成立（中列变窄 → 内层列铺满扣槽后的盒子）
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: zh["rightPanel.open"] }).click();
    await expect
      .poll(
        async () => {
          const m = await readMetrics(page);
          return Math.max(
            Math.abs(m.convRight - m.wrapRight),
            Math.abs(m.bubbleRight - m.cardRight),
            Math.abs(m.assistantLeft - m.cardLeft),
          );
        },
        { timeout: 5_000, message: "layout not settled with right panel open" },
      )
      .toBeLessThanOrEqual(1);
    const open = await readMetrics(page);
    expect(Math.abs(open.convRight - open.wrapRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(open.bubbleRight - open.cardRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(open.assistantLeft - open.cardLeft)).toBeLessThanOrEqual(1);
    // R201 卡片化（同日修订）：三栏都是卡片；缝只留在栏与栏之间（4px），四周贴窗口
    const card = await page.evaluate(() => {
      const rect = (el: Element | null): DOMRect | null =>
        el === null ? null : el.getBoundingClientRect();
      const leftCol = document.querySelector(".henira-left-col");
      const leftCard = leftCol?.classList.contains("henira-pane-card") ? leftCol : null;
      const centerCard =
        document.querySelector(".henira-conversation")?.closest(".henira-pane-card") ?? null;
      const rightCard =
        document.querySelector(".henira-right-col")?.closest(".henira-pane-card") ?? null;
      const l = rect(leftCard);
      const c = rect(centerCard);
      const r = rect(rightCard);
      const cs = centerCard === null ? null : getComputedStyle(centerCard);
      return {
        leftGap: l === null || c === null ? null : c.left - l.right,
        rightGap: c === null || r === null ? null : r.left - c.right,
        leftEdge: l === null ? null : l.left,
        rightEdge: r === null ? null : window.innerWidth - r.right,
        top: c === null ? null : c.top,
        bottom: c === null ? null : window.innerHeight - c.bottom,
        radius: cs?.borderTopLeftRadius ?? null,
        border: cs?.borderTopWidth ?? null,
        leftRadius: leftCard === null ? null : getComputedStyle(leftCard).borderTopLeftRadius,
      };
    });
    expect(card.top).not.toBeNull();
    expect(Math.abs(card.top ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    expect(card.bottom).not.toBeNull();
    expect(Math.abs(card.bottom ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    expect(card.leftEdge).not.toBeNull();
    expect(Math.abs(card.leftEdge ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    expect(card.rightEdge).not.toBeNull();
    expect(Math.abs(card.rightEdge ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    if (card.leftGap !== null) expect(Math.abs(card.leftGap - 4)).toBeLessThanOrEqual(1);
    expect(card.rightGap).not.toBeNull();
    expect(Math.abs((card.rightGap ?? Number.POSITIVE_INFINITY) - 4)).toBeLessThanOrEqual(1);
    expect(card.radius).toBe("12px");
    expect(card.border).toBe("1px");
    expect(card.leftRadius).toBe("12px");
    await shot(page, "layout-1280-right-panel.png");

    // 最大化 = 全屏卡片，四角同样圆（D-084 同日修订）
    await page.getByRole("button", { name: zh["rightPanel.maximize"] }).click();
    const max = await page.evaluate(() => {
      const el = document.querySelector(".henira-right-panel--max");
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return {
        left: b.left,
        top: b.top,
        right: window.innerWidth - b.right,
        bottom: window.innerHeight - b.bottom,
        radius: getComputedStyle(el).borderTopLeftRadius,
      };
    });
    expect(max).not.toBeNull();
    expect(Math.abs(max?.left ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    expect(Math.abs(max?.top ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    expect(Math.abs(max?.right ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    expect(Math.abs(max?.bottom ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(1);
    expect(max?.radius).toBe("12px");
    await shot(page, "layout-1280-maximized.png");
  } finally {
    await stop();
  }
});
