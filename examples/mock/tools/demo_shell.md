# demo_shell

只读演示工具：回执一条 shell 形状的结果（content 文本 + `__meta` 带外元数据同源）。examples/mock 的 per-tool 卡离线载体——示范工具件怎么给 UI 卡喂结构化元数据（E5 数据通道）。

| 项        | 值                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------ |
| 用途      | 返回 `{command} output` 文本；`__meta.kind:"shell"`（exitCode/stdout/stderr 分字段）供终端卡渲染 |
| 参数      | `command`（string，必填）——回显进 output 的命令文本                                              |
| 只读      | 是（isConcurrencySafe——默认放行层放行）                                                          |
| meta 形状 | `{kind:"shell", exitCode:0, stdout, stderr:""}`——与 plugins/shell-tools 的真实 bash 工具同形状   |
