// 判定链的链外硬拒与规则匹配（tools-approval §3 全序：凭据 → 灾难 → deny → allow →
// 默认放行 → approval/request 缝 → answerer）。凭据与灾难在一切规则之外（D-039）。
// 官方清单住本文件（D-012④：approval 插件承担业务策略，kernel 纯机制）。

import { createHash } from "node:crypto";
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

/** 规则匹配：tool 相等；commandPrefix / commandContains 对 args.command 字符串生效 */
export function matchesRule(req: PermissionRequest, rule: PermissionRule): boolean {
  if (rule.match.tool !== req.tool) return false;
  const command =
    typeof (req.args as { command?: unknown })?.command === "string"
      ? (req.args as { command: string }).command
      : undefined;
  if (rule.match.commandPrefix !== undefined) {
    // 严格 boolean（optional chain 会漏出 undefined——消费端按 === 判定，不可三态）
    // biome-ignore lint/complexity/useOptionalChain: 三态会破坏 Decision 判定契约
    return command !== undefined && command.startsWith(rule.match.commandPrefix);
  }
  if (rule.match.commandContains !== undefined) {
    // biome-ignore lint/complexity/useOptionalChain: 同上，保持严格 boolean
    return command !== undefined && command.includes(rule.match.commandContains);
  }
  return true;
}

/** argsDigest：审计事件里的参数摘要（不落全文——全文在交互载荷里，D-046） */
export function argsDigest(args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(args ?? null))
    .digest("hex")
    .slice(0, 12);
}
