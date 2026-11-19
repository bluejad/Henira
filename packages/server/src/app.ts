// HTTP 面（interfaces.md server 段 REST 命令面 + SSE）：回环三件套中间件（D-035 判据⑤——
// 只绑回环由 server.ts 负责，此处管 Host/Origin 校验与可选 token）+ REST 路由 + SSE 端点。
// SSE 帧序 = connected → 在订会话快照帧 → 增量帧混排；15s 注释心跳；有界队列溢出断开。

import { randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { Dictionary, SNAPSHOT, scanUiAssets } from "@henira/config-loader";
import {
  browseDirectories,
  type DirRegistry,
  SessionLockedError,
  sameCwd,
} from "@henira/plugin-session";
import {
  DECISIONS,
  REASONING_EFFORTS,
  type ReasoningCapability,
  type ReasoningOption,
  reasoningCapability,
  rebuildProjection,
  type ServerFrame,
  type SessionUiState,
} from "@henira/protocol";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Fanout } from "./fanout.js";
import type { SessionRegistry } from "./session-registry.js";
import {
  listCredentialProviders,
  type ModelsFile,
  readModelsFile,
  readSettings,
  removeCredential,
  writeCredential,
  writeModelsFile,
  writeSettings,
} from "./settings-store.js";
import { injectImportMap, lookupUiShim } from "./ui-shims.js";
import {
  readGlobalUiState,
  readSessionUiState,
  validateSessionUiState,
  writeGlobalUiState,
  writeSessionUiState,
} from "./ui-state-store.js";

/** 每订阅者有界队列容量；溢出 = 断开（volatile：客户端重连重拉快照） */
const QUEUE_CAP = 256;
const HEARTBEAT_MS = 15_000;
/** 快照尾部窗口行数（长会话分页——历史经 /rows 翻页拉取；ZCode snapshotTailWindowRows 同档） */
const SNAPSHOT_TAIL_ROWS = 60;
/** rows 翻页单页上限（服务端钳制；ZCode rowsRangeMaxLimit 同档） */
const ROWS_PAGE_MAX = 200;

export interface AppDeps {
  registry: SessionRegistry;
  /** 登记工作目录注册表（data-directory §4 projects.json） */
  dirs: DirRegistry;
  fanout: Fanout;
  /** 全局数据根（HENIRA_HOME；state/ui.json 与 projects/ 都在它下面） */
  dataDir: string;
  globalDir: string;
  /** 用户级插件根（data-directory §2:61：~/.henira/plugins——批 C 修正，勿再拼 config/） */
  pluginRoot: string;
  version: string;
  startedAt: number;
  token?: string;
  /** web 静态产物目录（packages/web/dist-web；缺席 = 纯 API 服务） */
  webDist?: string;
  /** 模型字典（模型管理面 presets/refresh 用；缺席 = 现场构造 Dictionary） */
  dictionary?: ModelDictionary;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

function splitHostPort(host: string): [string, string] {
  const index = host.lastIndexOf(":");
  if (index === -1) return [host, ""];
  return [host.slice(0, index), host.slice(index + 1)];
}

function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const hostname = host.includes(":") ? splitHostPort(host)[0] : host;
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/** 模型字典（config-loader Dictionary：快照 + 缓存 + 在线刷新；测试可注入桩） */
export type ModelDictionary = Pick<Dictionary, "loadCache" | "refresh" | "entries">;

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // 懒挂载锁冲突（重启续聊：另一活进程持锁）→ 409，形状与 DELETE busy 拒绝一致
  app.onError((err, c) => {
    if (err instanceof SessionLockedError) {
      return c.json(
        { code: "session_busy", message: "session is locked by another live process" },
        409,
      );
    }
    throw err;
  });

