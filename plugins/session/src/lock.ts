// 单写者锁（session.md §5：同一会话同时只有一个进程可写）。
// 仲裁权交给**内核命名对象**（2026-11-27 修订）：持有 = 一个活着的倾听句柄——进程一死内核立即
// 回收，下一个进程立即可接管。没有 pid 探活、没有过期接管（[dsh] lease.ts 同语义：过期没收一个
// 卡住的活写者，它恢复后的续写会撕日志）。[dsh] 用原生 flock / Windows 命名信号量实现；本仓用
// node:net 内置等价物，零原生依赖：
//   - win32：命名管道 \\.\pipe\henira-lock-<sha1(会话目录)>——重名 listen 报 EADDRINUSE
//     （2026-11-27 实测），进程死管道名即释放，无残留。
//   - 其他：<tmp>/henira-locks/<sha1>.sock（哈希短路径，sun_path 108 字节装不下真实会话路径）
//     ——绑定占名；EEXIST 时 connect 探测：连上 = 活持有者；ECONNREFUSED / ENOENT = 已死 →
//     清残留后重绑。并发抢锁靠有限重试收敛出一个赢家，输家保守拒绝。
// 会话目录里的 session.lock 只作**诊断信息**（pid / 时刻 / 端点，供人看「谁挂着」），不参与判决
// ——旧实现拿它探活，Windows pid 复用让死锁看起来活着，曾把全部会话误判 409。

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const SESSION_LOCK_FILE = "session.lock";

export class SessionLockedError extends Error {
  constructor(dir: string) {
    super(`session is locked by another live process: ${dir}`);
    this.name = "SessionLockedError";
  }
}

export interface SessionLock {
  release(): Promise<void>;
}

const LOCK_DIR = path.join(os.tmpdir(), "henira-session-locks");
/** 并发抢锁的有限重试（POSIX 死残留清理后重绑；不是概率夺权，输家保守拒绝） */
const MAX_ATTEMPTS = 5;

/** 内核命名对象的端点：同一会话目录全机唯一；win32 大小写不敏感（哈希前折平） */
export function lockEndpoint(dir: string): string {
  const key = path.resolve(dir);
  const hash = createHash("sha1")
    .update(process.platform === "win32" ? key.toLowerCase() : key)
    .digest("hex")
    .slice(0, 24);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\henira-lock-${hash}`
    : path.join(LOCK_DIR, `${hash}.sock`);
}

/** 绑定端点（内核占名）；失败原样抛给调用方判 EADDRINUSE */
function listenOnce(endpoint: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.removeListener("error", reject);
      server.on("error", () => {}); // 拿到锁后的异步错误不再致命（判定已完成）
      server.unref(); // 倾听句柄不阻塞进程退出（退出 = 内核回收 = 释放）
      resolve(server);
    });
  });
}

/** connect 探测持有者死活：连上 = 活；ECONNREFUSED / ENOENT = 已死；其他错误 / 超时 = 保守当活 */
async function probeHolder(endpoint: string): Promise<"alive" | "dead"> {
  return new Promise((resolve) => {
    const socket = net.connect(endpoint);
    const settle = (verdict: "alive" | "dead"): void => {
      socket.destroy();
      resolve(verdict);
    };
    socket.once("connect", () => settle("alive"));
    socket.once("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      settle(code === "ECONNREFUSED" || code === "ENOENT" ? "dead" : "alive");
    });
    socket.setTimeout(1000, () => settle("alive"));
    socket.unref();
  });
}

export async function acquireSessionLock(dir: string): Promise<SessionLock> {
  const endpoint = lockEndpoint(dir);
  const win32 = process.platform === "win32";
  if (!win32) await fs.mkdir(LOCK_DIR, { recursive: true });
  let server: net.Server | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && server === null; attempt++) {
    try {
      server = await listenOnce(endpoint);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      // win32 管道名没有残留态：重名只可能是活持有者
      if (win32) throw new SessionLockedError(dir);
      if ((await probeHolder(endpoint)) === "alive") throw new SessionLockedError(dir);
      // 死者留下的 socket 文件：清掉重绑
      await fs.rm(endpoint, { force: true }).catch(() => {});
    }
  }
  if (server === null) throw new SessionLockedError(dir); // 并发抢锁连败：保守拒绝
  const holder = server;
  const lockFile = path.join(dir, SESSION_LOCK_FILE);
  // 诊断文件（不参与判决）：失败不碍事
  await fs
    .writeFile(lockFile, JSON.stringify({ pid: process.pid, acquiredAt: Date.now(), endpoint }))
    .catch(() => {});
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await new Promise<void>((resolve) => holder.close(() => resolve()));
      if (!win32) await fs.rm(endpoint, { force: true }).catch(() => {});
      await fs.rm(lockFile, { force: true }).catch(() => {});
    },
  };
}
