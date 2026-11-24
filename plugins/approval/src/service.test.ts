import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness, type ServiceDefinition } from "@henira/kernel";
import {
  type ApprovalOptions,
  asHeniraContext,
  type Decision,
  type InteractionAnswer,
  type InteractionRequest,
  type PermissionRule,
} from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalPlugin } from "./service.js";

// 判定链全序集成测试（roadmap M2 判据④⑤）。session / tools / config / interaction 全部
// 槽位桩——插件互不 import 实现（规则 2）；真实五件套的整链集成在 examples/mock e2e（commit 9）。

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-approval-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** session 槽桩：内存事件表 + approval/* 需开回合（store 语义的等价简化） */
function sessionStub(): ServiceDefinition & { service: never } {
  const events: { type: string; data: unknown }[] = [];
  let openTurn: string | undefined;
  return {
    name: "session",
    start() {
      return {
        async append(input: { type: string; data: unknown }) {
          if (
            input.type.startsWith("approval/") &&
            input.type !== "approval/revoked" &&
            openTurn === undefined
          ) {
            throw new Error("requires an open turn");
          }
          if (input.type === "turn/start") openTurn = (input.data as { turn: string }).turn;
          if (input.type === "turn/end") openTurn = undefined;
          events.push(input);
          return { ...input, seq: events.length, time: 0 };
        },
        events: () => events,
      };
    },
  } as never;
}

/** tools 槽桩：只读标记表（D-039 默认放行层的查询源） */
function toolsStub(safe: Record<string, boolean>): ServiceDefinition {
  return {
    name: "tools",
    start() {
      return { isConcurrencySafe: (name: string) => safe[name] };
    },
  };
}

type ScriptedAnswer = InteractionAnswer | Error | ((req: InteractionRequest) => InteractionAnswer);
function interactionStub(
  script: ScriptedAnswer[],
): ServiceDefinition & { requests: InteractionRequest[] } {
  const requests: InteractionRequest[] = [];
  return {
    name: "interaction",
    start() {
      return {
        async ask(req: InteractionRequest): Promise<InteractionAnswer> {
          requests.push(req);
          const next = script.shift();
          const answer = typeof next === "function" ? next(req) : next;
          if (answer instanceof Error) throw answer;
          if (!answer) throw new Error("no answerer present");
          return answer;
        },
        settle(): boolean {
          return false;
        },
        listPending(): readonly InteractionRequest[] {
          return [];
        },
      };
    },
    requests,
  } as never;
}

function configStub(
  rules: PermissionRule[],
  project: PermissionRule[] = [],
): { def: ServiceDefinition; added: PermissionRule[] } {
  const added: PermissionRule[] = [];
  const def = {
    name: "config",
    start() {
      return {
        permissionRules: async () => rules,
        projectPermissionRules: async () => project,
        addProjectPermissionRule: async (rule: PermissionRule) => {
          added.push(rule);
          project.push(rule);
        },
      };
    },
  } as ServiceDefinition;
  return { def, added };
}

const readTool = { read: true };
const writeTool = { write: false };
const bashTool = { bash: false };

async function startedHarness(
  interaction: ServiceDefinition,
  rules: PermissionRule[] = [],
  project: PermissionRule[] = [],
) {
  const config = configStub(rules, project);
  const harness = createHarness()
    .use(sessionStub())
    .use(toolsStub({ ...readTool, ...writeTool, ...bashTool }))
    .use(config.def)
    .use(interaction)
    .use(approvalPlugin());
  await harness.start();
  const ctx = asHeniraContext(harness.context);
  // 打开回合（loop 在活体广播同款总线事件；会话事件由 loop 落账）
  await (ctx.get("session") as unknown as { append(i: never): Promise<unknown> }).append({
    type: "turn/start",
    data: { turn: "t1" },
  } as never);
  ctx.events.emit("turn/start", { turn: "t1" });
  ctx.events.emit("step/start", { turn: "t1", step: 1 });
  return { harness, ctx, events: harness.context, config };
}

const askOpts = (floor?: "ask", signal?: AbortSignal): ApprovalOptions => ({ floor, signal });

type Approval = {
  requestPermission(
    req: { tool: string; args?: unknown; reason?: string },
    opts?: ApprovalOptions,
  ): Promise<Decision>;
};
type Session = {
  append(input: { type: string; data: unknown }): Promise<unknown>;
  events(): { type: string; data: unknown }[];
};

