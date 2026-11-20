// shell 可执行文件探测（D-065 决定 5）：bash 走 PATH；powershell 探 pwsh 7 → powershell 5.1。
// 探测结果按名字进程级缓存（命中与否都缓存；单次探测代价本就低，不做失效）。

import { existsSync } from "node:fs";
import path from "node:path";
import { ShellError } from "./exec.js";

const cache = new Map<string, string | null>();

function findOnPath(name: string): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter((d) => d !== "");
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext.toLowerCase()}`);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        /* 不可访问：跳过 */
      }
    }
  }
  return null;
}

function resolveOne(name: string): string | null {
  if (!cache.has(name)) cache.set(name, findOnPath(name));
  return cache.get(name) ?? null;
}

/** bash 可执行文件；找不到给可行动报错（Windows 提示装 Git for Windows） */
export function resolveBash(): string {
  const found = resolveOne("bash");
  if (found === null) {
    throw new ShellError(
      process.platform === "win32"
        ? "bash was not found on PATH; install Git for Windows (provides bash.exe) or use the powershell tool"
        : "bash was not found on PATH",
    );
  }
  return found;
}

/** powershell 可执行文件：pwsh 7+ 优先，回落 Windows PowerShell 5.1 */
export function resolvePowershell(): string {
  for (const name of ["pwsh", "powershell"]) {
    const found = resolveOne(name);
    if (found !== null) return found;
  }
  throw new ShellError(
    "neither pwsh nor powershell was found on PATH; install PowerShell or use the bash tool",
  );
}

/** powershell 的 UTF-8 输出包装（5.1 默认控制台代码页会产出乱码） */
export const POWERSHELL_UTF8_PREFIX = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ";
