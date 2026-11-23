// diff 卡（R178）：edit——类别词「已编辑/正在编辑」+ 文件链接 + ±N；展开 = 行号 diff（240px 上限）。
// R188：按扩展名做语法高亮（宿主 shiki token 化；异步、120k 上限、失败降纯文本）。
import { structuredPatch } from "diff";
import { useEffect, useState } from "react";
import type { WebPartContext } from "../../types.js";
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { ToolView } from "./fallback.js";
import { FileChip } from "./file-preview.js";
import { type CardProps, failureTitle, parseInput, str, toolFailure } from "./shell.js";

interface DiffRow {
  kind: "add" | "del" | "context" | "note";
  oldLine?: number;
  newLine?: number;
  text: string;
}

interface CodeToken {
  content: string;
  color?: string;
}
interface DiffTokens {
  old?: CodeToken[][];
  new?: CodeToken[][];
}

/** 扩展名 → shiki 语言 id（宿主 LANG_LOADERS 覆盖的子集；表外 = 纯文本） */
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  py: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  lua: "lua",
  r: "r",
  dart: "dart",
  zig: "zig",
  ex: "elixir",
  exs: "elixir",
  graphql: "graphql",
  hs: "haskell",
  dockerfile: "dockerfile",
};

export function languageForPath(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return LANG_BY_EXT[name.slice(dot + 1)];
}

