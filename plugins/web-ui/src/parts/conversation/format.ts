// 对话文本工具（R177 拆分）：推理摘要 / 时间戳 / fork 可点判定。
import type { Row } from "@henira/protocol";

/** 推理流式摘要：取最近一个非空行的首段（流式中随最新思路推进——参照实现 行为层参照） */
function reasoningPreview(reasoning: string): string {
  const lines = reasoning.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 ? (lines[lines.length - 1] ?? "").trim() : "";
}

/** 工作时长：中文单位、最多两段（天/时/分/秒），如「3 分 44 秒」。 */
function formatWorkDuration(ms: number | undefined, t: (k: string) => string): string | null {
  if (ms === undefined) return null;
  const total = Math.max(1, Math.round(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${t("turn.unitDay")}`);
  if (hours > 0) parts.push(`${hours} ${t("turn.unitHour")}`);
  if (minutes > 0) parts.push(`${minutes} ${t("tool.unitMin")}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} ${t("tool.unitSec")}`);
  return parts.slice(0, 2).join(" ");
}

/** 轮尾/用户行时间戳格式（dsh message-chrome 同档）：同日 HH:mm、同年 M/D HH:mm、跨年全日期 */
function formatTurnClock(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hm;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}/${md} ${hm}`;
}

/** 空会话问候档（ZCode 草稿空态行为层：按小时换问候，不做随机文案） */
function greetingKey(hour: number): "morning" | "afternoon" | "evening" | "lateNight" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "lateNight";
}

/** fork 可点判定（dsh turn-tail.ts:98 同款语义）：本回合最后一条实质内容是已落定的文本
 *  回复——透明步级行跳过；文本后跟工具/错误/审批/插话的轮「不干净」，置灰 + 原因提示 */
function turnEndsWithText(rows: readonly Row[]): boolean {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined) continue;
    if (row.kind === "assistant" && row.text === "" && row.streaming !== true) continue;
    if (row.kind === "assistant") return row.text.trim() !== "" && row.streaming !== true;
    return false;
  }
  return false;
}

export { formatTurnClock, formatWorkDuration, greetingKey, reasoningPreview, turnEndsWithText };
