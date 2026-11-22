// 工具行路由（R177 拆分）：keyed 槽 tool.call.view.<工具名> → MCP 总缝 → 通用卡。
import type { ToolRow } from "@henira/protocol";
import type { ToolCallView, WebPartContext } from "../../types.js";
import { SlotBoundary } from "../slot-boundary.js";
import { ToolView } from "../tool-cards.js";

/** 工具行路由（D-057 keyed 缝）：① 精确 keyed 槽 tool.call.view.<wire 名>（官方 per-tool
 * 卡经 module.ts 注册进缝、第三方 replaceSlot 顶替同语义；字面名 "mcp" 除外——
 * tool.call.view.mcp 是 MCP 总缝保留键，撞名工具直接落通用卡）→ ② MCP 工具（mcp__ 前缀、
 * 动态名无法逐个注册）查 tool.call.view.mcp 总缝——渲染槽内件本身（官方 McpCard 默认注册
 * 在此，第三方可整类顶替；硬编码渲染会架空顶替语义，审查 F1）→ ③ ToolView 通用卡兜底
 * （同包行级边界：兜底卡崩溃只损失该行，不拖垮全会话区——审查 F8）。 */
function ToolRowView({ row, ctx }: { row: ToolRow; ctx: WebPartContext }): React.ReactNode {
  const view =
    row.name === "mcp"
      ? undefined
      : (ctx.slots.get(`tool.call.view.${row.name}`)?.[0] as ToolCallView | undefined);
  const View = view; // 组件渲染（hooks 合法——批 C 修正）
  if (View !== undefined) {
    return (
      <SlotBoundary label={`tool.call.view.${row.name}`}>
        <View ctx={ctx} row={row} />
      </SlotBoundary>
    );
  }
  if (row.name.startsWith("mcp__")) {
    const McpSlotView = ctx.slots.get("tool.call.view.mcp")?.[0] as ToolCallView | undefined;
    if (McpSlotView !== undefined) {
      return (
        <SlotBoundary label="tool.call.view.mcp">
          <McpSlotView ctx={ctx} row={row} />
        </SlotBoundary>
      );
    }
  }
  return (
    <SlotBoundary label="tool.call.view">
      <ToolView row={row} ctx={ctx} />
    </SlotBoundary>
  );
}

export { ToolRowView };
