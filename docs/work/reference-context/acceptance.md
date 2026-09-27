# 文档、回归与工作流验收
## 背景
此次使用当前 to-task/task-graph 管理自身修改。前置任务完成附件登记与接手返回后，按真实工具行为更新使用说明并验证端到端接手。
## 必要上下文
读取 design.md 与两个前置任务注册的 reference，确认真实字段和命令。原有 SKILL.md 的未提交上下文说明修改是此前用户讨论留下的工作，按已确认方案整合，保留其他内容。
## 工作范围
更新 SKILL.md 命令索引、references/controller-workflow.md、references/github-sync.md 及 README 中相关入口。配套 ../to-task/SKILL.md 与 task-context.md 对齐：完成任务可登记 reference，show/start 清单默认返回，handoff 仍供同任务接续。
## 验收
完整 task-graph 测试、Skill 校验通过；验证前置注册 reference → 完成 → 后继 show/start → 路径与摘要可定位 → HTML 标签打开同一内容。不得向真实 GitHub 发测试 issue。
记录现有 to-task 实际使用中的摩擦及本轮解决范围；不要声称自动测试能证明任意任务语义完整。
## 交付
写 acceptance-report.md，附实际测试数量和未解决项；完成该任务，交付本地图 HTML 地址。本轮不自动提交/push 源码。
