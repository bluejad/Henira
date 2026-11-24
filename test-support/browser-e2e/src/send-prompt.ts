// 发送一条 prompt 的统一就绪闸（R166 家族 flake 的止损点；CI 慢机上多个 spec 先后实锤：
// fill 后直连 Enter 偶发空提交——React 尚未收到草稿 / 会话 id 未就绪，回车被吞）。
// 判据两条：发送钮可用（草稿已进 React 且会话就绪）→ Enter 后草稿清空（真发出）。
// 慢机 boot（建会话 + 拉 uiState）可能超过默认 10s；草稿也可能被宿主回填窗口覆盖——
// 短等一次后重填，再给足 30s。

import { expect, type Page } from "@playwright/test";

export async function sendPrompt(page: Page, text: string): Promise<void> {
  const area = page.getByTestId("composer-input");
  const send = page.locator(".henira-composer-card button.henira-primary");
  await area.fill(text);
  try {
    await expect(send).toBeEnabled({ timeout: 3_000 });
  } catch {
    await area.fill(text); // 草稿被回填/重建吃掉时重填一次
    await expect(send).toBeEnabled({ timeout: 30_000 });
  }
  await area.press("Enter");
  await expect(area).toHaveValue("", { timeout: 5_000 });
}
