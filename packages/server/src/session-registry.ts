// 会话注册表（hosts.md §3：①宿主 = 进程级壳 + 每会话一个 harness 实例，装配每会话执行）。
// 装配三步 M3 实现 ①③（D-016：引擎五件编程装配——与 examples 同一条路径；③ = settings.json
// plugins.<id>.enabled === false 不装载）；②已装插件目录扫描装载随 M4（M3 判据无一条需要）。
// 会话内 session 槽由本宿主装饰组合占据：SessionHandle.append 接进投影器（装配权属宿主
// D-016；引擎与协议零改动）。会话目录按 data-directory §4 命名（projects/<key>/sessions/<id>），
// 登记工作目录注册表（projects.json）与 key 命名住 plugin-session（账本域共享知识，
// 规则 3 禁宿主互依——不在 server/sdk 各自复制）。

import { createHash, randomBytes } from "node:crypto";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConfigService,
  defaultPreset,
  type PluginEntry,
  type PluginSettingsEntry,
  type PluginState,
  type PrepareResult,
  preparePlugins,
} from "@henira/config-loader";
import type { ServiceDefinition } from "@henira/kernel";
import { createHarness } from "@henira/kernel";
import { approvalPlugin } from "@henira/plugin-approval";
import { llmPlugin } from "@henira/plugin-llm";
import { loopPlugin } from "@henira/plugin-loop";
import {
  projectKey,
  SESSION_LOG_FILE,
  type SessionHandle,
  sessionPlugin,
} from "@henira/plugin-session";
import { toolsPlugin } from "@henira/plugin-tools";
import type { LlmService } from "@henira/protocol";
import {
  asHeniraContext,
  type LoopEvent,
  Projection,
  type Row,
  rebuildProjection,
  type SessionEvent,
  type SessionSummary,
  sliceRowsPage,
} from "@henira/protocol";
import type { Fanout } from "./fanout.js";
import { ServerInteraction } from "./interaction-service.js";
import {
  isPluginEnabled,
  readSettings,
  setPluginSetting,
  writeSettings,
} from "./settings-store.js";

export { projectKey }; // @henira/server 公共面保持（既有出口，实现下沉 plugin-session）

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
  /** 基础插件清单（henira.config.ts 的 plugins；非空 = 听它的，空/缺省 = 出厂清单
   *  defaultPreset——§5 装配三步①。条目 definition 在场 = 替换该官方件的实现） */
  plugins?: readonly PluginEntry[];
  fanout: Fanout;
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

/** 引擎件别名（§4 硬规矩的 Node 侧 import map 等价物）：插件对内核/协议的 import
 *  一律落到宿主唯一实例，禁自带副本 */
function engineAlias(): Record<string, string> {
  return {
    "@henira/kernel": resolvePackageEntry("@henira/kernel", "../../kernel/dist/index.js"),
    "@henira/protocol": resolvePackageEntry("@henira/protocol", "../../protocol/dist/index.js"),
  };
}

/** 内圈槽位名：目录件不得占用（§7.1 撞官方 = 跳过 + 告警；同 id 替换随 D-048 挂账） */
/** 官方五件 id（defaultPreset）：不给关、不给版本钉、不可卸载（§5 :222 / §6.4） */
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
]);

export class SessionRegistry {
  readonly #entries = new Map<string, SessionEntry>();
  /** attach 并发去重：同 id 的并行写请求共享同一次挂载（挂完即清） */
  readonly #attaching = new Map<string, Promise<SessionEntry | undefined>>();
  readonly #opts: RegistryOptions;
  /** 用户级插件根（data-directory §2:61；批 C 起为目录件的发现入口） */
  readonly #pluginRoot: string;
  /** 最近一次装配前置结果（管理面读面 / 指纹轮询用；每次会话装配刷新） */
  #prepared: PrepareResult | undefined;

  constructor(opts: RegistryOptions) {
    this.#opts = opts;
    this.#pluginRoot = path.join(opts.dataDir, "plugins");
  }

  /** 发现 + settings 过滤 + 确认门 + 引擎装载 + inject 预检（plugins.md §5 装配三步②③） */
  async #prepare(): Promise<PrepareResult> {
    const settings = await readSettings(this.#opts.globalDir);
    const result = await preparePlugins({
      pluginRoot: this.#pluginRoot,
      settings: settings as { plugins?: Record<string, PluginSettingsEntry> } | undefined,
      engineAlias: engineAlias(),
      hostVersion: serverVersion(),
    });
    this.#prepared = result;
    for (const warning of result.warnings) console.warn(`[server] 插件：${warning}`);
    return result;
  }

