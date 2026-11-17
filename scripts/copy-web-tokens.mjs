// web-ui tokens.css → dist（构建脚本尾部；cmd 的 mkdir -p / cp 不可移植，node 直写）。
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("plugins/web-ui/dist", { recursive: true });
copyFileSync("plugins/web-ui/src/tokens.css", "plugins/web-ui/dist/tokens.css");
