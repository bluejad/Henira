// 预览打开方式（R188）：弹窗 / 右栏按内容类型各自可设。
// 设置字段住 settings.json ui.preview；宿主按 previewMode 路由，官方件与第三方件共用。

export type PreviewKind = "file" | "image";
export type PreviewOpenMode = "panel" | "modal";

export interface PreviewOpenSettings {
  file?: PreviewOpenMode;
  image?: PreviewOpenMode;
}

/** 缺省：文件右侧（边看边对话）、图片弹窗（轻量灯箱，不挤对话区） */
export const DEFAULT_PREVIEW_OPEN: Required<PreviewOpenSettings> = {
  file: "panel",
  image: "modal",
};

export function previewMode(
  settings: PreviewOpenSettings | undefined,
  kind: PreviewKind,
): PreviewOpenMode {
  const value = settings?.[kind];
  return value === "panel" || value === "modal" ? value : DEFAULT_PREVIEW_OPEN[kind];
}
