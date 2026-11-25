// 厂商自动会话头（OpenCode Go 支持批 2026-11-25）：opencode 家族的 Go 网关要求每个 chat
// 请求携带「每对话稳定」的 x-opencode-session，缺了直接 400（网关原文：
// "Request is missing x-opencode-session and cannot be routed efficiently"）。
// 判定按 baseUrl（真实目的地）不按 provider id——会话 id 是敏感标识，不能因为用户把自建代理
// 命名成 opencode-xxx 就发给第三方。只覆盖 Go 的两条路由（/zen/go、/inference/go）；
// Zen（/zen/v1）与其它路径不发（Zen 不需要）。行为取证：opencode 客户端用根会话 id 做缓存
// affinity，ZCode 客户端按 host+path 精确匹配；本实现按行为重写，不含参照代码。

const OPENCODE_ROOT = "opencode.ai";

/** Go 计划的路由前缀（要会话头的是 Go，不是 Zen） */
const GO_PATH_PREFIXES = ["/zen/go", "/inference/go"] as const;

/** baseUrl + 会话 id → 该端点要求的自动头；空对象 = 无需自动头（或输入不完整） */
export function sessionHeadersFor(
  baseUrl: string | undefined,
  sessionId: string | undefined,
): Record<string, string> {
  if (baseUrl === undefined || sessionId === undefined) return {};
  const id = sessionId.trim();
  if (id === "") return {};
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return {}; // 配置错误由 resolveLanguageModel 报（这里不吞成会话头问题）
  }
  const host = url.hostname.toLowerCase();
  if (host !== OPENCODE_ROOT && !host.endsWith(`.${OPENCODE_ROOT}`)) return {};
  const path = url.pathname.replace(/\/+$/u, "").toLowerCase();
  const isGo = GO_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return isGo ? { "x-opencode-session": id } : {};
}
