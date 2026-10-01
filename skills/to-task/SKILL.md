---
name: to-task
description: >-
  把已讨论的需求、PRD、spec 或实施计划一次性详细拆成可独立验收的任务，直接写入 task-graph，
  生成完整要求文件、依赖数组与离线 HTML；用户需要时由 task-graph 自动发布到 GitHub。
  适用于从规划进入可派工任务、给已有交付拆子任务或续补计划；日常状态和报告维护使用 task-graph。
---

# To Task

本文件链接相对工具仓库内的实际文件位置；通过 junction/symlink 安装时先解析真实目标，再读取链接。

面向写任务的主控：把已确认需求一次性细化成空白上下文 Agent 可接手、可独立验收的任务。本模式默认 static；用户选择逐步细化时改用 [to-active-task](../to-active-task/SKILL.md)，两者是可选工作流。

## 先读思想与工作流

本次采用此模式时读 [详细规划工作流](../../references/workflows/static-planning.md)：纵向切片、要求边界、前置产物和交接责任。它指导如何判断，不要求主控代做执行者的交付操作。

## 按当前工作读取手册

| 当前工作 | 读取 |
| --- | --- |
| 共享契约、代码入口或已定决策登记 | [契约与条目](../../references/operations/contracts.md) |
| 首次定位 CLI / 项目 | [准备与定位](../../references/operations/bootstrap.md) |
| 写任务 content 或检查空白上下文是否够用 | [上下文设计](references/task-context.md) |
| 单项/批量落图、稳定 key、安全重试 | [创建计划](../../references/operations/planning.md) |
| 父子图、依赖或 gate | [关系](../../references/operations/relationships.md) |
| 给已有任务绑定多份要求/RR | [附件](../../references/operations/attachments.md) |
| 设置自动审查或稍后手动审查 | [主控审查操作](../../references/operations/review-control.md) |
| 派工、读报告、父任务收口 | [主控协作](../../references/workflows/controller.md) |
| 修订旧任务或刷新 HTML | [维护](../../references/operations/maintenance.md) |
| 用户需要 GitHub 发布 | [同步](../../references/github-sync.md) |

执行者接手与 reference 登记由 [task-take](../task-take/SKILL.md) 指导；主控在要求中说明后继需要哪些知识即可。完成建图应交付要求入口、实际 ID/依赖、HTML 和未决问题；用户同时授权实施时继续推进。
