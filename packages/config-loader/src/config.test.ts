import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ATTACHMENT_LIMITS,
  CredentialMissingError,
  NoDefaultModelError,
  validateAttachments,
} from "./config.js";

let globalDir: string;

beforeEach(async () => {
  globalDir = await fs.mkdtemp(path.join(tmpdir(), "henira-config-"));
});

afterEach(async () => {
  await fs.rm(globalDir, { recursive: true, force: true });
});

const write = async (name: string, data: unknown): Promise<void> => {
  await fs.writeFile(path.join(globalDir, name), JSON.stringify(data), "utf8");
};

import { type ConfigLoaderOptions, createConfigService } from "./config.js";

async function service(opts: Partial<ConfigLoaderOptions> = {}) {
  return createConfigService({ cwd: "/w", globalDir, ...opts });
}

describe("ConfigService（D-013②）", () => {
  it("model()：settings 默认 + <provider>/<model> 拆分 + 快照能力字段", async () => {
    await write("settings.json", { version: 1, model: "zhipuai/glm-4.6" });
    const svc = await service();
    const config = await svc.model();
    expect(config.provider).toBe("zhipuai");
    expect(config.model).toBe("glm-4.6");
    expect(config.contextWindow).toBeGreaterThan(0); // 快照兜底在场（D-040）
  });

  it("models.json 手写覆盖字典：baseUrl 与能力字段覆盖快照（D-040）", async () => {
    await write("settings.json", { model: "selfhost/main" });
    await write("models.json", {
      providers: {
        selfhost: {
          baseUrl: "http://127.0.0.1:8000/v1",
          models: { main: { contextWindow: 12345 } },
        },
      },
    });
    const svc = await service();
    const config = await svc.model();
    expect(config.baseUrl).toBe("http://127.0.0.1:8000/v1");
    expect(config.contextWindow).toBe(12345); // 手写 > 快照
  });

  it("无默认模型 → NoDefaultModelError；坏 id 形状报错", async () => {
    const svc = await service();
    await expect(svc.model()).rejects.toBeInstanceOf(NoDefaultModelError);
    await expect(svc.model("just-a-name")).rejects.toThrow(/<provider>\/<model>/);
  });

  it("credential()：credentials.json 读 key；缺失 → CredentialMissingError（不读 env，D-030）", async () => {
    await write("credentials.json", { providers: { zhipuai: "sk-secret" } });
    const svc = await service();
    await expect(svc.credential("zhipuai")).resolves.toBe("sk-secret");
    await expect(svc.credential("openai")).rejects.toBeInstanceOf(CredentialMissingError);
  });

  it("get()：插件自有配置段（settings plugins.<id>.options）", async () => {
    await write("settings.json", {
      plugins: { "plugin-shell": { enabled: true, options: { shell: "pwsh" } } },
    });
    const svc = await service();
    expect(await svc.get<{ shell: string }>("plugin-shell")).toEqual({ shell: "pwsh" });
    expect(await svc.get("nope")).toBeUndefined();
  });

  it("permissionRules()：合法条目收、非法行静默跳过（可手改文件不炸会话）", async () => {
    await write("permissions.json", {
      rules: [
        { match: { tool: "read" }, decision: "allow" },
        { match: { tool: "bash", commandContains: "rm -rf" }, decision: "deny" },
        { garbage: true },
        { match: { tool: "x" }, decision: "maybe" },
      ],
    });
    const svc = await service();
    const rules = await svc.permissionRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].match.tool).toBe("read");
  });

  it("文件全缺：permissionRules 空表、get undefined（缺省可用，嵌入式零配置）", async () => {
    const svc = await service();
    expect(await svc.permissionRules()).toEqual([]);
    expect(await svc.get("x")).toBeUndefined();
    expect(await svc.projectPermissionRules()).toEqual([]); // 缺 projectDir 同样空表
  });

  it("R198 projectPermissionRules()：项目文件读取 + 窄化；全局表不混入项目规则", async () => {
    const projectDir = path.join(globalDir, "project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "permissions.json"),
      JSON.stringify({
        version: 1,
        rules: [
          { match: { tool: "bash", commandExact: "git status" }, decision: "allow" },
          { match: { tool: "bash", commandExact: "" }, decision: "allow" }, // 空命令非法
          { match: { tool: "x" }, decision: "maybe" },
        ],
      }),
      "utf8",
    );
    const svc = await service({ projectDir });
    expect(await svc.projectPermissionRules()).toEqual([
      { match: { tool: "bash", commandExact: "git status" }, decision: "allow" },
    ]);
    // 合并职责在 approval 链，配置层两表分开（语义可辨）
    expect(await svc.permissionRules()).toEqual([]);
  });

  it("R198 addProjectPermissionRule()：建文件（version + 缩进）/同条幂等/保留顶层字段", async () => {
    const projectDir = path.join(globalDir, "proj-add");
    await fs.mkdir(projectDir, { recursive: true });
    const file = path.join(projectDir, "permissions.json");
    await fs.writeFile(file, JSON.stringify({ version: 1, note: "keep-me", rules: [] }), "utf8");
    const svc = await service({ projectDir });
    const rule = {
      match: { tool: "bash", commandExact: "npm test" },
      decision: "allow" as const,
    };
    await svc.addProjectPermissionRule(rule);
    await svc.addProjectPermissionRule(rule); // 幂等
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as {
      version: number;
      note: string;
      rules: unknown[];
    };
    expect(raw.version).toBe(1);
    expect(raw.note).toBe("keep-me");
    expect(raw.rules).toEqual([rule]);
    expect(await fs.readFile(file, "utf8")).toContain('\n  "rules"'); // 2 空格格式化落盘
    // 无项目目录 = 项目层不可写（嵌入式零配置）
    await expect((await service()).addProjectPermissionRule(rule)).rejects.toThrow(
      /project directory/,
    );
  });

  it("R198 addProjectPermissionRule()：既有文件损坏/非对象 → 拒绝写入、原文件不动", async () => {
    const projectDir = path.join(globalDir, "proj-broken");
    await fs.mkdir(projectDir, { recursive: true });
    const file = path.join(projectDir, "permissions.json");
    const svc = await service({ projectDir });
    const rule = {
      match: { tool: "bash", commandExact: "npm test" },
      decision: "allow" as const,
    };
    // 手改坏一处语法：整份重写会静默丢掉其他规则——必须拒绝且不碰文件
    const broken = '{\n  "version": 1,\n  "rules": [\n';
    await fs.writeFile(file, broken, "utf8");
    await expect(svc.addProjectPermissionRule(rule)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(broken);
    // 顶层不是对象（数组/null）同款：不覆盖
    await fs.writeFile(file, "[]", "utf8");
    await expect(svc.addProjectPermissionRule(rule)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("[]");
  });
});

