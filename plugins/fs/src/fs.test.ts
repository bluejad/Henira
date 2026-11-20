// @vitest-environment node
// plugin-fs 单测（D-065）：围栏（resolve / 区内外 / tilde / win32 大小写 / 区外放行口）+
// read / write / edit 守卫语义（read-before-mutate / stale / 部分读 / 唯一性 / CRLF 保留）。
// 全部走 tmpdir 夹具，不触碰真实用户文件。

import { promises as fsp } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import type { FsGate } from "@henira/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapabilities, MAX_SCAN_BYTES, ReadState } from "./capabilities.js";
import { createFence, FsError } from "./fence.js";

async function tmpWorkdir(): Promise<string> {
  return fsp.mkdtemp(path.join(tmpdir(), "henira-fs-test-"));
}

function gate(overrides?: Partial<FsGate> & { decision?: string }): FsGate {
  const requestPermission = vi.fn(async () => (overrides?.decision ?? "allowed-once") as never);
  return {
    tool: "read",
    args: { file_path: "x.txt" },
    signal: undefined,
    ...overrides,
    requestPermission: requestPermission as FsGate["requestPermission"],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fence（词法围栏）", () => {
  it("相对路径按 cwd 解析为区内；绝对路径区内外判定正确", () => {
    const cwd = path.resolve("/ws");
    const fence = createFence(cwd);
    expect(fence.resolve("a/b.txt")).toEqual({
      absolute: path.join(cwd, "a", "b.txt"),
      inside: true,
    });
    expect(fence.resolve("../escape.txt").inside).toBe(false);
    expect(fence.resolve(path.join(cwd, "in.txt")).inside).toBe(true);
    expect(fence.resolve(path.resolve("/elsewhere/x")).inside).toBe(false);
    // 前缀混淆路径：/ws2 不是 /ws 的区内
    expect(fence.resolve(path.resolve("/ws2/x")).inside).toBe(false);
  });

  it("空路径 / 非串拒绝；~ 展开到 home（通常为区外）", () => {
    const fence = createFence(path.resolve("/ws"));
    expect(() => fence.resolve("")).toThrow(FsError);
    expect(() => fence.resolve("   ")).toThrow(FsError);
    const home = fence.resolve("~");
    expect(home.absolute).toBe(os.homedir());
    expect(home.inside).toBe(false);
  });

  it.skipIf(process.platform !== "win32")("win32 大小写不敏感（D-032 同款口径）", () => {
    const cwd = path.resolve("C:\\WorkSpace");
    const fence = createFence(cwd);
    expect(fence.resolve(path.join(cwd.toUpperCase(), "a.txt")).inside).toBe(true);
    expect(fence.resolve("C:\\workspace\\OTHER.txt").inside).toBe(true);
  });

  it("区外访问：floor ask 经判定链问；放行即继续、拒绝抛 outside_workspace", async () => {
    const fence = createFence(path.resolve("/ws"));
    const g = gate({ decision: "allowed-once" });
    await fence.ensureAccess({
      absolute: "/elsewhere/x",
      inside: false,
      tool: "read",
      callArgs: { file_path: "/elsewhere/x" },
      requestPermission: g.requestPermission,
    });
    expect(g.requestPermission).toHaveBeenCalledTimes(1);
    const [req, opts] = (g.requestPermission as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { tool: string; reason: string },
      { floor?: string },
    ];
    expect(req.reason).toContain("outside the session workspace");
    expect(opts?.floor).toBe("ask");

    const g2 = gate({ decision: "rejected" });
    await expect(
      fence.ensureAccess({
        absolute: "/elsewhere/x",
        inside: false,
        tool: "read",
        callArgs: {},
        requestPermission: g2.requestPermission,
      }),
    ).rejects.toThrow(/outside the session workspace/);
  });

  it("区内访问不打扰判定链（服务层零额外问）", async () => {
    const fence = createFence(path.resolve("/ws"));
    const g = gate();
    await fence.ensureAccess({
      absolute: path.resolve("/ws/in.txt"),
      inside: true,
      tool: "read",
      callArgs: {},
      requestPermission: g.requestPermission,
    });
    expect(g.requestPermission).not.toHaveBeenCalled();
  });
});

