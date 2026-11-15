import { beforeEach, describe, expect, it } from "vitest";
import {
  DuplicateEventTypeError,
  EventTypeMismatchError,
  knownEventTypes,
  RESERVED_DOMAINS,
  ReservedDomainError,
  registerPluginEvent,
  SessionEventRegistry,
  validatorFor,
} from "./index.js";

// 注册表语义（session.md §3 + D-051）：开放 map、派生清单禁手抄（P9-5）、
// 插件事件前缀规则（session.md §2.3）、duck 校验器不认牌子。

const alwaysOk = { safeParse: (data: unknown) => ({ success: true, data }) as const };

beforeEach(() => {
  SessionEventRegistry.clear();
});

describe("开放注册表与派生清单", () => {
  it("核心路径直接写 map，派生清单跟着走（无手抄列表）", () => {
    SessionEventRegistry.set("tool/call", alwaysOk);
    SessionEventRegistry.set("turn/start", alwaysOk);
    expect(knownEventTypes().has("tool/call")).toBe(true);
    expect(validatorFor("tool/call")).toBe(alwaysOk);
    expect(knownEventTypes().size).toBe(SessionEventRegistry.size);
  });

  it("validatorFor 对未知类型返回 undefined（读侧 fail-closed 由 session 裁决）", () => {
    expect(validatorFor("nope/none")).toBeUndefined();
  });

  it("派生集合与注册表始终一致", () => {
    for (let i = 0; i < 5; i++) {
      registerPluginEvent(`pkg${i}/evt`, alwaysOk, `pkg${i}`);
    }
    const derived = [...knownEventTypes()].sort();
    expect(derived).toEqual([...SessionEventRegistry.keys()].sort());
  });
});

describe("registerPluginEvent（新增插件事件类型不改核心代码，roadmap M1 判据 3）", () => {
  it("前缀 = owner，注册成功且进入派生清单", () => {
    registerPluginEvent("compaction/applied", alwaysOk, "compaction");
    expect(knownEventTypes().has("compaction/applied")).toBe(true);
  });

  it("占用保留域 → 拒绝", () => {
    expect(() => registerPluginEvent("tool/custom", alwaysOk, "tool")).toThrow(ReservedDomainError);
  });

  it("前缀与 owner 不符 → 拒绝", () => {
    expect(() => registerPluginEvent("subagent/x", alwaysOk, "other")).toThrow(
      EventTypeMismatchError,
    );
  });

  it("重复注册 → 拒绝", () => {
    registerPluginEvent("mypkg/evt", alwaysOk, "mypkg");
    expect(() => registerPluginEvent("mypkg/evt", alwaysOk, "mypkg")).toThrow(
      DuplicateEventTypeError,
    );
  });
});

describe("duck 校验器（D-051）：只认形状不认牌子", () => {
  it("zod 形状的结构化对象直接可当校验器", () => {
    const zodLike = {
      safeParse(data: unknown) {
        if (typeof data === "string") return { success: true, data } as const;
        return { success: false, error: { issues: ["expected string"] } } as const;
      },
    };
    registerPluginEvent("mypkg/evt", zodLike, "mypkg");
    const validator = validatorFor("mypkg/evt");
    expect(validator?.safeParse("hello")).toEqual({ success: true, data: "hello" });
    expect(validator?.safeParse(1).success).toBe(false);
  });
});

describe("保留域词表（session.md §2.3 十个，钉住防漂移）", () => {
  it("词表逐字钉住", () => {
    expect([...RESERVED_DOMAINS]).toEqual([
      "turn",
      "step",
      "request",
      "user",
      "system",
      "assistant",
      "tool",
      "approval",
      "error",
      "session",
    ]);
  });
});
