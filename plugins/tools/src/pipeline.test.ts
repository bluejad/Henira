import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHarness } from "@henira/kernel";
import {
  type ApprovalOptions,
  asHeniraContext,
  type Decision,
  type HeniraContext,
  type PermissionRequest,
  type PermissionResult,
  type ToolContext,
  type ToolOutcome,
} from "@henira/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PipelineDeps, runBatch, runOne } from "./pipeline.js";
import { ToolRegistry } from "./registry.js";
import { toolsPlugin } from "./service.js";

// 五段管线 + 批执行测试。判定链 = 可编程 requestPermission：记录 (tool, opts.floor)、
// 按表返回 Decision——ToolContext 由测试装配（loop 在活体上做同一件事）。

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "henira-tools-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

interface PermissionProbe {
  calls: { tool: string; floor?: "ask"; callId?: string }[];
  /** ToolContext.requestPermission 实现（D-087 起返回对象；字符串数组 = 无反馈的判定） */
  ask(
    next: Decision[],
  ): (req: PermissionRequest, opts?: ApprovalOptions) => Promise<PermissionResult>;
}

function probe(): PermissionProbe {
  const calls: { tool: string; floor?: "ask"; callId?: string }[] = [];
  return {
    calls,
    ask(decisions) {
      return async (req, opts) => {
        calls.push({ tool: req.tool, floor: opts?.floor, callId: req.callId });
        return { decision: decisions.shift() ?? "unavailable" };
      };
    },
  };
}

/** 失败的判定链（缺席语义）：任何请求 → 不可用——loop 装配错误的 fail-closed 形态 */
function brokenPermission(req: PermissionRequest): Promise<PermissionResult> {
  throw new Error(`slot 'approval' missing (requested by ${req.tool})`);
}

function mkToolCtx(
  permission: ToolContext["requestPermission"],
  signal?: AbortSignal,
): ToolContext {
  return {
    cwd: root,
    signal: signal ?? new AbortController().signal,
    requestPermission: permission,
    config: { cwd: root } as ToolContext["config"], // 管线 M2 不消费 config（limits 走插件 options）
  };
}

function makeDeps(ctx: HeniraContext, opts: Partial<PipelineDeps> = {}): PipelineDeps {
  const registry = new ToolRegistry();
  return { registry, events: ctx.events, ...opts };
}

async function started() {
  const harness = createHarness();
  await harness.start();
  return { harness, ctx: harness.context };
}

const readTool = {
  name: "read",
  description: "read",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  isConcurrencySafe: true,
  execute: async () => ({ content: "file body" }),
};
const writeTool = {
  name: "write",
  description: "write",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
  execute: async () => ({ content: "written" }),
};

