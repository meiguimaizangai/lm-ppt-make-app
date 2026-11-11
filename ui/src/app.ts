/**
 * 单页应用（精简版主流程）：
 *   Brief 表单 → 大纲生成/编辑(改/增删/上移下移+脏标记) → 逐页生成(mock) → 预览 → 导出 .pptx
 * 纯 DOM 实现，无框架依赖；状态经 store 订阅刷新。
 */

import { createStore } from './state/store';
import {
  emptyDeck, LIMITS, PAGE_TIERS, TONES, transition,
  type Deck, type GenerationParams, type PageTier, type Tone, type Slide,
} from './model/deck';
import { bootstrapProvider } from './llm/bootstrap';
import { generateOutline, generateSlides, outlineToSlides, lastSlideResults, regenerateSlide } from './gen/service';
import { buildLayout } from './layout/engine';
import { THEMES, getTheme } from './theme/themes';
import { exportPptx } from './export/pptx';
import { guard } from './budget/guard';
import { ledger } from './budget/ledger';
import { unifiedHandle } from './error/classes';

type Phase = 'brief' | 'outline' | 'slides';

interface AppState {
  deck: Deck;
  phase: Phase;
  busy: boolean;
  message: string;      // 统一四态文案（生成中/失败/额度不足…）
}

const store = createStore<AppState>({
  deck: emptyDeck(), phase: 'brief', busy: false, message: '',
});

bootstrapProvider();   // 默认 mock：零额度跑全链路

/* ---------------- helpers ---------------- */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

function markDirty(deck: Deck, id: string): Deck {
  return deck.dirty.includes(id) ? deck : { ...deck, dirty: [...deck.dirty, id] };
}

/* ---------------- views ---------------- */

function renderBrief(root: HTMLElement, s: AppState): void {
  root.appendChild(el('h2', 'h', '① 一句话 Brief'));
  const topic = el('input') as HTMLInputElement;
  topic.placeholder = '主题（必填）例：企业级 AI 客服 A 轮路演';
  topic.value = s.deck.params?.topic ?? '';

  const brief = el('textarea') as HTMLTextAreaElement;
  brief.placeholder = `补充说明（≤${LIMITS.briefMax} 字符，可留空走默认）`;
  brief.value = s.deck.params?.brief ?? '';

  const counter = el('div', 'hint');
  const syncCounter = () => {
    const over = brief.value.length > LIMITS.briefMax;
    counter.textContent = `${brief.value.length}/${LIMITS.briefMax}${over ? ' — 超长，请删减' : ''}`;
    counter.classList.toggle('err', over);
  };
  brief.addEventListener('input', syncCounter);

  const row = el('div', 'row');
  const audience = el('input') as HTMLInputElement;
  audience.placeholder = '受众（默认：通用）';
  audience.value = s.deck.params?.audience ?? '';

  const tierSel = el('select') as HTMLSelectElement;
  PAGE_TIERS.forEach((t) => {
    const o = el('option', '', `${t} 页`) as HTMLOptionElement;
    o.value = String(t);
    tierSel.appendChild(o);
  });
  tierSel.value = String(s.deck.params?.pages ?? 12);   // 默认 12；三档全开（16 档不禁用）

  const toneSel = el('select') as HTMLSelectElement;
  TONES.forEach((t) => {
    const o = el('option', '', t) as HTMLOptionElement;
    o.value = t;
    toneSel.appendChild(o);
  });
  toneSel.value = s.deck.params?.tone ?? TONES[0];

  const btn = el('button', 'primary', s.busy ? '生成中…' : '生成大纲');
  btn.disabled = s.busy;
  btn.onclick = async () => {
    if (!topic.value.trim()) { store.update((x) => ({ ...x, message: '请先填写主题' })); return; }
    if (brief.value.length > LIMITS.briefMax) { store.update((x) => ({ ...x, message: `Brief 超 ${LIMITS.briefMax} 字符` })); return; }
    const params: GenerationParams = {
      topic: topic.value.trim(),
      audience: audience.value.trim() || '通用',
      pages: Number(tierSel.value) as PageTier,
      tone: toneSel.value as Tone,
      brief: brief.value,
      language: /[a-zA-Z]{4}/.test(brief.value) && !/[一-鿿]/.test(brief.value) ? 'en' : 'zh',
    };
    store.update((x) => ({ ...x, busy: true, message: '解析中…', deck: { ...x.deck, params } }));
    try {
      const res = await generateOutline(params);
      let deck: Deck = { ...s.deck, params: res.params, outline: res.outline, slides: outlineToSlides(res.outline), dirty: [] };
      deck = transition({ ...deck, status: 'draft' }, 'outlined');
      store.update((x) => ({
        ...x, busy: false, phase: 'outline', deck,
        message: res.clamped ? `大纲已超过 16 页，已裁到 ${deck.outline.length} 页` : `大纲已生成：${deck.outline.length} 页`,
      }));
    } catch (e) {
      const a = unifiedHandle(e, { generated: 0, total: Number(tierSel.value) });
      store.update((x) => ({ ...x, busy: false, message: `${a.message}（${(e as Error).name}）` }));
    }
  };

  root.append(topic, brief, counter, row, btn);
  row.append(audience, tierSel, toneSel);
  syncCounter();
}

