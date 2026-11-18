// ui-state.json 的宿主侧读写（D-063 会话绑定界面状态持久化）：全局 state/ui.json（上次选中）
// 与每会话 <sessionDir>/ui-state.json（草稿 / 折叠组 / 面板宽度 / 右栏 tab 引用）。状态不进
// 事件账本（P9-1 同 queue.json 先例）；整份 tmp+rename 原子重写（atomicWriteFile 复用
// plugin-session 既有出口——queue.ts:1 "第三用即提取"约定的兑现）；删会话随整树走。
// 服务端只验证不解释（D-063）：PUT 收整个 JSON 对象 + 64KB 上限，无深度 schema——形状归
// web 宿主，随宿主加法生长；读缺失/损坏按缺省走（状态不是事实源，settings-store 同纪律）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "@henira/plugin-session";
import type { GlobalUiState, SessionUiState } from "@henira/protocol";

/** 单文档字节上限（JSON 序列化后计）——界面态不是附件仓，大件归 attachments/ */
export const UI_STATE_MAX_BYTES = 64 * 1024;

const GLOBAL_FILE = path.join("state", "ui.json");
const SESSION_FILE = "ui-state.json";

export async function readGlobalUiState(dataDir: string): Promise<GlobalUiState> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(dataDir, GLOBAL_FILE), "utf8"),
    ) as GlobalUiState;
    // 只取认得的字段，损坏值归缺省
    return {
      lastSessionId: typeof parsed.lastSessionId === "string" ? parsed.lastSessionId : null,
    };
  } catch {
    return { lastSessionId: null };
  }
}

export async function writeGlobalUiState(dataDir: string, doc: GlobalUiState): Promise<void> {
  const file = path.join(dataDir, GLOBAL_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(doc, null, 2)}\n`);
}

export async function readSessionUiState(sessionDir: string): Promise<SessionUiState> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(path.join(sessionDir, SESSION_FILE), "utf8"),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SessionUiState;
  } catch {
    return {};
  }
}

export async function writeSessionUiState(sessionDir: string, doc: SessionUiState): Promise<void> {
  await fs.mkdir(sessionDir, { recursive: true });
  await atomicWriteFile(path.join(sessionDir, SESSION_FILE), `${JSON.stringify(doc, null, 2)}\n`);
}

/** PUT 校验（只验证不解释）：必须 JSON 对象 + 不超上限；返回拒绝理由供 400 体 */
export function validateSessionUiState(doc: unknown): { ok: true } | { ok: false; reason: string } {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, reason: "ui state must be a JSON object" };
  }
  const size = Buffer.byteLength(JSON.stringify(doc), "utf8");
  if (size > UI_STATE_MAX_BYTES) {
    return { ok: false, reason: "ui state exceeds 64KB limit" };
  }
  return { ok: true };
}
