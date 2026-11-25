import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, type SessionHandle } from "./index.js";

// fork / replay 语义（session.md §6）：前缀复制、半回合补 forked 收尾、整目录随走、
// 复制而非引用（源不动）、复制后互不影响。

let root: string;
const open: SessionHandle[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-fork-"));
});

afterEach(async () => {
  for (const handle of open.splice(0)) await handle.close();
  await fs.rm(root, { recursive: true, force: true });
});

async function openSession(id: string): Promise<SessionHandle> {
  const handle = await createSession({ dir: path.join(root, id), cwd: root, id });
  open.push(handle);
  return handle;
}

const user = (t: string, content: string) => ({
  type: "user/message",
  data: { turn: t, step: 0, content, source: "user" },
});
const turnStart = (t: string) => ({ type: "turn/start", data: { turn: t } });
const turnEnd = (t: string, reason = "completed") => ({
  type: "turn/end",
  data: { turn: t, reason },
});

describe("fork", () => {
  it("全量复制：新 header 指源、事件逐字复制（seq/time 不变）、整目录随走、源不动", async () => {
    const s = await openSession("src");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "hello"));
    await s.append(turnEnd("t1"));
    await fs.writeFile(path.join(s.directory, "attachments-x.bin"), "data"); // 目录内附件

    const child = await s.fork();
    open.push(child);
    expect(child.header().parentSession).toBe("src");
    expect(child.header().id).not.toBe("src");
    expect(child.header().cwd).toBe(root);
    expect(child.events().map((e) => JSON.stringify(e))).toEqual(
      s.events().map((e) => JSON.stringify(e)),
    );
    await expect(
      fs.readFile(path.join(child.directory, "attachments-x.bin"), "utf8"),
    ).resolves.toBe("data");
    expect(s.events()).toHaveLength(3); // 源不动
    const sourceLog = await fs.readFile(path.join(s.directory, "session.v1.jsonl"), "utf8");
    expect(sourceLog.split("\n").filter((l) => l.trim().length > 0)).toHaveLength(4); // header + 3
  });

  it("半回合切点：为复制出的前缀补写 turn/end{forked}，源会话不写", async () => {
    const s = await openSession("half");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "hi")); // 回合开着，没有收尾
    const child = await s.fork();
    open.push(child);
    const last = child.events()[child.events().length - 1];
    expect(last.type).toBe("turn/end");
    expect((last.data as { reason: string }).reason).toBe("forked");
    expect(last.seq).toBe(3);
    expect(s.events()).toHaveLength(2); // 源不补写
  });

  it("半回合切点：开回合内无结果的 tool/call 先补合成 tool/result，再补 forked 收尾（D-085）", async () => {
    const s = await openSession("half-tool");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "hi"));
    await s.append({ type: "step/start", data: { turn: "t1", step: 1 } });
    await s.append({
      type: "tool/call",
      data: { turn: "t1", step: 1, callId: "c1", name: "read", arguments: '{"file_path":"a"}' },
    });
    await s.append({
      type: "tool/call",
      data: { turn: "t1", step: 1, callId: "c2", name: "read", arguments: '{"file_path":"b"}' },
    });
    // c1 已有结果；c2 在切点处仍悬挂
    await s.append({
      type: "tool/result",
      data: { turn: "t1", step: 1, callId: "c1", isError: false, content: "ok", durationMs: 3 },
    });
    const child = await s.fork();
    open.push(child);
    expect(child.events().map((e) => e.type)).toEqual([
      "turn/start",
      "user/message",
      "step/start",
      "tool/call",
      "tool/call",
      "tool/result",
      "tool/result", // c2 的合成结果
      "turn/end",
    ]);
    const synthetic = child.events()[6];
    const data = synthetic.data as { callId: string; isError: boolean; content: string };
    expect(data.callId).toBe("c2");
    expect(data.isError).toBe(true);
    expect(data.content).toContain("[forked]");
    expect((child.events()[7].data as { reason: string }).reason).toBe("forked");
    expect(s.events()).toHaveLength(6); // 源不补写
  });

  it("指定 atSeq：切在回合边界（已收尾）不触发补写，子会话从自洽状态继续", async () => {
    const s = await openSession("cut");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "one"));
    await s.append(turnEnd("t1"));
    await s.append(turnStart("t2"));
    await s.append(user("t2", "two"));
    const child = await s.fork(3); // 前缀含 turnEnd/t1：自洽，无 forked 补写
    open.push(child);
    expect(child.events()).toHaveLength(3);
    expect(child.events()[2].type).toBe("turn/end");
    expect(s.events()).toHaveLength(5); // 源不受影响
    await child.append(turnStart("t3"));
    await child.append(user("t3", "three"));
    expect(child.events()[4].seq).toBe(5); // seq 接前缀连续分配
  });

  it("切在半回合：复制前缀 + forked 收尾，子会话继续追加 seq 连续", async () => {
    const s = await openSession("mid");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "one"));
    const child = await s.fork(2); // 复制到 user/t1，回合未收尾
    open.push(child);
    expect(child.events()).toHaveLength(3); // 前缀 2 条 + forked 收尾
    expect(child.events()[2].type).toBe("turn/end");
    await child.append(user("t1", "continue"));
    expect(child.events()[3].seq).toBe(4);
    expect(s.events()).toHaveLength(2); // 源不补写
  });

  it("复制后互不影响：子追加不回流源；源继续追加不进子", async () => {
    const s = await openSession("indep");
    await s.append(user("t1", "before"));
    const child = await s.fork();
    open.push(child);
    await child.append(user("t1", "child-only"));
    await s.append(user("t1", "parent-only"));
    expect(child.events().map((e) => (e.data as { content: string }).content)).toEqual([
      "before",
      "child-only",
    ]);
    expect(s.events().map((e) => (e.data as { content: string }).content)).toEqual([
      "before",
      "parent-only",
    ]);
  });

  it("子会话 close 后可独立重开（锁各自持有）", async () => {
    const s = await openSession("rel");
    await s.append(user("t1", "hi"));
    const child = await s.fork();
    const dir = child.directory;
    await child.close(); // 子锁释放，父锁仍持有
    const reopened = await createSession({ dir, cwd: root });
    open.push(reopened);
    expect(reopened.events()).toHaveLength(1);
  });

  it("越界切点报错", async () => {
    const s = await openSession("range");
    await s.append(user("t1", "one"));
    await expect(s.fork(99)).rejects.toThrow("out of range");
    await expect(s.fork(-1)).rejects.toThrow("out of range");
  });
});

describe("replay", () => {
  it("按序把日志逐条交给 visitor", async () => {
    const s = await openSession("replay");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "hi"));
    const seen: string[] = [];
    await s.replay(async (e) => {
      seen.push(e.type);
    });
    expect(seen).toEqual(["turn/start", "user/message"]);
  });
});
