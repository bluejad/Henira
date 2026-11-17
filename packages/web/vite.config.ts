// vite 配置（build = dist-web 静态产物；server 同源托管）。库面（src/index.ts）由 tsc 出 dist。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
});
