// 预览缝解析器（R190，dsh 后缀匹配同形）：sidebar.right.preview.<后缀> 的 keyed 选择。
// 语义：文件名归一（最后一段、小写）→ 已注册后缀键最长匹配（tar.gz > gz）→ 通配 * → 无件。
// 空后缀键与 * 等价（通配）；精确键只对 preview-file 生效（图片无文件名，只落通配）。

export const PREVIEW_SLOT_PREFIX = "sidebar.right.preview.";
export const PREVIEW_WILDCARD = "*";

/** 命中结果：槽名 + 匹配的后缀（通配 = "*"） */
export interface PreviewSlotMatch {
  name: string;
  suffix: string;
}

/** 文件名最后一段（小写；`\` 也当分隔符——Windows 路径同判） */
export function previewFileName(path: string | undefined): string {
  if (path === undefined || path === "") return "";
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

/** 归一化扩展名：最后一段最后一个点之后（`.env` → "env"；无点/尾点 = ""） */
export function previewExt(path: string | undefined): string {
  const name = previewFileName(path);
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1);
}

/** 声明后缀归一：小写、去前导点（复合后缀 `tar.gz` 原样保留） */
export function normalizePreviewSuffix(suffix: string): string {
  return suffix.toLowerCase().replace(/^\.+/, "");
}

/** 在已占有槽名里选实现：最长后缀赢；同后缀不可能（预览键 single 占用）；通配最后兜底。 */
export function pickPreviewSlot(
  slotNames: Iterable<string>,
  path: string | undefined,
): PreviewSlotMatch | undefined {
  const name = previewFileName(path);
  let best: PreviewSlotMatch | undefined;
  let wildcard: PreviewSlotMatch | undefined;
  for (const slotName of slotNames) {
    if (!slotName.startsWith(PREVIEW_SLOT_PREFIX)) continue;
    const suffix = normalizePreviewSuffix(slotName.slice(PREVIEW_SLOT_PREFIX.length));
    if (suffix === "" || suffix === PREVIEW_WILDCARD) {
      wildcard ??= { name: slotName, suffix: PREVIEW_WILDCARD };
      continue;
    }
    if (name === "" || !name.endsWith(`.${suffix}`)) continue;
    if (best === undefined || suffix.length > best.suffix.length) {
      best = { name: slotName, suffix };
    }
  }
  return best ?? wildcard;
}
