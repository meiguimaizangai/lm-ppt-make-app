/**
 * 三层池台账（任务 11 / M9，C-13）：
 * - 池1 生成链路、池2 编辑重生成、池3 配图，独立计数不串用；
 * - 合计 = 各调用记录之和（误差 0）；
 * - 可导出 quota-log.csv（按池分列，交付物 S2/S3）。
 */

export type PoolId = 'pool1' | 'pool2' | 'pool3';

export interface LedgerRow {
  pool: PoolId;
  tag: string;          // outline / slides / regen / retry / error...
  cu: number;           // 实测（回执）或估算消耗
  estimatedCu: number;  // 发送前预估
  at: string;           // ISO
  errorCode: string | null;
}

class Ledger {
  private rows: LedgerRow[] = [];

  record(row: LedgerRow): void {
    this.rows.push(row);
  }

  all(): readonly LedgerRow[] { return this.rows; }

  /** 按池合计（池间不串用） */
  total(pool?: PoolId): number {
    return this.rows
      .filter((r) => (pool ? r.pool === pool : true))
      .reduce((s, r) => s + r.cu, 0);
  }

  /** 池1+池2 合计 = S2 判定口径（≤20 CU）；池3 单列 */
  s2Usage(): number { return this.total('pool1') + this.total('pool2'); }

  errorCodes(): string[] {
    return this.rows.filter((r) => r.errorCode).map((r) => `${r.tag}:${r.errorCode}`);
  }

  /** 导出 CSV（表头 + 记录，UTF-8 BOM 便于 Excel 打开） */
  toCsv(): string {
    const head = 'pool,tag,cu,estimated_cu,at,error_code';
    const body = this.rows.map((r) =>
      [r.pool, r.tag, r.cu.toFixed(4), r.estimatedCu.toFixed(4), r.at, r.errorCode ?? ''].join(','),
    );
    return '\uFEFF' + [head, ...body].join('\n');
  }

  reset(): void { this.rows = []; }
}

export const ledger = new Ledger();