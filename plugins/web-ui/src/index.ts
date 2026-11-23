// 官方界面套件（D-043）：布局 + 会话列表 / 对话面板 / 输入框 / 审批卡各件各占槽。
// 双通道：①编译期出口（本 index 直出的件——web 宿主安全模式与默认组合直接用，与插件用件
// 同一零件库，import map 同口子）；②真插件公共注册路径（webUiModule 经 UiModuleContext 挂载）。

export { defineChainEntry, electChain } from "./chain.js";
export { makeT } from "./locales/make-t.js";
export { type Dict, zh } from "./locales/zh.js";
export {
  defaultApprovalViews,
  defaultChainEntries,
  defaultComposerBar,
  defaultComposerSeats,
  defaultParts,
  defaultPreviewViews,
  defaultToolViews,
  webUiModule,
} from "./module.js";
export {
  ApprovalCard,
  ApprovalCardShell,
  ApprovalQueueCard,
  ApprovalSettledRow,
} from "./parts/approval-card.js";
export { ApprovalPreview } from "./parts/approval-preview.js";
export { Composer } from "./parts/composer.js";
export {
  approvalTakeover,
  ComposerDock,
  type ComposerTakeoverMatched,
  type ComposerTakeoverOwner,
  questionTakeover,
} from "./parts/composer-dock.js";
export { type ComposerRuntime, useComposerRuntime } from "./parts/composer-state.js";
export { Conversation, CopyButton } from "./parts/conversation.js";
export { CodeGlyph } from "./parts/icons.js";
export { LayoutFrame } from "./parts/layout-frame.js";
export { ModelSeat } from "./parts/model-seat.js";
export { ModelSelect } from "./parts/model-select.js";
export { QuestionAnswers, QuestionCard } from "./parts/question-card.js";
export { QueueDock } from "./parts/queue-dock.js";
export { RightPanel } from "./parts/right-panel.js";
export { DetailPane, DisclosureRow, type DisclosureRowProps, Pill } from "./parts/row-chrome.js";
export { SessionList } from "./parts/session-list.js";
export { SettingsModal } from "./parts/settings-modal.js";
export { SlotBoundary } from "./parts/slot-boundary.js";
export {
  AskUserCard,
  buildDiffRows,
  DIFF_FALLBACK_MAX_LINES,
  DiffRowsView,
  DiffTotals,
  EditCard,
  GlobCard,
  GrepCard,
  McpCard,
  ReadCard,
  str,
  TerminalCard,
  ToolView,
  tryFormatJson,
  WriteCard,
} from "./parts/tool-cards.js";
export type {
  ApprovalCardView,
  ChainEntry,
  ComposerApi,
  HeniraClientLike,
  LayoutOption,
  ModelCatalog,
  PluginInfo,
  PluginUiHost,
  PreviewApi,
  PreviewTabPayload,
  PreviewTarget,
  PreviewView,
  PreviewViewArgs,
  ResourceSnapshot,
  RowStoreLike,
  SettingsSection,
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
