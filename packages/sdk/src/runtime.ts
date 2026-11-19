// 形态一：进程内 runtime（③零服务——hosts.md §1：无 server、无端口、一次性任务 / 嵌入）。
// 装配三步 ①③（引擎五件编程聚合 + settings.plugins enabled 过滤——与 examples / server 同一
// 语义）；InteractionService 缺省 = fail-closed 自动拒（没人应答一律拒，packages.md 槽位归属），
// 嵌入方可整只替换。不写 server.json、不开端口——宿主职责到此为止。

import { randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConfigService, Dictionary, SNAPSHOT, scanUiAssets } from "@henira/config-loader";
import type { ServiceDefinition } from "@henira/kernel";
import { createHarness } from "@henira/kernel";
import { approvalPlugin } from "@henira/plugin-approval";
import { llmPlugin } from "@henira/plugin-llm";
import { loopPlugin } from "@henira/plugin-loop";
import {
  atomicWriteFile,
  browseDirectories,
  DirRegistry,
  projectKey,
  type SessionHandle,
  sameCwd,
  sessionPlugin,
} from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import {
  asHeniraContext,
  type Delta,
  type GlobalUiState,
  type InteractionAnswer,
  type InteractionRequest,
  type InteractionService,
  type LlmService,
  type LoopEvent,
  Projection,
  reasoningCapability,
  type ServerFrame,
  type SessionEvent,
  type SessionSummary,
  type SessionUiState,
  sliceRowsPage,
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
  readModelsFile,
  readSettings,
  removeCredential,
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
  /** 额外引擎插件（henira.config.ts 清单加法，D-016①） */
  plugins?: readonly ServiceDefinition<unknown>[];
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

  const facade: HeniraFacade = {
    async createSession(sessionOpts) {
      const cwd = sessionOpts?.cwd ?? process.cwd();
      if (!isAbsoluteCwd(cwd)) throw new Error("cwd must be an absolute path");
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
      for (const extra of opts.plugins ?? []) {
        harness.use(extra); // 额外引擎插件（项目 henira.config.ts 清单加法，D-016①）
      }
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
      await dirs.upsert(cwd, id); // 带目录建会话 = 自动登记（与 server 同一语义）
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

    async prompt(sessionId, text, opts) {
      const receipt = await requireSession(sessions, sessionId)
        .ctx.get("loop")
        .send(text, { modelId: opts?.modelId, reasoningEffort: opts?.reasoningEffort });
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
      return scanUiAssets(globalDir);
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

    async snapshot(sessionId) {
      const session = requireSession(sessions, sessionId);
      // 尾窗 60（与 server 快照端点同档——双形态一致：长会话只回尾部窗口，历史经 sessionRows 翻页）
      return session.projection.snapshot(sessionId, currentSeq(sessionId), { tailRows: 60 });
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
      return dirs.upsert(resolved);
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
