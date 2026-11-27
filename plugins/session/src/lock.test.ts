// 单写者锁（session.md §5）：内核命名对象仲裁——活持有者拒绝、硬死立即可接管、无 pid 探活、
// 无过期窗口。跨进程用例用裸 node 子进程绑定同一端点（管道名 / unix socket 路径）实测：
// win32 = 命名管道名随进程死回收；POSIX = 残留 socket 文件靠 connect 探测判死。

import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireSessionLock,
  lockEndpoint,
  SESSION_LOCK_FILE,
  type SessionLock,
  SessionLockedError,
} from "./lock.js";

/** 裸 node 子进程：绑定给定端点；mode=exit 时 ready 后立即硬退（不走 release） */
const HOLDER_SCRIPT = `
const net = require("node:net");
const endpoint = process.argv[1];
const mode = process.argv[2];
const server = net.createServer((socket) => socket.destroy());
server.listen(endpoint, () => {
  process.stdout.write("ready\\n");
  if (mode === "exit") process.exit(0);
});
`;

function spawnHolder(endpoint: string, mode: "hold" | "exit"): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", HOLDER_SCRIPT, endpoint, mode], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let settled = false;
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
      if (!settled && out.includes("ready")) {
        settled = true;
        resolve(child);
      }
    });
    child.once("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.once("exit", () => {
      if (!settled) {
        settled = true;
        reject(new Error("holder exited before ready"));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("holder did not become ready"));
      }
    }, 5000);
  });
}

describe("SessionLock（内核命名对象仲裁，2026-11-27）", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), "henira-lock-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("持有写诊断文件（不参与判决）；释放后可立即重取", async () => {
    const lock = await acquireSessionLock(dir);
    const raw = JSON.parse(await fs.readFile(path.join(dir, SESSION_LOCK_FILE), "utf8")) as {
      pid: number;
      endpoint: string;
    };
    expect(raw.pid).toBe(process.pid);
    expect(raw.endpoint).toBe(lockEndpoint(dir));
    await lock.release();
    await expect(fs.readFile(path.join(dir, SESSION_LOCK_FILE))).rejects.toThrow();
    const again = await acquireSessionLock(dir);
    await again.release();
  });

  it("同进程二取 → SessionLockedError（旧语义保持）", async () => {
    const first = await acquireSessionLock(dir);
    await expect(acquireSessionLock(dir)).rejects.toBeInstanceOf(SessionLockedError);
    await first.release();
  });

  it("并发抢锁：恰一个赢家，输家保守拒绝", async () => {
    const results = await Promise.allSettled([acquireSessionLock(dir), acquireSessionLock(dir)]);
    const winners = results.filter(
      (result): result is PromiseFulfilledResult<SessionLock> => result.status === "fulfilled",
    );
    const losers = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].reason).toBeInstanceOf(SessionLockedError);
    await winners[0].value.release();
  });

  it("跨进程活持有者 → SessionLockedError；杀掉后才让位", async () => {
    const endpoint = lockEndpoint(dir);
    const child = await spawnHolder(endpoint, "hold");
    try {
      await expect(acquireSessionLock(dir)).rejects.toBeInstanceOf(SessionLockedError);
    } finally {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await exited;
    }
  });

  it("持有者硬死（不走 release）→ 立即接管（win32 名字回收 / POSIX 残留探测）", async () => {
    const endpoint = lockEndpoint(dir);
    const child = await spawnHolder(endpoint, "exit");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const lock = await acquireSessionLock(dir);
    await lock.release();
  });
});
