/**
 * Mock provider（任务 8）：让全链路（含导出）零平台调用跑通。
 * 行为：识别 prompt 中的任务标记（outline / slides / parse），返回合法 JSON；
 * 可注入延迟与故障（fault='badjson' | 'timeout' | 'fail:CODE'）用于异常路径测试。
 */

import type { LLMProvider, LlmRequest, LlmResponse } from './provider';

export interface MockOptions {
  latencyMs?: number;
  fault?: 'badjson' | 'length' | 'fail:APP_QUOTA_EXCEEDED' | 'fail:NETWORK';
  /** 覆盖返回内容（精确控制 fixture） */
  responder?: (req: LlmRequest) => string;
}

/** 从 prompt 提取页数（prompt 中含 "页数=N"） */
function extractPages(prompt: string, fallback = 12): number {
  const m = /页数=(\d+)/.exec(prompt);
  return m ? Number(m[1]) : fallback;
}

function extractPageTitles(prompt: string): string[] {
  // 逐页批 prompt 中携带大纲（"- 1. 标题"），最多取 4 行
  const lines = prompt.split('\n').filter((l) => /^\s*-\s*\d+\.\s*/.test(l));
  return lines.slice(0, 4).map((l) => l.replace(/^\s*-\s*\d+\.\s*/, '').trim());
}

function outlineResponse(prompt: string): string {
  const n = extractPages(prompt);
  const items = Array.from({ length: n }, (_, i) => ({
    title: `第 ${i + 1} 章节`,
    claim: `这是第 ${i + 1} 页的核心主张。`,
    layout: i === 0 ? 'cover' : i === n - 1 ? 'ending' : 'content',
  }));
  return JSON.stringify({
    params: { audience: '默认受众', scene: '通用', tone: '专业正式' },
    outline: items,
  });
}

function slidesResponse(prompt: string): string {
  const titles = extractPageTitles(prompt);
  const slides = (titles.length ? titles : ['占位页']).map((t, i) => ({
    title: t,
    bullets: [`要点一（${t}）`, '要点二', '要点三'],
    notes: '这是一段 mock 演讲备注，不超过 120 字。',
    visual: i % 2 === 0 ? '纯文字' : '图示',
  }));
  return JSON.stringify({ slides });
}

export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly calls: LlmRequest[] = [];   // 断言“真实调用数=0”时看注入了谁，而不是 calls
  private opts: MockOptions;

  constructor(opts: MockOptions = {}) {
    this.opts = opts;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));

    if (this.opts.fault === 'fail:NETWORK') {
      throw new Error('mock network error');
    }
    if (this.opts.fault === 'fail:APP_QUOTA_EXCEEDED') {
      const e = new Error('APP_QUOTA_EXCEEDED') as Error & { code?: string };
      e.code = 'APP_QUOTA_EXCEEDED';
      throw e;
    }

    let text = this.opts.responder
      ? this.opts.responder(req)
      : /任务=大纲/.test(req.prompt)
        ? outlineResponse(req.prompt)
        : slidesResponse(req.prompt);

    if (this.opts.fault === 'badjson') text = '这不是 JSON {{{';

    const finish: LlmResponse['finishReason'] = this.opts.fault === 'length' ? 'length' : 'stop';
    const outputTokens = Math.ceil(text.length / 2); // 粗估（CJK 约 2 字符/token）
    return {
      text,
      finishReason: finish,
      // mock 计费按估算口径：1 CU ≈ 1000 blended tokens（占位换算）
      receipt: { quotaConsumed: (req.maxTokens + outputTokens) / 1000, outputTokens, inputTokens: Math.ceil(req.prompt.length / 2) },
      tag: req.tag,
    };
  }

  async catalog() {
    return { cuPer1kTokens: 1 }; // 占位：1 CU ≈ 1000 tok（B18 待标定）
  }
}