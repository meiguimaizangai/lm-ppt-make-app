/**
 * 入口：窗口打开即渲染 Deck Copilot 主壳（console 零报错）。
 * 加载样式 + 挂载单页应用。
 */
import './styles.css';
import { mountApp } from './app';

const root = document.getElementById('app');
if (root) {
  mountApp(root);
} else {
  console.error('[deck-copilot] #app root missing');
}