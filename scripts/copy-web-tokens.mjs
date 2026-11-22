// web-ui tokens.css + styles/ → dist（构建脚本尾部；cmd 的 mkdir -p / cp 不可移植，node 直写）。
// R178：conversation/ 子目录按功能分文件——dist 保持同形相对路径（@import 解析）。
// R179：先清 dist/styles 再拷（源文件删除/改名后 dist 不残留旧 CSS）。
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "plugins/web-ui/src";
const DIST = "plugins/web-ui/dist";

function copyStyles(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) {
      copyStyles(source, target);
      continue;
    }
    if (name.endsWith(".css")) copyFileSync(source, target);
  }
}

mkdirSync(DIST, { recursive: true });
rmSync(join(DIST, "styles"), { recursive: true, force: true });
copyFileSync(`${SRC}/tokens.css`, `${DIST}/tokens.css`);
copyStyles(`${SRC}/styles`, `${DIST}/styles`);
