// 目录/会话分组纯函数（R177 拆分）。
import type { RegisteredDir, SessionSummary } from "@henira/protocol";

/** 按 cwd 分组（保持出现序）；cwd 缺失归 ""（渲染为「其他」） */
function groupByCwd(sessions: readonly SessionSummary[]): Map<string, SessionSummary[]> {
  const groups = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const key = s.cwd ?? "";
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [s]);
    else list.push(s);
  }
  return groups;
}

const dirBasename = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** cwd 归一比较（busy 会话归组判据；与 plugin-session sameCwd 同式语义）。**浏览器 bundle
 *  无 process**——按路径形状判平台（盘符形/反斜杠 = Windows → 大小写归一），不能用 process.platform
 *  （R127 教训：jsdom 有 process 而 bundle 没有，22 组件绿拦不住真浏览器挂载即崩） */
function sameCwd(a: string, b: string): boolean {
  const isWinPath = /^[A-Za-z]:[/]/.test(a) || a.includes("\\");
  return isWinPath ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** 渲染分组：登记目录优先（lastOpenedAt 序），未登记 cwd 补组，cwd 缺失归「其他」 */
interface DirGroup {
  cwd: string;
  label: string;
  sessions: readonly SessionSummary[];
  dir?: RegisteredDir;
}

function buildGroups(
  sessions: readonly SessionSummary[],
  dirs: readonly RegisteredDir[] | null,
  t: (key: string) => string,
): DirGroup[] {
  const byCwd = groupByCwd(sessions);
  if (dirs === null) {
    return [...byCwd.entries()].map(([cwd, list]) => ({
      cwd,
      label: cwd === "" ? t("sessions.ungrouped") : dirBasename(cwd) || cwd,
      sessions: list,
    }));
  }
  const taken = new Set<string>();
  const groups: DirGroup[] = dirs.map((d) => {
    const list = byCwd.get(d.cwd) ?? [];
    for (const s of list) taken.add(s.id);
    return { cwd: d.cwd, label: d.displayName, sessions: list, dir: d };
  });
  for (const [cwd, list] of byCwd) {
    const known = dirs.some((d) => sameCwd(d.cwd, cwd));
    if (!known) {
      for (const s of list) taken.add(s.id);
      groups.push({
        cwd,
        label: cwd === "" ? t("sessions.ungrouped") : dirBasename(cwd) || cwd,
        sessions: list,
      });
    }
  }
  return groups;
}

type PendingDelete =
  | { kind: "dir"; dir: RegisteredDir }
  | { kind: "session"; session: SessionSummary };

type MenuState =
  | { kind: "dir"; x: number; y: number; dir: RegisteredDir }
  | { kind: "session"; x: number; y: number; session: SessionSummary }
  | null;

export type { DirGroup, MenuState, PendingDelete };
export { buildGroups, dirBasename, groupByCwd, sameCwd };
