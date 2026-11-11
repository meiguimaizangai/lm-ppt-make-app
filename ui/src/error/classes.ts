/**
 * 错误统一处理（C-15 / 用户裁决）：
 * 5 类错误不再各配专属动作，**一律走同一条自动指定路径**：
 *   停止当前调用 → 保留已生成页 → 失败页占位 → 一句可操作文案 → 提供“重试 1 次”。
 * `error.code` 仅记入台账供事后分析，不在 UI 分支。
 */

export type ErrorDomain =
  | 'network'       // 网络/超时
  | 'quota'         // APP_QUOTA_EXCEEDED / 池熔断
  | 'parse'         // LLM 返回非法 JSON
  | 'platform'      // 平台 API 错误（错误码语义待确认）
  | 'unknown';

export class AppError extends Error {
  readonly domain: ErrorDomain;
  readonly code: string;      // 入台账（quota-log），不用于 UI 分支
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(domain: ErrorDomain, code: string, message: string, retryable = true, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.domain = domain;
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
}

export class MaxTokensMissingError extends AppError {
  constructor() {
    super('platform', 'MAXTOKENS_MISSING', 'SafeLLM: maxTokens 必须显式传入，已拒发');
    this.name = 'MaxTokensMissingError';
  }
}

export class LlmTimeoutError extends AppError {
  constructor(ms: number) {
    super('network', 'LLM_TIMEOUT', `LLM 调用超过 ${ms}ms 超时`);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmParseError extends AppError {
  constructor(detail: string) {
    super('parse', 'LLM_BAD_JSON', `LLM 返回解析失败：${detail}`);
    this.name = 'LlmParseError';
  }
}

export class QuotaExceededError extends AppError {
  readonly pool: string;
  constructor(pool: string, message: string) {
    super('quota', 'APP_QUOTA_EXCEEDED', message, false);
    this.name = 'QuotaExceededError';
    this.pool = pool;
  }
}

/**
 * 统一处理路径（四态之一“失败/额度不足”共用）：返回给 UI 的单一下一步动作。
 * UI 不再按 error.code 分支，只渲染 action 文案。
 */
export interface UnifiedAction {
  keepGenerated: true;                 // 保留已生成页
  placeholderFailedPages: true;        // 失败页置为占位（status=failed）
  message: string;                     // 一句可操作文案
  offerRetry: boolean;                 // 重试 1 次（全局重试预算内）
}

export function unifiedHandle(err: unknown, opts: { generated: number; total: number }): UnifiedAction {
  const e = err instanceof AppError ? err : null;
  const quota = e?.code === 'APP_QUOTA_EXCEEDED';
  const msg = quota
    ? `额度不足：已生成 ${opts.generated}/${opts.total} 页，可导出部分稿，或稍后再试。`
    : `生成中断：已生成 ${opts.generated}/${opts.total} 页，失败页已标记“待生成”，可点“重试 1 次”或手工编辑。`;
  return {
    keepGenerated: true,
    placeholderFailedPages: true,
    message: msg,
    offerRetry: e ? e.retryable : true,
  };
}