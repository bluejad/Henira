// 形态一：进程内 runtime（③零服务——hosts.md §1：无 server、无端口、一次性任务 / 嵌入）。
// 装配三步 ①③（引擎五件编程聚合 + settings.plugins enabled 过滤——与 examples / server 同一
// 语义）；InteractionService 缺省 = fail-closed 自动拒（没人应答一律拒，packages.md 槽位归属），
// 嵌入方可整只替换。不写 server.json、不开端口——宿主职责到此为止。

import { createHash, randomBytes } from "node:crypto";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConfigService,
  Dictionary,
  defaultPreset,
  expandMcpServers,
  type PluginEntry,
  type PluginSettingsEntry,
  type PluginState,
  type PrepareResult,
  parseResourceAddress,
  preparePlugins,
  SNAPSHOT,
  scanUiAssets,
  scrubSpawnEnv,
} from "@henira/config-loader";
import type { ServiceDefinition } from "@henira/kernel";
import { createHarness } from "@henira/kernel";
import { approvalPlugin } from "@henira/plugin-approval";
import { askUserPlugin } from "@henira/plugin-ask-user";
import { breakerPlugin } from "@henira/plugin-breaker";
import { fsPlugin } from "@henira/plugin-fs";
import { fsSearchPlugin } from "@henira/plugin-fs-search";
import { fsToolsPlugin } from "@henira/plugin-fs-tools";
import { llmPlugin } from "@henira/plugin-llm";
import { loopPlugin } from "@henira/plugin-loop";
import { mcpPlugin } from "@henira/plugin-mcp";
import {
  atomicWriteFile,
  browseDirectories,
  DirRegistry,
  forkSession,
  projectKey,
  type SessionHandle,
  sameCwd,
  sessionPlugin,
} from "@henira/plugin-session";
import { shellPlugin } from "@henira/plugin-shell";
import { shellToolsPlugin } from "@henira/plugin-shell-tools";
import { toolsPlugin } from "@henira/plugin-tools";
import {
  asHeniraContext,
  type Delta,
  deriveSessionTitle,
  type GlobalUiState,
  type InteractionAnswer,
  type InteractionRequest,
  type InteractionService,
  type LlmService,
  type LoopEvent,
  looksBinary,
  Projection,
  type QueuedPrompt,
  type ResourceReply,
  reasoningCapability,
  type ServerFrame,
  type SessionEvent,
  type SessionState,
  type SessionSummary,
  type SessionUiState,
  sliceRowsPage,
  WORKSPACE_FILE_MAX_BYTES,
  type WorkspaceFileContent,
} from "@henira/protocol";
import {
  type CustomProviderInput,
  frameQueue,
  type HeniraFacade,
  type ModelCatalog,
  type ProviderModelEntry,
} from "./facade.js";
import {
  isPluginEnabled,
  listCredentialProviders,
  type ModelsFile,
  readCredentialValues,
  readModelsFile,
  readSettings,
  removeCredential,
  setPluginSetting,
  writeCredential,
  writeModelsFile,
  writeSettings,
} from "./settings.js";

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
  /** 基础插件清单（henira.config.ts 的 plugins；非空 = 听它的，空/缺省 = 出厂清单。
   *  条目 definition 在场 = 替换该官方件的实现；目录件由 preparePlugins 发现追加） */
  plugins?: readonly PluginEntry[];
}

/** 官方五件 id：不给关/不给版本钉/不可卸载（§5 :222 / §6.4） */
const OFFICIAL_PLUGIN_IDS = new Set([
  "plugin-session",
  "plugin-tools",
  "plugin-llm",
  "plugin-approval",
  "plugin-loop",
]);

const CORE_SLOT_NAMES = new Set([
  "session",
  "tools",
  "llm",
  "approval",
  "loop",
  "interaction",
  "config",
  "mcp",
  "fs",
  "shell",
]);

/** 官方清单条目 → 内置工厂（与 server #builtinDefinition 同构；llm 替换经入参传递） */
function builtinDefinition(
  entry: PluginEntry,
  ctx: {
    id: string;
    cwd: string;
    directory: string;
    onAppend: (event: SessionEvent) => void;
    mcpServers: import("@henira/protocol").McpServerSpec[];
  },
  llmOverride?: ServiceDefinition<LlmService>,
): ServiceDefinition<unknown> | undefined {
  switch (entry.id) {
    case "plugin-session":
      if (entry.definition !== undefined) {
        console.warn(
          "[sdk] 插件：v1 不支持替换 session 槽（宿主投影链要求官方包装，D-048 挂账）——按官方实现装载",
        );
      }
      return observedSession(
        sessionPlugin({ directory: ctx.directory, cwd: ctx.cwd, id: ctx.id }),
        ctx.onAppend,
      );
    case "plugin-tools":
      return entry.definition ?? toolsPlugin({});
    case "plugin-llm":
      return entry.definition ?? llmOverride ?? llmPlugin();
    case "plugin-approval":
      return entry.definition ?? approvalPlugin();
    case "plugin-loop":
      return entry.definition ?? loopPlugin();
    case "plugin-fs":
      return entry.definition ?? fsPlugin();
    case "plugin-fs-tools":
      return entry.definition ?? fsToolsPlugin();
    case "plugin-fs-search":
      return entry.definition ?? fsSearchPlugin();
    case "plugin-shell":
      return entry.definition ?? shellPlugin();
    case "plugin-shell-tools":
      return entry.definition ?? shellToolsPlugin();
    case "plugin-breaker":
      return entry.definition ?? breakerPlugin();
    case "plugin-ask-user":
      return entry.definition ?? askUserPlugin();
    case "plugin-mcp":
      // 外圈读者（D-064）：与 server 同构——servers 空也装配（McpService 恒在场）
      return (
        entry.definition ??
        mcpPlugin({
          servers: ctx.mcpServers,
          spawnEnv: scrubSpawnEnv(),
          warn: (message) => console.warn(`[sdk] MCP：${message}`),
        })
      );
    default:
      if (entry.definition !== undefined) return entry.definition;
      console.warn(`[sdk] 插件：清单条目 "${entry.id}" 无 definition——跳过`);
      return undefined;
  }
}

