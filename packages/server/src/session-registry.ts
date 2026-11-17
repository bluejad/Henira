// 会话注册表（hosts.md §3：①宿主 = 进程级壳 + 每会话一个 harness 实例，装配每会话执行）。
// 装配三步 M3 实现 ①③（D-016：引擎五件编程装配——与 examples 同一条路径；③ = settings.json
// plugins.<id>.enabled === false 不装载）；②已装插件目录扫描装载随 M4（M3 判据无一条需要）。
// 会话内 session 槽由本宿主装饰组合占据：SessionHandle.append 接进投影器（装配权属宿主
// D-016；引擎与协议零改动）。会话目录按 data-directory §4 命名（projects/<key>/sessions/<id>，
// key 由 cwd 确定性派生——无 projects.json 也能落位，注册表文件随 M4 项目批）。

import { createHash, randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConfigService } from "@henira/config-loader";
import type { ServiceDefinition } from "@henira/kernel";
import { createHarness } from "@henira/kernel";
import { approvalPlugin } from "@henira/plugin-approval";
import { llmPlugin } from "@henira/plugin-llm";
import { loopPlugin } from "@henira/plugin-loop";
import { SESSION_LOG_FILE, type SessionHandle, sessionPlugin } from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import type { LlmService } from "@henira/protocol";
import {
  asHeniraContext,
  type LoopEvent,
  Projection,
  type SessionEvent,
  type SessionSummary,
} from "@henira/protocol";
import type { Fanout } from "./fanout.js";
import { ServerInteraction } from "./interaction-service.js";
import { isPluginEnabled, readSettings } from "./settings-store.js";

export interface SessionEntry {
  id: string;
  cwd: string;
  directory: string;
  harness: ReturnType<typeof createHarness>;
  ctx: ReturnType<typeof asHeniraContext>;
  interaction: ServerInteraction;
  projection: Projection;
  createdAt: number;
}

export interface RegistryOptions {
  /** 运行数据目录（默认 ~/.henira） */
  dataDir: string;
  /** 全局配置目录（默认 ~/.henira/config） */
  globalDir: string;
  /** llm 槽位替换（测试 / demo 注入；默认官方 llmPlugin） */
  llm?: ServiceDefinition<LlmService>;
  fanout: Fanout;
}

/** data-directory §4：平台感知 key 命名（Windows 小写化哈希；目录名只给人看，查找不靠它） */
export function projectKey(cwd: string): string {
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
  const hash8 = createHash("sha256").update(hashSource).digest("hex").slice(0, 8);
  return `--${slug}-${hash8}--`;
}

export class SessionRegistry {
  readonly #entries = new Map<string, SessionEntry>();
  readonly #opts: RegistryOptions;

  constructor(opts: RegistryOptions) {
    this.#opts = opts;
  }

  /** 在订会话（本进程装配的） */
  sessions(): Iterable<SessionEntry> {
    return this.#entries.values();
  }

  get(id: string): SessionEntry | undefined {
    return this.#entries.get(id);
  }

