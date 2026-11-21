// per-tool 官方卡（E5）：终端 / diff / 新建 / 读取 / 搜索 / MCP 六卡 + 通用卡 ToolView。
// 数据通道 = ToolResult.__meta（P4 带外，不进模型上下文）→ tool/result.meta → ToolRowOutput.meta；
// content 文本仍是权威（模型可见面一字不改），meta 只是 UI 增强——无 meta 的旧会话或第三方
// 工具自然落到 ToolView 通用卡。校验纪律（dsh 行为层「宁缺毋滥」）：meta 逐字段窄化，
// 不认识或类型不过一律回落通用渲染，绝不渲染坏卡。行壳与 keyed 顶替件共用同一套
// DisclosureRow/Pill 原语（D-057 观感协调）。折叠取向 = max-h 滚动（与 DetailPane 一致）；
// dsh 式头尾折叠挂账。ANSI 着色不做（非 pty 捕获下序列少，anser 级管线挂账）。

import type { ToolRow } from "@henira/protocol";
import { structuredPatch } from "diff";
import { Fragment, useEffect, useState } from "react";
import type { WebPartContext } from "../types.js";
import { CopyButton } from "./copy-button.js";
import { CheckGlyph, SpinnerGlyph, XGlyph } from "./icons.js";
import { DetailPane, DisclosureRow, Pill } from "./row-chrome.js";

export interface CardProps {
  row: ToolRow;
  ctx: WebPartContext;
}

// ── meta 窄化 helpers（dsh「宁缺毋滥」纪律的实现体）──

function asMeta(row: ToolRow, kind: string): Record<string, unknown> | null {
  const m = row.output?.meta;
  if (m === null || typeof m !== "object" || Array.isArray(m)) return null;
  if (m.kind !== kind) return null;
  return m as Record<string, unknown>;
}

export function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** 行 input（模型原始 args JSON）容错解析；非对象 = null */
function parseInput(row: ToolRow): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(row.input);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 结果文本若是 JSON（对象/数组开头且可解析）→ 格式化；否则 null（E6 审批预览复用） */
export function tryFormatJson(text: string): string | null {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.stringify(JSON.parse(t) as unknown, null, 2);
  } catch {
    return null;
  }
}

/** meta 文本数组窄化（元素逐个校验，任一不过 = 整体 null） */
function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

// ── 行壳（六卡共用；icon/状态色/错误自动展开/耗时与截断徽章与 ToolView 同一行为）──

function ToolCardShell(props: {
  row: ToolRow;
  ctx: CardProps["ctx"];
  /** 覆盖状态色（终端卡非零退出视觉升级红——dsh terminalFailed 行为；不改 row.status 语义） */
  tone?: string;
  /** 行标题覆盖（MCP 卡拆名显示 server · tool） */
  title?: string;
  summaryExtra?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactNode {
  const { row, ctx } = props;
  const isError = row.status === "error";
  const statusColor =
    props.tone ??
    (row.status === "running"
      ? "var(--henira-info-text)"
      : isError
        ? "var(--henira-danger-text)"
        : "var(--henira-ok-text)");
  const running = row.status === "running";
  const [revealed, setRevealed] = useState(isError);
  useEffect(() => {
    if (isError) setRevealed(true);
  }, [isError]);
  return (
    <DisclosureRow
      icon={
        running ? (
          <SpinnerGlyph size={14} color={statusColor} />
        ) : isError ? (
          <XGlyph size={14} color={statusColor} />
        ) : (
          <CheckGlyph size={14} color={statusColor} />
        )
      }
      title={props.title ?? row.name}
      busy={running}
      tone={statusColor}
      meta={`#${row.callId}`}
      summary={
        <>
          {row.status === "done" && row.output !== undefined ? (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.output.durationMs}ms</span>
          ) : null}
          {row.output?.truncated !== undefined ? (
            <Pill
              bg="var(--henira-warn-bg)"
              color="var(--henira-warn-text)"
              title={row.output.truncated.path}
            >
              {ctx.t("row.truncated")}
            </Pill>
          ) : null}
          {props.summaryExtra}
        </>
      }
      open={revealed ? true : undefined}
    >
      {props.children}
    </DisclosureRow>
  );
}

/** mono pre 块（卡内滚动上限统一走 maxHeight——与 DetailPane 同一取向） */
function MonoBlock(props: { text: string; color?: string; maxHeight?: number }): React.ReactNode {
  return (
    <pre
      className="henira-mono"
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        color: props.color,
        fontSize: "var(--henira-fs-md)",
        maxHeight: props.maxHeight,
        overflowY: props.maxHeight !== undefined ? "auto" : undefined,
      }}
    >
      {props.text}
    </pre>
  );
}

