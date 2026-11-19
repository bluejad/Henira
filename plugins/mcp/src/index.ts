// plugin-mcp：MCP 读者（interfaces.md §mcp 契约小节 / D-064）。
// 按宿主扫描喂入的 server 声明连接外部 MCP server（官方 @modelcontextprotocol SDK：
// stdio / streamable HTTP），把工具转接进 tools 注册表；服务形状 = McpService.call 最小面。
// 语义钉子（D-064）：异步连接不阻塞开屏；list_changed 整代原子换注册（失败保旧代，sync 单队列
// 串行）；有界退避耗尽 → 注销该 server 全部工具 + 告警（新会话重来）；stdio 死亡不自动 respawn；
// 密钥只以解析后的值进内存——本件不读 credentials.json、不回显 env / headers。

import { createHash } from "node:crypto";
import type { Disposable, ServiceDefinition } from "@henira/kernel";
import type {
  McpCallResult,
  McpServerSpec,
  McpService,
  ToolDefinition,
  ToolsService,
} from "@henira/protocol";
import {
  Client,
  StreamableHTTPClientTransport,
  type Tool,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/** 工具名上限（生态通行约束；dsh 同款语义，自家实现） */
const NAME_MAX = 64;
/** 退避重试上限（D-064：1s × 2，3 次后放弃本轮） */
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export interface McpPluginOptions {
  /** 已确认且通过 D-032 去重的 server 声明（宿主装配前置产出，凭据已展开） */
  servers: readonly McpServerSpec[];
  /** stdio 子进程环境（宿主清洗父环境 + 展开凭据后传入；缺省仅传 PATH 级最小集不做——必须显式给） */
  spawnEnv: Record<string, string>;
  /** 单次工具调用超时（默认 60s；useResource 泵的 30s 由调用方 signal 控制） */
  callTimeoutMs?: number;
  /** 告警出口（宿主接 console.warn；缺省直落 console.warn） */
  warn?: (message: string) => void;
  /** 客户端身份（initialize 握手用） */
  clientVersion?: string;
}

/** 模型可见名：`mcp__<server>__<tool>`；非法字符 → `_`，超长截断 + 短哈希防塌缩（D-064） */
export function publicToolName(server: string, tool: string): string {
  const raw = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (raw.length <= NAME_MAX) return raw;
  const suffix = createHash("sha256").update(`${server}\u0000${tool}`).digest("hex").slice(0, 8);
  return `${raw.slice(0, NAME_MAX - 1 - suffix.length)}-${suffix}`;
}

/** MCP 工具 → 注册表 ToolDefinition：isConcurrencySafe 恒缺省（外部 server 默认过审批，D-039 判定链不变） */
function toToolDefinition(
  spec: McpServerSpec,
  tool: Tool,
  conn: ServerConnection,
): ToolDefinition | undefined {
  if (typeof tool.name !== "string" || tool.name === "") return undefined;
  const schema = tool.inputSchema;
  if (schema === undefined || schema === null || typeof schema !== "object") return undefined;
  const raw = tool.name;
  return {
    name: publicToolName(spec.server, tool.name),
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: schema as ToolDefinition["inputSchema"],
    execute: (args, ctx) => conn.call(raw, args, ctx.signal),
  };
}

/** 结果内容 → text join：text 按序拼接；image / audio / resource 以占位行计入（blob 落盘挂账） */
function resultToText(blocks: unknown, structured: unknown): string {
  const lines: string[] = [];
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (block === null || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        lines.push(b.text);
      } else if (b.type === "image" || b.type === "audio") {
        lines.push(`[${String(b.type)} content omitted (${String(b.mimeType ?? "unknown")})]`);
      } else if (b.type === "resource_link" && typeof b.uri === "string") {
        lines.push(`[resource link: ${b.uri}]`);
      } else if (b.type === "resource") {
        lines.push(`[embedded resource omitted]`);
      } else {
        lines.push(`[unsupported content block: ${String(b.type ?? "unknown")}]`);
      }
    }
  }
  if (lines.length === 0 && structured !== undefined && structured !== null) {
    try {
      lines.push(JSON.stringify(structured));
    } catch {
      /* 结构化内容不可序列化 = 视为空结果 */
    }
  }
  return lines.join("\n");
}

