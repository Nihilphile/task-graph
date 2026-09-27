# 接手时返回任务要求及参考索引
## 背景和目标
前置任务会提供 reference kind、summary 和文档读取能力。实现空白上下文 Agent 在 show/start 时拿到相同结构的地址清单；HTML 同时列出依赖参考。
先读 design.md 的共享 taskContext 约定；前置实现报告和 attachments-reference.md 由第一任务交付，前置完成后阅读其实际接口再实现。
## 范围
新增共享索引生成模块，既有 show JSON 增加顶层 context，start 成功返回同样字段；文本输出也展示地址。show --handoff JSON 同样带 context，正文附引用索引而不展开所有参考全文。
每个条目有 source_task、scope、path/read_path、title/summary、mode。完全依赖收集直接前置；部分依赖收集父任务与 gate.requires 对应子任务，避免引入不相关兄弟任务。相同来源登记去重，不丢掉不同来源。
投影提供依赖参考文档，HTML reference 标签按自身/依赖分组，显示文件位置、来源、摘要和缺失错误。
## 验收
show 与 start 的 content/reference 信息一致；只读 show 不写文件；多个依赖/重复 gate 不重复登记；部分 gate 只包含相关子任务；移动/缺失文件有错误，仍能查看清单；snapshot 路径指向真实快照；旧返回字段继续可用。
## 定位与运行
src/cli/commands/task-inspect.ts、task-status.ts、src/core/projection.ts、viewer-client.ts；共享文档能力见前置 reference；测试命令见 design.md。
## 交付
写 takeover-report.md 与 takeover-reference.md，注册后者为 reference，完成前执行跨 CLI/HTML 验证。
