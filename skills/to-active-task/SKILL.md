---
name: to-active-task
description: >-
  主控动态规划 task-graph：保留远期骨架，按当前信息细化近期任务，
  随交付调整划分与顺序。与一次性详细规划的 to-task 二选一。
---

# To Active Task

通过 junction/symlink 安装时，按真实文件位置解析以下链接。

先读[动态规划思想](../../references/workflows/dynamic-planning.md)，判断任务粒度、并行条件和放行依据。一次性详细规划使用 [to-task](../to-task/SKILL.md)。

| 当前工作 | 手册 |
| --- | --- |
| 共享契约、代码入口或已定决策登记 | [契约与条目](../../references/operations/contracts.md) |
| 定位 CLI / 项目 | [准备与定位](../../references/operations/bootstrap.md) |
| 创建任务或骨架 | [创建计划](../../references/operations/planning.md) |
| 写要求与前置产物约定 | [上下文设计](../to-task/references/task-context.md) |
| 增补 content / RR | [附件](../../references/operations/attachments.md) |
| 调整子图、依赖或 gate | [关系](../../references/operations/relationships.md) |
| refine、撤回放行 | [动态细化](../../references/operations/refinement.md) |
| 派工、读交付、收口 | [主控协作](../../references/workflows/controller.md) |
| 配置或恢复独立审查 | [审查控制](../../references/operations/review-control.md) |
| 订阅结果 | [通知](../../references/operations/watch.md) |
| 修订或刷新 HTML | [维护](../../references/operations/maintenance.md) |
