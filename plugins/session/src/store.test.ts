import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  EventDataInvalidError,
  NoOpenTurnError,
  type SessionHandle,
  SessionLockedError,
  SessionVersionError,
  UnknownEventTypeError,
  UnregisteredEventTypeError,
} from "./index.js";

// 存储语义（session.md §5）+ P1 不变量（"模型可见 ⟺ 已落日志"的落盘半边）+
// 审批写入规则（§1.1）+ surfaceOp 重叠裁决（§4）。

let root: string;
const open: SessionHandle[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-session-"));
});

afterEach(async () => {
  for (const handle of open.splice(0)) await handle.close();
  await fs.rm(root, { recursive: true, force: true });
});

async function openSession(id?: string): Promise<SessionHandle> {
  const handle = await createSession({
    dir: path.join(root, id ?? "s"),
    cwd: root,
    ...(id && { id }),
  });
  open.push(handle);
  return handle;
}

const turnStart = (t: string) => ({ type: "turn/start", data: { turn: t } });
const turnEnd = (t: string, reason = "completed") => ({
  type: "turn/end",
  data: { turn: t, reason },
});
const user = (t: string, content: string) => ({
  type: "user/message",
  data: { turn: t, step: 0, content, source: "user" },
});
const assistant = (t: string, content: string) => ({
  type: "assistant/message",
  data: { turn: t, step: 0, content, model: "mock", finishReason: "stop" },
});

describe("追加与落盘", () => {
  it("header 落盘、seq 从 1 连续分配、append 返回即事件完整", async () => {
    const s = await openSession("abc");
    const e1 = await s.append(turnStart("t1"));
    const e2 = await s.append(user("t1", "hello"));
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e2.time).toBeGreaterThan(0);
    expect(s.header().id).toBe("abc");
    expect(s.header().version).toBe(1);
    expect(s.header().cwd).toBe(root);
  });

  it("P1 不变量：append 返回即落盘——重开一个全新读者，事件与派生逐字一致", async () => {
    const s = await openSession("p1");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "hi"));
    await s.append(assistant("t1", "hello"));
    await s.append(turnEnd("t1")); // 收尾后再关档：重开不会补写 interrupted，逐字对比才干净
    const memoryEvents = [...s.events()];
    const memoryDerived = s.deriveMessages();
    await s.close();
    const reopened = await openSession("p1");
    expect(reopened.events()).toHaveLength(memoryEvents.length);
    expect(reopened.events().map((e) => JSON.stringify(e))).toEqual(
      memoryEvents.map((e) => JSON.stringify(e)),
    );
    expect(reopened.deriveMessages()).toEqual(memoryDerived);
  });

  it("半行丢弃：崩溃残留被截断，之后照常追加", async () => {
    const s = await openSession("torn");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "hello"));
    await s.append(turnEnd("t1")); // 先收尾再制造半行，隔离崩溃恢复逻辑
    const dir = s.directory;
    await s.close();
    await fs.appendFile(path.join(dir, "session.v1.jsonl"), '{"type":"user/mess'); // 半行
    const reopened = await openSession("torn");
    expect(reopened.events()).toHaveLength(3); // 半行被丢弃，完整事件保留
    await reopened.append(assistant("t1", "ok"));
    await reopened.close();
    const final = await openSession("torn");
    expect(final.events()).toHaveLength(4); // 截断后追加不产生混合行
  });

  it("开档发现有回合未收尾 → 补写 turn/end{interrupted}", async () => {
    const s = await openSession("intr");
    await s.append(turnStart("t1"));
    await s.append(user("t1", "hi"));
    await s.close(); // 没写 turn/end
    const reopened = await openSession("intr");
    const last = reopened.events()[reopened.events().length - 1];
    expect(last.type).toBe("turn/end");
    expect((last.data as { reason: string }).reason).toBe("interrupted");
    expect((last.data as { turn: string }).turn).toBe("t1");
    expect(last.seq).toBe(3);
  });

  it("版本闸：未来版本拒读", async () => {
    const dir = path.join(root, "v2");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "session.v1.jsonl"),
      `${JSON.stringify({ version: 2, id: "x", createdAt: 0, cwd: "" })}\n`,
    );
    await expect(createSession({ dir, cwd: root })).rejects.toBeInstanceOf(SessionVersionError);
  });

  it("未知类型 fail-closed；标 ignorable 则透明载入", async () => {
    const dir = path.join(root, "alien");
    await fs.mkdir(dir, { recursive: true });
    const header = JSON.stringify({ version: 1, id: "a", createdAt: 0, cwd: "" });
    const alien = JSON.stringify({ type: "alien/x", seq: 1, time: 1, data: {} });
    await fs.writeFile(path.join(dir, "session.v1.jsonl"), `${header}\n${alien}\n`);
    await expect(createSession({ dir, cwd: root })).rejects.toBeInstanceOf(UnknownEventTypeError);
    await fs.writeFile(
      path.join(dir, "session.v1.jsonl"),
      `${header}\n${JSON.stringify({ ...JSON.parse(alien), ignorable: true })}\n`,
    );
    const s = await createSession({ dir, cwd: root });
    open.push(s);
    expect(s.events()).toHaveLength(1); // opaque 记录保留在日志、不参与派生
    expect(s.deriveMessages()).toEqual([]);
  });

  it("append 校验：未注册类型与不合 schema 的载荷都被拒", async () => {
    const s = await openSession("val");
    await expect(s.append({ type: "alien/x", data: {} })).rejects.toBeInstanceOf(
      UnregisteredEventTypeError,
    );
    await expect(
      s.append({ type: "user/message", data: { turn: "t1", step: 0, source: "user" } }),
    ).rejects.toBeInstanceOf(EventDataInvalidError); // 缺 content
  });
});

