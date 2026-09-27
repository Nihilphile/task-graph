# Reference 与任务接手上下文
## 用户确认的范围
Agent 显式绑定文件到 task 的 reference 标签。前置任务交付供后继使用的代码索引或接入说明；后继自动沿依赖读取登记，不复制登记。所有附件类别 reference/report/log/handoff 支持可选 summary，title 仍可选；不引入 locator/read_when 字段。
show 与 start 默认返回项目根目录、任务要求地址和自身/依赖 reference 清单，地址相对项目根。摘要与地址默认足够定位，清单不嵌入文件全文。已有 show 字段和 handoff 正文保留兼容。
HTML reference 标签点开列出本任务/依赖参考，路径、摘要、来源 task 直接可见，点击打开正文。
## 本轮实现约定
reference 默认 live，适合代码；可用 --snapshot 冻结文档。report/handoff 继续默认快照，log 继续 live。reference 默认快照开关仅用于 reference attach，不改变其他附件的默认方式。
持久化复用 outputs，新增 kind=reference 与可选 summary；有 snapshot 字段即固定版本。附件 path 是来源位置，读取位置为 snapshot ?? path。
共享 taskContext(root, task) 返回 project_root、content、references、handoffs、reports；reference 条目含 source_task、scope=self/dependency、path、read_path、title、可选 summary、mode=live/snapshot 和可选 error。content 使用任务摘要作为 summary。后继只收集直接完全依赖的 references；partial 依赖收集被依赖父任务及 gate.requires 的 reference，不扫整个子图或递归祖先。相同来源登记只列一次，保留来源。
字段与清单结构由共享模块生成，CLI 与投影/UI 共用。读取失败显式 error，show 查询不产生写入/网络请求；start 的原领取、就绪与事务规则继续生效。
GitHub 已开启图仍按已有机制同步；reference 在 issue 正文列出索引与摘要，不将 live 源代码自动发布为评论。既有报告等评论保留语义，可带 summary。
## 定位
- src/core/task.ts: TaskOutput/readOutputs/serializeTaskDocument
- src/core/documents.ts: withDocument/taskDocuments/handoffText
- src/cli/commands/task-documents.ts: 附件命令
- src/cli/commands/task-inspect.ts, task-status.ts: show/start 返回
- src/core/projection.ts, viewer-client.ts: 离线数据与标签
- src/core/github-plan.ts: GitHub 正文/评论生成
- tests/us-025-task-documents.test.ts, us-026-viewer-documents.test.ts: 附件和 DOM 行为测试
## 验证入口
工具根目录 npm run build；node --test --test-isolation=none dist/tests/reference-context.test.js；最终 npm run test:only 与 node dist/src/cli.js skill validate --json。
所有测试使用临时目录和模拟 GitHub；本轮任务图保持本地，用户没有要求发布任务 issue。
