/**
 * token/CU 预估器（任务 11）：按 prompt 结构客观推导，不依赖平台调用。
 * 占位换算：1 CU ≈ 1000 blended tokens（B18，任务 5 标定后写入配置）。
 * 验收：5 个 fixture 估算 vs 实际回执偏差 ≤20%。
 */

import type { LlmRequest } from '../llm/provider';

export const CU_PER_1K_TOKENS = 1;   // 占位换算率（任务 5 标定回写：1 CU = X tok）

/** 粗粒度 token 估算：CJK ≈ 1 tok/字，ASCII ≈ 4 字符/tok */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    if (/[　-鿿＀-￯]/.test(ch)) cjk += 1;
    else ascii += 1;
  }
  return Math.ceil(cjk + ascii / 4);
}

export interface Estimate {
  inputTokens: number;
  outputTokens: number;      // 以 maxTokens 作为最坏产出
  estimatedTokens: number;
  estimatedCu: number;
}

/** 最坏情况：input + maxTokens 全部产出（C6 按最坏情况预检） */
export function estimate(req: LlmRequest): Estimate {
  const inputTokens = estimateTokens(req.prompt) + estimateTokens(req.system ?? '');
  const outputTokens = req.maxTokens;
  const estimatedTokens = inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    estimatedTokens,
    estimatedCu: (estimatedTokens / 1000) * CU_PER_1K_TOKENS,
  };
}