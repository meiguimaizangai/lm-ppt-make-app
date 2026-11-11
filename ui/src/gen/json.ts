/**
 * JSON 解析容错（任务 14，R3）：markdown 包裹 / 尾逗号 / 单引号 / 注释 → 仍能解析。
 * 20 例成功率 100% 为验收（tests/json.spec.ts）。
 */

import { LlmParseError } from '../error/classes';

/** 从原始文本提取 JSON 主体（剥 ```json 围栏、前导说明文字） */
function extractJsonBody(raw: string): string {
  let t = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const idxs = [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0);
  if (idxs.length === 0) return t;
  const s = Math.min(...idxs);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  return end > s ? t.slice(s, end + 1) : t;
}

/** 宽容化：尾逗号、行注释、单引号字符串 */
function lenient(raw: string): string {
  let t = extractJsonBody(raw);
  t = t.replace(/,\s*([}\]])/g, '$1');
  t = t.replace(/\/\/[^\n]*/g, '');
  t = t.replace(/([{,\[]\s*)'([^'\n]*)'(\s*[:,\]])/g, '$1"$2"$3');
  return t;
}

/** 严格 → 宽容 两级解析；都失败抛 LlmParseError（进入统一错误路径，可重试 1 次） */
export function parseJson<T = unknown>(raw: string): T {
  try {
    return JSON.parse(extractJsonBody(raw)) as T;
  } catch {
    try {
      return JSON.parse(lenient(raw)) as T;
    } catch (e) {
      throw new LlmParseError((e as Error).message);
    }
  }
}