/**
 * 生成服务（精简版，合并原任务 13–18）：
 * - generateOutline：解析+大纲一次调用（合并式 prompt），条数≠页数判失败重试 1 次；
 * - generateSlides：4 页/批 ×2 并发，逐批回填；失败页占位 status='failed'，不白屏；
 * - regenerateSlide：单页重生成（pool2）。
 * 全部经 SafeLLM（maxTokens 强制 + 超时 + 全局重试 1 次 + 池熔断）。
 */

import type { Deck, GenerationParams, OutlineItem, Slide } from '../model/deck';
import { newId, LIMITS } from '../model/deck';
import { safeComplete } from '../llm/safe';
import { buildOutlinePrompt } from '../prompts/outline';
import { buildSlidesPrompt, buildSingleSlidePrompt } from '../prompts/slides';
import { parseJson } from './json';
import { unifiedHandle, LlmParseError, type UnifiedAction } from '../error/classes';
import { getConfig } from '../config/runtime';

/** 16 页硬裁：outline 超 16 条裁到 16（手填 >16 场景由表单层拦截，这里兜底） */
function clampOutline(items: OutlineItem[]): { items: OutlineItem[]; clamped: boolean } {
  if (items.length <= LIMITS.outlineMax) return { items, clamped: false };
  return { items: items.slice(0, LIMITS.outlineMax), clamped: true };
}

function toOutlineItem(raw: { title?: string; claim?: string; layout?: string }, i: number): OutlineItem {
  const layout = ['cover', 'section', 'content', 'ending'].includes(raw.layout ?? '')
    ? (raw.layout as OutlineItem['layout'])
    : i === 0 ? 'cover' : 'content';
  return { id: newId('p'), title: (raw.title ?? `第 ${i + 1} 页`).slice(0, 24), claim: raw.claim ?? '', layout };
}

export interface OutlineResult {
  outline: OutlineItem[];
  params: GenerationParams;
  clamped: boolean;
}

/** 解析 + 大纲（M1/M2 合并一次调用；条数=页数，不等则整体重试 1 次） */
export async function generateOutline(base: GenerationParams): Promise<OutlineResult> {
  const { prompt, system, maxTokens } = buildOutlinePrompt(base);
  const attempt = async (): Promise<OutlineResult> => {
    const resp = await safeComplete(
      { prompt, system, maxTokens, tag: 'outline' },
      { pool: 'pool1', tag: 'outline' },
    );
    if (resp.finishReason === 'length') throw new LlmParseError('finish_reason=length（截断）');
    const data = parseJson<{ params?: Partial<GenerationParams>; outline?: { title?: string; claim?: string; layout?: string }[] }>(resp.text);
    const arr = Array.isArray(data.outline) ? data.outline : [];
    if (arr.length !== base.pages) {
      // C-1：选 N 出 N；不等即判解析失败
      throw new LlmParseError(`outline 条数 ${arr.length} ≠ 页数 ${base.pages}`);
    }
    const { items, clamped } = clampOutline(arr.map(toOutlineItem));
    return {
      outline: items,
      params: { ...base, ...(data.params ?? {}), pages: items.length as GenerationParams['pages'] },
      clamped,
    };
  };
  try {
    return await attempt();
  } catch {
    return await attempt();   // 全局 1 次重试（内部 safeComplete 又各含 1 次请求级重试上限，总体不循环）
  }
}

function toItem(o: OutlineItem, i: number): Slide {
  return {
    id: o.id, index: i, title: o.title, bullets: [], notes: '',
    visual: '纯文字', layout: o.layout, status: 'pending',
  };
}

/** 大纲 → 占位 slides（B13：显式 pending，不伪装 AI 产出） */
export function outlineToSlides(outline: OutlineItem[]): Slide[] {
  return outline.map(toItem);
}

interface ParsedSlide { title?: string; bullets?: string[]; notes?: string; visual?: string }

function applyParsed(slide: Slide, p: ParsedSlide): Slide {
  const bullets = (Array.isArray(p.bullets) ? p.bullets : []).slice(0, LIMITS.bulletsMax);
  return {
    ...slide,
    title: (p.title ?? slide.title).slice(0, 30),
    bullets,
    notes: (p.notes ?? '').slice(0, LIMITS.notesCharsMax),
    visual: (['图示', '数据', '纯文字'].includes(p.visual ?? '') ? p.visual : slide.visual) as Slide['visual'],
    status: 'done',
  };
}

