import { defineConfig } from 'vite';

/**
 * 构建约束（方案 C5 / B6）：
 * - PptxGenJS 内联进 bundle，禁止任何外链资源（字体/CDN/远程脚本）；
 * - 构建产物用相对 base，保证平台 iframe 内加载。
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000000, // 小资源全部内联，减少外链面
    cssCodeSplit: false,
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
});