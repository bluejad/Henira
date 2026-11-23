// 槽位登记簿单测（审查 F3）：官方默认件可顶替/卸载回落官方/第三方第二家报错 D-022/
// 同插件重入（免刷新重装）/空槽认领清理/词表外告警/reset 清场。

import { describe, expect, it } from "vitest";
import { createSlotRegistry } from "./slot-registry.js";

/** 测试用空 chain 组件（模块级：避免 lint noComponentHookFactories 把内联箭头当组件工厂） */
function NullComponent() {
  return null;
}

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

describe("chain 槽（R182，dsh SlotKind 行为层）", () => {
  const entry = (id: string, priority = 0) => ({
    id,
    priority,
    select: () => null,
    Component: NullComponent,
  });

  it("priority 升序插入（同值保注册序）——消费侧 first non-null wins", () => {
    const { registry } = make();
    const official = registry.apiFor("plugin-web-ui");
    official.registerChainSlot("composer.takeover", entry("late", 20));
    official.registerChainSlot("composer.takeover", entry("mid", 10));
    official.registerChainSlot("composer.takeover", entry("mid-2", 10));
    official.registerChainSlot("composer.takeover", entry("first", -5));
    expect(registry.chains.get("composer.takeover")?.map((e) => e.id)).toEqual([
      "first",
      "mid",
      "mid-2",
      "late",
    ]);
  });

  it("第三方 replaceChainSlot 顶替官方条目；卸载按登记回落官方", () => {
    const { registry } = make();
    const official = registry.apiFor("plugin-web-ui");
    const plugin = registry.apiFor("my-ui");
    const officialEntry = entry("approval", 10);
    official.registerChainSlot("composer.takeover", officialEntry);
    const replacedEntry = entry("approval", 10);
    const dispose = plugin.replaceChainSlot("composer.takeover", "approval", replacedEntry);
    expect(registry.chains.get("composer.takeover")?.[0]).toBe(replacedEntry);
    dispose();
    expect(registry.chains.get("composer.takeover")?.[0]).toBe(officialEntry); // 回落官方
  });

  it("官方条目在位时第三方 registerChainSlot 同 id = 冲突（要走 replaceChainSlot）", () => {
    const { registry } = make();
    registry.apiFor("plugin-web-ui").registerChainSlot("composer.takeover", entry("approval", 10));
    expect(() =>
      registry.apiFor("ui-a").registerChainSlot("composer.takeover", entry("approval", 10)),
    ).toThrow(/is official; use replaceChainSlot/);
  });

  it("第三方 A 的条目在位 → 第三方 B replaceChainSlot 同 id 报错（D-022）", () => {
    const { registry } = make();
    registry.apiFor("ui-a").registerChainSlot("composer.takeover", entry("x", 0));
    expect(() =>
      registry.apiFor("ui-b").replaceChainSlot("composer.takeover", "x", entry("x", 0)),
    ).toThrow(/chain conflict/);
  });

  it("reset 清空 chain 登记（重建后官方重注册不被旧条目挡住）", () => {
    const { registry } = make();
    registry.apiFor("plugin-web-ui").registerChainSlot("composer.takeover", entry("approval", 10));
    registry.reset();
    expect(registry.chains.size).toBe(0);
    registry.apiFor("plugin-web-ui").registerChainSlot("composer.takeover", entry("approval", 10));
    expect(registry.chains.get("composer.takeover")?.length).toBe(1);
  });
});

describe("single 槽（R183，dsh SlotKind single 行为层）", () => {
  const makeSingle = () => {
    const registry = createSlotRegistry({
      slotAccepted: () => true,
      onUnknownSlot: () => {},
      officialId: "plugin-web-ui",
      isSingleSlot: (name) => name === "composer.model",
    });
    return registry;
  };

  it("官方 registerSlot 认领；第三方 registerSlot 顶替；卸载回落官方（不追加）", () => {
    const registry = makeSingle();
    const official = registry.apiFor("plugin-web-ui");
    const plugin = registry.apiFor("my-ui");
    const officialPart = () => "official";
    const pluginPart = () => "plugin";
    official.registerSlot("composer.model", officialPart);
    expect(registry.slots.get("composer.model")).toEqual([officialPart]); // 单件

    const dispose = plugin.registerSlot("composer.model", pluginPart);
    expect(registry.slots.get("composer.model")).toEqual([pluginPart]); // 顶替而非 [official, plugin]

    dispose();
    expect(registry.slots.get("composer.model")).toEqual([officialPart]); // 回落
  });

  it("第三方 A 在位 → 第三方 B registerSlot 报冲突（D-022 同款）", () => {
    const registry = makeSingle();
    registry.apiFor("ui-a").registerSlot("composer.model", () => "a");
    expect(() => registry.apiFor("ui-b").registerSlot("composer.model", () => "b")).toThrow(
      /slot conflict/,
    );
  });

  it("同 caller 重入 = 单件替换（不叠两个模型控件）", () => {
    const registry = makeSingle();
    const a = registry.apiFor("ui-a");
    a.registerSlot("composer.model", () => "a1");
    a.registerSlot("composer.model", () => "a2");
    expect(registry.slots.get("composer.model")?.length).toBe(1);
    expect(registry.slots.get("composer.model")?.[0]?.("x" as never)).toBe("a2");
  });
});

