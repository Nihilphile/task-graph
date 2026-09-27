# 附件模型接入说明

路径相对 task-graph 仓库根。

- `src/core/task.ts` → `TaskOutput`：kind 新增 reference，summary 可选；快照用既有 snapshot/sha256 字段。path 保留来源位置，读取 snapshot ?? path。
- `src/core/documents.ts` → `withDocument`：reference 默认 live；options.snapshot=true 时冻结。其他类别保留原默认方式。
- `src/core/documents.ts` → 导出的 `documentView(root, kind, output)`：构建 UI 可读文档，返回 body/html 或 href；不可读时返回 error。代码文件使用转义 pre。
- `taskDocuments` 新增可选 references 数组，目前只含本任务登记；后续聚合可以直接复用 documentView。
- `src/cli/commands/task-documents.ts`：四类 attach 共用可选 summary，reference 独有 --snapshot。
- `src/core/viewer-client.ts` → PANEL_LABELS/tabsFor/renderDocumentPanel：参考分类已存在，文档列表及详情已呈现 summary；后续可追加来源分组。
- `src/core/github-plan.ts`：reference 只进入 issue 正文索引；不发送参考文件正文评论。

验证入口：`npm run build`，`node --test --test-isolation=none dist/tests/reference-context.test.js`。本轮基础与旧附件/视图测试共 13 项通过。
