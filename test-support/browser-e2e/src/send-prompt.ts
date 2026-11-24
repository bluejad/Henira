// 发送一条 prompt 的统一就绪闸（R166 家族 flake 的止损点；CI 慢机上多个 spec 先后实锤：
// fill 后直连 Enter 偶发空提交——React 尚未收到草稿 / 会话 id 未就绪，回车被吞）。
// 判据两条：发送钮可用（草稿已进 React 且会话就绪）→ Enter 后草稿清空（真发出）。

import { expect, type Page } from "@playwright/test";

export async function sendPrompt(page: Page, text: string): Promise<void> {
  const area = page.getByTestId("composer-input");
  await area.fill(text);
  await expect(page.locator(".henira-composer-card button.henira-primary")).toBeEnabled();
  await area.press("Enter");
  await expect(area).toHaveValue("", { timeout: 5_000 });
}