describe("models.dev 字典同步（D-040）", () => {
  it("refresh()：fetch 成功 → 写缓存（自有形状信封+缩进，收敛批）；断网（fetch 抛）→ 静默 false，快照仍可查", async () => {
    const fake = (async () => ({
      ok: true,
      json: async () => ({
        myprov: {
          name: "My Prov",
          api: "https://api.myprov.example",
          models: {
            big: {
              limit: { context: 999_999, output: 8_000 },
              reasoning: true,
              reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "max"] }],
              interleaved: { field: "reasoning_content" },
            },
          },
        },
      }),
    })) as unknown as typeof fetch;
    const svc1 = await service({ fetchImpl: fake });
    await svc1.refreshDictionary();
    const config = await svc1.model("myprov/big");
    expect(config.contextWindow).toBe(999_999);
    // 思考档批（2026-11-19）：reasoning_options/interleaved 保真进字典（档位/回传真源）
    expect(config.reasoningOptions).toEqual([
      { type: "toggle" },
      { type: "effort", values: ["low", "max"] },
    ]);
    expect(config.interleaved).toEqual({ field: "reasoning_content" });
    // 收敛批：缓存改名 model-presets.json + {fetchedAt, providers} 信封 + 2 空格缩进 +
    // 厂商层带 name/endpoint（endpoint 上游本就有——旧管线裁掉它逼用户手写 baseUrl）
    const cached = await fs.readFile(path.join(globalDir, "model-presets.json"), "utf8");
    expect(cached).toContain("myprov");
    expect(cached).toContain("https://api.myprov.example");
    expect(cached.split("\n").length).toBeGreaterThan(3); // 缩进（非糊成一团）
    const doc = JSON.parse(cached) as { fetchedAt?: string; providers?: Record<string, unknown> };
    expect(typeof doc.fetchedAt).toBe("string");
    expect(doc.providers?.myprov).toBeDefined();
    await expect(fs.access(path.join(globalDir, "models-dev-cache.json"))).rejects.toThrow(); // 旧缓存已清

    // 新实例：缓存覆盖快照路径 + fetch 断网静默
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const svc2 = await service({ fetchImpl: offline });
    const config2 = await svc2.model("myprov/big");
    expect(config2.contextWindow).toBe(999_999); // 缓存兜底
  });
});

describe("validateAttachments（session.md §2.2 宿主入口校验）", () => {
  const att = (p: string, mime?: string) => ({ path: p, mime });

  it("超单文件 / 超总量 / 超个数 → 抛", () => {
    expect(() => validateAttachments([att("a.bin")], [ATTACHMENT_LIMITS.fileBytes + 1])).toThrow(
      /exceeds/,
    );
    expect(() =>
      validateAttachments([att("a.png", "image/png")], [ATTACHMENT_LIMITS.imageBytes + 1]),
    ).toThrow(/exceeds/);
    expect(() =>
      validateAttachments(
        Array.from({ length: 101 }, (_, i) => att(`f${i}`)),
        Array.from({ length: 101 }, () => 1),
      ),
    ).toThrow(/exceed 100/);
    expect(() =>
      validateAttachments(
        [att("a"), att("b"), att("c")],
        [18_000_000, 18_000_000, 18_000_000], // 每个低于单文件帽，总超 50MB
      ),
    ).toThrow(/total/);
  });

  it("限内通过；图片按更严上限", () => {
    expect(() => validateAttachments([att("a.png", "image/png")], [100])).not.toThrow();
  });
});
