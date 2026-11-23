// per-tool 审批预览体（E6）：ApprovalRow.args 完整原样窄化后结构化呈现——CC 权限对话框
// 每工具一个组件 / ZCode 权限弹窗复用聊天 renderer 的行为层（dsh 零参数反例已被 D-046 否决）。
// 数据源唯一 = row.args（approval/asked 完整原样，D-046「挂起自足可渲染」——断线重连/多窗口
// 重放同一张卡）。校验纪律沿用 E5 meta 窄化「宁缺毋滥」：字段形状不过一律回落通用 JSON 预览，
// 绝不渲染坏预览。edit/write 复用 E5 diff 机器（CC FileEditToolDiff 同组件复用行为层）。

import type { ApprovalRow } from "@henira/protocol";
import type { ReactNode } from "react";
import type { WebPartContext } from "../types.js";
import {
  bool,
  buildDiffRows,
  DIFF_FALLBACK_MAX_LINES,
  DiffRowsView,
  DiffTotals,
  formatToolName,
  str,
  tryFormatJson,
} from "./tool-cards.js";
import { toolGlyph } from "./tool-icons.js";

export interface ApprovalPreviewProps {
  row: ApprovalRow;
  ctx: WebPartContext;
}

/** args 形状窄化：非 null 对象 → Record；其余（标量/数组/null）= null 走通用回落 */
function argsObject(row: ApprovalRow): Record<string, unknown> | null {
  const v = row.args;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** 路径/模式单行（mono 弱色——CC FilesystemPermissionRequest 行为层：审批卡只露关键键） */
function PathLine({ text }: { text: string }): ReactNode {
  return (
    <div
      className="henira-mono"
      style={{
        fontSize: "var(--henira-fs-sm)",
        color: "var(--henira-text-muted)",
        wordBreak: "break-all",
      }}
    >
      {text}
    </div>
  );
}

/** 通用 JSON 预览（fallback；args 原样格式化——ZCode TUI JSON 预览行为层，maxHeight 滚动） */
function JsonPreview({ args }: { args: unknown }): ReactNode {
  const raw = JSON.stringify(args ?? null);
  const text = tryFormatJson(raw) ?? raw;
  return (
    <pre
      className="henira-mono"
      style={{
        margin: 0,
        fontSize: "var(--henira-fs-sm)",
        color: "var(--henira-text-muted)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        maxHeight: 200,
        overflowY: "auto",
      }}
    >
      {text}
    </pre>
  );
}

/** edit 审批预览：old/new diff（E5 buildDiffRows 复用；缺字段/两串相同 → null 回落通用）。
 * replace_all=true → 注记行（审查 F7：diff 只显单份，批准的实际效应是全量替换——裁决入口
 * 必须诚实；与 E5 工具卡「单份 diff+计数徽章」同族裁决） */
function EditPreview({
  args,
  ctx,
}: {
  args: Record<string, unknown>;
  ctx: WebPartContext;
}): ReactNode | null {
  const filePath = str(args.file_path);
  const oldText = str(args.old_string);
  const newText = str(args.new_string);
  if (filePath === null || oldText === null || newText === null) return null;
  const diff = buildDiffRows(oldText, newText);
  if (diff === null) return null;
  const notes: string[] = [];
  if (diff.truncated === true) notes.push(ctx.t("tool.diffTruncated"));
  if (bool(args.replace_all) === true) notes.push(ctx.t("approval.replaceAllNote"));
  return (
    <>
      <div className="henira-approval-file-row">
        <PathLine text={filePath} />
        <DiffTotals added={diff.added} removed={diff.removed} />
      </div>
      <DiffRowsView
        rows={
          notes.length > 0 ? [...diff.rows, { kind: "note", text: notes.join(" / ") }] : diff.rows
        }
      />
    </>
  );
}

/** write 审批预览：全文 add 预览（WriteCard created 同形；千行闸同款截断） */
function WritePreview({
  args,
  ctx,
}: {
  args: Record<string, unknown>;
  ctx: WebPartContext;
}): ReactNode | null {
  const filePath = str(args.file_path);
  const content = str(args.content);
  if (filePath === null || content === null) return null;
  const lines = content.split("\n");
  return (
    <>
      <div className="henira-approval-file-row">
        <PathLine text={filePath} />
        <DiffTotals added={lines.length} removed={0} />
      </div>
      <DiffRowsView
        rows={[
          ...lines
            .slice(0, DIFF_FALLBACK_MAX_LINES)
            .map((text, i) => ({ kind: "add" as const, newLine: i + 1, text })),
          ...(lines.length > DIFF_FALLBACK_MAX_LINES
            ? [{ kind: "note" as const, text: ctx.t("tool.diffTruncated") }]
            : []),
        ]}
      />
    </>
  );
}

/** bash/powershell 审批预览：全命令行（CC BashPermissionRequest always show full command） */
function ShellPreview({ args }: { args: Record<string, unknown> }): ReactNode | null {
  const command = str(args.command);
  if (command === null || command === "") return null;
  return (
    <div
      className="henira-mono"
      style={{ fontSize: "var(--henira-fs-md)", wordBreak: "break-all" }}
    >
      <span style={{ color: "var(--henira-text-muted)" }}>$ </span>
      {command}
    </div>
  );
}

/** read/glob/grep 审批预览：路径/模式摘要行（键存在才露——无 command 类单行富化） */
function SearchPreview({ args }: { args: Record<string, unknown> }): ReactNode | null {
  const lines = [str(args.file_path), str(args.pattern), str(args.path)].filter((s) => s !== null);
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((text, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静态摘要行（声明序即渲染序）——DetailPane 先例
        <PathLine key={i} text={text} />
      ))}
    </>
  );
}

