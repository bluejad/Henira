// 工具行预览上下文（R178）：过程组头复用当前活动项的摘要行，但不挂详情/交互。
// 官方行壳读本上下文后只渲染摘要；第三方卡未接 = 仍渲染自己的正常形态（不阻断）。
import { createContext, useContext } from "react";

const ToolPreviewContext = createContext(false);

function useToolPreview(): boolean {
  return useContext(ToolPreviewContext);
}

export { ToolPreviewContext, useToolPreview };
