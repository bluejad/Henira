// vitest 全局配置（此前项目走默认值——根无配置）：
// 慢机裕量（R113 挂账「慢机裕量待加」的落地）：Windows 上并行满载（40+ 测试文件 × 真实
// spawn / jsdom / 磁盘落账）时，单个用例可超 vitest 默认 5s——超时默认提到 20s 只放宽
// 上限、不改失败语义（真实 hang 仍在 20s 报超时）。CI（Linux）用例毫秒级完成，无影响。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