describe("单写者锁（session.md §5）", () => {
  it("同目录双开拒绝；close 后可再开", async () => {
    const dir = path.join(root, "lock");
    const s1 = await createSession({ dir, cwd: root });
    open.push(s1);
    await expect(createSession({ dir, cwd: root })).rejects.toBeInstanceOf(SessionLockedError);
    await s1.close();
    const s2 = await createSession({ dir, cwd: root });
    open.push(s2);
    expect(s2.events()).toHaveLength(0);
  });

  it("陈旧锁（进程已死/内容损坏）可接管", async () => {
    const dir = path.join(root, "stale");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "session.lock"), "{ broken"); // 损坏锁 → 陈旧
    const s = await createSession({ dir, cwd: root });
    open.push(s);
    expect(s.events()).toHaveLength(0);
  });
});

describe("审批写入规则（session.md §1.1：没有打开的回合不接受审批记录）", () => {
  it("无打开回合拒绝；有打开回合接受；回合关闭后再拒", async () => {
    const s = await openSession("appr");
    const asked = (t: string) => ({
      type: "approval/asked",
      data: { turn: t, step: 0, requestId: "r1", callId: "c1", tool: "bash", argsDigest: "{}" },
    });
    await expect(s.append(asked("t1"))).rejects.toBeInstanceOf(NoOpenTurnError);
    await s.append(turnStart("t1"));
    await expect(s.append(asked("t1"))).resolves.toBeDefined();
    await s.append(turnEnd("t1"));
    await expect(s.append(asked("t1"))).rejects.toBeInstanceOf(NoOpenTurnError);
  });
});

describe("surfaceOp 重叠裁决（session.md §4：先写生效，后到的整条忽略并补非致命 error）", () => {
  it("重叠的替换记录不进日志，代之以 error 事件；先写者照常生效", async () => {
    const s = await openSession("overlap");
    await s.append(turnStart("t1")); // 1
    await s.append({ type: "step/start", data: { turn: "t1", step: 1 } }); // 2
    await s.append(user("t1", "long conversation")); // 3
    await s.append({
      type: "step/end",
      data: { turn: "t1", step: 1, usage: { inputTokens: 1, outputTokens: 1 } },
    }); // 4
    const first = await s.append({
      type: "system/message",
      data: {
        turn: "t1",
        step: 0,
        content: "summary A",
        surfaceOp: { op: "replace", startSeq: 2, endSeq: 4 },
      },
    });
    expect(first.seq).toBe(5);
    const second = await s.append({
      type: "system/message",
      data: {
        turn: "t1",
        step: 0,
        content: "summary B",
        surfaceOp: { op: "replace", startSeq: 3, endSeq: 5 },
      },
    });
    expect(second.type).toBe("error"); // 整条忽略，补非致命 error
    expect((second.data as { code: string }).code).toBe("surface-op-overlap-ignored");
    expect((second.data as { fatal?: boolean }).fatal).toBe(false);
    // 派生：A 生效（user 被替换），B 无踪迹
    expect(s.deriveMessages()).toEqual([{ role: "system", content: "summary A" }]);
    await s.close();
    const reopened = await openSession("overlap");
    const types = reopened.events().map((e) => e.type);
    // 只有第一条替换记录进了日志（B 被整条忽略），外加一条非致命 error
    expect(types.filter((t) => t === "system/message")).toHaveLength(1);
    expect(types.filter((t) => t === "error")).toHaveLength(1);
    expect(reopened.deriveMessages()).toEqual([{ role: "system", content: "summary A" }]);
  });
});
