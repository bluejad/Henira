// 真 key 采样验收（M4 批 A 判据③的真 key 半边）：HENIRA_REAL=1 门控——默认整文件 skip，
// 不进 CI（真 key 永不进 CI，凭据纪律 D-030）。链路 = 真 `henira serve`（读用户真实
// ~/.henira 配置：models.json + credentials.json，三家 M2 已点火）→ 真 HTTP 握手 → 浏览器连入
// → PUT /api/settings 切 provider → 逐形态真实 prompt（markdown / 代码块 / 表格 / 长输出）→
// 截图 artifacts/real/<provider>-<form>.png。工具截断形态 serve 链路无自定义工具通道，
// 由 mock 半边（forms.e2e.ts）覆盖。人眼终验归项目所有者。

import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zh } from "@henira/plugin-web-ui";
import { expect, test } from "@playwright/test";

test.skip(process.env.HENIRA_REAL !== "1", "真 key 采样：HENIRA_REAL=1 本机运行（不进 CI）");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOME = os.homedir();
const HANDSHAKE = path.join(HOME, ".henira", "state", "server.json");
// 补跑控制（本机用，不进 CI）：HENIRA_REAL_PROVIDERS="agnes" 白名单过滤（缺省全表）；
// HENIRA_REAL_MODEL="agnes/agnes-3.0-flash" 逐家指定采样模型，优先于启发式——
// Agnes 免费层实测：2.0-flash 服务端暂不可用（2.5/3.0 可用），启发式按快照键序选中前者时用此覆盖
const ONLY_PROVIDERS = process.env.HENIRA_REAL_PROVIDERS?.split(",").map((s) => s.trim());
const MODEL_OVERRIDE = new Map<string, string>(
  (process.env.HENIRA_REAL_MODEL ?? "")
    .split(",")
    .filter((s) => s.includes("/"))
    .map((s) => {
      const i = s.indexOf("/");
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }),
);
// providers 在 beforeAll 懒读（顶层 await 会让 CI 上无 ~/.henira 的机器在模块加载期就炸——skip 也救不了加载期）
let PROVIDERS: string[] = [];

const FORMS: { name: string; prompt: string }[] = [
  {
    name: "markdown",
    prompt:
      "用 markdown 写一段自我介绍：必须包含一个二级标题、一处粗体、一个无序列表（三项）、一个链接。",
  },
  {
    name: "code",
    prompt: "用 markdown 代码块（python）写一个快排，代码块前后各写一句说明。",
  },
  {
    name: "table",
    prompt: "用 markdown 表格列出三种排序算法和它们的平均时间复杂度，表格含表头。",
  },
  {
    name: "long",
    prompt: "从 1 数到 2000，每行一个数字，不要省略，不要加任何说明文字。",
  },
];

let child: ChildProcess | undefined;
let base = "";
let token = "";

async function waitHandshake(): Promise<void> {
  // 陈旧握手防护：读到后必须探活（旧进程的 server.json 可能残留在文件里指向死端口）
  for (let i = 0; i < 100; i++) {
    try {
      const h = JSON.parse(await fs.readFile(HANDSHAKE, "utf8")) as {
        urls?: string[];
        token?: string;
      };
      const url = h.urls?.[0];
      if (url !== undefined) {
        const info = await fetch(`${url}/api/server/info`);
        if (info.ok) {
          base = url;
          token = h.token ?? "";
          return;
        }
      }
    } catch {
      // 尚未写出 / 尚未探活成功，继续等
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("serve handshake timeout (~/.henira/state/server.json)");
}

test.beforeAll(async () => {
  // providers 懒读：models.json 缺失（CI / 未配置机器）→ 空表，循环零次不炸
  try {
    PROVIDERS = Object.keys(
      JSON.parse(await fs.readFile(path.join(HOME, ".henira", "config", "models.json"), "utf8"))
        .providers ?? {},
    ) as string[];
  } catch {
    PROVIDERS = [];
  }
  await fs.rm(HANDSHAKE, { force: true }); // 陈旧握手（上次进程残留）先清掉
  child = spawn(
    process.execPath,
    [path.join(REPO, "packages", "cli", "dist", "index.js"), "serve"],
    {
      stdio: "ignore",
      cwd: HOME,
    },
  );
  await waitHandshake();
});

test.afterAll(async () => {
  child?.kill();
});

async function shot(page: import("@playwright/test").Page, name: string): Promise<void> {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "artifacts", "real");
  await fs.mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name) });
}

test("三家真 provider 经 serve 链路逐形态采样", async ({ page }) => {
  // 全表采样：时长随已配置 provider 数缩放（每家 4 形态，长输出形态最慢）
  test.setTimeout(600_000 * Math.max(1, PROVIDERS.length));
  const auth = token === "" ? "" : `?token=${encodeURIComponent(token)}`;
  const catalog = (await (await fetch(`${base}/api/models`)).json()) as {
    providers: Record<string, { models?: string[] }>;
  };
  // 专用采样会话：updatedAt 最新 → mount 必选它（不污染用户真实会话；轮询快照也有确定 id）
  const created = (await (
    await fetch(`${base}/api/sessions`, { method: "POST", body: "{}" })
  ).json()) as { id: string };
  const sessionBusy = async (): Promise<boolean> => {
    const snap = (await (await fetch(`${base}/api/sessions/${created.id}/snapshot`)).json()) as {
      state: { busy: boolean };
    };
    return snap.state.busy;
  };
  for (const provider of PROVIDERS) {
    if (ONLY_PROVIDERS !== undefined && !ONLY_PROVIDERS.includes(provider)) continue;
    const models = catalog.providers[provider]?.models ?? [];
    // 采样模型：env 覆盖（HENIRA_REAL_MODEL）优先；缺省启发式=优先常见对话模型名，否则取第一个
    const model =
      MODEL_OVERRIDE.get(provider) ??
      models.find((m) => /chat|flash|air|lite|v4|glm-4|storm/i.test(m)) ??
      models[0];
    if (model === undefined) continue;
    await fetch(`${base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: `${provider}/${model}` }),
    });
    await page.goto(`${base}/${auth}`);
    // mount 自动选会话（专用会话 updatedAt 最新必被选中）——等列表项渲染 + 选中落定
    await page.waitForSelector(".henira-sessions li", { timeout: 30_000 });
    await page.waitForTimeout(500);
    for (const form of FORMS) {
      const area = page.getByPlaceholder(zh["composer.placeholder"]);
      await area.fill(form.prompt);
      await area.press("Enter");
      // 真发出门：submit 清草稿（同步）——选中未落定/空转时草稿保留，5 秒内必现真相
      await expect(area).toHaveValue("", { timeout: 5_000 });
      // 收尾轮询走 REST 真相（快照 busy 落 false），不赌 UI 时序；长输出给足 5 分钟
      let settled = false;
      for (let i = 0; i < 600; i++) {
        if (!(await sessionBusy())) {
          settled = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      expect(settled).toBe(true);
      await page.waitForTimeout(400); // SSE 增量渲染到位
      await shot(page, `${provider}-${form.name}.png`);
    }
  }
});
