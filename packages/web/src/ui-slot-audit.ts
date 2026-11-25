// `ui.slots` 静态申报 vs 实际注册（D-031 / D-085）：纯函数，宿主装载模块后调用。
// 规则：只告警不阻断；仅当 manifest 有 ui.slots 时校验（未声明 = 合法，行为同 D-021）。
// - unknown = 声明了宿主词表里没有的挂载点（丢弃该条并告警）
// - missing = 声明了但模块没注册（死声明）
// - undeclared = 注册了但没声明（漏声明）
// 槽名先 canonical 再比对（预览键大小写/前导点变体落同一键）。

export interface UiSlotAudit {
  unknown: string[];
  missing: string[];
  undeclared: string[];
}

export interface UiSlotAuditInput {
  /** manifest 的 ui.slots；undefined / 空数组 = 不校验 */
  declared: readonly string[] | undefined;
  /** 该插件当前实际占用的槽名（registry.ownedSlotNames） */
  registered: readonly string[];
  /** 宿主词表接受判据（slotAccepted） */
  accepted(name: string): boolean;
  /** 槽名归一（缺省恒等） */
  canonical?(name: string): string;
}

export function auditUiSlots(input: UiSlotAuditInput): UiSlotAudit {
  const empty: UiSlotAudit = { unknown: [], missing: [], undeclared: [] };
  if (input.declared === undefined || input.declared.length === 0) return empty;
  const canonical = input.canonical ?? ((name: string) => name);
  const declared = new Set(input.declared.map((name) => canonical(name)));
  const registered = new Set(input.registered.map((name) => canonical(name)));
  const unknown: string[] = [];
  const missing: string[] = [];
  const undeclared: string[] = [];
  for (const name of declared) {
    if (!input.accepted(name)) {
      unknown.push(name);
      continue;
    }
    if (!registered.has(name)) missing.push(name);
  }
  for (const name of registered) {
    if (!declared.has(name)) undeclared.push(name);
  }
  return { unknown, missing, undeclared };
}
