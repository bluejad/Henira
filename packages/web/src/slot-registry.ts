// 槽位登记簿（host.ts 槽位管理抽出，可单测——审查 F3 顶替语义修复）：registerSlot 列表
// 追加（order 排序、[0] 赢）+ replaceSlot 顶替。顶替语义（D-057/D-048 全链）：官方默认件
// 可被插件 replaceSlot 顶替、卸载按登记回落官方；第三方件之间的同 key 第二家才报错——
// 判据 = 在位件的所有权，不是「有没有默认件」。官方未占键时两种实现恰好同观感（顶替=
// 认领空槽），E5 起官方注册 per-tool 卡后「占位即报错」会把第三方整个 UI 模块挡在装载
// 门外——承诺的顶替路径从此不通。

import type { SlotPart } from "@henira/plugin-web-ui";

export interface SlotRegistryOptions {
  /** 词表闸（§7.2）：词表外槽名忽略，走告警出口 */
  slotAccepted(name: string): boolean;
  onUnknownSlot(name: string): void;
  /** 官方 UI 模块的插件 id（其注册的件 = 官方默认件，可被顶替；discovery 唯一，第三方不可能同名） */
  officialId: string;
}

export interface SlotRegistry {
  /** 槽位表（渲染消费面；ctx.slots 直透） */
  readonly slots: Map<string, SlotPart[]>;
  /** 按调用方身份出注册 API：官方模块 officialId / 第三方各自插件 id（所有权随件登记）。
   * 返回撤销器 = 裸函数签名（kernel Disposable 同形状，结构化赋值——web 不新增 kernel 依赖边） */
  apiFor(callerId: string): {
    registerSlot(name: string, part: SlotPart, opts?: { order?: number }): () => void;
    replaceSlot(name: string, part: SlotPart): () => void;
  };
  /** 全量重建前清场（renderSlots）：必须在第三方 dispose 之前清登记簿——重建期卸载回落
   * 不得复活旧列表（dispose 闭包查不到登记 = no-op，清场后全量重装） */
  reset(): void;
}

export function createSlotRegistry(opts: SlotRegistryOptions): SlotRegistry {
  const slots = new Map<string, SlotPart[]>();
  /** registerSlot 的 order 旁路（插入排序用；part 是函数，WeakMap 门牌） */
  let partOrders = new WeakMap<object, number>();
  /** 件所有权：registerSlot 登记来源（官方 id / 插件 id）——replaceSlot 冲突判据 */
  let partOwners = new WeakMap<object, string>();
  /** replaceSlot 顶替登记：name → { owner, part, previous }——卸载按登记回落 */
  const claims = new Map<string, { owner: string; part: SlotPart; previous: SlotPart[] }>();

  return {
    slots,
    apiFor(callerId) {
      return {
        registerSlot(name, part, registerOpts) {
          if (!opts.slotAccepted(name)) {
            opts.onUnknownSlot(name);
            return () => {};
          }
          const list = slots.get(name) ?? [];
          const order = registerOpts?.order ?? 0;
          partOrders.set(part as unknown as object, order);
          partOwners.set(part as unknown as object, callerId);
          const at = list.findIndex((p) => (partOrders.get(p as unknown as object) ?? 0) > order);
          if (at === -1) list.push(part);
          else list.splice(at, 0, part);
          slots.set(name, list);
          return () => {
            const current = slots.get(name);
            if (current === undefined) return;
            const index = current.indexOf(part);
            if (index >= 0) current.splice(index, 1);
          };
        },
        replaceSlot(name, part) {
          if (!opts.slotAccepted(name)) {
            opts.onUnknownSlot(name);
            return () => {};
          }
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
        },
      };
    },
    reset() {
      slots.clear();
      partOrders = new WeakMap();
      partOwners = new WeakMap();
      claims.clear();
    },
  };
}