describe("runOne 五段管线", () => {
  it("正常执行：allow 闸 → 判定链 allowed-once → execute → 权威结果", async () => {
    const { harness, ctx } = await started();
    const p = probe();
    const deps = makeDeps(ctx, {});
    deps.registry.register(readTool);
    const outcome = await runOne(
      { callId: "c1", name: "read", argsText: '{"path":"a"}' },
      mkToolCtx(p.ask(["allowed-once"])),
      deps,
    );
    expect(outcome.result).toEqual({ content: "file body" });
    expect(p.calls).toEqual([{ tool: "read", floor: undefined, callId: "c1" }]); // 判定链必然执行（§2.1）+ 真实 callId（R202）
    await harness.dispose();
  });

  it("parseArgs：非 JSON → 结构化错误；schema 不合规 → 结构化错误（模型重发）", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    deps.registry.register(readTool);
    const toolCtx = mkToolCtx(probe().ask([]));
    const bad1 = await runOne({ callId: "c1", name: "read", argsText: "{截断" }, toolCtx, deps);
    expect(bad1.result.isError).toBe(true);
    expect(bad1.result.content).toContain("[input] arguments are not valid JSON");
    const bad2 = await runOne(
      { callId: "c2", name: "read", argsText: '{"path":123}' },
      toolCtx,
      deps,
    );
    expect(bad2.result.isError).toBe(true);
    expect(bad2.result.content).toContain("[input] arguments failed inputSchema");
    await harness.dispose();
  });

  it("unknown tool → 结构化错误（防幻觉调用，双层防护的执行侧）", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    const outcome = await runOne(
      { callId: "c1", name: "nope", argsText: "{}" },
      mkToolCtx(probe().ask([])),
      deps,
    );
    expect(outcome.result.content).toContain('unknown tool "nope"');
    await harness.dispose();
  });

  it("pre-execute deny：链前拒——不进判定链（无 approval 调用、无审计对）", async () => {
    const { harness, ctx } = await started();
    const p = probe();
    ctx.events.onWaterfall("tools/pre-execute", (value: unknown) => {
      const v = value as { verdict: string };
      return { ...v, verdict: "deny", by: "sandbox", reason: "区外路径" };
    });
    const deps = makeDeps(ctx, {});
    deps.registry.register(writeTool);
    const outcome = await runOne(
      { callId: "c1", name: "write", argsText: "{}" },
      mkToolCtx(p.ask(["allowed-once"])),
      deps,
    );
    expect(outcome.result.isError).toBe(true);
    expect(outcome.result.content).toContain("[denied] sandbox: 区外路径");
    expect(p.calls).toEqual([]); // 链前拒：判定链与审计对不发生
    await harness.dispose();
  });

  it("pre-execute ask：floor=ask 传给判定链（默认放行层不得自动过——机制载体）", async () => {
    const { harness, ctx } = await started();
    const p = probe();
    ctx.events.onWaterfall("tools/pre-execute", (value: unknown) => {
      const v = value as { verdict: string };
      return { ...v, verdict: "ask", by: "sandbox", reason: "要求过目" };
    });
    const deps = makeDeps(ctx, {});
    deps.registry.register(readTool);
    const outcome = await runOne(
      { callId: "c1", name: "read", argsText: "{}" },
      mkToolCtx(p.ask(["allowed-once"])),
      deps,
    );
    expect(outcome.result.content).toBe("file body"); // answerer 放行 → 照常执行
    expect(p.calls).toEqual([{ tool: "read", floor: "ask", callId: "c1" }]);
    await harness.dispose();
  });

  it("判定链拒绝：rejected / unavailable 都拒执行（fail-closed）", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    deps.registry.register(writeTool);
    const outcome = await runOne(
      { callId: "c1", name: "write", argsText: "{}" },
      mkToolCtx(probe().ask(["rejected"])),
      deps,
    );
    expect(outcome.result.content).toContain("[permission:rejected]");
    await harness.dispose();
  });

  it("用户拒绝带说明（D-087）：工具结果给「停下等指示」+ 用户原话；策略拒绝不冒充用户", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    deps.registry.register(writeTool);
    const userDenied = await runOne(
      { callId: "c1", name: "write", argsText: "{}" },
      mkToolCtx(async () => ({
        decision: "rejected",
        deniedBy: "user",
        feedback: "用 pnpm，别用 npm",
      })),
      deps,
    );
    expect(userDenied.result.content).toContain("[permission:rejected]");
    expect(userDenied.result.content).toContain("Stop and wait for the user's instruction");
    expect(userDenied.result.content).toContain("The user said: 用 pnpm，别用 npm");

    const policyDenied = await runOne(
      { callId: "c2", name: "write", argsText: "{}" },
      mkToolCtx(async () => ({ decision: "rejected", deniedBy: "policy" })),
      deps,
    );
    expect(policyDenied.result.content).toBe(
      '[permission:rejected] tool "write" was not permitted',
    );
    await harness.dispose();
  });

  it("判定链缺席（requestPermission 抛错）：fail-closed [unavailable]（P5：缺失即放行不存在）", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    deps.registry.register(readTool);
    const outcome = await runOne(
      { callId: "c1", name: "read", argsText: "{}" },
      mkToolCtx(brokenPermission),
      deps,
    );
    expect(outcome.result.isError).toBe(true);
    expect(outcome.result.content).toContain("[unavailable]");
    await harness.dispose();
  });

  it("未启动即中止 → ABORTED_BEFORE_DISPATCH（不进工具）", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    deps.registry.register(readTool);
    const controller = new AbortController();
    controller.abort();
    const outcome = await runOne(
      { callId: "c1", name: "read", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"]), controller.signal),
      deps,
    );
    expect(outcome.result.content).toContain("[aborted-before-dispatch]");
    await harness.dispose();
  });

  it("已启动后工具抛错：自报错误保留为 isError 结果", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    deps.registry.register({
      ...readTool,
      execute: async () => {
        throw new Error("boom: permission denied by fs");
      },
    });
    const outcome = await runOne(
      { callId: "c1", name: "read", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"])),
      deps,
    );
    expect(outcome.result.isError).toBe(true);
    expect(outcome.result.content).toBe("[error] boom: permission denied by fs");
    await harness.dispose();
  });

  it("超时：竞速后产出超时错误结果", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, { timeoutMs: 30 });
    deps.registry.register({ ...readTool, execute: () => new Promise(() => {}) }); // 永不返回
    const outcome = await runOne(
      { callId: "c1", name: "read", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"])),
      deps,
    );
    expect(outcome.result.isError).toBe(true);
    expect(outcome.result.content).toContain("timeout after 30ms");
    await harness.dispose();
  });

  it("post-execute：监听者可替换结果（检视/附加）", async () => {
    const { harness, ctx } = await started();
    ctx.events.onWaterfall("tools/post-execute", (value: unknown) => {
      const v = value as { outcome: ToolOutcome };
      return {
        ...v,
        outcome: { result: { content: `${v.outcome.result.content}\n[hook] attached` } },
      };
    });
    const deps = makeDeps(ctx, {});
    deps.registry.register(readTool);
    const outcome = await runOne(
      { callId: "c1", name: "read", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"])),
      deps,
    );
    expect(outcome.result.content).toBe("file body\n[hook] attached");
    await harness.dispose();
  });

  it("出口限量 + 落盘：超限结果带截断尾注 + truncated path", async () => {
    const { harness, ctx } = await started();
    const artifacts = path.join(root, "artifacts");
    const deps = makeDeps(ctx, { artifactsDir: artifacts, limits: { maxBytes: 100 } });
    deps.registry.register({ ...readTool, execute: async () => ({ content: "z".repeat(5000) }) });
    const outcome = await runOne(
      { callId: "big1", name: "read", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"])),
      deps,
    );
    expect(outcome.result.content).toContain("[truncated]");
    expect(outcome.result.content).toContain("full output: artifacts/big1.txt");
    expect(outcome.truncated?.path).toBe("artifacts/big1.txt"); // 相对会话目录（R202/D-085）
    await harness.dispose();
  });

  it("meta 尺寸闸（审查 F5）：__meta 超 256KB 整体丢弃；小 meta 原样透传", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    deps.registry.register({
      name: "bigmeta",
      description: "bigmeta",
      inputSchema: { type: "object" },
      isConcurrencySafe: true,
      execute: async () => ({
        content: "ok",
        __meta: { kind: "x", blob: "z".repeat(300 * 1024) },
      }),
    });
    const big = await runOne(
      { callId: "m1", name: "bigmeta", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"])),
      deps,
    );
    expect(big.result.content).toBe("ok");
    expect("meta" in big.result === false && big.result.__meta === undefined).toBe(true);

    deps.registry.register({
      name: "smallmeta",
      description: "smallmeta",
      inputSchema: { type: "object" },
      isConcurrencySafe: true,
      execute: async () => ({ content: "ok", __meta: { kind: "x", n: 1 } }),
    });
    const small = await runOne(
      { callId: "m2", name: "smallmeta", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"])),
      deps,
    );
    expect(small.result.__meta).toEqual({ kind: "x", n: 1 });
    await harness.dispose();
  });

  it("toolsPlugin 经 kernel 公共注册路径装配：register + project + execute 全通（P8）", async () => {
    const harness = createHarness().use(toolsPlugin({}));
    await harness.start();
    const ctx = asHeniraContext(harness.context);
    const tools = ctx.get("tools");
    const dispose = tools.register(readTool);
    expect(tools.project().map((t) => t.name)).toEqual(["read"]);
    dispose();
    expect(tools.project()).toEqual([]);
    const outcome = await tools.execute(
      { callId: "c1", name: "read", argsText: "{}" },
      mkToolCtx(probe().ask(["allowed-once"])),
    );
    // dispose 后 unknown → 结构化错误（公共路径行为一致）
    expect(outcome.result.content).toContain('unknown tool "read"');
    await harness.dispose();
  });
});

describe("runBatch 批执行（isConcurrencySafe 并行、按序回写）", () => {
  it("连续 safe 并行、unsafe 串行隔断；结果按原顺序回写", async () => {
    const { harness, ctx } = await started();
    const deps = makeDeps(ctx, {});
    const started_: string[] = [];
    let concurrent = 0;
    let peak = 0;
    const track = (tag: string, ms: number) => async () => {
      started_.push(tag);
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, ms));
      concurrent -= 1;
      return { content: tag };
    };
    deps.registry.register({ ...readTool, name: "s1", execute: track("s1", 20) });
    deps.registry.register({ ...readTool, name: "s2", execute: track("s2", 5) });
    deps.registry.register({ ...writeTool, name: "w1", execute: track("w1", 5) });
    deps.registry.register({ ...readTool, name: "s3", execute: track("s3", 5) });

    const outcomes = await runBatch(
      [
        { callId: "a", name: "s1", argsText: "{}" },
        { callId: "b", name: "s2", argsText: "{}" },
        { callId: "c", name: "w1", argsText: "{}" },
        { callId: "d", name: "s3", argsText: "{}" },
      ],
      mkToolCtx(probe().ask(["allowed-once", "allowed-once", "allowed-once", "allowed-once"])),
      deps,
    );
    expect(outcomes.map((o) => o.result.content)).toEqual(["s1", "s2", "w1", "s3"]); // 原顺序
    expect(peak).toBe(2); // s1/s2 并行跑过；w1 串行隔断
    expect(started_.indexOf("w1")).toBeGreaterThan(started_.indexOf("s2")); // w1 在 s2 之后启动
    await harness.dispose();
  });
});
