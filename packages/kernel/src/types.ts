// 内核机制类型——kernel 不认识任何业务接口（D-012②），机制类型归 kernel。
// 形状出处：docs/20-architecture/interfaces.md kernel 段（已定稿）。

/** 服务定义：一个插件 = 一个 ServiceDefinition。省略 name = 不占槽位的纯行为件（如熔断插件）。 */
export interface ServiceDefinition<T = unknown> {
  /** 占用的槽位名（如 'loop'）；两个插件抢同一槽位名在 use() 时立刻抛 */
  name?: string;
  /** 启动前必须已存在的槽位 → 启动顺序由依赖图驱动；start() 静态检查一次报全缺失 */
  inject?: readonly string[];
  /** 装配启动体：注册监听/effect/资源；返回值作为槽位服务（占名时） */
  // biome-ignore lint/suspicious/noConfusingVoidType: interfaces.md 定稿形状——start 体允许不返回值
  start(ctx: HarnessContext): T | void | Promise<T | void>;
  /** 只收尾服务自身的资源（连接、句柄、flush）；监听/effect 由注册表逆序撤销 */
  stop?(svc: T): Promise<void> | void;
}

/** 注册撤销：同步、幂等（cordis 单发语义，[dsh] vendor/cordis/src/fiber.ts:407-408） */
export type Disposable = () => void;

/** bail 模式的否决对象：显式对象、无真值陷阱（cordis 的 isBail 真值语义不采）；undefined = 不否决 */
export interface Veto {
  /** 谁否决的（插件名，排查用） */
  by: string;
  /** 为什么 */
  reason: string;
  /** 可选：注入这句提示继续跑（熔断续跑） */
  resume?: { prompt: string };
}

/** 事件总线四种模式（D-012①）；监听器经 ctx 注册、随插件生命周期自动撤销 */
export interface EventBus {
  /** 发完不管（同步；监听器异常被隔离上报，不外抛给触发方） */
  on(type: string, fn: (payload: unknown) => void): Disposable;
  /** 顺序 await 每个监听器，异常向上抛 */
  onSerial(type: string, fn: (payload: unknown) => void | Promise<void>): Disposable;
  /**
   * 链式改写。监听器收到 (value, next)：调用 next(v) 继续下游（通常 return next(v)）；
   * 不调 next() 直接返回 = 否决下游，返回值成为最终结果（cordis waterfall 语义，
   * [dsh] vendor/cordis/src/events.ts:228；同步返回与返回 Promise 皆可）。
   */
  onWaterfall<T>(
    type: string,
    fn: (value: T, next: (v: T) => Promise<T>) => T | Promise<T>,
  ): Disposable;
  /** 顺序执行，第一个返回 Veto 的即停；无反对返回 undefined */
  onBail(
    type: string,
    fn: (value: unknown) => Veto | undefined | Promise<Veto | undefined>,
  ): Disposable;

  emit(type: string, payload: unknown): void;
  serial(type: string, payload: unknown): Promise<void>;
  waterfall<T>(type: string, value: T): Promise<T>;
  bail<T>(type: string, value: T): Promise<Veto | undefined>;
}

/** 插件拿到的上下文：绑定自己名字，报错能说清是谁在要（interfaces.md 两条约定） */
export interface HarnessContext {
  /** 取已启动的服务；未注册 → 抛 MissingSlotError（消息含"谁在要、有哪些槽位可用"） */
  get<T>(slot: string): T;
  readonly events: EventBus;
  /** 与插件同生命周期的可逆注册（钩子/监听/定时器）；逆序撤销 */
  // biome-ignore lint/suspicious/noConfusingVoidType: 定稿形状——回调允许不返回 Disposable
  effect(fn: () => Disposable | void): Disposable;
}

/** 装配 API（开发者面，D-011：静态装配，不做热加载） */
export interface Harness {
  /** 只能在 start() 之前；槽位重名立刻抛 */
  use(def: ServiceDefinition): this;
  /** 校验 inject → 按依赖图排序启动；中途失败 = 逆序回滚已启动 + 抛原错误 */
  start(): Promise<void>;
  readonly context: HarnessContext;
  /** 逆序 unwind 全部 effect 与 stop()；重入 dispose 合入同一次卸载（钉子①） */
  dispose(): Promise<void>;
}
