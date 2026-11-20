// 词法围栏（interfaces.md §fs，D-065）：相对路径按会话 cwd 解析、区内/区外判定、
// `~` 展开到 home。词法围栏是给模型的护栏不是对抗恶意进程的沙箱（审批链才是闸；
// symlink 真实归属检查挂账）。

import os from "node:os";
import path from "node:path";
import type { ApprovalOptions, Decision, PermissionRequest } from "@henira/protocol";

/** fs 能力的统一错误：code 稳定（工具层可翻译），message 面向模型、恒英文（D-050） */
export class FsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FsError";
  }
}

/** `~` / `~/` / `~\` 展开到用户 home（opencode / Claude Code 同款；dsh 不展开） */
export function expandHome(p: string): string {
  const home = os.homedir();
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

export type RequestPermissionFn = (
  req: PermissionRequest,
  opts?: ApprovalOptions,
) => Promise<Decision>;

export interface AccessArgs {
  absolute: string;
  inside: boolean;
  tool: string;
  callArgs: unknown;
  signal?: AbortSignal;
  requestPermission: RequestPermissionFn;
}

export interface Fence {
  /** 解析：相对 → 相对会话 cwd；绝对原样（normalize）；空串/非串 → 抛错 */
  resolve(p: string): { absolute: string; inside: boolean };
  /** 区外访问的统一放行口：经判定链问（floor:"ask"），未放行 → 抛 FsError */
  ensureAccess(args: AccessArgs): Promise<void>;
}

export function createFence(cwd: string): Fence {
  const root = path.resolve(cwd);

  const fence: Fence = {
    resolve(p: string) {
      if (typeof p !== "string" || p.trim() === "") {
        throw new FsError("invalid_path", "path must be a non-empty string");
      }
      const absolute = path.resolve(root, expandHome(p));
      // path.win32.relative 本身大小写不敏感（Node 语义）；rel 为空 = 根本身
      const rel = path.relative(root, absolute);
      const inside = rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel));
      return { absolute, inside };
    },
    async ensureAccess({
      absolute,
      inside,
      tool,
      callArgs,
      signal,
      requestPermission,
    }: AccessArgs) {
      if (inside) return;
      const decision = await requestPermission(
        {
          tool,
          args: callArgs,
          reason: `path is outside the session workspace: ${absolute}`,
        },
        { floor: "ask", signal },
      );
      if (decision !== "allowed-once") {
        throw new FsError(
          "outside_workspace",
          `access to "${absolute}" was not approved (decision: ${decision}); it is outside the session workspace`,
        );
      }
    },
  };
  return fence;
}
