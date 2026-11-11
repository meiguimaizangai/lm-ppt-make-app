/**
 * 冒烟辅助：用 fixture 导出一份 .pptx 样例（Node 端，零平台调用）。
 * 用法: npx vite-node scripts/export-sample.mjs  或 vitest 内已覆盖等价断言。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { buildPptx } = await import(`${root}src/export/pptx.ts`);
const deck = JSON.parse(readFileSync(`${root}../fixtures/demo-deck.json`, 'utf8'));

const pptx = buildPptx(deck);
const buf = await pptx.write({ outputType: 'nodebuffer' });
mkdirSync(`${root}../docs/samples`, { recursive: true });
writeFileSync(`${root}../docs/samples/demo-light-biz.pptx`, buf);
console.log(`OK: ${buf.length} bytes -> docs/samples/demo-light-biz.pptx`);