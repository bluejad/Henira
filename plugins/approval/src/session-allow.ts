// 会话内允许集折叠（tools-approval §3.1）：日志记"发生了什么"——asked 带 tool、
// decided{scope:'session'} 记允许（按 requestId 配对）、revoked{scope:'session'} 撤销。
// 全部从日志派生，无独立可变状态（P1 对偶）。

interface AuditLike {
  type: string;
  data: unknown;
}

export function sessionAllowedTools(events: readonly AuditLike[]): Set<string> {
  const toolByRequest = new Map<string, string>();
  const allowed = new Set<string>();
  for (const event of events) {
    const data = event.data as {
      requestId?: string;
      tool?: string;
      decision?: string;
      scope?: string;
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
      const tool = data.tool ?? (data.requestId ? toolByRequest.get(data.requestId) : undefined);
      if (tool) allowed.add(tool);
      continue;
    }
    if (event.type === "approval/revoked" && data.scope === "session") {
      if (data.tool) allowed.delete(data.tool);
      else allowed.clear();
    }
  }
  return allowed;
}