function renderOutline(root: HTMLElement, s: AppState): void {
  const deck = s.deck;
  root.appendChild(el('h2', 'h', `② 大纲（${deck.outline.length} 页）— 改标题/增删/上下移`));

  const meta = el('div', 'hint', `页数档 ${deck.params?.pages} · 语言 ${deck.params?.language === 'en' ? 'EN' : '中文'} · 脏页 ${deck.dirty.length}（仅重算脏页）`);
  root.appendChild(meta);

  const list = el('div', 'olist');
  deck.outline.forEach((o, i) => {
    const row = el('div', 'orow');
    const input = el('input') as HTMLInputElement;
    input.value = o.title;
    input.onchange = () => {
      if (input.value === o.title) return;
      // L71：改一条不触发全量重生成 → 只标记脏页
      store.update((x) => ({
        ...x,
        deck: markDirty({ ...x.deck, outline: x.deck.outline.map((it) => it.id === o.id ? { ...it, title: input.value } : it) }, o.id),
        message: `已改第 ${i + 1} 页标题（已标脏，稍后仅重算该页）`,
      }));
    };

    const mk = (label: string, disabled: boolean, fn: () => void) => {
      const b = el('button', 'mini', label) as HTMLButtonElement;
      b.disabled = disabled;
      b.onclick = fn;
      return b;
    };
    const up = mk('↑', i === 0, () => move(i, -1));
    const down = mk('↓', i === deck.outline.length - 1, () => move(i, 1));   // 首末项按钮置灰
    const del = mk('✕', deck.outline.length <= LIMITS.outlineMin, () => {
      store.update((x) => {
        const outline = x.deck.outline.filter((it) => it.id !== o.id);
        return { ...x, deck: { ...x.deck, outline, slides: x.deck.slides.filter((sl) => sl.id !== o.id) }, message: `已删 1 页，现 ${outline.length} 页` };
      });
    });

    row.append(up, down, input, del);
    list.appendChild(row);
  });

  function move(i: number, dir: number): void {
    store.update((x) => {
      const arr = [...x.deck.outline];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return x;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...x, deck: { ...x.deck, outline: arr }, message: `已重排（第 ${i + 1} 页 ↔ 第 ${j + 1} 页）` };
    });
  }

  const actions = el('div', 'row');
  const addBtn = el('button', 'mini', '+ 加一页');
  addBtn.disabled = deck.outline.length >= LIMITS.outlineMax;   // 增到 17 被拒
  addBtn.onclick = () => store.update((x) => {
    if (x.deck.outline.length >= LIMITS.outlineMax) return { ...x, message: `最多 ${LIMITS.outlineMax} 页` };
    const id = `manual_${Date.now().toString(36)}`;
    return {
      ...x,
      deck: { ...x.deck, outline: [...x.deck.outline, { id, title: '新页面', claim: '', layout: 'content' }], dirty: [...x.deck.dirty, id] },
      message: '已加 1 页（标脏）',
    };
  });

  const genAll = el('button', 'primary', s.busy ? '生成中…' : `生成全部内容（${deck.outline.length} 页）`);
  genAll.disabled = s.busy;
  genAll.onclick = () => void runGenerate(deck.dirty.length ? deck.dirty : undefined);

  const genDirty = el('button', 'mini', `仅重算脏页（${deck.dirty.length}）`);
  genDirty.disabled = s.busy || deck.dirty.length === 0;
  genDirty.onclick = () => void runGenerate([...deck.dirty]);

  actions.append(addBtn, genDirty, genAll);
  root.append(list, actions);
}

