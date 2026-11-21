// 账本修理（R175 重启收口批）：
// 孤儿挂起收口的启动扫描薄封装——开档触发修理（seq 重排 + approval/invalidated +
// turn/end{interrupted} 都在 store.ts 的 create/openExisting 内）后立即关档释放锁，
// 不做完整装配（不启动 loop、不载队列、不进在订表）。
// 调用时序：registry.repairLedgers 监听前逐目录跑，单会话失败不挡其余、不挡 serve 上线；
// attach 懒挂载走同一个 SessionStore.create，修理语义天然同款。
// seq 重排的动机与不删行原则见 store.ts repairLedgerFile。

import { promises as fs } from "node:fs";
import path from "node:path";
import { SESSION_LOG_FILE, SessionStore } from "./store.js";

export interface LedgerRepairResult {
  /** 文件发生过 seq 重排（写者竞态历史伤修复） */
  resequenced: boolean;
  /** 开档补写了 turn/end{interrupted}（既有崩溃恢复语义，R175 起补写 time 定格） */
  synthesizedInterrupted: boolean;
  /** 开档补写了 approval/invalidated 的孤儿审批数 */
  invalidatedApprovals: number;
}

/** 启动扫描薄封装：开档（内含 seq 重排 + 孤儿收口）后立即关档。头缺失/损坏抛错（调用方逐目录容错）。 */
export async function repairSessionLedger(sessionDir: string): Promise<LedgerRepairResult> {
  const filePath = path.join(sessionDir, SESSION_LOG_FILE);
  let header: { id?: string; cwd?: string };
  try {
    header = JSON.parse((await fs.readFile(filePath, "utf8")).split("\n")[0]) as {
      id?: string;
      cwd?: string;
    };
  } catch {
    throw new Error(`ledger header unreadable: ${sessionDir}`);
  }
  if (header.id === undefined || header.cwd === undefined) {
    throw new Error(`ledger header incomplete: ${sessionDir}`);
  }
  const { store, synthesizedInterrupted, resequenced, invalidatedApprovals } =
    await SessionStore.create({
      dir: sessionDir,
      id: header.id,
      cwd: header.cwd,
    });
  await store.close();
  return { resequenced, synthesizedInterrupted, invalidatedApprovals };
}
