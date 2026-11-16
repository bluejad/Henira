// approval 槽位契约（interfaces.md protocol 段，2026-11-16 定稿）。
// 判定链全序与 fail-closed 语义见 tools-approval.md §3（P5）。

export const DECISIONS = ["allowed-once", "rejected", "cancelled", "unavailable"] as const;
export type Decision = (typeof DECISIONS)[number];

/** 审批载荷（D-046 定稿）：引擎一字不加工；显示折叠归界面 UI */
export interface PermissionRequest {
  tool: string;
  /** 完整原样 */
  args: unknown;
  reason?: string;
}

/** 跨会话权限规则（tools-approval §3.1 permissions.json；deny 压倒一切，链首） */
export interface PermissionRule {
  match: { tool: string; commandPrefix?: string; commandContains?: string };
  decision: "allow" | "deny";
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