/** 逐页生成（4 页/批 ×2 并发，经 SafeLLM/mock），增量回填 + 统一错误路径 */
async function runGenerate(onlyIds?: string[]): Promise<void> {
  store.update((x) => ({ ...x, busy: true, message: '逐页生成中…（每批返回即刷新）' }));
  const snapshot = store.get().deck;
  try {
    const action = await generateSlides(snapshot, {
      onlyIds,
      onBatch: (done) => {
        // 每批返回即增量渲染（L79）
        store.update((x) => mergeResults(x, done));
      },
    });
    store.update((x) => {
      const merged = mergeResults(x, [...lastSlideResults().values()]);
      const deck: Deck = { ...merged.deck, dirty: [], status: 'generated' };
      return {
        ...merged, busy: false, phase: 'slides', deck,
        message: action ? action.message : `生成完成：${deck.slides.filter((sl) => sl.status === 'done').length}/${deck.outline.length} 页`,
      };
    });
  } catch (e) {
    const a = unifiedHandle(e, { generated: 0, total: snapshot.outline.length });
    store.update((x) => ({ ...x, busy: false, message: a.message }));
  }
}

function mergeResults(x: AppState, done: Slide[]): AppState {
  const map = new Map(done.map((d) => [d.id, d]));
  return { ...x, deck: { ...x.deck, slides: x.deck.slides.map((s) => map.get(s.id) ?? s) } };
}

function renderSlides(root: HTMLElement, s: AppState): void {
  const deck = s.deck;
  root.appendChild(el('h2', 'h', `③ 逐页内容（${deck.slides.filter((x) => x.status === 'done').length}/${deck.slides.length}）`));

  const toolbar = el('div', 'row');
  const themeSel = el('select') as HTMLSelectElement;
  THEMES.forEach((t) => {
    const o = el('option', '', t.name) as HTMLOptionElement;
    o.value = t.id;
    themeSel.appendChild(o);
  });
  themeSel.value = deck.theme;
  themeSel.onchange = () => store.update((x) => ({ ...x, deck: { ...x.deck, theme: themeSel.value as import('./model/deck').ThemeId } }));

  const backBtn = el('button', 'mini', '← 回大纲');
  backBtn.onclick = () => store.update((x) => ({ ...x, phase: 'outline', message: '' }));

  const exportBtn = el('button', 'primary', '导出 .pptx');
  exportBtn.onclick = async () => {
    store.update((x) => ({ ...x, busy: true, message: '导出中…' }));
    try {
      await exportPptx(store.get().deck);
      store.update((x) => ({ ...x, busy: false, deck: { ...x.deck, status: 'exported' }, message: '已导出（含备注/主题色/占位框）' }));
    } catch (e) {
      const a = unifiedHandle(e, { generated: deck.slides.length, total: deck.slides.length });
      store.update((x) => ({ ...x, busy: false, message: `导出失败：${a.message}` }));
    }
  };
  toolbar.append(backBtn, themeSel, exportBtn);
  root.appendChild(toolbar);

  // 预览：与导出共用 buildLayout（同一 layoutSpec 数据源，B4）
  const theme = getTheme(deck.theme);
  deck.slides.forEach((slide, i) => {
    const card = el('div', 'slide-card');
    const cv = el('div', 'slide-cv');
    cv.style.background = slide.layout === 'cover' ? theme.coverBg : theme.bg;
    const spec = buildLayout(slide);
    spec.boxes.forEach((b) => {
      const n = el('div', 'box');
      if (b.kind === 'imageSlot') {
        n.className = 'box slot';
        n.textContent = slide.imageKey ? '本地插图' : '配图占位';
      } else {
        if (!b.text) return;
        n.textContent = b.text;
        n.style.left = `${(b.x / 13.33) * 100}%`;
        n.style.top = `${(b.y / 7.5) * 100}%`;
        n.style.width = `${(b.w / 13.33) * 100}%`;
        n.style.height = `${(b.h / 7.5) * 100}%`;
        n.style.fontSize = `${Math.max(8, b.fontSize * 0.62)}px`;
        n.style.fontWeight = b.bold ? '700' : '400';
        n.style.color = b.color === 'fg' ? theme.fg : b.color === 'accent' ? theme.accent : theme.muted;
        n.style.textAlign = b.align ?? 'left';
      }
      if (b.kind === 'imageSlot') {
        n.style.left = `${(b.x / 13.33) * 100}%`;
        n.style.top = `${(b.y / 7.5) * 100}%`;
        n.style.width = `${(b.w / 13.33) * 100}%`;
        n.style.height = `${(b.h / 7.5) * 100}%`;
      }
      cv.appendChild(n);
    });

    const info = el('div', 'slide-info');
    const statusTxt = slide.status === 'done' ? '' : slide.status === 'failed' ? ' · 生成失败（占位）' : ' · 待生成';
    info.textContent = `#${i + 1} ${slide.title}${statusTxt} · ${slide.visual} · 备注 ${slide.notes ? '有' : '无'}`;

    const actions = el('div', 'slide-actions');
    const editBtn = el('button', 'mini', '编辑');
    editBtn.onclick = () => editSlide(slide.id);
    const regenBtn = el('button', 'mini', '重生成') as HTMLButtonElement;
    const tier = (deck.params?.pages ?? 12) as PageTier;
    regenBtn.disabled = guard.pool2Remaining(tier) < 1.8;   // 池2 用尽 → 置灰
    regenBtn.title = regenBtn.disabled ? '池2（编辑重生成额度）已用尽，请手工编辑' : '';
    regenBtn.onclick = async () => {
      store.update((x) => ({ ...x, busy: true, message: '单页重生成中…' }));
      try {
        const updated = await regenerateSlide(store.get().deck, slide.id);
        store.update((x) => ({ ...x, busy: false, message: '该页已重新生成', deck: { ...x.deck, slides: x.deck.slides.map((sl) => sl.id === updated.id ? updated : sl) } }));
      } catch (e) {
        const a = unifiedHandle(e, { generated: deck.slides.length, total: deck.slides.length });
        store.update((x) => ({ ...x, busy: false, message: a.message }));
      }
    };
    actions.append(editBtn, regenBtn);
    card.append(cv, info, actions);
    root.appendChild(card);
  });

  // 成本可见性（精简 CostBadge）：池1+池2 合计 = S2 口径
  const cost = el('div', 'hint', `额度台账：池1 ${ledger.total('pool1').toFixed(2)} CU · 池2 ${ledger.total('pool2').toFixed(2)} CU · S2 合计 ${ledger.s2Usage().toFixed(2)}/20 CU`);
  root.appendChild(cost);
}