  /** 管理面读面（GET /api/plugins）：最近一次装配前置的状态 + 指纹（前端轮询用） */
  async pluginSnapshot(): Promise<{ plugins: PluginState[]; fingerprint: string }> {
    // 每次现场发现（轮询语义：目录新增版本 / 开关变化即反映；引擎装载走模块缓存）
    const prepared = await this.#prepare();
    // 官方五件 = 清单来源（source official，不可卸载；状态跟装载走）
    const official: PluginState[] = defaultPreset.map((entry) => ({
      id: entry.id,
      version: serverVersion(),
      name: entry.id,
      forms: ["engine"],
      enabled: true,
      state: "loaded",
      inject: [],
      warnings: [],
    }));
    const plugins = [...official, ...prepared.states];
    const fingerprint = createHash("sha1")
      .update(JSON.stringify(plugins.map((p) => [p.id, p.version, p.state, p.enabled])))
      .digest("hex")
      .slice(0, 12);
    return { plugins, fingerprint };
  }

  /** 确认卡放行（批 C，§4 安全规则）：写 confirmedVersion，新会话生效；只对 engine 件生效 */
  async confirmPlugin(id: string, version: string): Promise<boolean> {
    const prepared = this.#prepared ?? (await this.#prepare());
    const target = prepared.states.find((p) => p.id === id);
    if (target === undefined || !target.forms.includes("engine")) return false;
    await setPluginSetting(this.#opts.globalDir, id, { confirmedVersion: version });
    this.#prepared = undefined; // 确认后状态要重算（snapshot/下一会话读到 loaded）
    return true;
  }

  /** 启停（§6.4：写 settings.plugins.<id>.enabled；缺 key = 启用）。官方件不给关（§5 :222） */
  async setPluginEnabled(id: string, enabled: boolean): Promise<boolean> {
    if (OFFICIAL_PLUGIN_IDS.has(id)) return false; // 官方五件不给关
    const prepared = await this.#prepare();
    if (!prepared.states.some((p) => p.id === id)) return false;
    await setPluginSetting(this.#opts.globalDir, id, { enabled });
    return true;
  }

  /** 版本切换（§6.2：settings.plugins.<id>.version 钉；新会话生效）。目标版本必须在盘上 */
  async setPluginVersion(id: string, version: string): Promise<boolean> {
    if (OFFICIAL_PLUGIN_IDS.has(id)) return false; // 官方件不提供版本钉（§5 :222）
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
      return false;
    }
    const manifestPath = path.join(this.#pluginRoot, id, version, "plugin.json");
    if (!existsSync(manifestPath)) return false;
    await setPluginSetting(this.#opts.globalDir, id, { version });
    return true;
  }

  /** 卸载（§6.4：删 plugins/<id>/ 整目录；plugins-data 默认保留；官方件拒绝） */
  async removePlugin(id: string): Promise<"ok" | "official" | "missing"> {
    if (OFFICIAL_PLUGIN_IDS.has(id)) return "official";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return "missing";
    const dir = path.join(this.#pluginRoot, id);
    if (!existsSync(dir)) return "missing";
    await fs.rm(dir, { recursive: true, force: true });
    // settings 里清该 id 的插件设置（开关/版本/确认记录随包一起失效）
    const settings = await readSettings(this.#opts.globalDir);
    if (settings?.plugins?.[id] !== undefined) {
      const plugins = { ...settings.plugins };
      delete plugins[id];
      await writeSettings(this.#opts.globalDir, { plugins });
    }
    this.#prepared = undefined;
    return "ok";
  }

  /** 基础清单解析（§5 装配三步①）：config.plugins 非空听它的，否则出厂清单；
   *  官方 id → 内置工厂（definition 在场 = 替换实现；session 槽 v1 只允许官方包装） */
  #baseDefinitions(ctx: {
    id: string;
    cwd: string;
    directory: string;
    onAppend: (event: SessionEvent) => void;
  }): ServiceDefinition<unknown>[] {
    const entries =
      this.#opts.plugins !== undefined && this.#opts.plugins.length > 0
        ? this.#opts.plugins
        : defaultPreset;
    const out: ServiceDefinition<unknown>[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      switch (entry.id) {
        case "plugin-session":
          if (entry.definition !== undefined) {
            console.warn(
              "[server] 插件：v1 不支持替换 session 槽（宿主投影链要求官方包装，D-048 挂账）——按官方实现装载",
            );
          }
          out.push(
            observedSession(
              sessionPlugin({ directory: ctx.directory, cwd: ctx.cwd, id: ctx.id }),
              ctx.onAppend,
            ),
          );
          break;
        case "plugin-tools":
          out.push(entry.definition ?? toolsPlugin({}));
          break;
        case "plugin-llm":
          out.push(entry.definition ?? this.#opts.llm ?? llmPlugin());
          break;
        case "plugin-approval":
          out.push(entry.definition ?? approvalPlugin());
          break;
        case "plugin-loop":
          out.push(entry.definition ?? loopPlugin());
          break;
        default:
          if (entry.definition !== undefined) out.push(entry.definition);
          else console.warn(`[server] 插件：清单条目 "${entry.id}" 无 definition——跳过`);
      }
    }
    return out;
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
    // resolve：会话树 key 与登记条目 key 必须同源推导（未归一拼写会让两把 key 分叉——
    // 删目录时 in-订 会话漏 dispose（句柄未闭 → EBUSY）或账本树漏删（reconcile 复活条目）
    const cwd = opts?.cwd === undefined ? process.cwd() : path.resolve(opts.cwd);
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
    const entry = await this.#mount({ id, cwd, directory });
    this.#entries.set(id, entry);
    this.#announce(entry);
    return entry;
  }

  /** 懒挂载（重启续聊）：磁盘历史会话首次写操作（prompt/steer/interrupt/settle/files）按需重建
   *  运行体。幂等（在订即返回）+ 并发去重；读路径（snapshot/rows/ui-state）不走这里——各有磁盘
   *  兜底，浏览不付装配成本。SessionStore 本就「存在即装载」（含崩溃补写 turn/end{interrupted}），
   *  引擎零改动；锁被另一活进程持有时 SessionLockedError 冒泡（路由层 409）。 */
  async attach(id: string): Promise<SessionEntry | undefined> {
    const existing = this.#entries.get(id);
    if (existing !== undefined) return existing;
    const inflight = this.#attaching.get(id);
    if (inflight !== undefined) return inflight;
    const task = this.#attach(id).finally(() => {
      this.#attaching.delete(id);
    });
    this.#attaching.set(id, task);
    return task;
  }

  async #attach(id: string): Promise<SessionEntry | undefined> {
    const directory = await this.#findSessionDir(id);
    if (directory === undefined) return undefined;
    // 账本头核验（fail-closed）：目录名与 header.id 一致且 cwd 在场才挂——损坏目录不挂垃圾
    let header: { id?: string; cwd?: string };
    try {
      const first = (await fs.readFile(path.join(directory, SESSION_LOG_FILE), "utf8")).split(
        "\n",
      )[0];
      header = JSON.parse(first) as { id?: string; cwd?: string };
    } catch {
      return undefined;
    }
    if (header.id !== id || header.cwd === undefined) return undefined;

    const entry = await this.#mount({ id, cwd: header.cwd, directory });
    // 投影补账：openExisting 的装载与崩溃补写发生在宿主包装层建立之前、不走 onAppend——
    // 挂载后从账本重放（补读在 harness.start 之后，崩溃补写行已含在内）
    const events = await this.ledgerEvents(id);
    if (events !== undefined) {
      for (const event of events) entry.projection.ingest(event);
    }
    this.#entries.set(id, entry);
    this.#announce(entry);
    return entry;
  }

  /** 共享装配（create 新建 / attach 懒挂载同一条路）：interaction + 投影 + harness 七件 + delta 订阅 */
  async #mount(input: { id: string; cwd: string; directory: string }): Promise<SessionEntry> {
    const { id, cwd, directory } = input;
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

    // 装配三步（§5：①基础清单 ②目录件 ③enabled 由 prepare 过滤）+ 宿主两件
    const prepared = await this.#prepare();
    const harness = createHarness();
    for (const definition of this.#baseDefinitions({ id, cwd, directory, onAppend })) {
      harness.use(definition);
    }
    harness.use({ name: "interaction", start: () => interaction });
    harness.use({
      name: "config",
      start: () => createConfigService({ cwd, globalDir: this.#opts.globalDir }),
    });
    for (const item of prepared.definitions) {
      const definition = item.definition as { name?: string; start?: unknown };
      if (typeof definition.start !== "function") {
        console.warn(`[server] 插件：${item.id} 的 definition 形状非法——跳过`);
        continue;
      }
      if (definition.name !== undefined && CORE_SLOT_NAMES.has(definition.name)) {
        console.warn(
          `[server] 插件：${item.id} 占用内圈槽位 "${definition.name}"——跳过（§7.1 撞官方不装载）`,
        );
        continue;
      }
      harness.use(item.definition as ServiceDefinition<unknown>);
    }
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

  /** 行翻页（rows 端点数据源）：在订会话从投影行切片；磁盘历史会话从账本重建后切片。
   *  beforeSeq 排他（sliceRowsPage 语义——protocol 共享实现，runtime 形态同函数同语义）；
   *  磁盘路径每页全读重建（挂账：JSONL 倒序窗口读随性能批） */
  async sessionRows(
    id: string,
    beforeSeq: number | undefined,
    limit: number,
  ): Promise<{ rows: Row[]; hasOlder: boolean } | undefined> {
    const entry = this.#entries.get(id);
    if (entry !== undefined) {
      return sliceRowsPage(entry.projection.rows, beforeSeq, limit);
    }
    const events = await this.ledgerEvents(id);
    if (events === undefined) return undefined;
    return sliceRowsPage(rebuildProjection(events).rows, beforeSeq, limit);
  }

  /** 全部会话收尾（server stop）：harness dispose（各插件 stop：锁/句柄）+ 挂起审批 cancelled 收口 */
  async disposeAll(): Promise<void> {
    for (const entry of [...this.#entries.values()]) {
      entry.interaction.dispose();
      await entry.harness.dispose().catch(() => {});
      this.#entries.delete(entry.id);
    }
  }

  /** 删单个会话（data-directory §7 删除会话语义）：账本目录整删 + 在订收尾；不在册 = false */
  async deleteSession(id: string): Promise<boolean> {
    if (!/^s-[0-9a-z]+-[0-9a-f]{6}$/.test(id)) return false; // id 形态闸（防路径段滥用）
    const entry = this.#entries.get(id);
    const dir = entry?.directory ?? (await this.#findSessionDir(id));
    if (dir === undefined) return false;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (entry !== undefined) {
      entry.interaction.dispose();
      await entry.harness.dispose().catch(() => {});
      this.#entries.delete(id);
    }
    return true;
  }

  /** 删整个项目数据树（data-directory §7 删除项目）：projects/<key>/ + checkpoints/<key>/ +
   *  在订该 cwd 会话收尾。key 只来自登记表条目（非用户输入路径），形态闸兜底防拼接滥用 */
  async removeProject(key: string): Promise<void> {
    // 形态闸 = 路径安全闸（key 将进 path.join）：拦路径分隔符/NUL 即可，slug 段本就容 CJK
    // 目录名——原 ASCII 正则把中文目录全判非法 = 删中文目录必 500（R130 用户实测抓出的真根因）
    if (!/^--[^\0/\\]{1,120}-[0-9a-f]{8}--$/.test(key)) {
      throw new Error(`invalid project key: ${key}`);
    }
    for (const entry of [...this.#entries.values()]) {
      if (projectKey(entry.cwd) !== key) continue;
      entry.interaction.dispose();
      await entry.harness.dispose().catch(() => {});
      this.#entries.delete(entry.id);
    }
    await fs.rm(path.join(this.#opts.dataDir, "projects", key), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    await fs.rm(path.join(this.#opts.dataDir, "checkpoints", key), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }

  /** 磁盘会话目录定位（projects/<key>/sessions/<id> 逐 key 扫；历史会话删除用） */
  async #findSessionDir(id: string): Promise<string | undefined> {
    const projectsDir = path.join(this.#opts.dataDir, "projects");
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

  /** 会话目录定位（ui-state 等宿主侧会话文件读写用）：在册取 entry.directory，历史会话扫盘 */
  async resolveSessionDir(id: string): Promise<string | undefined> {
    return this.get(id)?.directory ?? (await this.#findSessionDir(id));
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
