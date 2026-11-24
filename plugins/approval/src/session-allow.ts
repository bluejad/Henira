// 会话内允许集折叠（tools-approval §3.1）：日志记"发生了什么"——asked 带 tool、
// decided{scope:'session'} 记允许（按 requestId 配对）、revoked{scope:'session'} 撤销。
// 全部从日志派生，无独立可变状态（P1 对偶）。
// R198：允许分两种粒度——命令类工具落 rule（commandExact，同命令才免问），其余工具落
// tool（工具级，旧形状原样兼容）。

import { type PermissionRule, samePermissionRule } from "@henira/protocol";

interface AuditLike {
  type: string;
  data: unknown;
}

export interface SessionAllowance {
  /** 命令级允许（decided 行带 rule 的历史事实，按发生序；canonical 去重） */
  rules: PermissionRule[];
  /** 工具级允许（无 rule 的 decided 行） */
  tools: Set<string>;
}

export function sessionAllowance(events: readonly AuditLike[]): SessionAllowance {
  const toolByRequest = new Map<string, string>();
  const rules: PermissionRule[] = [];
  const tools = new Set<string>();
  for (const event of events) {
    const data = event.data as {
      requestId?: string;
      tool?: string;
      decision?: string;
      scope?: string;
      rule?: PermissionRule;
    };
    if (event.type === "approval/asked" && data.requestId && data.tool) {
      toolByRequest.set(data.requestId, data.tool);
      continue;
    }
    if (
      event.type === "approval/decided" &&
      data.scope === "session" &&
      data.decision === "allowed-once"
    ) {
      const rule = data.rule;
      if (rule !== undefined) {
        // 同一条规则重复落账（键序/重复决定）= 集合里只留一份；撤销按 canonical 全删
        if (!rules.some((item) => samePermissionRule(item, rule))) rules.push(rule);
        continue;
      }
      const tool = data.tool ?? (data.requestId ? toolByRequest.get(data.requestId) : undefined);
      if (tool) tools.add(tool);
      continue;
    }
    if (event.type === "approval/revoked" && data.scope === "session") {
      const rule = data.rule;
      if (rule !== undefined) {
        // 精确撤销单条规则（保留同工具的其他命令规则）
        for (let i = rules.length - 1; i >= 0; i--) {
          if (samePermissionRule(rules[i], rule)) rules.splice(i, 1);
        }
      } else if (data.tool) {
        tools.delete(data.tool);
        for (let i = rules.length - 1; i >= 0; i--) {
          if (rules[i].match.tool === data.tool) rules.splice(i, 1);
        }
      } else {
        tools.clear();
        rules.length = 0;
      }
    }
  }
  return { rules, tools };
}

/** 工具级视图（E6 兼容出口：只看无 rule 的允许） */
export function sessionAllowedTools(events: readonly AuditLike[]): Set<string> {
  return sessionAllowance(events).tools;
}
