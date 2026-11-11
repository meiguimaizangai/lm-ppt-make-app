/**
 * M11 外置配置层（任务 9）：页数档/批大小/并发/三层池阈值/prompt 版本/`image.enabled`
 * 全部移出代码，改配置即生效（对抗 C4）；非法值回退默认；缺失不崩，
 * `image.enabled` 缺失时默认 false（§9.3 配置硬关）。
 *
 * 存储由注入的 StorageLike 提供（平台 storage.* 或开发期 localStorage/内存）。
 */

import type { PageTier } from '../model/deck';

export interface StorageLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface RuntimeConfig {
  pageTiers: PageTier[];        // 允许的页数档（删 16 页档 = 改配置，零工时）
  batchSize: number;            // 4 页/批（B1②）
  concurrency: number;          // 2 路并发
  // 三层池（C-13）：池1 生成链路、池2 编辑重生成、池3 配图（单列不计入 S2）
  pool1LimitCu: number;
  pool2LimitCu: number;
  pool3LimitCu: number;         // 保守单价下默认 0（锁死）
  promptVersion: string;
  imageEnabled: boolean;        // 默认 false（C-16）
  llmTimeoutMs: number;         // 20s [待确认]
  outlineStreamEnabled: boolean; // 大纲流式退路，默认关
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  pageTiers: [8, 12, 16],
  batchSize: 4,
  concurrency: 2,
  pool1LimitCu: 20,
  pool2LimitCu: 6.3,   // 8 页档预留下限；实际按档位覆盖（见 configPerTier）
  pool3LimitCu: 0,
  promptVersion: 'v0.2',
  imageEnabled: false,
  llmTimeoutMs: 20_000,
  outlineStreamEnabled: false,
};

/** 三档池2 预留（§8.1：11.1 / 7.0 / 3.6 为上限，实际预留 6.3 / 4.5 / 2.9） */
export const POOL2_RESERVED: Record<PageTier, number> = { 8: 6.3, 12: 4.5, 16: 2.9 };

const CONFIG_KEY = 'deckcopilot:config';

function num(v: unknown, fallback: number, min = 0): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** 合并 + 校验：非法值回退默认，`imageEnabled` 缺失/非布尔 → false */
export function normalizeConfig(raw: Partial<RuntimeConfig> | null | undefined): RuntimeConfig {
  const r = (raw ?? {}) as Partial<RuntimeConfig>;
  return {
    pageTiers: Array.isArray(r.pageTiers) && r.pageTiers.length > 0
      ? r.pageTiers.filter((t) => [8, 12, 16].includes(t))
      : DEFAULT_CONFIG.pageTiers,
    batchSize: num(r.batchSize, DEFAULT_CONFIG.batchSize, 1),
    concurrency: num(r.concurrency, DEFAULT_CONFIG.concurrency, 1),
    pool1LimitCu: num(r.pool1LimitCu, DEFAULT_CONFIG.pool1LimitCu),
    pool2LimitCu: num(r.pool2LimitCu, DEFAULT_CONFIG.pool2LimitCu),
    pool3LimitCu: num(r.pool3LimitCu, DEFAULT_CONFIG.pool3LimitCu),
    promptVersion: typeof r.promptVersion === 'string' ? r.promptVersion : DEFAULT_CONFIG.promptVersion,
    imageEnabled: r.imageEnabled === true,   // 仅显式 true 才开（安全默认）
    llmTimeoutMs: num(r.llmTimeoutMs, DEFAULT_CONFIG.llmTimeoutMs, 1000),
    outlineStreamEnabled: r.outlineStreamEnabled === true,
  };
}

export const configStore: { current: RuntimeConfig } = { current: { ...DEFAULT_CONFIG } };

/** 从存储加载（缺失/损坏 → 安全默认，App 不崩） */
export async function loadConfig(storage?: StorageLike): Promise<RuntimeConfig> {
  if (storage) {
    try {
      const s = await storage.get(CONFIG_KEY);
      if (s) configStore.current = normalizeConfig(JSON.parse(s));
    } catch {
      configStore.current = { ...DEFAULT_CONFIG };
    }
  }
  return configStore.current;
}

/** 改配置写回（不发版即生效） */
export async function saveConfig(patch: Partial<RuntimeConfig>, storage?: StorageLike): Promise<RuntimeConfig> {
  configStore.current = normalizeConfig({ ...configStore.current, ...patch });
  if (storage) await storage.set(CONFIG_KEY, JSON.stringify(configStore.current));
  return configStore.current;
}

export function getConfig(): RuntimeConfig {
  return configStore.current;
}