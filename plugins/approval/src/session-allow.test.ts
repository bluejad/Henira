import { describe, expect, it } from "vitest";
import { sessionAllowance, sessionAllowedTools } from "./session-allow.js";

const asked = (requestId: string, tool: string) => ({
  type: "approval/asked",
  data: { requestId, tool },
});
const decided = (requestId: string, extra: Record<string, unknown> = {}) => ({
  type: "approval/decided",
  data: { requestId, decision: "allowed-once", scope: "session", ...extra },
});
const revoked = (extra: Record<string, unknown> = {}) => ({
  type: "approval/revoked",
  data: { scope: "session", ...extra },
});

const gitStatus = {
  match: { tool: "bash", commandExact: "git status" },
  decision: "allow" as const,
};
const npmTest = { match: { tool: "bash", commandExact: "npm test" }, decision: "allow" as const };

describe("会话允许折叠（R198：工具级 + 命令规则级）", () => {
  it("无 rule 的 decided = 工具级（旧形状兼容）", () => {
    const allowance = sessionAllowance([asked("r1", "write"), decided("r1")]);
    expect([...allowance.tools]).toEqual(["write"]);
    expect(allowance.rules).toEqual([]);
    expect([...sessionAllowedTools([asked("r1", "write"), decided("r1")])]).toEqual(["write"]);
  });

  it("带 rule 的 decided 只进规则表，不升级成工具级", () => {
    const allowance = sessionAllowance([asked("r1", "bash"), decided("r1", { rule: gitStatus })]);
    expect(allowance.rules).toEqual([gitStatus]);
    expect(allowance.tools.size).toBe(0);
  });

  it("R199：键序不同 = 同一条规则（去重 + 按规则撤销）", () => {
    const reordered = {
      decision: "allow" as const,
      match: { commandExact: "git status", tool: "bash" },
    };
    const allowance = sessionAllowance([
      asked("r1", "bash"),
      decided("r1", { rule: gitStatus }),
      asked("r2", "bash"),
      decided("r2", { rule: reordered }),
    ]);
    expect(allowance.rules).toHaveLength(1);
    const revokedAllowance = sessionAllowance([
      asked("r1", "bash"),
      decided("r1", { rule: gitStatus }),
      revoked({ rule: reordered }),
    ]);
    expect(revokedAllowance.rules).toEqual([]);
  });

  it("撤销单条规则只删精确匹配，同工具其他规则保留", () => {
    const allowance = sessionAllowance([
      asked("r1", "bash"),
      decided("r1", { rule: gitStatus }),
      asked("r2", "bash"),
      decided("r2", { rule: npmTest }),
      revoked({ rule: gitStatus }),
    ]);
    expect(allowance.rules).toEqual([npmTest]);
  });

  it("按工具撤销清掉该工具的工具级与规则级", () => {
    const allowance = sessionAllowance([
      asked("r1", "bash"),
      decided("r1", { rule: gitStatus }),
      asked("r2", "write"),
      decided("r2"),
      revoked({ tool: "bash" }),
    ]);
    expect(allowance.rules).toEqual([]);
    expect([...allowance.tools]).toEqual(["write"]);
  });

  it("无 tool/rule 的撤销清空全部", () => {
    const allowance = sessionAllowance([
      asked("r1", "bash"),
      decided("r1", { rule: gitStatus }),
      asked("r2", "write"),
      decided("r2"),
      revoked(),
    ]);
    expect(allowance.rules).toEqual([]);
    expect(allowance.tools.size).toBe(0);
  });
});
