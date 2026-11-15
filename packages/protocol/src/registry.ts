// 事件注册表：开放 map（P1，session.md §3 已定稿）。校验器 = 最小 duck 接口（D-051）：
// protocol 零依赖、不认 schema 库牌子；官方 15 变体由 session 包用 zod 实现并注册，
// 插件可用 zod / valibot / 手写校验器，结构满足即可。
// 派生清单（P9-5）：KNOWN_EVENT_TYPES、schema 反查表全部从注册表派生，禁止手抄。

/** 最小校验器结构（D-051）：zod v3/v4 schema、valibot、手写实现均天然满足 */
export interface EventValidator {
  safeParse(data: unknown): { success: true; data: unknown } | { success: false; error: unknown };
}

/** 保留语义域（session.md §2.3）：官方基础事件用保留域，插件自有事件必须用包名前缀 */
export const RESERVED_DOMAINS = [
  "turn",
  "step",
  "request",
  "user",
  "system",
  "assistant",
  "tool",
  "approval",
  "error",
  "session",
] as const;

export type ReservedDomain = (typeof RESERVED_DOMAINS)[number];

/** 开放注册表：官方 session 包注册基础 15 个变体（直接写 map，核心包可信）；插件经 registerPluginEvent 追加 */
export const SessionEventRegistry: Map<string, EventValidator> = new Map();

export class ReservedDomainError extends Error {
  constructor(type: string, domain: string) {
    super(
      `event type "${type}" uses reserved domain "${domain}"; ` +
        "plugin events must be prefixed with the owning package name",
    );
    this.name = "ReservedDomainError";
  }
}

export class EventTypeMismatchError extends Error {
  constructor(type: string, owner: string) {
    super(`event type "${type}" must be prefixed with owner "${owner}" (session.md §2.3)`);
    this.name = "EventTypeMismatchError";
  }
}

export class DuplicateEventTypeError extends Error {
  constructor(type: string) {
    super(`event type "${type}" is already registered`);
    this.name = "DuplicateEventTypeError";
  }
}

function domainOf(type: string): string {
  return type.includes("/") ? type.slice(0, type.indexOf("/")) : type;
}

/**
 * 插件注册新事件类型：不得占用保留域、前缀必须等于 owner（compaction/*、subagent/*），
 * 重复注册抛错。核心代码零改动——新增插件事件类型只走这里（roadmap M1 判据 3）。
 */
export function registerPluginEvent(type: string, validator: EventValidator, owner: string): void {
  const domain = domainOf(type);
  if ((RESERVED_DOMAINS as readonly string[]).includes(domain)) {
    throw new ReservedDomainError(type, domain);
  }
  if (domain !== owner) {
    throw new EventTypeMismatchError(type, owner);
  }
  if (SessionEventRegistry.has(type)) {
    throw new DuplicateEventTypeError(type);
  }
  SessionEventRegistry.set(type, validator);
}

/** 派生清单：已知事件类型集合（禁止手抄，P9-5） */
export function knownEventTypes(): ReadonlySet<string> {
  return new Set(SessionEventRegistry.keys());
}

/** 派生反查表：type → 校验器；未知类型返回 undefined（读侧 fail-closed 由 session 裁决） */
export function validatorFor(type: string): EventValidator | undefined {
  return SessionEventRegistry.get(type);
}
