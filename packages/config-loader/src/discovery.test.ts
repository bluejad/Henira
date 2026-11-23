// 插件目录发现与引擎装载（批 C）：清单校验（§3 缺省救缺失/写错丢整段）、版本选择（pin/最高）、
// 确认门（fail-closed）、inject 预检、依赖表硬规矩（@henira/* 禁入）。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  loadEngineModule,
  matchesEngineRange,
  preparePlugins,
  scanPlugins,
} from "./discovery.js";

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "henira-plugins-"));
}

async function writePlugin(
  root: string,
  id: string,
  version: string,
  manifest: Record<string, unknown>,
  files?: Record<string, string>,
): Promise<string> {
  const dir = path.join(root, id, version);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "plugin.json"), JSON.stringify(manifest), "utf8");
  for (const [rel, content] of Object.entries(files ?? {})) {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return dir;
}

const ENGINE_SRC = `export const inject = ["tools"];
export default { name: "probe", start() { return { ok: true }; } };
`;

describe("compareVersions（版本目录名排序）", () => {
  it("数字段比较（1.10 > 1.9）；非数字退字典序", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("alpha", "beta")).toBeLessThan(0);
  });
});

describe("matchesEngineRange（engines 兼容门）", () => {
  it("缺省/星号 = 不设门；^0.1 前缀匹配；不匹配拒绝", () => {
    expect(matchesEngineRange(undefined, "0.0.0")).toBe(true);
    expect(matchesEngineRange("*", "9.9.9")).toBe(true);
    expect(matchesEngineRange("^0.1", "0.1.3")).toBe(true);
    expect(matchesEngineRange("^0.1", "0.2.0")).toBe(false);
    expect(matchesEngineRange("0.1.x", "0.1.0")).toBe(true);
  });
});

