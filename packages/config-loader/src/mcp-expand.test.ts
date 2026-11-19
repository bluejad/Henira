// @vitest-environment node
// MCP 声明展开单测（D-064）：模板变量 / ${credential:} fail-closed / 相对 command 解析 /
// stdio 环境清洗 / useResource 地址解析。纯配置函数——不读盘、不接触真实凭据。
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: 本文件专门测模板变量语法，字面量即被测对象

import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerDecl } from "./discovery.js";
import { expandMcpServers, parseResourceAddress, scrubSpawnEnv } from "./mcp-expand.js";

function decl(overrides: Partial<McpServerDecl> & { versionDir: string }): McpServerDecl {
  return { pluginId: "pack", server: "srv", kind: "stdio", ...overrides };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("expandMcpServers（D-064 宿主侧展开）", () => {
  it("模板变量：插件根 / 项目目录与生态别名；相对 command 相对版本目录解析，裸命令名走 PATH", () => {
    const versionDir = path.resolve("tmp", "plugins", "pack", "1.0.0");
    const cwd = path.resolve("tmp", "project");
    const specs = expandMcpServers({
      decls: [
        decl({
          versionDir,
          command: "./bin/server.js",
          args: ["${HENIRA_PROJECT_DIR}/data", "--root=${CLAUDE_PLUGIN_ROOT}"],
          env: { DATA: "${ZCODE_PROJECT_DIR}/in", ROOT: "${HENIRA_PLUGIN_ROOT}" },
        }),
        decl({ server: "srv2", versionDir, command: "node" }),
        decl({ server: "srv3", versionDir, command: process.execPath }),
        decl({ server: "srv4", versionDir, url: "https://${HENIRA_PROJECT_DIR}/mcp" }),
      ],
      cwd,
      credentials: {},
    });
    expect(specs[0]?.command).toBe(path.resolve(versionDir, "bin", "server.js"));
    expect(specs[0]?.args).toEqual([`${cwd}/data`, `--root=${versionDir}`]);
    expect(specs[0]?.env).toEqual({ DATA: `${cwd}/in`, ROOT: versionDir });
    expect(specs[1]?.command).toBe("node");
    expect(specs[2]?.command).toBe(process.execPath);
    expect(specs[3]?.url).toBe(`https://${cwd}/mcp`);
  });

  it("${credential:名}：命中即注入；缺失 fail-closed 跳过该 server（告警只含名不含值）", () => {
    const warn = vi.fn();
    const specs = expandMcpServers({
      decls: [
        decl({
          versionDir: path.resolve("tmp", "pack"),
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "${credential:api-token}" },
        }),
        decl({
          server: "missing",
          versionDir: path.resolve("tmp", "pack"),
          command: "node",
          env: { TOKEN: "${credential:absent}" },
        }),
      ],
      cwd: path.resolve("tmp"),
      credentials: { "api-token": "sk-unit-secret" },
      warn,
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]?.env).toEqual({ TOKEN: "sk-unit-secret" });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("absent");
    expect(message).not.toContain("sk-unit-secret");
  });

  it("未知 ${...} 原样保留（server 运行时自解）", () => {
    const specs = expandMcpServers({
      decls: [
        decl({ versionDir: path.resolve("tmp"), command: "node", args: ["${UNKNOWN_VAR}/x"] }),
      ],
      cwd: path.resolve("tmp"),
      credentials: {},
    });
    expect(specs[0]?.args).toEqual(["${UNKNOWN_VAR}/x"]);
  });
});

describe("scrubSpawnEnv（stdio 环境清洗，D-064）", () => {
  it("剔敏感名与 HENIRA_*，其余保留", () => {
    vi.stubEnv("PLAIN_VAR", "ok");
    vi.stubEnv("SOME_KEY", "x");
    vi.stubEnv("DB_PASSWORD", "x");
    vi.stubEnv("SESSION_SECRET", "x");
    vi.stubEnv("AUTH_TOKEN", "x");
    vi.stubEnv("HENIRA_HOME", "x");
    const env = scrubSpawnEnv();
    expect(env.PLAIN_VAR).toBe("ok");
    for (const name of ["SOME_KEY", "DB_PASSWORD", "SESSION_SECRET", "AUTH_TOKEN", "HENIRA_HOME"]) {
      expect(env[name]).toBeUndefined();
    }
  });
});

describe("parseResourceAddress（useResource 地址，plugins.md §4）", () => {
  it("三段地址 + args JSON；中文 id 解码正确（不走 URL 构造器）", () => {
    const args = encodeURIComponent(JSON.stringify({ q: "回声", n: 1 }));
    const parsed = parseResourceAddress(
      `henira-data://${encodeURIComponent("回声")}/srv/tool?args=${args}`,
    );
    expect(parsed).toEqual({
      pluginId: "回声",
      server: "srv",
      tool: "tool",
      args: { q: "回声", n: 1 },
    });
  });

  it("无 args = 空对象；形状非法 / 非对象 JSON → undefined", () => {
    expect(parseResourceAddress("henira-data://p/s/t")?.args).toEqual({});
    expect(parseResourceAddress("henira-data://p/s")).toBeUndefined();
    expect(parseResourceAddress("https://p/s/t")).toBeUndefined();
    expect(
      parseResourceAddress(`henira-data://p/s/t?args=${encodeURIComponent("[1,2]")}`),
    ).toBeUndefined();
    expect(
      parseResourceAddress(`henira-data://p/s/t?args=${encodeURIComponent("{{{")}`),
    ).toBeUndefined();
  });
});
