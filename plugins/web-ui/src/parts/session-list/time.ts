// 会话行相对时间（R188）：列表按 updatedAt 显示安静时间戳；不新增轮询——随列表刷新重算。
// 语言文案全部走词表（check:ui-locale 判据⑥），代码零 CJK。

export function formatRelativeTime(
  updatedAt: number,
  t: (key: string) => string,
  now = Date.now(),
): string {
  const diff = Math.max(0, now - updatedAt);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("time.now");
  if (minutes < 60) return `${minutes} ${t("time.minute")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t("time.hour")}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return `${days} ${t("time.day")}`;
  return new Date(updatedAt).toLocaleDateString();
}
