// 槽位登记簿（host.ts 槽位管理抽出，可单测——审查 F3 顶替语义修复）：registerSlot 列表
// 追加（order 排序、[0] 赢）+ replaceSlot 顶替。顶替语义（D-057/D-048 全链）：官方默认件
// 可被插件 replaceSlot 顶替、卸载按登记回落官方；第三方件之间的同 key 第二家才报错——
// 判据 = 在位件的所有权，不是「有没有默认件」。官方未占键时两种实现恰好同观感（顶替=
// 认领空槽），E5 起官方注册 per-tool 卡后「占位即报错」会把第三方整个 UI 模块挡在装载
// 门外——承诺的顶替路径从此不通。
// single 槽（R183，dsh SlotKind single 行为层）：同一时刻只有一位占用者——registerSlot
// 与 replaceSlot 同走「认领 + 卸载回落前件」语义，第二家第三方报冲突；list 槽保持追加。
// 判据由宿主传入（isSingleSlot），登记簿不硬编码词表。

import type { ChainEntry, SlotPart } from "@henira/plugin-web-ui";

export interface SlotRegistryOptions {
  /** 词表闸（§7.2）：词表外槽名忽略，走告警出口 */
  slotAccepted(name: string): boolean;
  onUnknownSlot(name: string): void;
  /** 官方 UI 模块的插件 id（其注册的件 = 官方默认件，可被顶替；discovery 唯一，第三方不可能同名） */
  officialId: string;
  /** single 槽判定（R183，dsh SlotKind single）：命中者 registerSlot 也走认领/回落语义；
   *  缺省 = 全部 list 追加（旧语义，不改变既有宿主） */
  isSingleSlot?(name: string): boolean;
  /** 槽名归一（R191 自审）：注册/顶替入口先归一再生效——「一个 key 一位」的占用
   *  判据要落在与解析相同的键空间（预览键大小写/前导点/空后缀变体否则可静默共存） */
  canonicalSlotName?(name: string): string;
}

export interface SlotRegistry {
  /** 槽位表（渲染消费面；ctx.slots 直透） */
  readonly slots: Map<string, SlotPart[]>;
  /** chain 槽表（R182，dsh SlotKind 行为层；ctx.chains 直透）：条目按 priority 升序 */
  readonly chains: Map<string, ChainEntry[]>;
  /** 按调用方身份出注册 API：官方模块 officialId / 第三方各自插件 id（所有权随件登记）。
   * 返回撤销器 = 裸函数签名（kernel Disposable 同形状，结构化赋值——web 不新增 kernel 依赖边） */
  apiFor(callerId: string): {
    registerSlot(name: string, part: SlotPart, opts?: { order?: number }): () => void;
    replaceSlot(name: string, part: SlotPart): () => void;
    registerChainSlot(name: string, entry: ChainEntry, opts?: { priority?: number }): () => void;
    replaceChainSlot(
      name: string,
      id: string,
      entry: ChainEntry,
      opts?: { priority?: number },
    ): () => void;
  };
  /** 全量重建前清场（renderSlots）：必须在第三方 dispose 之前清登记簿——重建期卸载回落
   *  不得复活旧列表（dispose 闭包查不到登记 = no-op，清场后全量重装） */
  reset(): void;
  /** 按调用方整批撤出（R186 收尾，审查 P3⑨）：apply 注册后抛错 / 模块未返回 dispose 时，
   *  宿主仍能把该插件的全部登记清干净（单槽下泄漏 = 官方件被顶掉直到刷新）。幂等。 */
  releaseOwner(callerId: string): void;
  /** 某调用方当前占用的槽名（R202/D-085：`ui.slots` 声明 vs 实际注册的漏声明比对） */
  ownedSlotNames(callerId: string): string[];
}

