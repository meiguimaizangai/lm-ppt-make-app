/**
 * SafeLLM（任务 10 / M9）：
 * - maxTokens 显式强制（未传 → 抛错拒发）；
 * - 超时（默认 20s，可配置）；
 * - 全局重试 1 次（B7 / C-5，覆盖 L115 的“2 次”）；
 * - 每次调用前经 Guard 熔断预检（最坏情况，C6 —— 请求未发出即被拦）；
 * - 每次调用回执写入三层池台账（实测优先，缺失回退估算，口径一致保证误差 0）。
 */

import { getProvider, type LlmRequest, type LlmResponse } from './provider';
import { AppError, LlmTimeoutError, MaxTokensMissingError } from '../error/classes';
import { getConfig } from '../config/runtime';
import { estimate } from '../budget/estimator';
import { ledger, type PoolId } from '../budget/ledger';
import { guard } from '../budget/guard';

export interface SafeCallOptions {
  pool: PoolId;               // 归池：pool1 | pool2 | pool3
  tag: string;                // 台账 tag：outline / slides / regen ...
  allowRetry?: boolean;       // 默认允许全局 1 次重试
  retryReserveCu?: number;    // 重试预留（默认 1.1，§8.2）
}

/** 以 req 对象为幂等键：同一请求最多重试 1 次 */
const RETRY_USED = new WeakSet<object>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new LlmTimeoutError(ms)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function once(req: LlmRequest): Promise<LlmResponse> {
  const cfg = getConfig();
  return withTimeout(getProvider().complete(req), req.timeoutMs ?? cfg.llmTimeoutMs);
}

/** SafeLLM 唯一入口 */
export async function safeComplete(req: LlmRequest, opts: SafeCallOptions): Promise<LlmResponse> {
  // 判据：未传 / 非法 maxTokens → 直接抛错拒发（请求不发出）
  if (typeof req.maxTokens !== 'number' || req.maxTokens <= 0 || Number.isNaN(req.maxTokens)) {
    throw new MaxTokensMissingError();
  }

  const est = estimate(req);
  const retryReserve = opts.retryReserveCu ?? 1.1;

  let lastErr: unknown;
  const maxAttempts = opts.allowRetry === false ? 1 : 2;   // 首次 + 全局 1 次

  for (let i = 0; i < maxAttempts; i++) {
    // C6 最坏情况预检（含重试预留）：超限 → 请求未发出即被拦
    guard.check(opts.pool, est.estimatedCu + (i > 0 ? retryReserve : 0), opts.tag);
    if (i > 0 && RETRY_USED.has(req)) break;               // 同一请求只重试 1 次
    try {
      const resp = await once(req);
      ledger.record({
        pool: opts.pool,
        tag: i > 0 ? `${opts.tag}#retry` : opts.tag,
        cu: Number.isFinite(resp.receipt?.quotaConsumed) ? resp.receipt.quotaConsumed : est.estimatedCu,
        estimatedCu: est.estimatedCu,
        at: new Date().toISOString(),
        errorCode: null,
      });
      return resp;
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string })?.code ?? (e as Error)?.name ?? 'UNKNOWN';
      // 失败也入台账（error.code 仅入台账供事后分析，UI 不分支 —— C-15）
      ledger.record({
        pool: opts.pool, tag: `${opts.tag}#error`, cu: 0, estimatedCu: est.estimatedCu,
        at: new Date().toISOString(), errorCode: code,
      });
      // 统一路径：配额错误不重试（重试只会再次失败）；其余可重试 1 次
      const quota = code === 'APP_QUOTA_EXCEEDED' || e instanceof AppError && e.code === 'APP_QUOTA_EXCEEDED';
      if (quota) break;
      RETRY_USED.add(req);
      if (i + 1 >= maxAttempts) break;
    }
  }
  throw lastErr;
}