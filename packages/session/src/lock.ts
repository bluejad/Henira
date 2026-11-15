// 单写者锁（session.md §5：同一会话同时只有一个进程可写）。
// dsh 用原生 addon 的 flock（[dsh] packages/session/session-persistence-jsonl/src/lease.ts）；
// 我们用跨平台轻量等价：O_EXCL 独占创建 + PID 存活检测 + 陈旧接管。

import { promises as fs } from "node:fs";
import path from "node:path";

const LOCK_FILE = "session.lock";

export class SessionLockedError extends Error {
  constructor(dir: string) {
    super(`session is locked by another live process: ${path.join(dir, LOCK_FILE)}`);
    this.name = "SessionLockedError";
  }
}

export interface SessionLock {
  release(): Promise<void>;
}

/** 进程是否存活（pid 0 信号探测；ESRCH = 已死） */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(lockPath, "utf8");
  } catch {
    return true; // 锁文件已消失 → 视为可接管
  }
  try {
    const { pid } = JSON.parse(raw) as { pid?: number };
    if (typeof pid !== "number") return true; // 损坏的 pid 视为陈旧
    if (pid === process.pid) return false; // 自己的陈旧残留不可静默接管（同进程双开走报错）
    return !isProcessAlive(pid);
  } catch {
    return true; // 锁内容损坏 → 陈旧，可接管
  }
}

export async function acquireSessionLock(dir: string): Promise<SessionLock> {
  const lockPath = path.join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, "wx"); // O_EXCL：独占创建
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
      await handle.close();
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          await fs.rm(lockPath, { force: true });
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (!(await isStale(lockPath))) throw new SessionLockedError(dir);
      await fs.rm(lockPath, { force: true }); // 陈旧接管后重试
    }
  }
  throw new SessionLockedError(dir);
}
