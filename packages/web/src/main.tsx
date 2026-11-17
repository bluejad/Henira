// 自托管入口（vite build 产物）：同源 client + 全布局。可嵌入用法 = npm 用户以
// createWebApp({ client }) 注入自己的 client（web 自身的宿主用法即同源特例，D-037）。

import "@henira/plugin-web-ui/tokens.css";
import { createClient } from "@henira/sdk/client"; // 浏览器只拿远端形态（runtime 携 node 依赖，不进浏览器图）
import { createWebApp } from "./host.js";

const params = new URLSearchParams(window.location.search);
const token = params.get("token") ?? undefined;

const app = createWebApp({
  client: createClient({ baseUrl: window.location.origin, token: token ?? undefined }),
  layout: "full",
});

app.mount(document.getElementById("root") as HTMLElement);