// ── 终端卡（bash / powershell）──

interface ShellMeta {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  signal?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

function narrowShell(m: Record<string, unknown>): ShellMeta | null {
  const rawExit = m.exitCode;
  const exitCode = rawExit === null ? null : num(rawExit);
  if (exitCode === null && rawExit !== null) return null;
  const stdout = str(m.stdout);
  const stderr = str(m.stderr);
  if (stdout === null || stderr === null) return null;
  return {
    exitCode,
    stdout,
    stderr,
    timedOut: bool(m.timedOut),
    signal: str(m.signal) ?? undefined,
    stdoutTruncated: bool(m.stdoutTruncated),
    stderrTruncated: bool(m.stderrTruncated),
  };
}

/** 终端卡：命令 prompt 行 + stdout 默认色 / stderr 红分色（CC 行为层，结构化字段比 dsh
 * 的文本尾解析更干净）+ 退出码徽章；非零退出 / 被信号杀 → 行图标视觉升级红（dsh
 * terminalFailed——退出码是结果数据不是 isError，语义不改）。meta 缺 = content 原样。 */
export function TerminalCard({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const command = input === null ? null : str(input.command);
  const meta = row.output === undefined ? null : asMeta(row, "shell");
  const m = meta === null ? null : narrowShell(meta);
  if (command === null && m === null && row.output === undefined) {
    return <ToolView row={row} ctx={ctx} />;
  }
  const failed = m !== null && (m.exitCode === null || m.exitCode !== 0);
  // 流截断可见（审查 F4）：模型面 content 有截断注记，UI 只有 meta 知道——漏了用户看不到
  // 「只保留尾部 20KB」这个事实
  const streamTruncated = m !== null && (m.stdoutTruncated === true || m.stderrTruncated === true);
  const summaryExtra =
    m === null || row.status === "running" ? null : (
      <>
        {m.timedOut === true ? (
          <Pill bg="var(--henira-warn-bg)" color="var(--henira-warn-text)">
            {ctx.t("tool.timedOut")}
          </Pill>
        ) : m.exitCode === null ? (
          <Pill bg="var(--henira-danger-bg)" color="var(--henira-danger-text)">
            {ctx.t("tool.killed")}
            {m.signal !== undefined ? ` · ${m.signal}` : ""}
          </Pill>
        ) : m.exitCode !== 0 ? (
          <Pill
            bg="var(--henira-danger-bg)"
            color="var(--henira-danger-text)"
            title={ctx.t("tool.exitCode")}
          >
            exit {m.exitCode}
          </Pill>
        ) : null}
        {streamTruncated ? (
          <Pill
            bg="var(--henira-warn-bg)"
            color="var(--henira-warn-text)"
            title={ctx.t("tool.streamTruncatedTip")}
          >
            {ctx.t("row.truncated")}
          </Pill>
        ) : null}
      </>
    );
  return (
    <ToolCardShell
      row={row}
      ctx={ctx}
      tone={failed ? "var(--henira-danger-text)" : undefined}
      summaryExtra={summaryExtra}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--henira-space-2)" }}>
        {command !== null ? (
          <div
            className="henira-mono"
            style={{ fontSize: "var(--henira-fs-md)", wordBreak: "break-all" }}
          >
            <span style={{ color: "var(--henira-text-muted)" }}>$ </span>
            {command}
          </div>
        ) : null}
        {m !== null ? (
          <>
            {m.stdout !== "" ? <MonoBlock text={m.stdout} maxHeight={240} /> : null}
            {m.stderr !== "" ? (
              <div>
                <div
                  style={{
                    color: "var(--henira-text-muted)",
                    fontSize: "var(--henira-fs-sm)",
                    fontFamily: "var(--henira-mono)",
                  }}
                >
                  stderr
                </div>
                <MonoBlock text={m.stderr} color="var(--henira-danger-text)" maxHeight={160} />
              </div>
            ) : null}
            {m.stdout === "" && m.stderr === "" && row.status === "done" ? (
              <div style={{ color: "var(--henira-text-muted)", fontSize: "var(--henira-fs-md)" }}>
                {ctx.t("tool.noOutput")}
              </div>
            ) : null}
          </>
        ) : row.output !== undefined ? (
          <MonoBlock text={row.output.content} maxHeight={240} />
        ) : null}
      </div>
    </ToolCardShell>
  );
}

// ── diff 卡（edit）与新建/覆盖卡（write）──

interface DiffRow {
  kind: "add" | "del" | "context" | "note";
  oldLine?: number;
  newLine?: number;
  text: string;
}

/** 超限整体替换 fallback 的行数上限：大文本一次性挂全部行会撑爆 DOM（MonoBlock 的
 * maxHeight 管不住行数本身），超限截断 + 注记（注记文案调用方按语言包补）。
 * E6 审批 write 预览同闸复用。 */
export const DIFF_FALLBACK_MAX_LINES = 1000;

/** jsdiff structuredPatch → 行序列。jsdiff 对字符串按行 token 跑 Myers——总编辑长度
 * （删+增行数）超 maxEditLength 时返回 undefined（不产部分结果，审查 F7 机制勘误）——
 * 此时自构整体替换行，行数超 DIFF_FALLBACK_MAX_LINES 截断（truncated=true；±N 计数仍算
 * 全量，行只渲染截断前段）。返回 null = 两串相同。 */
export function buildDiffRows(
  oldText: string,
  newText: string,
): { rows: DiffRow[]; added: number; removed: number; truncated?: boolean } | null {
  if (oldText === newText) return null;
  const patch = structuredPatch("a", "b", oldText, newText, "", "", {
    context: 3,
    maxEditLength: 2000,
  });
  // 类型声明含 undefined 分支——超限/异常形态一律自构 fallback，不渲染坏卡
  const raw = patch?.hunks;
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  if (raw !== undefined && raw.length > 0) {
    // 逐 hunk 推进：行号从各自 hunk.oldStart/newStart 起步——flat 拍平会把后续 hunk 的
    // 起点吃掉，第二+ hunk 行号全错（多点修改的常态形状，审查 F2）
    for (const h of raw) {
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
  // 超限 fallback：自构整体替换行（旧行全 del + 新行全 add），行数超限各截半——
  // ±N 计数仍算全量（行截断计数不截断，徽章反映真实替换规模）
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

const gutterStyle = (width: string): React.CSSProperties => ({
  width,
  flexShrink: 0,
  textAlign: "right",
  color: "var(--henira-text-muted)",
  userSelect: "none",
  paddingRight: "6px",
});

/** diff 行序列渲染（行号双 gutter + 着色；note 行弱色——jsdiff 的 No-newline 标记）。
 * E6 审批 edit/write 预览复用（CC 权限对话框复用工具卡 diff 组件同款行为层）。 */
export function DiffRowsView({ rows }: { rows: DiffRow[] }): React.ReactNode {
  const width = "3ch";
  return (
    <div
      className="henira-mono"
      style={{
        fontSize: "var(--henira-fs-sm)",
        maxHeight: 320,
        overflowY: "auto",
        lineHeight: 1.5,
      }}
    >
      {rows.map((r, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）——row-chrome DetailPane 先例
          key={i}
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            background:
              r.kind === "add"
                ? "var(--henira-ok-bg)"
                : r.kind === "del"
                  ? "var(--henira-danger-bg)"
                  : undefined,
            color: r.kind === "note" ? "var(--henira-text-muted)" : undefined,
          }}
        >
          <span style={gutterStyle(width)}>{r.kind === "note" ? "" : (r.oldLine ?? "")}</span>
          <span style={gutterStyle(width)}>{r.kind === "note" ? "" : (r.newLine ?? "")}</span>
          <span style={{ flexShrink: 0, width: "1ch" }}>
            {r.kind === "add" ? "+" : r.kind === "del" ? "-" : ""}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

/** ±N 计数（dsh diff totals：摘要后缀通道，窄行先吃摘要再吃后缀——计数要可见） */
export function DiffTotals({
  added,
  removed,
}: {
  added: number;
  removed: number;
}): React.ReactNode {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
      <span style={{ color: "var(--henira-ok-text)" }}>+{added}</span>{" "}
      <span style={{ color: "var(--henira-danger-text)" }}>-{removed}</span>
    </span>
  );
}

/** diff 卡（edit）：old/new 从行 input JSON 解析（running 态同款可用 = dsh intendedDiff
 * 预演行为，落定后以结果为准）；replacements>1 → 「N 处替换」徽章。replaceAll 的多次
 * 精确位置服务层未透出——显示单份替换 diff（诚实），精确多 hunk 挂账。 */
export function EditCard({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const oldText = input === null ? null : str(input.old_string);
  const newText = input === null ? null : str(input.new_string);
  const filePath = input === null ? null : str(input.file_path);
  if (oldText === null || newText === null || filePath === null) {
    return <ToolView row={row} ctx={ctx} />;
  }
  const meta = row.output === undefined ? null : asMeta(row, "edit");
  const replacements = meta === null ? 1 : (num(meta.replacements) ?? 1);
  const diff = buildDiffRows(oldText, newText);
  if (diff === null) return <ToolView row={row} ctx={ctx} />;
  const diffRows =
    diff.truncated === true
      ? [...diff.rows, { kind: "note" as const, text: ctx.t("tool.diffTruncated") }]
      : diff.rows;
  return (
    <ToolCardShell
      row={row}
      ctx={ctx}
      summaryExtra={
        <>
          <DiffTotals added={diff.added} removed={diff.removed} />
          {replacements > 1 ? (
            <Pill bg="var(--henira-info-bg)" color="var(--henira-info-text)">
              {`${replacements} ${ctx.t("tool.replacements")}`}
            </Pill>
          ) : null}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--henira-space-2)" }}>
        <div
          className="henira-mono"
          style={{
            fontSize: "var(--henira-fs-sm)",
            color: "var(--henira-text-muted)",
            wordBreak: "break-all",
          }}
        >
          {filePath}
        </div>
        <DiffRowsView rows={diffRows} />
      </div>
    </ToolCardShell>
  );
}

/** 新建/覆盖卡（write）：created = 全文 add 预览（dsh oldText:null 全绿语义）；
 * 覆盖 = 新内容中性 pre（服务不回传旧内容，不装 diff——诚实） */
export function WriteCard({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const content = input === null ? null : str(input.content);
  const filePath = input === null ? null : str(input.file_path);
  if (content === null || filePath === null) return <ToolView row={row} ctx={ctx} />;
  const meta = row.output === undefined ? null : asMeta(row, "write");
  const created = meta === null ? undefined : bool(meta.created);
  const lines = content.split("\n");
  const badge =
    created === true ? (
      <Pill bg="var(--henira-ok-bg)" color="var(--henira-ok-text)">
        {ctx.t("tool.created")}
      </Pill>
    ) : created === false ? (
      <Pill bg="var(--henira-info-bg)" color="var(--henira-info-text)">
        {ctx.t("tool.overwrote")}
      </Pill>
    ) : null;
  return (
    <ToolCardShell
      row={row}
      ctx={ctx}
      summaryExtra={
        <>
          {created === true ? <DiffTotals added={lines.length} removed={0} /> : null}
          {badge}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--henira-space-2)" }}>
        <div
          className="henira-mono"
          style={{
            fontSize: "var(--henira-fs-sm)",
            color: "var(--henira-text-muted)",
            wordBreak: "break-all",
          }}
        >
          {filePath}
        </div>
        {created === true ? (
          <DiffRowsView
            rows={[
              // 千行闸（审查 F6 同族）：全文 add 行超限截断 + 注记，防大文件一次性挂满 DOM
              ...lines
                .slice(0, DIFF_FALLBACK_MAX_LINES)
                .map((text, i) => ({ kind: "add" as const, newLine: i + 1, text })),
              ...(lines.length > DIFF_FALLBACK_MAX_LINES
                ? [{ kind: "note" as const, text: ctx.t("tool.diffTruncated") }]
                : []),
            ]}
          />
        ) : (
          <MonoBlock text={content} maxHeight={320} />
        )}
      </div>
    </ToolCardShell>
  );
}

// ── 读取卡（read）──

interface ReadMeta {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
}

function narrowRead(m: Record<string, unknown>): ReadMeta | null {
  const path = str(m.path);
  const startLine = num(m.startLine);
  const endLine = num(m.endLine);
  const totalLines = num(m.totalLines);
  if (path === null || startLine === null || endLine === null || totalLines === null) return null;
  return { path, startLine, endLine, totalLines };
}

/** 读取卡：output.content 的 `N\t` 行号格式即数据——tab 拆出行号 gutter；meta 分页事实
 * 切出内容行与尾注（不用正则猜）；窗口注「N–M / 共 T 行」（dsh read 窗口注行为层）。
 * 无 meta 的旧会话：尾注按「(」开头行识别（formatRead 三变体恒括号开头）。 */
export function ReadCard({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const filePath = input === null ? null : str(input.file_path);
  const output = row.output;
  if (output === undefined) {
    if (filePath === null) return <ToolView row={row} ctx={ctx} />;
    return (
      <ToolCardShell row={row} ctx={ctx}>
        <MonoBlock text={filePath} />
      </ToolCardShell>
    );
  }
  const meta = asMeta(row, "read");
  const n = meta === null ? null : narrowRead(meta);
  const lines = output.content.split("\n");
  let body: string[];
  let footer: string[];
  if (n !== null && n.totalLines > 0) {
    const count = n.endLine - n.startLine + 1;
    body = lines.slice(0, Math.max(0, count));
    footer = lines.slice(Math.max(0, count));
  } else {
    // 尾注 = 末尾连续「(」开头行（formatRead 恒括号开头）
    let cut = lines.length;
    while (cut > 0 && lines[cut - 1]?.startsWith("(")) cut -= 1;
    body = lines.slice(0, cut);
    footer = lines.slice(cut);
  }
  return (
    <ToolCardShell
      row={row}
      ctx={ctx}
      summaryExtra={
        n !== null && n.totalLines > 0 ? (
          <span style={{ color: "var(--henira-text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {`${n.startLine}–${n.endLine} / ${n.totalLines} ${ctx.t("tool.lines")}`}
          </span>
        ) : null
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--henira-space-2)" }}>
        <div
          className="henira-mono"
          style={{
            fontSize: "var(--henira-fs-sm)",
            color: "var(--henira-text-muted)",
            wordBreak: "break-all",
          }}
        >
          {n?.path ?? filePath ?? ""}
        </div>
        <div
          className="henira-mono"
          style={{
            fontSize: "var(--henira-fs-md)",
            maxHeight: 360,
            overflowY: "auto",
            lineHeight: 1.5,
          }}
        >
          {body.map((line, i) => {
            const tab = line.indexOf("\t");
            const no = tab >= 0 ? line.slice(0, tab) : "";
            const text = tab >= 0 ? line.slice(tab + 1) : line;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）——row-chrome DetailPane 先例
              <div key={i} style={{ display: "flex", whiteSpace: "pre-wrap" }}>
                <span style={{ ...gutterStyle("4ch"), userSelect: "none" }}>{no}</span>
                <span style={{ flex: 1, minWidth: 0, wordBreak: "break-all" }}>{text}</span>
              </div>
            );
          })}
        </div>
        {footer.map((f, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）——row-chrome DetailPane 先例
            key={`f${i}`}
            style={{ color: "var(--henira-text-muted)", fontSize: "var(--henira-fs-sm)" }}
          >
            {f}
          </div>
        ))}
      </div>
    </ToolCardShell>
  );
}

// ── 搜索卡（glob / grep）──

/** 文件列表渲染（glob 与 files 模式共用） */
function FileListView({ files }: { files: string[] }): React.ReactNode {
  return (
    <div
      className="henira-mono"
      style={{ fontSize: "var(--henira-fs-md)", maxHeight: 320, overflowY: "auto" }}
    >
      {files.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）——row-chrome DetailPane 先例
        <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {f}
        </div>
      ))}
    </div>
  );
}

/** 新建 glob 卡：meta 路径数组 + 总数截断注记；无 meta 回落通用卡（路径列表反拆
 * 靠截断注记文本不可靠） */
export function GlobCard({ row, ctx }: CardProps): React.ReactNode {
  const meta = row.output === undefined ? null : asMeta(row, "glob");
  if (meta === null) return <ToolView row={row} ctx={ctx} />;
  const files = strArray(meta.files);
  const total = num(meta.total);
  if (files === null || total === null) return <ToolView row={row} ctx={ctx} />;
  return (
    <ToolCardShell
      row={row}
      ctx={ctx}
      summaryExtra={
        <span style={{ color: "var(--henira-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {files.length < total
            ? `${files.length}/${total}`
            : `${files.length} ${ctx.t("tool.filesSuffix")}`}
        </span>
      }
    >
      <FileListView files={files} />
    </ToolCardShell>
  );
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
  match?: boolean;
}

function narrowMatches(v: unknown): GrepMatch[] | null {
  if (!Array.isArray(v)) return null;
  const out: GrepMatch[] = [];
  for (const item of v) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const m = item as Record<string, unknown>;
    const file = str(m.file);
    const line = num(m.line);
    const text = str(m.text);
    if (file === null || line === null || text === null) return null;
    out.push({ file, line, text, match: bool(m.match) });
  }
  return out;
}

/** grep 卡：content 模式按文件分组（组头路径+命中计数；上下文行弱色——dsh 无关键词
 * 高亮照抄）；files/count 模式列表。meta 缺 = 回落通用卡。 */
export function GrepCard({ row, ctx }: CardProps): React.ReactNode {
  const meta = row.output === undefined ? null : asMeta(row, "grep");
  if (meta === null) return <ToolView row={row} ctx={ctx} />;
  const mode = str(meta.mode);
  const matches = narrowMatches(meta.matches);
  const totalSeen = num(meta.totalSeen);
  if (mode === null || totalSeen === null) return <ToolView row={row} ctx={ctx} />;
  if (mode === "files_with_matches") {
    const files = strArray(meta.files);
    if (files === null) return <ToolView row={row} ctx={ctx} />;
    return (
      <ToolCardShell
        row={row}
        ctx={ctx}
        summaryExtra={
          <span style={{ color: "var(--henira-text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {files.length < totalSeen
              ? `${files.length}/${totalSeen}`
              : `${files.length} ${ctx.t("tool.filesSuffix")}`}
          </span>
        }
      >
        <FileListView files={files} />
      </ToolCardShell>
    );
  }
  if (mode === "count") {
    // counts [{file,count}]
    const rawCounts = meta.counts;
    if (!Array.isArray(rawCounts)) return <ToolView row={row} ctx={ctx} />;
    const counts: { file: string; count: number }[] = [];
    for (const item of rawCounts) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return <ToolView row={row} ctx={ctx} />;
      }
      const c = item as Record<string, unknown>;
      const file = str(c.file);
      const count = num(c.count);
      if (file === null || count === null) return <ToolView row={row} ctx={ctx} />;
      counts.push({ file, count });
    }
    const total = counts.reduce((s, c) => s + c.count, 0);
    return (
      <ToolCardShell
        row={row}
        ctx={ctx}
        summaryExtra={
          <span style={{ color: "var(--henira-text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {`${total} ${ctx.t("tool.matchesSuffix")}`}
          </span>
        }
      >
        <div
          className="henira-mono"
          style={{ fontSize: "var(--henira-fs-md)", maxHeight: 320, overflowY: "auto" }}
        >
          {counts.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）——row-chrome DetailPane 先例
            <div key={i}>
              {c.file}
              <span style={{ color: "var(--henira-text-muted)" }}>:{c.count}</span>
            </div>
          ))}
        </div>
      </ToolCardShell>
    );
  }
  if (matches === null) return <ToolView row={row} ctx={ctx} />;
  // content 模式：按文件分组（保持出现序）
  const groups: { file: string; rows: GrepMatch[] }[] = [];
  for (const m of matches) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.file === m.file) last.rows.push(m);
    else groups.push({ file: m.file, rows: [m] });
  }
  return (
    <ToolCardShell
      row={row}
      ctx={ctx}
      summaryExtra={
        <span style={{ color: "var(--henira-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {matches.length < totalSeen
            ? `${matches.length}/${totalSeen}`
            : `${totalSeen} ${ctx.t("tool.matchesSuffix")}`}
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--henira-space-2)" }}>
        {groups.map((g, gi) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）——row-chrome DetailPane 先例
          <Fragment key={gi}>
            <div
              className="henira-mono"
              style={{
                fontSize: "var(--henira-fs-sm)",
                color: "var(--henira-text-muted)",
                wordBreak: "break-all",
                borderTop: gi > 0 ? "1px solid var(--henira-border)" : undefined,
                paddingTop: gi > 0 ? "var(--henira-space-2)" : undefined,
              }}
            >
              {g.file}
              <span style={{ marginLeft: "6px" }}>
                {`${g.rows.filter((r) => r.match !== false).length} ${ctx.t("tool.matchesSuffix")}`}
              </span>
            </div>
            <div
              className="henira-mono"
              style={{ fontSize: "var(--henira-fs-md)", lineHeight: 1.5 }}
            >
              {g.rows.map((r, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: 行序列纯静态呈现（声明序即渲染序，无重排歧义）——row-chrome DetailPane 先例
                  key={i}
                  style={{
                    display: "flex",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: r.match === false ? "var(--henira-text-muted)" : undefined,
                  }}
                >
                  <span style={{ ...gutterStyle("4ch"), flexShrink: 0 }}>{r.line}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{r.text}</span>
                </div>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </ToolCardShell>
  );
}

// ── MCP 卡（mcp__ 前缀工具；tool.call.view.mcp 总缝的官方默认）──

/** MCP 卡：server/tool 拆名（meta 原始名优先——wire 名超长截断+短哈希后反拆不可靠；
 * 缺省从 wire 名机械反拆）。结果 JSON 判定格式化（ZCode mcp 卡行为层），错误红块。 */
export function McpCard({ row, ctx }: CardProps): React.ReactNode {
  let server: string | undefined;
  let tool: string | undefined;
  const meta = row.output === undefined ? null : asMeta(row, "mcp");
  if (meta !== null) {
    server = str(meta.server) ?? undefined;
    tool = str(meta.tool) ?? undefined;
  }
  if (server === undefined || tool === undefined) {
    const parts = row.name.split("__");
    if (parts.length >= 3 && parts[0] === "mcp") {
      server = parts[1];
      tool = parts.slice(2).join("__");
    }
  }
  if (server === undefined || tool === undefined) return <ToolView row={row} ctx={ctx} />;
  const input = parseInput(row);
  const output = row.output;
  return (
    <ToolCardShell
      row={row}
      ctx={ctx}
      title={tool}
      summaryExtra={
        <span className="henira-mono" style={{ color: "var(--henira-text-muted)", flexShrink: 0 }}>
          {server}
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--henira-space-2)" }}>
        <div
          className="henira-mono"
          style={{ fontSize: "var(--henira-fs-sm)", color: "var(--henira-text-muted)" }}
        >
          {row.name}
        </div>
        {input !== null ? (
          <MonoBlock
            text={JSON.stringify(input, null, 2)}
            color="var(--henira-text-muted)"
            maxHeight={160}
          />
        ) : null}
        {output !== undefined ? (
          <MonoBlock
            text={tryFormatJson(output.content) ?? output.content}
            color={output.isError ? "var(--henira-danger-text)" : undefined}
            maxHeight={320}
          />
        ) : null}
      </div>
    </ToolCardShell>
  );
}

// ── 通用卡（fallback；原 conversation.tsx 私有实现原样迁入）──

/** 通用卡：图标+名+callId+耗时/截断徽章+展开 IN/OUT 两段 pre。keyed 缝查不到官方卡、
 * per-tool 卡 meta 校验不过、第三方工具——三路兜底都是它。 */
export function ToolView({ row, ctx }: CardProps): React.ReactNode {
  const isError = row.status === "error";
  const statusColor =
    row.status === "running"
      ? "var(--henira-info-text)"
      : isError
        ? "var(--henira-danger-text)"
        : "var(--henira-ok-text)";
  const running = row.status === "running";
  // 错误揭示（dsh/ZCode autoOpen 行为参照）：mount 时已 error 或执行中转 error 都要展开可见
  const [revealed, setRevealed] = useState(isError);
  useEffect(() => {
    if (isError) setRevealed(true);
  }, [isError]);
  // 官方默认工具卡 = 组装行 chrome 原语（与 keyed 顶替件同一套，D-057 观感协调）
  return (
    <DisclosureRow
      icon={
        running ? (
          <SpinnerGlyph size={14} color={statusColor} />
        ) : isError ? (
          <XGlyph size={14} color={statusColor} />
        ) : (
          <CheckGlyph size={14} color={statusColor} />
        )
      }
      title={row.name}
      busy={running}
      tone={statusColor}
      meta={`#${row.callId}`}
      summary={
        <>
          {row.status === "done" && row.output !== undefined ? (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.output.durationMs}ms</span>
          ) : null}
          {row.output?.truncated !== undefined ? (
            <Pill
              bg="var(--henira-warn-bg)"
              color="var(--henira-warn-text)"
              title={row.output.truncated.path}
            >
              {ctx.t("row.truncated")}
            </Pill>
          ) : null}
        </>
      }
      open={revealed ? true : undefined}
    >
      <DetailPane
        sections={[
          {
            label: ctx.t("tool.input"),
            body: (
              <pre
                className="henira-mono"
                style={{
                  margin: 0,
                  color: "var(--henira-text-muted)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontSize: "var(--henira-fs-md)",
                }}
              >
                {row.input}
              </pre>
            ),
          },
          ...(row.output !== undefined
            ? [
                {
                  label: isError ? ctx.t("error.title") : ctx.t("row.output"),
                  tone: isError ? "var(--henira-danger-text)" : undefined,
                  actions: <CopyButton text={row.output.content} t={ctx.t} />,
                  maxHeight: 180,
                  body: (
                    <pre
                      className="henira-mono"
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        fontSize: "var(--henira-fs-md)",
                      }}
                    >
                      {row.output.content}
                    </pre>
                  ),
                },
              ]
            : []),
        ]}
      />
    </DisclosureRow>
  );
}