/** useResource 数据泵单跳的截断上限（plugins.md §4：200 × 1024 字符；与 server 同值） */
const RESOURCE_MAX_CHARS = 200 * 1024;

/** 投影态并入队列活态（排队卡数据源；与 server session-registry #stateWithQueue 同构）：
 *  state.updated 键级整体替换语义要求发布/快照载荷都带全量队列，否则 busy 翻转抹掉客户端
 *  queue 键。loop 不在册（自定义清单无 loop——get 缺槽抛 MissingSlotError）→ queue 键缺省 */
function stateWithQueue(state: SessionState, ctx: unknown): SessionState {
  let pending: QueuedPrompt[] | undefined;
  let paused: boolean | undefined;
  try {
    const loop = (
      ctx as { get(slot: "loop"): { pending(): QueuedPrompt[]; paused(): boolean } } | undefined
    )?.get("loop");
    pending = loop?.pending();
    paused = loop?.paused();
  } catch {
    pending = undefined; // 清单没列 loop = 听清单的（无队列面）
  }
  if (pending === undefined) return { ...state };
  return {
    ...state,
    queue: pending.map(({ id, text, steer, modelId, reasoningEffort }) => ({
      id,
      text,
      steer,
      modelId,
      reasoningEffort,
    })),
    queuePaused: paused === true ? true : undefined,
  };
}

/** MCP 声明 → 工厂入参（config-loader 共享展开；凭据值表进程内读——D-030 值只进内存） */
async function prepareMcpSpecs(
  prepared: PrepareResult,
  cwd: string,
  globalDir: string,
): Promise<import("@henira/protocol").McpServerSpec[]> {
  if (prepared.mcpServers.length === 0) return [];
  const credentials = await readCredentialValues(globalDir);
  return expandMcpServers({
    decls: prepared.mcpServers,
    cwd,
    credentials,
    warn: (message) => console.warn(`[sdk] MCP：${message}`),
  });
}

/** 包入口解析（import 条件——@henira/* 的 exports 只声明 import）：优先 import.meta.resolve，
 *  兜底按 monorepo 相对布局（src 与 dist 两种运行位置的层级一致） */
function resolvePackageEntry(name: string, fallbackRel: string): string {
  try {
    const resolved = (import.meta as { resolve?: (specifier: string) => string }).resolve?.(name);
    if (typeof resolved === "string" && resolved.startsWith("file:")) {
      return fileURLToPath(resolved);
    }
  } catch {
    // 环境不支持 / 解析失败 → 走布局兜底
  }
  return fileURLToPath(new URL(fallbackRel, import.meta.url));
}

/** 引擎件别名（§4 硬规矩 Node 侧）：@henira/kernel / @henira/protocol → 宿主唯一实例 */
function engineAlias(): Record<string, string> {
  return {
    "@henira/kernel": resolvePackageEntry("@henira/kernel", "../../kernel/dist/index.js"),
    "@henira/protocol": resolvePackageEntry("@henira/protocol", "../../protocol/dist/index.js"),
  };
}

/** 引擎兼容门的主机版本（sdk 发布版本；读不到 = 0.0.0） */
function sdkVersion(): string {
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

/** 装配前置（与 server 同语义，双形态测试锁）：扫描 → settings 过滤 → 确认门 → 装载 → 预检 */
async function prepareRuntimePlugins(dataDir: string, globalDir: string): Promise<PrepareResult> {
  const settings = await readSettings(globalDir);
  return preparePlugins({
    pluginRoot: path.join(dataDir, "plugins"),
    settings: settings as { plugins?: Record<string, PluginSettingsEntry> } | undefined,
    engineAlias: engineAlias(),
    hostVersion: sdkVersion(),
  });
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
          Promise.resolve(
            (req.kind === "approval"
              ? { kind: "approval", requestId: req.requestId, decision: "rejected" }
              : {
                  kind: "question",
                  requestId: req.requestId,
                  cancelled: true,
                }) satisfies InteractionAnswer,
          ),
        settle: () => false,
        listPending: (): readonly InteractionRequest[] => [],
      };
    },
  };
}

