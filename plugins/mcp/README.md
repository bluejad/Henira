# @henira/plugin-mcp

mcp 槽位官方读者（服务件，占 `mcp` 槽 + inject `tools`，D-064）：按宿主装配前置喂入的 server 声明连接外部 MCP server（官方 `@modelcontextprotocol` SDK——stdio / StreamableHTTP），把其工具转接进 tools 注册表；服务形状 = `McpService.call` 最小面（useResource 数据泵的宿主单跳落此）。

- 契约出处：[interfaces.md](../../docs/20-architecture/interfaces.md) §mcp（McpService / 连接语义 / 命名 / 凭据）
- 设计决定：[10-decisions.md](../../docs/10-decisions.md) D-064；安全基线 D-030
- 槽位格式：[plugins.md](../../docs/20-architecture/plugins.md) §4 mcp 行（`mcp/<名>.json`：本地 `{command,args?,env?}` / 远程 `{url,headers?,type?}`）

## 语义钉子

- **异步连接**：装配不等 server；连上 → `tools/list` → 注册；`list_changed` → 整代原子换注册（失败保旧代，sync 单队列串行）
- **有界退避**：1s × 2，3 次耗尽 → 注销该 server 全部工具 + 告警（新会话重来；stdio 死亡不自动 respawn）
- **命名**：`mcp__<server>__<tool>`，非法字符 → `_`、超 64 截断 + 短哈希防塌缩；跨 server 撞名整代回滚
- **审批**：转接工具 `isConcurrencySafe` 恒缺省——外部 server 默认过审批卡（D-039 判定链不变）
- **凭据（D-030）**：`${credential:名}` 由宿主展开后内存传入；本件不接触 credentials.json、不回显 env / headers；stdio 父环境经宿主清洗（剔 `KEY|PASSWORD|SECRET|TOKEN` 与 `HENIRA_*`）

## 用法

```ts
import { mcpPlugin } from "@henira/plugin-mcp";

// servers 由宿主装配前置扫描 + 凭据展开后喂入（宿主永不传密钥引用原文）
createHarness().use(
  mcpPlugin({
    servers: [
      { pluginId: "office", server: "main", kind: "stdio", command: "node", args: ["server.cjs"] },
    ],
    spawnEnv,
  }),
);
ctx.get("mcp").call({ pluginId: "office", server: "main", tool: "convert" }, args, signal);
```

宿主侧扫描 / 指纹确认门 / 模板变量与凭据展开见 `@henira/config-loader`（`preparePlugins` / `expandMcpServers`）。

## 文件 ↔ 设计

| 文件     | 职责                                                             | 设计出处                   |
| -------- | ---------------------------------------------------------------- | -------------------------- |
| index.ts | 连接管理（连接/退避/同步/调用/关闭）+ 工具转接 + McpService 工厂 | D-064 / interfaces.md §mcp |
