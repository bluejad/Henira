// 权限规则文件 helpers（R199）：三态读取 / canonical 幂等 / 删除 / 坏文件拒绝。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addPermissionRule,
  PermissionRulesFileError,
  readPermissionRules,
  removePermissionRule,
} from "./permissions.js";

const rule = {
  match: { tool: "bash", commandExact: "npm test" },
  decision: "allow" as const,
};
const deny = {
  match: { tool: "bash", commandContains: "rm -rf" },
  decision: "deny" as const,
};

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "henira-permissions-"));
  file = path.join(dir, "permissions.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("权限规则文件 helpers（R199）", () => {
  it("readPermissionRules：missing / ok（invalidCount）/ corrupt 三态", async () => {
    expect(await readPermissionRules(file)).toEqual({
      path: file,
      status: "missing",
      rules: [],
      invalidCount: 0,
    });

    const pathRule = {
      match: { tool: "write", pathExact: "src/a.ts" },
      decision: "allow" as const,
    };
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        rules: [
          pathRule,
          { match: { tool: "write", pathExact: "" }, decision: "allow" }, // 坏路径约束
          { match: { tool: "edit", pathExact: 42 }, decision: "allow" }, // 非字符串
        ],
      }),
      "utf8",
    );
    const paths = await readPermissionRules(file);
    expect(paths.status).toBe("ok");
    expect(paths.rules).toEqual([pathRule]);
    expect(paths.invalidCount).toBe(2);

    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        rules: [
          rule,
          { match: { tool: "bash", commandExact: "" }, decision: "allow" }, // 坏命令约束
          { garbage: true },
          deny,
        ],
      }),
      "utf8",
    );
    const ok = await readPermissionRules(file);
    expect(ok.status).toBe("ok");
    expect(ok.rules).toEqual([rule, deny]);
    expect(ok.invalidCount).toBe(2);

    await fs.writeFile(file, "{ nope", "utf8");
    expect((await readPermissionRules(file)).status).toBe("corrupt");
    await fs.writeFile(file, "[]", "utf8");
    expect((await readPermissionRules(file)).status).toBe("corrupt");
    await fs.writeFile(file, JSON.stringify({ rules: "nope" }), "utf8");
    expect((await readPermissionRules(file)).status).toBe("corrupt");
  });

  it("addPermissionRule：canonical 相同（键序/未知字段）不重复追加", async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        note: "keep",
        rules: [{ decision: "allow", extra: 1, match: { commandExact: "npm test", tool: "bash" } }],
      }),
      "utf8",
    );
    await addPermissionRule(file, rule);
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as { note: string; rules: unknown[] };
    expect(raw.note).toBe("keep");
    expect(raw.rules).toHaveLength(1);
  });

  it("removePermissionRule：删除全部 canonical 相同条目，保留其他原始条目与顶层字段", async () => {
    const bad = { match: { tool: "bash", commandExact: "" }, decision: "allow" };
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        note: "keep",
        rules: [
          { decision: "allow", extra: 1, match: { commandExact: "npm test", tool: "bash" } },
          deny,
          bad,
          rule,
        ],
      }),
      "utf8",
    );
    const result = await removePermissionRule(file, rule);
    expect(result).toEqual({ removed: 2, status: "ok" });
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as {
      note: string;
      rules: unknown[];
    };
    expect(raw.note).toBe("keep");
    // 坏条目原样保留（不替用户清洗），deny 保留
    expect(raw.rules).toEqual([deny, bad]);
    expect(await fs.readFile(file, "utf8")).toContain('\n  "rules"');
  });

  it("removePermissionRule：未命中 / 文件缺失 → 不写盘；坏文件 → 拒绝且不动", async () => {
    const before = JSON.stringify({ version: 1, rules: [deny] });
    await fs.writeFile(file, before, "utf8");
    expect(await removePermissionRule(file, rule)).toEqual({ removed: 0, status: "ok" });
    expect(await fs.readFile(file, "utf8")).toBe(before);

    await fs.rm(file);
    expect(await removePermissionRule(file, rule)).toEqual({ removed: 0, status: "missing" });
    await expect(fs.stat(file)).rejects.toThrow();

    const broken = '{\n  "rules": [\n';
    await fs.writeFile(file, broken, "utf8");
    await expect(removePermissionRule(file, rule)).rejects.toMatchObject({
      reason: "corrupt",
    });
    await expect(removePermissionRule(file, rule)).rejects.toBeInstanceOf(PermissionRulesFileError);
    expect(await fs.readFile(file, "utf8")).toBe(broken);
  });

  it("addPermissionRule：坏文件拒绝且不动（P2 纪律）", async () => {
    const broken = '{\n  "rules": [\n';
    await fs.writeFile(file, broken, "utf8");
    await expect(addPermissionRule(file, rule)).rejects.toMatchObject({ reason: "corrupt" });
    expect(await fs.readFile(file, "utf8")).toBe(broken);
  });
});
