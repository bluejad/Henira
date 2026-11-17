// 官方界面套件（D-043）：布局 + 会话列表 / 对话面板 / 输入框 / 审批卡各件各占槽。
// 双通道：①编译期出口（本 index 直出的件——web 宿主安全模式与默认组合直接用，与插件用件
// 同一零件库，import map 同口子）；②真插件公共注册路径（webUiModule 经 UiModuleContext 挂载）。

export { type Dict, zh } from "./locales/zh.js";
export { defaultParts, webUiModule } from "./module.js";
export { ApprovalCard, ApprovalSettledRow } from "./parts/approval-card.js";
export { Composer } from "./parts/composer.js";
export { Conversation, CopyButton } from "./parts/conversation.js";
export { DetailPane, DisclosureRow, type DisclosureRowProps } from "./parts/row-chrome.js";
export { SessionList } from "./parts/session-list.js";
export type {
  HeniraClientLike,
  PluginUiHost,
  RowStoreLike,
  SlotPart,
  ToolCallView,
  UiAssetLocale,
  UiAssets,
  UiAssetTheme,
  UiModuleContext,
  WebPart,
  WebPartContext,
  WebSlotName,
} from "./types.js";
