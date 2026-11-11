/**
 * 逐页内容 prompt（任务 17）：4 页/批（B1②），maxTokens=2500（§6）；
 * 单页重生成 maxTokens=700（防模型顺手多写造成重复计费）。
 * 无状态上下文：brief + 大纲摘要 + 当前批页（不回灌全文 —— C2）。
 */

import type { GenerationParams, OutlineItem } from '../model/deck';

export const BATCH_MAX_TOKENS = 2500;
export const SINGLE_MAX_TOKENS = 700;

export interface BatchRequest {
  params: GenerationParams;
  outlineSlice: OutlineItem[];   // 本批 4 条
  outlineDigest: string;         // 全大纲一行摘要（≤200 字，控 input 增长）
}

export function buildSlidesPrompt(req: BatchRequest): { prompt: string; system: string; maxTokens: number } {
  const lang = req.params.language === 'zh' ? '简体中文' : 'English';
  const system =
    'You are a slide content writer. Return STRICT JSON only. ' +
    `All output text must be in ${lang}。`;
  const pageList = req.outlineSlice
    .map((o, i) => `- ${i + 1}. ${o.title}${o.claim ? `｜主张:${o.claim}` : ''}`)
    .join('\n');
  const prompt = [
    '任务=逐页内容生成',
    `主题=${req.params.topic}`,
    `受众=${req.params.audience}`,
    `语气=${req.params.tone}`,
    `大纲摘要=${req.outlineDigest}`,
    '本批页面：',
    pageList,
    '要求：',
    '1. 为每一页给出 slides 数组，顺序与本批页面一致；',
    '2. 每页含 title、bullets（≤5 条、每条 ≤18 字）、notes（≤120 字）、visual ∈ 图示|数据|纯文字；',
    '3. 不得输出本批之外的页；',
    `4. 全部文本使用 ${lang}；`,
    '返回 JSON：{"slides":[{"title":"...","bullets":["..."],"notes":"...","visual":"纯文字"}]}',
  ].join('\n');
  return { prompt, system, maxTokens: BATCH_MAX_TOKENS };
}

export function buildSingleSlidePrompt(params: GenerationParams, item: OutlineItem): { prompt: string; system: string; maxTokens: number } {
  const lang = params.language === 'zh' ? '简体中文' : 'English';
  const system = `You are a slide content writer. STRICT JSON only. Output in ${lang}.`;
  const prompt = [
    '任务=单页重生成',
    `主题=${params.topic}`,
    `页=${item.title}${item.claim ? `｜主张:${item.claim}` : ''}`,
    '要求：title、bullets(≤5/≤18字)、notes(≤120字)、visual ∈ 图示|数据|纯文字；仅输出这一页。',
    '返回 JSON：{"slides":[{"title":"...","bullets":["..."],"notes":"...","visual":"纯文字"}]}',
  ].join('\n');
  return { prompt, system, maxTokens: SINGLE_MAX_TOKENS };
}