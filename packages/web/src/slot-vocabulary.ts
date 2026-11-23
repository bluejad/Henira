// UI 槽位词表（D-033 区域 + D-043 官方槽 + D-057 keyed 前缀 + D-062 结构性/右栏）。
// 从 host.ts 抽出（R186 收尾，审查 P3⑦）：词表是宿主行为判据，抽出后可单测直接锁接线——
// 此前只有 slot-registry 测试自注入谓词，host 里的真实词表零覆盖。词表外 = 完全未知 →
// 告警并忽略（§7.2）；keyed 前缀合法、后缀自由。新增槽位时三处同改：本文件、
// plugins.md 词表、interfaces.md slotKinds（反向核对随批）。

const REGION_SLOTS: ReadonlySet<string> = new Set([
  "layout",
  "sidebar",
  "conversation",
  "composer",
  "composer.bar",
  "composer.takeover",
  "composer.model",
  "composer.left",
  "composer.right",
  "composer.dock",
  "sidebar.right",
  "sidebar.right.tab",
  "turn.tail",
  "conversation.images",
]);

/** single 槽（R183，dsh SlotKind single）：同一时刻只一位占用者——composer.bar（常驻输入栏）
 *  与 composer.model（模型 + 思考控制）；其余区域/追加位保持 list 语义。 */
const SINGLE_SLOTS: ReadonlySet<string> = new Set(["composer.bar", "composer.model"]);

/** 预览缝保留前缀（R190，D-076）：按后缀 keyed，一个后缀一位实现（通配 `*` 也占一位）。 */
const PREVIEW_SLOT_PREFIX = "sidebar.right.preview.";

/** single 判据：区域单槽 + 预览键全族（消灭 keyed 追加 [0] 赢的静默歧义）。 */
function isSingleSlot(name: string): boolean {
  return SINGLE_SLOTS.has(name) || name.startsWith(PREVIEW_SLOT_PREFIX);
}

const KEYED_PREFIXES = ["tool.call.view.", "sidebar.right.preview.", "approval.view."] as const;

function slotAccepted(name: string): boolean {
  return REGION_SLOTS.has(name) || KEYED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export { isSingleSlot, KEYED_PREFIXES, REGION_SLOTS, SINGLE_SLOTS, slotAccepted };
