// 厂商自动会话头判定（OpenCode Go）：按 baseUrl（真实目的地）——不是 provider id；
// 只覆盖 Go 的两条路由，Zen 与自建代理不发。

import { describe, expect, it } from "vitest";
import { sessionHeadersFor } from "./session-headers.js";

const ID = "sess_abc123";

describe("sessionHeadersFor（baseUrl × 会话 id → x-opencode-session）", () => {
  it("Go 两条路由命中：inference/go（openai 兼容）与 zen/go", () => {
    expect(sessionHeadersFor("https://opencode.ai/inference/go/openai/v1", ID)).toEqual({
      "x-opencode-session": ID,
    });
    expect(sessionHeadersFor("https://opencode.ai/zen/go/v1", ID)).toEqual({
      "x-opencode-session": ID,
    });
    // 子域（区域/网关子域同属 opencode）
    expect(sessionHeadersFor("https://api.opencode.ai/zen/go/v1", ID)).toEqual({
      "x-opencode-session": ID,
    });
  });

  it("归一：大小写 / 尾斜杠 / 无路径尾段都能命中", () => {
    expect(sessionHeadersFor("HTTPS://OpenCode.AI/ZEN/GO/V1/", ID)).toEqual({
      "x-opencode-session": ID,
    });
    expect(sessionHeadersFor("https://opencode.ai/inference/go", ID)).toEqual({
      "x-opencode-session": ID,
    });
  });

  it("不误伤：Zen（/zen/v1）、普通路径、自建代理、相似域名一律不发", () => {
    expect(sessionHeadersFor("https://opencode.ai/zen/v1", ID)).toEqual({});
    expect(sessionHeadersFor("https://opencode.ai/v1", ID)).toEqual({});
    expect(sessionHeadersFor("https://api.example.com/zen/go/v1", ID)).toEqual({});
    expect(sessionHeadersFor("https://notopencode.ai/zen/go/v1", ID)).toEqual({});
    expect(sessionHeadersFor("https://opencode.ai.evil.com/zen/go/v1", ID)).toEqual({});
  });

  it("输入不完整 / 非法：不发（不造兜底身份，缺 id 由调用层显性暴露）", () => {
    expect(sessionHeadersFor("https://opencode.ai/zen/go/v1", undefined)).toEqual({});
    expect(sessionHeadersFor("https://opencode.ai/zen/go/v1", "   ")).toEqual({});
    expect(sessionHeadersFor(undefined, ID)).toEqual({});
    expect(sessionHeadersFor("not a url", ID)).toEqual({});
  });

  it("会话 id 去首尾空白后原样发（网关只要求稳定，不要求格式）", () => {
    expect(sessionHeadersFor("https://opencode.ai/zen/go/v1", `  ${ID}  `)).toEqual({
      "x-opencode-session": ID,
    });
  });
});
