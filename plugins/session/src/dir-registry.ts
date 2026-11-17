// 登记工作目录注册表（data-directory §4 projects.json——权威工作区列表）：
// id = sha256(canonical cwd) 前 16 位；条目含 id ↔ cwd ↔ key 映射，查找不靠目录名。
// 可自愈：list 时扫账本目录从会话头 cwd 复活缺失条目（BC reconcileProjects 行为层）。
// 原子重写（tmp+rename，与 settings.json 同一纪律）。住 plugin-session：账本域共享知识，
// server 与 sdk 双宿主消费（规则 3 禁宿主互依——知识下沉引擎层）。

import { createHash } from "node:crypto";
import { type Dirent, existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DirBrowse, DirBrowseItem, RegisteredDir } from "@henira/protocol";
import { projectKey } from "./project-key.js";
import { SESSION_LOG_FILE } from "./store.js";

export const DRIVES_ROOT = "__drives__";

export function isDrivesRoot(path: string): boolean {
  return path === DRIVES_ROOT;
}

/** canonical cwd：resolve + Windows 大小写归一（同目录不同写法归一条目，BC 行为层） */
function canonicalCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function dirId(cwd: string): string {
  return createHash("sha256").update(canonicalCwd(cwd)).digest("hex").slice(0, 16);
}

