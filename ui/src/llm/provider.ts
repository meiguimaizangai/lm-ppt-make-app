/**
 * LLM provider 注入点（任务 8，R1 mock 先行）：
 * 业务代码只依赖 `LLMProvider` 接口；开发/测试用 mock（零额度），
 * 真实平台适配器由 `LLM_PROVIDER=real` 环境切换。
 */

export interface LlmRequest {
  prompt: string;
  system?: string;
  maxTokens: number;        // 必填：SafeLLM 强制
  timeoutMs?: number;
  /** 轻量回执信息（预估器校准用） */
  tag?: string;
}

export interface QuotaReceipt {
  /** 实际消耗（CU），来自平台回执 _meta.quotaConsumed；mock 返回估算值 */
  quotaConsumed: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmResponse {
  text: string;
  finishReason: 'stop' | 'length' | 'unknown';
  receipt: QuotaReceipt;
  /** 供台账归池 */
  tag?: string;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** 大纲流式退路（默认关，本方案用不到） */
  stream?(req: LlmRequest, onChunk: (t: string) => void): Promise<LlmResponse>;
  /** 单价标定（任务 5：读目录，≤1 CU） */
  catalog?(): Promise<{ cuPer1kTokens: number }>;
}

let current: LLMProvider | null = null;

export function setProvider(p: LLMProvider): void { current = p; }
export function getProvider(): LLMProvider {
  if (!current) throw new Error('LLM provider not injected (call setProvider first)');
  return current;
}