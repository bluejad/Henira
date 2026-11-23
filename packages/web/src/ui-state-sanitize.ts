// 会话 ui-state 落盘前净化（R188 审查 P2）：图片 tab 的 data: URI 是内容不是引用——
// 它无法跨刷新重建，且会把 64KB 文档撑爆导致整份 PUT 被服务端拒掉（草稿一起丢）。
// 文件 tab（path+rowId）与 URL src 都是引用，照旧持久化；内联图 tab 只活在本页内存。

import type { SessionUiState } from "@henira/protocol";

/** 剔除 data: 图片 tab；active 指向被剔 tab 时重指向最后一个剩余 tab（无剩余 = null）。
 *  无需剔除时原样返回同一引用（调用方零额外渲染）。 */
export function sanitizeSessionUiState(doc: SessionUiState): SessionUiState {
  const rightPanel = doc.rightPanel;
  const tabs = rightPanel?.tabs;
  if (rightPanel === undefined || tabs === undefined || tabs.length === 0) return doc;
  const kept = tabs.filter(
    (tab) =>
      !(tab.kind === "preview-image" && typeof tab.src === "string" && tab.src.startsWith("data:")),
  );
  if (kept.length === tabs.length) return doc;
  const active = rightPanel.active ?? null;
  const nextActive =
    active !== null && kept.some((tab) => tab.id === active)
      ? active
      : (kept[kept.length - 1]?.id ?? null);
  return {
    ...doc,
    rightPanel: { ...rightPanel, active: nextActive, tabs: kept },
  };
}
