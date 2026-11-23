import { describe, expect, it } from "vitest";
import { decodeUtf8Prefix, looksBinary, WORKSPACE_FILE_MAX_BYTES } from "./workspace-file.js";

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

  it("按上限解码：不切多字节序列（R191）", () => {
    const bytes = new TextEncoder().encode("ab中文"); // a b 中(3) 文(3) = 8 字节
    expect(decodeUtf8Prefix(bytes, 8)).toBe("ab中文");
    expect(decodeUtf8Prefix(bytes, 3)).toBe("ab"); // 中 只落入 1/3 字节 → 整段回退
    expect(decodeUtf8Prefix(bytes, 4)).toBe("ab");
    expect(decodeUtf8Prefix(bytes, 5)).toBe("ab中");
    expect(decodeUtf8Prefix(bytes, 7)).toBe("ab中"); // 文 只落入 2/3 字节
    expect(decodeUtf8Prefix(bytes, 0)).toBe("");
    expect(decodeUtf8Prefix(new TextEncoder().encode("abcd"), 2)).toBe("ab"); // ASCII 不受影响
    expect(decodeUtf8Prefix(new Uint8Array([0xff, 0x61]), 1)).toBe("\uFFFD"); // 非法字节交给解码器
  });
});
