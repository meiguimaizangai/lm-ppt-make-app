/**
 * 真实平台适配器（任务 5 链路）：`LLM_PROVIDER=real` 时注入。
 * 平台注入全局 `anna.llm.complete / anna.llm.stream / anna.llm.catalog`（按 manifest 声明）。
 * - `complete` 回执中读 `_meta.quotaConsumed` 供台账；
 * - 未注入平台 API 时抛出明确错误（绝不静默 fallback 到 mock，防零额度假通过）。
 */

import type { LLMProvider, LlmRequest, LlmResponse } from './provider';

interface PlatformReceipt {
  _meta?: { quotaConsumed?: number; inputTokens?: number; outputTokens?: number };
}

type PlatformLLM = {
  complete(args: { prompt: string; system?: string; maxTokens: number; timeoutMs?: number }):
    Promise<{ text: string; finishReason?: string } & PlatformReceipt>;
  stream?: unknown;
  catalog?: () => Promise<{ cuPer1kTokens?: number }>;
};

function platform(): PlatformLLM {
  const g = globalThis as unknown as { anna?: { llm?: PlatformLLM } };
  const llm = g.anna?.llm;
  if (!llm?.complete) throw new Error('platform llm API not available (anna.llm.complete missing)');
  return llm;
}

export class RealProvider implements LLMProvider {
  readonly name = 'real';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const p = platform();
    const r = await p.complete({
      prompt: req.prompt,
      system: req.system,
      maxTokens: req.maxTokens,      // SafeLLM 已强制
      timeoutMs: req.timeoutMs,
    });
    return {
      text: r.text ?? '',
      finishReason: r.finishReason === 'length' ? 'length' : r.finishReason === 'stop' ? 'stop' : 'unknown',
      receipt: {
        quotaConsumed: r._meta?.quotaConsumed ?? NaN,  // NaN → SafeLLM 回退估算
        inputTokens: r._meta?.inputTokens,
        outputTokens: r._meta?.outputTokens,
      },
      tag: req.tag,
    };
  }

  async catalog() {
    const p = platform();
    if (!p.catalog) throw new Error('anna.llm.catalog not available');
    const c = await p.catalog();
    return { cuPer1kTokens: c.cuPer1kTokens ?? 1 };
  }
}