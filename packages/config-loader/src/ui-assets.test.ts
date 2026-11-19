// 界面资产扫描测试（D-059 读者数据源）：locales/themes 枚举、损坏名跳过、缺目录空表。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanUiAssets } from "./ui-assets.js";

async function makePluginRoot(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "henira-ui-assets-"));
}

describe("scanUiAssets（D-059）", () => {
  it("枚举已装插件的 locales/*.json 与 themes/*.css（排序稳定）", async () => {
    const pluginRoot = await makePluginRoot();
    const v = path.join(pluginRoot, "ja-pack", "1.0.0");
    await fs.mkdir(path.join(v, "locales"), { recursive: true });
    await fs.mkdir(path.join(v, "themes"), { recursive: true });
    await fs.writeFile(path.join(v, "locales", "ja.json"), "{}");
    await fs.writeFile(path.join(v, "locales", "ko.json"), "{}");
    await fs.writeFile(path.join(v, "themes", "sea.css"), ".henira-app{}");
    // 无关文件不进表
    await fs.writeFile(path.join(v, "locales", "readme.md"), "x");
    const out = await scanUiAssets(pluginRoot);
    expect(out.locales.map((l) => l.lang)).toEqual(["ja", "ko"]);
    expect(out.locales[0]).toMatchObject({
      pluginId: "ja-pack",
      version: "1.0.0",
      url: "/api/ui-assets/ja-pack/1.0.0/locales/ja.json",
    });
    expect(out.themes).toEqual([
      {
        pluginId: "ja-pack",
        version: "1.0.0",
        name: "sea",
        url: "/api/ui-assets/ja-pack/1.0.0/themes/sea.css",
      },
    ]);
    await fs.rm(pluginRoot, { recursive: true, force: true });
  });

  it("损坏名（非法字符开头）跳过；缺目录 = 空表不抛", async () => {
    const pluginRoot = await makePluginRoot();
    const hidden = path.join(pluginRoot, ".hidden", "1.0.0", "locales");
    await fs.mkdir(hidden, { recursive: true });
    await fs.writeFile(path.join(hidden, "ja.json"), "{}");
    await fs.mkdir(path.join(pluginRoot, "ok-pack"), { recursive: true }); // 无版本目录
    expect(await scanUiAssets(pluginRoot)).toEqual({ locales: [], themes: [] });
    expect(await scanUiAssets(path.join(pluginRoot, "不存在"))).toEqual({
      locales: [],
      themes: [],
    });
    await fs.rm(pluginRoot, { recursive: true, force: true });
  });
});
