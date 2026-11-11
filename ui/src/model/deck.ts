/**
 * Deck JSON —— 全应用唯一数据契约（方案 §1 原则二：渲染与导出都是它的投影）。
 * 所有生成/编辑/持久化/导出均围绕本结构，序列化往返必须等价（任务 2 判据）。
 */

/** 页数档（B2：三档全保留，选 16 出 16） */
export const PAGE_TIERS = [8, 12, 16] as const;
export type PageTier = (typeof PAGE_TIERS)[number];

/** 语气 / 受众为自由文本 + 常用枚举（缺失默认补齐，不阻塞 —— M1） */
export const TONES = ['专业正式', '简洁克制', '有说服力', '轻松亲和'] as const;
export type Tone = (typeof TONES)[number];

/** 解析+生成参数（M1 的输出） */
export interface GenerationParams {
  topic: string;          // 主题（必填）
  audience: string;       // 受众，如 "投资人"
  pages: PageTier;        // 篇幅档：8 / 12 / 16
  tone: Tone;             // 语气
  scene?: string;         // 场景，如 "路演"（可选，LLM 补齐）
  brief: string;          // 原始 brief 文本（≤1200 字符）
  language: 'zh' | 'en';  // 语言跟随（中文 brief → 全 deck 中文）
}

/** 大纲条目 */
export interface OutlineItem {
  id: string;             // 稳定 id（脏标记、页对齐用）
  title: string;          // 章节标题
  claim?: string;         // 一句话主张（prompt 要求输出）
  layout: LayoutKind;     // 建议版式
}

/** 版式枚举（封面/章节/内容/结尾 四类 → layoutKind 映射） */
export type LayoutKind = 'cover' | 'section' | 'content' | 'ending';
/** 视觉类型建议（仅推荐配图位，不自动触发 —— M3） */
export type VisualKind = '图示' | '数据' | '纯文字';

/** 单页状态：pending=待生成（B13 占位，禁止伪装 AI 产出） */
export type SlideStatus = 'pending' | 'generating' | 'done' | 'failed';

export interface Slide {
  id: string;             // 与 OutlineItem.id 对齐
  index: number;          // 0-based 页码
  title: string;
  bullets: string[];      // ≤5 条，每条 ≤18 字（导出层截断，B12）
  notes: string;          // 演讲备注 ≤120 字
  visual: VisualKind;
  layout: LayoutKind;
  status: SlideStatus;
  imageKey?: string;      // 本地插图只存 key，不存签名 URL（B17）
}

/** 三套主题（任务 19） */
export type ThemeId = 'light-biz' | 'dark-tech' | 'minimal';

export type DeckStatus = 'draft' | 'outlined' | 'generated' | 'exported';

export interface Deck {
  id: string;
  createdAt: string;      // ISO8601
  updatedAt: string;
  status: DeckStatus;
  theme: ThemeId;
  params: GenerationParams | null;
  outline: OutlineItem[];
  slides: Slide[];
  /** 脏页 id 集合（改一条不触发全量重生成 —— L71） */
  dirty: string[];
}

/* ---------------- 状态机（任务 7：非法迁移被拒） ---------------- */

const TRANSITIONS: Record<DeckStatus, DeckStatus[]> = {
  draft: ['outlined'],
  outlined: ['generated', 'draft'],       // 回退到 draft = 清空大纲
  generated: ['outlined', 'exported'],    // 编辑大纲退回 outlined
  exported: ['generated', 'outlined'],    // 导出后继续编辑
};

export class IllegalTransitionError extends Error {
  constructor(from: DeckStatus, to: DeckStatus) {
    super(`illegal deck transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: DeckStatus, to: DeckStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(deck: Deck, to: DeckStatus): Deck {
  if (!canTransition(deck.status, to)) throw new IllegalTransitionError(deck.status, to);
  return { ...deck, status: to, updatedAt: new Date().toISOString() };
}

/* ---------------- 构造 / 序列化 ---------------- */

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** 空 deck（M1 表单之前） */
export function emptyDeck(): Deck {
  const now = new Date().toISOString();
  return {
    id: newId('deck'),
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    theme: 'light-biz',
    params: null,
    outline: [],
    slides: [],
    dirty: [],
  };
}

/** 长度约束（B12 / R10）：导出层执行，生成层提示 */
export const LIMITS = {
  briefMax: 1200,       // 待确认阈值，暂用 1200 字符
  outlineMax: 16,       // 增到 17 被拒
  outlineMin: 1,        // 删到 1 仍可导出
  bulletsMax: 5,
  bulletCharsMax: 18,
  notesCharsMax: 120,
} as const;

/** 序列化往返等价（fixture 验收）：JSON.stringify → parse 后深等价 */
export function serializeDeck(deck: Deck): string {
  return JSON.stringify(deck);
}
export function deserializeDeck(json: string): Deck {
  const d = JSON.parse(json) as Deck;
  if (!d || typeof d.id !== 'string' || !Array.isArray(d.slides)) {
    throw new Error('invalid deck json');
  }
  return d;
}

/** Schema 校验（R3 严格校验的本地部分）：返回错误列表，空 = 通过 */
export function validateDeck(d: Deck): string[] {
  const errs: string[] = [];
  if (!d.id) errs.push('missing id');
  if (d.params && !PAGE_TIERS.includes(d.params.pages)) errs.push('pages not in 8/12/16');
  if (d.outline.length !== d.slides.length && d.slides.length > 0) {
    errs.push(`outline(${d.outline.length}) != slides(${d.slides.length})`);
  }
  d.slides.forEach((s, i) => {
    if (s.index !== i) errs.push(`slide ${i} index mismatch`);
    if (s.bullets.length > LIMITS.bulletsMax) errs.push(`slide ${i}: bullets > 5`);
    if (s.status !== 'pending' && !s.title) errs.push(`slide ${i}: empty title`);
  });
  return errs;
}