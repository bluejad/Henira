// ui.slots 静态申报校验（D-031 / D-085）：未声明不校验；unknown / 死声明 / 漏声明三分。

import { describe, expect, it } from "vitest";
import { auditUiSlots } from "./ui-slot-audit.js";

const accepted = (name: string) =>
  name === "sidebar" || name === "conversation" || name.startsWith("tool.call.view.");

describe("auditUiSlots", () => {
  it("未声明（undefined / 空）→ 不校验", () => {
    expect(auditUiSlots({ declared: undefined, registered: ["sidebar"], accepted })).toEqual({
      unknown: [],
      missing: [],
      undeclared: [],
    });
    expect(auditUiSlots({ declared: [], registered: ["sidebar"], accepted })).toEqual({
      unknown: [],
      missing: [],
      undeclared: [],
    });
  });

  it("声明但未注册 = 死声明；注册但未声明 = 漏声明", () => {
    const out = auditUiSlots({
      declared: ["sidebar", "tool.call.view.bash"],
      registered: ["sidebar", "conversation"],
      accepted,
    });
    expect(out.missing).toEqual(["tool.call.view.bash"]);
    expect(out.undeclared).toEqual(["conversation"]);
    expect(out.unknown).toEqual([]);
  });

  it("未知挂载点单独归类（丢弃 + 告警）", () => {
    const out = auditUiSlots({
      declared: ["session.top"],
      registered: [],
      accepted,
    });
    expect(out.unknown).toEqual(["session.top"]);
    expect(out.missing).toEqual([]);
  });

  it("槽名先归一（预览键大小写/前导点）再比对", () => {
    const canonical = (name: string) =>
      name.startsWith("sidebar.right.preview.")
        ? `sidebar.right.preview.${name.slice("sidebar.right.preview.".length).toLowerCase().replace(/^\./, "")}`
        : name;
    const acceptedWithPreview = (name: string) =>
      accepted(name) || name.startsWith("sidebar.right.preview.");
    const out = auditUiSlots({
      declared: ["sidebar.right.preview.MD", "sidebar.right.preview..md"],
      registered: ["sidebar.right.preview.md"],
      accepted: acceptedWithPreview,
      canonical,
    });
    expect(out.unknown).toEqual([]);
    expect(out.missing).toEqual([]);
    expect(out.undeclared).toEqual([]);
  });
});
