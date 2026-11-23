// 槽位词表接线（R186 收尾，审查 P3⑦）：host.ts 用的真实词表从本文件来——此前只有
// slot-registry 测试自注入谓词，真实词表（尤其 SINGLE_SLOTS）零覆盖。词表内容 = D-062
// 定稿：14 区域槽 + 三类 keyed 前缀；single 只 composer.bar / composer.model。

import { describe, expect, it } from "vitest";
import {
  isSingleSlot,
  KEYED_PREFIXES,
  REGION_SLOTS,
  SINGLE_SLOTS,
  slotAccepted,
} from "./slot-vocabulary.js";

describe("UI 槽位词表（host 接线）", () => {
  it("区域槽全量对表（D-062：结构性 layout + 三栏 + 输入七席 + 右栏/行级）", () => {
    expect([...REGION_SLOTS].sort()).toEqual(
      [
        "layout",
        "sidebar",
        "conversation",
        "composer",
        "composer.bar",
        "composer.takeover",
        "composer.model",
        "composer.left",
        "composer.right",
        "composer.dock",
        "sidebar.right",
        "sidebar.right.tab",
        "turn.tail",
        "conversation.images",
      ].sort(),
    );
    expect(REGION_SLOTS.size).toBe(14);
  });

  it("single 槽 = composer.bar / composer.model + 预览键全族；其余区域槽都不单占", () => {
    expect([...SINGLE_SLOTS].sort()).toEqual(["composer.bar", "composer.model"]);
    for (const name of REGION_SLOTS) {
      if (name === "composer.bar" || name === "composer.model") continue;
      expect(isSingleSlot(name)).toBe(false);
    }
    // R190：预览键按后缀单占（通配 * 与空后缀同族）
    expect(isSingleSlot("sidebar.right.preview.docx")).toBe(true);
    expect(isSingleSlot("sidebar.right.preview.tar.gz")).toBe(true);
    expect(isSingleSlot("sidebar.right.preview.*")).toBe(true);
    expect(isSingleSlot("sidebar.right.preview.")).toBe(true);
    expect(isSingleSlot("tool.call.view.bash")).toBe(false);
  });

  it("keyed 前缀三类、后缀自由；词表外拒绝（大小写敏感）", () => {
    expect(KEYED_PREFIXES).toEqual(["tool.call.view.", "sidebar.right.preview.", "approval.view."]);
    expect(slotAccepted("tool.call.view.bash")).toBe(true);
    expect(slotAccepted("tool.call.view.mcp")).toBe(true);
    expect(slotAccepted("sidebar.right.preview.docx")).toBe(true);
    expect(slotAccepted("approval.view.powershell")).toBe(true);
    expect(slotAccepted("composer.model")).toBe(true);
    expect(slotAccepted("tool.call.view.")).toBe(true); // 前缀本身合法（后缀自由，空后缀由消费侧兜）
    expect(slotAccepted("composer.bogus")).toBe(false);
    expect(slotAccepted("Tool.call.view.bash")).toBe(false);
    expect(slotAccepted("")).toBe(false);
  });
});
