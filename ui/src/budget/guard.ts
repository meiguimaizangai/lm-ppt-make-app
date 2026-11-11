/**
 * 三层池熔断（任务 11 / C6 最坏情况预检）：
 * 调低池上限后发起生成 → **请求未发出即被拦**（SafeLLM 先 check 后调用）。
 * 16 页档池2 硬锁 2.9 CU（§8.1）：该档用于单页重生成 + 重试预留。
 */

import { QuotaExceededError } from '../error/classes';
import { ledger, type PoolId } from './ledger';
import { getConfig } from '../config/runtime';
import type { PageTier } from '../model/deck';

export interface GuardLimits {
  pool1: number;
  pool2: number;
  pool3: number;
}

export class BudgetGuard {
  private overrides: Partial<GuardLimits> = {};

  /** 运行时覆盖上限（测试/配置层使用：调低后立即生效） */
  setLimits(patch: Partial<GuardLimits>): void {
    this.overrides = { ...this.overrides, ...patch };
  }
  resetLimits(): void { this.overrides = {}; }

  /** 当前上限：覆盖值 > 配置值 */
  limits(): GuardLimits {
    const cfg = getConfig();
    return {
      pool1: this.overrides.pool1 ?? cfg.pool1LimitCu,
      pool2: this.overrides.pool2 ?? cfg.pool2LimitCu,
      pool3: this.overrides.pool3 ?? cfg.pool3LimitCu,
    };
  }

  /**
   * 发送前预检（最坏情况：本次预估 CU 直接计入池）。
   * 超限 → 抛 QuotaExceededError（请求不发出，网络日志零调用）。
   */
  check(pool: PoolId, estimatedCu: number, tag = ''): void {
    const { pool1, pool2, pool3 } = this.limits();
    const limit = pool === 'pool1' ? pool1 : pool === 'pool2' ? pool2 : pool3;
    const used = ledger.total(pool);
    if (used + estimatedCu > limit) {
      throw new QuotaExceededError(
        pool,
        `池${pool.slice(-1)}熔断：已用 ${used.toFixed(2)} + 预估 ${estimatedCu.toFixed(2)} > 上限 ${limit} CU（${tag}）`,
      );
    }
  }

  /** 16 页档池2 硬锁（M3 判据：用尽后单页重生成置灰） */
  pool2ForTier(tier: PageTier): number {
    const { pool2Reserved } = { pool2Reserved: { 8: 6.3, 12: 4.5, 16: 2.9 } as const };
    return Math.min(this.limits().pool2, pool2Reserved[tier]);
  }

  /** 池2 剩余（UI 决定是否置灰） */
  pool2Remaining(tier: PageTier): number {
    return Math.max(0, this.pool2ForTier(tier) - ledger.total('pool2'));
  }
}

export const guard = new BudgetGuard();
export type { PoolId };