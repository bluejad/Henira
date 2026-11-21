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
  SessionStore,
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

/** 开档拿完整修理面（CreateSessionResult——store 直开，不进 open 管家：修理用例自行 close） */
function SessionStoreOpenForTest(dir: string, cwd: string, id: string) {
  return SessionStore.create({ dir, cwd, id });
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

describe("重启收口（R175）：seq 外科重排 + 孤儿挂起补写", () => {
  const asked = (t: string, requestId: string) => ({
    type: "approval/asked",
    data: { turn: t, step: 1, requestId, callId: requestId, tool: "bash", argsDigest: "{}" },
  });

  it("append 并发连发 seq 仍严格递增（写者竞态根治——串行化链）", async () => {
    const s = await openSession("race");
    await s.append(turnStart("t1"));
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        s.append({
          type: "approval/decided",
          data: { turn: "t1", step: 1, requestId: `r${i}`, decision: "cancelled" },
        }),
      ),
    );
    const seqs = results.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // 无重复
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // 且与完成序一致（2..9）
    await s.append(turnEnd("t1")); // seq 10（不留给开档收口补——本用例只测并发序）
    await s.close();
    const reopened = await openSession("race");
    expect(reopened.events().map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(reopened.events().filter((e) => e.type === "turn/end")).toHaveLength(1); // 零意外补写
  });

  it("孤儿审批 + 开回合：开档依序补 invalidated → interrupted，time 定格最后真实事件", async () => {
    const dir = path.join(root, "orphan");
    {
      const s = await createSession({ dir, cwd: root, id: "s-orphan" });
      await s.append(user("t1", "hi")); // seq1
      await s.append(turnStart("t1")); // seq2
      await s.append(asked("t1", "r1")); // seq3（time=真实时刻）
      await s.close(); // 直接关（模拟进程死亡——无收尾）
      open.pop();
    }
    const file = path.join(dir, "session.v1.jsonl");
    const before = await fs.readFile(file, "utf8");
    const lastTime = JSON.parse(before.trimEnd().split("\n").at(-1) as string).time as number;
    const { store } = await SessionStoreOpenForTest(dir, root, "s-orphan");
    expect(
      store
        .events()
        .map((e) => e.type)
        .slice(-2),
    ).toEqual(["approval/invalidated", "turn/end"]);
    const tail = store.events().slice(-2);
    expect(tail[0]).toMatchObject({
      seq: 4,
      time: lastTime,
      data: { requestId: "r1", turn: "t1", step: 1 },
    });
    expect((tail[0].data as { decision?: string }).decision).toBeUndefined();
    expect(tail[0].ignorable).toBe(true); // 旧读者透明跳过（回滚兼容）
    expect(tail[1]).toMatchObject({
      seq: 5,
      time: lastTime,
      data: { turn: "t1", reason: "interrupted" },
    });
    await store.close();
    // 幂等：再开档零补写
    const again = await SessionStoreOpenForTest(dir, root, "s-orphan");
    expect(again.invalidatedApprovals).toBe(0);
    expect(again.synthesizedInterrupted).toBe(false);
    expect(again.store.events()).toHaveLength(5);
    await again.store.close();
  });

  it("老账本形态（回合已被旧代码收口、审批仍挂）：repair 通道绕回合包裹闸补 invalidated", async () => {
    const dir = path.join(root, "stale-orphan");
    {
      const s = await createSession({ dir, cwd: root, id: "s-stale" });
      await s.append(user("t1", "hi"));
      await s.append(turnStart("t1"));
      await s.append(asked("t1", "r9"));
      await s.append(turnEnd("t1", "interrupted")); // 旧代码只收了回合
      await s.close();
      open.pop();
    }
    const { store, invalidatedApprovals, synthesizedInterrupted } = await SessionStoreOpenForTest(
      dir,
      root,
      "s-stale",
    );
    expect(invalidatedApprovals).toBe(1); // repair 通道补写成功（无回合也放行）
    expect(synthesizedInterrupted).toBe(false); // 回合已闭合不再补
    expect(store.events().at(-1)).toMatchObject({
      type: "approval/invalidated",
      data: { requestId: "r9" },
    });
    await store.close();
  });

  it("已 decided 的审批不补；干净账本开档零修理", async () => {
    const dir = path.join(root, "settled");
    {
      const s = await createSession({ dir, cwd: root, id: "s-settled" });
      await s.append(user("t1", "hi"));
      await s.append(turnStart("t1"));
      await s.append(asked("t1", "r-ok"));
      await s.append({
        type: "approval/decided",
        data: { turn: "t1", step: 1, requestId: "r-ok", decision: "allowed-once" },
      });
      await s.append(turnEnd("t1"));
      await s.close();
      open.pop();
    }
    const result = await SessionStoreOpenForTest(dir, root, "s-settled");
    expect(result.invalidatedApprovals).toBe(0);
    expect(result.synthesizedInterrupted).toBe(false);
    expect(result.resequenced).toBe(false);
    expect(result.store.events()).toHaveLength(5);
    await result.store.close();
  });

  it("seq 重复历史伤：开档外科重排（保事件保行序只修 seq），重排后读者可开档", async () => {
    const dir = path.join(root, "dupseq");
    await fs.mkdir(dir, { recursive: true });
    const header = `${JSON.stringify({ version: 1, id: "s-dup", createdAt: 1, cwd: root })}\n`;
    const e = (seq: number, requestId: string) =>
      `${JSON.stringify({ type: "approval/decided", seq, time: 100 + seq, data: { turn: "t1", step: 1, requestId, decision: "cancelled" } })}\n`;
    // 竞态伤形状：三个事件共享 seq 2（普查实锤的 decided 连发形状）
    await fs.writeFile(
      path.join(dir, "session.v1.jsonl"),
      `${header}${JSON.stringify({ type: "turn/start", seq: 1, time: 1, data: { turn: "t1" } })}\n${e(2, "a")}${e(2, "b")}${e(2, "c")}${JSON.stringify({ type: "turn/end", seq: 3, time: 9, data: { turn: "t1", reason: "completed" } })}\n`,
    );
    const result = await SessionStoreOpenForTest(dir, root, "s-dup");
    expect(result.resequenced).toBe(true);
    const seqs = result.store.events().map((e2) => e2.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]); // 连续无重复
    const requestIds = result.store
      .events()
      .map((e2) => (e2.data as { requestId?: string }).requestId);
    expect(requestIds).toEqual([undefined, "a", "b", "c", undefined]); // 事件零丢失
    expect(result.invalidatedApprovals).toBe(0); // 回合已闭合、审批全 decided——零孤儿
    await result.store.close();
  });
});
