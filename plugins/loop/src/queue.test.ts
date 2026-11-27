// 队列持久化（D-045 / D-092）：分型条目（prompt | compact）、v1 兼容读、插话只对消息生效。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptQueue } from "./queue.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-queue-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("PromptQueue（D-092 队列意图分型）", () => {
  it("compact 条目：kind/text/instructions 落盘并可重载；steer 不适用", async () => {
    const queue = new PromptQueue(root);
    await queue.load();
    const entry = await queue.enqueueCompact("保留决定与文件");
    expect(entry).toMatchObject({
      kind: "compact",
      text: "/compact",
      steer: false,
      instructions: "保留决定与文件",
    });
    expect(await queue.steer(entry.id)).toBe(false); // 维护意图不能变成插话

    const reloaded = new PromptQueue(root);
    await reloaded.load();
    expect(reloaded.pending).toHaveLength(1);
    expect(reloaded.pending[0]).toMatchObject({
      kind: "compact",
      text: "/compact",
      instructions: "保留决定与文件",
    });
    const raw = JSON.parse(await fs.readFile(path.join(root, "queue.json"), "utf8")) as {
      version: number;
    };
    expect(raw.version).toBe(2);
  });

  it("v1 文件兼容读：缺 kind 的旧条目不丢，按 prompt 处理", async () => {
    await fs.writeFile(
      path.join(root, "queue.json"),
      JSON.stringify({
        version: 1,
        entries: [{ id: "q-old", text: "旧条目", steer: true, queuedAt: 1 }],
      }),
      "utf8",
    );
    const queue = new PromptQueue(root);
    await queue.load();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]).toMatchObject({ id: "q-old", kind: "prompt", text: "旧条目" });
    // 插话语义对旧条目照常成立
    expect(await queue.claimSteers()).toHaveLength(1);
  });

  it("损坏条目丢弃，合法条目保留（不让坏队列卡住会话）", async () => {
    await fs.writeFile(
      path.join(root, "queue.json"),
      JSON.stringify({
        version: 2,
        entries: [
          { id: "q-ok", kind: "prompt", text: "正常", steer: false, queuedAt: 1 },
          { id: 42, text: "坏", steer: false },
          null,
        ],
      }),
      "utf8",
    );
    const queue = new PromptQueue(root);
    await queue.load();
    expect(queue.pending.map((entry) => entry.id)).toEqual(["q-ok"]);
  });

  it("claimSteers 不取 compact 条目（维护意图只按 FIFO 消费）", async () => {
    const queue = new PromptQueue(root);
    await queue.load();
    await queue.enqueueCompact();
    const prompt = await queue.enqueue("插话", true);
    const steers = await queue.claimSteers();
    expect(steers.map((entry) => entry.id)).toEqual([prompt.id]);
    expect(queue.pending.map((entry) => entry.kind)).toEqual(["compact"]);
  });

  it("落盘串行化（D-092 决定 6）：并发入队 / 摘条同时落盘，互不报错且文件 = 最新态", async () => {
    const queue = new PromptQueue(root);
    await queue.load();
    // 冲刷链摘条目的落盘与并发入队的落盘曾各写各的——Windows 上 rename 撞替换窗口即抛错，
    // 落盘内容还可能是旧快照（丢更新）
    const compact = queue.enqueueCompact();
    const prompts = Array.from({ length: 24 }, (_, i) => queue.enqueue(`并发 ${i}`, false));
    const drained = queue.drainNext(); // 摘走队头的 compact
    await Promise.all([compact, ...prompts, drained]);
    expect(queue.pending).toHaveLength(24);
    const raw = JSON.parse(await fs.readFile(path.join(root, "queue.json"), "utf8")) as {
      version: number;
      entries: { id: string }[];
    };
    expect(raw.version).toBe(2);
    expect(raw.entries.map((entry) => entry.id)).toEqual(queue.pending.map((entry) => entry.id));
    const reloaded = new PromptQueue(root);
    await reloaded.load();
    expect(reloaded.pending).toHaveLength(24);
  });
});
