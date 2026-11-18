# Henira

> 开源 Agent Harness 框架 —— 内核只做机制，其余一切皆插件。
>
> Open-source Agent Harness framework — the kernel provides mechanisms only; everything else is a plugin.

**当前状态：架构设计已定稿（[docs/INDEX.md](./docs/INDEX.md)），M2 引擎闭环 + M3 宿主与界面落地——内核 / 契约 / 五件官方引擎插件（session / llm / tools / approval / loop）+ config-loader + **HTTP/SSE 宿主**（server：账本→行投影器 + REST + SSE + 回环三件套）/ **双形态 SDK**（进程内 runtime + 远端 client，同一门面同一行词表）/ **cli**（`henira serve` / `henira run`）/ **web 界面**（React 可嵌入 + 官方界面插件 plugin-web-ui，真插件走公共注册路径）——全库测试绿 + 真浏览器 e2e 进 CI；真实模型已验（DeepSeek / 智谱 coding / Agnes 三家真跑），离线 demo：`henira serve --mock`。**

**Status: architecture finalized (see [docs/INDEX.md](./docs/INDEX.md)); M2 engine loop + M3 hosts & UI complete — kernel / protocol / five official engine plugins (session, llm, tools, approval, loop) + config-loader + HTTP/SSE host (server: ledger→row projector + REST + SSE + loopback trio) / dual-form SDK (in-process runtime + remote client, one facade, one row vocabulary) / cli (`henira serve` / `henira run`) / web UI (React embeddable + official UI plugin plugin-web-ui, a real plugin via the public registration path) — full test suite green + real-browser e2e in CI; real models verified (DeepSeek / Zhipu coding / Agnes), offline demo: `henira serve --mock`.**

- 📚 文档总索引 / Docs index：[docs/INDEX.md](./docs/INDEX.md)
- 🗺️ 里程碑 / Roadmap：[docs/40-roadmap.md](./docs/40-roadmap.md)
- 🤖 给写码 AI 的规矩 / Rules for coding agents：[AGENTS.md](./AGENTS.md)

| 约定 / Convention      | 值 / Value                      |
| ---------------------- | ------------------------------- |
| npm scope              | `@henira/*`                     |
| CLI 命令 / CLI command | `henira`                        |
| 平台 / Platform        | Node.js ≥ 20 · TypeScript · ESM |
| 许可证 / License       | MIT                             |

> Node 版本：库与门禁底座 ≥ 20；`examples/*` 以 Node 类型剥离直跑 TS，需 ≥ 22.6。