function approvalOf(ctx: ReturnType<typeof asHeniraContext>): Approval {
  return ctx.get("approval") as unknown as Approval;
}
function sessionOf(ctx: ReturnType<typeof asHeniraContext>): Session {
  return ctx.get("session") as unknown as Session;
}

describe("判定链全序（tools-approval §3）", () => {
  it("链外硬拒：凭据路径 → rejected，无审计事件（任何规则都放不了行）", async () => {
    const { harness, ctx } = await startedHarness(interactionStub([]));
    const before = sessionOf(ctx).events().length;
    expect(
      await approvalOf(ctx).requestPermission({
        tool: "read",
        args: { path: "config/credentials.json" },
      }),
    ).toBe("rejected");
    expect(sessionOf(ctx).events().length).toBe(before); // 无 asked / decided
    await harness.dispose();
  });

  it("链外硬拒：灾难命令 → rejected（allow 规则也压不过）", async () => {
    const { harness, ctx } = await startedHarness(interactionStub([]), [
      { match: { tool: "bash" }, decision: "allow" },
    ]);
    expect(
      await approvalOf(ctx).requestPermission({ tool: "bash", args: { command: "rm -rf /" } }),
    ).toBe("rejected");
    await harness.dispose();
  });

  it("deny 规则压倒一切：allow 与 deny 同时命中 → rejected", async () => {
    const { harness, ctx } = await startedHarness(interactionStub([]), [
      { match: { tool: "bash", commandPrefix: "npm" }, decision: "allow" },
      { match: { tool: "bash", commandContains: "rm" }, decision: "deny" },
    ]);
    expect(
      await approvalOf(ctx).requestPermission({ tool: "bash", args: { command: "npm run rm" } }),
    ).toBe("rejected");
    await harness.dispose();
  });

  it("allow 规则命中 → allowed-once + decided 审计", async () => {
    const { harness, ctx } = await startedHarness(interactionStub([]), [
      { match: { tool: "bash", commandPrefix: "npm test" }, decision: "allow" },
    ]);
    expect(
      await approvalOf(ctx).requestPermission({ tool: "bash", args: { command: "npm test" } }),
    ).toBe("allowed-once");
    const events = sessionOf(ctx).events();
    expect(events[events.length - 1].type).toBe("approval/decided");
    await harness.dispose();
  });

  it("默认放行层（D-039）：只读标记自动放行 + 落 decided 审计，不问 answerer", async () => {
    const interaction = interactionStub([new Error("must not be asked")]);
    const { harness, ctx } = await startedHarness(interaction);
    expect(await approvalOf(ctx).requestPermission({ tool: "read", args: { path: "a.txt" } })).toBe(
      "allowed-once",
    );
    expect(interaction.requests).toHaveLength(0); // 没问
    const events = sessionOf(ctx).events();
    expect(events[events.length - 1].type).toBe("approval/decided"); // 照常落审计
    await harness.dispose();
  });

  it("floor=ask 抬高下限：只读工具也直达 answerer（asked + decided 对落盘）", async () => {
    const interaction = interactionStub([
      (req) => ({ kind: "approval", requestId: req.requestId, decision: "allowed-once" }),
    ]);
    const { harness, ctx } = await startedHarness(interaction);
    expect(
      await approvalOf(ctx).requestPermission({ tool: "read", args: {} }, askOpts("ask")),
    ).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(1); // 被问了
    const types = sessionOf(ctx)
      .events()
      .map((e) => e.type);
    expect(types.filter((t) => t === "approval/asked")).toHaveLength(1);
    expect(types.filter((t) => t === "approval/decided")).toHaveLength(1);
    // write-ahead：decided 已落盘，工具执行发生在 requestPermission 返回之后
    const decided = [...sessionOf(ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    expect(
      decided === undefined ? undefined : (decided.data as { decision: string }).decision,
    ).toBe("allowed-once");
    await harness.dispose();
  });

  it("answerer fail-closed 矩阵：缺席 / 抛错 / 不合规 → unavailable + decided 落盘", async () => {
    const throwing = interactionStub([new Error("dialog crashed")]);
    const h1 = await startedHarness(throwing);
    expect(await approvalOf(h1.ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "unavailable",
    );
    await h1.harness.dispose();

    const empty = interactionStub([]);
    const h2 = await startedHarness(empty);
    expect(await approvalOf(h2.ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "unavailable",
    );
    await h2.harness.dispose();

    const rogue = interactionStub([
      { kind: "approval", requestId: "x", decision: "sure-whatever" as Decision },
    ]);
    const h3 = await startedHarness(rogue);
    expect(await approvalOf(h3.ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "unavailable",
    );
    const decided = [...sessionOf(h3.ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    expect(
      decided === undefined ? undefined : (decided.data as { decision: string }).decision,
    ).toBe("unavailable");
    await h3.harness.dispose();
  });

  it("abort → cancelled（先于一切，不进链、不落审计）", async () => {
    const { harness, ctx } = await startedHarness(
      interactionStub([{ kind: "approval", requestId: "x", decision: "allowed-once" }]),
    );
    const controller = new AbortController();
    controller.abort();
    expect(
      await approvalOf(ctx).requestPermission(
        { tool: "write", args: {} },
        { signal: controller.signal },
      ),
    ).toBe("cancelled");
    await harness.dispose();
  });

  it("approval/request 缝：deny 短路、allow 直接放行（都落 decided）", async () => {
    const h1 = await startedHarness(interactionStub([]));
    h1.ctx.events.onWaterfall("approval/request", (value: unknown) => ({
      ...(value as object),
      verdict: "deny",
      by: "guard",
    }));
    expect(await approvalOf(h1.ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "rejected",
    );
    await h1.harness.dispose();

    const h2 = await startedHarness(interactionStub([]));
    h2.ctx.events.onWaterfall("approval/request", (value: unknown) => ({
      ...(value as object),
      verdict: "allow",
      by: "guard",
    }));
    expect(await approvalOf(h2.ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "allowed-once",
    );
    await h2.harness.dispose();
  });

  it("会话级允许折叠（§3.1）：日志里的 decided{scope:session} 让下一次免问；revoked 撤销", async () => {
    const interaction = interactionStub([
      { kind: "approval", requestId: "x", decision: "allowed-once" },
      new Error("must not be asked again"),
    ]);
    const { harness, ctx } = await startedHarness(interaction);
    const session = sessionOf(ctx);
    // 手工落一对 scope:'session' 的审计（真实链路端到端见 E6 describe「生产者端到端」用例；
    // 此处直写日志验证折叠本体）
    await session.append({ type: "turn/start", data: { turn: "t0" } });
    await session.append({
      type: "approval/asked",
      data: { turn: "t0", step: 1, requestId: "r0", callId: "r0", tool: "write", argsDigest: "x" },
    });
    await session.append({
      type: "approval/decided",
      data: { turn: "t0", step: 1, requestId: "r0", decision: "allowed-once", scope: "session" },
    });
    expect(
      await approvalOf(ctx).requestPermission({ tool: "write", args: {} }, askOpts("ask")),
    ).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(0); // 折叠命中，没问
    // 撤销 → 恢复要问（脚本已耗尽 → unavailable）
    ctx.events.emit("turn/start", { turn: "t2" });
    await session.append({
      type: "approval/revoked",
      data: { turn: "t2", step: 0, scope: "session", tool: "write" },
    });
    expect(
      await approvalOf(ctx).requestPermission({ tool: "write", args: {} }, askOpts("ask")),
    ).toBe("unavailable");
    await harness.dispose();
  });

  it("R198 会话级命令规则：bash 点「本会话允许」落精确 rule；同命令免问、异命令再问", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "approval",
        requestId: req.requestId,
        decision: "allowed-once",
        scope: "session",
      }),
      (req) => ({ kind: "approval", requestId: req.requestId, decision: "allowed-once" }),
    ]);
    const { harness, ctx } = await startedHarness(interaction);
    const approval = approvalOf(ctx);
    expect(
      await approval.requestPermission({ tool: "bash", args: { command: "git status" } }),
    ).toBe("allowed-once");
    const decided = [...sessionOf(ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    expect(decided?.data).toMatchObject({
      scope: "session",
      rule: { match: { tool: "bash", commandExact: "git status" }, decision: "allow" },
    });
    // 同命令：折叠命中，不问
    expect(
      await approval.requestPermission({ tool: "bash", args: { command: "git status" } }),
    ).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(1);
    // 异命令：规则不覆盖，照问
    expect(await approval.requestPermission({ tool: "bash", args: { command: "git log" } })).toBe(
      "allowed-once",
    );
    expect(interaction.requests).toHaveLength(2);
    await harness.dispose();
  });

  it("R198 撤销会话允许：清空规则后同命令恢复询问", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "approval",
        requestId: req.requestId,
        decision: "allowed-once",
        scope: "session",
      }),
      (req) => ({ kind: "approval", requestId: req.requestId, decision: "allowed-once" }),
    ]);
    const { harness, ctx } = await startedHarness(interaction);
    const approval = approvalOf(ctx);
    const session = sessionOf(ctx);
    await approval.requestPermission({ tool: "bash", args: { command: "npm test" } });
    await session.append({ type: "approval/revoked", data: { scope: "session" } });
    expect(await approval.requestPermission({ tool: "bash", args: { command: "npm test" } })).toBe(
      "allowed-once",
    );
    expect(interaction.requests).toHaveLength(2); // 撤销后重新问了
    await harness.dispose();
  });

  it("R198 项目级命令规则：写项目配置 + decided{scope:'project',rule}；同命令免问", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "approval",
        requestId: req.requestId,
        decision: "allowed-once",
        scope: "project",
      }),
      new Error("must not be asked again"),
    ]);
    const { harness, ctx, config } = await startedHarness(interaction);
    const approval = approvalOf(ctx);
    expect(
      await approval.requestPermission({ tool: "bash", args: { command: "npm run build" } }),
    ).toBe("allowed-once");
    expect(config.added).toEqual([
      { match: { tool: "bash", commandExact: "npm run build" }, decision: "allow" },
    ]);
    const decided = [...sessionOf(ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    expect(decided?.data).toMatchObject({
      scope: "project",
      rule: { match: { tool: "bash", commandExact: "npm run build" }, decision: "allow" },
    });
    // 第二次同命令：规则层命中（项目文件里的规则），不问
    expect(
      await approval.requestPermission({ tool: "bash", args: { command: "npm run build" } }),
    ).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(1);
    await harness.dispose();
  });

  it("R198 非命令工具点项目级 → 不写项目规则，按一次放行", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "approval",
        requestId: req.requestId,
        decision: "allowed-once",
        scope: "project",
      }),
    ]);
    const { harness, ctx, config } = await startedHarness(interaction);
    expect(
      await approvalOf(ctx).requestPermission({ tool: "write", args: { file_path: "a.txt" } }),
    ).toBe("allowed-once");
    expect(config.added).toHaveLength(0);
    const decided = [...sessionOf(ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    const data = decided?.data as { scope?: string } | undefined;
    expect(data?.scope).toBeUndefined();
    await harness.dispose();
  });

  it("R198 项目级 deny 规则同样压倒会话允许（链首）", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "approval",
        requestId: req.requestId,
        decision: "allowed-once",
        scope: "session",
      }),
    ]);
    const { harness, ctx } = await startedHarness(
      interaction,
      [],
      [{ match: { tool: "bash", commandExact: "npm run deploy" }, decision: "deny" }],
    );
    const approval = approvalOf(ctx);
    // 会话规则先允许同命令，但项目 deny 在一切允许之前
    await approval.requestPermission({ tool: "bash", args: { command: "npm test" } });
    expect(
      await approval.requestPermission({ tool: "bash", args: { command: "npm run deploy" } }),
    ).toBe("rejected");
    await harness.dispose();
  });

  it("没有打开回合 → unavailable（无审计；store NoOpenTurnError 的上游双保险）", async () => {
    const harness = createHarness()
      .use(sessionStub())
      .use(toolsStub({ read: true }))
      .use(configStub([]).def)
      .use(interactionStub([]))
      .use(approvalPlugin());
    await harness.start();
    const ctx = asHeniraContext(harness.context);
    // 不广播 turn/start → approval 不知回合
    expect(await approvalOf(ctx).requestPermission({ tool: "read", args: {} })).toBe("unavailable");
    await harness.dispose();
  });
});

