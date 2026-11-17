#!/usr/bin/env node
// henira 命令入口（D-018：serve 保留 v1；run = headless 一次性任务 D-037；聊天发布后）。
// CLI 是命令路由不是界面（hosts.md §2 注）；业务装配在 server / sdk，本文件只做 arg 解析、
// henira.config.ts 装载接线与事件流到终端的投影打印。
// 输出纪律：引擎消息英文永不本地化（D-050 第 2 款）；cli 框架行（用法 / 提示）随 TUI / 聊天批进 locale 词表。

import { loadConfig, type PluginEntry } from "@henira/config-loader";
import type { ServiceDefinition } from "@henira/kernel";
import type { LlmRequest, LlmService } from "@henira/protocol";
import { createRuntime } from "@henira/sdk";
import { createServer } from "@henira/server";

interface Args {
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, "true");
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const HELP = `henira — open-source agent harness (kernel provides mechanisms; everything else is a plugin)

Usage:
  henira serve [--port N] [--host H] [--cwd DIR]   start the HTTP + SSE host (D-018)
  henira run "prompt" [--cwd DIR] [--mock]        one-shot headless task, in-process (D-037)

Options:
  --cwd DIR     working directory (default: process cwd)
  --port N      server port (serve; default: random)
  --host H      server host (serve; default: 127.0.0.1)
  --mock        use built-in mock LLM (offline demo; no credentials needed)
  --help        show this help`;

/** mock LLM 桩（--mock：离线 demo；回应最后一条用户消息 + 固定 usage/finish） */
function mockLlmService(): ServiceDefinition<LlmService> {
  return {
    name: "llm",
    start(): LlmService {
      return {
        stream: async function* (req: LlmRequest, _signal: AbortSignal) {
          const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
          const text =
            typeof lastUser?.content === "string" ? lastUser.content.slice(0, 80) : "hello";
          yield { type: "text-delta" as const, text: `[mock] ${text}` };
          yield { type: "usage" as const, usage: { inputTokens: 1, outputTokens: 1 } };
          yield { type: "finish" as const, reason: "stop" as const };
        },
      };
    },
  };
}

/** 项目 henira.config.ts 的插件清单 → 装配物（definition 缺省的纯内容包条目跳过——不占引擎槽位） */
async function loadPluginDefinitions(cwd: string): Promise<ServiceDefinition<unknown>[]> {
  const cfg = await loadConfig(cwd);
  return (cfg.plugins ?? [])
    .map((entry: PluginEntry) => entry.definition)
    .filter((def): def is ServiceDefinition<unknown> => def !== undefined);
}

async function serve(args: Args): Promise<void> {
  const cwd = args.flags.get("cwd") ?? process.cwd();
  process.chdir(cwd); // 会话 cwd 与 server 进程 cwd 一致（会话目录按 cwd 派生，data-directory §4）
  const plugins = await loadPluginDefinitions(process.cwd());
  const server = await createServer({
    port: args.flags.has("port") ? Number(args.flags.get("port")) : undefined,
    host: args.flags.get("host"),
    plugins,
    llm: args.flags.has("mock") ? mockLlmService() : undefined,
  });
  console.log(`henira serve listening on ${server.url}`);
  console.log("handshake: ~/.henira/state/server.json (clients discover via this file)");
  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

async function run(args: Args): Promise<void> {
  const prompt = args.positional.slice(1).join(" ").trim();
  if (prompt === "") {
    console.error('usage: henira run "prompt"');
    process.exit(1);
  }
  const cwd = args.flags.get("cwd") ?? process.cwd();
  process.chdir(cwd);
  const plugins = await loadPluginDefinitions(process.cwd());
  const runtime = await createRuntime({
    plugins,
    llm: args.flags.has("mock") ? mockLlmService() : undefined,
  });
  const session = await runtime.createSession({ cwd: process.cwd() });

  // 事件流 → 终端投影：回合 busy=true 起步、busy=false 收尾即退出（headless 一次性语义）
  const consuming = (async (): Promise<void> => {
    let seenBusy = false;
    for await (const frame of runtime.events()) {
      if (frame.kind !== "delta") continue;
      const delta = frame.delta;
      if (delta.op === "state.updated") {
        if (delta.state.busy) seenBusy = true;
        else if (seenBusy) return;
        continue;
      }
      if (delta.op === "row.appended" || delta.op === "row.upserted") {
        const row = delta.row;
        if (row.kind === "assistant" && !row.streaming && row.text !== "") {
          console.log(row.text);
        } else if (row.kind === "tool" && row.output !== undefined) {
          console.error(`[tool] ${row.name} → ${row.status} (${row.output.durationMs}ms)`);
        } else if (row.kind === "error") {
          console.error(`[error] ${row.message}`);
        }
      }
    }
  })();

  await runtime.prompt(session.id, prompt);
  await consuming; // busy=false 或流断开即回
  await runtime.stop();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  if (command === "serve") return serve(args);
  if (command === "run") return run(args);
  console.log(HELP);
  if (command !== undefined && command !== "help") process.exit(1);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
