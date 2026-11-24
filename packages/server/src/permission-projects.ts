// 权限管理面（R199）：项目清单 / 详情 / 全局规则 / 删除的服务端共享逻辑。
// 项目身份只从 projects.json 登记条目取（id/key/cwd）；路径拼接前用 isProjectKey 兜底，
// 绝不信任客户端传来的目录名。规则文件读写住 config-loader/permissions.ts。

import path from "node:path";
import {
  globalPermissionsPath,
  type RemovePermissionRuleResult,
  readPermissionRules,
  removePermissionRule,
} from "@henira/config-loader";
import type { DirRegistry } from "@henira/plugin-session";
import { isProjectKey, sameCwd } from "@henira/plugin-session";
import type {
  PermissionProjectSummary,
  PermissionProjectsView,
  PermissionProjectView,
  PermissionRule,
  PermissionRulesView,
} from "@henira/protocol";
import type { SessionRegistry } from "./session-registry.js";

export interface PermissionProjectDeps {
  dirs: Pick<DirRegistry, "peek" | "list" | "get">;
  registry: Pick<SessionRegistry, "get" | "sessionCwd">;
  dataDir: string;
  globalDir: string;
}

function projectRulesFile(deps: PermissionProjectDeps, key: string): string {
  return path.join(deps.dataDir, "projects", key, "permissions.json");
}

/** projects.json 条目是手可改文件：逐字段窄化，坏条目跳过（不与路径/展示层拼 undefined） */
function usableDir(dir: {
  id?: unknown;
  key?: unknown;
  cwd?: unknown;
  displayName?: unknown;
}): dir is { id: string; key: string; cwd: string; displayName: string } {
  return (
    typeof dir.id === "string" &&
    dir.id !== "" &&
    typeof dir.key === "string" &&
    isProjectKey(dir.key) &&
    typeof dir.cwd === "string" &&
    dir.cwd !== "" &&
    typeof dir.displayName === "string"
  );
}

function summarize(
  entry: { id: string; key: string; cwd: string; displayName: string },
  view: PermissionRulesView,
): PermissionProjectSummary {
  const allowCount = view.rules.filter((rule) => rule.decision === "allow").length;
  return {
    id: entry.id,
    key: entry.key,
    cwd: entry.cwd,
    name: entry.displayName || path.basename(entry.cwd) || entry.cwd,
    allowCount,
    denyCount: view.rules.length - allowCount,
    status: view.status,
  };
}

/** 项目清单：peek（只读，不扫账本）；首次启动 projects.json 为空时退回 list() 自愈一次。
 *  默认排序 = 最近打开在前；当前会话所属项目置顶并回传 currentId。 */
export async function listPermissionProjects(
  deps: PermissionProjectDeps,
  sessionId?: string,
): Promise<PermissionProjectsView> {
  const entries = await deps.dirs.peek();
  const dirs = entries.length > 0 ? entries : await deps.dirs.list();
  const valid = dirs.filter(usableDir);
  const projects: PermissionProjectSummary[] = [];
  for (const dir of valid) {
    const view = await readPermissionRules(projectRulesFile(deps, dir.key));
    projects.push(summarize(dir, view));
  }
  let currentId: string | undefined;
  if (sessionId !== undefined) {
    const cwd = deps.registry.get(sessionId)?.cwd ?? (await deps.registry.sessionCwd(sessionId));
    if (cwd !== undefined) {
      currentId = valid.find((dir) => sameCwd(dir.cwd, cwd))?.id;
    }
  }
  if (currentId !== undefined) {
    const index = projects.findIndex((project) => project.id === currentId);
    if (index > 0) projects.unshift(...projects.splice(index, 1));
  }
  return { projects, ...(currentId !== undefined ? { currentId } : {}) };
}

export async function projectPermissionView(
  deps: PermissionProjectDeps,
  id: string,
): Promise<PermissionProjectView | undefined> {
  const dir = await deps.dirs.get(id);
  if (dir === undefined || !usableDir(dir)) return undefined;
  const view = await readPermissionRules(projectRulesFile(deps, dir.key));
  return {
    id: dir.id,
    key: dir.key,
    cwd: dir.cwd,
    name: dir.displayName || path.basename(dir.cwd) || dir.cwd,
    ...view,
  };
}

export function globalPermissionView(deps: PermissionProjectDeps): Promise<PermissionRulesView> {
  return readPermissionRules(globalPermissionsPath(deps.globalDir));
}

export async function removeProjectPermissionRule(
  deps: PermissionProjectDeps,
  id: string,
  rule: PermissionRule,
): Promise<RemovePermissionRuleResult | undefined> {
  const dir = await deps.dirs.get(id);
  if (dir === undefined || !usableDir(dir)) return undefined;
  return removePermissionRule(projectRulesFile(deps, dir.key), rule);
}

export function removeGlobalPermissionRule(
  deps: PermissionProjectDeps,
  rule: PermissionRule,
): Promise<RemovePermissionRuleResult> {
  return removePermissionRule(globalPermissionsPath(deps.globalDir), rule);
}
