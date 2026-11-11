/**
 * 三套主题（任务 19 精简版）：浅色商务 / 深色科技 / 极简留白。
 * 仅系统安全字体栈（零下载字体，C5）。
 */

export interface Theme {
  id: string;
  name: string;
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  coverBg: string;
  fontFamily: string;   // 系统安全栈
}

export const THEMES: Theme[] = [
  {
    id: 'light-biz', name: '浅色商务',
    bg: '#FFFFFF', fg: '#1F2937', accent: '#2563EB', muted: '#6B7280',
    coverBg: '#EFF6FF',
    fontFamily: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', Arial, sans-serif",
  },
  {
    id: 'dark-tech', name: '深色科技',
    bg: '#0F172A', fg: '#E2E8F0', accent: '#38BDF8', muted: '#94A3B8',
    coverBg: '#1E293B',
    fontFamily: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', Arial, sans-serif",
  },
  {
    id: 'minimal', name: '极简留白',
    bg: '#FAFAF7', fg: '#111111', accent: '#C2410C', muted: '#8A8A82',
    coverBg: '#F5F5F0',
    fontFamily: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', Arial, sans-serif",
  },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}