function editSlide(id: string): void {
  const deck = store.get().deck;
  const slide = deck.slides.find((s) => s.id === id);
  if (!slide) return;
  const title = window.prompt('页标题', slide.title);
  if (title === null) return;
  const bullets = window.prompt('要点（每行一条，≤5 条）', slide.bullets.join('\n'));
  if (bullets === null) return;
  const notes = window.prompt('演讲备注（≤120 字）', slide.notes);
  store.update((x) => ({
    ...x,
    message: '已手工编辑（零额度）',
    deck: { ...x.deck, slides: x.deck.slides.map((s) => s.id === id ? {
      ...s, title: title.slice(0, 30),
      bullets: bullets.split('\n').map((b) => b.trim()).filter(Boolean).slice(0, LIMITS.bulletsMax),
      notes: (notes ?? '').slice(0, LIMITS.notesCharsMax),
      status: 'done',
    } : s) },
  }));
}

/* ---------------- mount ---------------- */

export function mountApp(root: HTMLElement): void {
  root.innerHTML = '';
  const header = el('header', 'top');
  header.append(el('span', 'logo', 'Deck Copilot'), el('span', 'hint', 'AI 起草 · 人可编辑的 PPT 初稿'));
  const msg = el('div', 'msg');
  const main = el('main', 'main');
  root.append(header, msg, main);

  const draw = (s: AppState) => {
    msg.textContent = s.message;
    msg.classList.toggle('err', /失败|超|不足|中断/.test(s.message));
    main.innerHTML = '';
    if (s.phase === 'brief') renderBrief(main, s);
    else if (s.phase === 'outline') renderOutline(main, s);
    else renderSlides(main, s);
  };

  store.subscribe(draw);
  draw(store.get());
}