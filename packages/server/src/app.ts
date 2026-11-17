// HTTP 面（interfaces.md server 段 REST 命令面 + SSE）：回环三件套中间件（D-035 判据⑤——
// 只绑回环由 server.ts 负责，此处管 Host/Origin 校验与可选 token）+ REST 路由 + SSE 端点。
// SSE 帧序 = connected → 在订会话快照帧 → 增量帧混排；15s 注释心跳；有界队列溢出断开。

import { existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { scanUiAssets } from "@henira/config-loader";
import { DECISIONS, rebuildProjection, type ServerFrame } from "@henira/protocol";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Fanout } from "./fanout.js";
import type { SessionRegistry } from "./session-registry.js";
import { readSettings, writeCredential, writeSettings } from "./settings-store.js";

/** 每订阅者有界队列容量；溢出 = 断开（volatile：客户端重连重拉快照） */
const QUEUE_CAP = 256;
const HEARTBEAT_MS = 15_000;

export interface AppDeps {
  registry: SessionRegistry;
  fanout: Fanout;
  globalDir: string;
  version: string;
  startedAt: number;
  token?: string;
  /** web 静态产物目录（packages/web/dist-web；缺席 = 纯 API 服务） */
  webDist?: string;
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

/** models.dev 快照（config-loader 导出子路径）：provider → 可选模型清单 */
const requireResolve = createRequire(import.meta.url);

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

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
    const entry = await deps.registry.create({ cwd: body.cwd });
    return c.json({ id: entry.id, cwd: entry.cwd, busy: false });
  });

  app.get("/api/sessions", async (c) => {
    return c.json(await deps.registry.list());
  });

  app.get("/api/sessions/:id/snapshot", async (c) => {
    const id = c.req.param("id");
    const entry = deps.registry.get(id);
    if (entry !== undefined) {
      return c.json(entry.projection.snapshot(id, deps.fanout.currentSeq(id)));
    }
    // 磁盘历史会话（本进程未装配）：从账本重建快照（真相兜底）
    const events = await deps.registry.ledgerEvents(id);
    if (events === undefined) return c.json({ error: "session not found" }, 404);
    return c.json(rebuildProjection(events).snapshot(id, deps.fanout.currentSeq(id)));
  });

  // ── 输入投递（D-045 单口：闲直跑 / 忙入队）──
  app.post("/api/sessions/:id/prompt", async (c) => {
    const entry = requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    const parsed = z
      .object({ text: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "text required" }, 400);
    const receipt = await entry.ctx.get("loop").send(parsed.data.text);
    return c.json({ queued: receipt.id !== "", id: receipt.id === "" ? null : receipt.id });
  });

  app.post("/api/sessions/:id/steer", async (c) => {
    const entry = requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    const parsed = z
      .object({ entryId: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "entryId required" }, 400);
    return c.json({ ok: await entry.ctx.get("loop").steer(parsed.data.entryId) });
  });

  app.post("/api/sessions/:id/interrupt", async (c) => {
    const entry = requireEntry(c, deps);
    if (entry === undefined) return c.json({ error: "session not found" }, 404);
    await entry.ctx.get("loop").interrupt();
    return c.json({ ok: true });
  });

  // ── 审批收答（settle 幂等先答者赢；行投影由账本驱动）──
  app.post("/api/sessions/:id/approvals/:requestId", async (c) => {
    const entry = requireEntry(c, deps);
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
    const entry = requireEntry(c, deps);
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

  app.get("/api/models", async (c) => {
    // 手写覆盖字典（models.json）+ 各 provider 在 models.dev 快照下的可选模型清单
    let overrides: { providers?: Record<string, { baseUrl?: string }> } = {};
    try {
      overrides = JSON.parse(await fs.readFile(path.join(deps.globalDir, "models.json"), "utf8"));
    } catch {
      // 未配置 = 空表
    }
    const providers: Record<string, { baseUrl?: string; models?: string[] }> = {};
    for (const [id, value] of Object.entries(overrides.providers ?? {})) {
      providers[id] = { ...value };
    }
    let dictionary: Record<string, { models: Record<string, unknown> }> = {};
    try {
      const snapshot = requireResolve.resolve("@henira/config-loader/models-dev-snapshot.json");
      dictionary = JSON.parse(await fs.readFile(snapshot, "utf8"));
    } catch {
      // 快照缺失：仅返回手写条目
    }
    for (const id of Object.keys(providers)) {
      const dict = dictionary[id];
      providers[id].models = dict === undefined ? undefined : Object.keys(dict.models);
    }
    return c.json({ providers });
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
    return c.json(await scanUiAssets(deps.globalDir));
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
    const root = path.resolve(deps.globalDir, "plugins");
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
              snapshot: entry.projection.snapshot(entry.id, deps.fanout.currentSeq(entry.id)),
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
          return c.body(body, 200, {
            "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
          });
        } catch {
          const index = await fs.readFile(indexFile); // SPA fallback
          return c.body(index, 200, { "content-type": MIME[".html"] });
        }
      });
    }
  }

  return app;
}

function requireEntry(c: Context, deps: AppDeps) {
  const id = c.req.param("id");
  return id === undefined ? undefined : deps.registry.get(id);
}
