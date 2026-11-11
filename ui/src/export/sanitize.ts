/**
 * 导出自检与长度截断（任务 22 精简版，零额度）：
 * - 控制字符剔除（防损坏文件）；
 * - 要点 ≤5 条 / 每条 ≤18 字 / 备注 ≤120 字，超限截断并标记（B12/R10）。
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeText(s: string): string {
  return (s ?? '').replace(CONTROL_CHARS, '');
}

/** 要点列表导出层截断：>5 条截断；>18 字截字并加省略标记 */
export function truncateBullets(bullets: string[]): { list: string[]; truncated: boolean } {
  let truncated = false;
  let list = bullets.map(sanitizeText);
  if (list.length > 5) { list = list.slice(0, 5); truncated = true; }
  list = list.map((b) => {
    if (b.length > 18) { truncated = true; return b.slice(0, 17) + '…'; }
    return b;
  });
  return { list, truncated };
}

/** 备注截断 ≤120 字 */
export function truncateNotes(notes: string): { text: string; truncated: boolean } {
  const t = sanitizeText(notes);
  return t.length > 120 ? { text: t.slice(0, 119) + '…', truncated: true } : { text: t, truncated: false };
}

/** bullets 文本（换行拼接）的导出截断 */
export function truncateForExport(text: string): string {
  const { list, truncated } = truncateBullets(text.split('\n'));
  return list.join('\n') + (truncated ? '\n…（超长已截断）' : '');
}