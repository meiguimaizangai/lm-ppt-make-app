# Anna Deck Copilot（精简版实现）

AI 起草、人可编辑的 PPT 初稿工作台：**一句话 brief → 可编辑大纲 → 逐页内容 → 切主题 → 导出可继续编辑的 `.pptx`**。

> 本仓库按《方案设计与拆解 v0.2》实现，**应用户要求做了精简**：砍掉盲测/发版/持久化/Executa 等重交付模块，保留单一可跑通主链路 + 关键约束（mock 零额度、导出层截断、池熔断、统一错误路径）。

## 运行

```bash
cd ui
npm install
npm run dev        # 本地开发（mock provider，零额度）
npm test           # 18 项冒烟/集成测试（零平台调用）
npm run build      # 产物 dist/（PptxGenJS 内联，零外链运行面）
```

## 主链路

`Brief 表单(任务12) → 合并式大纲(13/14) → 大纲编辑+脏标记(15) → 4页/批×2并发生成(16/17) → 预览(23) → 导出 pptx(3/21/22)`

## 目录结构（对应方案模块）

```
deck-copilot/
├── manifest.json            # M10：权限声明(llm/storage/files/image) + CSP
├── fixtures/demo-deck.json  # M0：3 页 fixture（契约往返等价）
├── docs/samples/            # 导出样例 .pptx
└── ui/
    ├── src/
    │   ├── model/deck.ts    # M0：Deck 唯一数据契约 + 状态机 + 长度约束
    │   ├── state/store.ts   # M0：订阅式 store
    │   ├── config/runtime.ts# M11：外置配置（页数档/批4/并发2/池阈值/image.enabled 默认 false）
    │   ├── llm/             # M9/M12：provider 注入（mock/real）+ SafeLLM(maxTokens 强制/超时/重试1次)
    │   ├── budget/          # M9：预估器 + 三层池台账 + 熔断（最坏情况预检）
    │   ├── prompts/         # M1/M2/M3：合并式大纲 prompt（mt 1200/1600）、逐页 prompt（2500/700）
    │   ├── gen/             # M1–M3：JSON 容错解析 + 生成服务（条数=页数、批调度、占位降级）
    │   ├── theme/themes.ts  # M5：3 主题（系统安全字体栈，零下载字体）
    │   ├── layout/engine.ts # M5：4 版式 → layoutSpec（预览与导出同一数据源，B4）
    │   ├── export/          # M6：PptxGenJS 映射 + 导出层截断/控制字符清理（B12）
    │   ├── error/classes.ts # M9：错误统一处理（单一自动路径，error.code 仅入台账，C-15）
    │   ├── app.ts           # 单页 UI：brief→大纲编辑→生成→预览→导出
    │   └── main.ts / styles.css
    └── tests/smoke.spec.ts  # 集成冒烟：契约/解析/大纲=页数/生成/导出/熔断
```

## 关键设计点（裁决落实）

| 裁决 | 实现位置 |
|---|---|
| 选 16 出 16（C-1） | `prompts/outline.ts` + `gen/service.ts` 条数校验，不等重试 1 次 |
| 4 页/批 ×2 并发（B1②） | `gen/service.ts` worker 池 |
| 改一条不触发全量重生成（L71） | 大纲编辑器只标脏页，提供“仅重算脏页” |
| 上移/下移替代拖拽（C-3） | 大纲行 ↑↓ 按钮，首末项置灰 |
| 全局重试 1 次（C-5） | `llm/safe.ts`（WeakSet 幂等） |
| 错误统一单一路径（C-15） | `error/classes.ts: unifiedHandle`，UI 不分支 |
| 要点 ≤5/≤18 字、备注 ≤120 字、导出层截断（C-10/B12） | `export/sanitize.ts` |
| 预览与导出共用 layoutSpec（B4） | `layout/engine.ts: buildLayout` 双端同源 |
| 配图默认硬关（C-16/§9） | `config/runtime.ts: imageEnabled=false`（缺失亦 false）；图文版式用占位框 |
| 零外链（C5） | vite 内联构建；扫描 dist 仅存许可证/文档字符串，无运行时请求 |
| maxTokens 强制 + 池熔断（C6） | `llm/safe.ts` 先 `guard.check` 后调用，超限请求不发出 |

## 测试结果

- `npm test`：**18/18 通过**（契约往返、状态机、JSON 容错 5 例、8/12/16 三档条数一致、16 页批量生成、单页重生成归池2、导出 buffer ZIP 头、截断、maxTokens 拒发、熔断、台账误差 0）。
- `npm run build`：typecheck 通过；bundle 410 KB（gzip 139 KB），PptxGenJS 内联。

## 已知取舍（相对方案 v0.2）

- **未实现**：M8 持久化/历史、M7 `#mention`、M13 Executa、发版/盲测（任务 31/32）、`quota-log.csv` 导出 UI（ledger 已具备 `toCsv()`）。
- **CU 换算率为占位**（1 CU ≈ 1000 tok，B18 待标定）；真实 provider 已留接口（`llm/real.ts`），设 `VITE_LLM_PROVIDER=real` 切换。
- 大纲流式退路保留配置项但未接（方案本档用不到）。