/** Windows 盘符大小写不敏感比较（删目录 busy 判据用，BC fullCwdFor 行为层） */
export function sameCwd(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** 全局目录浏览一层（新增目录弹窗数据源）：path 缺省 homedir、__drives__ = 盘符列表根
 *  （win32 枚举存在盘符）、一层 readdir 过滤隐藏项只回目录、按中文名排序。
 *  双宿主共用（server 路由 / runtime 进程内），D-060 信任边界：回环 + token 之上只读。 */
export async function browseDirectories(rawPath?: string): Promise<DirBrowse> {
  if (rawPath !== undefined && isDrivesRoot(rawPath)) {
    if (process.platform !== "win32") {
      return { path: rawPath, items: [{ name: "/", path: "/", type: "directory" }] };
    }
    const drives: DirBrowseItem[] = [];
    for (let i = 65; i <= 90; i++) {
      const drive = `${String.fromCharCode(i)}:\\`;
      if (existsSync(drive)) drives.push({ name: drive, path: drive, type: "drive" });
    }
    return { path: rawPath, items: drives };
  }
  const target = path.resolve(rawPath ?? os.homedir());
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(target, { withFileTypes: true });
  } catch {
    throw new Error("directory does not exist or is not accessible");
  }
  const items: DirBrowseItem[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue; // 隐藏项不返
    if (!dirent.isDirectory()) continue; // 弹窗只浏览目录
    items.push({ name: dirent.name, path: path.join(target, dirent.name), type: "directory" });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return { path: target, parent: path.dirname(target), items };
}

export class DirRegistry {
  readonly #dataDir: string;

  constructor(opts: { dataDir: string }) {
    this.#dataDir = opts.dataDir;
  }

  /** 列表（含自愈）：文件条目 + 扫账本复活缺失条目（有变化才回写） */
  async list(): Promise<RegisteredDir[]> {
    const file = await this.#read();
    const known = new Set(file.projects.map((p) => p.id));
    const revived = await this.#reconcile(file, known);
    if (revived) await this.#write(file);
    return [...file.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  async get(id: string): Promise<RegisteredDir | undefined> {
    const file = await this.#read();
    return file.projects.find((p) => p.id === id);
  }

  /** upsert：已有条目刷 lastOpenedAt/openCount/lastSessionId/key 校正；新条目置顶（BC 行为层） */
  async upsert(cwd: string, sessionId?: string): Promise<RegisteredDir> {
    const resolved = path.resolve(cwd);
    const id = dirId(resolved);
    const file = await this.#read();
    const now = Date.now();
    const existing = file.projects.find((p) => p.id === id);
    if (existing !== undefined) {
      existing.cwd = resolved;
      existing.key = projectKey(resolved); // 校正被挪动的目录（data-directory §4）
      existing.lastOpenedAt = now;
      existing.openCount += 1;
      if (sessionId !== undefined) existing.lastSessionId = sessionId;
    } else {
      file.projects.unshift({
        id,
        cwd: resolved,
        key: projectKey(resolved),
        displayName: path.basename(resolved) || resolved,
        createdAt: now,
        lastOpenedAt: now,
        openCount: 1,
        lastSessionId: sessionId ?? null,
      });
    }
    file.lastUpdatedAt = now;
    await this.#write(file);
    return existing ?? (file.projects[0] as RegisteredDir);
  }

  async remove(id: string): Promise<void> {
    const file = await this.#read();
    const next = file.projects.filter((p) => p.id !== id);
    if (next.length === file.projects.length) return; // 未知 id 幂等
    file.projects = next;
    file.lastUpdatedAt = Date.now();
    await this.#write(file);
  }

  /** 自愈：扫 projects/<key>/sessions/ 各会话头，cwd 缺失条目复活（data-directory §4） */
  async #reconcile(file: ProjectsFile, known: Set<string>): Promise<boolean> {
    const projectsDir = path.join(this.#dataDir, "projects");
    let keys: string[] = [];
    try {
      keys = await fs.readdir(projectsDir);
    } catch {
      return false; // 无账本目录 = 无可复活
    }
    let changed = false;
    // cwd → 最新会话（mtime 取 max，lastOpenedAt 由此派生）
    const latest = new Map<
      string,
      { cwd: string; createdAt: number; mtime: number; sessionId: string }
    >();
    for (const key of keys) {
      const sessionsDir = path.join(projectsDir, key, "sessions");
      let ids: string[] = [];
      try {
        ids = await fs.readdir(sessionsDir);
      } catch {
        continue;
      }
      for (const sessionId of ids) {
        try {
          const header = JSON.parse(
            (await fs.readFile(path.join(sessionsDir, sessionId, SESSION_LOG_FILE), "utf8")).split(
              "\n",
            )[0],
          ) as { id?: string; cwd?: string; createdAt?: number };
          if (header.id === undefined || header.cwd === undefined) continue;
          const id = dirId(header.cwd);
          const stat = await fs.stat(path.join(sessionsDir, sessionId)).catch(() => undefined);
          const mtime = stat?.mtimeMs ?? header.createdAt ?? 0;
          const hit = latest.get(id);
          if (hit === undefined || mtime > hit.mtime) {
            latest.set(id, {
              cwd: header.cwd,
              createdAt: header.createdAt ?? mtime,
              mtime,
              sessionId,
            });
          }
        } catch {}
      }
    }
    for (const [id, hit] of latest) {
      if (known.has(id)) continue;
      file.projects.unshift({
        id,
        cwd: hit.cwd,
        key: projectKey(hit.cwd),
        displayName: path.basename(hit.cwd) || hit.cwd,
        createdAt: hit.createdAt,
        lastOpenedAt: hit.mtime,
        openCount: 0,
        lastSessionId: hit.sessionId,
      });
      changed = true;
    }
    return changed;
  }

  async #read(): Promise<ProjectsFile> {
    try {
      const parsed = JSON.parse(
        await fs.readFile(path.join(this.#dataDir, "projects.json"), "utf8"),
      ) as ProjectsFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) throw new Error("bad shape");
      return parsed;
    } catch {
      return { version: 1, lastUpdatedAt: 0, projects: [] }; // 缺失 / 损坏按空表走（可自愈）
    }
  }

  async #write(file: ProjectsFile): Promise<void> {
    const target = path.join(this.#dataDir, "projects.json");
    await fs.mkdir(this.#dataDir, { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await fs.rename(tmp, target);
  }
}

interface ProjectsFile {
  version: 1;
  lastUpdatedAt: number;
  projects: RegisteredDir[];
}
