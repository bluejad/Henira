// 搜索卡（R178）：静态一行——类别词「已搜索/正在搜索」+ 一句「查找 <query>」。
// 不展开结果列表、不挂文件 chip（结果由最终回答承载；行只表达搜索动作）。
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { type CardProps, failureTitle, parseInput, str, toolFailure } from "./shell.js";

function searchPhrase(row: CardProps["row"], ctx: CardProps["ctx"]): string {
  const input = parseInput(row);
  const pattern = input === null ? null : (str(input.pattern) ?? str(input.query));
  if (pattern !== null && pattern.trim() !== "") {
    return `${ctx.t("tool.search.find")} ${pattern}`;
  }
  const path = input === null ? null : str(input.path);
  if (path !== null && path.trim() !== "") {
    return `${ctx.t("tool.search.list")} ${path}`;
  }
  return ctx.t("tool.search.find");
}

function SearchCard({ row, ctx }: CardProps): React.ReactNode {
  const running = row.status === "running";
  return (
    <ToolRow
      icon={toolGlyph(row.name)}
      kindLabel={ctx.t(running ? "tool.kind.searching" : "tool.kind.searched")}
      primary={searchPhrase(row, ctx)}
      busy={running}
      canToggle={false}
      rowTitle={`${row.name} · ${row.callId}`}
      status={toolFailure(row, ctx.t)}
      statusTitle={failureTitle(row)}
    />
  );
}

/** glob 同属搜索族（文件查找）：同一句摘要、同一静态行形状。 */
export function GlobCard(props: CardProps): React.ReactNode {
  return <SearchCard {...props} />;
}

/** grep：同一句摘要、同一静态行形状。 */
export function GrepCard(props: CardProps): React.ReactNode {
  return <SearchCard {...props} />;
}
