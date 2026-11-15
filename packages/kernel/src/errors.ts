// 内核错误词表——interfaces.md "四种情况必须报清楚" + 语义钉子的显式错误。
// 消息用英文（D-050 第 2 款：引擎消息定英文、永不本地化）。

/** 槽位不存在（或已随卸载不可用）：消息必须说清谁在要、有哪些可用 */
export class MissingSlotError extends Error {
  constructor(
    public readonly slot: string,
    public readonly requester: string,
    available: readonly string[],
  ) {
    super(
      `slot "${slot}" is not available (requested by "${requester}"); ` +
        `available slots: ${available.length > 0 ? available.join(", ") : "(none)"}`,
    );
    this.name = "MissingSlotError";
  }
}

/** 槽位已注册但服务还没启动（启动期 get 未声明 inject 的槽位）——钉子③ 静态等价的一半 */
export class SlotNotStartedError extends Error {
  constructor(slot: string, requester: string) {
    super(
      `slot "${slot}" is registered but its service is not started yet ` +
        `(requested by "${requester}"); declare it in inject to get a startup-order guarantee`,
    );
    this.name = "SlotNotStartedError";
  }
}

/** 两个插件抢同一槽位名：use() 时立刻抛，不等 start() */
export class SlotConflictError extends Error {
  constructor(
    public readonly slot: string,
    incoming: string,
    existing: string,
  ) {
    super(`slot "${slot}" is already claimed by "${existing}" (incoming: "${incoming}")`);
    this.name = "SlotConflictError";
  }
}

/** start() 之后 use()：静态装配（D-011）不允许运行期追加 */
export class UseAfterStartError extends Error {
  constructor(defName: string) {
    super(
      `use() after start() is not allowed (incoming: "${defName}"); ` +
        "assembly is static (D-011) — build a new harness instead",
    );
    this.name = "UseAfterStartError";
  }
}

/** start() 静态检查一次报全：缺失 inject 列表 + 依赖环（cordis 对此静默 PENDING，我们显式报） */
export class AssemblyError extends Error {
  constructor(
    public readonly missing: readonly { def: string; slot: string }[],
    public readonly cycles: readonly string[][],
  ) {
    super(AssemblyError.render(missing, cycles));
    this.name = "AssemblyError";
  }

  private static render(
    missing: readonly { def: string; slot: string }[],
    cycles: readonly string[][],
  ): string {
    const parts: string[] = [];
    for (const m of missing) {
      parts.push(`"${m.def}" requires slot "${m.slot}" but no plugin provides it`);
    }
    for (const cycle of cycles) {
      parts.push(`dependency cycle: ${cycle.join(" -> ")}`);
    }
    return parts.join("; ");
  }
}

/** 钉子⑤：unloading 期间拒绝注册（cleanup 期注册不得逃出卸载快照） */
export class InactiveEffectError extends Error {
  constructor(owner: string) {
    super(
      `registration rejected: "${owner}" is disposing (effects/listeners cannot escape teardown)`,
    );
    this.name = "InactiveEffectError";
  }
}

/** waterfall 监听器第二次调用 next() —— 上游 cordis 行为（dsh fork 缺此守卫，我们补上） */
export class DoubleNextError extends Error {
  constructor(type: string) {
    super(`next() called multiple times in waterfall "${type}"`);
    this.name = "DoubleNextError";
  }
}
