// 权限规则行（R199）：设置页（项目/全局，带 allow/deny 徽章）与会话面板（仅 allow 列表）
// 共用的摘要渲染。命令约束长文由 CSS 截断 + title 看全文，不在这里做业务折叠。

import type { PermissionRule } from "@henira/protocol";
import type { ReactNode } from "react";
import type { WebPartContext } from "../types.js";

function constraintsOf(rule: PermissionRule | undefined, t: (key: string) => string): string[] {
  if (rule === undefined) return [t("permission.rule.wholeTool")];
  const out: string[] = [];
  if (rule.match.commandExact !== undefined) {
    out.push(`${t("permission.rule.exact")} "${rule.match.commandExact}"`);
  }
  if (rule.match.commandPrefix !== undefined) {
    out.push(`${t("permission.rule.prefix")} "${rule.match.commandPrefix}"`);
  }
  if (rule.match.commandContains !== undefined) {
    out.push(`${t("permission.rule.contains")} "${rule.match.commandContains}"`);
  }
  // D-087：路径规则必须自报路径——否则设置/会话面板把「一个文件」误显示成「整个工具」
  if (rule.match.pathExact !== undefined) {
    out.push(`${t("permission.rule.path")} "${rule.match.pathExact}"`);
  }
  return out.length > 0 ? out : [t("permission.rule.wholeTool")];
}

/** rule 缺省 + tool 在场 = 工具级允许（会话折叠的 tools 集） */
export function PermissionRuleLine(props: {
  ctx: WebPartContext;
  rule?: PermissionRule;
  tool?: string;
  showDecision?: boolean;
  action?: ReactNode;
}): ReactNode {
  const { ctx, rule } = props;
  const tool = rule?.match.tool ?? props.tool ?? "";
  const constraints = constraintsOf(rule, ctx.t);
  const title = constraints.join(" · ");
  const showDecision = props.showDecision === true && rule !== undefined;
  return (
    <div className="henira-permission-rule-row">
      {showDecision ? (
        <span
          className={`henira-permission-rule-badge${rule.decision === "deny" ? " is-deny" : " is-allow"}`}
        >
          {ctx.t(rule.decision === "deny" ? "permission.rule.deny" : "permission.rule.allow")}
        </span>
      ) : null}
      <code className="henira-permission-rule-tool">{tool}</code>
      <span className="henira-permission-rule-constraint" title={title}>
        {title}
      </span>
      {props.action !== undefined ? (
        <span className="henira-permission-rule-action">{props.action}</span>
      ) : null}
    </div>
  );
}
