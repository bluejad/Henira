import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "./index.js";

// tmp+rename 原子写（session.md §5：只用于整体重写的小文件；日志永远 append+fsync）。

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-atomic-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  it("写入即完整内容，不留 .tmp 残留", async () => {
    const target = path.join(root, "meta.json");
    await atomicWriteFile(target, '{"version":1}');
    await expect(fs.readFile(target, "utf8")).resolves.toBe('{"version":1}');
    const leftovers = (await fs.readdir(root)).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("整体重写：新内容原子替换旧内容，同目录临时文件（不跨卷）", async () => {
    const target = path.join(root, "meta.json");
    await atomicWriteFile(target, "old");
    await atomicWriteFile(target, "new");
    await expect(fs.readFile(target, "utf8")).resolves.toBe("new");
    const direct = (await fs.readdir(root)).filter((name) => name === "meta.json");
    expect(direct).toHaveLength(1); // 没有副本文件
  });
});
