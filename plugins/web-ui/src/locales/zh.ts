// locale 字典 zh（D-050：首发唯一语言；追加语言 = 新增一份字典文件不动机器）。
// 组件一律 t(key) 取字、缺 key fail-loud——判据⑥机械闸保证零裸文案。
// 本文件是全 web / web-ui 唯一允许出现用户可见中文的源码文件。

export const zh = {
  "app.title": "Henira",
  "app.safeMode": "安全模式",
  "sessions.title": "会话",
  "sessions.new": "新会话",
  "sessions.empty": "还没有会话",
  "sessions.busy": "进行中",
  "sessions.idle": "空闲",
  "conversation.empty": "发一条消息开始对话",
  "conversation.thinking": "思考中…",
  "composer.placeholder": "输入消息，Enter 发送，Shift+Enter 换行",
  "composer.send": "发送",
  "composer.stop": "停止",
  "composer.steerHint": "回合进行中，消息将作为插话进场",
  "approval.title": "权限请求",
  "approval.allow": "允许",
  "approval.deny": "拒绝",
  "approval.pending": "等待处理",
  "approval.settled": "已处理",
  "error.title": "出错了",
  "settings.title": "设置",
  "settings.model": "默认模型",
  "settings.modelPlaceholder": "provider/model，如 deepseek/deepseek-v4-flash",
  "settings.theme": "主题",
  "settings.theme.light": "浅色",
  "settings.theme.dark": "深色",
  "settings.locale": "界面语言",
  "settings.locale.zh": "中文",
  "settings.credential": "密钥",
  "settings.credentialPlaceholder": "粘贴 API key（只写入本地 credentials.json）",
  "settings.credentialProvider": "服务商",
  "settings.save": "保存",
  "settings.saved": "已保存",
  "settings.open": "设置",
  "common.retry": "重试",
  "common.copy": "复制",
  "common.copied": "已复制",
} as const;

export type Dict = Record<string, string>;
