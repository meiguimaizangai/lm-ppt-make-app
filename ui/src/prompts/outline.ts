/**
 * 合并式大纲 prompt（任务 13，M1+M2 一次调用）：
 * - 解析（受众/场景/语气）与大纲一次返回（params + outline）；
 * - maxTokens 分档：8/12 页 → 1200，16 页 → 1600（§6）；
 * - **条数 = 所选页数**（C-1：选 16 出 16），由 parse 层校验。
 */

import type { GenerationParams } from '../model/deck';

export function outlineMaxTokens(pages: number): number {
  return pages >= 16 ? 1600 : 1200;
}

export function buildOutlinePrompt(params: GenerationParams): { prompt: string; system: string; maxTokens: number } {
  const lang = params.language === 'zh' ? '简体中文' : 'English';
  const system =
    'You are a presentation outline planner. Return STRICT JSON only, no markdown fences, no commentary. ' +
    `All output text must be in ${lang} (语言跟随 brief)。`;

  const prompt = [
    '任务=大纲解析生成',
    `主题=${params.topic}`,
    `页数=${params.pages}`,
    `受众=${params.audience}`,
    `语气=${params.tone}`,
    `场景=${params.scene ?? '（自行推断）'}`,
    '——以下为用户 brief——',
    params.brief || '（无，按主题补齐）',
    '——',
    '要求：',
    `1. 先补齐参数（缺失项给合理默认，不阻塞）；`,
    `2. 输出 outline 数组，**条数必须严格等于页数=${params.pages}**，一条不多一条不少；`,
    `3. 每条含 title（≤16 字）、claim（≤30 字一句话主张）、layout ∈ cover|section|content|ending；`,
    `4. 第一条 layout=cover，最后一条 layout=ending，其余 content 或 section；`,
    `5. 全部文本使用 ${lang}；`,
    '返回 JSON：{"params":{"audience":"...","scene":"...","tone":"..."},"outline":[{"title":"...","claim":"...","layout":"..."}]}',
  ].join('\n');

  return { prompt, system, maxTokens: outlineMaxTokens(params.pages) };
}