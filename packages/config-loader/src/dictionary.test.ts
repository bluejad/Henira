// 目录投影（models.dev v1 字段判据）：适配器调不了的模型不进目录——
// 快照 / 运行时刷新 / 缓存三处同投影，旧数据不复活。
// 判据全部来自 models.dev 字段（type / tool_call / 模型级 provider.npm / shape / status），
// 零模型名单；网关的 deprecated = 已下线，厂商的 deprecated 仍保留。

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Dictionary, modelUsableByAdapter, SNAPSHOT } from "./dictionary.js";

describe("SNAPSHOT 投影（opencode-go）", () => {
  it("44 个原始模型 → 19 个可调：网关 deprecated 与别族协议全部消失", () => {
    const go = SNAPSHOT["opencode-go"];
    expect(go).toBeDefined();
    expect(Object.keys(go?.models ?? {})).toHaveLength(19);

    // 保留：chat + openai-compatible + 非 deprecated
    expect(go?.models["step-5-preview"]).toBeDefined();
    expect(go?.models["deepseek-v4.1-flash"]).toBeDefined();

    // 网关 deprecated（models.dev status=deprecated，网关 /models 不再返回）
    expect(go?.models["space-bunny"]).toBeUndefined();
    expect(go?.models["step-5-preview-free"]).toBeUndefined();
    expect(go?.models["glm-5.2"]).toBeUndefined();

    // 模型级协议覆盖：该模型只开 responses / messages / generate-content
    expect(go?.models["gpt-5.6-luna"]).toBeUndefined(); // @ai-sdk/openai（Responses）
    expect(go?.models["qwen3.8-max"]).toBeUndefined(); // @ai-sdk/anthropic（Messages）
    expect(go?.models["gemini-4-argon"]).toBeUndefined(); // @ai-sdk/google（generate-content）
  });

  it("厂商的 deprecated 不误删（只有网关语义等于下线）", () => {
    expect(SNAPSHOT.deepseek?.models["deepseek-v4-flash"]).toBeDefined();
  });

  it("非 chat / 不支持工具的模型不进对话目录", () => {
    expect(SNAPSHOT.openai?.models["text-embedding-3-small"]).toBeUndefined(); // type=embedding
    expect(SNAPSHOT.openrouter?.models["relace/relace-apply-3"]).toBeUndefined(); // tool_call=false
  });
});

describe("modelUsableByAdapter 判据矩阵", () => {
  it("缺省通过（chat + 工具 + 兼容协议 + 无状态）", () => {
    expect(modelUsableByAdapter("deepseek", { name: "x" })).toBe(true);
  });

  it("type 非 chat 拒绝", () => {
    expect(modelUsableByAdapter("deepseek", { type: "image" })).toBe(false);
    expect(modelUsableByAdapter("deepseek", { type: "embedding" })).toBe(false);
  });

  it("toolCall=false 拒绝（引擎每轮带工具）", () => {
    expect(modelUsableByAdapter("deepseek", { toolCall: false })).toBe(false);
  });

  it("模型级 sdk 覆盖：非 openai-compatible 拒绝，显式兼容放行", () => {
    expect(modelUsableByAdapter("opencode-go", { sdk: "@ai-sdk/anthropic" })).toBe(false);
    expect(modelUsableByAdapter("opencode-go", { sdk: "@ai-sdk/openai" })).toBe(false);
    expect(modelUsableByAdapter("opencode-go", { sdk: "@ai-sdk/openai-compatible" })).toBe(true);
  });

  it("shape=responses 拒绝，completions 放行", () => {
    expect(modelUsableByAdapter("opencode-go", { shape: "responses" })).toBe(false);
    expect(modelUsableByAdapter("opencode-go", { shape: "completions" })).toBe(true);
  });

  it("deprecated 按 provider 分流：网关下线，厂商仍可用", () => {
    expect(modelUsableByAdapter("opencode-go", { status: "deprecated" })).toBe(false);
    expect(modelUsableByAdapter("opencode", { status: "deprecated" })).toBe(false);
    expect(modelUsableByAdapter("deepseek", { status: "deprecated" })).toBe(true);
    expect(modelUsableByAdapter("opencode-go", { status: "alpha" })).toBe(true);
    expect(modelUsableByAdapter("opencode-go", { status: "beta" })).toBe(true);
  });
});

describe("运行时刷新同投影", () => {
  it("refresh 返回的不可调模型立即消失（不靠缓存后才干净）", async () => {
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          "opencode-go": {
            name: "OpenCode Go",
            npm: "@ai-sdk/openai-compatible",
            api: "https://opencode.ai/inference/go/openai/v1",
            models: {
              "step-5-preview": { name: "Step 5 Preview" },
              "space-bunny": { name: "Space Bunny", status: "deprecated" },
              "qwen3.8-max": {
                name: "Qwen3.8 Max",
                provider: { npm: "@ai-sdk/anthropic" },
              },
              "gpt-5.6-luna": {
                name: "GPT-5.6 Luna",
                provider: { npm: "@ai-sdk/openai", shape: "responses" },
              },
            },
          },
          deepseek: {
            name: "DeepSeek",
            npm: "@ai-sdk/openai-compatible",
            api: "https://api.deepseek.com",
            models: {
              "deepseek-v4-flash": { name: "DeepSeek V4 Flash", status: "deprecated" },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const dictionary = new Dictionary(undefined, fakeFetch as unknown as typeof fetch);
    expect(await dictionary.refresh()).toBe(true);
    const go = dictionary.entries()["opencode-go"];
    expect(go?.models["step-5-preview"]).toBeDefined();
    expect(go?.models["space-bunny"]).toBeUndefined();
    expect(go?.models["qwen3.8-max"]).toBeUndefined();
    expect(go?.models["gpt-5.6-luna"]).toBeUndefined();
    // 厂商 deprecated 不被网关规则误伤
    expect(dictionary.entries().deepseek?.models["deepseek-v4-flash"]).toBeDefined();
  });
});

describe("缓存形状门（version）", () => {
  it("旧形状缓存（无 version）被丢弃，不复活已下架模型", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "henira-dict-"));
    const file = path.join(dir, "model-presets.json");
    try {
      await fs.writeFile(
        file,
        JSON.stringify({
          fetchedAt: "2026-11-25T00:00:00.000Z",
          providers: {
            "opencode-go": {
              id: "opencode-go",
              models: {
                "space-bunny": { name: "Space Bunny" },
                "step-5-preview": { name: "Step 5 Preview" },
              },
            },
          },
        }),
      );
      const dictionary = new Dictionary(dir);
      await dictionary.loadCache();
      const go = dictionary.entries()["opencode-go"];
      expect(go?.models["space-bunny"]).toBeUndefined();
      expect(Object.keys(go?.models ?? {})).toHaveLength(19);
      // 过期缓存读到即删，避免每次启动重复解析
      await expect(fs.access(file)).rejects.toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("第 2 代缓存正常合并", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "henira-dict-"));
    try {
      await fs.writeFile(
        path.join(dir, "model-presets.json"),
        JSON.stringify({
          version: 2,
          fetchedAt: "2026-11-25T00:00:00.000Z",
          providers: {
            "opencode-go": { id: "opencode-go", models: { "custom-x": { name: "Custom X" } } },
          },
        }),
      );
      const dictionary = new Dictionary(dir);
      await dictionary.loadCache();
      expect(dictionary.entries()["opencode-go"]?.models["custom-x"]).toBeDefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