  // ── 三件套之 ③：Host / Origin 校验（防恶意网页把域名解析到回环冒充访问本机服务）──
  app.use("/api/*", async (c, next) => {
    if (!isLoopbackHost(c.req.header("host"))) {
      return c.json({ error: "forbidden host" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      try {
        const parsed = new URL(origin);
        if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
          return c.json({ error: "forbidden origin" }, 403);
        }
      } catch {
        return c.json({ error: "forbidden origin" }, 403);
      }
    }
    await next();
  });

  // ── 三件套之可选 token 位：HENIRA_SERVER_TOKEN 设置时启用（Bearer / ?token=）──
  app.use("/api/*", async (c, next) => {
    if (deps.token === undefined) return next();
    const header = c.req.header("authorization");
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : c.req.query("token");
    if (provided !== deps.token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  // ── server ──
  app.get("/api/server/info", async (c) => {
    const settings = await readSettings(deps.globalDir);
    return c.json({ version: deps.version, startedAt: deps.startedAt, model: settings?.model });
  });

  // ── 会话注册表 ──
  app.post("/api/sessions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cwd?: string };
    if (body.cwd !== undefined && !isAbsoluteCwd(body.cwd)) {
      return c.json({ error: "cwd must be an absolute path" }, 400);
    }
    const entry = await deps.registry.create({ cwd: body.cwd });
    await deps.dirs.upsert(entry.cwd, entry.id); // 带目录建会话 = 自动登记（data-directory §4 权威列表）
    return c.json({ id: entry.id, cwd: entry.cwd, busy: false });
  });

  app.get("/api/sessions", async (c) => {
    return c.json(await deps.registry.list());
  });

  app.get("/api/sessions/:id/snapshot", async (c) => {
    const id = c.req.param("id");
    const entry = deps.registry.get(id);
    if (entry !== undefined) {
      return c.json(
        entry.projection.snapshot(id, deps.fanout.currentSeq(id), { tailRows: SNAPSHOT_TAIL_ROWS }),
      );
    }
    // 磁盘历史会话（本进程未装配）：从账本重建快照（真相兜底）
    const events = await deps.registry.ledgerEvents(id);
    if (events === undefined) return c.json({ error: "session not found" }, 404);
    return c.json(
      rebuildProjection(events).snapshot(id, deps.fanout.currentSeq(id), {
        tailRows: SNAPSHOT_TAIL_ROWS,
      }),
    );
  });

  // ── 行翻页（长会话历史：before = rowSeq 排他游标；轮边界补齐在 sliceRowsPage 共享实现）──
  app.get("/api/sessions/:id/rows", async (c) => {
    const id = c.req.param("id");
    const beforeRaw = c.req.query("before");
    const before = beforeRaw === undefined || beforeRaw === "" ? undefined : Number(beforeRaw);
    if (before !== undefined && (!Number.isFinite(before) || before < 0)) {
      return c.json({ error: "before must be a non-negative number" }, 400);
    }
    const limitRaw = c.req.query("limit");
    const limitParsed = limitRaw === undefined ? SNAPSHOT_TAIL_ROWS : Number(limitRaw);
    const limit = Math.min(
      Math.max(Number.isFinite(limitParsed) ? Math.floor(limitParsed) : SNAPSHOT_TAIL_ROWS, 1),
      ROWS_PAGE_MAX,
    );
    const page = await deps.registry.sessionRows(id, before, limit);
    if (page === undefined) return c.json({ error: "session not found" }, 404);
    return c.json(page);
  });

  // ── 输入投递（D-045 单口：闲直跑 / 忙入队；模型/思考按次覆盖可选——每次提问绑定）──
  app.post("/api/sessions/:id/prompt", async (c) => {
    const entry = await requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    const parsed = z
      .object({
        text: z.string().min(1),
        modelId: z.string().min(1).optional(),
        reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "text required" }, 400);
    const receipt = await entry.ctx.get("loop").send(parsed.data.text, {
      modelId: parsed.data.modelId,
      reasoningEffort: parsed.data.reasoningEffort,
    });
    return c.json({ queued: receipt.id !== "", id: receipt.id === "" ? null : receipt.id });
  });

  app.post("/api/sessions/:id/steer", async (c) => {
    const entry = await requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    const parsed = z
      .object({ entryId: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "entryId required" }, 400);
    return c.json({ ok: await entry.ctx.get("loop").steer(parsed.data.entryId) });
  });

  app.post("/api/sessions/:id/interrupt", async (c) => {
    const entry = await requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    await entry.ctx.get("loop").interrupt();
    return c.json({ ok: true });
  });

  // useResource 数据泵单跳（plugins.md §4 / D-064）：所有权闸（地址 pluginId 必须 = 调用方
  // 插件且该插件声明了此 server，越权 403）在 registry——30s 超时与 200 × 1024 字符截断同层
  app.post("/api/sessions/:id/resource", async (c) => {
    const entry = await requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    const parsed = z
      .object({ pluginId: z.string().min(1), address: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "pluginId and address required" }, 400);
    const result = await deps.registry.callResource(
      entry.id,
      parsed.data.pluginId,
      parsed.data.address,
    );
    return c.json(result.body, result.status as 200);
  });

  // ── 审批收答（settle 幂等先答者赢；行投影由账本驱动）──
  app.post("/api/sessions/:id/approvals/:requestId", async (c) => {
    const entry = await requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    const parsed = z
      .object({ decision: z.enum(DECISIONS) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: `decision must be one of ${DECISIONS.join("/")}` }, 400);
    }
    const requestId = c.req.param("requestId");
    const applied = entry.interaction.settle(requestId, {
      kind: "approval",
      requestId,
      decision: parsed.data.decision,
    });
    return c.json({ applied });
  });

  // ── 会话工作区文件（UI 门面 listDir；只限会话工作区，隐藏项不返）──
  app.get("/api/sessions/:id/files", async (c) => {
    const entry = await requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    const relative = c.req.query("path") ?? "";
    const root = path.resolve(entry.cwd);
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return c.json({ error: "path escapes session workspace" }, 400); // 路径围栏
    }
    let dirents: import("node:fs").Dirent[];
    try {
      dirents = await fs.readdir(target, { withFileTypes: true });
    } catch {
      return c.json({ error: "not readable" }, 400);
    }
    const entries = [];
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) continue; // 隐藏项不返
      const stat = await fs.stat(path.join(target, dirent.name)).catch(() => undefined);
      entries.push({
        name: dirent.name,
        kind: dirent.isDirectory() ? ("dir" as const) : ("file" as const),
        size: dirent.isFile() ? stat?.size : undefined,
        mtime: stat?.mtimeMs,
      });
    }
    return c.json(entries);
  });

  // ── 删会话（data-directory §7：删账本目录整棵；busy 拒绝——先中断再删）──
  app.delete("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const entry = deps.registry.get(id);
    if (entry?.projection.state.busy === true) {
      return c.json(
        { code: "session_busy", message: "session is busy; abort it before deletion" },
        409,
      );
    }
    let deleted: boolean;
    try {
      deleted = await deps.registry.deleteSession(id);
    } catch (err) {
      // 同删目录：失败必须有形状（Windows EBUSY/EPERM 偶发——detail 进 UI 与 serve 终端）
      console.error(`[server] DELETE /api/sessions/${id} failed`, err);
      return c.json(
        { error: "delete failed", detail: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
    if (!deleted) return c.json({ error: "session not found" }, 404);
    return c.json({ ok: true });
  });

  // ── 登记工作目录（data-directory §4 projects.json；D-060）──
  app.get("/api/dirs", async (c) => {
    return c.json(await deps.dirs.list());
  });

  app.post("/api/dirs", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cwd?: string };
    if (typeof body.cwd !== "string" || body.cwd.trim() === "") {
      return c.json({ error: "cwd is required" }, 400);
    }
    if (!isAbsoluteCwd(body.cwd)) return c.json({ error: "cwd must be an absolute path" }, 400);
    const resolved = path.resolve(body.cwd);
    const stat = await fs.stat(resolved).catch(() => undefined);
    if (stat === undefined)
      return c.json({ error: "path does not exist or is not accessible" }, 400);
    if (!stat.isDirectory()) return c.json({ error: "path exists but is not a directory" }, 400);
    const dir = await deps.dirs.upsert(resolved);
    return c.json({ ok: true, dir });
  });

  // busy 拒绝走 200 + {ok:false, blocked}（批操作语义，与删会话 409 双轨）
  app.delete("/api/dirs/:id", async (c) => {
    const id = c.req.param("id");
    const dir = await deps.dirs.get(id);
    if (dir === undefined) return c.json({ ok: true }); // 未知 id 幂等
    const blocked = [...deps.registry.sessions()]
      .filter((e) => sameCwd(e.cwd, dir.cwd) && e.projection.state.busy)
      .map((e) => e.id);
    if (blocked.length > 0) return c.json({ ok: false, blocked });
    // key 只从登记条目取（registry 侧形态闸兜底）——账本树+检查点树+登记条目三处同删（§7）
    try {
      await deps.registry.removeProject(dir.key);
      await deps.dirs.remove(id);
    } catch (err) {
      // 删除失败必须有形状（Windows EBUSY/EPERM 偶发——裸 500 无从排查；detail 进 UI 与 serve 终端）
      console.error(`[server] DELETE /api/dirs/${id} failed`, err);
      return c.json(
        { error: "delete failed", detail: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
    return c.json({ ok: true });
  });

  // ── 全局目录浏览（新增目录弹窗数据源；共享实现住 plugin-session browseDirectories，
  //      回环+token 中间件之上，D-060 信任边界 ADR）──
  app.get("/api/dirs/browse", async (c) => {
    try {
      return c.json(await browseDirectories(c.req.query("path")));
    } catch {
      return c.json({ error: "directory does not exist or is not accessible" }, 404);
    }
  });

  // ── 设置页（data-directory §2.3：程序写 settings.json；凭据只写不读 D-030）──
  app.get("/api/settings", async (c) => {
    return c.json((await readSettings(deps.globalDir)) ?? { version: 1 as const });
  });

  app.put("/api/settings", async (c) => {
    const parsed = z
      .object({
        model: z.string().min(1).optional(),
        ui: z.object({ theme: z.string().optional(), locale: z.string().optional() }).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid settings patch" }, 400);
    return c.json(await writeSettings(deps.globalDir, parsed.data));
  });

  // ── 会话绑定界面状态（D-063：全局 state/ui.json + 每会话 <sessionDir>/ui-state.json；
  //    状态不进事件账本（P9-1 同 queue 先例）；服务端只验证不解释——整份收发 + 64KB 上限，
  //    形状归 web 宿主；删会话随整树走）──
  app.get("/api/ui-state", async (c) => {
    return c.json(await readGlobalUiState(deps.dataDir));
  });

  app.put("/api/ui-state", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { lastSessionId?: unknown } | null;
    if (
      body === null ||
      typeof body !== "object" ||
      !("lastSessionId" in body) ||
      !(typeof body.lastSessionId === "string" || body.lastSessionId === null)
    ) {
      return c.json({ error: "invalid ui state" }, 400);
    }
    await writeGlobalUiState(deps.dataDir, { lastSessionId: body.lastSessionId });
    return c.json({ ok: true });
  });

  app.get("/api/sessions/:id/ui-state", async (c) => {
    const dir = await deps.registry.resolveSessionDir(c.req.param("id"));
    if (dir === undefined) return c.json({ error: "session not found" }, 404);
    return c.json(await readSessionUiState(dir));
  });

  app.put("/api/sessions/:id/ui-state", async (c) => {
    const dir = await deps.registry.resolveSessionDir(c.req.param("id"));
    if (dir === undefined) return c.json({ error: "session not found" }, 404);
    const body: unknown = await c.req.json().catch(() => null);
    const check = validateSessionUiState(body);
    if (!check.ok) return c.json({ error: check.reason }, 400);
    await writeSessionUiState(dir, body as SessionUiState);
    return c.json({ ok: true });
  });

  // ── 模型管理面（选择器清单 / 管理分组 / 厂商选择页共用一套数据层）──
  // 数据源 = credentials.json 厂商 id ∪ models.json 目录条目；快照厂商模型表来自
  // config-loader 字典（快照 + 缓存 + 在线刷新），自定义厂商 = models.json 显式 models 清单。
  let dictionaryReady: Promise<ModelDictionary> | undefined;
  const getDictionary = (): Promise<ModelDictionary> => {
    dictionaryReady ??= (async () => {
      const dict = deps.dictionary ?? new Dictionary(deps.globalDir, fetch);
      await dict.loadCache();
      return dict;
    })();
    return dictionaryReady;
  };

  /** 厂商全集（凭据在册 ∪ models.json 在册）+ 两表原文——连接态与管理分组共用 */
  const providerUnion = async (): Promise<{
    credIds: string[];
    ids: string[];
    modelsFile: ModelsFile;
  }> => {
    const [credIds, modelsFile] = await Promise.all([
      listCredentialProviders(deps.globalDir),
      readModelsFile(deps.globalDir),
    ]);
    return {
      credIds,
      ids: [...new Set([...credIds, ...Object.keys(modelsFile.providers ?? {})])],
      modelsFile,
    };
  };

  /** 单厂商模型条目（含开关态）：快照全表 ∪ 显式 models，hidden = 关 */
  const modelEntries = (
    id: string,
    modelsFile: ModelsFile,
  ): Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    vision?: boolean;
    reasoning?: boolean;
    reasoningOptions?: ReasoningOption[];
    enabled: boolean;
  }> => {
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
  };

  app.get("/api/models", async (c) => {
    // 选择器清单（模型目录收敛批）：key + baseUrl 齐备的厂商才出现——断开（摘 key）即从
    // 选择器消失、缺地址（必然跑不通）不出现；条目带显示名/上下文窗/徽章位。
    // 思考档批（2026-11-19）：模型条目带 reasoningOptions（models.dev 档位集合真源）——
    // UI 档位按数据驱动；provider 级 reasoning 保留作形状/兜底提示
    const { credIds, modelsFile } = await providerUnion();
    const providers: Record<
      string,
      {
        name?: string;
        baseUrl?: string;
        reasoning?: ReasoningCapability;
        models: Array<{
          id: string;
          name?: string;
          contextWindow?: number;
          vision?: boolean;
          reasoning?: boolean;
          reasoningOptions?: ReasoningOption[];
        }>;
      }
    > = {};
    for (const id of new Set([...credIds, ...Object.keys(modelsFile.providers ?? {})])) {
      const entry = modelsFile.providers?.[id];
      // 闸门：缺地址（必然跑不通）不可选；已知厂商还需 key 在册（断开即摘除）——
      // 自定义厂商 key 可选（无 key 也算连接，既有语义）
      if (entry?.baseUrl === undefined) continue;
      if (!credIds.includes(id) && SNAPSHOT[id] !== undefined) continue;
      const baseUrl = entry.baseUrl;
      providers[id] = {
        name: entry.label ?? SNAPSHOT[id]?.name, // 用户显示名优先（与管理页同口径——收敛批审查 2026-11-19）
        baseUrl,
        reasoning: reasoningCapability(id), // 思考参数形状提示（UI 档位兜底依据）
        models: modelEntries(id, modelsFile)
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
    return c.json({ providers });
  });

  // 管理分组（模型管理页主视图）：连接态 + 显示名 + 模型条目（含开关/上下文窗/显示名）
  app.get("/api/providers", async (c) => {
    const { credIds, ids, modelsFile } = await providerUnion();
    const list = ids.map((id) => {
      const dict = SNAPSHOT[id];
      const override = modelsFile.providers?.[id];
      return {
        id,
        name: override?.label ?? dict?.name ?? id,
        baseUrl: override?.baseUrl,
        reasoning: reasoningCapability(id),
        connected:
          credIds.includes(id) || (dict === undefined && modelsFile.providers?.[id] !== undefined),
        models: modelEntries(id, modelsFile),
      };
    });
    list.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
    return c.json({ providers: list });
  });

  // 厂商选择页预设全表（config-loader 字典：快照 + 本地缓存合并视图；无密钥）
  app.get("/api/models.presets", async (c) => {
    const dict = await getDictionary();
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
    return c.json({ presets });
  });

  // 在线刷新模型目录（models.dev；失败 = 保留快照/缓存现状，P2 观测由调用方呈现）
  app.post("/api/models.presets/refresh", async (c) => {
    const dict = await getDictionary();
    return c.json({ ok: await dict.refresh() });
  });

  // 连接已知厂商（只填 key；Henira 无 env 兜底——key 必填，D-030 只进 credentials.json）
  app.put("/api/providers/:id/connect", async (c) => {
    const parsed = z
      .object({ key: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "key required" }, 400);
    const id = c.req.param("id");
    await writeCredential(deps.globalDir, id, parsed.data.key);
    // 目录种子（模型目录收敛批）：已知厂商缺 baseUrl 时从快照 endpoint 补——连接即可跑，
    // 用户永不手写地址（引擎仍只认 models.json，P9-4 不破）
    const modelsFile = await readModelsFile(deps.globalDir);
    const entry = modelsFile.providers?.[id] ?? {};
    const endpoint = SNAPSHOT[id]?.endpoint;
    if (entry.baseUrl === undefined && endpoint !== undefined) {
      await writeModelsFile(deps.globalDir, {
        ...modelsFile,
        providers: { ...(modelsFile.providers ?? {}), [id]: { ...entry, baseUrl: endpoint } },
      });
    }
    return c.json({ ok: true }); // GET 无对应端点（D-030：明文永不回读）
  });

  // 开关显隐（models.json hidden 清单；开 = 移出清单，关 = 加入）
  app.put("/api/providers/:id/models/:model/enabled", async (c) => {
    const parsed = z
      .object({ enabled: z.boolean() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "enabled boolean required" }, 400);
    const id = c.req.param("id");
    const model = c.req.param("model");
    if (model.trim() === "") return c.json({ error: "model required" }, 400);
    const modelsFile = await readModelsFile(deps.globalDir);
    const entry = modelsFile.providers?.[id] ?? {};
    const hidden = new Set(entry.hidden ?? []);
    if (parsed.data.enabled) hidden.delete(model);
    else hidden.add(model);
    await writeModelsFile(deps.globalDir, {
      ...modelsFile,
      providers: {
        ...(modelsFile.providers ?? {}),
        [id]: { ...entry, hidden: [...hidden].sort() },
      },
    });
    return c.json({ ok: true });
  });

  // 自定义 OpenAI 兼容厂商（models.json 显式 models 清单 + 可选 key；请求头引擎不消费不收）
  app.post("/api/providers/custom", async (c) => {
    const parsed = z
      .object({
        label: z.string().optional(),
        baseUrl: z.string().url(),
        key: z.string().min(1).optional(),
        models: z
          .array(z.object({ model: z.string().min(1), label: z.string().optional() }))
          .min(1),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "baseUrl + at least one model required" }, 400);
    const { label, baseUrl, key, models } = parsed.data;
    const slug =
      (label ?? "provider")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "provider";
    const id = `user-${slug}-${randomBytes(2).toString("hex")}`;
    if (key !== undefined) await writeCredential(deps.globalDir, id, key);
    const modelsFile = await readModelsFile(deps.globalDir);
    await writeModelsFile(deps.globalDir, {
      ...modelsFile,
      providers: {
        ...(modelsFile.providers ?? {}),
        [id]: {
          ...(label === undefined ? {} : { label }),
          baseUrl,
          models: Object.fromEntries(
            models.map((m) => [m.model, m.label === undefined ? {} : { label: m.label }]),
          ),
        },
      },
    });
    return c.json({ ok: true, id });
  });

  // 断开厂商：credentials.json 摘键（值从不回读）；models.json 分档——已知厂商只清显隐
  // （baseUrl/label 是承重配置，永不碰——2026-11-19 教训：整条删毁过用户手写地址）；
  // 自定义厂商（user-*，面板自建）整条删
  app.delete("/api/providers/:id", async (c) => {
    const id = c.req.param("id");
    await removeCredential(deps.globalDir, id);
    const modelsFile = await readModelsFile(deps.globalDir);
    if (modelsFile.providers?.[id] !== undefined) {
      const providers = { ...modelsFile.providers };
      if (SNAPSHOT[id] === undefined) {
        delete providers[id];
      } else {
        const rest = { ...providers[id] };
        delete rest.hidden;
        if (Object.keys(rest).length === 0) delete providers[id];
        else providers[id] = rest;
      }
      await writeModelsFile(deps.globalDir, { ...modelsFile, providers });
    }
    return c.json({ ok: true });
  });

  app.put("/api/credentials/:provider", async (c) => {
    const parsed = z
      .object({ key: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "key required" }, 400);
    await writeCredential(deps.globalDir, c.req.param("provider"), parsed.data.key);
    return c.json({ ok: true }); // GET 无对应端点（D-030：明文永不回读）
  });

  // ── 界面资产（D-059 语言包/主题包）：清单 + 只读伺服（同 ui/ 静态路由纪律：只读版本目录、禁穿越）──
  app.get("/api/ui-assets", async (c) => {
    return c.json(await scanUiAssets(deps.pluginRoot));
  });

  // ── 插件清单（批 C：plugins.md §5 状态模型；官方五件 + 目录件；指纹供 UI 轮询重装）──
  app.get("/api/plugins", async (c) => {
    return c.json(await deps.registry.pluginSnapshot());
  });

  // 确认卡放行（engine 件首次生效 / 版本升级，§4 安全规则）：写 settings.plugins.<id>.confirmedVersion
  app.post("/api/plugins/:id/confirm", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { version?: unknown };
    const version = typeof body.version === "string" ? body.version : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
      return c.json({ error: "invalid plugin id or version" }, 400);
    }
    const ok = await deps.registry.confirmPlugin(id, version);
    if (!ok) return c.json({ error: "plugin not found or not an engine plugin" }, 404);
    return c.json({ ok: true });
  });

  // ── 插件管理面（批 C，plugins.md §6.4）：启停 / 版本切换 / 卸载（官方件一律拒绝）──
  app.put("/api/plugins/:id/enabled", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || typeof body.enabled !== "boolean") {
      return c.json({ error: "invalid plugin id or enabled" }, 400);
    }
    const ok = await deps.registry.setPluginEnabled(id, body.enabled);
    if (!ok) return c.json({ error: "plugin not found or official (not toggleable)" }, 404);
    return c.json({ ok: true });
  });

  app.put("/api/plugins/:id/version", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { version?: unknown };
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || typeof body.version !== "string") {
      return c.json({ error: "invalid plugin id or version" }, 400);
    }
    const ok = await deps.registry.setPluginVersion(id, body.version);
    if (!ok) return c.json({ error: "plugin or version not found" }, 404);
    return c.json({ ok: true });
  });

  app.delete("/api/plugins/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      return c.json({ error: "invalid plugin id" }, 400);
    }
    const result = await deps.registry.removePlugin(id);
    if (result === "official") return c.json({ error: "official plugin is not removable" }, 403);
    if (result === "missing") return c.json({ error: "plugin not found" }, 404);
    return c.json({ ok: true });
  });

  // MCP 变更确认放行（D-030/D-064）：写 settings.plugins.<id>.mcpFingerprint（新会话 spawn）
  app.post("/api/plugins/:id/confirm-mcp", async (c) => {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      return c.json({ error: "invalid plugin id" }, 400);
    }
    const ok = await deps.registry.confirmPluginMcp(id);
    if (!ok) return c.json({ error: "plugin not found or has no mcp servers" }, 404);
    return c.json({ ok: true });
  });

  const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  app.get("/api/ui-assets/:id/:version/:kind/:file", async (c) => {
    const { id, version, kind, file } = c.req.param();
    if (
      !SAFE_SEG.test(id) ||
      !SAFE_SEG.test(version) ||
      !SAFE_SEG.test(file) ||
      (kind !== "locales" && kind !== "themes")
    ) {
      return c.json({ error: "invalid asset path" }, 400);
    }
    const root = path.resolve(deps.pluginRoot);
    const resolved = path.resolve(root, id, version, kind, file);
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: "invalid asset path" }, 400);
    try {
      const body = await fs.readFile(resolved);
      const mime =
        kind === "locales" ? "application/json; charset=utf-8" : "text/css; charset=utf-8";
      return c.body(new Uint8Array(body), 200, { "Content-Type": mime });
    } catch {
      return c.json({ error: "asset not found" }, 404);
    }
  });

  // ── 第三方 UI 共享实例 shim（批 C，plugins.md §4 :227 import map 口子）──
  app.get("/api/ui-shims/:file", (c) => {
    const shim = lookupUiShim(c.req.param("file"));
    if (shim === undefined) return c.json({ error: "shim not found" }, 404);
    return c.body(shim, 200, { "content-type": "text/javascript; charset=utf-8" });
  });

  // ── 插件文件伺服（批 C：ui 入口 + 同目录相对依赖；只读版本目录、禁穿越）──
  const UI_FILE_MIME: Record<string, string> = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
  };
  app.get("/api/ui-assets/:id/:version/file/*", async (c) => {
    const id = c.req.param("id");
    const version = c.req.param("version");
    // Hono 通配参数在「中间段后的 *」不可靠：按 path 前缀切片，逐段解码校验
    const prefix = `/api/ui-assets/${id}/${version}/file/`;
    const raw = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    let segments: string[];
    try {
      segments = raw.split("/").map((segment) => decodeURIComponent(segment));
    } catch {
      return c.json({ error: "invalid asset path" }, 400);
    }
    if (
      !SAFE_SEG.test(id) ||
      !SAFE_SEG.test(version) ||
      raw === "" ||
      segments.length === 0 ||
      segments.some((s) => !SAFE_SEG.test(s))
    ) {
      return c.json({ error: "invalid asset path" }, 400);
    }
    const versionDir = path.resolve(deps.pluginRoot, id, version);
    const resolved = path.resolve(versionDir, ...segments);
    if (!resolved.startsWith(versionDir + path.sep)) {
      return c.json({ error: "invalid asset path" }, 400);
    }
    const mime = UI_FILE_MIME[path.extname(resolved).toLowerCase()];
    if (mime === undefined) return c.json({ error: "unsupported asset type" }, 404);
    try {
      const body = await fs.readFile(resolved);
      const headers: Record<string, string> = { "Content-Type": mime };
      // §4 安全规则：html/svg 以文档形式伺服时带 CSP sandbox（ESM 模块与宿主同源，不在此列）
      if (mime.startsWith("text/html") || mime === "image/svg+xml") {
        headers["Content-Security-Policy"] = "sandbox";
      }
      return c.body(new Uint8Array(body), 200, headers);
    } catch {
      return c.json({ error: "asset not found" }, 404);
    }
  });

  // ── SSE 事件流（唯一事件口）──
  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const queue: ServerFrame[] = [];
      let overflow = false;
      let wake: (() => void) | undefined;
      const unsubscribe = deps.fanout.subscribe(c, (frame) => {
        if (queue.length >= QUEUE_CAP) {
          overflow = true; // 溢出 = 本订阅者断开（volatile：客户端重连重拉快照）
          wake?.();
          throw new Error("subscriber queue overflow");
        }
        queue.push(frame);
        wake?.();
      });
      const heartbeat = setInterval(() => {
        void stream.write(": heartbeat\n\n").catch(() => {});
      }, HEARTBEAT_MS);
      const abort = (): void => {
        overflow = true;
        wake?.();
      };
      c.req.raw.signal.addEventListener("abort", abort, { once: true });
      try {
        await stream.writeSSE({ data: JSON.stringify(deps.fanout.connectedFrame()) });
        // 帧序：connected → 在订会话快照帧 → 增量混排（订阅先于快照，不丢中途增量）
        for (const entry of deps.registry.sessions()) {
          await stream.writeSSE({
            data: JSON.stringify({
              kind: "snapshot",
              sessionId: entry.id,
              // 连接快照帧与 GET /snapshot 同窗口化（60）——不一致则 store 里 hasOlder 派生
              // 恒 false（64 行全量 → totalRows==rows.length），翻页永不触发（真浏览器实证）
              snapshot: entry.projection.snapshot(entry.id, deps.fanout.currentSeq(entry.id), {
                tailRows: SNAPSHOT_TAIL_ROWS,
              }),
            } satisfies ServerFrame),
          });
        }
        while (true) {
          while (queue.length > 0) {
            await stream.writeSSE({ data: JSON.stringify(queue.shift() as ServerFrame) });
          }
          if (overflow || c.req.raw.signal.aborted) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      } finally {
        clearInterval(heartbeat);
        c.req.raw.signal.removeEventListener("abort", abort);
        unsubscribe();
      }
    });
  });

  // ── web 静态托管（同源 SPA；dist-web 缺席 = 纯 API 服务；必须最后注册——通配路由）──
  const webDist = deps.webDist;
  if (webDist !== undefined) {
    const indexFile = path.join(webDist, "index.html");
    if (existsSync(indexFile)) {
      const MIME: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
      };
      app.get("*", async (c) => {
        if (c.req.path.startsWith("/api/")) {
          return c.json({ error: "not found" }, 404); // 未知 API 端点绝不 fallback 成页面（401/404 语义保真）
        }
        const rel = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
        const file = path.join(webDist, path.normalize(rel));
        if (!file.startsWith(webDist)) return c.notFound(); // 路径围栏
        try {
          const body = await fs.readFile(file);
          // import map 注入（批 C：第三方 UI 件共享宿主 React 的唯一口子）——只改 index.html
          if (path.extname(file) === ".html") {
            return c.body(injectImportMap(body.toString("utf8")), 200, {
              "content-type": MIME[".html"],
            });
          }
          return c.body(body, 200, {
            "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
          });
        } catch {
          const index = await fs.readFile(indexFile, "utf8"); // SPA fallback
          return c.body(injectImportMap(index), 200, { "content-type": MIME[".html"] });
        }
      });
    }
  }

  return app;
}

/** 写路径会话入口：在订直取；磁盘历史会话懒挂载（重启续聊）——锁冲突 SessionLockedError 冒泡 */
async function requireEntry(c: Context, deps: AppDeps) {
  const id = c.req.param("id");
  if (id === undefined) return undefined;
  return deps.registry.get(id) ?? (await deps.registry.attach(id));
}

/** 绝对路径判据（win32 盘符形或 posix 根形） */
function isAbsoluteCwd(cwd: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith("/") || cwd.startsWith("\\");
}