/** 工具身份词（审批块头：终端/读取/编辑/MCP…；未知 wire 名 Title Case）。 */
function toolKindLabel(name: string, ctx: WebPartContext): string {
  if (name === "bash" || name === "powershell") return ctx.t("tool.title.bash");
  if (name === "read") return ctx.t("tool.title.read");
  if (name === "write") return ctx.t("tool.title.write");
  if (name === "edit") return ctx.t("tool.title.edit");
  if (name === "glob") return ctx.t("tool.title.glob");
  if (name === "grep") return ctx.t("tool.title.grep");
  if (name === "mcp" || name.startsWith("mcp__")) return ctx.t("tool.kind.mcp");
  return formatToolName(name);
}

/** per-tool 预览路由（审批卡内容区；E6）。工具族判定按 wire 名——校验不过一律回落通用
 *  JSON 预览，绝不渲染坏预览。MCP 走 JSON 预览（args 全量摊开）。
 *  外框 = 审批块（图标 + 等待审批 + 工具身份 + 内容卡）：与工具行同一套 chrome，
 *  细节（diff/命令/JSON）收进内容卡里，不再裸排在卡面。 */
export function ApprovalPreview({ row, ctx }: ApprovalPreviewProps): ReactNode {
  const args = argsObject(row);
  let body: ReactNode | null = null;
  if (args !== null) {
    switch (row.toolName) {
      case "edit":
        body = EditPreview({ args, ctx });
        break;
      case "write":
        body = WritePreview({ args, ctx });
        break;
      case "bash":
      case "powershell":
        body = ShellPreview({ args });
        break;
      case "read":
      case "glob":
      case "grep":
        body = SearchPreview({ args });
        break;
      default:
        body = null; // 未知工具（含 mcp__*）→ 通用 JSON 预览
    }
  }
  return (
    <div className="henira-approval-block">
      <div className="henira-approval-block-head">
        <span className="henira-row-icon">{toolGlyph(row.toolName)}</span>
        <span className="henira-approval-block-kind">{ctx.t("approval.previewKind")}</span>
        <span className="henira-approval-block-tool">{toolKindLabel(row.toolName, ctx)}</span>
      </div>
      <div className="henira-approval-block-body">
        {body ?? <JsonPreview args={args ?? row.args} />}
      </div>
    </div>
  );
}
