// MCP 声明 → 工厂入参的共享展开（D-064）：server 与 sdk 双形态同函数同语义（规则 3——
// 双形态一致性走共享实现，不各写一份）。纯配置函数：credentials 由宿主读好传入（本模块
// 不读凭据文件）；展开值只进内存——永不进日志 / 响应体 / 账本（D-030）。

import path from "node:path";
import type { McpServerSpec } from "@henira/protocol";
import type { McpServerDecl } from "./discovery.js";

/** stdio 子进程环境清洗（D-064）：剔名称含 KEY/PASSWORD/SECRET/TOKEN 与 HENIRA_* 的变量；
 *  声明 env 显式项在 plugin-mcp 内后合并（可故意放行） */
export function scrubSpawnEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/KEY|PASSWORD|SECRET|TOKEN/i.test(name)) continue;
    if (name.startsWith("HENIRA_")) continue;
    out[name] = value;
  }
  return out;
}

/** command 解析（interfaces.md §mcp）：含路径分隔符的相对路径相对插件版本目录解析；
 *  裸命令名走 PATH，绝对路径原样（模板变量展开后通常已是绝对路径） */
function resolveCommandPath(command: string, versionDir: string): string {
  if (!command.includes("/") && !command.includes("\\")) return command;
  return path.isAbsolute(command) ? command : path.resolve(versionDir, command);
}

/** 声明展开：`${HENIRA_PLUGIN_ROOT}` / `${HENIRA_PROJECT_DIR}` 与生态别名（plugins.md §4 模板
 *  变量）+ `${credential:名}`（宿主凭据表）。其余 `${...}` 原样保留（server 运行时自解）。 */
export function expandMcpServers(input: {
  decls: readonly McpServerDecl[];
  cwd: string;
  credentials: Readonly<Record<string, string>>;
  warn?: (message: string) => void;
}): McpServerSpec[] {
  const specs: McpServerSpec[] = [];
  for (const decl of input.decls) {
    const vars: Record<string, string> = {
      HENIRA_PLUGIN_ROOT: decl.versionDir,
      CLAUDE_PLUGIN_ROOT: decl.versionDir,
      ZCODE_PLUGIN_ROOT: decl.versionDir,
      HENIRA_PROJECT_DIR: input.cwd,
      CLAUDE_PROJECT_DIR: input.cwd,
      ZCODE_PROJECT_DIR: input.cwd,
    };
    let failed = false;
    const warn = (message: string): void => {
      input.warn?.(`${decl.pluginId}/${decl.server}: ${message}`);
    };
    const expand = (value: string): string =>
      value.replace(/\$\{([^}]+)\}/g, (raw, name: string) => {
        if (failed) return raw;
        if (name.startsWith("credential:")) {
          const key = name.slice("credential:".length).trim();
          const found = input.credentials[key];
          if (found === undefined) {
            failed = true;
            warn(`凭据引用 "${key}" 在 credentials.json 无条目——跳过该 server（fail-closed）`);
            return raw;
          }
          return found;
        }
        const mapped = vars[name];
        return mapped !== undefined ? mapped : raw;
      });
    const env =
      decl.env === undefined
        ? undefined
        : Object.fromEntries(Object.entries(decl.env).map(([k, v]) => [k, expand(v)]));
    const headers =
      decl.headers === undefined
        ? undefined
        : Object.fromEntries(Object.entries(decl.headers).map(([k, v]) => [k, expand(v)]));
    const command =
      decl.command === undefined
        ? undefined
        : resolveCommandPath(expand(decl.command), decl.versionDir);
    const args = decl.args?.map(expand);
    const url = decl.url === undefined ? undefined : expand(decl.url);
    if (failed) continue;
    specs.push({
      pluginId: decl.pluginId,
      server: decl.server,
      kind: decl.kind,
      command,
      args,
      env,
      url,
      headers,
    });
  }
  return specs;
}

/** useResource 地址解析（plugins.md §4：henira-data://<pluginId>/<server>/<tool>?args=<URL 编码 JSON>）。
 *  手工切分不走 URL 构造器——自定义 scheme 的 host 会被 punycode，中文插件 id 会碎。 */
export function parseResourceAddress(
  address: string,
): { pluginId: string; server: string; tool: string; args: Record<string, unknown> } | undefined {
  const m = /^henira-data:\/\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)(?:\?([^#]*))?$/.exec(address);
  if (m === null) return undefined;
  const dec = (raw: string): string | undefined => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  };
  const pluginId = dec(m[1] ?? "");
  const server = dec(m[2] ?? "");
  const tool = dec(m[3] ?? "");
  if (pluginId === undefined || server === undefined || tool === undefined) return undefined;
  let args: Record<string, unknown> = {};
  if (m[4] !== undefined && m[4] !== "") {
    const raw = new URLSearchParams(m[4]).get("args");
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
          return undefined;
        args = parsed as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
  }
  return { pluginId, server, tool, args };
}
