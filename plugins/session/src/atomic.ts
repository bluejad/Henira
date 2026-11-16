// 原子写（session.md §5）：tmp + rename 只用于 meta.json / projects.json 这类整体重写的
// 小文件——对只追加日志用 rename 等于整文件重写，语义错误（日志走 append+fsync）。
// rename 跨盘失败：临时文件与目标同目录生成，永不跨卷。

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";

export async function atomicWriteFile(filePath: string, data: string | Uint8Array): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    const handle = await fs.open(tmpPath, "wx"); // O_EXCL：临时名撞车即换名重试的场合由上层处理
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {}); // 不让清理噪声盖过原始错误
    throw err;
  }
}
