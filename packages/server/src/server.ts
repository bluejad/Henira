// server 装配入口：bind（默认 127.0.0.1 随机端口——回环三件套之 ①②）→ state/server.json
// 握手文件（hosts.md §3 进程级共享；data-directory §2 state/ 住处）→ stop 收尾（关 server、
// 销毁会话、清握手文件；SSE 长连接用 closeAllConnections 硬断——客户端重连走发现协议）。

import { existsSync, promises as fs } from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServiceDefinition } from "@henira/kernel";
import type { LlmService } from "@henira/protocol";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { DirRegistry } from "./dir-registry.js";
import { Fanout } from "./fanout.js";
import { SessionRegistry, serverVersion } from "./session-registry.js";

export interface ServerOptions {
  /** 运行数据目录（默认 ~/.henira） */
  dataDir?: string;
  /** 全局配置目录（默认 ~/.henira/config） */
  globalDir?: string;
  /** 监听地址（默认 127.0.0.1——回环三件套之 ①；对公网开放 = 显式配置） */
  host?: string;
  /** 端口（默认 0 = 随机——三件套之 ②） */
  port?: number;
  /** 访问令牌（默认读 HENIRA_SERVER_TOKEN；未设置 = 无 token 校验） */
  token?: string;
  /** llm 槽位替换（测试 / demo 注入；默认官方 llmPlugin） */
  llm?: ServiceDefinition<LlmService>;
  /** 额外引擎插件（henira.config.ts 清单加法，D-016①） */
  plugins?: readonly ServiceDefinition<unknown>[];
  /** web 静态产物目录（缺省自动定位 packages/web/dist-web；找不到 = 纯 API） */
  webDist?: string;
}

export interface HeniraServer {
  url: string;
  port: number;
  token?: string;
  /** 会话注册表（宿主组合面：注册工具、投递 prompt 等经它进各会话） */
  registry: SessionRegistry;
  stop(): Promise<void>;
}

export async function createServer(opts: ServerOptions = {}): Promise<HeniraServer> {
  const dataDir = opts.dataDir ?? process.env.HENIRA_HOME ?? path.join(os.homedir(), ".henira");
  const globalDir = opts.globalDir ?? process.env.HENIRA_CONFIG_DIR ?? path.join(dataDir, "config");
  const host = opts.host ?? "127.0.0.1"; // 三件套 ①
  const port = opts.port ?? 0; // 三件套 ②
  const token = opts.token ?? process.env.HENIRA_SERVER_TOKEN;
  const version = serverVersion();
  const startedAt = Date.now();

  const fanout = new Fanout(version);
  const registry = new SessionRegistry({
    dataDir,
    globalDir,
    llm: opts.llm,
    plugins: opts.plugins,
    fanout,
  });
  const dirs = new DirRegistry({ dataDir });
  const app = createApp({
    registry,
    dirs,
    fanout,
    globalDir,
    version,
    startedAt,
    token,
    webDist: opts.webDist ?? locateWebDist(),
  });

  const server = serve({ fetch: app.fetch, hostname: host, port });
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  // 握手文件（一切客户端发现：port/pid/version/token/urls——bc 同款发现协议的公开重写）
  const stateDir = path.join(dataDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const handshake = path.join(stateDir, "server.json");
  const handshakeBody = `${JSON.stringify(
    {
      port: actualPort,
      pid: process.pid,
      startedAt,
      version,
      cwd: process.cwd(),
      token,
      urls: [url],
    },
    null,
    2,
  )}\n`;
  await fs.writeFile(handshake, handshakeBody, "utf8");

  return {
    url,
    port: actualPort,
    token,
    registry,
    async stop(): Promise<void> {
      // SSE 长连接不空转，close() 会等它们——先全断（volatile 契约：客户端重连重拉快照）
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await registry.disposeAll();
      await fs.rm(handshake, { force: true }).catch(() => {});
    },
  };
}

/** 从本包 dist 上溯定位 packages/web/dist-web（monorepo 布局；独立安装缺席 = 纯 API） */
function locateWebDist(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "packages", "web", "dist-web");
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
