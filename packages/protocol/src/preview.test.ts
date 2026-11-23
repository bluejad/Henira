import { describe, expect, it } from "vitest";
import { DEFAULT_PREVIEW_OPEN, previewMode } from "./preview.js";

describe("previewMode", () => {
  it("缺省：文件右侧、图片弹窗", () => {
    expect(previewMode(undefined, "file")).toBe("panel");
    expect(previewMode(undefined, "image")).toBe("modal");
    expect(DEFAULT_PREVIEW_OPEN).toEqual({ file: "panel", image: "modal" });
  });

  it("显式设置优先；非法值回落缺省", () => {
    expect(previewMode({ file: "modal" }, "file")).toBe("modal");
    expect(previewMode({ image: "panel" }, "image")).toBe("panel");
    expect(previewMode({ file: "nope" as never }, "file")).toBe("panel");
  });
});