export interface GenerateSlidesOptions {
  /** 仅这些 id 的页生成（脏页/断点续作），缺省 = 全部 pending/failed 页 */
  onlyIds?: string[];
  onBatch?: (doneSlides: Slide[]) => void;   // 每批返回即增量渲染（L79）
}

/**
 * 逐页生成：4 页/批 ×2 并发（B1②）。
 * 单批失败 → 该批页置 failed 占位，其他批不受影响（L81）。
 */
export async function generateSlides(deck: Deck, opts: GenerateSlidesOptions = {}): Promise<UnifiedAction | null> {
  const cfg = getConfig();
  const params = deck.params!;
  const targets = (opts.onlyIds
    ? deck.outline.filter((o) => opts.onlyIds!.includes(o.id))
    : deck.outline
  ).filter((o) => {
    const s = deck.slides.find((x) => x.id === o.id);
    return !s || s.status !== 'done';
  });
  if (targets.length === 0) return null;

  const digest = deck.outline.map((o, i) => `${i + 1}.${o.title}`).join(' ').slice(0, 200);
  const batches: OutlineItem[][] = [];
  for (let i = 0; i < targets.length; i += cfg.batchSize) batches.push(targets.slice(i, i + cfg.batchSize));

  const results = new Map<string, Slide>();
  let failure: unknown = null;

  // 2 路并发池
  const workers = Array.from({ length: Math.min(cfg.concurrency, batches.length) }, async () => {
    while (batches.length) {
      const batch = batches.shift()!;
      try {
        const { prompt, system, maxTokens } = buildSlidesPrompt({ params, outlineSlice: batch, outlineDigest: digest });
        const resp = await safeComplete({ prompt, system, maxTokens, tag: 'slides' }, { pool: 'pool1', tag: 'slides' });
        const data = parseJson<{ slides?: ParsedSlide[] }>(resp.text);
        const arr = Array.isArray(data.slides) ? data.slides : [];
        // 页对齐：返回条数 ≠ 批大小 → 只接受可对齐部分，缺失页留给占位/重试
        batch.forEach((o, i) => {
          const cur = deck.slides.find((s) => s.id === o.id) ?? toItem(o, deck.outline.indexOf(o));
          results.set(o.id, i < arr.length ? applyParsed(cur, arr[i]) : { ...cur, status: 'failed' });
        });
        opts.onBatch?.(batch.map((o) => results.get(o.id)!));
      } catch (e) {
        failure = e;
        // 统一错误路径：该批页全部占位 failed，保留其他批结果
        batch.forEach((o) => {
          const cur = deck.slides.find((s) => s.id === o.id) ?? toItem(o, deck.outline.indexOf(o));
          results.set(o.id, { ...cur, status: 'failed' });
        });
      }
    }
  });
  await Promise.all(workers);

  // 回写（调用方负责把 results 合入 store —— 通过返回值）
  (generateSlides as unknown as { _last?: Map<string, Slide> })._last = results;
  const done = deck.slides.filter((s) => s.status === 'done').length + results.size;
  if (failure) return unifiedHandle(failure, { generated: done, total: deck.outline.length });
  return null;
}

/** 取上一次 generateSlides 的逐页结果（简化调用面，避免额外状态管理） */
export function lastSlideResults(): Map<string, Slide> {
  return (generateSlides as unknown as { _last?: Map<string, Slide> })._last ?? new Map();
}

/** 单页重生成（pool2，mt=700）；池2 不足时抛错 → UI 置灰提示 */
export async function regenerateSlide(deck: Deck, slideId: string): Promise<Slide> {
  const item = deck.outline.find((o) => o.id === slideId);
  const cur = deck.slides.find((s) => s.id === slideId);
  if (!item || !cur) throw new Error('slide not found');
  const { prompt, system, maxTokens } = buildSingleSlidePrompt(deck.params!, item);
  const resp = await safeComplete({ prompt, system, maxTokens, tag: 'regen' }, { pool: 'pool2', tag: 'regen' });
  const data = parseJson<{ slides?: ParsedSlide[] }>(resp.text);
  const p = data.slides?.[0];
  if (!p) throw new LlmParseError('单页返回缺 slides[0]');
  return applyParsed(cur, p);
}