describe("read / write / edit（读态守卫住服务层）", () => {
  it("read：行号分页事实 + 尾行截断 + 二进制 / 空文件 / 越界 offset", async () => {
    const dir = await tmpWorkdir();
    const fence = createFence(dir);
    const caps = createCapabilities({ fence, readState: new ReadState() });
    const g = gate();

    await fsp.writeFile(path.join(dir, "f.txt"), "l1\nl2\nl3\nl4\n", "utf8");
    const full = await caps.read("f.txt", g);
    expect(full).toMatchObject({ startLine: 1, endLine: 4, totalLines: 4 });
    expect(full.content).toBe("l1\nl2\nl3\nl4");

    const paged = await caps.read("f.txt", gate(), { offset: 2, limit: 2 });
    expect(paged).toMatchObject({ startLine: 2, endLine: 3, totalLines: 4 });

    await expect(caps.read("f.txt", gate(), { offset: 99 })).rejects.toThrow(/out of range/);
    await expect(caps.read("missing.txt", gate())).rejects.toThrow(/not found/);
    await fsp.mkdir(path.join(dir, "subdir"));
    await expect(caps.read("subdir", gate())).rejects.toThrow(FsError);

    await fsp.writeFile(path.join(dir, "empty.txt"), "", "utf8");
    const empty = await caps.read("empty.txt", gate());
    expect(empty.totalLines).toBe(0);

    await fsp.writeFile(path.join(dir, "bin.dat"), Buffer.from([0x50, 0x4b, 0x00, 0x03]));
    await expect(caps.read("bin.dat", gate())).rejects.toThrow(/binary file/);
  });

  it("read：每行 2000 字符截尾 + 选区 50KB 字节帽（truncatedByBytes）", async () => {
    const dir = await tmpWorkdir();
    const caps = createCapabilities({ fence: createFence(dir), readState: new ReadState() });
    const longLine = "x".repeat(3000);
    await fsp.writeFile(path.join(dir, "long.txt"), `${longLine}\n`, "utf8");
    const r = await caps.read("long.txt", gate());
    expect(r.content).toContain("(line truncated to 2000 chars)");

    const big = Array.from({ length: 400 }, (_, i) => `row ${i}: ${"y".repeat(400)}`).join("\n");
    await fsp.writeFile(path.join(dir, "big.txt"), big, "utf8");
    const capped = await caps.read("big.txt", gate());
    expect(capped.truncatedByBytes).toBe(true);
    expect(capped.endLine).toBeLessThan(400);
    expect(Buffer.byteLength(capped.content, "utf8")).toBeLessThanOrEqual(50 * 1024);
  });

  it("read：>50MB 文件先帽后读直接拒（稀疏文件，分页也不放行——整文件读）", async () => {
    const dir = await tmpWorkdir();
    const caps = createCapabilities({ fence: createFence(dir), readState: new ReadState() });
    const huge = path.join(dir, "huge.log");
    await fsp.writeFile(huge, "");
    await fsp.truncate(huge, MAX_SCAN_BYTES + 1); // 稀疏文件：stat 报 size、不占盘不读内容
    await expect(caps.read("huge.log", gate())).rejects.toThrow(/too large to read/);
    await expect(caps.read("huge.log", gate(), { offset: 1, limit: 10 })).rejects.toThrow(
      /too large/,
    );
  });

  it("write：新建免读；外部已存在的文件未读拒；读过放行并刷新读态（无需回读；连写两轮合法）", async () => {
    const dir = await tmpWorkdir();
    const fence = createFence(dir);
    const caps = createCapabilities({ fence, readState: new ReadState() });

    const created = await caps.write("new.txt", "hello", gate());
    expect(created.created).toBe(true);
    expect(await fsp.readFile(path.join(dir, "new.txt"), "utf8")).toBe("hello");

    // 自己写的文件读态已刷新 → 连续覆盖合法（CC/ZCode refresh-on-write 同款）
    const twice = await caps.write("new.txt", "hello-2", gate());
    expect(twice.created).toBe(false);

    // 外部预先存在的文件：没读过不许覆盖
    await fsp.writeFile(path.join(dir, "external.txt"), "pre-existing", "utf8");
    await expect(caps.write("external.txt", "x", gate())).rejects.toThrow(/has not been read yet/);

    await caps.read("external.txt", gate());
    const updated = await caps.write("external.txt", "second", gate());
    expect(updated.created).toBe(false);
    expect(await fsp.readFile(path.join(dir, "external.txt"), "utf8")).toBe("second");
  });

  it("write：stale（读后被外部改）拒；部分读（offset/limit）不满足覆盖条件；父目录自动创建", async () => {
    const dir = await tmpWorkdir();
    const caps = createCapabilities({ fence: createFence(dir), readState: new ReadState() });

    await fsp.writeFile(path.join(dir, "s.txt"), "v1", "utf8");
    await caps.read("s.txt", gate());
    await fsp.utimes(path.join(dir, "s.txt"), new Date(), new Date(Date.now() + 50_000));
    await expect(caps.write("s.txt", "v2", gate())).rejects.toThrow(/modified since read/);

    const partialDir = await tmpWorkdir();
    const caps2 = createCapabilities({
      fence: createFence(partialDir),
      readState: new ReadState(),
    });
    await fsp.writeFile(path.join(partialDir, "p.txt"), "a\nb\nc\nd\n", "utf8");
    await caps2.read("p.txt", gate(), { limit: 2 });
    await expect(caps2.write("p.txt", "x", gate())).rejects.toThrow(/last read was partial/);

    const created = await caps.write("deep/nested/dir/f.txt", "deep", gate());
    expect(created.created).toBe(true);
  });

  it("edit：唯一性 / replace_all / not-found 提示 / no-change / LF 归一保留原换行符", async () => {
    const dir = await tmpWorkdir();
    const caps = createCapabilities({ fence: createFence(dir), readState: new ReadState() });

    await caps.write("e.txt", "alpha beta alpha\n", gate());
    await expect(caps.edit("e.txt", { old: "alpha", new: "A" }, gate())).rejects.toThrow(
      /Found 2 matches/,
    );
    const all = await caps.edit("e.txt", { old: "alpha", new: "A", replaceAll: true }, gate());
    expect(all.replacements).toBe(2);
    expect(await fsp.readFile(path.join(dir, "e.txt"), "utf8")).toBe("A beta A\n");

    await expect(caps.edit("e.txt", { old: "missing-str", new: "A beta" }, gate())).rejects.toThrow(
      /already present in the file|not found in/,
    );
    await expect(caps.edit("e.txt", { old: "same", new: "same" }, gate())).rejects.toThrow(
      /exactly the same/,
    );
    await expect(caps.edit("e.txt", { old: "", new: "x" }, gate())).rejects.toThrow(
      /must be a non-empty string/,
    );

    // CRLF 文件：匹配用 LF 视图，写回保留 CRLF
    await caps.write("crlf.txt", "one\r\ntwo\r\n", gate());
    await caps.read("crlf.txt", gate());
    await caps.edit("crlf.txt", { old: "two", new: "TWO" }, gate());
    const back = await fsp.readFile(path.join(dir, "crlf.txt"), "utf8");
    expect(back).toBe("one\r\nTWO\r\n");
  });

  it("edit：混合换行文件只受理单行编辑（其余行原样）；多行 old 报 mixed_line_endings", async () => {
    const dir = await tmpWorkdir();
    const caps = createCapabilities({ fence: createFence(dir), readState: new ReadState() });
    await caps.write("mixed.txt", "a\r\nb\nc", gate()); // 混合：CRLF 行 + 裸 LF 行
    await caps.read("mixed.txt", gate());
    await caps.edit("mixed.txt", { old: "b", new: "B" }, gate());
    // 单行编辑不归一写回：CRLF 行仍是 CRLF、裸 LF 行纹丝不动
    expect(await fsp.readFile(path.join(dir, "mixed.txt"), "utf8")).toBe("a\r\nB\nc");

    await expect(caps.edit("mixed.txt", { old: "B\nc", new: "X" }, gate())).rejects.toThrow(
      /mixed line endings/,
    );
  });

  it("read：显式 limit 覆盖全文件不算部分读（随后 write 放行）；未覆盖仍拒", async () => {
    const dir = await tmpWorkdir();
    const caps = createCapabilities({ fence: createFence(dir), readState: new ReadState() });
    await fsp.writeFile(path.join(dir, "full.txt"), "a\nb\nc\n", "utf8");
    await caps.read("full.txt", gate(), { limit: 2000 }); // 显式 limit 但读完 3 行
    const w = await caps.write("full.txt", "x", gate());
    expect(w.created).toBe(false);

    await fsp.writeFile(path.join(dir, "tail-only.txt"), "1\n2\n3\n4\n", "utf8");
    await caps.read("tail-only.txt", gate(), { offset: 3, limit: 2 }); // 从中间起读
    await expect(caps.write("tail-only.txt", "y", gate())).rejects.toThrow(/partial/);
  });

  it("edit：未读拒 + stale 拒；区外路径走 floor ask（放行才动手）", async () => {
    const dir = await tmpWorkdir();
    const caps = createCapabilities({ fence: createFence(dir), readState: new ReadState() });

    await expect(caps.edit("never-read.txt", { old: "a", new: "b" }, gate())).rejects.toThrow(
      /not found/,
    );

    await fsp.writeFile(path.join(dir, "stale.txt"), "old", "utf8");
    await caps.read("stale.txt", gate());
    await fsp.utimes(path.join(dir, "stale.txt"), new Date(), new Date(Date.now() + 50_000));
    await expect(caps.edit("stale.txt", { old: "old", new: "new" }, gate())).rejects.toThrow(
      /modified since read/,
    );

    const outsideDir = await tmpWorkdir();
    await fsp.writeFile(path.join(outsideDir, "out.txt"), "data", "utf8");
    const g = gate({ decision: "allowed-once" });
    // 区外文件同样受读态守卫：先经放行的 read，再 edit
    await caps.read(path.join(outsideDir, "out.txt"), g);
    const r = await caps.edit(path.join(outsideDir, "out.txt"), { old: "data", new: "changed" }, g);
    expect(r.replacements).toBe(1);
    expect(g.requestPermission).toHaveBeenCalledTimes(2); // read 区外一次 + edit 区外一次
  });
});
