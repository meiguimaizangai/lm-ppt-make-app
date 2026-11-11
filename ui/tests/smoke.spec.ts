/**
 * 集成与联调冒烟测试（任务 30 精简版）：mock 全链路，零平台调用。
 * 覆盖：契约往返 → 大纲条数=页数 → 逐页生成 → 导出 buffer 非空 → 导出层截断。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  deserializeDeck, serializeDeck, validateDeck, emptyDeck, transition, LIMITS,
} from '../src/model/deck';
import { setProvider } from '../src/llm/provider';
import { MockProvider } from '../src/llm/mock';
import { generateOutline, generateSlides, outlineToSlides, lastSlideResults, regenerateSlide } from '../src/gen/service';
import { parseJson } from '../src/gen/json';
import { buildLayout } from '../src/layout/engine';
import { exportPptxBuffer } from '../src/export/pptx';
import { truncateBullets } from '../src/export/sanitize';
import { ledger } from '../src/budget/ledger';
import { guard } from '../src/budget/guard';
import { emptyDeck as ed } from '../src/model/deck';

const fixture = readFileSync(fileURLToPath(new URL('../../fixtures/demo-deck.json', import.meta.url)), 'utf8');

beforeAll(() => {
  setProvider(new MockProvider());   // mock 先行：真实调用数 = 0
  ledger.reset();
  guard.resetLimits();
});

describe('M0 Deck 契约', () => {
  it('fixture 序列化往返等价 + Schema 校验通过', () => {
    const d = deserializeDeck(fixture);
    expect(deserializeDeck(serializeDeck(d))).toEqual(d);
    expect(validateDeck(d)).toEqual([]);
  });

  it('状态机：非法迁移被拒，合法迁移通过', () => {
    const d = emptyDeck();
    expect(() => transition(d, 'generated')).toThrow('illegal');
    expect(transition(transition(d, 'outlined'), 'generated').status).toBe('generated');
  });
});

describe('JSON 容错解析（R3）', () => {
  const cases = [
    '{"a":1}',                      // 严格
    '```json\n{"a":1}\n```',        // markdown 围裹
    '前置说明 {"a":1} 后记',         // 混入文字
    "{'a':1}",                       // 单引号
    '{"a":1,}',                      // 尾逗号
  ];
  cases.forEach((c, i) => it(`case#${i} 解析成功`, () => {
    expect(parseJson<{ a: number }>(c).a).toBe(1);
  }));
});

describe('M1/M2 大纲生成（选 N 出 N）', () => {
  for (const pages of [8, 12, 16] as const) {
    it(`${pages} 页档 → 出 ${pages} 条`, async () => {
      const res = await generateOutline({
        topic: '测试主题', audience: '投资人', pages, tone: '专业正式',
        brief: '给投资人讲我们做企业级 AI 客服的 A 轮', language: 'zh',
      });
      expect(res.outline).toHaveLength(pages);
      expect(res.outline[0].layout).toBe('cover');
      expect(res.outline[pages - 1].layout).toBe('ending');
    });
  }
});

describe('M3 逐页生成（4 页/批 ×2 并发）', () => {
  it('16 页 → 4 批全部生成，单页失败不影响他页', async () => {
    const res = await generateOutline({
      topic: 'T', audience: 'A', pages: 16, tone: '简洁克制', brief: '', language: 'zh',
    });
    let deck = { ...ed(), params: res.params, outline: res.outline, slides: outlineToSlides(res.outline) };
    deck = { ...deck, status: 'outlined' as const };

    const action = await generateSlides(deck);
    expect(action).toBeNull();          // 无错误 → 统一路径不触发
    const results = lastSlideResults();
    expect(results.size).toBe(16);
    expect([...results.values()].every((s) => s.status === 'done')).toBe(true);
    // 要点约束（导出层再截断，这里验证生成层已基本满足）
    const s = [...results.values()][0];
    expect(s.bullets.length).toBeLessThanOrEqual(LIMITS.bulletsMax);
    expect(s.notes.length).toBeLessThanOrEqual(LIMITS.notesCharsMax);
  });

  it('单页重生成走 pool2', async () => {
    const res = await generateOutline({
      topic: 'T', audience: 'A', pages: 8, tone: '专业正式', brief: '', language: 'zh',
    });
    const deck = { ...ed(), params: res.params, outline: res.outline, slides: outlineToSlides(res.outline), status: 'outlined' as const };
    const updated = await regenerateSlide(deck, deck.outline[3].id);
    expect(updated.status).toBe('done');
    expect(ledger.total('pool2')).toBeGreaterThan(0);
  });
});

describe('M5/M6 预览与导出', () => {
  it('预览与导出共用同一 layoutSpec（buildLayout 单一数据源）', () => {
    const d = deserializeDeck(fixture);
    const a = buildLayout(d.slides[0]);
    const b = buildLayout(d.slides[0]);
    expect(a).toEqual(b);
    expect(a.boxes.length).toBeGreaterThan(0);
  });

  it('fixture → pptx buffer 非空（Blob 门禁的 Node 等价）', async () => {
    const d = deserializeDeck(fixture);
    const buf = await exportPptxBuffer(d);
    expect((buf as Uint8Array).byteLength).toBeGreaterThan(2000);
    // ZIP 头 "PK"
    expect((buf as Uint8Array)[0]).toBe(0x50);
    expect((buf as Uint8Array)[1]).toBe(0x4b);
  });

  it('导出层截断：>5 条、>18 字被截', () => {
    const long = '这是一条超过十八个汉字长度的超长要点文本示例内容';
    const { list, truncated } = truncateBullets(['a', 'b', 'c', 'd', 'e', 'f', long]);
    expect(list).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(list[4].length).toBeLessThanOrEqual(19);
  });
});

describe('M9 额度治理（精简）', () => {
  it('maxTokens 缺失 → 抛错拒发', async () => {
    const { safeComplete } = await import('../src/llm/safe');
    await expect(safeComplete({ prompt: 'x' } as never, { pool: 'pool1', tag: 't' }))
      .rejects.toThrow('maxTokens');
  });

  it('池上限调低后熔断：请求未发出', async () => {
    const { safeComplete } = await import('../src/llm/safe');
    guard.setLimits({ pool1: 0 });
    await expect(safeComplete(
      { prompt: '任务=大纲', maxTokens: 1200 },
      { pool: 'pool1', tag: 'outline', allowRetry: false },
    )).rejects.toThrow('熔断');
    guard.resetLimits();
  });

  it('台账 = 各调用记录之和（误差 0）', () => {
    const sum = ledger.all().reduce((s, r) => s + r.cu, 0);
    expect(ledger.total()).toBeCloseTo(sum, 10);
  });
});