/** 差异 token 化（异步）：宿主缺 tokenizeCode / 未知语言 / 超限 → 空 = 纯文本。 */
export function useDiffTokens(
  ctx: WebPartContext,
  oldText: string,
  newText: string,
  path: string,
): DiffTokens {
  const [tokens, setTokens] = useState<DiffTokens>({});
  useEffect(() => {
    setTokens({});
    const tokenize = ctx.host?.tokenizeCode;
    if (tokenize === undefined) return;
    const lang = languageForPath(path);
    if (lang === undefined) return;
    let alive = true;
    void Promise.all([tokenize(oldText, lang), tokenize(newText, lang)])
      .then(([oldT, newT]) => {
        if (alive && oldT !== undefined && newT !== undefined) {
          setTokens({ old: oldT, new: newT });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.host, oldText, newText, path]);
  return tokens;
}

function renderLineTokens(tokens: CodeToken[] | undefined, text: string): React.ReactNode {
  if (tokens === undefined) return text;
  const joined = tokens.map((t) => t.content).join("");
  if (joined !== text) return text; // 行内容与 token 不一致（尾换行等）——保原文
  return tokens.map((token, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: 行内 token 纯静态呈现（声明序即渲染序）
    <span key={i} style={token.color !== undefined ? { color: token.color } : undefined}>
      {token.content}
    </span>
  ));
}

/** 超限整体替换 fallback 的行数上限：大文本一次性挂全部行会撑爆 DOM。 */
export const DIFF_FALLBACK_MAX_LINES = 1000;

/** jsdiff structuredPatch → 行序列。返回 null = 两串相同。 */
export function buildDiffRows(
  oldText: string,
  newText: string,
): { rows: DiffRow[]; added: number; removed: number; truncated?: boolean } | null {
  if (oldText === newText) return null;
  const patch = structuredPatch("a", "b", oldText, newText, "", "", {
    context: 3,
    maxEditLength: 2000,
  });
  const raw = patch?.hunks;
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  if (raw !== undefined && raw.length > 0) {
    for (const h of raw) {
      // 逐 hunk 推进：行号从各自 hunk.oldStart/newStart 起步（多 hunk 常态）。
      let oldLine = h.oldStart;
      let newLine = h.newStart;
      for (const line of h.lines) {
        const mark = line.charAt(0);
        const text = line.slice(1);
        if (mark === "+") {
          rows.push({ kind: "add", newLine, text });
          newLine += 1;
          added += 1;
        } else if (mark === "-") {
          rows.push({ kind: "del", oldLine, text });
          oldLine += 1;
          removed += 1;
        } else if (mark === "\\") {
          rows.push({ kind: "note", text: line });
        } else {
          rows.push({ kind: "context", oldLine, newLine, text });
          oldLine += 1;
          newLine += 1;
        }
      }
    }
    return { rows, added, removed };
  }
  // 超限 fallback：旧行全 del + 新行全 add，超千行截断（计数仍算全量）。
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const truncated = oldLines.length + newLines.length > DIFF_FALLBACK_MAX_LINES;
  const cap = truncated ? Math.floor(DIFF_FALLBACK_MAX_LINES / 2) : undefined;
  for (const [i, l] of oldLines.slice(0, cap).entries()) {
    rows.push({ kind: "del", oldLine: i + 1, text: l });
  }
  for (const [i, l] of newLines.slice(0, cap).entries()) {
    rows.push({ kind: "add", newLine: i + 1, text: l });
  }
  return {
    rows,
    added: newLines.length,
    removed: oldLines.length,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** diff 行序列渲染（行号双 gutter + 增删着色；240px 上限；tokens 在场时逐行语法高亮）。 */
export function DiffRowsView({
  rows,
  tokens,
}: {
  rows: DiffRow[];
  tokens?: DiffTokens;
}): React.ReactNode {
  return (
    <div className="henira-diff-view">
      {rows.map((r, i) => {
        const lineTokens =
          r.kind === "del"
            ? tokens?.old?.[(r.oldLine ?? 0) - 1]
            : tokens?.new?.[(r.newLine ?? 0) - 1];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）
          <div key={i} className={`henira-diff-row is-${r.kind}`}>
            <span className="henira-diff-gutter">{r.kind === "note" ? "" : (r.oldLine ?? "")}</span>
            <span className="henira-diff-gutter">{r.kind === "note" ? "" : (r.newLine ?? "")}</span>
            <span className="henira-diff-mark">
              {r.kind === "add" ? "+" : r.kind === "del" ? "-" : ""}
            </span>
            <span className="henira-diff-text">{renderLineTokens(lineTokens, r.text)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** ±N 计数（摘要后缀通道）。 */
export function DiffTotals({
  added,
  removed,
}: {
  added: number;
  removed: number;
}): React.ReactNode {
  return (
    <span className="henira-diff-totals">
      <span className="is-add">+{added}</span> <span className="is-del">-{removed}</span>
    </span>
  );
}

/** diff 展开体：token 化只随展开体挂载（收起态/无变更不 token；R189 懒加载）。 */
function EditDiffBody(props: {
  ctx: WebPartContext;
  rows: DiffRow[];
  oldText: string;
  newText: string;
  path: string;
}): React.ReactNode {
  const tokens = useDiffTokens(props.ctx, props.oldText, props.newText, props.path);
  return (
    <div className="henira-tool-card">
      <DiffRowsView rows={props.rows} tokens={tokens} />
    </div>
  );
}

/** edit 卡：old/new 从行 input JSON 解析；行本身可展开看 diff。 */
export function EditCard({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const oldText = input === null ? null : str(input.old_string);
  const newText = input === null ? null : str(input.new_string);
  const filePath = input === null ? null : (str(input.file_path) ?? str(input.path));
  if (oldText === null || newText === null || filePath === null) {
    return <ToolView row={row} ctx={ctx} />;
  }
  const diff = buildDiffRows(oldText, newText);
  const running = row.status === "running";
  if (diff === null) {
    // old === new：不再回落通用参数卡（R179 挂账）——仍是 edit 行，只是没有 diff 体
    return (
      <ToolRow
        icon={toolGlyph(row.name)}
        kindLabel={ctx.t(running ? "tool.kind.editing" : "tool.kind.edited")}
        primary={
          <FileChip
            path={filePath}
            onOpen={
              ctx.preview === undefined
                ? undefined
                : () => {
                    ctx.preview?.open({ kind: "file", path: filePath, rowId: row.rowId });
                  }
            }
          />
        }
        secondary={ctx.t("tool.noChanges")}
        busy={running}
        canToggle={false}
        rowTitle={`${row.name} (${row.callId})`}
        status={toolFailure(row, ctx.t)}
        statusTitle={failureTitle(row)}
      />
    );
  }
  const diffRows =
    diff.truncated === true
      ? [...diff.rows, { kind: "note" as const, text: ctx.t("tool.diffTruncated") }]
      : diff.rows;
  return (
    <ToolRow
      icon={toolGlyph(row.name)}
      kindLabel={ctx.t(running ? "tool.kind.editing" : "tool.kind.edited")}
      primary={
        <FileChip
          path={filePath}
          onOpen={
            ctx.preview === undefined
              ? undefined
              : () => {
                  ctx.preview?.open({ kind: "file", path: filePath, rowId: row.rowId });
                }
          }
        />
      }
      diff={<DiffTotals added={diff.added} removed={diff.removed} />}
      busy={running}
      canToggle
      persistKey={`${ctx.sessionId ?? "none"}:${row.callId}`}
      rowTitle={`${row.name} (${row.callId})`}
      status={toolFailure(row, ctx.t)}
      statusTitle={failureTitle(row)}
    >
      <EditDiffBody ctx={ctx} rows={diffRows} oldText={oldText} newText={newText} path={filePath} />
    </ToolRow>
  );
}

export type { DiffRow };
