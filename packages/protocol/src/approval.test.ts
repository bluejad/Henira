// 规则规范键（R199）：键序/未知字段无关 + 去重。添加幂等、文件删除、账本撤销共用。

import { describe, expect, it } from "vitest";
import {
  APPROVAL_FEEDBACK_MAX,
  fitsApprovalFeedback,
  type PermissionRule,
  permissionRuleKey,
  samePermissionRule,
  uniquePermissionRules,
} from "./approval.js";

const exact = (command: string): PermissionRule => ({
  match: { tool: "bash", commandExact: command },
  decision: "allow",
});

describe("权限规则规范键（R199）", () => {
  it("键序不同 / 未知字段在场 = 同一条规则", () => {
    const a = exact("git status");
    const b = {
      decision: "allow" as const,
      extra: "ignored",
      match: { commandExact: "git status", tool: "bash" },
    } as PermissionRule;
    expect(permissionRuleKey(a)).toBe(permissionRuleKey(b));
    expect(samePermissionRule(a, b)).toBe(true);
  });

  it("decision / 工具 / 任一命令约束不同 = 不同规则", () => {
    expect(samePermissionRule(exact("git status"), exact("git log"))).toBe(false);
    expect(
      samePermissionRule(exact("git status"), { ...exact("git status"), decision: "deny" }),
    ).toBe(false);
    expect(
      samePermissionRule(exact("git status"), {
        match: { tool: "bash", commandPrefix: "git status" },
        decision: "allow",
      }),
    ).toBe(false);
    expect(
      samePermissionRule(exact("git status"), { match: { tool: "powershell" }, decision: "allow" }),
    ).toBe(false);
  });

  it("D-087 路径规则参与规范键：路径不同 / 命令与路径混用 = 不同规则", () => {
    const path = (p: string): PermissionRule => ({
      match: { tool: "write", pathExact: p },
      decision: "allow",
    });
    expect(samePermissionRule(path("src/a.ts"), path("src/b.ts"))).toBe(false);
    expect(samePermissionRule(path("src/a.ts"), path("src/a.ts"))).toBe(true);
    expect(
      samePermissionRule(path("src/a.ts"), {
        match: { tool: "write", pathExact: "src/a.ts", commandExact: "x" },
        decision: "allow",
      }),
    ).toBe(false);
  });

  it("去重保留首次出现", () => {
    const a = exact("npm test");
    const b = {
      match: { commandExact: "npm test", tool: "bash" },
      decision: "allow",
    } as PermissionRule;
    expect(uniquePermissionRules([a, b, exact("npm run build")])).toEqual([
      a,
      exact("npm run build"),
    ]);
  });

  it("D-087 说明上限按码点计：4096 个代理对（8192 码元）仍在限内，4097 个超限", () => {
    const emoji = "😀";
    expect([...emoji].length).toBe(1);
    expect(emoji.length).toBe(2); // UTF-16 码元 ≠ 码点——按 length 判会误杀一半
    expect(fitsApprovalFeedback(emoji.repeat(APPROVAL_FEEDBACK_MAX))).toBe(true);
    expect(fitsApprovalFeedback(emoji.repeat(APPROVAL_FEEDBACK_MAX + 1))).toBe(false);
  });
});
