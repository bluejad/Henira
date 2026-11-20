// 槽位登记簿单测（审查 F3）：官方默认件可顶替/卸载回落官方/第三方第二家报错 D-022/
// 同插件重入（免刷新重装）/空槽认领清理/词表外告警/reset 清场。

import { describe, expect, it } from "vitest";
import { createSlotRegistry } from "./slot-registry.js";

function make() {
  const unknown: string[] = [];
  const registry = createSlotRegistry({
    slotAccepted: (name) => name !== "bogus.slot",
    onUnknownSlot: (name) => unknown.push(name),
    officialId: "plugin-web-ui",
  });
  return { registry, unknown };
}

describe("slot registry（顶替语义，审查 F3）", () => {
  it("官方默认件在位 → 插件 replaceSlot 顶替生效；卸载回落官方件", () => {
    const { registry } = make();
    const official = registry.apiFor("plugin-web-ui");
    const plugin = registry.apiFor("my-ui");
    const officialPart = () => "official";
    const pluginPart = () => "plugin";
    official.registerSlot("tool.call.view.bash", officialPart);
    expect(registry.slots.get("tool.call.view.bash")?.[0]).toBe(officialPart);

    const dispose = plugin.replaceSlot("tool.call.view.bash", pluginPart);
    expect(registry.slots.get("tool.call.view.bash")?.[0]).toBe(pluginPart);

    dispose();
    expect(registry.slots.get("tool.call.view.bash")?.[0]).toBe(officialPart); // 回落
  });

  it("第三方件在位 → 另一家 replaceSlot 同 key 报错（D-022）", () => {
    const { registry } = make();
    const a = registry.apiFor("ui-a");
    const b = registry.apiFor("ui-b");
    a.replaceSlot("tool.call.view.read", () => "a");
    expect(() => b.replaceSlot("tool.call.view.read", () => "b")).toThrow(/slot conflict/);
  });

  it("同插件重入合法（免刷新重装 = dispose 后重 claim）", () => {
    const { registry } = make();
    const a1 = registry.apiFor("ui-a");
    const dispose1 = a1.replaceSlot("tool.call.view.read", () => "a1");
    dispose1();
    const a2 = registry.apiFor("ui-a"); // 重装后新 API 实例，同一插件 id
    a2.replaceSlot("tool.call.view.read", () => "a2");
    expect(registry.slots.get("tool.call.view.read")?.[0]?.("x" as never)).toBe("a2");
  });

  it("空槽 claim 合法；卸载清空（不残留死件）", () => {
    const { registry } = make();
    const a = registry.apiFor("ui-a");
    const dispose = a.replaceSlot("tool.call.view.cool", () => "x");
    expect(registry.slots.has("tool.call.view.cool")).toBe(true);
    dispose();
    expect(registry.slots.has("tool.call.view.cool")).toBe(false);
  });

  it("registerSlot(order<0) 前插的在位第三方件同样构成冲突（另一家 replaceSlot 报错）", () => {
    const { registry } = make();
    const official = registry.apiFor("plugin-web-ui");
    const a = registry.apiFor("ui-a");
    const b = registry.apiFor("ui-b");
    official.registerSlot("tool.call.view.grep", () => "official");
    a.registerSlot("tool.call.view.grep", () => "a", { order: -1 });
    expect(() => b.replaceSlot("tool.call.view.grep", () => "b")).toThrow(/slot conflict/);
  });

  it("词表外槽名 = 忽略 + 告警（registerSlot 与 replaceSlot 同闸）", () => {
    const { registry, unknown } = make();
    const a = registry.apiFor("ui-a");
    a.registerSlot("bogus.slot", () => "x");
    a.replaceSlot("bogus.slot", () => "y");
    expect(registry.slots.has("bogus.slot")).toBe(false);
    expect(unknown).toEqual(["bogus.slot", "bogus.slot"]);
  });

  it("reset 清空登记簿（renderSlots 重建前清场）——重建后官方重注册、插件重顶替不被旧登记挡住", () => {
    const { registry } = make();
    const official = registry.apiFor("plugin-web-ui");
    official.registerSlot("layout", () => "frame");
    registry.apiFor("ui-a").replaceSlot("layout", () => "replaced");
    registry.reset();
    expect(registry.slots.size).toBe(0);
    official.registerSlot("layout", () => "frame");
    registry.apiFor("ui-a").replaceSlot("layout", () => "replaced2");
    expect(registry.slots.get("layout")?.[0]?.("x" as never)).toBe("replaced2");
  });
});
