import { describe, expect, it } from "vitest";
import { looksBinary, WORKSPACE_FILE_MAX_BYTES } from "./workspace-file.js";

describe("workspace file", () => {
  it("二进制嗅探只看前 8KB（NUL 判据）", () => {
    expect(looksBinary(new Uint8Array([0x61, 0x62]))).toBe(false);
    expect(looksBinary(new Uint8Array([0x61, 0x00, 0x62]))).toBe(true);
    const lateNul = new Uint8Array(9000).fill(0x61);
    lateNul[8500] = 0;
    expect(looksBinary(lateNul)).toBe(false); // 8KB 外不参与嗅探
  });

  it("上限 = 1 MiB", () => {
    expect(WORKSPACE_FILE_MAX_BYTES).toBe(1024 * 1024);
  });
});
