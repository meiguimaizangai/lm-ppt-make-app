/**
 * provider 启动注入（任务 8）：
 * - `LLM_PROVIDER=real` → 平台适配器；
 * - 默认 / `mock` → MockProvider（R1 mock 先行，零额度）。
 * Vite 构建时 `import.meta.env.VITE_LLM_PROVIDER` 同样生效。
 */

import { setProvider, type LLMProvider } from './provider';
import { MockProvider, type MockOptions } from './mock';
import { RealProvider } from './real';

function resolveMode(): 'mock' | 'real' {
  const env = (import.meta as { env?: Record<string, string> }).env ?? {};
  const mode = env.VITE_LLM_PROVIDER ?? (typeof process !== 'undefined' ? process.env?.LLM_PROVIDER : undefined);
  return mode === 'real' ? 'real' : 'mock';
}

export function bootstrapProvider(mockOpts: MockOptions = {}): LLMProvider {
  const p: LLMProvider = resolveMode() === 'real' ? new RealProvider() : new MockProvider(mockOpts);
  setProvider(p);
  return p;
}