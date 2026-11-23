// 预览缝解析器（R190）：后缀归一 / 最长匹配 / 通配回落 / 单占用键查找。
import { describe, expect, it } from "vitest";
import {
  normalizePreviewSuffix,
  PREVIEW_SLOT_PREFIX,
  pickPreviewSlot,
  previewExt,
  previewFileName,
} from "./preview-slot.js";

const key = (suffix: string): string => `${PREVIEW_SLOT_PREFIX}${suffix}`;

describe("preview slot resolver", () => {
  it("文件名与扩展名归一（小写、取最后一段、点文件算扩展）", () => {
    expect(previewFileName("C:\\Work\\Demo.TS")).toBe("demo.ts");
    expect(previewFileName("a/b/c.tar.gz")).toBe("c.tar.gz");
    expect(previewFileName(undefined)).toBe("");
    expect(previewExt("C:\\Work\\Demo.TS")).toBe("ts");
    expect(previewExt("a.tar.gz")).toBe("gz");
    expect(previewExt(".env")).toBe("env");
    expect(previewExt("README")).toBe("");
    expect(previewExt("trailing.")).toBe("");
    expect(normalizePreviewSuffix(".TAR.GZ")).toBe("tar.gz");
  });

  it("最长后缀赢；通配只在无精确命中时兜底", () => {
    const slots = [key("*"), key("gz"), key("tar.gz")];
    expect(pickPreviewSlot(slots, "pkg.tar.gz")?.suffix).toBe("tar.gz");
    expect(pickPreviewSlot(slots, "pkg.gz")?.suffix).toBe("gz");
    expect(pickPreviewSlot(slots, "a.txt")?.suffix).toBe("*");
    expect(pickPreviewSlot([key("tar.gz")], "a.gz")).toBeUndefined();
    expect(pickPreviewSlot([key("md"), key("*")], "notes.md")?.suffix).toBe("md");
  });

  it("空后缀键等同通配；图片（无路径）只落通配", () => {
    expect(pickPreviewSlot([key("")], "a.txt")?.suffix).toBe("*");
    expect(pickPreviewSlot([key("*"), key("md")], undefined)?.suffix).toBe("*");
    expect(pickPreviewSlot([key("md")], undefined)).toBeUndefined();
  });

  it("非预览前缀忽略；大小写不敏感", () => {
    expect(pickPreviewSlot(["tool.call.view.read", key("MD")], "a.md")?.suffix).toBe("md");
    expect(pickPreviewSlot(["Tool.Call.View.Read"], "a.md")).toBeUndefined();
  });
});
