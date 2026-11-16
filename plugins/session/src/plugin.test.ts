import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness } from "@reins/kernel";
import { asReinsContext } from "@reins/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionPlugin } from "./plugin.js";

// 插件壳：占 'session' 槽、start 开档、stop 释放锁——全程 kernel 公共注册路径（P8）。

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "reins-session-plugin-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("sessionPlugin", () => {
  it("占 'session' 槽：start 返回服务，append / derive 走公共注册路径", async () => {
    const harness = createHarness().use(
      sessionPlugin({ directory: path.join(root, "s1"), cwd: root }),
    );
    await harness.start();
    const ctx = asReinsContext(harness.context);
    const session = ctx.get("session");
    const event = await session.append({ type: "turn/start", data: { turn: "t1" } });
    expect(event.seq).toBe(1);
    expect(session.header().cwd).toBe(root);
    await harness.dispose();
  });

  it("stop 释放文件锁：dispose 后同目录可重开，且事件原样保留（P1 reopen identity）", async () => {
    const dir = path.join(root, "s2");
    const first = createHarness().use(sessionPlugin({ directory: dir, cwd: root }));
    await first.start();
    await asReinsContext(first.context)
      .get("session")
      .append({ type: "turn/start", data: { turn: "t1" } });
    await first.dispose();

    const second = createHarness().use(sessionPlugin({ directory: dir, cwd: root }));
    await second.start(); // 锁已释放 → 不抛 SessionLockedError
    const session = asReinsContext(second.context).get("session");
    const events = session.events();
    expect(events).toHaveLength(2); // 原事件 + 开档补写 turn/end{interrupted}（session.md §5 崩溃也要有收尾）
    expect(events[1].type).toBe("turn/end");
    await second.dispose();
  });
});
