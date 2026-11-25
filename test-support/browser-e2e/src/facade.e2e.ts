// 门面 e2e（R202 / D-085）：第三方 UI 插件真浏览器跑 sendPrompt / onTurnFinished /
// subscribe（types 过滤 + 帧必达）。探针注册进 sidebar 区域槽，数据全走 UiModuleContext.host。
// 服务端 = 进程内真 server + mock LLM 脚本；选择器取探针自有 data-* 属性。

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mockFinish, mockLlm, mockText } from "@henira/llm-mock";
import { createServer, type HeniraServer } from "@henira/server";
import { expect, test } from "@playwright/test";

async function writeFacadePlugin(dataDir: string): Promise<void> {
  const id = "facade-pack";
  const version = "1.0.0";
  const dir = path.join(dataDir, "plugins", id, version);
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "plugin.json"),
    JSON.stringify({
      name: id,
      version,
      ui: { title: id, slots: ["conversation"] },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "ui", "main.js"),
    `import { useEffect, useState } from "react";
import { jsx } from "react/jsx-runtime";

export function apply(ctx) {
  function Probe() {
    const [userFrames, setUserFrames] = useState(0);
    const [badType, setBadType] = useState(0);
    const [finished, setFinished] = useState([]);
    const [second, setSecond] = useState("");
    useEffect(() => {
      let alive = true;
      // types 白名单只看行帧；row.appended / upserted 的 kind 必须是 user
      const sub = ctx.host.subscribe({ types: ["user"] }, (frame) => {
        if (!alive || frame.kind !== "delta") return;
        const d = frame.delta;
        if (d.op !== "row.appended" && d.op !== "row.upserted") return;
        if (d.row.kind === "user") setUserFrames((n) => n + 1);
        else setBadType((n) => n + 1);
      });
      const fin = ctx.host.onTurnFinished((result) => {
        if (!alive) return;
        const value = result.ok ? "ok:" + result.text : "fail:" + result.reason;
        setFinished((list) => [...list, value]);
      });
      return () => {
        alive = false;
        sub.dispose();
        fin.dispose();
      };
    }, []);
    // 连发两句：第一回合在跑（服务端 500ms 慢流）→ 第二句必入队（D-086 回执对账）
    const sendBoth = async () => {
      await ctx.host.sendPrompt("probe direct");
      const receipt = await ctx.host.sendPrompt("probe queued");
      setSecond(receipt.messageId === null ? "direct" : "queued");
    };
    return jsx("div", {
      "data-facade-probe": "",
      children: [
        jsx("span", { "data-probe-user": "", children: String(userFrames) }),
        jsx("span", { "data-probe-bad": "", children: String(badType) }),
        jsx("span", { "data-probe-finished": "", children: finished.join("|") }),
        jsx("span", { "data-probe-second": "", children: second }),
        jsx(
          "button",
          {
            "data-probe-send": "",
            onClick: () => {
              void sendBoth().catch(() => setSecond("error"));
            },
          },
          "probe send",
        ),
      ],
    });
  }
  return ctx.registerSlot("conversation", Probe, { order: 1000 });
}
`,
    "utf8",
  );
}

async function startServer(): Promise<{ server: HeniraServer; stop: () => Promise<void> }> {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), "henira-facade-e2e-"));
  const globalDir = path.join(dataDir, "config");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "settings.json"),
    JSON.stringify({ version: 1, model: "mock/mock-1" }),
    "utf8",
  );
  await writeFacadePlugin(dataDir);
  // 第一回合慢流（500ms）：保证第二句在回合进行中提交（入队）；第二回合 = 队列冲刷
  const slowFirstTurn = async function* () {
    yield mockText("probe reply");
    await new Promise((resolve) => setTimeout(resolve, 500));
    yield mockFinish("stop");
  };
  const mock = mockLlm([slowFirstTurn, [mockText("probe second"), mockFinish("stop")]]);
  const server = await createServer({
    dataDir,
    globalDir,
    llm: { name: "llm", start: () => mock.service },
    port: 0,
  });
  return {
    server,
    stop: async () => {
      await server.stop();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test("facade: sendPrompt + queued receipt + onTurnFinished + subscribe types filter", async ({
  page,
}) => {
  const { server, stop } = await startServer();
  try {
    await page.goto(server.url);
    const probe = page.locator("[data-facade-probe]");
    await expect(probe).toBeVisible({ timeout: 15_000 });

    // 连发两句：第一回合在跑 → 第二句入队（回执 id 非空，D-086 账本回声对回）
    await probe.locator("[data-probe-send]").click();
    await expect(probe.locator("[data-probe-second]")).toHaveText("queued", { timeout: 20_000 });
    // 订阅只收 user 行（types 过滤）：两个回合各一条，无一例非 user
    await expect(probe.locator("[data-probe-user]")).toHaveText("2", { timeout: 20_000 });
    await expect(probe.locator("[data-probe-bad]")).toHaveText("0");
    // 两次终局回执：直接回合 + 排队回合（顺序 = 回合顺序）
    await expect(probe.locator("[data-probe-finished]")).toHaveText(
      "ok:probe reply|ok:probe second",
      {
        timeout: 20_000,
      },
    );
  } finally {
    await stop();
  }
});