export function createSlotRegistry(opts: SlotRegistryOptions): SlotRegistry {
  const slots = new Map<string, SlotPart[]>();
  /** registerSlot 的 order 旁路（插入排序用；part 是函数，WeakMap 门牌） */
  let partOrders = new WeakMap<object, number>();
  /** 件所有权：registerSlot 登记来源（官方 id / 插件 id）——replaceSlot 冲突判据 */
  let partOwners = new WeakMap<object, string>();
  /** replaceSlot 顶替登记：name → { owner, part, previous }——卸载按登记回落 */
  const claims = new Map<string, { owner: string; part: SlotPart; previous: SlotPart[] }>();
  /** 按调用方的撤销器总账（releaseOwner 用；register/replace/chain 全部登记） */
  const ownerReleases = new Map<string, Set<() => void>>();

  // ── chain 槽（R182）：条目按 priority 升序；同 id 顶替按条目粒度回落（不整槽快照，
  //    免得顶替期间新挂的其它条目被卸载时一起冲掉） ──
  const chains = new Map<string, ChainEntry[]>();
  let chainOwners = new WeakMap<object, string>();
  const chainClaims = new Map<
    string,
    { owner: string; entry: ChainEntry; previous: ChainEntry | undefined }
  >();
  const chainKey = (name: string, id: string): string => `${name}\u0000${id}`;
  const priorityOf = (entry: ChainEntry): number => entry.priority ?? 0;
  const insertChain = (list: ChainEntry[], entry: ChainEntry): void => {
    const at = list.findIndex((item) => priorityOf(item) > priorityOf(entry));
    if (at === -1) list.push(entry);
    else list.splice(at, 0, entry);
  };
  const withPriority = (entry: ChainEntry, registerOpts?: { priority?: number }): ChainEntry => {
    const priority = registerOpts?.priority;
    if (priority === undefined || priorityOf(entry) === priority) return entry;
    return { ...entry, priority };
  };

  /** 认领槽位（replaceSlot 与 single 槽 registerSlot 共用，R183）：同 key 有别人家第三方件
   *  才报错（D-022）；官方默认件在位 = 合法。登记 previous，卸载按登记回落。 */
  const claimSlot = (name: string, part: SlotPart, callerId: string): (() => void) => {
    const current = slots.get(name) ?? [];
    // 冲突判据（D-022）：在位件里有别人家的第三方件才报错；官方默认件在位 = 顶替合法
    const foreign = current.some((p) => {
      const owner = partOwners.get(p as unknown as object);
      return owner !== undefined && owner !== callerId && owner !== opts.officialId;
    });
    if (foreign) {
      throw new Error(`slot conflict: ${name} already claimed by another module (D-022)`);
    }
    partOwners.set(part as unknown as object, callerId); // 顶替件同样登记所有权（第二家冲突判据）
    claims.set(name, { owner: callerId, part, previous: current });
    slots.set(name, [part]);
    return () => {
      const claim = claims.get(name);
      if (claim === undefined || claim.owner !== callerId || claim.part !== part) return;
      claims.delete(name);
      const now = slots.get(name);
      if (now === undefined) return;
      const index = now.indexOf(part);
      if (index >= 0) now.splice(index, 1);
      // 顶替件撤出后空槽 → 回落顶替前的在位件（通常 = 官方默认件）
      if (now.length === 0) {
        if (claim.previous.length > 0) slots.set(name, claim.previous);
        else slots.delete(name);
      }
    };
  };

  /** 登记撤销器到调用方总账：返回包装器（撤出后自动出账；重复调用安全） */
  const trackRelease = (callerId: string, dispose: () => void): (() => void) => {
    const set = ownerReleases.get(callerId) ?? new Set<() => void>();
    ownerReleases.set(callerId, set);
    const tracked = (): void => {
      set.delete(tracked);
      dispose();
    };
    set.add(tracked);
    return tracked;
  };

  return {
    slots,
    chains,
    apiFor(callerId) {
      return {
        registerSlot(name, part, registerOpts) {
          const slotName = opts.canonicalSlotName?.(name) ?? name;
          if (!opts.slotAccepted(slotName)) {
            opts.onUnknownSlot(slotName);
            return () => {};
          }
          // single 槽（R183）：同一时刻只一位占用者——认领/回落语义，不追加
          if (opts.isSingleSlot?.(slotName) === true) {
            return trackRelease(callerId, claimSlot(slotName, part, callerId));
          }
          const list = slots.get(slotName) ?? [];
          const order = registerOpts?.order ?? 0;
          partOrders.set(part as unknown as object, order);
          partOwners.set(part as unknown as object, callerId);
          const at = list.findIndex((p) => (partOrders.get(p as unknown as object) ?? 0) > order);
          if (at === -1) list.push(part);
          else list.splice(at, 0, part);
          slots.set(slotName, list);
          return trackRelease(callerId, () => {
            const current = slots.get(slotName);
            if (current === undefined) return;
            const index = current.indexOf(part);
            if (index >= 0) current.splice(index, 1);
            if (current.length === 0) slots.delete(slotName); // 不残留空键（与 chain/claim 同款）
          });
        },
        replaceSlot(name, part) {
          const slotName = opts.canonicalSlotName?.(name) ?? name;
          if (!opts.slotAccepted(slotName)) {
            opts.onUnknownSlot(slotName);
            return () => {};
          }
          return trackRelease(callerId, claimSlot(slotName, part, callerId));
        },
        registerChainSlot(name, entry, registerOpts) {
          if (!opts.slotAccepted(name)) {
            opts.onUnknownSlot(name);
            return () => {};
          }
          const stored = withPriority(entry, registerOpts);
          const list = chains.get(name) ?? [];
          const index = list.findIndex((item) => item.id === stored.id);
          if (index >= 0) {
            const owner = chainOwners.get(list[index] as unknown as object);
            if (owner !== undefined && owner !== callerId && owner !== opts.officialId) {
              throw new Error(
                `chain conflict: ${name}#${stored.id} already claimed by another module (D-022)`,
              );
            }
            // 官方条目在位时第三方不能「追挂同 id」——顶替走 replaceChainSlot（语义显式）
            if (owner === opts.officialId && callerId !== opts.officialId) {
              throw new Error(
                `chain conflict: ${name}#${stored.id} is official; use replaceChainSlot (D-022)`,
              );
            }
            list.splice(index, 1); // 同插件重入 / 官方重注册：按新条目替换
          }
          chainOwners.set(stored as unknown as object, callerId);
          insertChain(list, stored);
          chains.set(name, list);
          return trackRelease(callerId, () => {
            const current = chains.get(name);
            if (current === undefined) return;
            const at = current.indexOf(stored);
            if (at >= 0) current.splice(at, 1);
            if (current.length === 0) chains.delete(name);
          });
        },
        replaceChainSlot(name, id, entry, registerOpts) {
          if (!opts.slotAccepted(name)) {
            opts.onUnknownSlot(name);
            return () => {};
          }
          const list = chains.get(name) ?? [];
          const index = list.findIndex((item) => item.id === id);
          const previous = index >= 0 ? list[index] : undefined;
          if (previous !== undefined) {
            const owner = chainOwners.get(previous as unknown as object);
            if (owner !== undefined && owner !== callerId && owner !== opts.officialId) {
              throw new Error(
                `chain conflict: ${name}#${id} already claimed by another module (D-022)`,
              );
            }
          }
          const stored = withPriority(entry.id === id ? entry : { ...entry, id }, registerOpts);
          chainOwners.set(stored as unknown as object, callerId);
          const key = chainKey(name, id);
          chainClaims.set(key, { owner: callerId, entry: stored, previous });
          if (index >= 0) list.splice(index, 1);
          insertChain(list, stored);
          chains.set(name, list);
          return trackRelease(callerId, () => {
            const claim = chainClaims.get(key);
            if (claim === undefined || claim.owner !== callerId || claim.entry !== stored) return;
            chainClaims.delete(key);
            const now = chains.get(name);
            if (now === undefined) return;
            const at = now.indexOf(stored);
            if (at >= 0) now.splice(at, 1);
            if (claim.previous !== undefined) insertChain(now, claim.previous);
            if (now.length === 0) chains.delete(name);
          });
        },
      };
    },
    reset() {
      slots.clear();
      partOrders = new WeakMap();
      partOwners = new WeakMap();
      claims.clear();
      chains.clear();
      chainOwners = new WeakMap();
      chainClaims.clear();
      ownerReleases.clear();
    },
    releaseOwner(callerId) {
      const set = ownerReleases.get(callerId);
      if (set === undefined) return;
      ownerReleases.delete(callerId);
      for (const dispose of [...set]) {
        try {
          dispose(); // 包装器先出账再走原撤销（Set 已从总账摘除，重复调用安全）
        } catch {
          // 单个撤出异常不阻断其余登记（卸载清理路径；避免一件坏件拖住整批回退）
        }
      }
    },
    ownedSlotNames(callerId) {
      const names = new Set<string>();
      for (const [name, parts] of slots) {
        if (parts.some((part) => partOwners.get(part as unknown as object) === callerId)) {
          names.add(name);
        }
      }
      for (const [name, entries] of chains) {
        if (entries.some((entry) => chainOwners.get(entry as unknown as object) === callerId)) {
          names.add(name);
        }
      }
      return [...names];
    },
  };
}