describe("canonicalSlotName（R191 自审）：占用判据落在解析的键空间", () => {
  const PREFIX = "sidebar.right.preview.";
  const makeCanonical = () => {
    const registry = createSlotRegistry({
      slotAccepted: () => true,
      onUnknownSlot: () => {},
      officialId: "plugin-web-ui",
      isSingleSlot: (name) => name.startsWith(PREFIX),
      canonicalSlotName: (name) => {
        if (!name.startsWith(PREFIX)) return name;
        const suffix = name.slice(PREFIX.length).toLowerCase().replace(/^\.+/, "");
        return `${PREFIX}${suffix === "" ? "*" : suffix}`;
      },
    });
    return registry;
  };

  it("大小写/前导点变体落同一规范键；第二家第三方当场冲突", () => {
    const registry = makeCanonical();
    const a = registry.apiFor("ui-a");
    const b = registry.apiFor("ui-b");
    a.registerSlot("sidebar.right.preview.MD", () => "a");
    expect(registry.slots.has("sidebar.right.preview.md")).toBe(true);
    expect(() => b.registerSlot("sidebar.right.preview..md", () => "b")).toThrow(/slot conflict/);
  });

  it("空后缀 = 通配：与官方 `*` 同键（官方在位 → 顶替合法），卸载回落官方", () => {
    const registry = makeCanonical();
    const official = registry.apiFor("plugin-web-ui");
    const plugin = registry.apiFor("ui-a");
    const officialPart = () => "official";
    official.registerSlot("sidebar.right.preview.*", officialPart);
    const dispose = plugin.replaceSlot("sidebar.right.preview.", () => "plugin");
    expect(registry.slots.get("sidebar.right.preview.*")?.[0]?.("x" as never)).toBe("plugin");
    dispose();
    expect(registry.slots.get("sidebar.right.preview.*")).toEqual([officialPart]);
  });
});

describe("releaseOwner（R186 收尾，审查 P3⑨）：按调用方整批撤出", () => {
  const chainEntry = (id: string) => ({
    id,
    priority: 0,
    select: () => null,
    Component: NullComponent,
  });

  it("list 追加 / 顶替 / chain 一次清干净：顶替位回落官方、追加位消失、chain 清空", () => {
    const { registry } = make();
    const official = registry.apiFor("plugin-web-ui");
    const plugin = registry.apiFor("ui-a");
    const officialPart = () => "official";
    official.registerSlot("tool.call.view.read", officialPart);
    const disposeRead = plugin.replaceSlot("tool.call.view.read", () => "plugin");
    plugin.registerSlot("composer.dock", () => "dock");
    plugin.registerChainSlot("composer.takeover", chainEntry("approval"));
    expect(registry.slots.get("tool.call.view.read")?.[0]).not.toBe(officialPart);

    registry.releaseOwner("ui-a");
    expect(registry.slots.get("tool.call.view.read")).toEqual([officialPart]); // 回落官方
    expect(registry.slots.has("composer.dock")).toBe(false);
    expect(registry.chains.has("composer.takeover")).toBe(false);

    // 已整批撤出后再调原撤销器 = 幂等（不抛、不误伤官方件）
    expect(() => disposeRead()).not.toThrow();
    expect(registry.slots.get("tool.call.view.read")).toEqual([officialPart]);
  });

  it("single 槽顶替件随 releaseOwner 回退官方（泄漏会顶掉官方件直到刷新）", () => {
    const registry = createSlotRegistry({
      slotAccepted: () => true,
      onUnknownSlot: () => {},
      officialId: "plugin-web-ui",
      isSingleSlot: (name) => name === "composer.model",
    });
    const official = registry.apiFor("plugin-web-ui");
    const plugin = registry.apiFor("ui-a");
    const officialPart = () => "official";
    official.registerSlot("composer.model", officialPart);
    const dispose = plugin.registerSlot("composer.model", () => "plugin");
    expect(registry.slots.get("composer.model")?.[0]).not.toBe(officialPart);

    registry.releaseOwner("ui-a");
    expect(registry.slots.get("composer.model")).toEqual([officialPart]);
    expect(() => dispose()).not.toThrow();
  });

  it("未知 caller / 重复 releaseOwner = no-op（卸载清理路径安全）", () => {
    const { registry } = make();
    registry.apiFor("ui-a").registerSlot("composer.dock", () => "dock");
    registry.releaseOwner("ui-a");
    registry.releaseOwner("ui-a");
    registry.releaseOwner("never-registered");
    expect(registry.slots.has("composer.dock")).toBe(false);
  });
});