describe("scanPlugins（plugin.json 发现与校验）", () => {
  it("选最高合法版本；ui.entry 缺省 ui/main.js；坏清单跳过并告警", async () => {
    const root = await makeRoot();
    await writePlugin(root, "my-pack", "1.0.0", { name: "my-pack", version: "1.0.0" });
    await writePlugin(root, "my-pack", "1.2.0", {
      name: "my-pack",
      ui: { title: "测试件" },
    });
    await writePlugin(root, "bad-name", "1.0.0", { name: "other", version: "1.0.0" });
    await writePlugin(root, "bad-json", "1.0.0", { name: "bad-json" }, { "plugin.json": "{" });
    const out = await scanPlugins(root);
    const pack = out.plugins.find((p) => p.id === "my-pack");
    expect(pack?.version).toBe("1.2.0");
    expect(pack?.ui?.entry).toBe("ui/main.js");
    expect(out.plugins.some((p) => p.id === "bad-name")).toBe(false);
    expect(out.warnings.some((w) => w.includes("bad-name") && w.includes("name"))).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("settings 钉版本优先；钉的版本不存在 → 回落最高 + 告警", async () => {
    const root = await makeRoot();
    await writePlugin(root, "pack-a", "1.0.0", { name: "pack-a" });
    await writePlugin(root, "pack-a", "2.0.0", { name: "pack-a" });
    const pinned = await scanPlugins(root, { pinned: { "pack-a": "1.0.0" } });
    expect(pinned.plugins[0]?.version).toBe("1.0.0");
    const missing = await scanPlugins(root, { pinned: { "pack-a": "9.9.9" } });
    expect(missing.plugins[0]?.version).toBe("2.0.0");
    expect(missing.warnings.some((w) => w.includes("9.9.9"))).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("loadEngineModule（jiti 装载 + 硬规矩）", () => {
  it("装载 definition 与模块级 inject；依赖表含 @henira/* → 拒绝", async () => {
    const root = await makeRoot();
    const v = await writePlugin(
      root,
      "probe-pack",
      "1.0.0",
      { name: "probe-pack", engine: { entry: "engine/main.js" } },
      { "engine/main.js": ENGINE_SRC },
    );
    const loaded = await loadEngineModule({
      versionDir: v,
      entry: "engine/main.js",
      alias: {},
    });
    expect(loaded.error).toBeUndefined();
    expect(loaded.inject).toEqual(["tools"]);
    expect((loaded.definition as { name?: string }).name).toBe("probe");

    const bad = await writePlugin(
      root,
      "forbidden-pack",
      "1.0.0",
      { name: "forbidden-pack", engine: {} },
      {
        "engine/main.js": ENGINE_SRC,
        "engine/package.json": JSON.stringify({
          dependencies: { "@henira/kernel": "workspace:*" },
        }),
      },
    );
    const rejected = await loadEngineModule({
      versionDir: bad,
      entry: "engine/main.js",
      alias: {},
    });
    expect(rejected.error).toContain("@henira/kernel");
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("preparePlugins（装配前置：确认门 / 兼容门 / inject 预检 / enabled）", () => {
  it("engine 件未确认 → awaiting-confirm；确认后 loaded 且有 definition", async () => {
    const root = await makeRoot();
    await writePlugin(
      root,
      "probe-pack",
      "1.0.0",
      { name: "probe-pack", engine: {} },
      { "engine/main.js": ENGINE_SRC },
    );
    const pending = await preparePlugins({
      pluginRoot: root,
      engineAlias: {},
      hostVersion: "0.0.0",
    });
    expect(pending.states[0]?.state).toBe("awaiting-confirm");
    expect(pending.states[0]?.source).toBe("managed"); // 目录件来源（R189）
    expect(pending.definitions).toHaveLength(0);

    const confirmed = await preparePlugins({
      pluginRoot: root,
      settings: { plugins: { "probe-pack": { confirmedVersion: "1.0.0" } } },
      engineAlias: {},
      hostVersion: "0.0.0",
    });
    expect(confirmed.states[0]?.state).toBe("loaded");
    expect(confirmed.definitions).toHaveLength(1);
    expect(confirmed.definitions[0]?.inject).toEqual(["tools"]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("enabled:false → disabled 不装载；engines 不匹配 → failed；inject 缺提供者 → failed", async () => {
    const root = await makeRoot();
    await writePlugin(
      root,
      "off-pack",
      "1.0.0",
      { name: "off-pack", engine: {} },
      { "engine/main.js": ENGINE_SRC },
    );
    await writePlugin(
      root,
      "old-pack",
      "1.0.0",
      { name: "old-pack", engines: "^9.9", engine: {} },
      { "engine/main.js": ENGINE_SRC },
    );
    await writePlugin(
      root,
      "needy-pack",
      "1.0.0",
      { name: "needy-pack", engine: {} },
      {
        "engine/main.js": `export const inject = ["ghost-service"];
export default { name: "needy", start() { return {}; } };
`,
      },
    );
    const settings = {
      plugins: {
        "off-pack": { enabled: false, confirmedVersion: "1.0.0" },
        "old-pack": { confirmedVersion: "1.0.0" },
        "needy-pack": { confirmedVersion: "1.0.0" },
      },
    };
    const out = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: {},
      hostVersion: "0.0.0",
    });
    const byId = new Map(out.states.map((s) => [s.id, s]));
    expect(byId.get("off-pack")?.state).toBe("disabled");
    expect(byId.get("old-pack")?.state).toBe("failed");
    expect(byId.get("old-pack")?.reason).toContain("版本不兼容");
    expect(byId.get("needy-pack")?.state).toBe("failed");
    expect(byId.get("needy-pack")?.reason).toContain("ghost-service");
    expect(out.definitions).toHaveLength(0);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("纯内容件（无 engine/ui）→ loaded 不占引擎定义", async () => {
    const root = await makeRoot();
    await writePlugin(root, "content-pack", "1.0.0", { name: "content-pack" });
    const out = await preparePlugins({ pluginRoot: root, engineAlias: {}, hostVersion: "0.0.0" });
    expect(out.states[0]?.forms).toEqual(["content"]);
    expect(out.states[0]?.state).toBe("loaded");
    expect(out.definitions).toHaveLength(0);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("mcp 槽扫描（D-064：校验 / 指纹确认门 / D-032 去重）", () => {
  const ALIAS = {
    "@henira/kernel": "/dev/null/kernel.js",
    "@henira/protocol": "/dev/null/protocol.js",
  };
  const SETTINGS_BASE = {
    plugins: {} as Record<
      string,
      { enabled?: boolean; confirmedVersion?: string; mcpFingerprint?: string }
    >,
  };

  it("stdio / remote 解析：target 串与 mcpServers；坏 JSON / 双缺 / sse 跳过 + 告警", async () => {
    const root = await makeRoot();
    await writePlugin(
      root,
      "mcp-pack",
      "1.0.0",
      { name: "mcp-pack", version: "1.0.0" },
      {
        "mcp/echo.json": JSON.stringify({ command: "node", args: ["server.js"], env: { A: "b" } }),
        "mcp/remote.json": JSON.stringify({
          url: "https://mcp.example/rpc",
          headers: { Authorization: "x" },
        }),
        "mcp/broken.json": "{",
        "mcp/empty.json": JSON.stringify({ env: {} }),
        "mcp/sse.json": JSON.stringify({ url: "https://old.example/sse", type: "sse" }),
      },
    );
    // 先探测指纹（未确认 = 只进读面），写入 mcpFingerprint 后声明才放出（D-030 fail-closed）
    const probe = await preparePlugins({
      pluginRoot: root,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(probe.mcpServers).toEqual([]);
    const settings = {
      plugins: { "mcp-pack": { mcpFingerprint: probe.states[0]?.mcpFingerprint ?? "" } },
    };
    const result = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(result.mcpServers.map((s) => s.server).sort()).toEqual(["echo", "remote"]);
    const echo = result.mcpServers.find((s) => s.server === "echo");
    expect(echo?.kind).toBe("stdio");
    expect(echo?.command).toBe("node");
    expect(echo?.env).toEqual({ A: "b" });
    const remote = result.mcpServers.find((s) => s.server === "remote");
    expect(remote?.kind).toBe("remote");
    expect(remote?.url).toBe("https://mcp.example/rpc");
    const state = result.states.find((p) => p.id === "mcp-pack");
    expect(state?.mcp?.map((m) => m.name).sort()).toEqual(["echo", "remote"]);
    expect(result.warnings.some((w) => w.includes("broken"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("empty"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("sse"))).toBe(true);
  });

  it("指纹确认门：未确认不进 mcpServers；写入 mcpFingerprint 后放出；内容变化指纹即变", async () => {
    const root = await makeRoot();
    const versionDir = await writePlugin(
      root,
      "gate-pack",
      "1.0.0",
      { name: "gate-pack", version: "1.0.0" },
      {
        "mcp/echo.json": JSON.stringify({ command: "node", args: ["a.js"] }),
      },
    );
    const first = await preparePlugins({
      pluginRoot: root,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(first.mcpServers).toEqual([]);
    const fingerprint = first.states[0]?.mcpFingerprint ?? "";
    expect(fingerprint).toMatch(/^[0-9a-f]{40}$/);

    const settings = structuredClone(SETTINGS_BASE);
    settings.plugins["gate-pack"] = { mcpFingerprint: fingerprint };
    const confirmed = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(confirmed.mcpServers.map((s) => s.server)).toEqual(["echo"]);
    expect(confirmed.states[0]?.mcp?.[0]?.confirmed).toBe(true);

    // 内容变化（版本级不可变纪律下是"新声明"）→ 指纹变 → 回到待确认
    await fs.writeFile(
      path.join(versionDir, "mcp", "echo.json"),
      JSON.stringify({ command: "node", args: ["b.js"] }),
      "utf8",
    );
    const changed = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(changed.mcpServers).toEqual([]);
    expect(changed.states[0]?.mcp?.[0]?.confirmed).toBe(false);
  });

  it("disabled 插件的 mcp server 不放出；enabled 且引擎语义通过才连（awaiting-confirm 连坐）", async () => {
    const root = await makeRoot();
    await writePlugin(
      root,
      "off-pack",
      "1.0.0",
      { name: "off-pack", version: "1.0.0" },
      {
        "mcp/a.json": JSON.stringify({ command: "node" }),
      },
    );
    await writePlugin(
      root,
      "engine-mcp",
      "1.0.0",
      { name: "engine-mcp", version: "1.0.0", engine: {} },
      {
        "engine/main.js": ENGINE_SRC,
        "mcp/b.json": JSON.stringify({ command: "node" }),
      },
    );
    const settings = structuredClone(SETTINGS_BASE);
    settings.plugins["off-pack"] = { enabled: false };
    settings.plugins["engine-mcp"] = { confirmedVersion: "1.0.0" };
    // off-pack 关掉、engine-mcp 引擎已确认但 mcp 未确认
    const off = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(off.mcpServers).toEqual([]);
    // engine-mcp 补 mcp 指纹（两把确认各自独立）
    const fpOff = (
      await preparePlugins({ pluginRoot: root, engineAlias: ALIAS, hostVersion: "0.1.0" })
    ).states.find((p) => p.id === "engine-mcp")?.mcpFingerprint;
    settings.plugins["engine-mcp"].mcpFingerprint = fpOff;
    const both = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(both.mcpServers.map((s) => `${s.pluginId}/${s.server}`)).toEqual(["engine-mcp/b"]);
    // 引擎回 awaiting（撤确认）→ mcp 连坐不连
    delete settings.plugins["engine-mcp"].confirmedVersion;
    const revoked = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(revoked.mcpServers).toEqual([]);
    expect(revoked.states.find((p) => p.id === "engine-mcp")?.state).toBe("awaiting-confirm");
  });

  it("D-032 跨插件同名 server：id 字典序赢 + 告警", async () => {
    const root = await makeRoot();
    await writePlugin(
      root,
      "aaa-pack",
      "1.0.0",
      { name: "aaa-pack", version: "1.0.0" },
      {
        "mcp/weather.json": JSON.stringify({ command: "node", args: ["aaa.js"] }),
      },
    );
    await writePlugin(
      root,
      "bbb-pack",
      "1.0.0",
      { name: "bbb-pack", version: "1.0.0" },
      {
        "mcp/weather.json": JSON.stringify({ url: "https://bbb.example" }),
      },
    );
    const settings = structuredClone(SETTINGS_BASE);
    settings.plugins["aaa-pack"] = { mcpFingerprint: "x" };
    settings.plugins["bbb-pack"] = { mcpFingerprint: "y" };
    void settings;
    // 先拿真指纹再确认
    const probe = await preparePlugins({
      pluginRoot: root,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    const fp = (id: string): string => probe.states.find((p) => p.id === id)?.mcpFingerprint ?? "";
    settings.plugins["aaa-pack"].mcpFingerprint = fp("aaa-pack");
    settings.plugins["bbb-pack"].mcpFingerprint = fp("bbb-pack");
    const result = await preparePlugins({
      pluginRoot: root,
      settings,
      engineAlias: ALIAS,
      hostVersion: "0.1.0",
    });
    expect(result.mcpServers.map((s) => `${s.pluginId}/${s.server}`)).toEqual(["aaa-pack/weather"]);
    expect(result.warnings.some((w) => w.includes("已被其他插件占用"))).toBe(true);
  });
});
