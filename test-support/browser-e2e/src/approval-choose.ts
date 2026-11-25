// D-088 审批卡「选中 + 确认」：点未选中行只移动选中，再点同一行（或 Enter）才裁决。
// e2e 的非首行动作一律经此 helper——首行（允许）默认选中，单击即可裁决。

import type { Locator } from "@playwright/test";

export async function chooseApprovalOption(card: Locator, name: string): Promise<void> {
  const option = card.getByRole("button", { name, exact: true });
  await option.click(); // 选中
  await option.click(); // 确认
}