// ── 模型管理数据层（与 server app.ts 同构；规则 3 禁宿主互依——各自实现）──

/** 单厂商模型条目（含开关态）：快照全表 ∪ 显式 models，hidden = 关 */
function runtimeModelEntries(id: string, modelsFile: ModelsFile): ProviderModelEntry[] {
  const override = modelsFile.providers?.[id];
  const dict = SNAPSHOT[id];
  const explicit = Object.keys(override?.models ?? {});
  const all =
    dict === undefined ? explicit : [...new Set([...explicit, ...Object.keys(dict.models)])];
  const hidden = new Set(override?.hidden ?? []);
  return all.map((model) => {
    const sm = dict?.models[model];
    return {
      id: model,
      name: override?.models?.[model]?.label ?? sm?.name,
      contextWindow: sm?.contextWindow,
      ...(sm?.vision === true ? { vision: true } : {}),
      ...(sm?.reasoning === true ? { reasoning: true } : {}),
      ...(sm?.reasoningOptions !== undefined ? { reasoningOptions: sm.reasoningOptions } : {}),
      enabled: !hidden.has(model),
    };
  });
}

/** 厂商全集（credentials.json 在册 ∪ models.json 在册） */
async function runtimeProviderUnion(
  globalDir: string,
): Promise<{ credIds: string[]; ids: string[]; modelsFile: ModelsFile }> {
  const [credIds, modelsFile] = await Promise.all([
    listCredentialProviders(globalDir),
    readModelsFile(globalDir),
  ]);
  return {
    credIds,
    ids: [...new Set([...credIds, ...Object.keys(modelsFile.providers ?? {})])],
    modelsFile,
  };
}

