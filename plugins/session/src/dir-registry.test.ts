// R199：项目选择器的轻量列表（peek 只读 projects.json，不自愈）与项目 key 形状闸。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirRegistry } from "./dir-registry.js";
import { isProjectKey, projectKey } from "./project-key.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-dirs-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("DirRegistry.peek（R199）", () => {
  it("peek 只读 projects.json 不自愈；list 自愈后 peek 可见", async () => {
    const cwd = path.join(dataDir, "workspace");
    await fs.mkdir(cwd, { recursive: true });
    const key = projectKey(cwd);
    const sessionDir = path.join(dataDir, "projects", key, "sessions", "s-1");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "session.v1.jsonl"),
      `${JSON.stringify({ version: 1, id: "s-1", createdAt: 1, cwd })}\n`,
      "utf8",
    );
    const dirs = new DirRegistry({ dataDir });
    expect(await dirs.peek()).toEqual([]); // projects.json 缺失 → 不自愈
    const listed = await dirs.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.cwd).toBe(cwd);
    expect((await dirs.peek()).map((d) => d.id)).toEqual(listed.map((d) => d.id));
  });

  it("isProjectKey：CJK slug 合法；路径分隔符/短 hash 拒绝", () => {
    expect(isProjectKey(projectKey("E:\\测试功能\\新建文件夹"))).toBe(true);
    expect(isProjectKey("--reins-de960ff4--")).toBe(true);
    expect(isProjectKey("../x")).toBe(false);
    expect(isProjectKey("--x-de960ff4--/..")).toBe(false);
    expect(isProjectKey("--x-de960ff--")).toBe(false);
  });
});
