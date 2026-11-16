# Reins

> 开源 Agent Harness 框架 —— 内核只做机制，其余一切皆插件。
>
> Open-source Agent Harness framework — the kernel provides mechanisms only; everything else is a plugin.

**当前状态：架构设计已定稿（[docs/INDEX.md](./docs/INDEX.md)），M2 引擎闭环落地——内核 / 契约 / 五件官方引擎插件（session / llm / tools / approval / loop）+ config-loader + mock 离线 e2e 全部有码有测试（188 测试）；真实模型回合待自备 key（examples/real）。**

**Status: architecture finalized (see [docs/INDEX.md](./docs/INDEX.md)); M2 engine loop complete — kernel / protocol / five official engine plugins (session, llm, tools, approval, loop) + config-loader + offline mock e2e, 188 tests green; real-model turn awaiting your own key (examples/real).**

- 📚 文档总索引 / Docs index：[docs/INDEX.md](./docs/INDEX.md)
- 🗺️ 里程碑 / Roadmap：[docs/40-roadmap.md](./docs/40-roadmap.md)
- 🤖 给写码 AI 的规矩 / Rules for coding agents：[AGENTS.md](./AGENTS.md)

| 约定 / Convention      | 值 / Value                      |
| ---------------------- | ------------------------------- |
| npm scope              | `@reins/*`                      |
| CLI 命令 / CLI command | `reins`                         |
| 平台 / Platform        | Node.js ≥ 20 · TypeScript · ESM |
| 许可证 / License       | MIT                             |
