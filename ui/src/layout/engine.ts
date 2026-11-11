/**
 * 版式引擎（精简版，原任务 20/23 合并）：
 * 预览与导出读同一 layoutSpec —— 单一数据源（B4：不承诺像素一致）。
 * 四版式：cover / section / content / ending；16:9；溢出保护与字号自适应。
 */

import type { Slide } from '../model/deck';

export const SLIDE_W = 13.33;   // inch（16:9）
export const SLIDE_H = 7.5;

export type BoxKind = 'title' | 'subtitle' | 'bullets' | 'notesBadge' | 'pageNum' | 'imageSlot';

export interface Box {
  kind: BoxKind;
  x: number; y: number; w: number; h: number;
  fontSize: number;          // pt，已做自适应（6 条要点自动降字号）
  bold?: boolean;
  color: 'fg' | 'accent' | 'muted';
  align?: 'left' | 'center' | 'right';
  text?: string;             // 静态文本（title/subtitle）
  imageKey?: string;         // 图文版式占位框（无图不塌陷）
}

export interface LayoutSpec {
  slideId: string;
  layout: Slide['layout'];
  boxes: Box[];
  truncated: boolean;        // 溢出截断标记（提示层）
}

/** 要点字号自适应：条数越多字号越小（6 条 → 自动降档） */
function bulletFontSize(count: number): number {
  if (count <= 4) return 20;
  if (count <= 5) return 18;
  return 15;
}

/**
 * 由 Slide 构建 layoutSpec。导出（pptx）与预览共用本函数输出，
 * 单测断言双方引用同一结构（tests/layout.spec.ts）。
 */
export function buildLayout(slide: Slide, opts: { themeBgIsDark?: boolean } = {}): LayoutSpec {
  const boxes: Box[] = [];
  let truncated = false;

  if (slide.layout === 'cover') {
    boxes.push({ kind: 'title', x: 1.2, y: 2.6, w: 10.9, h: 1.4, fontSize: 40, bold: true, color: 'fg', align: 'center', text: slide.title });
    boxes.push({ kind: 'subtitle', x: 1.2, y: 4.1, w: 10.9, h: 0.8, fontSize: 18, color: 'muted', align: 'center', text: slide.bullets.slice(0, 2).join(' · ') });
  } else if (slide.layout === 'ending') {
    boxes.push({ kind: 'title', x: 1.2, y: 2.8, w: 10.9, h: 1.2, fontSize: 36, bold: true, color: 'accent', align: 'center', text: slide.title });
    boxes.push({ kind: 'bullets', x: 2.0, y: 4.2, w: 9.3, h: 2.0, fontSize: 18, color: 'fg', align: 'center', text: slide.bullets.join('\n') });
  } else if (slide.layout === 'section') {
    boxes.push({ kind: 'title', x: 1.2, y: 3.0, w: 10.9, h: 1.2, fontSize: 34, bold: true, color: 'accent', text: slide.title });
  } else {
    // content：标题 + 要点（≤5 条/每条 ≤18 字在导出层截断 —— B12）
    boxes.push({ kind: 'title', x: 0.8, y: 0.55, w: 11.7, h: 1.0, fontSize: 28, bold: true, color: 'fg', text: slide.title });
    const raw = slide.bullets;
    const fit = raw.slice(0, 6);
    if (raw.length > 6) truncated = true;
    const text = fit.map((b) => (b.length > 18 ? (truncated = true, b.slice(0, 18) + '…') : b)).join('\n');
    const isImageSlide = slide.visual === '图示';
    boxes.push({
      kind: 'bullets',
      x: 0.9, y: 1.8, w: isImageSlide ? 6.6 : 11.5, h: 4.8,
      fontSize: bulletFontSize(fit.length), color: 'fg', text,
    });
    if (isImageSlide) {
      // 图文版式稳定占位框：无图时不塌陷（M4）
      boxes.push({ kind: 'imageSlot', x: 8.0, y: 2.0, w: 4.3, h: 3.6, fontSize: 12, color: 'muted', imageKey: slide.imageKey });
    }
    boxes.push({ kind: 'pageNum', x: 12.4, y: 6.95, w: 0.7, h: 0.4, fontSize: 10, color: 'muted', align: 'right', text: String(slide.index + 1) });
  }

  return { slideId: slide.id, layout: slide.layout, boxes, truncated };
}