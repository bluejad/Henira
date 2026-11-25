// 判定链的链外硬拒与规则匹配（tools-approval §3 全序：凭据 → 灾难 → deny → allow →
// 默认放行 → approval/request 缝 → answerer）。凭据与灾难在一切规则之外（D-039）。
// 官方清单住本文件（D-012④：approval 插件承担业务策略，kernel 纯机制）。

import { createHash } from "node:crypto";
import path from "node:path";
import type { PermissionRequest, PermissionRule } from "@henira/protocol";

/** 凭据路径特征（官方清单 v1：够用最小集，误报面小）——命中即链外硬拒 */
export const CREDENTIAL_PATTERNS: RegExp[] = [
  /(^|[\\/])credentials\.json$/i,
  /(^|[\\/])\.env(\.[\w-]+)?$/i,
  /\.pem$/i,
  /(^|[\\/])id_(rsa|ed25519|ecdsa)(\.[\w-]+)?(\s|"|$|:)/i,
  /(^|[\\/])secrets?[\\/]/i,
];

/** 灾难命令特征（官方清单 v1）——命中即链外硬拒，任何规则都放不了行 */
export const DISASTER_PATTERNS: RegExp[] = [
  // rm -rf /（/tmp 豁免；r/f 任意顺序、可夹其他旗标——必须锚定根目标，裸 rm -rf 目录不拦）
  /rm\s+-[a-zA-Z]*[rR][a-zA-Z]*[fF][a-zA-Z]*\s+["']?\/(?!tmp\b)/,
  /rm\s+-[a-zA-Z]*[fF][a-zA-Z]*[rR][a-zA-Z]*\s+["']?\/(?!tmp\b)/,
  /mkfs(\.\w+)?\s/,
  /dd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\/(sd|hd|nvme|disk)/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /^\s*(shutdown|reboot|halt|poweroff)\b/,
  /^\s*format\s+[a-zA-Z]:/i,
  /diskpart/i,
  /chmod\s+-R\s+777\s+\/(?!tmp\b)/,
  /del\s+\/[fsq].*C:\\(?!Users\b)/i,
];

/** args 里全部字符串值（浅层遍历一层 + command/path/value 常见字段；工具 args 是扁平为主） */
export function stringValues(args: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };
  walk(args, 0);
  return out;
}

/** 链外硬拒一：凭据路径——args 任何字符串值命中凭据特征 */
export function isCredentialAccess(req: PermissionRequest): boolean {
  return stringValues(req.args).some((s) => CREDENTIAL_PATTERNS.some((pattern) => pattern.test(s)));
}

/** 链外硬拒二：灾难命令——命令形字符串命中灾难特征 */
export function isDisasterCommand(req: PermissionRequest): boolean {
  return stringValues(req.args).some((s) => DISASTER_PATTERNS.some((pattern) => pattern.test(s)));
}

/** 规则匹配：tool 相等（write/edit 的路径规则互相命中）；命令约束（exact/prefix/contains）
 *  与路径约束（pathExact）任一在场即须全部满足。exact 是卡上「允许此命令/此路径」的落点
 *  ——比 prefix/contains 窄，误放行面最小。cwd = 会话工作目录（路径规则按它归一后比较）。 */
export function matchesRule(req: PermissionRequest, rule: PermissionRule, cwd: string): boolean {
  const pathScoped = rule.match.pathExact !== undefined;
  const toolMatches =
    rule.match.tool === req.tool || (pathScoped && writeEditPair(rule.match.tool, req.tool));
  if (!toolMatches) return false;
  const command =
    typeof (req.args as { command?: unknown })?.command === "string"
      ? (req.args as { command: string }).command
      : undefined;
  if (rule.match.commandExact !== undefined && command !== rule.match.commandExact) return false;
  if (
    rule.match.commandPrefix !== undefined &&
    (command === undefined || !command.startsWith(rule.match.commandPrefix))
  ) {
    return false;
  }
  if (
    rule.match.commandContains !== undefined &&
    (command === undefined || !command.includes(rule.match.commandContains))
  ) {
    return false;
  }
  if (pathScoped) {
    const expected = rule.match.pathExact;
    if (expected === undefined) return false;
    const raw = requestPath(req);
    if (raw === undefined) return false;
    if (normalizeRulePath(cwd, raw) !== normalizeRulePath(cwd, expected)) return false;
  }
  return true;
}

/** write / edit 视为同一条路径规则的两个工具名（ZCode matchesRuleToolName 同款：
 *  Write 命中 Edit 的规则）——同路径风险相同，分别点两次没有安全收益。 */
function writeEditPair(a: string, b: string): boolean {
  return (a === "write" || a === "edit") && (b === "write" || b === "edit");
}

/** 调用参数里的文件路径（write/edit 的 file_path 优先，其次 path；空白视为缺失） */
export function requestPath(req: PermissionRequest): string | undefined {
  const args = req.args as { file_path?: unknown; path?: unknown } | undefined;
  for (const key of ["file_path", "path"] as const) {
    const value = args?.[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** 路径规则归一（批准/匹配/撤销三处共用）：会话 cwd 为基准 → 相对路径 → POSIX 分隔符 →
 *  win32 小写。两侧都过本函数，手写的相对/绝对路径同样能对上。 */
export function normalizeRulePath(cwd: string, raw: string): string {
  const rel = path.relative(cwd, path.resolve(cwd, raw));
  const posix = rel.split(path.sep).join("/");
  return process.platform === "win32" ? posix.toLowerCase() : posix;
}

/** 卡上「本会话/本项目允许此命令」的规则推导（R198）：仅命令类工具 + 非空命令 →
 *  精确命令规则；其余工具返回 undefined（由调用方决定是否退化为工具级/一次）。 */
export function commandRule(req: PermissionRequest): PermissionRule | undefined {
  if (req.tool !== "bash" && req.tool !== "powershell") return undefined;
  const command =
    typeof (req.args as { command?: unknown })?.command === "string"
      ? (req.args as { command: string }).command
      : undefined;
  if (command === undefined || command.trim() === "") return undefined;
  return { match: { tool: req.tool, commandExact: command }, decision: "allow" };
}

/** 卡上「本会话/本项目允许此路径」的规则推导（D-087）：仅 write/edit + 可解析路径 →
 *  精确路径规则；路径缺失（args 超限/旧账本）返回 undefined，调用方降级为一次。 */
export function pathRule(req: PermissionRequest, cwd: string): PermissionRule | undefined {
  if (req.tool !== "write" && req.tool !== "edit") return undefined;
  const raw = requestPath(req);
  if (raw === undefined) return undefined;
  return { match: { tool: req.tool, pathExact: normalizeRulePath(cwd, raw) }, decision: "allow" };
}

/** argsDigest：审计事件里的参数摘要（不落全文——全文在交互载荷里，D-046） */
export function argsDigest(args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(args ?? null))
    .digest("hex")
    .slice(0, 12);
}
