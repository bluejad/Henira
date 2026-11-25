// approval 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// 判定链全序与 fail-closed 语义见 tools-approval.md §3（P5）。

export const DECISIONS = ["allowed-once", "rejected", "cancelled", "unavailable"] as const;
export type Decision = (typeof DECISIONS)[number];

/** 审批载荷（D-046 定稿 + R202 补 callId）：引擎一字不加工；显示折叠归界面 UI */
export interface PermissionRequest {
  tool: string;
  /** 完整原样 */
  args: unknown;
  reason?: string;
  /** 真实 tool/call id（tools 管线填；approval/asked 原样落账，卡片超限回查用——D-085） */
  callId?: string;
}

/** 规则匹配条件（tools-approval §3.1）：tool 相等；命令约束任一在场即须全部满足。
 *  commandExact = 卡上「本会话/本项目允许此命令」的落点（同一条命令才免问）。 */
export interface PermissionRuleMatch {
  tool: string;
  /** 精确命令（整串相等；比 prefix/contains 窄，写盘/落账都用它） */
  commandExact?: string;
  commandPrefix?: string;
  commandContains?: string;
}

/** 跨会话权限规则（tools-approval §3.1 permissions.json；deny 压倒一切，链首） */
export interface PermissionRule {
  match: PermissionRuleMatch;
  decision: "allow" | "deny";
}

/** 权限规则快照（权限菜单）：会话级 = 账本折叠（规则 + 工具级），项目/全局 = 配置文件 */
export interface PermissionSnapshot {
  session: {
    rules: PermissionRule[];
    /** 工具级本会话允许（无命令精确度的旧形状：write/edit/read…） */
    tools: string[];
  };
  project: PermissionRule[];
  global: PermissionRule[];
}

/** 规则规范键（R199）：decision + tool + 三个命令约束，键序与未知字段无关。
 *  添加幂等、文件删除、账本撤销、UI key 共用同一身份。 */
export function permissionRuleKey(rule: PermissionRule): string {
  return JSON.stringify([
    rule.decision,
    rule.match.tool,
    rule.match.commandExact ?? null,
    rule.match.commandPrefix ?? null,
    rule.match.commandContains ?? null,
  ]);
}

export function samePermissionRule(a: PermissionRule, b: PermissionRule): boolean {
  return permissionRuleKey(a) === permissionRuleKey(b);
}

/** 去重（保留首次出现）：文件可手改出重复条目，管理面/折叠只展示一份 */
export function uniquePermissionRules(rules: readonly PermissionRule[]): PermissionRule[] {
  const seen = new Set<string>();
  const out: PermissionRule[] = [];
  for (const rule of rules) {
    const key = permissionRuleKey(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}

/** 规则文件状态（R199 管理面）：ok / 文件缺失 / 存在但读不了或不是合法 JSON 对象 */
export type PermissionFileStatus = "ok" | "missing" | "corrupt";

/** 一个规则文件的管理视图（项目段复用；全局直接用） */
export interface PermissionRulesView {
  path: string;
  status: PermissionFileStatus;
  rules: PermissionRule[];
  /** 文件里有、但形状非法被丢弃的条目数（管理面提示；不进匹配） */
  invalidCount: number;
}

/** 项目选择器条目（R199）：id = projects.json 的稳定 id，key = 项目数据目录名 */
export interface PermissionProjectSummary {
  id: string;
  key: string;
  cwd: string;
  name: string;
  allowCount: number;
  denyCount: number;
  status: PermissionFileStatus;
}

export interface PermissionProjectsView {
  projects: PermissionProjectSummary[];
  /** 当前会话所属项目（无会话 / 未匹配 = 缺省） */
  currentId?: string;
}

export interface PermissionProjectView extends PermissionRulesView {
  id: string;
  key: string;
  cwd: string;
  name: string;
}

// 审批策略（D-013①：只管规则与 fail-closed，不碰 UI；弹卡收答经 InteractionService）
export interface ApprovalOptions {
  signal?: AbortSignal;
  /** 闸门抬高下限（tools-approval §2.1）：pre-execute 监听者表态 ask → 默认放行层不得自动通过 */
  floor?: "ask";
}

export interface ApprovalService {
  requestPermission(req: PermissionRequest, opts?: ApprovalOptions): Promise<Decision>;
}
