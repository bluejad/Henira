import type { HarnessContext } from "@reins/kernel";
import { describe, expect, it } from "vitest";
import type { SessionService } from "./index.js";
import { asReinsContext } from "./index.js";

// 类型化门面：运行时零开销（同一对象、类型收窄）；kernel 不认识业务接口（D-012②）。

describe("asReinsContext", () => {
  it("同一对象透传，get 按槽位类型收窄", () => {
    const fakeSession = {} as SessionService;
    const raw = {
      get: (slot: string) => (slot === "session" ? fakeSession : undefined),
      events: {},
      effect: () => () => {},
    } as unknown as HarnessContext;
    const ctx = asReinsContext(raw);
    expect(ctx.get("session")).toBe(fakeSession);
    expect(ctx.events).toBe((raw as { events: object }).events);
  });
});
