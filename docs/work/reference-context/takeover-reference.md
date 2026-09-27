# 接手索引接口

路径相对 task-graph 仓库根。

- `src/core/task-context.ts` → `taskContext(root, task, repository?)`：只读返回 project_root、content、references、handoffs、reports；不会将引用文件正文放入清单。
- `ContextFile`：path 是原来源地址；read_path 是执行者应读取的位置（snapshot ?? path）；mode 区分 live/snapshot；summary/sha256/error 可选。
- `ContextReference`：增加 source_task 与 scope=self/dependency。
- `referenceBindings` 内部统一计算来源，`referenceDocuments` 用同一来源集合构建离线预览；gate 取父任务与 requires，按来源 task 去重，保留不同来源的相同路径。
- `formatTaskContext`：CLI 文本与 handoff 的地址索引。handoff 保留旧正文语义，reference 不展开正文。
- `src/cli/commands/task-inspect.ts` / `task-status.ts`：show（包括 --handoff）与 start/reopen 的 JSON 顶层 context；show 仍兼容原任务字段，documents.references 只返回元信息。
- `src/core/projection.ts` / `viewer-client.ts`：参考分类通过 source_task/scope 分组、列出路径并打开预览。

验证：`npm run build` 和 `node --test --test-isolation=none dist/tests/reference-context.test.js`，共 7 项通过。下一任务需同步文档并运行完整回归。