export async function createRuntime(opts: RuntimeOptions = {}): Promise<HeniraFacade> {
  const dataDir = opts.dataDir ?? process.env.HENIRA_HOME ?? path.join(os.homedir(), ".henira");
  const globalDir = opts.globalDir ?? process.env.HENIRA_CONFIG_DIR ?? path.join(dataDir, "config");
  const settings = await readSettings(globalDir);
  const disabled = ["session", "tools", "llm", "approval", "loop", "interaction", "config"].filter(
    (id) => !isPluginEnabled(settings, id),
  );
  if (disabled.length > 0) {
    console.warn(`[sdk] 内圈槽位不可关，settings.plugins 显式停用被忽略：${disabled.join(", ")}`);
  }

  const sessions = new Map<string, RuntimeSession>();
  /** 基础清单解析（§5 三步①）：官方 id → 内置工厂（definition 在场 = 替换实现；
   *  session 槽 v1 只允许官方包装——宿主投影链要求，D-048 挂账） */
  const baseDefinitions = (ctx: {
    id: string;
    cwd: string;
    directory: string;
    onAppend: (event: SessionEvent) => void;
    /** 已确认且凭据已展开的 MCP server 声明（plugin-mcp 工厂入参；D-064） */
    mcpServers: import("@henira/protocol").McpServerSpec[];
    /** 官方 preset 条目是否启用（settings.plugins.<id>.enabled；内圈五件受保护不受影响） */
    isPresetEntryEnabled: (id: string) => boolean;
  }): ServiceDefinition<unknown>[] => {
    const configured = opts.plugins;
    const entries = configured !== undefined && configured.length > 0 ? configured : defaultPreset;
    const usingPreset = entries === defaultPreset;
    const out: { id: string; def: ServiceDefinition<unknown> }[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      // 外圈官方件停用真生效（D-064：plugin-mcp 可停用）；内圈五件照旧保护——关也装
      if (
        usingPreset &&
        !OFFICIAL_PLUGIN_IDS.has(entry.id) &&
        !ctx.isPresetEntryEnabled(entry.id)
      ) {
        continue;
      }
      const built = builtinDefinition(entry, ctx, opts.llm);
      if (built !== undefined) out.push({ id: entry.id, def: built });
    }
    // D-049 装配层预检（官方 preset 条目同规，目录件已在 preparePlugins 做过）：
    // 声明注入的槽位无提供者 → 该件不装载 + 告警，不挡其他件（kernel start() 是最后防线）
    const provided = new Set<string>(["interaction", "config"]); // createSession 随后挂载的宿主槽
    for (const item of out) {
      if (item.def.name !== undefined) provided.add(item.def.name);
    }
    const defs: ServiceDefinition<unknown>[] = [];
    for (const item of out) {
      const missing = (item.def.inject ?? []).filter((slot) => !provided.has(slot));
      if (missing.length > 0) {
        console.warn(`[sdk] 插件：${item.id} 注入的槽位无提供者（${missing.join(", ")}）——不装载`);
        continue;
      }
      defs.push(item.def);
    }
    return defs;
  };
  const dirs = new DirRegistry({ dataDir });
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

  /** 会话目录定位（ui-state 等会话文件读写用）：在册取推导路径，历史会话扫盘（删除同款语义） */
  const resolveSessionDir = async (id: string): Promise<string | undefined> => {
    const session = sessions.get(id);
    if (session !== undefined) {
      return path.join(dataDir, "projects", projectKey(session.cwd), "sessions", id);
    }
    return findSessionDir(dataDir, id);
  };

  /** 共享装配（create 新建 / fork 复制同一条路，E4）：投影 + 引擎七件 + 宿主两件 + 总线
   *  订阅 + 在册 + 目录登记 + 上线快照帧——fork 子会话与新建完全同构。 */
  const mountRuntimeSession = async (input: {
    id: string;
    cwd: string;
    directory: string;
  }): Promise<RuntimeSession> => {
    const { id, cwd, directory } = input;
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
      // 活动时间真源 = 账本追加（列表排序用；旧实现停在建会话时刻——R188 审查 P2）
      session.summary.updatedAt = Date.now();
      const deltas = projection
        .ingest(event)
        .map((d): typeof d =>
          d.op === "state.updated"
            ? { op: "state.updated", state: stateWithQueue(d.state, session.ctx) }
            : d,
        );
      publish(id, deltas);
    };
    // 装配三步（§5：①基础清单 ②目录件 ③enabled 由 prepare 过滤）+ 宿主两件
    const preparedNow = await prepareRuntimePlugins(dataDir, globalDir);
    const mcpServers = await prepareMcpSpecs(preparedNow, cwd, globalDir);
    const settingsNow = await readSettings(globalDir);
    const harness = createHarness();
    for (const definition of baseDefinitions({
      id,
      cwd,
      directory,
      onAppend,
      mcpServers,
      isPresetEntryEnabled: (entryId) => isPluginEnabled(settingsNow, entryId),
    })) {
      harness.use(definition);
    }
    harness.use(opts.interaction ?? autoRejectInteraction());
    harness.use({ name: "config", start: () => createConfigService({ cwd, globalDir }) });
    for (const item of preparedNow.definitions) {
      const definition = item.definition as { name?: string; start?: unknown };
      if (typeof definition.start !== "function") {
        console.warn(`[sdk] 插件：${item.id} 的 definition 形状非法——跳过`);
        continue;
      }
      if (definition.name !== undefined && CORE_SLOT_NAMES.has(definition.name)) {
        console.warn(
          `[sdk] 插件：${item.id} 占用内圈槽位 "${definition.name}"——跳过（§7.1 撞内圈不装载）`,
        );
        continue;
      }
      harness.use(item.definition as ServiceDefinition<unknown>);
    }
    await harness.start();
    session.harness = harness;
    session.ctx = asHeniraContext(harness.context);
    for (const tool of opts.tools ?? []) {
      session.ctx.get("tools").register(tool);
    }
    // 投影补账（server #attach 同款）：装配后的装载不走 onAppend——从账本重放补历史行
    // （fork 子会话带前缀；新建空账本 = 零事件 no-op）
    for (const event of session.ctx.get("session").events()) session.projection.ingest(event);
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
    // 队列变更（入队/升格/删除/claim/冲刷）→ state.updated 推排队卡数据（非账本通道）
    session.ctx.events.on("queue/changed", () => {
      publish(id, [
        {
          op: "state.updated",
          state: stateWithQueue(projection.state, session.ctx),
        },
      ]);
    });
    sessions.set(id, session);
    await dirs.upsert(cwd, id); // 带目录建会话 = 自动登记（与 server 同一语义）
    deliver({
      kind: "snapshot",
      sessionId: id,
      snapshot: {
        ...projection.snapshot(id, currentSeq(id)),
        state: stateWithQueue(projection.state, session.ctx),
      },
    });
    deliver({ kind: "sessions.changed" }); // 列表事实变（R176；与 server 同形）
    return session;
  };

  const facade: HeniraFacade = {
    async createSession(sessionOpts) {
      const cwd = sessionOpts?.cwd ?? process.cwd();
      if (!isAbsoluteCwd(cwd)) throw new Error("cwd must be an absolute path");
      const id = `s-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
      const directory = path.join(dataDir, "projects", projectKey(cwd), "sessions", id);
      await fs.mkdir(directory, { recursive: true });
      const session = await mountRuntimeSession({ id, cwd, directory });
      return { ...session.summary };
    },

    async listSessions() {
      return [...sessions.values()].map((s) => {
        const title = s.summary.title ?? deriveSessionTitle(s.projection.rows);
        return {
          ...s.summary,
          ...(title !== undefined ? { title } : {}),
          busy: s.projection.state.busy,
        };
      });
    },

    async prompt(sessionId, text, opts) {
      const session = requireSession(sessions, sessionId);
      // 入队即活动：忙时排队不立即落账，onAppend 摸不到——先摸一次（列表排序真源）
      session.summary.updatedAt = Date.now();
      const receipt = await session.ctx.get("loop").send(text, {
        steer: (opts as { steer?: boolean } | undefined)?.steer,
        modelId: opts?.modelId,
        reasoningEffort: opts?.reasoningEffort,
      });
      return { queued: receipt.id !== "", id: receipt.id === "" ? null : receipt.id };
    },

    async steer(sessionId, entryId) {
      return requireSession(sessions, sessionId).ctx.get("loop").steer(entryId);
    },

    async promoteQueueEntry(sessionId, entryId) {
      return requireSession(sessions, sessionId).ctx.get("loop").promote(entryId);
    },

    async removeQueueEntry(sessionId, entryId) {
      return requireSession(sessions, sessionId).ctx.get("loop").remove(entryId);
    },

    async resumeQueue(sessionId) {
      return requireSession(sessions, sessionId).ctx.get("loop").resume();
    },

    async interrupt(sessionId) {
      await requireSession(sessions, sessionId).ctx.get("loop").interrupt();
    },

    async fork(sessionId, atSeq) {
      const source = requireSession(sessions, sessionId);
      const sessionService = source.ctx.get("session");
      const store = await forkSession({
        sourceDir: path.join(dataDir, "projects", projectKey(source.cwd), "sessions", sessionId),
        sourceHeader: sessionService.header(),
        sourceEvents: sessionService.events(),
        atSeq,
      });
      const childId = store.header.id;
      const childCwd = store.header.cwd;
      const childDirectory = store.directory;
      await store.close(); // 子锁释放后交共享装配（与新建同所有权——先 close 再 mount）
      await mountRuntimeSession({ id: childId, cwd: childCwd, directory: childDirectory });
      return childId;
    },

    async settleApproval(sessionId, requestId, decision, scope) {
      const session = requireSession(sessions, sessionId);
      return session.ctx.get("interaction").settle(requestId, {
        kind: "approval",
        requestId,
        decision,
        ...(scope !== undefined ? { scope } : {}),
      });
    },

    async settleQuestion(sessionId, requestId, answer) {
      const session = requireSession(sessions, sessionId);
      return session.ctx
        .get("interaction")
        .settle(
          requestId,
          Array.isArray(answer)
            ? { kind: "question", requestId, answers: answer }
            : { kind: "question", requestId, cancelled: true },
        );
    },

    async getSettings() {
      const s = await readSettings(globalDir);
      return { version: 1, model: s?.model, ui: s?.ui };
    },

    async putSettings(patch) {
      const next = await writeSettings(globalDir, patch);
      return { version: 1, model: next.model, ui: next.ui };
    },

    async listModels() {
      // 闸门与条目形状与 server 同构（模型目录收敛批）：key + baseUrl 齐备才可选，
      // 条目带显示名/上下文窗/徽章位
      const { credIds, modelsFile } = await runtimeProviderUnion(globalDir);
      const providers: { providers: ModelCatalog["providers"] } = { providers: {} };
      for (const id of new Set([...credIds, ...Object.keys(modelsFile.providers ?? {})])) {
        const entry = modelsFile.providers?.[id];
        // 闸门与 server 同构：缺地址不可选；已知厂商需 key 在册；自定义厂商 key 可选
        if (entry?.baseUrl === undefined) continue;
        if (!credIds.includes(id) && SNAPSHOT[id] !== undefined) continue;
        const baseUrl = entry.baseUrl;
        providers.providers[id] = {
          name: entry.label ?? SNAPSHOT[id]?.name, // 与 server 同口径：label 优先（收敛批审查 2026-11-19）
          baseUrl,
          reasoning: reasoningCapability(id),
          models: runtimeModelEntries(id, modelsFile)
            .filter((m) => m.enabled)
            .map((m) => ({
              id: m.id,
              name: m.name,
              contextWindow: m.contextWindow,
              vision: m.vision,
              reasoning: m.reasoning,
              reasoningOptions: m.reasoningOptions,
            })),
        };
      }
      return providers;
    },

    async listProviders() {
      const { credIds, ids, modelsFile } = await runtimeProviderUnion(globalDir);
      const list = ids.map((id) => {
        const dict = SNAPSHOT[id];
        const override = modelsFile.providers?.[id];
        return {
          id,
          name: override?.label ?? dict?.name ?? id,
          baseUrl: override?.baseUrl,
          connected:
            credIds.includes(id) ||
            (dict === undefined && modelsFile.providers?.[id] !== undefined),
          models: runtimeModelEntries(id, modelsFile),
        };
      });
      list.sort(
        (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
      );
      return { providers: list };
    },

    async listModelPresets() {
      const dict = new Dictionary(globalDir);
      await dict.loadCache();
      const presets: Record<
        string,
        { name?: string; models: Record<string, { name?: string; contextWindow?: number }> }
      > = {};
      for (const [id, p] of Object.entries(dict.entries())) {
        presets[id] = {
          name: p.name,
          models: Object.fromEntries(
            Object.entries(p.models).map(([mid, m]) => [
              mid,
              { name: m.name, contextWindow: m.contextWindow },
            ]),
          ),
        };
      }
      return { presets };
    },

    async refreshModelPresets() {
      return { ok: await new Dictionary(globalDir, fetch).refresh() };
    },

    async connectProvider(providerId, key) {
      await writeCredential(globalDir, providerId, key);
      // 目录种子（与 server connect 同构）：已知厂商缺 baseUrl 时从快照 endpoint 补
      const modelsFile = await readModelsFile(globalDir);
      const entry = modelsFile.providers?.[providerId] ?? {};
      const endpoint = SNAPSHOT[providerId]?.endpoint;
      if (entry.baseUrl === undefined && endpoint !== undefined) {
        await writeModelsFile(globalDir, {
          ...modelsFile,
          providers: {
            ...(modelsFile.providers ?? {}),
            [providerId]: { ...entry, baseUrl: endpoint },
          },
        });
      }
    },

    async disconnectProvider(providerId) {
      await removeCredential(globalDir, providerId);
      // 分档（与 server disconnect 同构）：已知厂商只清显隐——baseUrl/label 永不碰；
      // 自定义厂商整条删
      const modelsFile = await readModelsFile(globalDir);
      if (modelsFile.providers?.[providerId] !== undefined) {
        const providers = { ...modelsFile.providers };
        if (SNAPSHOT[providerId] === undefined) {
          delete providers[providerId];
        } else {
          const rest = { ...providers[providerId] };
          delete rest.hidden;
          if (Object.keys(rest).length === 0) delete providers[providerId];
          else providers[providerId] = rest;
        }
        await writeModelsFile(globalDir, { ...modelsFile, providers });
      }
    },

    async setModelEnabled(providerId, model, enabled) {
      const modelsFile = await readModelsFile(globalDir);
      const entry = modelsFile.providers?.[providerId] ?? {};
      const hidden = new Set(entry.hidden ?? []);
      if (enabled) hidden.delete(model);
      else hidden.add(model);
      await writeModelsFile(globalDir, {
        ...modelsFile,
        providers: {
          ...(modelsFile.providers ?? {}),
          [providerId]: { ...entry, hidden: [...hidden].sort() },
        },
      });
    },

    async putCustomProvider(input: CustomProviderInput) {
      const slug =
        (input.label ?? "provider")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "provider";
      const id = `user-${slug}-${randomBytes(2).toString("hex")}`;
      if (input.key !== undefined) await writeCredential(globalDir, id, input.key);
      const modelsFile = await readModelsFile(globalDir);
      await writeModelsFile(globalDir, {
        ...modelsFile,
        providers: {
          ...(modelsFile.providers ?? {}),
          [id]: {
            ...(input.label === undefined ? {} : { label: input.label }),
            baseUrl: input.baseUrl,
            models: Object.fromEntries(
              input.models.map((m) => [m.model, m.label === undefined ? {} : { label: m.label }]),
            ),
          },
        },
      });
      return { id };
    },

    async putCredential(providerId, key) {
      await writeCredential(globalDir, providerId, key);
    },

    async listUiAssets() {
      return scanUiAssets(path.join(dataDir, "plugins"));
    },

    async listPlugins() {
      // 每次现场发现（与 server 同语义：目录/开关变化即反映；装载走模块缓存）
      const current = await prepareRuntimePlugins(dataDir, globalDir);
      const settings = await readSettings(globalDir);
      const official: PluginState[] = defaultPreset.map((entry) => {
        const enabled = isPluginEnabled(settings, entry.id);
        return {
          id: entry.id,
          version: sdkVersion(),
          name: entry.id,
          source: "official",
          forms: ["engine"],
          enabled,
          state: enabled ? "loaded" : "disabled",
          inject: [],
          warnings: [],
        };
      });
      const plugins = [...official, ...current.states];
      const fingerprint = createHash("sha1")
        .update(JSON.stringify(plugins.map((p) => [p.id, p.version, p.state, p.enabled])))
        .digest("hex")
        .slice(0, 12);
      return { plugins, fingerprint };
    },

    async confirmPlugin(id, version) {
      await setPluginSetting(globalDir, id, { confirmedVersion: version });
    },

    async confirmPluginMcp(id) {
      const current = await prepareRuntimePlugins(dataDir, globalDir);
      const target = current.states.find((p) => p.id === id);
      if (
        target === undefined ||
        target.mcp === undefined ||
        target.mcp.length === 0 ||
        target.mcpFingerprint === undefined
      ) {
        throw new Error("plugin not found or has no mcp servers");
      }
      await setPluginSetting(globalDir, id, { mcpFingerprint: target.mcpFingerprint });
    },

    async executeResource(sessionId, pluginId, address): Promise<ResourceReply> {
      const now = Date.now();
      const parsed = parseResourceAddress(address);
      if (parsed === undefined) {
        return { ok: false, error: "invalid resource address", updatedAt: now };
      }
      if (parsed.pluginId !== pluginId) {
        throw new Error("resource ownership violated"); // 越权 403 同语义（facade 抛错形态）
      }
      const preparedNow = await prepareRuntimePlugins(dataDir, globalDir);
      const declared = preparedNow.mcpServers.some(
        (d) => d.pluginId === parsed.pluginId && d.server === parsed.server,
      );
      if (!declared) {
        throw new Error("server not declared by this plugin");
      }
      const session = requireSession(sessions, sessionId);
      const mcp = session.ctx.get("mcp");
      const result = await mcp.call(
        { pluginId: parsed.pluginId, server: parsed.server, tool: parsed.tool },
        parsed.args,
        AbortSignal.timeout(30_000),
      );
      const text =
        result.content.length > RESOURCE_MAX_CHARS
          ? result.content.slice(0, RESOURCE_MAX_CHARS)
          : result.content;
      return { ok: true, text, updatedAt: Date.now() };
    },

    async setPluginEnabled(id, enabled) {
      if (OFFICIAL_PLUGIN_IDS.has(id)) throw new Error("official plugin is not toggleable");
      if (defaultPreset.some((entry) => entry.id === id)) {
        // 外圈官方件可停用（D-064 plugin-mcp / D-065 fs 族 / shell 族 / breaker，与 server 同语义）
        await setPluginSetting(globalDir, id, { enabled });
        return;
      }
      if (!existsSync(path.join(dataDir, "plugins", id))) throw new Error("plugin not found");
      await setPluginSetting(globalDir, id, { enabled });
    },

    async setPluginVersion(id, version) {
      if (OFFICIAL_PLUGIN_IDS.has(id)) throw new Error("official plugin is not pinnable");
      if (!existsSync(path.join(dataDir, "plugins", id, version, "plugin.json"))) {
        throw new Error("plugin or version not found");
      }
      await setPluginSetting(globalDir, id, { version });
    },

    async removePlugin(id) {
      if (OFFICIAL_PLUGIN_IDS.has(id)) throw new Error("official plugin is not removable");
      const dir = path.join(dataDir, "plugins", id);
      if (!existsSync(dir)) throw new Error("plugin not found");
      await fs.rm(dir, { recursive: true, force: true });
      const settings = await readSettings(globalDir);
      if (settings?.plugins?.[id] !== undefined) {
        const plugins = { ...settings.plugins };
        delete plugins[id];
        await writeSettings(globalDir, { plugins });
      }
    },

    async listDir(sessionId, dirPath) {
      const session = requireSession(sessions, sessionId);
      const root = path.resolve(session.cwd);
      const target = path.resolve(root, dirPath ?? "");
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("path escapes session workspace");
      }
      const dirents = await fs.readdir(target, { withFileTypes: true });
      const entries: { name: string; kind: "file" | "dir"; size?: number; mtime?: number }[] = [];
      for (const dirent of dirents) {
        if (dirent.name.startsWith(".")) continue;
        const stat = await fs.stat(path.join(target, dirent.name)).catch(() => undefined);
        entries.push({
          name: dirent.name,
          kind: dirent.isDirectory() ? "dir" : "file",
          size: dirent.isFile() ? stat?.size : undefined,
          mtime: stat?.mtimeMs,
        });
      }
      return entries;
    },

    async readWorkspaceFile(sessionId, filePath) {
      const session = requireSession(sessions, sessionId);
      const root = path.resolve(session.cwd);
      const target = path.resolve(root, filePath);
      if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error("path escapes session workspace");
      }
      const stat = await fs.stat(target).catch(() => undefined);
      if (stat === undefined) throw new Error("file not found");
      if (!stat.isFile()) throw new Error("not a file");
      // 符号链接复核（server 端点同语义——双形态行为一致）
      const realRoot = await fs.realpath(root).catch(() => root);
      const realTarget = await fs.realpath(target).catch(() => undefined);
      if (realTarget === undefined) throw new Error("file not found");
      if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
        throw new Error("path escapes session workspace");
      }
      const bytes = await fs.readFile(realTarget).catch(() => undefined);
      if (bytes === undefined) throw new Error("not readable");
      const binary = looksBinary(bytes);
      if (binary && bytes.byteLength > WORKSPACE_FILE_MAX_BYTES) {
        throw new Error("file too large to preview");
      }
      const content: WorkspaceFileContent = binary
        ? {
            path: realTarget,
            encoding: "base64",
            content: bytes.toString("base64"),
            size: bytes.byteLength,
          }
        : {
            path: realTarget,
            encoding: "utf8",
            content: bytes.subarray(0, WORKSPACE_FILE_MAX_BYTES).toString("utf8"),
            size: bytes.byteLength,
            ...(bytes.byteLength > WORKSPACE_FILE_MAX_BYTES ? { truncated: true } : {}),
          };
      return content;
    },

    async snapshot(sessionId) {
      const session = requireSession(sessions, sessionId);
      // 尾窗 60（与 server 快照端点同档——双形态一致：长会话只回尾部窗口，历史经 sessionRows 翻页）
      const snap = session.projection.snapshot(sessionId, currentSeq(sessionId), { tailRows: 60 });
      return { ...snap, state: stateWithQueue(snap.state, session.ctx) };
    },

    async sessionRows(sessionId, opts) {
      const session = requireSession(sessions, sessionId);
      return sliceRowsPage(session.projection.rows, opts?.before, opts?.limit ?? 60);
    },

    async listDirs() {
      return dirs.list();
    },

    async addDir(cwd) {
      if (!isAbsoluteCwd(cwd)) throw new Error("cwd must be an absolute path");
      const resolved = path.resolve(cwd);
      const stat = await fs.stat(resolved).catch(() => undefined);
      if (stat === undefined) throw new Error("path does not exist or is not accessible");
      if (!stat.isDirectory()) throw new Error("path exists but is not a directory");
      const dir = await dirs.upsert(resolved);
      deliver({ kind: "sessions.changed" }); // 目录列表事实变（R176）
      return dir;
    },

    async deleteDir(id) {
      const dir = await dirs.get(id);
      if (dir === undefined) return; // 未知 id 幂等（与 server 同一语义）
      const blocked = [...sessions.values()]
        .filter((s) => sameCwd(s.cwd, dir.cwd) && s.projection.state.busy)
        .map((s) => s.id);
      if (blocked.length > 0) {
        throw new Error(`directory busy; abort sessions before deletion: ${blocked.join(", ")}`);
      }
      for (const session of [...sessions.values()]) {
        if (projectKey(session.cwd) !== dir.key) continue;
        await session.harness.dispose().catch(() => {});
        sessions.delete(session.id);
      }
      // key 只来自登记条目（registry 形态闸同款兜底）；账本树+检查点树（data-directory §7）
      await fs.rm(path.join(dataDir, "projects", dir.key), { recursive: true, force: true });
      await fs.rm(path.join(dataDir, "checkpoints", dir.key), { recursive: true, force: true });
      await dirs.remove(id);
      deliver({ kind: "sessions.changed" }); // 目录与辖下会话列表事实变（R176）
    },

    async browseDirs(path) {
      return browseDirectories(path);
    },

    async deleteSession(id) {
      if (!/^s-[0-9a-z]+-[0-9a-f]{6}$/.test(id)) throw new Error(`session not found: ${id}`);
      const session = sessions.get(id);
      const dir =
        session !== undefined
          ? path.join(dataDir, "projects", projectKey(session.cwd), "sessions", id)
          : await findSessionDir(dataDir, id);
      if (dir === undefined) throw new Error(`session not found: ${id}`);
      if (session?.projection.state.busy) {
        throw new Error("session is busy; abort it before deletion");
      }
      await fs.rm(dir, { recursive: true, force: true });
      if (session !== undefined) {
        await session.harness.dispose().catch(() => {});
        sessions.delete(id);
      }
      deliver({ kind: "sessions.changed" }); // 列表事实变（R176）
    },

    async getUiState() {
      return readGlobalUiState(dataDir);
    },

    async putUiState(doc) {
      await writeGlobalUiState(dataDir, doc);
    },

    async getSessionUiState(sessionId) {
      const dir = await resolveSessionDir(sessionId);
      if (dir === undefined) throw new Error(`session not found: ${sessionId}`);
      return readSessionUiState(dir);
    },

    async putSessionUiState(sessionId, doc) {
      const dir = await resolveSessionDir(sessionId);
      if (dir === undefined) throw new Error(`session not found: ${sessionId}`);
      await writeSessionUiState(dir, doc);
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
            snapshot: {
              ...session.projection.snapshot(session.id, currentSeq(session.id)),
              state: stateWithQueue(session.projection.state, session.ctx),
            },
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

/** 绝对路径判据（与 server 路由同式；win32 盘符形或 posix 根形） */
function isAbsoluteCwd(cwd: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("/") || cwd.startsWith("\\");
}

/** 磁盘会话目录定位（projects/<key>/sessions/<id> 逐 key 扫；历史会话删除用） */
async function findSessionDir(dataDir: string, id: string): Promise<string | undefined> {
  const projectsDir = path.join(dataDir, "projects");
  let keys: string[] = [];
  try {
    keys = await fs.readdir(projectsDir);
  } catch {
    return undefined;
  }
  for (const key of keys) {
    const dir = path.join(projectsDir, key, "sessions", id);
    if (existsSync(dir)) return dir;
  }
  return undefined;
}

/** ui-state 文档读写（D-063）：与 packages/server ui-state-store 同语义的进程内形态
 * （findSessionDir 双形态同款先例——第二实现出现即提取）。读缺失/损坏回落缺省；写整份
 * tmp+rename 原子重写（atomicWriteFile 复用 plugin-session 出口）；形状归 web 宿主，
 * runtime 只管落盘不解释。 */
async function readGlobalUiState(dataDir: string): Promise<GlobalUiState> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(dataDir, "state", "ui.json"), "utf8"),
    ) as GlobalUiState;
    return {
      lastSessionId: typeof parsed.lastSessionId === "string" ? parsed.lastSessionId : null,
    };
  } catch {
    return { lastSessionId: null };
  }
}

async function writeGlobalUiState(dataDir: string, doc: GlobalUiState): Promise<void> {
  const file = path.join(dataDir, "state", "ui.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(doc, null, 2)}\n`);
}

async function readSessionUiState(sessionDir: string): Promise<SessionUiState> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(path.join(sessionDir, "ui-state.json"), "utf8"),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SessionUiState;
  } catch {
    return {};
  }
}

async function writeSessionUiState(sessionDir: string, doc: SessionUiState): Promise<void> {
  await fs.mkdir(sessionDir, { recursive: true });
  await atomicWriteFile(
    path.join(sessionDir, "ui-state.json"),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
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
