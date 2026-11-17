// 形态一：进程内 runtime（③零服务——hosts.md §1：无 server、无端口、一次性任务 / 嵌入）。
// 装配三步 ①③（引擎五件编程聚合 + settings.plugins enabled 过滤——与 examples / server 同一
// 语义）；InteractionService 缺省 = fail-closed 自动拒（没人应答一律拒，packages.md 槽位归属），
// 嵌入方可整只替换。不写 server.json、不开端口——宿主职责到此为止。

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConfigService } from "@henira/config-loader";
import type { ServiceDefinition } from "@henira/kernel";
import { createHarness } from "@henira/kernel";
import { approvalPlugin } from "@henira/plugin-approval";
import { llmPlugin } from "@henira/plugin-llm";
import { loopPlugin } from "@henira/plugin-loop";
import { type SessionHandle, sessionPlugin } from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import {
  asHeniraContext,
  type Delta,
  type InteractionAnswer,
  type InteractionRequest,
  type InteractionService,
  type LlmService,
  type LoopEvent,
  Projection,
  type ServerFrame,
  type SessionEvent,
  type SessionSummary,
} from "@henira/protocol";
import { frameQueue, type HeniraFacade } from "./facade.js";
import { isPluginEnabled, readSettings } from "./settings.js";

export interface RuntimeOptions {
  /** 运行数据目录（默认 ~/.henira；测试 / 多实例隔离用 HENIRA_HOME 语义） */
  dataDir?: string;
  /** 全局配置目录（默认 ~/.henira/config） */
  globalDir?: string;
  /** InteractionService 整只替换（嵌入方接自己的交互面；缺省 fail-closed 自动拒） */
  interaction?: ServiceDefinition<InteractionService>;
  /** llm 槽位替换（测试 / demo；默认官方 llmPlugin） */
  llm?: ServiceDefinition<LlmService>;
  /** 工具注册（嵌入方组合面——每个新建会话注册；缺省空） */
  tools?: readonly import("@henira/protocol").ToolDefinition[];
}

interface RuntimeSession {
  id: string;
  cwd: string;
  summary: SessionSummary;
  harness: ReturnType<typeof createHarness>;
  ctx: ReturnType<typeof asHeniraContext>;
  projection: Projection;
}

/** 缺省 fail-closed InteractionService：ask 即拒（嵌入方没人应答时引擎不能挂死） */
export function autoRejectInteraction(): ServiceDefinition<InteractionService> {
  return {
    name: "interaction",
    start(): InteractionService {
      return {
        ask: (req: InteractionRequest) =>
          Promise.resolve({
            kind: "approval",
            requestId: req.requestId,
            decision: "rejected",
          } satisfies InteractionAnswer),
        settle: () => false,
        listPending: (): readonly InteractionRequest[] => [],
      };
    },
  };
}

