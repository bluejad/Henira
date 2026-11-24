// 权限规则文件读写（R198 项目层，R199 管理面）：审批链、设置页、会话面板共用。
// 纪律：文件可手改——坏文件绝不覆盖；删除未命中不写盘；保留顶层字段与其余原始条目；
// 同一条规则的身份 = protocol 的规范键（键序/未知字段无关）。

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type PermissionFileStatus,
  type PermissionRule,
  type PermissionRuleMatch,
  type PermissionRulesView,
  samePermissionRule,
  uniquePermissionRules,
} from "@henira/protocol";

export function projectPermissionsPath(projectDir: string): string {
  return path.join(projectDir, "permissions.json");
}

export function globalPermissionsPath(globalDir: string): string {
  return path.join(globalDir, "permissions.json");
}

/** 规则文件读写错误：corrupt = 文件存在但读不了/不是合法 JSON 对象（绝不覆盖）；
 *  write = 写盘失败（权限/占用等） */
export class PermissionRulesFileError extends Error {
  constructor(
    readonly reason: "corrupt" | "write",
    message: string,
  ) {
    super(message);
    this.name = "PermissionRulesFileError";
  }
}

export interface RemovePermissionRuleResult {
  removed: number;
  status: PermissionFileStatus;
}

type RawRead =
  | { status: "missing" }
  | { status: "corrupt"; error: string }
  | { status: "ok"; current: Record<string, unknown>; rules: unknown[] };

async function readRaw(file: string): Promise<RawRead> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return { status: "missing" };
    return { status: "corrupt", error: err instanceof Error ? err.message : String(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { status: "corrupt", error: err instanceof Error ? err.message : String(err) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "corrupt", error: "permissions file must be a JSON object" };
  }
  const current = parsed as Record<string, unknown>;
  const rawRules = current.rules;
  if (rawRules !== undefined && !Array.isArray(rawRules)) {
    return { status: "corrupt", error: '"rules" must be an array' };
  }
  return { status: "ok", current, rules: rawRules ?? [] };
}

function isRuleLike(value: unknown): value is PermissionRule {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { match?: { tool?: unknown }; decision?: unknown };
  return (
    typeof candidate.match?.tool === "string" &&
    candidate.match.tool !== "" &&
    (candidate.decision === "allow" || candidate.decision === "deny")
  );
}

/** 窄化（全局/项目同口径）：tool 必备、decision 二值；命令约束只收非空字符串。
 *  写了命令约束但值非法 → 整条丢弃（防「一条命令的 deny」放大成「整个工具 deny」）。 */
export function sanitizePermissionRules(raw: readonly unknown[]): {
  rules: PermissionRule[];
  invalidCount: number;
} {
  const rules: PermissionRule[] = [];
  let invalidCount = 0;
  for (const rule of raw) {
    const candidate = rule as { match?: Record<string, unknown>; decision?: unknown };
    const match = candidate?.match;
    if (typeof match?.tool !== "string" || match.tool === "") {
      invalidCount += 1;
      continue;
    }
    if (candidate.decision !== "allow" && candidate.decision !== "deny") {
      invalidCount += 1;
      continue;
    }
    const cleaned: PermissionRuleMatch = { tool: match.tool };
    let malformed = false;
    for (const key of ["commandExact", "commandPrefix", "commandContains"] as const) {
      if (!(key in match)) continue;
      const value = match[key];
      if (typeof value !== "string" || value === "") {
        malformed = true;
        break;
      }
      cleaned[key] = value;
    }
    if (malformed) {
      invalidCount += 1;
      continue;
    }
    rules.push({ match: cleaned, decision: candidate.decision });
  }
  return { rules, invalidCount };
}

/** 管理视图读取：不抛错（missing/corrupt 都是三态之一）；规则窄化 + 去重。 */
export async function readPermissionRules(file: string): Promise<PermissionRulesView> {
  const raw = await readRaw(file);
  if (raw.status === "missing") {
    return { path: file, status: "missing", rules: [], invalidCount: 0 };
  }
  if (raw.status === "corrupt") {
    return { path: file, status: "corrupt", rules: [], invalidCount: 0 };
  }
  const sanitized = sanitizePermissionRules(raw.rules);
  return {
    path: file,
    status: "ok",
    rules: uniquePermissionRules(sanitized.rules),
    invalidCount: sanitized.invalidCount,
  };
}

async function writeRules(file: string, next: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // 唯一 tmp：并发写者（两个会话的 ConfigService）不抢同一个临时文件
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    // Windows 并发读者短暂握持时 rename 报 EPERM——退避重试（store.repairLedgerFile 同款）
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tmp, file);
        return;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw lastError;
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new PermissionRulesFileError(
      "write",
      `cannot write permissions file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** 追加一条规则（卡上「本项目允许此命令」）：canonical 相同即幂等；坏文件拒绝写入。 */
export async function addPermissionRule(file: string, rule: PermissionRule): Promise<void> {
  const raw = await readRaw(file);
  if (raw.status === "corrupt") {
    throw new PermissionRulesFileError(
      "corrupt",
      `permissions file is not valid JSON: ${raw.error}`,
    );
  }
  const current = raw.status === "ok" ? raw.current : {};
  const rules = raw.status === "ok" ? raw.rules : [];
  if (rules.some((item) => isRuleLike(item) && samePermissionRule(item, rule))) return;
  await writeRules(file, { ...current, version: 1, rules: [...rules, rule] });
}

/** 删除与给定规则 canonical 相同的全部条目：未命中不写盘；坏文件拒绝写入。 */
export async function removePermissionRule(
  file: string,
  rule: PermissionRule,
): Promise<RemovePermissionRuleResult> {
  const raw = await readRaw(file);
  if (raw.status === "missing") return { removed: 0, status: "missing" };
  if (raw.status === "corrupt") {
    throw new PermissionRulesFileError(
      "corrupt",
      `permissions file is not valid JSON: ${raw.error}`,
    );
  }
  const remaining = raw.rules.filter(
    (item) => !(isRuleLike(item) && samePermissionRule(item, rule)),
  );
  const removed = raw.rules.length - remaining.length;
  if (removed === 0) return { removed: 0, status: "ok" };
  await writeRules(file, { ...raw.current, version: 1, rules: remaining });
  return { removed, status: "ok" };
}
