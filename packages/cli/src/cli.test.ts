// cli 点火车（真进程 spawn）：serve 全链——握手文件出现 → HTTP 可达 → SIGTERM 收尾握手删除。
// run（headless）真模型依赖 credentials，不进 CI——设施见 README 命令说明。

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = await fs.mkdtemp(path.join(tmpdir(), "henira-cli-test-"));
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

function cliBin(): string {
  // dist 产物（build 后存在；vitest 直跑 dist——cli 是薄壳，无源码级测试必要）
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
}

describe("serve 点火车", () => {
  it("spawn 真进程 → 握手文件出现 → /api/server/info 200 → SIGTERM 收尾握手删除", async () => {
    const dataDir = path.join(root, `serve-${Math.random().toString(36).slice(2, 8)}`);
    const child = spawn(process.execPath, [cliBin(), "serve"], {
      cwd: process.cwd(),
      env: { ...process.env, HENIRA_HOME: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    cleanups.push(async () => {
      if (!child.killed) child.kill("SIGTERM");
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    });

    // 盯 stdout 拿 URL（serve 打印 listening 行）
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("serve did not print URL in 10s")), 10_000);
      child.stdout?.on("data", (chunk: Buffer) => {
        const match = /listening on (http:\/\/\S+)/.exec(chunk.toString());
        if (match !== null) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("serve exited before printing URL"));
      });
    });

    // 握手文件出现（HENIRA_HOME 覆盖数据目录——data-directory §9）
    const handshake = path.join(dataDir, "state", "server.json");
    const written = JSON.parse(await fs.readFile(handshake, "utf8")) as { port: number };
    expect(written.port).toBe(Number(new URL(url).port));

    // HTTP 可达
    const info = await fetch(`${url}/api/server/info`);
    expect(info.status).toBe(200);

    // 收尾：POSIX 走 SIGTERM 优雅路径（握手删除）；Windows 外部信号直接终止进程，
    // 握手残留属预期（优雅生命周期已由 packages/server 的进程内测试锁定）
    const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
    child.kill("SIGTERM");
    await exited;
    if (process.platform !== "win32") {
      await expect(fs.access(handshake)).rejects.toThrow();
    }
  }, 30_000);
});