/** 单 server 连接：连接 / 退避 / 同步（整代换注册）/ 调用 / 关闭 */
class ServerConnection {
  #client: Client | undefined;
  /** 当前代已注册工具的撤销器（dispose 旧代 → 注册新代；失败保旧代） */
  #gen: Array<{ name: string; dispose: Disposable }> = [];
  #retries = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  /** sync 单队列串行（防 list_changed 与重连的注册交错，D-064） */
  #chain: Promise<void> = Promise.resolve();

  constructor(
    readonly spec: McpServerSpec,
    private readonly tools: ToolsService,
    private readonly opts: McpPluginOptions,
    /** 全插件共享的在册工具名 → 所属 server key（跨 server 撞名检测，D-064） */
    private readonly nameOwners: Map<string, string>,
  ) {}

  get key(): string {
    return `${this.spec.pluginId}/${this.spec.server}`;
  }

  #warn(message: string): void {
    (this.opts.warn ?? ((m) => console.warn(`[mcp] ${m}`)))(`${this.key}: ${message}`);
  }

  get connected(): boolean {
    return this.#client !== undefined;
  }

  /** 启动入口：异步连（不阻塞装配）；结果走 #chain 串行落 */
  begin(): void {
    void this.#chain.then(() => this.#attempt());
  }

  async dispose(): Promise<void> {
    this.#stopped = true;
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
    this.#dropGeneration();
    const client = this.#client;
    this.#client = undefined;
    if (client !== undefined) {
      try {
        await client.close();
      } catch {
        /* 关闭失败不外抛（卸载路径） */
      }
    }
  }

  call(
    rawTool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult> {
    const client = this.#client;
    if (client === undefined) {
      return Promise.reject(new Error(`MCP server 未连接：${this.key}`));
    }
    return client
      .callTool(
        { name: rawTool, arguments: args },
        {
          signal,
          timeout: this.opts.callTimeoutMs ?? 60_000,
        },
      )
      .then((result) => {
        const payload = result as Record<string, unknown>;
        return {
          content: resultToText(payload.content, payload.structuredContent),
          isError: payload.isError === true ? true : undefined,
        };
      });
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    if (this.#retries >= MAX_RETRIES) {
      this.#dropGeneration(); // 耗尽：注销该 server 全部工具（新会话重来，不 crash-loop）
      this.#warn(`连接失败已重试 ${MAX_RETRIES} 次——放弃本轮，工具已注销`);
      return;
    }
    const delay = RETRY_BASE_MS * 2 ** this.#retries;
    this.#retries += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.#chain.then(() => this.#attempt());
    }, delay);
  }

  async #attempt(): Promise<void> {
    if (this.#stopped) return;
    const spec = this.spec;
    let transport: Transport;
    try {
      if (spec.kind === "stdio") {
        if (spec.command === undefined) throw new Error("stdio 声明缺 command");
        transport = new StdioClientTransport({
          command: spec.command,
          args: spec.args !== undefined ? [...spec.args] : [],
          env: { ...this.opts.spawnEnv, ...(spec.env ?? {}) },
        });
      } else {
        if (spec.url === undefined) throw new Error("remote 声明缺 url");
        transport = new StreamableHTTPClientTransport(new URL(spec.url), {
          requestInit: spec.headers !== undefined ? { headers: { ...spec.headers } } : undefined,
        });
      }
      const client = new Client(
        { name: "henira-plugin-mcp", version: this.opts.clientVersion ?? "0.0.0" },
        {
          listChanged: {
            tools: {
              onChanged: (err) => {
                if (err !== null) {
                  this.#warn(`工具清单刷新失败：${err.message}——保留当前代`);
                  return;
                }
                void this.#chain.then(() => this.#sync());
              },
            },
          },
        },
      );
      client.onclose = () => {
        if (!this.#stopped) this.#scheduleReconnect();
      };
      client.onerror = (err) => {
        if (!this.#stopped) this.#warn(`连接错误：${err.message}`);
      };
      await client.connect(transport);
      this.#client = client;
      this.#retries = 0;
      await this.#sync();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#warn(`连接失败：${message}`);
      this.#scheduleReconnect();
    }
  }

  /** 整代原子换注册：新代任何名字冲突 / 注册抛错 → 丢弃新代、保旧代（D-064） */
  async #sync(): Promise<void> {
    const client = this.#client;
    if (client === undefined || this.#stopped) return;
    let listed: Tool[];
    try {
      const result = await client.listTools();
      listed = (result as { tools?: Tool[] }).tools ?? [];
    } catch (err) {
      this.#warn(
        `tools/list 失败：${err instanceof Error ? err.message : String(err)}——保留当前代`,
      );
      return;
    }
    const defs: ToolDefinition[] = [];
    const seenInGen = new Set<string>();
    for (const tool of listed) {
      const def = toToolDefinition(this.spec, tool, this);
      if (def === undefined) {
        this.#warn(`工具 "${String((tool as { name?: unknown }).name)}" 形状非法——跳过`);
        continue;
      }
      if (seenInGen.has(def.name)) {
        this.#warn(`工具 "${def.name}" 规范化后重名——跳过后者`);
        continue;
      }
      seenInGen.add(def.name);
      defs.push(def);
    }
    // 与其他 server 在册工具撞名 → 整代回滚（要么全有要么全无；D-064）
    const ownOld = new Set(this.#gen.map((g) => g.name));
    const conflict = defs.find((d) => !ownOld.has(d.name) && this.#nameTakenByOther(d.name));
    if (conflict !== undefined) {
      this.#warn(`工具 "${conflict.name}" 与其他 server 撞名——本代全部回滚`);
      return;
    }
    this.#dropGeneration();
    const registered: Array<{ name: string; dispose: Disposable }> = [];
    for (const def of defs) {
      try {
        const dispose = this.tools.register(def);
        this.nameOwners.set(def.name, this.key);
        registered.push({ name: def.name, dispose });
      } catch (err) {
        this.#warn(`注册 "${def.name}" 失败：${err instanceof Error ? err.message : String(err)}`);
        for (const item of registered) {
          item.dispose();
          this.nameOwners.delete(item.name);
        }
        this.#warn("本代注册回滚——保留空代");
        return;
      }
    }
    this.#gen = registered;
  }

  #nameTakenByOther(name: string): boolean {
    const owner = this.nameOwners.get(name);
    return owner !== undefined && owner !== this.key;
  }

  #dropGeneration(): void {
    for (const item of this.#gen) {
      try {
        item.dispose();
      } catch {
        /* 撤销失败不外抛 */
      }
      this.nameOwners.delete(item.name);
    }
    this.#gen = [];
  }
}

/** 官方 plugin-mcp 工厂（占 'mcp' 槽；inject tools——D-049 服务件形状） */
export function mcpPlugin(opts: McpPluginOptions): ServiceDefinition<McpService> {
  return {
    name: "mcp",
    inject: ["tools"],
    start(ctx) {
      const tools = ctx.get<ToolsService>("tools");
      const nameOwners = new Map<string, string>();
      const conns = opts.servers.map((spec) => new ServerConnection(spec, tools, opts, nameOwners));
      for (const conn of conns) conn.begin(); // 异步连：装配不等 server（D-064）
      ctx.effect(() => () => {
        void Promise.all(conns.map((c) => c.dispose()));
      });
      const byKey = new Map(conns.map((c) => [c.key, c] as const));
      const service: McpService = {
        call: (target, args, signal) => {
          const conn = byKey.get(`${target.pluginId}/${target.server}`);
          if (conn === undefined) {
            return Promise.reject(
              new Error(`MCP server 未声明：${target.pluginId}/${target.server}`),
            );
          }
          return conn.call(target.tool, args, signal);
        },
      };
      return service;
    },
  };
}
