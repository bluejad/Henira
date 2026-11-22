// 工具行图标分派（R178）：工具身份 → 16px 语义图标。状态不再占用图标色——
// 运行/失败由类别词扫光与状态词表达，图标固定 tool 身份。
import type { WorkCategory } from "./conversation/turn-items.js";
import {
  BrainGlyph,
  MagnifierGlyph,
  PencilGlyph,
  PlugGlyph,
  QuestionGlyph,
  TerminalGlyph,
  WrenchGlyph,
} from "./icons.js";

function toolGlyph(name: string, size = 16): React.ReactNode {
  if (name === "bash" || name === "powershell") return <TerminalGlyph size={size} />;
  if (name === "read" || name === "glob" || name === "grep") {
    return <MagnifierGlyph size={size} />;
  }
  if (name === "edit" || name === "write") return <PencilGlyph size={size} />;
  if (name.startsWith("mcp__") || name === "mcp") return <PlugGlyph size={size} />;
  if (name === "ask_user") return <QuestionGlyph size={size} />;
  return <WrenchGlyph size={size} />;
}

function categoryGlyph(category: WorkCategory | "reasoning" | null, size = 16): React.ReactNode {
  switch (category) {
    case "explore":
      return <MagnifierGlyph size={size} />;
    case "run":
      return <TerminalGlyph size={size} />;
    case "change":
      return <PencilGlyph size={size} />;
    case "session":
      return <PlugGlyph size={size} />;
    case "reasoning":
      return <BrainGlyph size={size} />;
    default:
      return <WrenchGlyph size={size} />;
  }
}

export { categoryGlyph, toolGlyph };
