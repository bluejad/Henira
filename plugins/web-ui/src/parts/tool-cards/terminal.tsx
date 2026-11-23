// 终端卡（R178）：类别词「已执行/正在执行」+ 命令；展开卡 = 命令（3lh，可展开）+ 输出（5lh）。
// 不显示单次耗时/退出码胶囊；失败用行尾状态词表达，详情仍在结果里。
import { useLayoutEffect, useRef, useState } from "react";
import { ToolRow } from "../row-chrome.js";
import { toolGlyph } from "../tool-icons.js";
import { ToolView } from "./fallback.js";
import { asMeta, bool, type CardProps, num, parseInput, str, toolFailure } from "./shell.js";

interface ShellMeta {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  signal?: string;
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
  };
}

/** 命令区：默认 3lh 截断，溢出时给「展开命令」入口（完整命令展开后 10lh 滚动）。 */
function CommandBlock({ command, t }: { command: string; t: CardProps["ctx"]["t"] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: command 变化要重测溢出（换行数/高度随命令变）
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || expanded) return;
    const measure = (): void => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [command, expanded]);
  return (
    <div className="henira-command">
      <div
        ref={ref}
        className={`henira-command-body${expanded ? " is-expanded" : ""}`}
        tabIndex={expanded ? 0 : undefined}
      >
        <span className="henira-command-prompt">$</span>
        <pre>{command}</pre>
      </div>
      {overflowing || expanded ? (
        <button
          type="button"
          className="henira-command-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t("tool.commandCollapse") : t("tool.commandExpand")}
        </button>
      ) : null}
    </div>
  );
}

export function TerminalCard({ row, ctx }: CardProps): React.ReactNode {
  const input = parseInput(row);
  const command = input === null ? null : str(input.command);
  const meta = row.output === undefined ? null : asMeta(row, "shell");
  const m = meta === null ? null : narrowShell(meta);
  if (command === null && m === null && row.output === undefined) {
    return <ToolView row={row} ctx={ctx} />;
  }
  const running = row.status === "running";
  const failed =
    row.status === "error" || (m !== null && (m.exitCode === null || m.exitCode !== 0));
  const status = failed ? ctx.t("row.status.error") : toolFailure(row, ctx.t);
  const statusTitle =
    m === null
      ? row.output?.isError === true
        ? row.output.content.split("\n")[0]
        : undefined
      : m.timedOut === true
        ? ctx.t("tool.timedOut")
        : m.signal !== undefined
          ? `${ctx.t("tool.killed")} ${m.signal}`
          : m.stderr.trim() !== ""
            ? m.stderr.trim().split("\n")[0]
            : m.exitCode !== null && m.exitCode !== 0
              ? `${ctx.t("tool.exitCode")} ${m.exitCode}`
              : undefined;
  const output = m !== null ? [m.stdout, m.stderr].filter((s) => s !== "").join("\n") : null;
  return (
    <ToolRow
      icon={toolGlyph(row.name)}
      kindLabel={ctx.t(running ? "tool.kind.running" : "tool.kind.ran")}
      secondary={command ?? undefined}
      busy={running}
      canToggle
      persistKey={`${ctx.sessionId ?? "none"}:${row.callId}`}
      rowTitle={`${row.name} (${row.callId})`}
      status={status}
      statusTitle={statusTitle}
    >
      <div className="henira-tool-card">
        {command !== null ? <CommandBlock command={command} t={ctx.t} /> : null}
        {m !== null ? (
          output !== "" ? (
            <pre className="henira-tool-pre is-output">{output}</pre>
          ) : !running ? (
            <p className="henira-tool-empty">{ctx.t("tool.noOutput")}</p>
          ) : null
        ) : row.output !== undefined && row.output.content !== "" ? (
          <pre className="henira-tool-pre is-output">{row.output.content}</pre>
        ) : !running ? (
          <p className="henira-tool-empty">{ctx.t("tool.noOutput")}</p>
        ) : null}
      </div>
    </ToolRow>
  );
}
