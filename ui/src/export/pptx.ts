/**
 * 导出 .pptx（任务 3/21 精简版）：
 * Deck → layoutSpec（与预览同一数据源）→ PptxGenJS → Blob 下载。
 * - 主题色/字体写入；notesSlide 写入；图片占位（本地插图嵌入）；
 * - 导出层截断与控制字符清理（B12/R10，零额度）；
 * - PptxGenJS 打包进 bundle，零外链（C5）。
 */

import PptxGenJS from 'pptxgenjs';
import type { Deck, Slide } from '../model/deck';
import { buildLayout, type Box } from '../layout/engine';
import { getTheme, type Theme } from '../theme/themes';
import { sanitizeText, truncateForExport } from './sanitize';

function colorOf(t: Theme, c: Box['color']): string {
  const raw = c === 'fg' ? t.fg : c === 'accent' ? t.accent : t.muted;
  return raw.replace('#', '');
}

/** Slide + theme → 一页 PptxGenJS（预览读同一 layoutSpec） */
function addSlide(pptx: PptxGenJS, deck: Deck, slide: Slide, theme: Theme): void {
  const spec = buildLayout(slide);
  const s = pptx.addSlide();
  s.background = { color: (slide.layout === 'cover' ? theme.coverBg : theme.bg).replace('#', '') };

  for (const b of spec.boxes) {
    const color = colorOf(theme, b.color);
    if (b.kind === 'imageSlot') {
      // 占位框：无图时画灰框+提示，不塌陷（本地插图才嵌入）
      s.addShape(pptx.ShapeType.rect, {
        x: b.x, y: b.y, w: b.w, h: b.h,
        line: { color: theme.muted.replace('#', ''), width: 1 },
        fill: { color: 'F2F2F2', transparency: 60 },
      });
      s.addText(sanitizeText(b.imageKey ? '（本地插图）' : '配图占位'), {
        x: b.x, y: b.y + b.h / 2 - 0.3, w: b.w, h: 0.6,
        fontSize: b.fontSize, color, align: 'center', fontFace: theme.fontFamily.split(',')[0].replace(/'/g, ''),
      });
      continue;
    }
    if (!b.text && b.kind !== 'bullets') continue;
    const text = b.kind === 'bullets'
      ? truncateForExport(b.text ?? '')    // B12：导出层截断（≤18 字/条，≤5 条，标记省略）
      : sanitizeText(b.text ?? '');
    s.addText(text, {
      x: b.x, y: b.y, w: b.w, h: b.h,
      fontSize: b.fontSize,
      bold: b.bold ?? false,
      color,
      align: b.align ?? 'left',
      valign: 'middle',
      fontFace: theme.fontFamily.split(',')[0].replace(/'/g, ''),
      lineSpacingMultiple: 1.25,
      isTextBox: true,
    });
  }

  // notesSlide：备注非空页数 = 生成成功页数
  const notes = sanitizeText(slide.notes || '');
  if (notes) s.addNotes(notes);
}

/** Deck → PptxGenJS 实例（供下载或 buffer） */
export function buildPptx(deck: Deck): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'W169', width: 13.33, height: 7.5 });
  pptx.layout = 'W169';
  pptx.title = deck.params?.topic ?? 'Deck';
  const theme = getTheme(deck.theme);
  deck.slides.forEach((slide) => addSlide(pptx, deck, slide, theme));
  return pptx;
}

/** 浏览器：触发下载（Blob 门禁 —— 沙箱内点击即拿到文件） */
export async function exportPptx(deck: Deck, fileName?: string): Promise<void> {
  const pptx = buildPptx(deck);
  const name = fileName ?? `${(deck.params?.topic ?? 'deck').slice(0, 30)}.pptx`;
  await pptx.writeFile({ fileName: name });
}

/** Node/测试：返回 buffer（用于双端打开验证与冒烟） */
export async function exportPptxBuffer(deck: Deck): Promise<Buffer | Uint8Array> {
  const pptx = buildPptx(deck);
  return pptx.write({ outputType: 'nodebuffer' }) as Promise<Buffer>;
}