describe("完全访问模式（D-080）", () => {
  /** 在 t1 打开 full 回合（loop 广播同款载荷：turn/start 携带 permissionMode） */
  async function startedFullHarness(interaction: ServiceDefinition, rules: PermissionRule[] = []) {
    const started = await startedHarness(interaction, rules);
    started.ctx.events.emit("turn/start", { turn: "t1", permissionMode: "full" });
    started.ctx.events.emit("step/start", { turn: "t1", step: 2 });
    return started;
  }

  it('full：非只读工具免问自动放行，decided 带 mode:"full" 审计标记', async () => {
    const interaction = interactionStub([new Error("must not be asked")]);
    const { harness, ctx } = await startedFullHarness(interaction);
    expect(
      await approvalOf(ctx).requestPermission({ tool: "write", args: { path: "a.txt" } }),
    ).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(0); // 不问
    const decided = [...sessionOf(ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    expect(decided?.data).toMatchObject({ decision: "allowed-once", mode: "full" });
    await harness.dispose();
  });

  it("full：硬拒清单不动——凭据路径 / 灾难命令照 rejected（无审计）", async () => {
    const { harness, ctx } = await startedFullHarness(interactionStub([]));
    const before = sessionOf(ctx).events().length;
    expect(
      await approvalOf(ctx).requestPermission({
        tool: "read",
        args: { path: "config/credentials.json" },
      }),
    ).toBe("rejected");
    expect(
      await approvalOf(ctx).requestPermission({ tool: "bash", args: { command: "rm -rf /" } }),
    ).toBe("rejected");
    expect(sessionOf(ctx).events().length).toBe(before);
    await harness.dispose();
  });

  it("full：deny 规则与 hook deny 不动——规则层 rejected；waterfall deny 同样拦", async () => {
    const h1 = await startedFullHarness(interactionStub([]), [
      { match: { tool: "bash", commandContains: "rm" }, decision: "deny" },
    ]);
    expect(
      await approvalOf(h1.ctx).requestPermission({ tool: "bash", args: { command: "npm rm x" } }),
    ).toBe("rejected");
    await h1.harness.dispose();

    const h2 = await startedFullHarness(interactionStub([]));
    h2.ctx.events.onWaterfall("approval/request", (value: unknown) => ({
      ...(value as object),
      verdict: "deny",
      by: "guard",
    }));
    expect(await approvalOf(h2.ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "rejected",
    );
    await h2.harness.dispose();
  });

  it('full：floor:"ask" 的区外沙箱闸询问同样自动放行（bypass 同界——本层在水瀑之后）', async () => {
    const interaction = interactionStub([new Error("must not be asked")]);
    const { harness, ctx } = await startedFullHarness(interaction);
    expect(
      await approvalOf(ctx).requestPermission(
        { tool: "write", args: { path: "../outside/workspace" }, reason: "outside workspace" },
        askOpts("ask"),
      ),
    ).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(0);
    const decided = [...sessionOf(ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    expect(decided?.data).toMatchObject({ decision: "allowed-once", mode: "full" });
    await harness.dispose();
  });

  it("缺省（无 permissionMode）= ask：write 照走 answerer（decided 无 mode 标记）", async () => {
    const interaction = interactionStub([
      (req) => ({ kind: "approval", requestId: req.requestId, decision: "allowed-once" }),
    ]);
    const { harness, ctx } = await startedHarness(interaction);
    expect(await approvalOf(ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "allowed-once",
    );
    expect(interaction.requests).toHaveLength(1); // 被问了
    const decided = [...sessionOf(ctx).events()]
      .reverse()
      .find((e) => e.type === "approval/decided");
    expect(decided?.data).not.toHaveProperty("mode");
    await harness.dispose();
  });

  it("换回合未带权威 → 兜底回 ask（fail-closed：step/start 不得延续上一回合的 full）", async () => {
    const interaction = interactionStub([new Error("must not be asked")]);
    const { harness, ctx } = await startedFullHarness(interaction);
    // 同回合 step 推进：full 保持
    ctx.events.emit("step/start", { turn: "t1", step: 3 });
    expect(await approvalOf(ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "allowed-once",
    );
    // 新回合只广播 turn/start（无 mode）+ step/start → 权威丢失，按 ask → 走 answerer
    ctx.events.emit("turn/start", { turn: "t9" });
    ctx.events.emit("step/start", { turn: "t9", step: 1 });
    expect(await approvalOf(ctx).requestPermission({ tool: "write", args: {} })).toBe(
      "unavailable", // 脚本已耗尽 → unavailable = 确实问过
    );
    await harness.dispose();
  });
});

describe("answerer scope:'session' 生产者端到端 + asked 全文（E6）", () => {
  it("settle 带 scope:'session' → decided{scope} 落账 → 同工具第二次免问（真实链路）", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "approval",
        requestId: req.requestId,
        decision: "allowed-once",
        scope: "session",
      }),
      new Error("must not be asked again"),
    ]);
    const { harness, ctx } = await startedHarness(interaction);
    const first = await approvalOf(ctx).requestPermission(
      { tool: "write", args: { file_path: "a.txt", content: "x" } },
      askOpts("ask"),
    );
    expect(first).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(1);
    const decidedEvent = sessionOf(ctx)
      .events()
      .find((e) => e.type === "approval/decided");
    if (decidedEvent === undefined) throw new Error("decided event missing");
    const decidedData = decidedEvent.data as { scope?: string };
    expect(decidedData.scope).toBe("session");
    // 第二次同工具：折叠命中免问（脚本第二项是抛错——若被问到会 unavailable）
    const second = await approvalOf(ctx).requestPermission(
      { tool: "write", args: { file_path: "b.txt", content: "y" } },
      askOpts("ask"),
    );
    expect(second).toBe("allowed-once");
    expect(interaction.requests).toHaveLength(1);
    await harness.dispose();
  });

  it("approval/asked 落 args/reason 全文（D-046「审计事件对照记全文」归位）+ digest 保留", async () => {
    const { harness, ctx } = await startedHarness(
      interactionStub([
        (req) => ({ kind: "approval", requestId: req.requestId, decision: "rejected" }),
      ]),
    );
    await approvalOf(ctx).requestPermission(
      {
        tool: "edit",
        args: { file_path: "f.ts", old_string: "a", new_string: "b" },
        reason: "path is outside the session workspace: X",
      },
      askOpts("ask"),
    );
    const asked = sessionOf(ctx)
      .events()
      .find((e) => e.type === "approval/asked");
    expect(asked).toBeDefined();
    const data = asked?.data as { args?: unknown; reason?: string; argsDigest?: string };
    expect(data.args).toEqual({ file_path: "f.ts", old_string: "a", new_string: "b" });
    expect(data.reason).toBe("path is outside the session workspace: X");
    expect(data.argsDigest).toEqual(expect.any(String));
    await harness.dispose();
  });

  it("args 尺寸闸（审查 F4）：超 256KB → asked 只落 digest；rejected 带 scope → decided 无 scope（审查 F5）", async () => {
    const interaction = interactionStub([
      (req) => ({
        kind: "approval",
        requestId: req.requestId,
        decision: "rejected",
        scope: "session",
      }),
    ]);
    const { harness, ctx } = await startedHarness(interaction);
    const decision = await approvalOf(ctx).requestPermission(
      { tool: "write", args: { blob: "z".repeat(300 * 1024) } },
      askOpts("ask"),
    );
    expect(decision).toBe("rejected");
    const askedEvent = sessionOf(ctx)
      .events()
      .find((e) => e.type === "approval/asked");
    if (askedEvent === undefined) throw new Error("asked event missing");
    const askedData = askedEvent.data as { args?: unknown; argsDigest?: string };
    expect(askedData.args).toBeUndefined(); // 超闸丢弃（digest-only 回落形状）
    expect(askedData.argsDigest).toEqual(expect.any(String));
    const decidedEvent = sessionOf(ctx)
      .events()
      .find((e) => e.type === "approval/decided");
    if (decidedEvent === undefined) throw new Error("decided event missing");
    const decidedData = decidedEvent.data as { decision?: string; scope?: string };
    expect(decidedData.decision).toBe("rejected");
    expect(decidedData.scope).toBeUndefined(); // rejected 不落 scope（审查 F5：settled 无「· 本会话」）
    await harness.dispose();
  });

  it("answerer 不合规 scope → unavailable（fail-closed 形状校验）", async () => {
    const { harness, ctx } = await startedHarness(
      interactionStub([
        (req) =>
          ({
            kind: "approval",
            requestId: req.requestId,
            decision: "allowed-once",
            scope: "forever",
          }) as unknown as InteractionAnswer,
      ]),
    );
    expect(
      await approvalOf(ctx).requestPermission({ tool: "write", args: {} }, askOpts("ask")),
    ).toBe("unavailable");
    await harness.dispose();
  });
});