  /** 列表 = 磁盘全扫（含历史会话）∪ 本进程在订（busy 状态仅后者可知） */
  async list(): Promise<SessionSummary[]> {
    const summaries = new Map<string, SessionSummary>();
    const projectsDir = path.join(this.#opts.dataDir, "projects");
    let projectKeys: string[] = [];
    try {
      projectKeys = await fs.readdir(projectsDir);
    } catch {
      // 无 projects 目录 = 尚无任何会话
    }
    for (const key of projectKeys) {
      const sessionsDir = path.join(projectsDir, key, "sessions");
      let ids: string[] = [];
      try {
        ids = await fs.readdir(sessionsDir);
      } catch {
        continue;
      }
      for (const id of ids) {
        const dir = path.join(sessionsDir, id);
        try {
          const header = JSON.parse(
            (await fs.readFile(path.join(dir, SESSION_LOG_FILE), "utf8")).split("\n")[0],
          ) as { id?: string; cwd?: string; createdAt?: number };
          if (header.id === undefined || header.cwd === undefined) continue;
          const stat = await fs.stat(dir).catch(() => undefined);
          summaries.set(header.id, {
            id: header.id,
            cwd: header.cwd,
            updatedAt: stat?.mtimeMs ?? header.createdAt ?? 0,
            busy: false,
          });
        } catch {}
      }
    }
    for (const entry of this.#entries.values()) {
      summaries.set(entry.id, {
        id: entry.id,
        cwd: entry.cwd,
        updatedAt: entry.createdAt,
        busy: entry.projection.state.busy,
      });
    }
    return [...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 装配三步 ①③ + start；返回入口供 REST 路由投递 */
  async create(opts?: { cwd?: string }): Promise<SessionEntry> {
    const cwd = opts?.cwd ?? process.cwd();
    const settings = await readSettings(this.#opts.globalDir);
    // ③：显式 enabled: false 不装载（缺 key = 启用）；内圈引擎件被关 → 照装并告警（hosts.md §3 语义）
    const skip = (id: string): boolean => !isPluginEnabled(settings, id);
    const disabled = [
      "session",
      "tools",
      "llm",
      "approval",
      "loop",
      "interaction",
      "config",
    ].filter(skip);
    if (disabled.length > 0) {
      console.warn(
        `[server] 内圈槽位不可关，settings.plugins 显式停用被忽略：${disabled.join(", ")}`,
      );
    }

    const id = `s-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const directory = path.join(this.#opts.dataDir, "projects", projectKey(cwd), "sessions", id);
    await fs.mkdir(directory, { recursive: true });

    const interaction = new ServerInteraction();
    const projection = new Projection();
    const entry: SessionEntry = {
      id,
      cwd,
      directory,
      harness: undefined as never,
      ctx: undefined as never,
      interaction,
      projection,
      createdAt: Date.now(),
    };

    const onAppend = (event: SessionEvent): void => {
      const deltas = projection.ingest(event);
      this.#opts.fanout.publish(id, deltas);
    };

    const harness = createHarness()
      .use(observedSession(sessionPlugin({ directory, cwd, id }), onAppend))
      .use(toolsPlugin({}))
      .use(this.#opts.llm ?? llmPlugin())
      .use({ name: "interaction", start: () => interaction })
      .use(approvalPlugin())
      .use({
        name: "config",
        start: () => createConfigService({ cwd, globalDir: this.#opts.globalDir }),
      })
      .use(loopPlugin());
    await harness.start();
    entry.harness = harness;
    entry.ctx = asHeniraContext(harness.context);

    // 流式碎片（刻意不落账）经总线进投影：text / reasoning delta 挂当前游标行
    entry.ctx.events.on("loop/event", (payload: unknown) => {
      const event = payload as LoopEvent;
      if (event.type !== "text-delta" && event.type !== "reasoning-delta") return;
      const deltas = projection.applyStreamDelta({
        field: event.type === "text-delta" ? "text" : "reasoning",
        text: event.text,
      });
      this.#opts.fanout.publish(id, deltas);
    });

    this.#entries.set(id, entry);
    this.#announce(entry);
    return entry;
  }

  /** 磁盘会话账本读取（历史会话快照重建用）；找不到 / 读不了返回 undefined */
  async ledgerEvents(id: string): Promise<SessionEvent[] | undefined> {
    const projectsDir = path.join(this.#opts.dataDir, "projects");
    let keys: string[] = [];
    try {
      keys = await fs.readdir(projectsDir);
    } catch {
      return undefined;
    }
    for (const key of keys) {
      const file = path.join(projectsDir, key, "sessions", id, SESSION_LOG_FILE);
      try {
        const lines = (await fs.readFile(file, "utf8")).split("\n").filter((l) => l.trim() !== "");
        return lines.slice(1).map((line) => JSON.parse(line) as SessionEvent);
      } catch {}
    }
    return undefined;
  }

  /** 全部会话收尾（server stop）：harness dispose（各插件 stop：锁/句柄）+ 挂起审批 cancelled 收口 */
  async disposeAll(): Promise<void> {
    for (const entry of [...this.#entries.values()]) {
      entry.interaction.dispose();
      await entry.harness.dispose().catch(() => {});
      this.#entries.delete(entry.id);
    }
  }

  /** 新会话上线：向全部在订者推快照帧（新会话投影尚空——快照即"已出现"信号） */
  #announce(entry: SessionEntry): void {
    this.#opts.fanout.deliverSnapshot(
      entry.id,
      entry.projection.snapshot(entry.id, this.#opts.fanout.currentSeq(entry.id)),
    );
  }
}

/** 宿主装饰组合：session 槽位由本定义占据，append 旁路喂投影器（引擎零改动） */
function observedSession(
  real: ServiceDefinition<SessionHandle>,
  onAppend: (event: SessionEvent) => void,
): ServiceDefinition<SessionHandle> {
  return {
    name: "session",
    async start(ctx) {
      const handle = await real.start(ctx);
      if (handle === undefined || handle === null) {
        throw new Error("session plugin returned no handle");
      }
      const observed: SessionHandle = {
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
      return observed;
    },
    async stop(svc) {
      await real.stop?.(svc); // 文件锁与句柄照常释放
    },
  };
}

/** 本包版本（server.json / connected 帧）；读不到 = 0.0.0 */
export function serverVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(path.join(here, "../package.json"), "utf8")) as {
      version?: string;
    };
    return manifest.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