export async function createRuntime(opts: RuntimeOptions = {}): Promise<HeniraFacade> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".henira");
  const globalDir = opts.globalDir ?? path.join(dataDir, "config");
  const settings = await readSettings(globalDir);
  const disabled = ["session", "tools", "llm", "approval", "loop", "interaction", "config"].filter(
    (id) => !isPluginEnabled(settings, id),
  );
  if (disabled.length > 0) {
    console.warn(`[sdk] 内圈槽位不可关，settings.plugins 显式停用被忽略：${disabled.join(", ")}`);
  }

  const sessions = new Map<string, RuntimeSession>();
  const queues = new Map<object, ReturnType<typeof frameQueue>>();
  const seq = new Map<string, number>();
  const currentSeq = (sessionId: string): number => seq.get(sessionId) ?? 0;
  const deliver = (frame: ServerFrame): void => {
    for (const queue of queues.values()) queue.push(frame);
  };
  const publish = (sessionId: string, deltas: readonly Delta[]): void => {
    for (const delta of deltas) {
      const next = currentSeq(sessionId) + 1;
      seq.set(sessionId, next);
      deliver({ kind: "delta", sessionId, seq: next, delta });
    }
  };

  const facade: HeniraFacade = {
    async createSession(sessionOpts) {
      const cwd = sessionOpts?.cwd ?? process.cwd();
      const id = `s-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
      const directory = path.join(dataDir, "projects", projectKey(cwd), "sessions", id);
      await fs.mkdir(directory, { recursive: true });

      const projection = new Projection();
      const session: RuntimeSession = {
        id,
        cwd,
        summary: { id, cwd, updatedAt: Date.now(), busy: false },
        harness: undefined as never,
        ctx: undefined as never,
        projection,
      };
      const onAppend = (event: SessionEvent): void => {
        publish(id, projection.ingest(event));
      };
      const harness = createHarness()
        .use(observedSession(sessionPlugin({ directory, cwd, id }), onAppend))
        .use(toolsPlugin({}))
        .use(opts.llm ?? llmPlugin())
        .use(opts.interaction ?? autoRejectInteraction())
        .use(approvalPlugin())
        .use({ name: "config", start: () => createConfigService({ cwd, globalDir }) })
        .use(loopPlugin());
      await harness.start();
      session.harness = harness;
      session.ctx = asHeniraContext(harness.context);
      for (const tool of opts.tools ?? []) {
        session.ctx.get("tools").register(tool);
      }
      // 流式碎片（刻意不落账）经总线进投影：text / reasoning delta 挂当前游标行
      session.ctx.events.on("loop/event", (payload: unknown) => {
        const event = payload as LoopEvent;
        if (event.type !== "text-delta" && event.type !== "reasoning-delta") return;
        publish(
          id,
          projection.applyStreamDelta({
            field: event.type === "text-delta" ? "text" : "reasoning",
            text: event.text,
          }),
        );
      });
      sessions.set(id, session);
      deliver({
        kind: "snapshot",
        sessionId: id,
        snapshot: projection.snapshot(id, currentSeq(id)),
      });
      return { ...session.summary };
    },

    async listSessions() {
      return [...sessions.values()].map((s) => ({ ...s.summary, busy: s.projection.state.busy }));
    },

    async prompt(sessionId, text) {
      const receipt = await requireSession(sessions, sessionId).ctx.get("loop").send(text);
      return { queued: receipt.id !== "", id: receipt.id === "" ? null : receipt.id };
    },

    async steer(sessionId, entryId) {
      return requireSession(sessions, sessionId).ctx.get("loop").steer(entryId);
    },

    async interrupt(sessionId) {
      await requireSession(sessions, sessionId).ctx.get("loop").interrupt();
    },

    async settleApproval(sessionId, requestId, decision) {
      const session = requireSession(sessions, sessionId);
      return session.ctx
        .get("interaction")
        .settle(requestId, { kind: "approval", requestId, decision });
    },

    async snapshot(sessionId) {
      const session = requireSession(sessions, sessionId);
      return session.projection.snapshot(sessionId, currentSeq(sessionId));
    },

    async *events() {
      const queue = frameQueue();
      const key = {};
      queues.set(key, queue);
      try {
        yield { kind: "connected", server: { version: "sdk-runtime", startedAt: Date.now() } };
        for (const session of sessions.values()) {
          yield {
            kind: "snapshot",
            sessionId: session.id,
            snapshot: session.projection.snapshot(session.id, currentSeq(session.id)),
          };
        }
        yield* queue.stream();
      } finally {
        queues.delete(key);
      }
    },

    async stop() {
      for (const session of [...sessions.values()]) {
        await session.harness.dispose().catch(() => {});
        sessions.delete(session.id);
      }
    },
  };
  return facade;
}

function requireSession(sessions: Map<string, RuntimeSession>, id: string): RuntimeSession {
  const session = sessions.get(id);
  if (session === undefined) throw new Error(`session not found: ${id}`);
  return session;
}

/** 宿主装饰组合：append 旁路喂投影器（与 server 同一语义——引擎零改动） */
function observedSession(
  real: ServiceDefinition<SessionHandle>,
  onAppend: (event: SessionEvent) => void,
): ServiceDefinition<SessionHandle> {
  return {
    name: "session",
    async start(ctx) {
      const handle = await real.start(ctx);
      if (handle === undefined || handle === null)
        throw new Error("session plugin returned no handle");
      return {
        header: () => handle.header(),
        directory: handle.directory,
        append: async (input) => {
          const event = await handle.append(input);
          onAppend(event);
          return event;
        },
        events: () => handle.events(),
        deriveMessages: () => handle.deriveMessages(),
        fork: async (atSeq) => handle.fork(atSeq),
        replay: async (visitor) => handle.replay(visitor),
        close: () => handle.close(),
      };
    },
    async stop(svc) {
      await real.stop?.(svc);
    },
  };
}

/** data-directory §4 项目 key（与 server 同式；两宿主各自实现，规则 3 禁宿主互依） */
function projectKey(cwd: string): string {
  const canonical = cwd
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/[:*"<>|?]/g, "_");
  const slug =
    canonical
      .replace(/\//g, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || "root";
  const hashSource = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return `--${slug}-${createHash("sha256").update(hashSource).digest("hex").slice(0, 8)}--`;
}
